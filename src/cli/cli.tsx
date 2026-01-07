import React, { useState, useEffect, useCallback, useRef } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { ControlledMultilineInput } from "ink-multiline-input";
import { HttpAcpClient, connectToAcpServer } from "../client/http-client";
import type { SessionNotificationParams, SessionConfig, Attachment } from "../protocol/acp-types";
import { detectKeys, computeKeysHash, formatKeysDisplay } from "../utils/keys";
import { setConfig, getConfig, getMcpServers, addMcpServer, removeMcpServer, type McpServerConfig } from "../utils/config";
import {
  processImagesInPrompt,
  extractImageReferences,
  readImageAsBase64,
  type ProcessedImage,
} from "../utils/image-utils";
import {
  loadHistory,
  saveHistory,
  createHistory,
  addMessage,
  type ConversationHistory,
} from "../utils/history";

// Slash commands
const COMMANDS = [
  { name: "help", alias: "h", description: "Show available commands" },
  { name: "clear", alias: null, description: "Clear the screen" },
  { name: "continue", alias: "c", description: "Continue last conversation" },
  { name: "new", alias: "n", description: "Start new conversation" },
  { name: "compact", alias: null, description: "Compact conversation context" },
  { name: "reload", alias: "r", description: "Re-inject CLAUDE.md/AGENT.md on next message" },
  { name: "docs", alias: "d", description: "Show loaded project docs (CLAUDE.md, AGENT.md)" },
  { name: "model", alias: "m", description: "Change model (sonnet/opus/haiku)" },
  { name: "thinking", alias: "t", description: "Toggle thinking mode (on/off [budget])" },
  { name: "keys", alias: "k", description: "Show/sync API keys with server" },
  { name: "mcp", alias: null, description: "Manage MCP servers (list/add/remove)" },
  { name: "plan", alias: "p", description: "Toggle plan mode (or: on/off/show/clear)" },
] as const;

// Unique ID counter
let idCounter = 0;
const uniqueId = () => `line-${++idCounter}`;

// Tool icons
const TOOL_ICONS: Record<string, string> = {
  Read: "📄",
  Write: "✏️",
  Edit: "🔧",
  Bash: "💻",
  Glob: "🔍",
  Grep: "🔎",
  WebFetch: "🌐",
  WebSearch: "🔍",
  Task: "📋",
  TodoWrite: "✅",
};

type OutputLine = {
  id: string;
  type: "user" | "text" | "tool" | "tool-result" | "system" | "error" | "stats";
  content: string;
  color?: string;
  toolName?: string;
};

type AppState = {
  status: "idle" | "thinking" | "running-tool";
  currentTool?: string;
};

function formatToolArgs(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash": {
      const cmd = (input.command as string) || "";
      const preview = cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
      return preview;
    }
    case "Read":
      return String(input.file_path || "");
    case "Write":
      return String(input.file_path || "");
    case "Edit": {
      const oldStr = (input.old_string as string) || "";
      const newStr = (input.new_string as string) || "";
      return `${input.file_path} (-${oldStr.split("\n").length}/+${newStr.split("\n").length} lines)`;
    }
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return `/${input.pattern}/`;
    case "WebFetch":
      return String(input.url || "");
    case "WebSearch":
      return String(input.query || "");
    default: {
      // Show first string value from input
      const firstVal = Object.values(input).find(v => typeof v === "string");
      return firstVal ? String(firstVal).slice(0, 40) : "";
    }
  }
}

function Spinner({ text }: { text: string }) {
  const [frame, setFrame] = useState(0);
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f: number) => (f + 1) % frames.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text color="cyan">
      {frames[frame]} {text}
    </Text>
  );
}

function OutputArea({ lines, maxLines = 20 }: { lines: OutputLine[]; maxLines?: number }) {
  const visibleLines = lines.slice(-maxLines);

  return (
    <Box flexDirection="column" paddingX={1}>
      {visibleLines.map((line) => {
        switch (line.type) {
          case "user":
            return (
              <Box key={line.id} flexDirection="column" marginTop={1}>
                <Text color="cyan" bold>❯ {line.content}</Text>
              </Box>
            );
          case "text":
            // Indent multi-line text content
            const textLines = line.content.split("\n");
            return (
              <Box key={line.id} flexDirection="column" marginTop={1}>
                <Text color="magenta" bold>⏺ </Text>
                {textLines.map((textLine, idx) => (
                  <Text key={idx}>{"  "}{textLine}</Text>
                ))}
              </Box>
            );
          case "tool":
            return (
              <Box key={line.id} flexDirection="row" marginTop={1}>
                <Text color="magenta" bold>⏺ </Text>
                <Text color="cyan" bold>{line.toolName || "Tool"}</Text>
                <Text dimColor>(</Text>
                <Text>{line.content}</Text>
                <Text dimColor>)</Text>
              </Box>
            );
          case "tool-result":
            return (
              <Box key={line.id} marginLeft={2}>
                <Text dimColor>⎿ </Text>
                <Text dimColor>{line.content || "(Done)"}</Text>
              </Box>
            );
          case "system":
            return (
              <Box key={line.id} marginTop={1}>
                <Text dimColor>{line.content}</Text>
              </Box>
            );
          case "error":
            return (
              <Box key={line.id} marginTop={1}>
                <Text color="red" bold>⏺ </Text>
                <Text color="red">{line.content}</Text>
              </Box>
            );
          case "stats":
            return (
              <Box key={line.id} marginTop={1}>
                <Text dimColor>  ✓ {line.content}</Text>
              </Box>
            );
          default:
            return <Text key={line.id}>{line.content}</Text>;
        }
      })}
    </Box>
  );
}

// Get matching commands for input
function getMatchingCommands(input: string) {
  if (!input.startsWith("/") || input.length < 2) return [];

  const search = input.slice(1).toLowerCase();
  const matches = COMMANDS.filter(
    (cmd) =>
      cmd.name.startsWith(search) || (cmd.alias?.startsWith(search) ?? false)
  );

  // Don't show if exact match
  if (matches.length === 1 && matches[0]?.name === search) {
    return [];
  }

  return matches.slice(0, 4);
}

