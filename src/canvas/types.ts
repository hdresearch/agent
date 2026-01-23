/**
 * Vers Canvas - Types
 * Data structures for the branch tree visualization
 */

// VM status (matches orchestrator VmStatus)
export type VmStatus =
  | "starting"
  | "ready"
  | "busy"
  | "completed"
  | "failed"
  | "unhealthy"
  | "recovering";

/**
 * A node in the VM branch tree
 */
export interface TreeNode {
  // Identity
  vmId: string;
  shortId: string;         // First 6 chars for display
  baseUrl: string;         // https://{vmId}.vm.vers.sh
  shellUrl: string;        // https://{vmId}.vm.vers.sh/shell
  appUrl: string;          // https://{vmId}.vm.vers.sh/

  // Tree structure
  parentId: string | null;
  children: TreeNode[];
  depth: number;

  // Task info (from VmMetadata)
  task?: string;
  approach?: string;
  status: VmStatus;
  createdAt: string;

  // Live metrics
  durationMs: number;      // Milliseconds since creation
  lastActivity?: string;   // "Writing tests...", "Idle", etc.
  lastEventAt?: string;    // ISO timestamp of last event

  // Results (when completed)
  filesChanged?: number;
  testsPassed?: number;
  testsFailed?: number;
  error?: string;
}

/**
 * The full tree state
 */
export interface TreeState {
  // Tree structure
  roots: TreeNode[];                    // Top-level VMs (no parent)
  nodeMap: Map<string, TreeNode>;       // Quick lookup by vmId

  // Selection
  selectedId: string | null;

  // Metadata
  lastUpdate: string;                   // ISO timestamp

  // Aggregated stats
  totalVms: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
}

/**
 * Event emitted when tree state changes
 */
export interface TreeStateChangeEvent {
  type: "node_added" | "node_updated" | "node_removed" | "full_refresh";
  vmId?: string;
  state: TreeState;
}

/**
 * Subscriber callback for tree state changes
 */
export type TreeStateSubscriber = (event: TreeStateChangeEvent) => void;

/**
 * Status icons for terminal display
 */
export const STATUS_ICONS: Record<VmStatus, string> = {
  starting: "○",
  ready: "●",
  busy: "◐",
  completed: "✓",
  failed: "✗",
  unhealthy: "⚠",
  recovering: "↻",
};

/**
 * Status colors for terminal display (Ink color names)
 */
export const STATUS_COLORS: Record<VmStatus, string> = {
  starting: "yellow",
  ready: "green",
  busy: "cyan",
  completed: "green",
  failed: "red",
  unhealthy: "red",
  recovering: "yellow",
};
