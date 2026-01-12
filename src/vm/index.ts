/**
 * Thin wrapper around vers-sdk-ts
 * No classes, no abstractions, just functions.
 */

import Vers, { withSSH, type VmResourceWithSSH, type ExecuteResult } from "vers";
import type { Vm, VmCreateRootParams } from "vers/resources/vm";

// Initialize client once
const client = new Vers();
const vm: VmResourceWithSSH = withSSH(client.vm);

// Re-export types we need
export type { Vm, ExecuteResult };

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
      mem_size_mib: config.memSizeMib ?? 512,
      vcpu_count: config.vcpuCount ?? 1,
      fs_size_mib: config.fsSizeMib ?? 1024,
    },
  };
  const response = await client.vm.createRoot(params);
  return response.vm_id;
}

/**
 * Fork/branch a VM (cheap operation)
 */
export async function branch(vmId: string): Promise<string> {
  const response = await client.vm.branch(vmId);
  return response.vm_id;
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
  return response.vm_id;
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
