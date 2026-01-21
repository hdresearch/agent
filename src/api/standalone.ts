/**
 * Standalone API - Direct access to orchestrator/vm/config modules
 *
 * Used by both MCP server and CLI for standalone operation (no HTTP server needed).
 * All functions call the underlying modules directly.
 */

import { listManagedVms, createManagedVm, getManagedVm, branchVm, deleteManagedVm, type ManagedVm } from "../orchestrator";
import { execute, getAgentUrl } from "../vm";
import { VM_AGENT_DIR } from "../vm/constants";
import { loadConfig, getConfig, setConfig, type AgentConfig } from "../utils/config";
import { subscribeToVmEvents } from "../server/vm-event-aggregator";

// ============================================================
// Types
// ============================================================

export interface VmInfo {
  vmId: string;
  parent?: string | null;
  status: string;
  task?: string;
  approach?: string;
  createdAt: string;
}

export interface VmListResult {
  vms: VmInfo[];
}

export interface VmCreateResult {
  vmId: string;
  agentUrl: string;
}

export interface VmBranchResult {
  vmId: string;
  parentId: string;
  agentUrl: string;
}

export interface VmDeleteResult {
  deleted: boolean;
}

export interface VmExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface VmRunResult {
  vmId: string;
  dispatched: boolean;
}

export interface VmEvalResult {
  vmId: string;
  success: boolean;
  projectType: string;
  score: number;
  scoreBreakdown: {
    build: number;
    test: number;
    lint: number;
    typecheck: number;
  };
  results: Record<string, {
    success: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  }>;
  totalDurationMs: number;
}

export interface VmStatusResult {
  vms: Record<string, {
    vmId: string;
    status: string;
    task?: string;
    lastMessage?: string;
    lastMessageType?: string;
  }>;
}

export interface VmWaitResult {
  vmId: string;
  status: "completed" | "failed" | "timeout";
  durationMs: number;
  error?: string;
}

export interface HealthResult {
  status: string;
  mode: string;
  version: string;
}

// ============================================================
// Config Functions
// ============================================================

export { loadConfig, getConfig, setConfig };

export function getHealth(): HealthResult {
  return {
    status: "ok",
    mode: "standalone",
    version: "1.0.0",
  };
}

// ============================================================
// VM Functions
// ============================================================

export async function listVms(): Promise<VmListResult> {
  const vms = await listManagedVms();
  return {
    vms: vms.map(vm => ({
      vmId: vm.vmId,
      parent: vm.parent,
      status: vm.metadata?.status || "ready",
      task: vm.metadata?.task,
      approach: vm.metadata?.approach,
      createdAt: vm.metadata?.createdAt || new Date().toISOString(),
    })),
  };
}

export async function createVm(task?: string, env?: Record<string, string>): Promise<VmCreateResult> {
  const vm = await createManagedVm({}, task, env);
  const agentUrl = getAgentUrl(vm.vmId);
  return {
    vmId: vm.vmId,
    agentUrl,
  };
}

export async function branchVmById(parentVmId: string, task?: string, approach?: string): Promise<VmBranchResult> {
  const vm = await branchVm(parentVmId, task, approach);
  const agentUrl = getAgentUrl(vm.vmId);
  return {
    vmId: vm.vmId,
    parentId: parentVmId,
    agentUrl,
  };
}

export async function deleteVm(vmId: string): Promise<VmDeleteResult> {
  try {
    await deleteManagedVm(vmId);
    return { deleted: true };
  } catch {
    return { deleted: false };
  }
}