function CommandSuggestions({
  input,
  selectedIndex,
}: {
  input: string;
  selectedIndex: number;
}) {
  const matches = getMatchingCommands(input);

  if (matches.length === 0) return null;

  return (
    <Box flexDirection="row" gap={2} marginLeft={2}>
      {matches.map((cmd, idx) => (
        <Text
          key={cmd.name}
          dimColor={idx !== selectedIndex}
          color={idx === selectedIndex ? "cyan" : undefined}
          inverse={idx === selectedIndex}
        >
          {" "}
          /{cmd.name}
          {cmd.alias && <Text color="gray"> ({cmd.alias})</Text>}{" "}
        </Text>
      ))}
      <Text dimColor> (Tab to complete, ↑↓ to select)</Text>
    </Box>
  );
}

// Path autocompletion for @path references
interface PathMatch {
  name: string;
  path: string;
  isDirectory: boolean;
}

// Extract the @path being typed at cursor position
function extractPathAtCursor(input: string, cursorIndex: number): { path: string; startIndex: number } | null {
  // Look backwards from cursor to find @
  let atIndex = -1;
  for (let i = cursorIndex - 1; i >= 0; i--) {
    const ch = input[i];
    if (ch === "@") {
      atIndex = i;
      break;
    }
    // Stop if we hit whitespace or certain punctuation
    if (ch === " " || ch === "\n" || ch === "\t") {
      break;
    }
  }

  if (atIndex === -1) return null;

  // Extract the path from @ to cursor
  const path = input.slice(atIndex + 1, cursorIndex);
  return { path, startIndex: atIndex };
}

// List files matching a partial path (supports local or remote via client)
async function getMatchingPaths(
  partialPath: string,
  cwd: string,
  client?: HttpAcpClient | null
): Promise<PathMatch[]> {
  const { join, dirname, basename, resolve } = await import("path");

  try {
    // Determine directory to list and prefix to match
    let dirToList: string;
    let prefix: string;

    if (partialPath === "" || partialPath === ".") {
      dirToList = cwd;
      prefix = "";
    } else if (partialPath === "./") {
      dirToList = cwd;
      prefix = "";
    } else if (partialPath.endsWith("/")) {
      dirToList = resolve(cwd, partialPath);
      prefix = "";
    } else {
      dirToList = resolve(cwd, dirname(partialPath));
      prefix = basename(partialPath).toLowerCase();
    }

    // Get directory entries - either remotely or locally
    let entries: Array<{ name: string; type: "file" | "directory" }>;

    if (client) {
      // Remote listing via ACP client
      const result = await client.listDirectory(dirToList);
      if (result.error) {
        return [];
      }
      entries = result.entries;
    } else {
      // Local listing
      const { readdirSync } = await import("fs");
      const dirEntries = readdirSync(dirToList, { withFileTypes: true });
      entries = dirEntries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" as const : "file" as const,
      }));
    }

    const matches: PathMatch[] = [];

    for (const entry of entries) {
      // Skip hidden files unless prefix starts with .
      if (entry.name.startsWith(".") && !prefix.startsWith(".")) {
        continue;
      }

      if (entry.name.toLowerCase().startsWith(prefix)) {
        const isDir = entry.type === "directory";
        // Build the completion path
        let completionPath: string;
        if (partialPath === "" || partialPath === ".") {
          completionPath = entry.name;
        } else if (partialPath === "./") {
          completionPath = "./" + entry.name;
        } else if (partialPath.endsWith("/")) {
          completionPath = partialPath + entry.name;
        } else {
          const dir = dirname(partialPath);
          completionPath = dir === "." ? entry.name : join(dir, entry.name);
        }

        matches.push({
          name: entry.name,
          path: completionPath + (isDir ? "/" : ""),
          isDirectory: isDir,
        });
      }
    }

    // Sort: directories first, then alphabetically
    matches.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return matches.slice(0, 6);
  } catch {
    return [];
  }
}

