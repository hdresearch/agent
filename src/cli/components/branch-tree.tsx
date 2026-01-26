/**
 * Branch Tree Component
 * Renders the VM tree in terminal with clickable links
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";

/**
 * Terminal hyperlink using OSC 8 escape sequence
 * Works in iTerm2, Windows Terminal, VSCode terminal, etc.
 */
function TerminalLink({ url, children }: { url: string; children: React.ReactNode }) {
  // OSC 8 hyperlink format: \e]8;;URL\e\\TEXT\e]8;;\e\\
  const linkStart = `\x1b]8;;${url}\x1b\\`;
  const linkEnd = `\x1b]8;;\x1b\\`;

  return (
    <Text>
      {linkStart}
      {children}
      {linkEnd}
    </Text>
  );
}
import {
  type TreeState,
  type TreeNode,
  type FocusedTree,
  STATUS_ICONS,
  STATUS_COLORS,
  subscribeToTreeState,
  selectNode,
  refreshTree,
  startListening,
  stopListening,
  getFocusedTree,
} from "../../canvas";

interface BranchTreeProps {
  /** Called when user presses 'q' to quit */
  onClose?: () => void;
  /** Called when user selects a VM for an action */
  onAction?: (action: string, vmId: string) => void;
  /** Show compact view (less detail) */
  compact?: boolean;
  /** VM ID to focus on (shows only parent + this VM + direct children) */
  focusVmId?: string;
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Render a single tree node
 */
function TreeNodeRow({
  node,
  isSelected,
  isLast,
  prefix,
  compact,
}: {
  node: TreeNode;
  isSelected: boolean;
  isLast: boolean;
  prefix: string;
  compact?: boolean;
}) {
  const icon = STATUS_ICONS[node.status];
  const color = STATUS_COLORS[node.status];
  const duration = formatDuration(node.durationMs);

  // Build the tree connector
  const connector = isLast ? "└──" : "├──";
  const childPrefix = prefix + (isLast ? "   " : "│  ");

  // Selection highlight
  const bgColor = isSelected ? "blue" : undefined;

  return (
    <Box flexDirection="column">
      {/* Main node line */}
      <Box>
        <Text>{prefix}</Text>
        <Text>{connector}</Text>
        <Text color={color}>{icon}</Text>
        <Text> </Text>
        <Text backgroundColor={bgColor} bold={isSelected}>
          [{node.shortId}]
        </Text>
        <Text> </Text>
        <Text dimColor>{node.approach || node.task || "VM"}</Text>
        <Text>  </Text>
        <Text color={color}>{node.status}</Text>
        <Text>  </Text>
        <Text dimColor>{duration}</Text>
      </Box>

      {/* Links line */}
      {!compact && (
        <Box>
          <Text>{childPrefix}</Text>
          <TerminalLink url={node.shellUrl}>
            <Text color="cyan">🔗 /shell</Text>
          </TerminalLink>
          <Text>  </Text>
          <TerminalLink url={node.appUrl}>
            <Text color="magenta">🌐 /</Text>
          </TerminalLink>
        </Box>
      )}

      {/* Activity/error line */}
      {!compact && (node.lastActivity || node.error) && (
        <Box>
          <Text>{childPrefix}</Text>
          <Text dimColor>└─ </Text>
          {node.error ? (
            <Text color="red">{node.error}</Text>
          ) : (
            <Text dimColor>{node.lastActivity}</Text>
          )}
        </Box>
      )}

      {/* Render children */}
      {node.children.map((child, idx) => (
        <TreeNodeRow
          key={child.vmId}
          node={child}
          isSelected={false}
          isLast={idx === node.children.length - 1}
          prefix={childPrefix}
          compact={compact}
        />
      ))}
    </Box>
  );
}

/**
 * Render a root node (no connector prefix)
 */
function RootNodeRow({
  node,
  isSelected,
  compact,
}: {
  node: TreeNode;
  isSelected: boolean;
  compact?: boolean;
}) {
  const icon = STATUS_ICONS[node.status];
  const color = STATUS_COLORS[node.status];
  const duration = formatDuration(node.durationMs);

  const bgColor = isSelected ? "blue" : undefined;

  return (
    <Box flexDirection="column">
      {/* Main node line */}
      <Box>
        <Text color={color}>{icon}</Text>
        <Text> </Text>
        <Text backgroundColor={bgColor} bold={isSelected}>
          [{node.shortId}]
        </Text>
        <Text> </Text>
        <Text bold>{node.task || "root"}</Text>
        <Text>  </Text>
        <Text color={color}>{node.status}</Text>
        <Text>  </Text>
        <Text dimColor>{duration}</Text>
      </Box>

      {/* Full URLs for root */}
      {!compact && (
        <Box>
          <Text>│  </Text>
          <TerminalLink url={node.shellUrl}>
            <Text color="cyan">🔗 {node.shellUrl}</Text>
          </TerminalLink>
        </Box>
      )}
      {!compact && (
        <Box>
          <Text>│  </Text>
          <TerminalLink url={node.appUrl}>
            <Text color="magenta">🌐 {node.appUrl}</Text>
          </TerminalLink>
        </Box>
      )}

      {/* Activity/error line */}
      {!compact && (node.lastActivity || node.error) && (
        <Box>
          <Text>│  </Text>
          <Text dimColor>└─ </Text>
          {node.error ? (
            <Text color="red">{node.error}</Text>
          ) : (
            <Text dimColor>{node.lastActivity}</Text>
          )}
        </Box>
      )}

      {/* Render children */}
      {node.children.map((child, idx) => (
        <TreeNodeRow
          key={child.vmId}
          node={child}
          isSelected={false}
          isLast={idx === node.children.length - 1}
          prefix="│  "
          compact={compact}
        />
      ))}
    </Box>
  );
}

/**
 * Get the VM to focus on - either provided, first busy, or first root
 */
function getAutoFocusVmId(state: TreeState): string | null {
  // First, try to find a busy VM
  for (const node of state.nodeMap.values()) {
    if (node.status === "busy" || node.status === "starting") {
      return node.vmId;
    }
  }
  // Fall back to first root
  if (state.roots.length > 0) {
    return state.roots[0].vmId;
  }
  return null;
}

/**
 * Main branch tree component
 * Shows focused view: parent + current VM + direct children
 */
export function BranchTree({ onClose, onAction, compact, focusVmId }: BranchTreeProps) {
  const [state, setState] = useState<TreeState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Subscribe to tree state and start listening for updates
  useEffect(() => {
    const unsubscribe = subscribeToTreeState((event) => {
      setState(event.state);
    });

    // Start listening (enables 30s polling + VM event subscription)
    startListening();

    return () => {
      unsubscribe();
      stopListening();
    };
  }, []);

  // Handle keyboard input
  useInput((input, key) => {
    if (!state) return;

    // Get focused tree for navigation
    const effectiveFocusVmId = focusVmId || getAutoFocusVmId(state);
    const focused = effectiveFocusVmId ? getFocusedTree(state, effectiveFocusVmId) : null;

    // Build flat list from focused nodes only
    const allNodes: TreeNode[] = [];
    if (focused) {
      if (focused.parent) allNodes.push(focused.parent);
      allNodes.push(focused.current);
      allNodes.push(...focused.children);
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(allNodes.length - 1, prev + 1));
    } else if (input === "q" || key.escape) {
      onClose?.();
    } else if (input === "r") {
      refreshTree().catch(() => {});
    } else if (input === "o" && allNodes[selectedIndex]) {
      onAction?.("open", allNodes[selectedIndex].vmId);
    } else if (input === "d" && allNodes[selectedIndex]) {
      onAction?.("diff", allNodes[selectedIndex].vmId);
    } else if (input === "f" && allNodes[selectedIndex]) {
      onAction?.("focus", allNodes[selectedIndex].vmId);
    } else if (input === "k" && allNodes[selectedIndex]) {
      onAction?.("kill", allNodes[selectedIndex].vmId);
    } else if (key.return && allNodes[selectedIndex]) {
      selectNode(allNodes[selectedIndex].vmId);
    }
  });

