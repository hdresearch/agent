/**
 * Thin wrapper around vers-sdk-ts
 * No classes, no abstractions, just functions.
 */

import Vers, { withSSH, type VmResourceWithSSH, type ExecuteResult } from "vers";
import type { Vm, VmCreateRootParams } from "vers/resources/vm";

// Re-export VM path constants for convenience
export { VM_HOME_DIR, VM_AGENT_DIR, VM_VERS_AGENT_CONFIG_DIR } from "./constants";

// Initialize client once
const client = new Vers();
const vm: VmResourceWithSSH = withSSH(client.vm);

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
      fs_size_mib: config.fsSizeMib ?? 1024,
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
 * Execute a command on a VM via SSH
 */
export async function execute(
  vmId: string,
  command: string
): Promise<ExecuteResult> {
  return vm.execute(vmId, command);
}

/**
 * Upload a file to a VM
 */
export async function upload(
  vmId: string,
  localPath: string,
  remotePath: string
): Promise<void> {
  await vm.upload(vmId, localPath, remotePath);
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
