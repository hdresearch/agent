/**
 * Vers Canvas - Public API
 * Visualization layer for VM branching development
 */

// Types
export type {
  VmStatus,
  TreeNode,
  TreeState,
  TreeStateChangeEvent,
  TreeStateSubscriber,
} from "./types";

export { STATUS_ICONS, STATUS_COLORS } from "./types";

// Tree building utilities
export {
  buildTree,
  updateNode,
  flattenTree,
  findNode,
  getSiblings,
  type VmInfo,
} from "./tree-builder";

// State management
export {
  getTreeState,
  subscribeToTreeState,
  refreshTree,
  selectNode,
  startListening,
  stopListening,
  isListening,
} from "./tree-state";
