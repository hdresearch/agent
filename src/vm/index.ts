/**
 * Thin wrapper around vers-sdk-ts
 * No classes, no abstractions, just functions.
 */

import Vers, { withSSH, type VmResourceWithSSH, type ExecuteResult } from "vers";
import type { Vm, VmCreateRootParams } from "vers/resources/vm";
import { writeFileSync, unlinkSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Re-export VM path constants for convenience
export { VM_HOME_DIR, VM_AGENT_DIR, VM_VERS_AGENT_CONFIG_DIR } from "./constants";

// Initialize client once
const client = new Vers();
const vm: VmResourceWithSSH = withSSH(client.vm);

// Cache for SSH keys (in-memory, per-process)
const sshKeyCache = new Map<string, string>();

// Re-export types we need
export type { Vm, ExecuteResult };

/**
 * Extract vm_id from SDK response.
 * The vers-sdk types claim NewVmResponse is { vm_id: string } but the actual
 * API returns { vms: [{ vm_id: string }] } for branch operations.
 * This helper handles both formats for safety.
 */
function extractVmId(response: { vm_id?: string; vms?: Array<{ vm_id: string }> }): string {
  const vmId = response.vms?.[0]?.vm_id ?? response.vm_id;
  if (!vmId) {
    throw new Error(`Failed to extract vm_id from response: ${JSON.stringify(response)}`);
  }
  return vmId;
}

export interface VmConfig {
  memSizeMib?: number;
  vcpuCount?: number;
  fsSizeMib?: number;
}

/**
 * Create a new root VM
 */
export async function createVm(config: VmConfig = {}): Promise<string> {
  const params: VmCreateRootParams = {
    vm_config: {
      mem_size_mib: config.memSizeMib ?? 2048,
      vcpu_count: config.vcpuCount ?? 2,
      fs_size_mib: config.fsSizeMib ?? 4096, // 4GB disk for Node.js + Claude Code + vers-agent
    },
  };
  const response = await client.vm.createRoot(params);
  return extractVmId(response);
}

/**
 * Fork/branch a VM (cheap operation)
 */
export async function branch(vmId: string): Promise<string> {
  const response = await client.vm.branch(vmId);
  return extractVmId(response);
}

/**
 * Commit/checkpoint a VM (costs money - use sparingly)
 */
export async function commit(vmId: string): Promise<string> {
  const response = await client.vm.commit(vmId);
  return response.commit_id;
}

/**
 * Restore from a checkpoint (creates new VM)
 */
export async function restore(commitId: string): Promise<string> {
  const response = await client.vm.restoreFromCommit({ commit_id: commitId });
  return extractVmId(response);
}

/**
 * Delete a VM
 */
export async function deleteVm(vmId: string): Promise<void> {
  await client.vm.delete(vmId);
}

/**
 * List all VMs (includes parent field for tree structure)
 */
export async function listVms(): Promise<Vm[]> {
  return client.vm.list();
}

/**
 * Get SSH key for a VM (with caching)
 */
async function getSSHKey(vmId: string): Promise<string> {
  let key = sshKeyCache.get(vmId);
  if (!key) {
    const response = await client.vm.getSSHKey(vmId);
    key = response.ssh_private_key;
    sshKeyCache.set(vmId, key);
  }
  return key;
}

/**
 * Execute a command on a VM via system SSH (fallback for ed25519 key support)
 */
async function executeViaSystemSSH(
  vmId: string,
  command: string
): Promise<ExecuteResult> {
  const privateKey = await getSSHKey(vmId);
  const keyFile = join(tmpdir(), `vers-ssh-${randomUUID()}`);

  try {
    // Write key to temp file with secure permissions
    writeFileSync(keyFile, privateKey, { mode: 0o600 });
    chmodSync(keyFile, 0o600);

    const hostname = `${vmId}.vm.vers.sh`;

    // Use system SSH via ProxyCommand for TLS tunnel (port 443)
    // The vers SSH protocol runs SSH over TLS on port 443
    const result = Bun.spawnSync([
      "ssh",
      "-i", keyFile,
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", `ProxyCommand=openssl s_client -quiet -connect %h:443 -servername %h 2>/dev/null`,
      "-o", "LogLevel=ERROR",
      `root@${hostname}`,
      command
    ], {
      timeout: 60000,
    });

    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      exitCode: result.exitCode ?? 1,
    };
  } finally {
    // Clean up temp key file
    try { unlinkSync(keyFile); } catch {}
  }
}

/**
 * Execute a command on a VM via SSH
 * Tries the SDK's ssh2 library first, falls back to system SSH for ed25519 keys
 */
export async function execute(
  vmId: string,
  command: string
): Promise<ExecuteResult> {
  try {
    return await vm.execute(vmId, command);
  } catch (err) {
    // If ssh2 fails with ed25519 error, fall back to system SSH
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ed25519") || message.includes("Cannot parse privateKey")) {
      return executeViaSystemSSH(vmId, command);
    }
    throw err;
  }
}

/**
 * Upload a file to a VM via system SCP (fallback for ed25519 key support)
 */
async function uploadViaSystemSCP(
  vmId: string,
  localPath: string,
  remotePath: string
): Promise<void> {
  const privateKey = await getSSHKey(vmId);
  const keyFile = join(tmpdir(), `vers-ssh-${randomUUID()}`);

  try {
    writeFileSync(keyFile, privateKey, { mode: 0o600 });
    chmodSync(keyFile, 0o600);

    const hostname = `${vmId}.vm.vers.sh`;

    // Use scp with ProxyCommand for TLS tunnel
    const result = Bun.spawnSync([
      "scp",
      "-i", keyFile,
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", `ProxyCommand=openssl s_client -quiet -connect %h:443 -servername %h 2>/dev/null`,
      "-o", "LogLevel=ERROR",
      localPath,
      `root@${hostname}:${remotePath}`
    ], {
      timeout: 120000,
    });

    if (result.exitCode !== 0) {
      throw new Error(`SCP failed: ${result.stderr?.toString()}`);
    }
  } finally {
    try { unlinkSync(keyFile); } catch {}
  }
}

/**
 * Upload a file to a VM
 * Tries the SDK's ssh2 library first, falls back to system SCP for ed25519 keys
 */
export async function upload(
  vmId: string,
  localPath: string,
  remotePath: string
): Promise<void> {
  try {
    await vm.upload(vmId, localPath, remotePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ed25519") || message.includes("Cannot parse privateKey")) {
      await uploadViaSystemSCP(vmId, localPath, remotePath);
      return;
    }
    throw err;
  }
}

/**
 * Pause a VM
 */
export async function pause(vmId: string): Promise<void> {
  await client.vm.updateState(vmId, { state: "Paused" });
}

/**
 * Resume a VM
 */
export async function resume(vmId: string): Promise<void> {
  await client.vm.updateState(vmId, { state: "Running" });
}

/**
 * Get agent endpoint URL for a VM
 * Agent runs on port 80 inside VM, accessed via https://{vmId}.vm.vers.sh (port 443)
 */
export function getAgentUrl(vmId: string): string {
  return `https://${vmId}.vm.vers.sh`;
}
