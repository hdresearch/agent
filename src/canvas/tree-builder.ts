/**
 * Vers Canvas - Tree Builder
 * Converts flat VM list into a tree structure
 */

import type { TreeNode, TreeState, VmStatus } from "./types";
import type { VmMetadata } from "../orchestrator";

/**
 * VM info from the orchestrator's listManagedVms()
 */
export interface VmInfo {
  vmId: string;
  parent?: string | null;
  metadata?: VmMetadata;
}

/**
 * Build the base URL for a VM
 */
function getBaseUrl(vmId: string): string {
  return `https://${vmId}.vm.vers.sh`;
}

/**
 * Create a TreeNode from VM info
 */
function createNode(vm: VmInfo, depth: number): TreeNode {
  const baseUrl = getBaseUrl(vm.vmId);
  const now = Date.now();
  const createdAt = vm.metadata?.createdAt || new Date().toISOString();
  const createdTime = new Date(createdAt).getTime();

  return {
    // Identity
    vmId: vm.vmId,
    shortId: vm.vmId.slice(0, 6),
    baseUrl,
    shellUrl: `${baseUrl}/shell`,
    appUrl: `${baseUrl}/`,

    // Tree structure
    parentId: vm.parent || null,
    children: [],
    depth,

    // Task info
    task: vm.metadata?.task,
    approach: vm.metadata?.approach,
    status: (vm.metadata?.status as VmStatus) || "ready",
    createdAt,

    // Live metrics
    durationMs: now - createdTime,
    lastActivity: getActivityText(vm.metadata?.status as VmStatus),
    lastEventAt: vm.metadata?.lastEventAt,

    // Results
    error: vm.metadata?.lastError,
  };
}

/**
 * Get human-readable activity text based on status
 */
function getActivityText(status?: VmStatus): string {
  switch (status) {
    case "starting":
      return "Starting up...";
    case "busy":
      return "Working...";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "unhealthy":
      return "Unhealthy";
    case "recovering":
      return "Recovering...";
    case "ready":
    default:
      return "Idle";
  }
}

/**
 * Build a tree from a flat list of VMs
 */
export function buildTree(vms: VmInfo[]): TreeState {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // First pass: create all nodes
  for (const vm of vms) {
    const node = createNode(vm, 0); // depth will be set in second pass
    nodeMap.set(vm.vmId, node);
  }

  // Second pass: build parent-child relationships and set depth
  for (const vm of vms) {
    const node = nodeMap.get(vm.vmId)!;

    if (vm.parent && nodeMap.has(vm.parent)) {
      const parent = nodeMap.get(vm.parent)!;
      parent.children.push(node);
      node.depth = parent.depth + 1;
    } else {
      roots.push(node);
      node.depth = 0;
    }
  }

  // Third pass: recursively fix depths for deep trees
  function setDepths(node: TreeNode, depth: number): void {
    node.depth = depth;
    for (const child of node.children) {
      setDepths(child, depth + 1);
    }
  }
  for (const root of roots) {
    setDepths(root, 0);
  }

  // Sort children by creation time (oldest first)
  function sortChildren(node: TreeNode): void {
    node.children.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    for (const child of node.children) {
      sortChildren(child);
    }
  }
  for (const root of roots) {
    sortChildren(root);
  }

  // Calculate stats
  let runningCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  for (const node of nodeMap.values()) {
    if (node.status === "busy" || node.status === "starting") {
      runningCount++;
    } else if (node.status === "completed") {
      completedCount++;
    } else if (node.status === "failed" || node.status === "unhealthy") {
      failedCount++;
    }
  }

  return {
    roots,
    nodeMap,
    selectedId: null,
    lastUpdate: new Date().toISOString(),
    totalVms: vms.length,
    runningCount,
    completedCount,
    failedCount,
  };
}

/**
 * Update a single node in the tree (immutable update)
 */
export function updateNode(
  state: TreeState,
  vmId: string,
  updates: Partial<TreeNode>
): TreeState {
  const existingNode = state.nodeMap.get(vmId);
  if (!existingNode) {
    return state;
  }

  // Create updated node
  const updatedNode: TreeNode = {
    ...existingNode,
    ...updates,
  };

  // Create new nodeMap
  const newNodeMap = new Map(state.nodeMap);
  newNodeMap.set(vmId, updatedNode);

  // Update in parent's children array (if has parent)
  let newRoots = state.roots;
  if (updatedNode.parentId) {
    const parent = newNodeMap.get(updatedNode.parentId);
    if (parent) {
      const newParent = {
        ...parent,
        children: parent.children.map((c) =>
          c.vmId === vmId ? updatedNode : c
        ),
      };
      newNodeMap.set(updatedNode.parentId, newParent);
    }
  } else {
    // Update in roots
    newRoots = state.roots.map((r) => (r.vmId === vmId ? updatedNode : r));
  }

  // Recalculate stats
  let runningCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  for (const node of newNodeMap.values()) {
    if (node.status === "busy" || node.status === "starting") {
      runningCount++;
    } else if (node.status === "completed") {
      completedCount++;
    } else if (node.status === "failed" || node.status === "unhealthy") {
      failedCount++;
    }
  }

  return {
    ...state,
    roots: newRoots,
    nodeMap: newNodeMap,
    lastUpdate: new Date().toISOString(),
    runningCount,
    completedCount,
    failedCount,
  };
}

/**
 * Flatten tree to array (for iteration)
 */
export function flattenTree(state: TreeState): TreeNode[] {
  const result: TreeNode[] = [];

  function walk(node: TreeNode): void {
    result.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }

  for (const root of state.roots) {
    walk(root);
  }

  return result;
}

/**
 * Find a node by ID
 */
export function findNode(state: TreeState, vmId: string): TreeNode | undefined {
  return state.nodeMap.get(vmId);
}

/**
 * Get siblings of a node (nodes with same parent)
 */
export function getSiblings(state: TreeState, vmId: string): TreeNode[] {
  const node = state.nodeMap.get(vmId);
  if (!node) return [];

  if (!node.parentId) {
    // Root node - siblings are other roots
    return state.roots.filter((r) => r.vmId !== vmId);
  }

  const parent = state.nodeMap.get(node.parentId);
  if (!parent) return [];

  return parent.children.filter((c) => c.vmId !== vmId);
}

/**
 * Result of getFocusedTree - shows context around current VM
 */
export interface FocusedTree {
  parent: TreeNode | null;
  current: TreeNode;
  children: TreeNode[];
}

/**
 * Get focused tree view: parent + current + direct children only
 * Used by canvas to show just the immediate context around the current VM
 */
export function getFocusedTree(state: TreeState, currentVmId: string): FocusedTree | null {
  const current = state.nodeMap.get(currentVmId);
  if (!current) return null;

  const parent = current.parentId ? state.nodeMap.get(current.parentId) || null : null;

  return {
    parent,
    current,
    children: current.children,
  };
}
