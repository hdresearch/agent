/**
 * Branch Popup Component
 * Shows a mini tree view when VMs are created/branched
 * Auto-dismisses on Enter or after user interaction
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  type TreeState,
  type FocusedTree,
  STATUS_ICONS,
  STATUS_COLORS,
  refreshTree,
  getFocusedTree,
} from "../../canvas";

interface BranchPopupProps {
  /** The VM that was just created/branched */
  newVmId: string;
  /** Called when user dismisses the popup */
  onClose: () => void;
  /** Called when user wants to open a VM */
  onOpen?: (vmId: string) => void;
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function BranchPopup({ newVmId, onClose, onOpen }: BranchPopupProps) {
  const [tree, setTree] = useState<TreeState | null>(null);
  const [focused, setFocused] = useState<FocusedTree | null>(null);

  // Load tree on mount
  useEffect(() => {
    refreshTree()
      .then((state) => {
        setTree(state);
        const focusedTree = getFocusedTree(state, newVmId);
        setFocused(focusedTree);
      })
      .catch(() => {});
  }, [newVmId]);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.return || key.escape || input === "q") {
      onClose();
    } else if (input === "o" && onOpen) {
      onOpen(newVmId);
      onClose();
    }
  });

  if (!tree || !focused) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="green"
        paddingX={2}
        paddingY={1}
      >
        <Text color="green" bold>New branch created</Text>
        <Text dimColor>Loading tree...</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="green" bold>New branch created</Text>
        <Text>  </Text>
        <Text dimColor>
          {tree.totalVms} VMs total
        </Text>
      </Box>

      {/* Mini tree: parent + current + children */}
      <Box flexDirection="column">
        {/* Parent (if exists) */}
        {focused.parent && (
          <Box>
            <Text color={STATUS_COLORS[focused.parent.status]}>
              {STATUS_ICONS[focused.parent.status]}
            </Text>
            <Text> </Text>
            <Text dimColor>[{focused.parent.shortId}]</Text>
            <Text> </Text>
            <Text dimColor>{focused.parent.task || focused.parent.approach || "parent"}</Text>
          </Box>
        )}

        {/* Current VM (the new one - highlighted) */}
        <Box marginLeft={focused.parent ? 2 : 0}>
          <Text>{focused.parent ? "└── " : ""}</Text>
          <Text color={STATUS_COLORS[focused.current.status]}>
            {STATUS_ICONS[focused.current.status]}
          </Text>
          <Text> </Text>
          <Text bold color="green">[{focused.current.shortId}]</Text>
          <Text> </Text>
          <Text bold>{focused.current.task || focused.current.approach || "new"}</Text>
          <Text>  </Text>
          <Text color={STATUS_COLORS[focused.current.status]}>{focused.current.status}</Text>
          <Text>  </Text>
          <Text dimColor>{formatDuration(focused.current.durationMs)}</Text>
        </Box>

        {/* Children (if any) */}
        {focused.children.length > 0 && (
          <Box flexDirection="column" marginLeft={focused.parent ? 6 : 4}>
            {focused.children.slice(0, 3).map((child, idx) => (
              <Box key={child.vmId}>
                <Text>{idx === Math.min(focused.children.length, 3) - 1 ? "└── " : "├── "}</Text>
                <Text color={STATUS_COLORS[child.status]}>{STATUS_ICONS[child.status]}</Text>
                <Text> </Text>
                <Text dimColor>[{child.shortId}]</Text>
                <Text> </Text>
                <Text dimColor>{child.task || child.approach || "child"}</Text>
              </Box>
            ))}
            {focused.children.length > 3 && (
              <Text dimColor>    ... +{focused.children.length - 3} more</Text>
            )}
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text dimColor>
          [Enter] continue  [O] open  [Q] close
        </Text>
      </Box>
    </Box>
  );
}

export default BranchPopup;
