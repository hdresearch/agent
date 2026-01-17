/**
 * Minimal VM orchestrator
 *
 * - Tracks VM metadata in JSON files (task, approach, status)
 * - Relies on vers API for VM state and tree structure
 * - Uses existing http-client for agent communication
 */

import { createVm, branch, deleteVm, listVms, getAgentUrl, restore, execute, type VmConfig } from "../vm/index";
import { VM_VERS_AGENT_CONFIG_DIR } from "../vm/constants";
import { bootstrap } from "../vm/bootstrap";
import { registerVm, receiveVmEvent, removeVmConnection } from "../server/vm-event-aggregator";
// Auth is now simple: just use VERS_API_KEY directly

// Golden image commit ID (pre-installed Node.js, Claude Code, vers-agent)
const GOLDEN_COMMIT_ID = process.env.VERS_GOLDEN_COMMIT_ID;
import { HttpAcpClient } from "../client/http-client";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";

// ============================================================
// Types
// ============================================================

export type VmStatus =
  | "starting"    // Being created/bootstrapped
  | "ready"       // Healthy and idle
  | "busy"        // Running a task
  | "completed"   // Task finished successfully
  | "failed"      // Task failed
  | "unhealthy"   // Health checks failing
  | "recovering"; // Being recreated by self-healer

export interface VmMetadata {
  task?: string;
  approach?: string;
  status: VmStatus;
  createdAt: string;
  parentId?: string;

  // Health tracking (added for autonomous operation)
  lastHealthCheckAt?: string;     // Last successful health check
  lastEventAt?: string;           // Last event received from this VM
  healthScore?: number;           // 0-100, computed from recent checks
  consecutiveFailures?: number;   // For circuit breaker logic
  lastError?: string;             // Most recent error message
  recoveryAttempts?: number;      // How many times self-healer has tried
}

export interface ManagedVm {
  vmId: string;
  metadata: VmMetadata;
  client: HttpAcpClient;
  sessionId?: string;
}

// ============================================================
// JSON File Storage
// ============================================================

const DATA_DIR = join(homedir(), ".vers-agent", "orchestrator");
const METADATA_FILE = join(DATA_DIR, "vms.json");

function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

