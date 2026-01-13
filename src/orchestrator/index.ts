/**
 * Minimal VM orchestrator
 *
 * - Tracks VM metadata in JSON files (task, approach, status)
 * - Relies on vers API for VM state and tree structure
 * - Uses existing http-client for agent communication
 */

import { createVm, branch, deleteVm, listVms, getAgentUrl, restore, type VmConfig } from "../vm/index";
import { bootstrap } from "../vm/bootstrap";
import { registerVm, receiveVmEvent, removeVmConnection } from "../server/vm-event-aggregator";

// Golden image commit ID (pre-installed Node.js, Claude Code, vers-agent)
const GOLDEN_COMMIT_ID = process.env.VERS_GOLDEN_COMMIT_ID;
import { HttpAcpClient } from "../client/http-client";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";

// ============================================================
// Types
// ============================================================

export interface VmMetadata {
  task?: string;
  approach?: string;
  status: "starting" | "ready" | "busy" | "completed" | "failed";
  createdAt: string;
  parentId?: string;
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

function loadMetadata(): Record<string, VmMetadata> {
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

function updateVmMetadata(vmId: string, updates: Partial<VmMetadata>): void {
  const all = loadMetadata();
  const existing = all[vmId] || { status: "starting" as const, createdAt: new Date().toISOString() };
  all[vmId] = { ...existing, ...updates } as VmMetadata;
  saveMetadata(all);
}

function removeVmMetadata(vmId: string): void {
  const all = loadMetadata();
  delete all[vmId];
  saveMetadata(all);
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

  // Connect client
  const agentUrl = getAgentUrl(vmId);
  const client = new HttpAcpClient(agentUrl, { rejectUnauthorized: false });
  await client.connect();

  // Register with event aggregator and forward notifications
  registerVm(vmId, agentUrl);
  client.onNotification((notification) => {
    receiveVmEvent(vmId, notification);
  });

  updateVmMetadata(vmId, { status: "ready" });

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

  // Agent should already be running on branched VM
  // Just need to connect
  const agentUrl = getAgentUrl(vmId);
  const client = new HttpAcpClient(agentUrl, { rejectUnauthorized: false });
  await client.connect();

  // Register with event aggregator and forward notifications
  registerVm(vmId, agentUrl);
  client.onNotification((notification) => {
    receiveVmEvent(vmId, notification);
  });

  updateVmMetadata(vmId, { status: "ready" });

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

  // Reconnect
  const agentUrl = getAgentUrl(vmId);
  const client = new HttpAcpClient(agentUrl, { rejectUnauthorized: false });
  try {
    await client.connect();
    // Register with event aggregator and forward notifications
    registerVm(vmId, agentUrl);
    client.onNotification((notification) => {
      receiveVmEvent(vmId, notification);
    });
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
