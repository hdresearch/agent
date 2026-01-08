import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { ControlledMultilineInput } from "ink-multiline-input";
import { CommandSuggestions, shouldShowCommandSuggestions } from "./command-suggestions";
import { PathSuggestions } from "./path-suggestions";
import { getMatchingCommands, extractPathAtCursor } from "../utils/command-matching";
import { getMatchingPaths } from "../utils/path-completion";
import type { PathMatch } from "../types";
import type { HttpAcpClient } from "../../client/http-client";

interface InputBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onCancel: () => void;
  onExit: () => void;
  disabled: boolean;
  continueMode: boolean;
  tokenMode?: boolean;
  suggestionIndex: number;
  onSuggestionIndexChange: (idx: number) => void;
  client?: HttpAcpClient | null;
  // Remote mode support
  remoteCwd?: string | null;
  // Command history
  history?: string[];
  historyIndex?: number;
  onHistoryNavigate?: (index: number) => void;
}

export function InputBar({
  value,
  onChange,
  onSubmit,
  onCancel,
  onExit,
  disabled,
  continueMode,
  tokenMode = false,
  suggestionIndex,
  onSuggestionIndexChange,
  client,
  remoteCwd,
  history = [],
  historyIndex = -1,
  onHistoryNavigate,
}: InputBarProps) {
  const showCommandSuggestions = shouldShowCommandSuggestions(value);
  const commandMatches = getMatchingCommands(value);
  const lineCount = value.split("\n").length;
  const [cursorIndex, setCursorIndex] = useState(value.length);

  // Refs to track current values for useInput closure (prevents stale closure issues)
  const valueRef = useRef(value);
  const cursorRef = useRef(cursorIndex);

  // Keep refs in sync with state/props
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    cursorRef.current = cursorIndex;
  }, [cursorIndex]);

  // Path completion state
  const [pathMatches, setPathMatches] = useState<PathMatch[]>([]);
  const [pathSuggestionIndex, setPathSuggestionIndex] = useState(0);
  const [currentPathInfo, setCurrentPathInfo] = useState<{ path: string; startIndex: number } | null>(null);

  // Detect @path at cursor and load matches
  useEffect(() => {
    const pathInfo = extractPathAtCursor(value, cursorIndex);
    setCurrentPathInfo(pathInfo);

    if (pathInfo) {
      // Load path matches asynchronously (remote if client provided, local otherwise)
      // Use remoteCwd when in remote mode, otherwise use local cwd
      const cwd = remoteCwd || process.cwd();
      getMatchingPaths(pathInfo.path, cwd, client).then((matches) => {
        setPathMatches(matches);
        if (pathSuggestionIndex >= matches.length) {
          setPathSuggestionIndex(0);
        }
      });
    } else {
      setPathMatches([]);
      setPathSuggestionIndex(0);
    }
  }, [value, cursorIndex, client, remoteCwd]);

  const showPathSuggestions = currentPathInfo !== null && pathMatches.length > 0;

  // Keep cursor in bounds when value changes externally
  useEffect(() => {
    if (cursorIndex > value.length) {
      setCursorIndex(value.length);
    }
  }, [value, cursorIndex]);

  // Reset command suggestion index when matches change
  useEffect(() => {
    if (commandMatches.length === 0) {
      onSuggestionIndexChange(0);
    } else if (suggestionIndex >= commandMatches.length) {
      onSuggestionIndexChange(0);
    }
  }, [commandMatches.length, suggestionIndex, onSuggestionIndexChange]);

  // Handle all keyboard input including emacs shortcuts
  useInput((input, key) => {
    // Tab to autocomplete path suggestion
    if (key.tab && showPathSuggestions && currentPathInfo) {
      const selected = pathMatches[pathSuggestionIndex];
      if (selected) {
        // Replace @partialPath with @completedPath
        const before = value.slice(0, currentPathInfo.startIndex + 1); // includes @
        const after = value.slice(cursorIndex);
        const newValue = before + selected.path + after;
        onChange(newValue);
        setCursorIndex(currentPathInfo.startIndex + 1 + selected.path.length);
      }
      return;
    }

    // Tab to autocomplete command suggestion
    if (key.tab && showCommandSuggestions && commandMatches.length > 0) {
      const selected = commandMatches[suggestionIndex];
      if (selected) {
        onChange("/" + selected.name + " ");
        setCursorIndex(selected.name.length + 2);
      }
      return;
    }

    // Arrow up/down for path suggestions
    if (showPathSuggestions && pathMatches.length > 0) {
      if (key.upArrow) {
        setPathSuggestionIndex(pathSuggestionIndex > 0 ? pathSuggestionIndex - 1 : pathMatches.length - 1);
        return;
      }
      if (key.downArrow) {
        setPathSuggestionIndex(pathSuggestionIndex < pathMatches.length - 1 ? pathSuggestionIndex + 1 : 0);
        return;
      }
    }

    // Arrow up/down for command suggestions
    if (showCommandSuggestions && commandMatches.length > 0) {
      if (key.upArrow) {
        onSuggestionIndexChange(suggestionIndex > 0 ? suggestionIndex - 1 : commandMatches.length - 1);
        return;
      }
      if (key.downArrow) {
        onSuggestionIndexChange(suggestionIndex < commandMatches.length - 1 ? suggestionIndex + 1 : 0);
        return;
      }
    }

    // Newline on Shift+Enter
    if (key.return && key.shift) {
      const newValue = value.slice(0, cursorIndex) + "\n" + value.slice(cursorIndex);
      onChange(newValue);
      setCursorIndex(cursorIndex + 1);
      return;
    }

    // Submit on Enter (without shift) - check disabled to prevent rapid submissions
    if (key.return) {
      if (disabled) return; // Don't submit when processing
      onSubmit(value);
      return;
    }

    // Emacs keybindings
    if (key.ctrl) {
      // Ctrl+C: cancel query, clear input, or exit
      // Note: Ctrl+C comes through as \x03 (ASCII 3), not "c"
      if (input === "\x03" || input === "c") {
        if (disabled) {
          // Query is running - cancel it
          onCancel();
        } else if (value.length > 0) {
          // Has input - clear it
          onChange("");
          setCursorIndex(0);
        } else {
          // No input - exit
          onExit();
        }
        return;
      }
      // Ctrl+A: Beginning of line
      if (input === "a") {
        const lineStart = value.lastIndexOf("\n", cursorIndex - 1) + 1;
        setCursorIndex(lineStart);
        return;
      }
      // Ctrl+E: End of line
      if (input === "e") {
        const lineEnd = value.indexOf("\n", cursorIndex);
        setCursorIndex(lineEnd === -1 ? value.length : lineEnd);
        return;
      }
      // Ctrl+K: Kill to end of line
      if (input === "k") {
        const lineEnd = value.indexOf("\n", cursorIndex);
        const newValue = lineEnd === -1
          ? value.slice(0, cursorIndex)
          : value.slice(0, cursorIndex) + value.slice(lineEnd);
        onChange(newValue);
        return;
      }
      // Ctrl+U: Kill to beginning of line
      if (input === "u") {
        const lineStart = value.lastIndexOf("\n", cursorIndex - 1) + 1;
        const newValue = value.slice(0, lineStart) + value.slice(cursorIndex);
        onChange(newValue);
        setCursorIndex(lineStart);
        return;
      }
      // Ctrl+W: Kill word backward
      if (input === "w") {
        const before = value.slice(0, cursorIndex);
        const trimmed = before.trimEnd();
        const lastSpace = trimmed.lastIndexOf(" ");
        const newPos = lastSpace === -1 ? 0 : lastSpace + 1;
        const newValue = value.slice(0, newPos) + value.slice(cursorIndex);
        onChange(newValue);
        setCursorIndex(newPos);
        return;
      }
    }

    // Arrow key navigation
    if (key.upArrow) {
      const lines = value.split("\n");
      let pos = 0;
      let lineIdx = 0;
      let col = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const lineLen = line.length;
        if (cursorIndex >= pos && cursorIndex <= pos + lineLen) {
          lineIdx = i;
          col = cursorIndex - pos;
          break;
        }
        pos += lineLen + 1;
      }
      // If at first line and history available, navigate history
      if (lineIdx === 0 && history.length > 0 && onHistoryNavigate) {
        const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
        if (newIndex !== historyIndex) {
          onHistoryNavigate(newIndex);
        }
        return;
      }
      // Otherwise navigate within multiline
      if (lineIdx > 0) {
        let newPos = 0;
        for (let i = 0; i < lineIdx - 1; i++) {
          newPos += (lines[i] ?? "").length + 1;
        }
        newPos += Math.min(col, (lines[lineIdx - 1] ?? "").length);
        setCursorIndex(newPos);
      }
      return;
    }

    if (key.downArrow) {
      const lines = value.split("\n");
      let pos = 0;
      let lineIdx = 0;
      let col = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const lineLen = line.length;
        if (cursorIndex >= pos && cursorIndex <= pos + lineLen) {
          lineIdx = i;
          col = cursorIndex - pos;
          break;
        }
        pos += lineLen + 1;
      }
      // If at last line and navigating history, go forward
      if (lineIdx === lines.length - 1 && historyIndex >= 0 && onHistoryNavigate) {
        const newIndex = historyIndex - 1;
        onHistoryNavigate(newIndex);
        return;
      }
      // Otherwise navigate within multiline
      if (lineIdx < lines.length - 1) {
        let newPos = 0;
        for (let i = 0; i <= lineIdx; i++) {
          newPos += (lines[i] ?? "").length + 1;
        }
        newPos += Math.min(col, (lines[lineIdx + 1] ?? "").length);
        setCursorIndex(newPos);
      }
      return;
    }

    if (key.leftArrow) {
      const newCursor = Math.max(0, cursorRef.current - 1);
      cursorRef.current = newCursor;
      setCursorIndex(newCursor);
      return;
    }

    if (key.rightArrow) {
      const newCursor = Math.min(valueRef.current.length, cursorRef.current + 1);
      cursorRef.current = newCursor;
      setCursorIndex(newCursor);
      return;
    }

    // Backspace - use refs to get latest values
    if (key.backspace || key.delete) {
      const currentValue = valueRef.current;
      const currentCursor = cursorRef.current;
      if (currentCursor > 0) {
        const newValue = currentValue.slice(0, currentCursor - 1) + currentValue.slice(currentCursor);
        const newCursor = currentCursor - 1;
        // Update refs immediately for next keystroke
        valueRef.current = newValue;
        cursorRef.current = newCursor;
        onChange(newValue);
        setCursorIndex(newCursor);
      }
      return;
    }

    // Regular character input - use refs to get latest values
    if (input && !key.ctrl && !key.meta && !key.tab) {
      const currentValue = valueRef.current;
      const currentCursor = cursorRef.current;
      const newValue = currentValue.slice(0, currentCursor) + input + currentValue.slice(currentCursor);
      const newCursor = currentCursor + input.length;
      // Update refs immediately for next keystroke
      valueRef.current = newValue;
      cursorRef.current = newCursor;
      onChange(newValue);
      setCursorIndex(newCursor);
    }
  });

  // Determine colors based on mode
  const borderColor = tokenMode ? "yellow" : continueMode ? "blue" : "green";
  const promptColor = tokenMode ? "yellow" : continueMode ? "blue" : "green";
  const promptSymbol = tokenMode ? "🔐 " : continueMode ? "↩ " : "❯ ";
  const placeholder = tokenMode
    ? "Paste your access token..."
    : disabled
    ? "Processing..."
    : "Type a message...";

  return (
    <Box flexDirection="column">
      {!tokenMode && showPathSuggestions && <PathSuggestions matches={pathMatches} selectedIndex={pathSuggestionIndex} />}
      {!tokenMode && showCommandSuggestions && <CommandSuggestions input={value} selectedIndex={suggestionIndex} />}
      <Box
        borderStyle="round"
        borderColor={borderColor}
        flexDirection="column"
        paddingX={1}
      >
        <Box flexDirection="row">
          <Text color={promptColor} bold>
            {promptSymbol}
          </Text>
          <Box flexGrow={1}>
            {value.length === 0 ? (
              <Text dimColor>
                {placeholder}
              </Text>
            ) : (
              <ControlledMultilineInput
                value={value}
                cursorIndex={cursorIndex}
                rows={lineCount}
                maxRows={10}
                showCursor={true}
                focus={true}
              />
            )}
          </Box>
        </Box>
        <Box justifyContent="flex-end">
          <Text dimColor>
            {tokenMode
              ? "Enter: submit token  Ctrl+C: cancel"
              : "Enter: send  Shift+Enter: ⏎  Ctrl+C: clear  ESC: cancel  PgUp/PgDn: scroll"}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