export async function executeOnVm(vmId: string, command: string): Promise<VmExecuteResult> {
  const result = await execute(vmId, command);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function runOnVm(vmId: string, prompt: string): Promise<VmRunResult> {
  const managed = await getManagedVm(vmId);
  if (!managed) {
    return { vmId, dispatched: false };
  }

  try {
    // Initialize and send prompt without waiting
    managed.client.initialize("vers-agent").then(() => {
      managed.client.newSession().then((session) => {
        managed.sessionId = session.sessionId;
        managed.client.prompt(prompt).catch(() => {
          // Ignore prompt errors
        });
      });
    }).catch(() => {
      // Ignore initialization errors
    });
    return { vmId, dispatched: true };
  } catch {
    return { vmId, dispatched: false };
  }
}

// ============================================================
// Ralph-Style Loop
// ============================================================

import { runPromptLoop, cancelLoop, getLoopStatus } from "../orchestrator";

export interface VmLoopResult {
  vmId: string;
  started: boolean;
  error?: string;
}

export interface VmLoopStatusResult {
  vmId: string;
  active: boolean;
  iteration?: number;
  maxIterations?: number;
  completionPromise?: string;
}

/**
 * Start a ralph-style loop on a VM
 */
export async function startVmLoop(
  vmId: string,
  prompt: string,
  options: { maxIterations?: number; completionPromise?: string } = {}
): Promise<VmLoopResult> {
  const result = await runPromptLoop(vmId, prompt, options);
  return {
    vmId,
    started: result.started,
    error: result.error,
  };
}

/**
 * Cancel an active loop on a VM
 */
export function stopVmLoop(vmId: string): { vmId: string; cancelled: boolean } {
  const cancelled = cancelLoop(vmId);
  return { vmId, cancelled };
}

/**
 * Get loop status for a VM
 */
export function getVmLoopStatus(vmId: string): VmLoopStatusResult {
  const status = getLoopStatus(vmId);
  return {
    vmId,
    active: status?.active ?? false,
    iteration: status?.iteration,
    maxIterations: status?.maxIterations,
    completionPromise: status?.completionPromise,
  };
}

export async function getVmStatus(limit: number = 1): Promise<VmStatusResult> {
  const vmList = await listManagedVms();
  const result: VmStatusResult["vms"] = {};

  await Promise.all(
    vmList.map(async (vm) => {
      const vmId = vm.vmId;
      const metadata = vm.metadata;
      let lastMessage: string | undefined;
      let lastMessageType: string | undefined;

      try {
        const managed = await getManagedVm(vmId);
        if (managed) {
          const outputsResult = await managed.client.getSessionOutputs({});
          const outputs = outputsResult.outputs || [];

          for (let i = outputs.length - 1; i >= 0; i--) {
            const output = outputs[i];
            if (!output) continue;
            if (output.type === "text") {
              lastMessage = output.content;
              lastMessageType = "assistant";
              break;
            } else if (output.type === "tool-result" || output.type === "tool_result") {
              if (!lastMessage) {
                lastMessage = output.content.slice(0, 200);
                lastMessageType = "tool_result";
              }
            }
          }
        }
      } catch {
        // VM not reachable
      }

      result[vmId] = {
        vmId,
        status: metadata?.status || "unknown",
        task: metadata?.task,
        lastMessage,
        lastMessageType,
      };
    })
  );

  return { vms: result };
}

export async function waitForVm(vmId: string, timeout?: number): Promise<VmWaitResult> {
  const waitTimeout = timeout ?? 300000; // 5 min default
  const startTime = Date.now();

  const managed = await getManagedVm(vmId);
  if (!managed) {
    return {
      vmId,
      status: "failed",
      durationMs: 0,
      error: "VM not found",
    };
  }

  return new Promise((resolve) => {
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = subscribeToVmEvents((event) => {
      if (resolved) return;
      if (event.vmId !== vmId) return;

      const eventType = event.event.type;

      if (eventType === "completed") {
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        unsubscribe();

        resolve({
          vmId,
          status: "completed",
          durationMs: Date.now() - startTime,
        });
      } else if (eventType === "failed") {
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        unsubscribe();

        const errorData = event.event.data as { error?: string };
        resolve({
          vmId,
          status: "failed",
          durationMs: Date.now() - startTime,
          error: errorData?.error || "Task failed",
        });
      }
    });

    timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      unsubscribe();

      resolve({
        vmId,
        status: "timeout",
        durationMs: waitTimeout,
        error: `Timeout after ${waitTimeout}ms`,
      });
    }, waitTimeout);
  });
}

