import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionRequest, PermissionOption } from "../types";

interface PermissionDialogProps {
  request: PermissionRequest;
  onRespond: (optionId: string) => void;
  onCancel: () => void;
}

// Get a user-friendly label for permission option kind
function getOptionLabel(kind: PermissionOption["kind"]): string {
  switch (kind) {
    case "allow_once":
      return "Allow once";
    case "allow_always":
      return "Allow always";
    case "reject_once":
      return "Deny once";
    case "reject_always":
      return "Deny always";
    default:
      return kind;
  }
}

// Get color for option kind
function getOptionColor(kind: PermissionOption["kind"]): string {
  switch (kind) {
    case "allow_once":
    case "allow_always":
      return "green";
    case "reject_once":
    case "reject_always":
      return "red";
    default:
      return "white";
  }
}

export function PermissionDialog({
  request,
  onRespond,
  onCancel,
}: PermissionDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options = request.options;

  useInput((input, key) => {
    // Arrow navigation
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
      return;
    }

    // Number keys for quick selection (1-9)
    const num = parseInt(input, 10);
    if (num >= 1 && num <= options.length) {
      onRespond(options[num - 1]!.optionId);
      return;
    }

    // Enter to confirm selection
    if (key.return) {
      const selected = options[selectedIndex];
      if (selected) {
        onRespond(selected.optionId);
      }
      return;
    }

    // Escape or Ctrl+C to cancel
    if (key.escape || (key.ctrl && input === "c")) {
      onCancel();
      return;
    }

    // 'y' for allow_once (quick approve)
    if (input === "y" || input === "Y") {
      const allowOption = options.find(
        (opt) => opt.kind === "allow_once" || opt.kind === "allow_always"
      );
      if (allowOption) {
        onRespond(allowOption.optionId);
      }
      return;
    }

    // 'n' for reject_once (quick deny)
    if (input === "n" || input === "N") {
      const rejectOption = options.find(
        (opt) => opt.kind === "reject_once" || opt.kind === "reject_always"
      );
      if (rejectOption) {
        onRespond(rejectOption.optionId);
      }
      return;
    }
  });

  // Truncate tool title if too long
  const toolTitle = request.toolCall.title || "Tool";
  const displayTitle =
    toolTitle.length > 60 ? toolTitle.slice(0, 57) + "..." : toolTitle;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      paddingY={0}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          Permission Required
        </Text>
      </Box>

      {/* Tool being requested */}
      <Box marginBottom={1}>
        <Text>
          <Text color="cyan" bold>
            {displayTitle}
          </Text>
        </Text>
      </Box>

      {/* Show file locations if available */}
      {request.toolCall.locations && request.toolCall.locations.length > 0 && (
        <Box marginBottom={1} flexDirection="column">
          {request.toolCall.locations.slice(0, 3).map((loc, i) => (
            <Text key={i} dimColor>
              {loc.line ? `${loc.path}:${loc.line}` : loc.path}
            </Text>
          ))}
          {request.toolCall.locations.length > 3 && (
            <Text dimColor>
              ...and {request.toolCall.locations.length - 3} more
            </Text>
          )}
        </Box>
      )}

      {/* Options */}
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          const color = getOptionColor(option.kind);
          const label = option.name || getOptionLabel(option.kind);

          return (
            <Box key={option.optionId}>
              <Text color={isSelected ? color : undefined}>
                {isSelected ? "❯ " : "  "}
                <Text bold={isSelected} color={isSelected ? color : undefined}>
                  [{index + 1}] {label}
                </Text>
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓/1-{options.length}: select  Enter: confirm  y: allow  n: deny  Esc:
          cancel
        </Text>
      </Box>
    </Box>
  );
}
