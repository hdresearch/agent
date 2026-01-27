// VM management handlers (orchestrator)

import type {
  VmListResult,
  VmCreateParams,
  VmCreateResult,
  VmBranchParams,
  VmBranchResult,
  VmDeleteParams,
  VmDeleteResult,
  VmConnectParams,
  VmConnectResult,
  VmStatusResult,
  VmRunParams,
  VmRunResult,
  VmExecuteParams,
  VmExecuteResult,
  VmUploadParams,
  VmUploadResult,
  VmEventsParams,
  VmEventsResult,
  VmOutputsParams,
  VmOutputsResult,
  VmWaitParams,
  VmWaitResult,
  VmOutputsAllParams,
  VmOutputsAllResult,
  VmEvalParams,
  VmEvalResult,
} from "../../protocol/acp-types";
import {
  subscribeToVmEvents,
  getEventsSince,
  getLastSeq,
  getConnectionStatusObject,
} from "../vm-event-aggregator";
import { logStream } from "../../utils/log-stream";
import { VM_AGENT_DIR } from "../../vm/constants";

// Logging helpers
function info(message: string, data?: unknown): void {
  logStream.info(`[vm-handlers] ${message}`, data);
}

function warn(message: string, data?: unknown): void {
  logStream.warn(`[vm-handlers] ${message}`, data);
}

function error(message: string, data?: unknown): void {
  logStream.error(`[vm-handlers] ${message}`, data);
}

/**
 * Context for VM handlers - provides access to server state
 */
export interface VmHandlerContext {
  getCurrentVmId: () => string | null;
  setCurrentVmId: (id: string | null) => void;
  getCurrentVmAgentUrl: () => string | null;
  setCurrentVmAgentUrl: (url: string | null) => void;
  clearVmConnection: () => void;
}

export async function handleVmList(ctx: VmHandlerContext): Promise<VmListResult> {
  try {
    const { listManagedVms } = await import("../../orchestrator");
    const vms = await listManagedVms();
    const now = Date.now();

    return {
      vms: vms.map(vm => {
        // Calculate duration from createdAt
        const createdAt = vm.metadata?.createdAt || new Date().toISOString();
        const createdAtMs = new Date(createdAt).getTime();
        const durationMs = now - createdAtMs;

        return {
          vmId: vm.vmId,
          parentId: vm.parent || vm.metadata?.parentId || null,
          status: vm.metadata?.status || "ready",
          task: vm.metadata?.task,
          approach: vm.metadata?.approach,
          createdAt,
          durationMs,
          lastActivity: vm.metadata?.lastEventAt || vm.metadata?.lastHealthCheckAt,
          error: vm.metadata?.lastError,
        };
      }),
      currentVmId: ctx.getCurrentVmId() || undefined,
    };
  } catch (err) {
    error("Failed to list VMs", { error: err instanceof Error ? err.message : String(err) });
    return { vms: [] };
  }
}

export async function handleVmCreate(params: VmCreateParams): Promise<VmCreateResult> {
  const { createManagedVm } = await import("../../orchestrator");
  const { getAgentUrl } = await import("../../vm");

  const vm = await createManagedVm({}, params.task);
  const agentUrl = getAgentUrl(vm.vmId);

  info("Created VM", { vmId: vm.vmId, agentUrl });

  return {
    vmId: vm.vmId,
    agentUrl,
  };
}

