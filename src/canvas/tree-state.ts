/**
 * Vers Canvas - Tree State Manager
 * Manages the VM tree state with real-time updates
 */

import type {
  TreeState,
  TreeNode,
  TreeStateChangeEvent,
  TreeStateSubscriber,
  VmStatus,
} from "./types";
import { buildTree, updateNode, type VmInfo } from "./tree-builder";
import { listManagedVms } from "../orchestrator";
import { subscribeToVmEvents } from "../server/vm-event-aggregator";
import type { VmEventEnvelope } from "../protocol/acp-types";
import { logStream } from "../utils/log-stream";

// ============================================================
// State
// ============================================================

let currentState: TreeState = {
  roots: [],
  nodeMap: new Map(),
  selectedId: null,
  lastUpdate: new Date().toISOString(),
  totalVms: 0,
  runningCount: 0,
  completedCount: 0,
  failedCount: 0,
};

const subscribers = new Set<TreeStateSubscriber>();
let vmEventUnsubscribe: (() => void) | null = null;
let refreshInterval: Timer | null = null;

// ============================================================
// Public API
// ============================================================

/**
 * Get the current tree state
 */
export function getTreeState(): TreeState {
  return currentState;
}

/**
 * Subscribe to tree state changes
 */
export function subscribeToTreeState(callback: TreeStateSubscriber): () => void {
  subscribers.add(callback);

  // Immediately send current state
  callback({
    type: "full_refresh",
    state: currentState,
  });

  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Refresh the tree from the orchestrator
 */
export async function refreshTree(): Promise<TreeState> {
  try {
    const vms = await listManagedVms();

    // Convert to VmInfo format
    const vmInfos: VmInfo[] = vms.map((vm) => ({
      vmId: vm.vmId,
      parent: vm.parent,
      metadata: vm.metadata,
    }));

    currentState = buildTree(vmInfos);

    notifySubscribers({
      type: "full_refresh",
      state: currentState,
    });

    logStream.debug("[canvas] Tree refreshed", {
      totalVms: currentState.totalVms,
      roots: currentState.roots.length,
    });

    return currentState;
  } catch (error) {
    logStream.error("[canvas] Failed to refresh tree", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Select a node in the tree
 */
export function selectNode(vmId: string | null): void {
  if (currentState.selectedId === vmId) return;

  currentState = {
    ...currentState,
    selectedId: vmId,
  };

  notifySubscribers({
    type: "node_updated",
    vmId: vmId || undefined,
    state: currentState,
  });
}

/**
 * Start listening for real-time VM events
 */
export function startListening(): void {
  if (vmEventUnsubscribe) {
    return; // Already listening
  }

  // Subscribe to VM events
  vmEventUnsubscribe = subscribeToVmEvents(handleVmEvent);

  // Periodic refresh to catch any missed updates (every 30s)
  refreshInterval = setInterval(() => {
    refreshTree().catch(() => {});
  }, 30000);

  // Initial refresh
  refreshTree().catch(() => {});

  logStream.info("[canvas] Started listening for VM events");
}

/**
 * Stop listening for real-time VM events
 */
export function stopListening(): void {
  if (vmEventUnsubscribe) {
    vmEventUnsubscribe();
    vmEventUnsubscribe = null;
  }

  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }

  logStream.info("[canvas] Stopped listening for VM events");
}

/**
 * Check if we're currently listening
 */
export function isListening(): boolean {
  return vmEventUnsubscribe !== null;
}

// ============================================================
// Internal
// ============================================================

/**
 * Notify all subscribers of a state change
 */
function notifySubscribers(event: TreeStateChangeEvent): void {
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch (error) {
      logStream.error("[canvas] Subscriber error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Handle a VM event from the aggregator
 */
function handleVmEvent(envelope: VmEventEnvelope): void {
  const { vmId, event } = envelope;

  // Check if this VM is in our tree
  const node = currentState.nodeMap.get(vmId);
  if (!node) {
    // New VM - trigger a full refresh
    logStream.debug("[canvas] Unknown VM event, refreshing tree", { vmId });
    refreshTree().catch(() => {});
    return;
  }

  // Map event to node updates
  const updates = mapEventToNodeUpdates(event);
  if (!updates) return;

  // Update the node
  currentState = updateNode(currentState, vmId, {
    ...updates,
    lastEventAt: envelope.timestamp,
  });

  notifySubscribers({
    type: "node_updated",
    vmId,
    state: currentState,
  });
}

/**
 * Map a VM event to node property updates
 */
function mapEventToNodeUpdates(
  event: VmEventEnvelope["event"]
): Partial<TreeNode> | null {
  // Handle session/update notifications
  if (!event || typeof event !== "object") return null;

  // Cast to unknown first, then to Record for safe property access
  const data = event as unknown as Record<string, unknown>;
  const updateType = data.sessionUpdate || data.type;

  switch (updateType) {
    case "mode_update":
      // Mode changed (e.g., entered plan mode)
      return {
        lastActivity: data.mode === "plan" ? "Planning..." : "Working...",
      };

    case "content_chunk":
      // Text being generated
      return {
        status: "busy" as VmStatus,
        lastActivity: "Generating...",
      };

    case "tool_call":
      // Tool being executed
      const toolName = (data.title || data.toolName || "tool") as string;
      return {
        status: "busy" as VmStatus,
        lastActivity: `Running ${toolName}...`,
      };

    case "completed":
      return {
        status: "completed" as VmStatus,
        lastActivity: "Done",
      };

    case "failed":
      return {
        status: "failed" as VmStatus,
        lastActivity: "Failed",
        error: data.error as string,
      };

    case "cancelled":
      return {
        status: "ready" as VmStatus,
        lastActivity: "Cancelled",
      };

    default:
      return null;
  }
}

// ============================================================
// Utility exports
// ============================================================

export { buildTree, updateNode, flattenTree, findNode, getSiblings } from "./tree-builder";
export type { VmInfo } from "./tree-builder";