function PathSuggestions({
  matches,
  selectedIndex,
}: {
  matches: PathMatch[];
  selectedIndex: number;
}) {
  if (matches.length === 0) return null;

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>Files:</Text>
        <Text dimColor>(Tab to complete, ↑↓ to select)</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {matches.map((match, idx) => (
          <Text
            key={match.path}
            dimColor={idx !== selectedIndex}
            color={idx === selectedIndex ? "cyan" : undefined}
            inverse={idx === selectedIndex}
          >
            {match.isDirectory ? "📁 " : "📄 "}
            {match.path}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

// Context window limits by model
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  sonnet: 200000,
  opus: 200000,
  haiku: 200000,
};

// Format token count with K/M suffix
function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

// Top status bar showing model, thinking, cost, session info
function TopStatusBar({
  model,
  thinking,
  cost,
  continueMode,
  connected,
  planMode,
}: {
  model: string;
  thinking: { enabled: boolean; budget?: number | null };
  cost: { totalCost: number; inputTokens: number; outputTokens: number };
  continueMode: boolean;
  connected: boolean;
  planMode: boolean;
}) {
  const contextLimit = MODEL_CONTEXT_LIMITS[model] || 200000;
  const contextUsed = cost.inputTokens; // Input tokens represent context usage
  const contextPercent = Math.min(100, (contextUsed / contextLimit) * 100);

  // Color based on usage
  let contextColor: string = "green";
  if (contextPercent > 80) contextColor = "red";
  else if (contextPercent > 60) contextColor = "yellow";

  // Visual bar (5 chars wide)
  const barFilled = Math.round(contextPercent / 20);
  const bar = "█".repeat(barFilled) + "░".repeat(5 - barFilled);

  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginBottom={1}
    >
      <Box flexGrow={1} gap={1}>
        <Text color="cyan" bold>vers-agent</Text>
        <Text dimColor>│</Text>
        <Text color="magenta">{model}</Text>
        <Text dimColor>│</Text>
        <Text color={thinking.enabled ? "yellow" : "gray"}>
          {thinking.enabled ? `🧠 ${(thinking.budget || 10000).toLocaleString()}` : "🧠 off"}
        </Text>
        {planMode && (
          <>
            <Text dimColor>│</Text>
            <Text color="cyan" bold>📋 PLAN</Text>
          </>
        )}
        <Text dimColor>│</Text>
        <Text color="green">${cost.totalCost.toFixed(4)}</Text>
        <Text dimColor>│</Text>
        <Text color={contextColor}>
          {bar} {formatTokens(contextUsed)}/{formatTokens(contextLimit)}
        </Text>
        <Text dimColor>({formatTokens(cost.outputTokens)} out)</Text>
        {continueMode && (
          <>
            <Text dimColor>│</Text>
            <Text color="blue">↩ resume</Text>
          </>
        )}
        {!connected && (
          <>
            <Text dimColor>│</Text>
            <Text color="red">disconnected</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

function InputBar({
  value,
  onChange,
  onSubmit,
  onCancel,
  onExit,
  disabled,
  continueMode,
  suggestionIndex,
  onSuggestionIndexChange,
  client,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onCancel: () => void;
  onExit: () => void;
  disabled: boolean;
  continueMode: boolean;
  suggestionIndex: number;
  onSuggestionIndexChange: (idx: number) => void;
  client?: HttpAcpClient | null;
}) {
  const showCommandSuggestions = value.startsWith("/") && value.length >= 2;
  const commandMatches = getMatchingCommands(value);
  const lineCount = value.split("\n").length;
  const [cursorIndex, setCursorIndex] = useState(value.length);

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
      getMatchingPaths(pathInfo.path, process.cwd(), client).then((matches) => {
        setPathMatches(matches);
        if (pathSuggestionIndex >= matches.length) {
          setPathSuggestionIndex(0);
        }
      });
    } else {
      setPathMatches([]);
      setPathSuggestionIndex(0);
    }
  }, [value, cursorIndex, client]);

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

    // Submit on Enter (without shift)
    if (key.return) {
      onSubmit(value);
      return;
    }

    // Emacs keybindings
    if (key.ctrl) {
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
      // Ctrl+C: cancel query, clear input, or exit
      if (input === "c") {
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
      setCursorIndex(Math.max(0, cursorIndex - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorIndex(Math.min(value.length, cursorIndex + 1));
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorIndex > 0) {
        const newValue = value.slice(0, cursorIndex - 1) + value.slice(cursorIndex);
        onChange(newValue);
        setCursorIndex(cursorIndex - 1);
      }
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta && !key.tab) {
      const newValue = value.slice(0, cursorIndex) + input + value.slice(cursorIndex);
      onChange(newValue);
      setCursorIndex(cursorIndex + input.length);
    }
  });

  return (
    <Box flexDirection="column">
      {showPathSuggestions && <PathSuggestions matches={pathMatches} selectedIndex={pathSuggestionIndex} />}
      {showCommandSuggestions && <CommandSuggestions input={value} selectedIndex={suggestionIndex} />}
      <Box
        borderStyle="round"
        borderColor={continueMode ? "blue" : "green"}
        flexDirection="column"
        paddingX={1}
      >
        <Box flexDirection="row">
          <Text color={continueMode ? "blue" : "green"} bold>
            {continueMode ? "↩ " : "❯ "}
          </Text>
          <Box flexGrow={1}>
            {value.length === 0 ? (
              <Text dimColor>
                {disabled ? "Processing..." : "Type a message..."}
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
            Enter: send  Shift+Enter: ⏎  Ctrl+C: clear  ESC: cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function StatusBar({ state }: { state: AppState }) {
  if (state.status === "idle") {
    return null;
  }

  return (
    <Box paddingX={2}>
      {state.status === "thinking" && <Spinner text="Thinking..." />}
      {state.status === "running-tool" && (
        <Spinner text={`Running ${state.currentTool}...`} />
      )}
    </Box>
  );
}

function App({ initialContinue, serverUrl }: { initialContinue: boolean; serverUrl?: string }) {
  const { exit } = useApp();
  const [input, setInputRaw] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [queuedInput, setQueuedInput] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [state, setState] = useState<AppState>({ status: "idle" });
  const [continueMode, setContinueMode] = useState(initialContinue);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<HttpAcpClient | null>(null);
  const historyRef = useRef<ConversationHistory | null>(null);

  // Pending image attachments - shown above input bar like Claude Code
  const [pendingAttachments, setPendingAttachments] = useState<ProcessedImage[]>([]);
  const imageIdCounter = useRef(0);
  const getNextImageId = () => ++imageIdCounter.current;

  // Image cache - stores images read immediately when paths are detected
  // Key: normalized path, Value: ProcessedImage
  const imageCacheRef = useRef<Map<string, ProcessedImage>>(new Map());
  const processedPathsRef = useRef<Set<string>>(new Set());

  // Wrapper around setInput that detects image paths and converts them to attachments
  const setInput = useCallback((newValue: string) => {
    // Check for image paths and read them SYNCHRONOUSLY (before macOS deletes screenshot temp files)
    const refs = extractImageReferences(newValue);
    let modifiedInput = newValue;
    const newAttachments: ProcessedImage[] = [];

    for (const ref of refs) {
      // Skip if we've already processed this path in this session
      if (processedPathsRef.current.has(ref.path)) continue;
      processedPathsRef.current.add(ref.path);

      // Try to read SYNCHRONOUSLY - check multiple locations
      try {
        const fs = require("fs");
        const pathModule = require("path");
        const cwd = process.cwd();

        // Build list of paths to try
        const pathsToTry: string[] = [];

        // 1. Absolute path as-is
        if (pathModule.isAbsolute(ref.path)) {
          pathsToTry.push(ref.path);
        } else {
          // 2. Relative to CWD
          pathsToTry.push(pathModule.resolve(cwd, ref.path));
        }

        // 3. For NSIRD/screenshot paths, try TMPDIR and TemporaryItems
        if (ref.path.toLowerCase().includes("screencaptureui")) {
          const tmpDir = process.env.TMPDIR || "/tmp";
          const temporaryItemsDir = pathModule.join(tmpDir, "TemporaryItems");
          const nsirdMatch = ref.path.match(/((?:NSIRD_)?screencaptureui[^\/]*\/[^\/]+\.png)/i);
          if (nsirdMatch) {
            pathsToTry.push(pathModule.join(tmpDir, nsirdMatch[1]));
            pathsToTry.push(pathModule.join(temporaryItemsDir, nsirdMatch[1]));
            pathsToTry.push(pathModule.join(temporaryItemsDir, "NSIRD_" + nsirdMatch[1]));
          }
        }

        // Try each path synchronously
        let imageFound = false;
        for (const tryPath of pathsToTry) {
          try {
            if (fs.existsSync(tryPath)) {
              const buffer = fs.readFileSync(tryPath);
              const base64 = buffer.toString("base64");
              if (base64.length > 0) {
                const ext = pathModule.extname(tryPath).toLowerCase();
                const mediaType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
                                  ext === ".gif" ? "image/gif" :
                                  ext === ".webp" ? "image/webp" : "image/png";

                const imageId = getNextImageId();
                const processedImage: ProcessedImage = {
                  id: imageId,
                  path: tryPath,
                  mediaType: mediaType as any,
                  base64,
                };
                newAttachments.push(processedImage);

                // Remove the path from input text
                modifiedInput = modifiedInput.replace(ref.original, "").trim();

                // Log success
                try {
                  fs.appendFileSync("/tmp/vers-image-debug.log",
                    `${new Date().toISOString()} ATTACHED: [Image #${imageId}] from ${tryPath} (${base64.length} bytes)\n`);
                } catch {}
                imageFound = true;
                break;
              }
            }
          } catch {
            // Try next path
          }
        }

        // If no file found, try clipboard as fallback for screenshot paths
        if (!imageFound && ref.path.toLowerCase().includes("screencaptureui")) {
          // Mark as needing async clipboard check - will show error on submit if not found
          try {
            const fs = require("fs");
            fs.appendFileSync("/tmp/vers-image-debug.log",
              `${new Date().toISOString()} Screenshot file not found, will try clipboard on submit\n`);
          } catch {}
        }
      } catch {
        // Ignore sync read errors
      }
    }

    // Update pending attachments
    if (newAttachments.length > 0) {
      setPendingAttachments(prev => [...prev, ...newAttachments]);
    }

    // Set the modified input (with image paths removed)
    setInputRaw(modifiedInput);
  }, []);

  // Load persisted config
  const persistedConfig = getConfig();
  const sessionConfigRef = useRef<SessionConfig>({
    model: persistedConfig.model,
    thinkingBudget: persistedConfig.thinkingBudget,
  });

  // Status bar state - initialized from persisted config
  const [statusInfo, setStatusInfo] = useState({
    model: persistedConfig.model,
    thinking: {
      enabled: persistedConfig.thinkingBudget !== null,
      budget: persistedConfig.thinkingBudget,
    },
    cost: { totalCost: 0, inputTokens: 0, outputTokens: 0 },
    planMode: false,
  });

  const addOutput = useCallback((line: Omit<OutputLine, "id">) => {
    setOutput((prev) => [...prev, { ...line, id: uniqueId() }]);
  }, []);

  // Load conversation history on startup if continue mode
  useEffect(() => {
    if (initialContinue) {
      loadHistory().then((history) => {
        if (history && history.messages.length > 0) {
          historyRef.current = history;
          // Replay messages to output
          const lines: OutputLine[] = [];
          for (const msg of history.messages) {
            if (msg.role === "user") {
              lines.push({ id: uniqueId(), type: "system", content: `❯ ${msg.content}`, color: "cyan" });
            } else if (msg.role === "assistant") {
              lines.push({ id: uniqueId(), type: "text", content: msg.content });
            } else if (msg.role === "tool" && msg.toolName) {
              lines.push({ id: uniqueId(), type: "tool", content: `${msg.toolName}: ${msg.content}` });
            }
          }
          setOutput(lines);
        } else {
          // No history, create new
          historyRef.current = createHistory(persistedConfig.lastSessionId || "new");
        }
      });
    } else {
      // Fresh session
      historyRef.current = createHistory("new");
    }
  }, [initialContinue, persistedConfig.lastSessionId]);

  // Initialize ACP client
  useEffect(() => {
    const url = serverUrl || `http://localhost:${process.env.PORT || 9999}`;

    connectToAcpServer(url)
      .then(async (client) => {
        clientRef.current = client;

        // Set up notification handler
        client.onNotification((params: SessionNotificationParams) => {
          const { type, data } = params;

          switch (type) {
            case "mode_update":
              // Mode changed (default/plan)
              if ("mode" in data) {
                const mode = data.mode as string;
                setStatusInfo(prev => ({ ...prev, planMode: mode === "plan" }));
                if (mode === "plan") {
                  addOutput({ type: "system", content: "📋 Entered plan mode" });
                } else if (mode === "default") {
                  addOutput({ type: "system", content: "▶️ Exited plan mode" });
                }
              }
              // Also trigger thinking state
              setState({ status: "thinking" });
              break;

            case "content_chunk":
              // Text content from agent
              if ("text" in data && data.text) {
                const text = data.text as string;
                addOutput({ type: "text", content: text });
                // Save to history
                if (historyRef.current) {
                  addMessage(historyRef.current, "assistant", text);
                  saveHistory(historyRef.current);
                }
              }
              setState({ status: "thinking" });
              break;

            case "tool_call":
              if ("toolName" in data) {
                const toolName = data.toolName as string;
                const toolArgs = formatToolArgs(toolName, (data.input || {}) as Record<string, unknown>);
                addOutput({ type: "tool", content: toolArgs, toolName });
                // Save to history
                if (historyRef.current) {
                  addMessage(historyRef.current, "tool", toolArgs, toolName);
                  saveHistory(historyRef.current);
                }
                setState({ status: "running-tool", currentTool: toolName });
              }
              break;

            case "tool_result":
              addOutput({ type: "tool-result", content: "" });
              setState({ status: "thinking" });
              break;

            case "completed":
              // Update cost stats from completed event
              if ("totalCostUsd" in data && "inputTokens" in data && "outputTokens" in data) {
                setStatusInfo((prev) => ({
                  ...prev,
                  cost: {
                    totalCost: prev.cost.totalCost + (data.totalCostUsd as number),
                    inputTokens: prev.cost.inputTokens + (data.inputTokens as number),
                    outputTokens: prev.cost.outputTokens + (data.outputTokens as number),
                  },
                }));

                // Show stats in output
                const cost = data.totalCostUsd as number;
                const input = data.inputTokens as number;
                const output = data.outputTokens as number;
                addOutput({
                  type: "stats",
                  content: `$${cost.toFixed(4)} · ${formatTokens(input)} in · ${formatTokens(output)} out`,
                });
              }
              setState({ status: "idle" });
              break;

            case "failed":
              if ("error" in data) {
                addOutput({ type: "error", content: `Error: ${data.error}` });
              }
              setState({ status: "idle" });
              break;

            case "cancelled":
              setState({ status: "idle" });
              break;

            case "plan_update":
              // Plan entries updated
              if ("entries" in data && Array.isArray(data.entries)) {
                const entries = data.entries as Array<{ id: string; description: string; status: string }>;
                if (entries.length > 0) {
                  addOutput({ type: "system", content: `📋 Plan updated (${entries.length} entries):` });
                  for (const entry of entries.slice(0, 5)) { // Show first 5
                    const statusIcon = entry.status === "completed" ? "✓" :
                                      entry.status === "in_progress" ? "⏳" :
                                      entry.status === "failed" ? "✗" : "○";
                    addOutput({ type: "system", content: `  ${statusIcon} ${entry.description}` });
                  }
                  if (entries.length > 5) {
                    addOutput({ type: "system", content: `  ... and ${entries.length - 5} more` });
                  }
                }
              }
              break;
          }
        });

        // Initialize connection
        await client.initialize();
        setConnected(true);

        // Detect and send API keys
        const localKeys = detectKeys();
        if (localKeys.length > 0) {
          const keysMap = Object.fromEntries(localKeys.map(k => [k.name, k.value]));
          await client.authenticate(keysMap);
        }

        // Create or load session
        if (continueMode) {
          // Try to load previous session (for now just create new)
          await client.newSession(sessionConfigRef.current);
          addOutput({
            type: "system",
            content: "↩ Ready to continue (session state managed by Claude Code)",
          });
        } else {
          await client.newSession(sessionConfigRef.current);
        }
      })
      .catch((err) => {
        addOutput({
          type: "error",
          content: `Failed to connect to server: ${err.message}`,
        });
      });

    return () => {
      clientRef.current?.close();
    };
  }, [serverUrl, continueMode, addOutput]);

  // Process message with pre-processed images (called from handleSubmit)
  const processMessageWithAttachments = useCallback(
    async (message: string, images: Array<{ id: number; path: string; mediaType: string; base64: string }>) => {
      if (!clientRef.current || !connected) {
        addOutput({ type: "error", content: "Not connected to server" });
        return;
      }

      // Convert images to attachments
      const attachments: Attachment[] = images.map((img) => ({
        type: "image" as const,
        content: img.base64,
        mimeType: img.mediaType,
      }));

      // Save user message to history
      if (historyRef.current) {
        addMessage(historyRef.current, "user", message);
        saveHistory(historyRef.current);
      }

      setState({ status: "thinking" });

      try {
        await clientRef.current.prompt(message, attachments.length > 0 ? attachments : undefined);
        // Events will stream via notifications
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        addOutput({ type: "error", content: `Error: ${errorMsg}` });
        setState({ status: "idle" });
      }

      // Process queued input if any
      if (queuedInput && state.status === "idle") {
        const next = queuedInput;
        setQueuedInput(null);
        // Queue will be processed by handleSubmit which will do image processing
        addOutput({ type: "user", content: next });
        processImagesInPrompt(next, process.cwd()).then(({ textPrompt, images: imgs, errors }) => {
          if (imgs.length > 0) {
            addOutput({ type: "system", content: `📎 Attached ${imgs.length} image(s)` });
          }
          for (const err of errors) {
            addOutput({ type: "error", content: `Image error: ${err}` });
          }
          processMessageWithAttachments(textPrompt, imgs);
        });
      }
    },
    [addOutput, queuedInput, connected, state.status]
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      // Allow empty text if there are pending attachments
      if (!value.trim() && pendingAttachments.length === 0) return;

      // Handle slash commands
      if (value.startsWith("/")) {
        const parts = value.slice(1).trim().split(/\s+/);
        const cmd = parts[0]?.toLowerCase() ?? "";
        const arg = parts[1];

        if (cmd === "help" || cmd === "h") {
          addOutput({ type: "system", content: "" });
          addOutput({ type: "system", content: "Available commands:" });
          for (const c of COMMANDS) {
            const alias = c.alias ? ` (/${c.alias})` : "";
            addOutput({ type: "system", content: `  /${c.name}${alias} - ${c.description}` });
          }
          addOutput({ type: "system", content: "  exit - Quit the CLI" });
          addOutput({ type: "system", content: "" });
          setInput("");
          return;
        }

        if (cmd === "continue" || cmd === "c") {
          setContinueMode(true);
          addOutput({ type: "system", content: "↩ Will continue last conversation" });
          setInput("");
          return;
        }

        if (cmd === "new" || cmd === "n") {
          setContinueMode(false);
          // Reset history
          historyRef.current = createHistory("new");
          saveHistory(historyRef.current);
          setOutput([]);
          clientRef.current?.newSession(sessionConfigRef.current).catch(() => {});
          addOutput({ type: "system", content: "🆕 Starting new conversation" });
          setInput("");
          return;
        }

        if (cmd === "clear") {
          setOutput([]);
          setInput("");
          return;
        }

        if (cmd === "model" || cmd === "m") {
          const models = ["sonnet", "opus", "haiku"];
          if (arg && models.includes(arg.toLowerCase())) {
            sessionConfigRef.current.model = arg.toLowerCase();
            setStatusInfo(prev => ({ ...prev, model: arg.toLowerCase() }));
            setConfig({ model: arg.toLowerCase() }); // Persist to config file
            addOutput({ type: "system", content: `Model set to: ${arg.toLowerCase()}` });
          } else {
            addOutput({ type: "system", content: `Current model: ${sessionConfigRef.current.model || "opus"}` });
            addOutput({ type: "system", content: `Usage: /model <sonnet|opus|haiku>` });
          }
          setInput("");
          return;
        }

        if (cmd === "thinking" || cmd === "t") {
          if (arg === "off") {
            sessionConfigRef.current.thinkingBudget = null;
            setStatusInfo(prev => ({ ...prev, thinking: { enabled: false, budget: null } }));
            setConfig({ thinkingBudget: null }); // Persist to config file
            addOutput({ type: "system", content: "🧠 Thinking mode: OFF" });
          } else if (arg === "on" || !arg) {
            const budget = parts[2] ? parseInt(parts[2], 10) : 10000;
            if (isNaN(budget) || budget < 1024) {
              addOutput({ type: "error", content: "Thinking budget must be at least 1024 tokens" });
            } else {
              sessionConfigRef.current.thinkingBudget = budget;
              setStatusInfo(prev => ({ ...prev, thinking: { enabled: true, budget } }));
              setConfig({ thinkingBudget: budget }); // Persist to config file
              addOutput({ type: "system", content: `🧠 Thinking mode: ON (budget: ${budget.toLocaleString()} tokens)` });
            }
          } else {
            const budget = parseInt(arg, 10);
            if (!isNaN(budget) && budget >= 1024) {
              sessionConfigRef.current.thinkingBudget = budget;
              setStatusInfo(prev => ({ ...prev, thinking: { enabled: true, budget } }));
              setConfig({ thinkingBudget: budget }); // Persist to config file
              addOutput({ type: "system", content: `🧠 Thinking mode: ON (budget: ${budget.toLocaleString()} tokens)` });
            } else {
              addOutput({ type: "system", content: `🧠 Thinking mode: ${sessionConfigRef.current.thinkingBudget ? `ON (${sessionConfigRef.current.thinkingBudget.toLocaleString()} tokens)` : "OFF"}` });
              addOutput({ type: "system", content: "Usage: /thinking <on|off> [budget]" });
            }
          }
          setInput("");
          return;
        }

        if (cmd === "compact") {
          addOutput({ type: "system", content: "Compaction happens automatically when context fills up." });
          setInput("");
          return;
        }

        if (cmd === "reload" || cmd === "r") {
          if (clientRef.current) {
            clientRef.current.reloadDocs()
              .then((result) => {
                addOutput({ type: "system", content: `✓ ${result.message}` });
              })
              .catch((err) => {
                addOutput({ type: "error", content: `Failed to reload docs: ${err.message}` });
              });
          }
          setInput("");
          return;
        }

        if (cmd === "docs" || cmd === "d") {
          if (clientRef.current) {
            clientRef.current.getDocs()
              .then((result) => {
                if (result.docs.length === 0) {
                  addOutput({ type: "system", content: "No project docs loaded." });
                  addOutput({ type: "system", content: "Place CLAUDE.md, AGENT.md, or AGENTS.md in your project directory." });
                } else {
                  addOutput({ type: "system", content: `Loaded ${result.docs.length} doc(s):` });
                  for (const doc of result.docs) {
                    const size = doc.content.length;
                    const sizeStr = size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
                    addOutput({ type: "system", content: `  ${doc.name} (${sizeStr}) - ${doc.path}` });
                  }
                  addOutput({ type: "system", content: "" });
                  addOutput({ type: "system", content: `Auto-loaded: ${result.store.autoLoaded ? "yes" : "no (set via API)"}` });
                  addOutput({ type: "system", content: `Last loaded: ${new Date(result.store.loadedAt).toLocaleString()}` });
                }
              })
              .catch((err) => {
                addOutput({ type: "error", content: `Failed to get docs: ${err.message}` });
              });
          }
          setInput("");
          return;
        }

        if (cmd === "keys" || cmd === "k") {
          const localKeys = detectKeys();
          addOutput({ type: "system", content: "" });
          for (const line of formatKeysDisplay(localKeys).split("\n")) {
            addOutput({ type: "system", content: line });
          }
          addOutput({ type: "system", content: "" });

          // Sync keys to server
          if (localKeys.length > 0 && clientRef.current) {
            const keysMap = Object.fromEntries(localKeys.map(k => [k.name, k.value]));
            clientRef.current.authenticate(keysMap)
              .then(() => {
                addOutput({ type: "system", content: `✓ Synced ${localKeys.length} keys to server` });
              })
              .catch((err) => {
                addOutput({ type: "error", content: `Failed to sync keys: ${err.message}` });
              });
          }
          setInput("");
          return;
        }

        if (cmd === "mcp") {
          const subCmd = arg?.toLowerCase();
          const serverName = parts[2];

          // Helper to display servers
          const displayServers = (servers: Record<string, unknown>) => {
            const serverNames = Object.keys(servers);
            if (serverNames.length === 0) {
              addOutput({ type: "system", content: "No MCP servers configured." });
              addOutput({ type: "system", content: "" });
              addOutput({ type: "system", content: "Usage:" });
              addOutput({ type: "system", content: "  /mcp add <name> <command> [args...]  - Add stdio server" });
              addOutput({ type: "system", content: "  /mcp add-sse <name> <url>            - Add SSE server" });
              addOutput({ type: "system", content: "  /mcp remove <name>                   - Remove server" });
              addOutput({ type: "system", content: "  /mcp list                            - List servers" });
            } else {
              addOutput({ type: "system", content: `MCP Servers (${serverNames.length}):` });
              for (const name of serverNames) {
                const server = servers[name] as Record<string, unknown>;
                if (server.type === "sse") {
                  addOutput({ type: "system", content: `  ${name} (SSE): ${server.url}` });
                } else if (server.type === "http") {
                  addOutput({ type: "system", content: `  ${name} (HTTP): ${server.url}` });
                } else {
                  // stdio
                  const args = (server.args as string[] | undefined)?.join(" ") || "";
                  addOutput({ type: "system", content: `  ${name} (stdio): ${server.command} ${args}`.trim() });
                }
              }
            }
          };

          if (!subCmd || subCmd === "list") {
            // List MCP servers - use client API if connected
            if (clientRef.current) {
              clientRef.current.mcpList()
                .then((result) => displayServers(result.servers))
                .catch((err) => addOutput({ type: "error", content: `Failed to list MCP servers: ${err.message}` }));
            } else {
              displayServers(getMcpServers());
            }
            setInput("");
            return;
          }

          if (subCmd === "add" && serverName) {
            // /mcp add <name> <command> [args...]
            const command = parts[3];
            const args = parts.slice(4);
            if (!command) {
              addOutput({ type: "error", content: "Usage: /mcp add <name> <command> [args...]" });
            } else {
              const config = { command, args: args.length > 0 ? args : undefined };
              if (clientRef.current) {
                clientRef.current.mcpAdd(serverName, config)
                  .then(() => {
                    addOutput({ type: "system", content: `✓ Added MCP server: ${serverName}` });
                    addOutput({ type: "system", content: `  Command: ${command} ${args.join(" ")}`.trim() });
                    addOutput({ type: "system", content: "  Server will be available on next prompt." });
                  })
                  .catch((err) => addOutput({ type: "error", content: `Failed to add MCP server: ${err.message}` }));
              } else {
                addMcpServer(serverName, config as McpServerConfig).then(() => {
                  addOutput({ type: "system", content: `✓ Added MCP server: ${serverName}` });
                  addOutput({ type: "system", content: `  Command: ${command} ${args.join(" ")}`.trim() });
                  addOutput({ type: "system", content: "  Server will be available on next prompt." });
                });
              }
            }
            setInput("");
            return;
          }

          if (subCmd === "add-sse" && serverName) {
            // /mcp add-sse <name> <url>
            const url = parts[3];
            if (!url) {
              addOutput({ type: "error", content: "Usage: /mcp add-sse <name> <url>" });
            } else {
              const config = { type: "sse" as const, url };
              if (clientRef.current) {
                clientRef.current.mcpAdd(serverName, config)
                  .then(() => {
                    addOutput({ type: "system", content: `✓ Added MCP SSE server: ${serverName}` });
                    addOutput({ type: "system", content: `  URL: ${url}` });
                    addOutput({ type: "system", content: "  Server will be available on next prompt." });
                  })
                  .catch((err) => addOutput({ type: "error", content: `Failed to add MCP server: ${err.message}` }));
              } else {
                addMcpServer(serverName, config).then(() => {
                  addOutput({ type: "system", content: `✓ Added MCP SSE server: ${serverName}` });
                  addOutput({ type: "system", content: `  URL: ${url}` });
                  addOutput({ type: "system", content: "  Server will be available on next prompt." });
                });
              }
            }
            setInput("");
            return;
          }

          if (subCmd === "add-http" && serverName) {
            // /mcp add-http <name> <url>
            const url = parts[3];
            if (!url) {
              addOutput({ type: "error", content: "Usage: /mcp add-http <name> <url>" });
            } else {
              const config = { type: "http" as const, url };
              if (clientRef.current) {
                clientRef.current.mcpAdd(serverName, config)
                  .then(() => {
                    addOutput({ type: "system", content: `✓ Added MCP HTTP server: ${serverName}` });
                    addOutput({ type: "system", content: `  URL: ${url}` });
                    addOutput({ type: "system", content: "  Server will be available on next prompt." });
                  })
                  .catch((err) => addOutput({ type: "error", content: `Failed to add MCP server: ${err.message}` }));
              } else {
                addMcpServer(serverName, config).then(() => {
                  addOutput({ type: "system", content: `✓ Added MCP HTTP server: ${serverName}` });
                  addOutput({ type: "system", content: `  URL: ${url}` });
                  addOutput({ type: "system", content: "  Server will be available on next prompt." });
                });
              }
            }
            setInput("");
            return;
          }

          if (subCmd === "remove" && serverName) {
            // /mcp remove <name>
            if (clientRef.current) {
              clientRef.current.mcpRemove(serverName)
                .then((result) => {
                  if (result.success) {
                    addOutput({ type: "system", content: `✓ Removed MCP server: ${serverName}` });
                  } else {
                    addOutput({ type: "error", content: `MCP server not found: ${serverName}` });
                  }
                })
                .catch((err) => addOutput({ type: "error", content: `Failed to remove MCP server: ${err.message}` }));
            } else {
              removeMcpServer(serverName).then((removed) => {
                if (removed) {
                  addOutput({ type: "system", content: `✓ Removed MCP server: ${serverName}` });
                } else {
                  addOutput({ type: "error", content: `MCP server not found: ${serverName}` });
                }
              });
            }
            setInput("");
            return;
          }

          addOutput({ type: "error", content: "Usage: /mcp <list|add|add-sse|add-http|remove> [name] [...]" });
          setInput("");
          return;
        }

        if (cmd === "plan" || cmd === "p") {
          const subCmd = arg?.toLowerCase();

          if (!subCmd) {
            // Toggle plan mode
            if (clientRef.current) {
              const newMode = statusInfo.planMode ? "default" : "plan";
              clientRef.current.setMode(newMode)
                .then(() => {
                  if (newMode === "plan") {
                    addOutput({ type: "system", content: "📋 Plan mode: ON" });
                    addOutput({ type: "system", content: "  Agent will plan without executing tools." });
                  } else {
                    addOutput({ type: "system", content: "▶️ Plan mode: OFF" });
                    addOutput({ type: "system", content: "  Agent will execute tools normally." });
                  }
                  setStatusInfo(prev => ({ ...prev, planMode: newMode === "plan" }));
                })
                .catch((err) => addOutput({ type: "error", content: `Failed to set mode: ${err.message}` }));
            } else {
              addOutput({ type: "error", content: "Not connected to server" });
            }
            setInput("");
            return;
          }

          if (subCmd === "show") {
            // Show current plan and mode
            if (clientRef.current) {
              clientRef.current.getPlan()
                .then((result) => {
                  const modeIcon = result.mode === "plan" ? "📋" : "▶️";
                  addOutput({ type: "system", content: `${modeIcon} Mode: ${result.mode}` });
                  if (result.plan.length === 0) {
                    addOutput({ type: "system", content: "No plan entries." });
                  } else {
                    addOutput({ type: "system", content: `Plan (${result.plan.length} entries):` });
                    for (const entry of result.plan) {
                      const statusIcon = entry.status === "completed" ? "✓" :
                                        entry.status === "in_progress" ? "⏳" :
                                        entry.status === "failed" ? "✗" : "○";
                      addOutput({ type: "system", content: `  ${statusIcon} [${entry.id}] ${entry.description}` });
                    }
                  }
                })
                .catch((err) => addOutput({ type: "error", content: `Failed to get plan: ${err.message}` }));
            } else {
              addOutput({ type: "error", content: "Not connected to server" });
            }
            setInput("");
            return;
          }

          if (subCmd === "on") {
            // Enable plan mode
            if (clientRef.current) {
              clientRef.current.setMode("plan")
                .then(() => {
                  addOutput({ type: "system", content: "📋 Plan mode: ON" });
                  addOutput({ type: "system", content: "  Agent will plan without executing tools." });
                  setStatusInfo(prev => ({ ...prev, planMode: true }));
                })
                .catch((err) => addOutput({ type: "error", content: `Failed to set mode: ${err.message}` }));
            } else {
              addOutput({ type: "error", content: "Not connected to server" });
            }
            setInput("");
            return;
          }

          if (subCmd === "off") {
            // Disable plan mode
            if (clientRef.current) {
              clientRef.current.setMode("default")
                .then(() => {
                  addOutput({ type: "system", content: "▶️ Plan mode: OFF" });
                  addOutput({ type: "system", content: "  Agent will execute tools normally." });
                  setStatusInfo(prev => ({ ...prev, planMode: false }));
                })
                .catch((err) => addOutput({ type: "error", content: `Failed to set mode: ${err.message}` }));
            } else {
              addOutput({ type: "error", content: "Not connected to server" });
            }
            setInput("");
            return;
          }

          if (subCmd === "clear") {
            // Clear the current plan
            if (clientRef.current) {
              clientRef.current.clearPlan()
                .then(() => {
                  addOutput({ type: "system", content: "✓ Plan cleared" });
                })
                .catch((err) => addOutput({ type: "error", content: `Failed to clear plan: ${err.message}` }));
            } else {
              addOutput({ type: "error", content: "Not connected to server" });
            }
            setInput("");
            return;
          }

          addOutput({ type: "system", content: "Usage: /plan [on|off|show|clear]" });
          addOutput({ type: "system", content: "  (none) - Toggle plan mode" });
          addOutput({ type: "system", content: "  on     - Enable plan mode (no tool execution)" });
          addOutput({ type: "system", content: "  off    - Disable plan mode (normal execution)" });
          addOutput({ type: "system", content: "  show   - Show current plan and mode" });
          addOutput({ type: "system", content: "  clear  - Clear the current plan" });
          setInput("");
          return;
        }

        addOutput({ type: "error", content: `Unknown command: /${cmd}. Type /help for commands.` });
        setInput("");
        return;
      }

      // Handle exit
      if (value.toLowerCase() === "exit" || value.toLowerCase() === "quit") {
        exit();
        return;
      }

      // If currently processing, queue the input
      if (state.status !== "idle") {
        setQueuedInput(value);
        setInput("");
        addOutput({ type: "system", content: `Queued: ${value}` });
        return;
      }

      setInput("");
      // Clear processed paths for next input
      processedPathsRef.current.clear();

      // Use pending attachments (already processed when paths were detected)
      const images = [...pendingAttachments];

      // Build display message - prepend image markers if we have attachments
      let displayMessage = value.trim();
      if (images.length > 0) {
        const imageMarkers = images.map(img => `[Image #${img.id}]`).join(" ");
        displayMessage = displayMessage ? `${imageMarkers}\n${displayMessage}` : imageMarkers;
      }

      // Clear pending attachments
      setPendingAttachments([]);

      // Show the prompt to user (with [Image #N] markers)
      addOutput({ type: "user", content: displayMessage || "(images only)" });

      // Show image attachment info
      if (images.length > 0) {
        addOutput({ type: "system", content: `📎 Attached ${images.length} image(s)` });
      }

      // Send message with attachments
      processMessageWithAttachments(value.trim() || "What is in this image?", images);
    },
    [state.status, addOutput, exit, processMessageWithAttachments, pendingAttachments]
  );

  // Cancel running task
  const cancelQuery = useCallback(async () => {
    if (clientRef.current && state.status !== "idle") {
      addOutput({ type: "system", content: "⏹ Cancelled" });
      await clientRef.current.cancel().catch(() => {});
      setState({ status: "idle" });
    }
  }, [addOutput, state.status]);

  // Handle ESC key to cancel running query
  useInput((inputChar, key) => {
    if (key.escape && state.status !== "idle") {
      cancelQuery();
    }
  });

  // Calculate output area size based on input lines
  const inputLineCount = input.split("\n").length;
  const terminalHeight = process.stdout.rows || 24;
  const showSuggestions = input.startsWith("/") && input.length >= 2;
  const activityBarHeight = state.status === "idle" ? 0 : 1;
  const topStatusBarHeight = 3;
  const inputBoxHeight = 4 + inputLineCount;
  const suggestionsHeight = showSuggestions ? 1 : 0;
  const outputMaxLines = Math.max(3, terminalHeight - topStatusBarHeight - inputBoxHeight - activityBarHeight - suggestionsHeight);

  return (
    <Box flexDirection="column" height={terminalHeight}>
      <TopStatusBar
        model={statusInfo.model}
        thinking={statusInfo.thinking}
        cost={statusInfo.cost}
        continueMode={continueMode}
        connected={connected}
        planMode={statusInfo.planMode}
      />
      <Box flexDirection="column" flexGrow={1}>
        <OutputArea lines={output} maxLines={outputMaxLines} />
      </Box>
      <StatusBar state={state} />
      {/* Show pending attachments above input like Claude Code */}
      {pendingAttachments.length > 0 && (
        <Box paddingX={1} marginBottom={0}>
          <Text color="magenta">
            {pendingAttachments.map((img, idx) => `[Image #${img.id}]`).join(" ")}
          </Text>
          <Text dimColor> ({pendingAttachments.length} attached)</Text>
        </Box>
      )}
      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onCancel={cancelQuery}
        onExit={exit}
        disabled={state.status !== "idle"}
        continueMode={continueMode}
        suggestionIndex={suggestionIndex}
        onSuggestionIndexChange={setSuggestionIndex}
        client={clientRef.current}
      />
    </Box>
  );
}

export interface CliOptions {
  continueSession?: boolean;
  serverUrl?: string;
}

export async function runCli(options: CliOptions = {}) {
  const { waitUntilExit } = render(
    <App
      initialContinue={options.continueSession ?? false}
      serverUrl={options.serverUrl}
    />
  );
  await waitUntilExit();
}