// Export for use by health monitor and watchdog
export function loadMetadata(): Record<string, VmMetadata> {
  ensureDataDir();
  if (!existsSync(METADATA_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(METADATA_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveMetadata(metadata: Record<string, VmMetadata>): void {
  ensureDataDir();
  writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
}

// Export for use by health monitor and watchdog
export function updateVmMetadata(vmId: string, updates: Partial<VmMetadata>): void {
  const all = loadMetadata();
  const existing = all[vmId] || { status: "starting" as const, createdAt: new Date().toISOString() };
  all[vmId] = { ...existing, ...updates } as VmMetadata;
  saveMetadata(all);
}

// Export for use by watchdog
export function removeVmMetadata(vmId: string): void {
  const all = loadMetadata();
  delete all[vmId];
  saveMetadata(all);
}

// ============================================================
// Auth Helpers
// ============================================================

const VERS_API_KEY = process.env.VERS_API_KEY;

/**
 * Create an HttpAcpClient for a VM with the API key set.
 */
function createVmClient(vmId: string): HttpAcpClient {
  const agentUrl = getAgentUrl(vmId);
  const client = new HttpAcpClient(agentUrl, { rejectUnauthorized: false });

  // Use the API key directly for authentication
  if (VERS_API_KEY) {
    client.setToken(VERS_API_KEY);
  }

  return client;
}

/**
 * Inject VERS_API_KEY and VERS_VM_ID into the VM's config and restart vers-agent.
 * The API key enables SDK calls and authentication.
 */
async function injectVmIdAndRestart(vmId: string): Promise<void> {
  if (!VERS_API_KEY) return; // No API key, skip injection

  // Update env file with VERS_VM_ID and VERS_API_KEY, then restart
  const commands = [
    // Ensure env file exists
    `mkdir -p /etc/vers-agent`,
    // Update or add VERS_VM_ID
    `grep -q "^VERS_VM_ID=" /etc/vers-agent/env 2>/dev/null && sed -i "s/^VERS_VM_ID=.*/VERS_VM_ID=${vmId}/" /etc/vers-agent/env || echo "VERS_VM_ID=${vmId}" >> /etc/vers-agent/env`,
    // Update or add VERS_API_KEY (so VM can use SDK)
    `grep -q "^VERS_API_KEY=" /etc/vers-agent/env 2>/dev/null && sed -i "s/^VERS_API_KEY=.*/VERS_API_KEY=${VERS_API_KEY}/" /etc/vers-agent/env || echo "VERS_API_KEY=${VERS_API_KEY}" >> /etc/vers-agent/env`,
    // Clear stale auth.db
    `rm -f ${VM_VERS_AGENT_CONFIG_DIR}/auth.db`,
    // Restart vers-agent via systemd
    `systemctl restart vers-agent`,
  ].join(" && ");

  await execute(vmId, commands);
  // Wait for agent to restart
  await new Promise(resolve => setTimeout(resolve, 3000));
}

// ============================================================
// Orchestrator
// ============================================================

// In-memory cache of managed VMs (clients are not serializable)
const managedVms = new Map<string, ManagedVm>();

/**
 * Create a new root VM and bootstrap the agent
 * Uses golden image commit if VERS_GOLDEN_COMMIT_ID is set (fast restore)
 * Otherwise falls back to fresh VM + bootstrap (slow)
 */
export async function createManagedVm(
  config: VmConfig = {},
  task?: string
): Promise<ManagedVm> {
  let vmId: string;

  if (GOLDEN_COMMIT_ID) {
    // Fast path: restore from golden image (~2s)
    console.log(`Restoring from golden image ${GOLDEN_COMMIT_ID}...`);
    vmId = await restore(GOLDEN_COMMIT_ID);
    // Brief wait for networking
    await new Promise(resolve => setTimeout(resolve, 2000));
  } else {
    // Slow path: create fresh VM + bootstrap (~60s)
    console.log("No golden image configured, creating fresh VM...");
    vmId = await createVm(config);
    await new Promise(resolve => setTimeout(resolve, 5000));
    await bootstrap(vmId);
  }

  const metadata: VmMetadata = {
    task,
    status: "starting",
    createdAt: new Date().toISOString(),
  };
  updateVmMetadata(vmId, metadata);

  // Inject VM ID so agent can auto-claim with derived token
  await injectVmIdAndRestart(vmId);

  // Connect client (with derived token if VERS_API_KEY is set)
  const client = createVmClient(vmId);
  const agentUrl = getAgentUrl(vmId);
  await client.connect();

  // Register with event aggregator and forward notifications
  registerVm(vmId, agentUrl);
  client.onNotification((notification) => {
    receiveVmEvent(vmId, notification);
    // Track last event time for health monitoring
    updateVmMetadata(vmId, { lastEventAt: new Date().toISOString() });
  });

  updateVmMetadata(vmId, { status: "ready", lastHealthCheckAt: new Date().toISOString() });

  const managed: ManagedVm = { vmId, metadata: { ...metadata, status: "ready" }, client };
  managedVms.set(vmId, managed);

  return managed;
}

/**
 * Branch an existing VM (cheap operation)
 */
export async function branchVm(
  parentVmId: string,
  task?: string,
  approach?: string
): Promise<ManagedVm> {
  const vmId = await branch(parentVmId);

  const metadata: VmMetadata = {
    task,
    approach,
    status: "starting",
    createdAt: new Date().toISOString(),
    parentId: parentVmId,
  };
  updateVmMetadata(vmId, metadata);

  // Inject VM ID so agent can auto-claim with derived token
  await injectVmIdAndRestart(vmId);

  // Agent should already be running on branched VM
  // Just need to connect (with derived token if VERS_API_KEY is set)
  const client = createVmClient(vmId);
  const agentUrl = getAgentUrl(vmId);
  await client.connect();

  // Register with event aggregator and forward notifications
  registerVm(vmId, agentUrl);
  client.onNotification((notification) => {
    receiveVmEvent(vmId, notification);
    // Track last event time for health monitoring
    updateVmMetadata(vmId, { lastEventAt: new Date().toISOString() });
  });

  updateVmMetadata(vmId, { status: "ready", lastHealthCheckAt: new Date().toISOString() });

  const managed: ManagedVm = { vmId, metadata: { ...metadata, status: "ready" }, client };
  managedVms.set(vmId, managed);

  return managed;
}

/**
 * Delete a VM and clean up metadata
 */
export async function deleteManagedVm(vmId: string): Promise<void> {
  // Remove from event aggregator first
  removeVmConnection(vmId);

  const managed = managedVms.get(vmId);
  if (managed) {
    managed.client.close();
    managedVms.delete(vmId);
  }

  await deleteVm(vmId);
  removeVmMetadata(vmId);
}

/**
 * Get a managed VM by ID (reconnects if needed)
 */
export async function getManagedVm(vmId: string): Promise<ManagedVm | null> {
  // Check in-memory cache first
  if (managedVms.has(vmId)) {
    return managedVms.get(vmId)!;
  }

  // Check if we have metadata for this VM
  const all = loadMetadata();
  const metadata = all[vmId];
  if (!metadata) {
    return null;
  }

  // Reconnect (with derived token if VERS_API_KEY is set)
  const client = createVmClient(vmId);
  const agentUrl = getAgentUrl(vmId);
  try {
    await client.connect();
    // Register with event aggregator and forward notifications
    registerVm(vmId, agentUrl);
    client.onNotification((notification) => {
      receiveVmEvent(vmId, notification);
      // Track last event time for health monitoring
      updateVmMetadata(vmId, { lastEventAt: new Date().toISOString() });
    });
    updateVmMetadata(vmId, { lastHealthCheckAt: new Date().toISOString() });
  } catch {
    return null;
  }

  const managed: ManagedVm = { vmId, metadata, client };
  managedVms.set(vmId, managed);

  return managed;
}

/**
 * Run a prompt on a VM
 */
export async function runPrompt(
  vmId: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  const managed = await getManagedVm(vmId);
  if (!managed) {
    return { success: false, error: "VM not found or not connected" };
  }

  updateVmMetadata(vmId, { status: "busy" });

  try {
    // Create session if needed
    if (!managed.sessionId) {
      const session = await managed.client.newSession();
      managed.sessionId = session.sessionId;
    }

    await managed.client.prompt(text);
    updateVmMetadata(vmId, { status: "ready" });
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    updateVmMetadata(vmId, { status: "failed" });
    return { success: false, error };
  }
}

/**
 * Run the same task on multiple branches in parallel
 */
export async function runParallel(
  parentVmId: string,
  task: string,
  approaches: string[]
): Promise<Array<{ vmId: string; approach: string; success: boolean; error?: string }>> {
  // Branch VMs
  const branches = await Promise.all(
    approaches.map(approach => branchVm(parentVmId, task, approach))
  );

  // Run prompts in parallel
  const results = await Promise.all(
    branches.map(async (vm, i) => {
      const approach = approaches[i] ?? "unknown";
      const result = await runPrompt(vm.vmId, `${task}\n\nApproach: ${approach}`);
      return {
        vmId: vm.vmId,
        approach,
        ...result,
      };
    })
  );

  return results;
}

/**
 * List all VMs (uses vers API as source of truth, enriches with local metadata)
 */
export async function listManagedVms(): Promise<Array<{
  vmId: string;
  parent?: string | null;
  metadata?: VmMetadata;
}>> {
  const [vms, metadata] = await Promise.all([
    listVms(),
    Promise.resolve(loadMetadata()),
  ]);

  return vms.map(vm => ({
    vmId: vm.vm_id,
    // Use vers API parent as source of truth
    parent: vm.parent,
    metadata: metadata[vm.vm_id],
  }));
}

/**
 * Clean up all VMs we're tracking
 */
export async function cleanupAll(): Promise<number> {
  const metadata = loadMetadata();
  const vmIds = Object.keys(metadata);

  let deleted = 0;
  for (const vmId of vmIds) {
    try {
      await deleteManagedVm(vmId);
      deleted++;
    } catch {
      // VM may already be gone
      removeVmMetadata(vmId);
    }
  }

  return deleted;
}

// ============================================================
// Monitoring Integration
// ============================================================

import { HealthMonitor, type HealthCheckResult, type HealthStatus } from "./health-monitor";
import { Watchdog } from "./watchdog";
import { loadMonitoringConfig, type MonitoringConfig } from "./monitoring-config";
import { logStream } from "../utils/log-stream";

let healthMonitor: HealthMonitor | null = null;
let watchdog: Watchdog | null = null;

/**
 * Start autonomous monitoring services
 */
export function startMonitoring(configOverride?: Partial<MonitoringConfig>): void {
  const config = loadMonitoringConfig();
  const mergedConfig = {
    ...config,
    ...configOverride,
    health: { ...config.health, ...(configOverride?.health ?? {}) },
    watchdog: { ...config.watchdog, ...(configOverride?.watchdog ?? {}) },
  };

  if (!mergedConfig.enabled) {
    logStream.info("[orchestrator] Monitoring disabled by config");
    return;
  }

  // Create and start health monitor
  healthMonitor = new HealthMonitor(mergedConfig.health);
  healthMonitor.onHealthChange((vmId: string, status: HealthStatus, result: HealthCheckResult) => {
    logStream.info("[orchestrator] VM health changed", { vmId, status, error: result.error });
    // Future: hook up self-healer here
  });
  healthMonitor.start();

  // Create and start watchdog
  watchdog = new Watchdog(mergedConfig.watchdog);
  watchdog.start();

  logStream.info("[orchestrator] Monitoring started", {
    healthIntervalMs: mergedConfig.health.intervalMs,
    watchdogIntervalMs: mergedConfig.watchdog.intervalMs,
  });
}

/**
 * Stop monitoring services
 */
export function stopMonitoring(): void {
  if (healthMonitor) {
    healthMonitor.stop();
    healthMonitor = null;
  }
  if (watchdog) {
    watchdog.stop();
    watchdog = null;
  }
  logStream.info("[orchestrator] Monitoring stopped");
}

/**
 * Check if monitoring is running
 */
export function isMonitoringRunning(): boolean {
  return (healthMonitor?.isRunning() ?? false) || (watchdog?.isRunning() ?? false);
}

/**
 * Get the health monitor instance (for direct access)
 */
export function getHealthMonitor(): HealthMonitor | null {
  return healthMonitor;
}

/**
 * Get the watchdog instance (for direct access)
 */
export function getWatchdog(): Watchdog | null {
  return watchdog;
}
