// Popup window component for displaying agent output
// Shows content in a bordered box, dismissable with Escape

import React from "react";
import { Box, Text, useInput } from "ink";

interface PopupWindowProps {
  title: string;
  content: string;
  onClose: () => void;
  width?: number;
  height?: number;
}

export function PopupWindow({
  title,
  content,
  onClose,
  width = 80,
  height = 15, // Smaller default to not squeeze input bar
}: PopupWindowProps): React.ReactElement {
  // Handle Escape key to close
  useInput((input, key) => {
    if (key.escape || input === "q") {
      onClose();
    }
  });

  // Split content into lines and handle scrolling if needed
  const lines = content.split("\n");
  const maxLines = height - 4; // Account for border and title
  const displayLines = lines.slice(-maxLines); // Show last N lines

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      width={width}
      paddingX={1}
    >
      {/* Title bar */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
        <Text dimColor>ESC or q to close</Text>
      </Box>

      {/* Content area */}
      <Box flexDirection="column" height={maxLines}>
        {displayLines.map((line, i) => (
          <Text key={i} wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>

      {/* Scroll indicator if content is truncated */}
      {lines.length > maxLines && (
        <Box marginTop={1}>
          <Text dimColor>
            ... {lines.length - maxLines} more lines above
          </Text>
        </Box>
      )}
    </Box>
  );
}