export async function evalVm(vmId: string): Promise<VmEvalResult> {
  const managed = await getManagedVm(vmId);
  if (!managed) {
    throw new Error(`VM not found: ${vmId}`);
  }

  const evalTimeout = 60000;
  const workDir = VM_AGENT_DIR;

  // Detect project type
  const detectCmd = `
    if [ -f bun.lock ] || [ -f bun.lockb ]; then echo "bun";
    elif [ -f package.json ]; then echo "node";
    elif [ -f Cargo.toml ]; then echo "rust";
    elif [ -f go.mod ]; then echo "go";
    elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then echo "python";
    else echo "unknown"; fi
  `.trim().replace(/\n\s*/g, ' ');

  const detectResult = await execute(vmId, `cd ${workDir} && ${detectCmd}`);
  const projectType = detectResult.stdout.trim() || "unknown";

  // Get default commands based on project type
  const defaultCommands: Record<string, { build?: string; test?: string; lint?: string; typecheck?: string }> = {
    bun: { build: "bun run build", test: "bun test", lint: "bun run lint", typecheck: "bun run tsc --noEmit" },
    node: { build: "npm run build", test: "npm test", lint: "npm run lint", typecheck: "npm run typecheck" },
    rust: { build: "cargo build", test: "cargo test", lint: "cargo clippy -- -D warnings", typecheck: "cargo check" },
    go: { build: "go build ./...", test: "go test ./...", lint: "golangci-lint run", typecheck: "go vet ./..." },
    python: { test: "pytest", lint: "ruff check .", typecheck: "mypy ." },
    unknown: {},
  };

  const cmds = defaultCommands[projectType] || {};
  const results: VmEvalResult["results"] = {};
  const scoreBreakdown = { build: 0, test: 0, lint: 0, typecheck: 0 };

  async function runCmd(cmd: string): Promise<{ success: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    const start = Date.now();
    try {
      const result = await execute(vmId, `cd ${workDir} && timeout ${Math.floor(evalTimeout / 1000)} ${cmd}`);
      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  const startTime = Date.now();

  // Run build
  if (cmds.build) {
    results.build = await runCmd(cmds.build);
    scoreBreakdown.build = results.build.success ? 25 : 0;
  } else {
    scoreBreakdown.build = 25;
  }

  // Run typecheck
  if (cmds.typecheck) {
    results.typecheck = await runCmd(cmds.typecheck);
    scoreBreakdown.typecheck = results.typecheck.success ? 15 : 0;
  } else {
    scoreBreakdown.typecheck = 10;
  }

  // Run lint
  if (cmds.lint) {
    results.lint = await runCmd(cmds.lint);
    scoreBreakdown.lint = results.lint.success ? 20 : 0;
  } else {
    scoreBreakdown.lint = 15;
  }

  // Run tests
  if (cmds.test) {
    results.test = await runCmd(cmds.test);
    scoreBreakdown.test = results.test.success ? 40 : 0;
  } else {
    scoreBreakdown.test = 30;
  }

  const score = scoreBreakdown.build + scoreBreakdown.test + scoreBreakdown.lint + scoreBreakdown.typecheck;
  const success = (!results.build || results.build.success) && (!results.test || results.test.success);

  return {
    vmId,
    success,
    projectType,
    score,
    scoreBreakdown,
    results,
    totalDurationMs: Date.now() - startTime,
  };
}

// ============================================================
// Helper: Find VM by partial ID
// ============================================================

export async function findVmByPartialId(partialId: string): Promise<VmInfo | null> {
  const { vms } = await listVms();
  return vms.find(v => v.vmId.startsWith(partialId)) || null;
}

// ============================================================
// VM Outputs - Get full conversation from a VM
// ============================================================

export interface VmOutput {
  type: "assistant" | "tool_result" | "user";
  content: string;
  toolName?: string;
}

export interface VmOutputsResult {
  vmId: string;
  sessionId?: string;
  outputs: VmOutput[];
}

/**
 * Get recent outputs from a VM session (like `tail -n`)
 * @param vmId - The VM ID
 * @param n - Number of recent outputs to return (default: 10)
 */
export async function getVmOutputs(vmId: string, n: number = 10): Promise<VmOutputsResult> {
  const managed = await getManagedVm(vmId);
  if (!managed) {
    return { vmId, outputs: [] };
  }

  try {
    const result = await managed.client.getSessionOutputs({});
    const allOutputs = result.outputs || [];

    // Take only the last n outputs
    const recentOutputs = allOutputs.slice(-n);
    const outputs: VmOutput[] = [];

    for (const output of recentOutputs) {
      if (output.type === "text") {
        outputs.push({ type: "assistant", content: output.content });
      } else if (output.type === "tool-result" || output.type === "tool_result") {
        outputs.push({
          type: "tool_result",
          content: output.content,
          toolName: output.toolName,
        });
      } else if (output.type === "user") {
        outputs.push({ type: "user", content: output.content });
      }
    }

    return {
      vmId,
      sessionId: managed.sessionId,
      outputs,
    };
  } catch {
    return { vmId, outputs: [] };
  }
}

// ============================================================
// Get managed VM client (for advanced operations)
// ============================================================

export { getManagedVm, getAgentUrl };