  if (!state) {
    return (
      <Box>
        <Text dimColor>Loading tree...</Text>
      </Box>
    );
  }

  if (state.totalVms === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>No VMs found.</Text>
        <Text dimColor>Use the orchestrator to create VMs.</Text>
      </Box>
    );
  }

  // Determine focus VM
  const effectiveFocusVmId = focusVmId || getAutoFocusVmId(state);
  const focused = effectiveFocusVmId ? getFocusedTree(state, effectiveFocusVmId) : null;

  // Build flat list for navigation (only focused nodes: parent + current + children)
  const allNodes: TreeNode[] = [];
  if (focused) {
    if (focused.parent) allNodes.push(focused.parent);
    allNodes.push(focused.current);
    allNodes.push(...focused.children);
  }

  const selectedVmId = allNodes[selectedIndex]?.vmId;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Vers Canvas</Text>
        <Text>  </Text>
        <Text dimColor>
          {state.totalVms} VMs • {state.runningCount} running • {state.completedCount} done • {state.failedCount} failed
        </Text>
      </Box>

      {/* Focused Tree View: parent + current + children */}
      {focused ? (
        <Box flexDirection="column">
          {/* Parent (if exists) */}
          {focused.parent && (
            <Box>
              <Text color={STATUS_COLORS[focused.parent.status]}>{STATUS_ICONS[focused.parent.status]}</Text>
              <Text> </Text>
              <Text dimColor>[{focused.parent.shortId}]</Text>
              <Text> </Text>
              <Text dimColor>{focused.parent.task || focused.parent.approach || "parent"}</Text>
              <Text dimColor>  ↑ parent</Text>
            </Box>
          )}

          {/* Current VM (highlighted) */}
          <Box marginLeft={focused.parent ? 2 : 0}>
            <Text>{focused.parent ? "└── " : ""}</Text>
            <Text color={STATUS_COLORS[focused.current.status]}>{STATUS_ICONS[focused.current.status]}</Text>
            <Text> </Text>
            <Text bold backgroundColor={focused.current.vmId === selectedVmId ? "blue" : undefined}>
              [{focused.current.shortId}]
            </Text>
            <Text> </Text>
            <Text bold>{focused.current.task || focused.current.approach || "current"}</Text>
            <Text>  </Text>
            <Text color={STATUS_COLORS[focused.current.status]}>{focused.current.status}</Text>
            <Text>  </Text>
            <Text dimColor>{formatDuration(focused.current.durationMs)}</Text>
          </Box>

          {/* Current VM links */}
          {!compact && (
            <Box marginLeft={focused.parent ? 6 : 4}>
              <TerminalLink url={focused.current.shellUrl}>
                <Text color="cyan">🔗 /shell</Text>
              </TerminalLink>
              <Text>  </Text>
              <TerminalLink url={focused.current.appUrl}>
                <Text color="magenta">🌐 /</Text>
              </TerminalLink>
            </Box>
          )}

          {/* Activity/error for current */}
          {!compact && (focused.current.lastActivity || focused.current.error) && (
            <Box marginLeft={focused.parent ? 6 : 4}>
              {focused.current.error ? (
                <Text color="red">{focused.current.error}</Text>
              ) : (
                <Text dimColor>{focused.current.lastActivity}</Text>
              )}
            </Box>
          )}

          {/* Children */}
          {focused.children.length > 0 && (
            <Box flexDirection="column" marginLeft={focused.parent ? 6 : 4} marginTop={1}>
              <Text dimColor>↓ {focused.children.length} child{focused.children.length !== 1 ? "ren" : ""}</Text>
              {focused.children.map((child, idx) => (
                <Box key={child.vmId}>
                  <Text>{idx === focused.children.length - 1 ? "└── " : "├── "}</Text>
                  <Text color={STATUS_COLORS[child.status]}>{STATUS_ICONS[child.status]}</Text>
                  <Text> </Text>
                  <Text backgroundColor={child.vmId === selectedVmId ? "blue" : undefined}>
                    [{child.shortId}]
                  </Text>
                  <Text> </Text>
                  <Text dimColor>{child.task || child.approach || "child"}</Text>
                  <Text>  </Text>
                  <Text color={STATUS_COLORS[child.status]}>{child.status}</Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      ) : (
        <Box>
          <Text dimColor>No focused VM</Text>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text dimColor>
          [↑↓] Navigate  [O]pen  [D]iff  [F]ocus  [K]ill  [R]efresh  [Q]uit
        </Text>
      </Box>
    </Box>
  );
}

export default BranchTree;