export async function handleVmBranch(params: VmBranchParams): Promise<VmBranchResult> {
  const { branchVm } = await import("../../orchestrator");
  const { getAgentUrl } = await import("../../vm");

  try {
    const vm = await branchVm(params.vmId, params.task, params.approach);
    const agentUrl = getAgentUrl(vm.vmId);

    info("Branched VM", { vmId: vm.vmId, parentId: params.vmId, agentUrl });

    return {
      vmId: vm.vmId,
      parentId: params.vmId,
      agentUrl,
    };
  } catch (err) {
    error("Failed to branch VM", { parentId: params.vmId, error: err instanceof Error ? err.message : String(err) });
    throw new Error(`Failed to branch VM ${params.vmId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function handleVmDelete(params: VmDeleteParams, ctx: VmHandlerContext): Promise<VmDeleteResult> {
  const { deleteManagedVm } = await import("../../orchestrator");

  try {
    await deleteManagedVm(params.vmId);
    info("Deleted VM", { vmId: params.vmId });

    // Clear current VM if it was deleted
    if (ctx.getCurrentVmId() === params.vmId) {
      ctx.clearVmConnection();
    }

    return { deleted: true };
  } catch (err) {
    error("Failed to delete VM", { vmId: params.vmId, error: err instanceof Error ? err.message : String(err) });
    return { deleted: false };
  }
}

export async function handleVmConnect(params: VmConnectParams, ctx: VmHandlerContext): Promise<VmConnectResult> {
  const { getManagedVm } = await import("../../orchestrator");
  const { getAgentUrl } = await import("../../vm");

  try {
    const vm = await getManagedVm(params.vmId);
    if (!vm) {
      return {
        success: false,
        vmId: params.vmId,
        agentUrl: "",
        error: "VM not found or not connected",
      };
    }

    const agentUrl = getAgentUrl(params.vmId);
    ctx.setCurrentVmId(params.vmId);
    ctx.setCurrentVmAgentUrl(agentUrl);

    info("Connected to VM", { vmId: params.vmId, agentUrl });

    return {
      success: true,
      vmId: params.vmId,
      agentUrl,
    };
  } catch (err) {
    return {
      success: false,
      vmId: params.vmId,
      agentUrl: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function handleVmStatus(ctx: VmHandlerContext): VmStatusResult {
  return {
    currentVmId: ctx.getCurrentVmId() || undefined,
    currentAgentUrl: ctx.getCurrentVmAgentUrl() || undefined,
    isLocal: ctx.getCurrentVmId() === null,
  };
}

/**
 * Get VM context - current VM's place in the DAG (parent, children, siblings)
 * This is used by the shell UI to show navigation links
 */
export async function handleVmContext(): Promise<import("../../protocol/acp-types").VmContextResult> {
  // Get current VM ID from environment (set when running inside a vers VM)
  const currentVmId = process.env.VERS_VM_ID || null;

  if (!currentVmId) {
    // Running locally, not in a VM
    return {
      vmId: null,
      parent: null,
      children: [],
      siblings: [],
    };
  }

  try {
    const { listManagedVms } = await import("../../orchestrator");
    const allVms = await listManagedVms();

    // Find current VM to get its parent
    const currentVm = allVms.find(vm => vm.vmId === currentVmId);
    const parentId = currentVm?.parent || currentVm?.metadata?.parentId || null;

    // Find children (VMs whose parent is current VM)
    const children = allVms
      .filter(vm => vm.parent === currentVmId || vm.metadata?.parentId === currentVmId)
      .map(vm => ({
        vmId: vm.vmId,
        status: vm.metadata?.status || "ready" as const,
        task: vm.metadata?.task,
        approach: vm.metadata?.approach,
      }));

    // Find siblings (other children of same parent, excluding self)
    const siblings = parentId
      ? allVms
          .filter(vm =>
            (vm.parent === parentId || vm.metadata?.parentId === parentId) &&
            vm.vmId !== currentVmId
          )
          .map(vm => ({
            vmId: vm.vmId,
            status: vm.metadata?.status || "ready" as const,
            task: vm.metadata?.task,
            approach: vm.metadata?.approach,
          }))
      : [];

    return {
      vmId: currentVmId,
      parent: parentId,
      children,
      siblings,
    };
  } catch (err) {
    error("Failed to get VM context", { error: err instanceof Error ? err.message : String(err) });
    return {
      vmId: currentVmId,
      parent: null,
      children: [],
      siblings: [],
    };
  }
}

/**
 * Send a prompt to a VM via SSH (localhost HTTP).
 * This bypasses DNS issues by connecting to the agent via localhost.
 */
async function sendPromptViaSsh(vmId: string, prompt: string): Promise<{ success: boolean; error?: string }> {
  const { execute: executeOnVm } = await import("../../vm");
  const { deriveVmToken } = await import("../../utils/token-derivation");

  // Get the VM's derived token for authentication
  const masterKey = process.env.VERS_API_KEY;
  if (!masterKey) {
    return { success: false, error: "No VERS_API_KEY configured" };
  }

  const vmToken = deriveVmToken(masterKey, vmId);

  // Escape the prompt for shell
  const escapedPrompt = prompt.replace(/'/g, "'\"'\"'");

  // First initialize and create session via SSH
  const initCmd = `curl -s -X POST http://localhost:80/rpc \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer ${vmToken}" \\
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"vers-orchestrator","version":"1.0.0"},"capabilities":{}}}'`;

  try {
    const initResult = await executeOnVm(vmId, initCmd);
    if (initResult.exitCode !== 0) {
      return { success: false, error: `Init failed: ${initResult.stderr}` };
    }

    // Create new session
    const sessionCmd = `curl -s -X POST http://localhost:80/rpc \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer ${vmToken}" \\
      -d '{"jsonrpc":"2.0","id":2,"method":"session/new","params":{}}'`;

    const sessionResult = await executeOnVm(vmId, sessionCmd);
    if (sessionResult.exitCode !== 0) {
      return { success: false, error: `Session creation failed: ${sessionResult.stderr}` };
    }

    // Send the prompt
    const promptCmd = `curl -s -X POST http://localhost:80/rpc \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer ${vmToken}" \\
      -d '{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"text":"${escapedPrompt}"}}'`;

    const promptResult = await executeOnVm(vmId, promptCmd);
    if (promptResult.exitCode !== 0) {
      return { success: false, error: `Prompt failed: ${promptResult.stderr}` };
    }

    info(`Prompt sent to VM ${vmId.slice(0, 8)} via SSH`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleVmRun(params: VmRunParams): Promise<VmRunResult> {
  const { listManagedVms, getManagedVm } = await import("../../orchestrator");

  // Get list of VMs to run on
  const allVms = await listManagedVms();
  const targetVmIds = params.vmIds && params.vmIds.length > 0
    ? params.vmIds
    : allVms.map(v => v.vmId);

  info("Dispatching prompt to VMs", { count: targetVmIds.length, prompt: params.prompt.slice(0, 50) });

  const dispatched: string[] = [];

  // Fire prompts to all VMs without waiting for completion
  for (const vmId of targetVmIds) {
    try {
      // First try HTTP client (if DNS works)
      const managed = await getManagedVm(vmId);

      if (managed) {
        // Try HTTP client first
        try {
          await managed.client.initialize("vers-agent");
          const session = await managed.client.newSession();
          managed.sessionId = session.sessionId;
          // Don't await prompt - let it run in background
          managed.client.prompt(params.prompt).catch(err => {
            warn(`HTTP prompt failed on VM ${vmId}, falling back to SSH`, { error: err.message });
            // Fallback to SSH-based prompt
            sendPromptViaSsh(vmId, params.prompt);
          });
          dispatched.push(vmId);
          info(`Dispatched prompt to VM ${vmId.slice(0, 8)} via HTTP`);
        } catch (err) {
          // HTTP failed, try SSH fallback
          warn(`HTTP connection failed for VM ${vmId}, using SSH fallback`, { error: err instanceof Error ? err.message : String(err) });
          sendPromptViaSsh(vmId, params.prompt).then(result => {
            if (!result.success) {
              warn(`SSH prompt also failed for VM ${vmId}`, { error: result.error });
            }
          });
          dispatched.push(vmId);
        }
      } else {
        // No managed VM client, use SSH directly
        warn(`No managed client for VM ${vmId}, using SSH fallback`);
        sendPromptViaSsh(vmId, params.prompt).then(result => {
          if (!result.success) {
            warn(`SSH prompt failed for VM ${vmId}`, { error: result.error });
          }
        });
        dispatched.push(vmId);
      }
    } catch (err) {
      warn(`Failed to dispatch to VM ${vmId}`, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    dispatched: dispatched.length,
    vmIds: dispatched,
  };
}

export async function handleVmExecute(params: VmExecuteParams): Promise<VmExecuteResult> {
  const { execute } = await import("../../vm");

  info("Executing command on VM", { vmId: params.vmId, command: params.command.slice(0, 50) });

  try {
    const result = await execute(params.vmId, params.command);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (err) {
    warn("VM execute failed", { vmId: params.vmId, error: err instanceof Error ? err.message : String(err) });
    return {
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    };
  }
}

export async function handleVmUpload(params: VmUploadParams): Promise<VmUploadResult> {
  const { upload, execute } = await import("../../vm");
  const { statSync } = await import("fs");
  const { randomUUID } = await import("crypto");

  info("Uploading to VM", { vmId: params.vmId, localPath: params.localPath, remotePath: params.remotePath });

  try {
    const stat = statSync(params.localPath);

    if (stat.isDirectory()) {
      // For directories: zip locally, upload, unzip remotely
      const tempZip = `/tmp/vers-upload-${randomUUID()}.tar.gz`;
      const remoteZip = `/tmp/vers-upload-${randomUUID()}.tar.gz`;

      info("Uploading directory via tar", { localPath: params.localPath, tempZip });

      // Create tar.gz locally
      const tarResult = Bun.spawnSync(["tar", "-czf", tempZip, "-C", params.localPath, "."]);
      if (tarResult.exitCode !== 0) {
        throw new Error(`Failed to create tar: ${tarResult.stderr.toString()}`);
      }

      // Upload the tar
      await upload(params.vmId, tempZip, remoteZip);

      // Create target directory and extract on remote
      await execute(params.vmId, `mkdir -p ${params.remotePath} && tar -xzf ${remoteZip} -C ${params.remotePath} && rm ${remoteZip}`);

      // Clean up local temp file
      Bun.spawnSync(["rm", tempZip]);

      return { success: true };
    } else {
      // Single file upload
      await upload(params.vmId, params.localPath, params.remotePath);
      return { success: true };
    }
  } catch (err) {
    warn("VM upload failed", { vmId: params.vmId, error: err instanceof Error ? err.message : String(err) });
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function handleVmEvents(params: VmEventsParams): VmEventsResult {
  const events = getEventsSince(params.afterSeq ?? 0, params.vmIds, params.limit ?? 100);
  const lastEvent = events[events.length - 1];
  const lastSeq = lastEvent ? lastEvent.seq : getLastSeq();

  return {
    events,
    lastSeq,
    connectionStatus: getConnectionStatusObject(),
  };
}

export async function handleVmOutputs(params: VmOutputsParams): Promise<VmOutputsResult> {
  const { getManagedVm } = await import("../../orchestrator");

  const vm = await getManagedVm(params.vmId);
  if (!vm) {
    return {
      vmId: params.vmId,
      outputs: [],
    };
  }

  try {
    // Get session outputs from the VM
    const result = await vm.client.getSessionOutputs({});

    // Transform outputs to simpler format
    const outputs: VmOutputsResult["outputs"] = [];
    for (const output of result.outputs || []) {
      if (output.type === "text") {
        outputs.push({
          type: "assistant",
          content: output.content,
        });
      } else if (output.type === "tool-result" || output.type === "tool_result") {
        outputs.push({
          type: "tool_result",
          content: output.content,
          toolName: output.toolName,
        });
      } else if (output.type === "user") {
        outputs.push({
          type: "user",
          content: output.content,
        });
      }
    }

    return {
      vmId: params.vmId,
      sessionId: vm.sessionId,
      outputs,
    };
  } catch (err) {
    warn("Failed to get VM outputs", { vmId: params.vmId, error: err instanceof Error ? err.message : String(err) });
    return {
      vmId: params.vmId,
      outputs: [],
    };
  }
}

export async function handleVmWait(params: VmWaitParams): Promise<VmWaitResult> {
  const { getManagedVm } = await import("../../orchestrator");
  const timeout = params.timeout ?? 300000; // 5 min default
  const startTime = Date.now();

  const vm = await getManagedVm(params.vmId);
  if (!vm) {
    return {
      vmId: params.vmId,
      status: "failed",
      error: "VM not found",
    };
  }

  return new Promise((resolve) => {
    let resolved = false;
    let timeoutId: Timer | null = null;

    // Subscribe to VM events
    const unsubscribe = subscribeToVmEvents((event) => {
      if (resolved) return;
      if (event.vmId !== params.vmId) return;

      const eventType = event.event.type;

      if (eventType === "completed") {
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        unsubscribe();

        const durationMs = Date.now() - startTime;

        // Get outputs after completion
        handleVmOutputs({ vmId: params.vmId, limit: 10 }).then((outputsResult) => {
          resolve({
            vmId: params.vmId,
            status: "completed",
            durationMs,
            outputs: outputsResult.outputs,
          });
        });
      } else if (eventType === "failed") {
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        unsubscribe();

        const errorData = event.event.data as { error?: string };
        resolve({
          vmId: params.vmId,
          status: "failed",
          durationMs: Date.now() - startTime,
          error: errorData?.error || "Task failed",
        });
      }
    });

    // Set timeout
    timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      unsubscribe();

      resolve({
        vmId: params.vmId,
        status: "timeout",
        durationMs: timeout,
        error: `Timeout after ${timeout}ms`,
      });
    }, timeout);
  });
}

export async function handleVmOutputsAll(params: VmOutputsAllParams): Promise<VmOutputsAllResult> {
  const { listManagedVms, getManagedVm } = await import("../../orchestrator");
  const limit = params.limit ?? 1;

  // Get all VMs with their metadata
  const vmList = await listManagedVms();

  const result: VmOutputsAllResult = { vms: {} };

  // Fetch outputs from each VM in parallel
  await Promise.all(
    vmList.map(async (vm) => {
      const vmId = vm.vmId;
      const metadata = vm.metadata;

      // Try to get outputs from this VM
      let outputs: VmOutputsResult["outputs"] = [];
      let lastMessage: string | undefined;
      let lastMessageType: "assistant" | "tool_result" | "user" | undefined;

      try {
        const managed = await getManagedVm(vmId);
        if (managed) {
          const outputsResult = await handleVmOutputs({ vmId, limit });
          outputs = outputsResult.outputs;

          // Find the last assistant message
          for (let i = outputs.length - 1; i >= 0; i--) {
            const output = outputs[i];
            if (!output) continue;
            if (output.type === "assistant") {
              lastMessage = output.content;
              lastMessageType = "assistant";
              break;
            } else if (output.type === "tool_result" && !lastMessage) {
              lastMessage = output.content.slice(0, 200); // Truncate tool results
              lastMessageType = "tool_result";
            }
          }
        }
      } catch {
        // VM not reachable, still include it with empty outputs
      }

      result.vms[vmId] = {
        vmId,
        status: metadata?.status || "unknown",
        task: metadata?.task,
        lastMessage,
        lastMessageType,
        outputs,
      };
    })
  );

  return result;
}

// Parse test output metrics based on project type
function parseTestMetrics(output: string, _projectType: string): { passed?: number; failed?: number; skipped?: number; total?: number } | undefined {
  // Bun: "560 pass" / "0 fail"
  const bunPassMatch = output.match(/(\d+)\s+pass\b/i);
  const bunFailMatch = output.match(/(\d+)\s+fail\b/i);
  if (bunPassMatch || bunFailMatch) {
    const passed = bunPassMatch?.[1] ? parseInt(bunPassMatch[1], 10) : 0;
    const failed = bunFailMatch?.[1] ? parseInt(bunFailMatch[1], 10) : 0;
    return { passed, failed, total: passed + failed };
  }

  // Jest/Vitest: "Tests: 5 passed, 2 failed"
  const jestMatch = output.match(/Tests:\s*(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i);
  if (jestMatch?.[1]) {
    const passed = parseInt(jestMatch[1], 10);
    const failed = jestMatch[2] ? parseInt(jestMatch[2], 10) : 0;
    return { passed, failed, total: passed + failed };
  }

  // pytest: "5 passed, 2 failed"
  const pytestMatch = output.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i);
  if (pytestMatch?.[1]) {
    const passed = parseInt(pytestMatch[1], 10);
    const failed = pytestMatch[2] ? parseInt(pytestMatch[2], 10) : 0;
    return { passed, failed, total: passed + failed };
  }

  // Go: count "--- PASS:" and "--- FAIL:"
  const goPassed = (output.match(/---\s+PASS:/g) || []).length;
  const goFailed = (output.match(/---\s+FAIL:/g) || []).length;
  if (goPassed > 0 || goFailed > 0) {
    return { passed: goPassed, failed: goFailed, total: goPassed + goFailed };
  }

  // Rust: "test result: ok. 5 passed; 0 failed"
  const cargoMatch = output.match(/test result:.*?(\d+)\s+passed;\s*(\d+)\s+failed/i);
  if (cargoMatch?.[1] && cargoMatch?.[2]) {
    const passed = parseInt(cargoMatch[1], 10);
    const failed = parseInt(cargoMatch[2], 10);
    return { passed, failed, total: passed + failed };
  }

  return undefined;
}

export async function handleVmEval(params: VmEvalParams): Promise<VmEvalResult> {
  const { getManagedVm } = await import("../../orchestrator");
  const { vmId, cwd, commands, skip, timeout } = params;

  const managed = await getManagedVm(vmId);
  if (!managed) {
    throw new Error(`VM not found: ${vmId}`);
  }

  // Run evaluation commands on the VM via SSH
  const evalTimeout = timeout ?? 60000;
  const skipSet = new Set(skip ?? []);

  // First detect project type by checking for common files
  const detectCmd = `
    if [ -f bun.lock ] || [ -f bun.lockb ]; then echo "bun";
    elif [ -f package.json ]; then echo "node";
    elif [ -f Cargo.toml ]; then echo "rust";
    elif [ -f go.mod ]; then echo "go";
    elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then echo "python";
    else echo "unknown"; fi
  `.trim().replace(/\n\s*/g, ' ');

  const workDir = cwd ?? VM_AGENT_DIR;
  const { execute: executeOnVm } = await import("../../vm");

  const detectResult = await executeOnVm(vmId, `cd ${workDir} && ${detectCmd}`);
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

  const cmds = { ...defaultCommands[projectType], ...commands };

  const results: VmEvalResult["results"] = {};
  const scoreBreakdown = { build: 0, test: 0, lint: 0, typecheck: 0 };

  // Helper to run a command on the VM
  async function runCmd(cmd: string): Promise<{ success: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    const start = Date.now();
    try {
      const result = await executeOnVm(vmId, `cd ${workDir} && timeout ${Math.floor(evalTimeout / 1000)} ${cmd}`);
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
  if (cmds.build && !skipSet.has("build")) {
    const buildResult = await runCmd(cmds.build);
    results.build = buildResult;
    scoreBreakdown.build = buildResult.success ? 25 : 0;
  } else {
    scoreBreakdown.build = 25; // No build = assume success
  }

  // Run typecheck
  if (cmds.typecheck && !skipSet.has("typecheck")) {
    const typecheckResult = await runCmd(cmds.typecheck);
    results.typecheck = typecheckResult;
    scoreBreakdown.typecheck = typecheckResult.success ? 15 : 0;
  } else {
    scoreBreakdown.typecheck = 10;
  }

  // Run lint
  if (cmds.lint && !skipSet.has("lint")) {
    const lintResult = await runCmd(cmds.lint);
    results.lint = lintResult;
    scoreBreakdown.lint = lintResult.success ? 20 : 0;
  } else {
    scoreBreakdown.lint = 15;
  }

  // Run tests
  if (cmds.test && !skipSet.has("test")) {
    const testResult = await runCmd(cmds.test);
    const metrics = parseTestMetrics(testResult.stdout + testResult.stderr, projectType);
    results.test = {
      ...testResult,
      metrics,
    };

    if (testResult.success) {
      scoreBreakdown.test = 40;
    } else if (metrics?.total && metrics.passed) {
      // Partial credit based on pass rate
      const passRate = metrics.passed / metrics.total;
      scoreBreakdown.test = Math.round(passRate * 30);
    } else {
      scoreBreakdown.test = 0;
    }
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
