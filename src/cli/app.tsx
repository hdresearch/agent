import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, useApp, useInput } from "ink";

// Components
import {
  TopStatusBar,
  OutputArea,
  StatusBar,
  InputBar,
  BranchTree,
  BranchPopup,
} from "./components";
import { PermissionDialog } from "./components/permission-dialog";
import { PopupWindow } from "./components/popup-window";

// Hooks
import { useAcpClient } from "./hooks/use-acp-client";
import { useImageAttachments } from "./hooks/use-image-attachments";

// Handlers
import { handleSlashCommand, type CommandHandlerContext } from "./handlers/command-handlers";
import { executeBashCommand } from "./handlers/bash-handler";

// Types and utilities
import type { OutputLine, AppState } from "./types";
import type { SessionConfig, Attachment } from "../protocol/acp-types";
import { uniqueId } from "./utils/formatting";
import { getConfig, getCommandHistory, addToCommandHistory, loadCommandHistory } from "../utils/config";
import { addMessage, saveHistory } from "../utils/history";

// Canvas for VM stats
import { subscribeToTreeState, type TreeState } from "../canvas";

interface AppProps {
  initialContinue: boolean;
  serverUrl?: string;
}

export function App({ initialContinue, serverUrl: initialServerUrl }: AppProps) {
  const { exit } = useApp();
  const [input, setInputRaw] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [queuedInput, setQueuedInput] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [state, setState] = useState<AppState>({ status: "idle" });
  const [scrollOffset, setScrollOffset] = useState(0);
  // Interactive tree view mode
  const [showTreeView, setShowTreeView] = useState(false);
  // Branch popup - shows when VM is created/branched
  const [branchPopupVmId, setBranchPopupVmId] = useState<string | null>(null);
  // VM stats for top status bar
  const [vmStats, setVmStats] = useState<{
    total: number;
    running: number;
    completed: number;
    failed: number;
  } | null>(null);
  // Server URL - can be changed with /connect command
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  // In remote mode, default to continuing the most recent session
  const [continueMode, setContinueMode] = useState(initialContinue || !!initialServerUrl);
  // Command history (most recent first) - loaded from persisted storage, per-session
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState("");

  // Submission guards
  const isSubmittingRef = useRef(false);
  const lastSubmitTimeRef = useRef(0);

  // Session config
  const persistedConfig = getConfig();
  const [sessionConfig, setSessionConfigState] = useState<SessionConfig>({
    model: persistedConfig.model,
  });

  const setSessionConfig = useCallback((updates: Partial<SessionConfig>) => {
    setSessionConfigState(prev => ({ ...prev, ...updates }));
  }, []);

  // Output helper - auto-scroll to bottom when adding output
  const addOutput = useCallback((line: Omit<OutputLine, "id">) => {
    setOutput((prev) => {
      // Handle streaming text: append to last line if it's a streaming text chunk
      if (line.type === "text" && prev.length > 0) {
        const lastLine = prev[prev.length - 1]!;
        // If last line is a streaming text line, append to it
        if (lastLine.type === "text" && lastLine.streaming) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...lastLine,
            content: lastLine.content + line.content,
            streaming: line.streaming, // Keep streaming status from new chunk
          };
          return updated;
        }
      }
      // Otherwise add as new line
      return [...prev, { ...line, id: uniqueId() }];
    });
    setScrollOffset(0); // Reset scroll to bottom on new output
  }, []);

  // Image attachments hook
  const {
    pendingAttachments,
    setPendingAttachments,
    processInput,
    clearAttachments,
    clearProcessedPaths,
  } = useImageAttachments();

  // Wrapper around setInput that processes images
  const setInput = useCallback((newValue: string) => {
    const modifiedInput = processInput(newValue);
    setInputRaw(modifiedInput);
    // Reset history navigation when user types
    if (historyIndex !== -1) {
      setHistoryIndex(-1);
      setSavedInput("");
    }
  }, [processInput, historyIndex]);

  // Handle history navigation (up/down arrows)
  const handleHistoryNavigate = useCallback((newIndex: number) => {
    if (newIndex < -1) {
      // Going past the end (down arrow at newest) - restore saved input
      setHistoryIndex(-1);
      setInputRaw(savedInput);
      setSavedInput("");
      return;
    }

    if (newIndex >= commandHistory.length) {
      // Can't go further back
      return;
    }

    // Save current input if just starting to navigate
    if (historyIndex === -1 && newIndex >= 0) {
      setSavedInput(input);
    }

    setHistoryIndex(newIndex);
    if (newIndex === -1) {
      setInputRaw(savedInput);
      setSavedInput("");
    } else {
      setInputRaw(commandHistory[newIndex] || "");
    }
  }, [commandHistory, historyIndex, input, savedInput]);

  // ACP client hook
  const {
    client,
    connected,
    statusInfo,
    setStatusInfo,
    historyRef,
    remoteCwd,
    needsToken,
    submitToken,
    permissionRequest,
    respondToPermission,
    cancelPermission,
    agentCommands,
    agentName,
    agentOutput,
    clearAgentOutput,
  } = useAcpClient({
    serverUrl,
    continueMode,
    sessionConfig,
    onOutput: addOutput,
  });

  // Load command history when session changes
  useEffect(() => {
    if (statusInfo.sessionId) {
      loadCommandHistory(statusInfo.sessionId).then(setCommandHistory);
    }
  }, [statusInfo.sessionId]);

  // Subscribe to VM tree state for stats in top bar
  useEffect(() => {
    const unsubscribe = subscribeToTreeState((event) => {
      const state = event.state;
      setVmStats({
        total: state.totalVms,
        running: state.runningCount,
        completed: state.completedCount,
        failed: state.failedCount,
      });
    });
    return () => unsubscribe();
  }, []);

  // Send message to server
  const sendMessage = useCallback(
    async (message: string, images: Array<{ id: number; path: string; mediaType: string; base64: string }>) => {
      if (!client || !connected) {
        addOutput({ type: "error", content: "Not connected to server" });
        isSubmittingRef.current = false;
        setState({ status: "idle" });
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
        await client.prompt(message, attachments.length > 0 ? attachments : undefined);
        // Events will stream via notifications
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        addOutput({ type: "error", content: `Error: ${errorMsg}` });
      }

      isSubmittingRef.current = false;
      setState({ status: "idle" });
    },
    [client, connected, addOutput, historyRef]
  );

  // Main submit handler
  const handleSubmit = useCallback(
    async (value: string) => {
      // Handle token entry mode
      if (needsToken) {
        const token = value.trim();
        if (!token) {
          addOutput({ type: "error", content: "Token cannot be empty" });
          return;
        }
        setInput("");
        submitToken(token);
        return;
      }

      // Allow empty text if there are pending attachments
      if (!value.trim() && pendingAttachments.length === 0) return;

      // Debounce: ignore submissions within 100ms of the last one
      const now = Date.now();
      if (now - lastSubmitTimeRef.current < 100) {
        return;
      }
      lastSubmitTimeRef.current = now;

      // Add to command history (persisted)
      const trimmedValue = value.trim();
      if (trimmedValue) {
        const updatedHistory = addToCommandHistory(trimmedValue);
        setCommandHistory(updatedHistory);
      }
      // Reset history navigation
      setHistoryIndex(-1);
      setSavedInput("");

      // Handle bash escape (! prefix)
      if (value.startsWith("!")) {
        const command = value.slice(1).trim();
        if (!command) {
          setInput("");
          return;
        }

        addOutput({ type: "user", content: value });
        setInput("");

        await executeBashCommand(command, {
          client,
          remoteCwd,
          addOutput,
        });
        return;
      }

      // Handle slash commands
      if (value.startsWith("/")) {
        const ctx: CommandHandlerContext = {
          client,
          sessionConfig,
          setSessionConfig,
          statusInfo,
          setStatusInfo,
          addOutput,
          setOutput,
          clearOutput: () => setOutput([]),
          setContinueMode,
          historyRef,
          exit,
          reconnect: (url: string) => {
            setServerUrl(url);
            addOutput({ type: "system", content: `Connecting to ${url}...` });
          },
          currentServerUrl: serverUrl,
          agentCommands,
          setShowTreeView,
          showBranchPopup: (vmId: string) => setBranchPopupVmId(vmId),
        };

        const result = handleSlashCommand(value, ctx);
        if (result.handled) {
          setInput("");
          return;
        }
      }

      // Handle exit
      if (value.toLowerCase() === "exit" || value.toLowerCase() === "quit") {
        exit();
        return;
      }

      // If currently processing or already submitting, queue the input
      if (state.status !== "idle" || isSubmittingRef.current) {
        setQueuedInput(value);
        setInput("");
        addOutput({ type: "system", content: `Queued: ${value}` });
        return;
      }

      // Set ref immediately to prevent double-submission (refs update synchronously)
      isSubmittingRef.current = true;
      setState({ status: "thinking" });
      setInput("");
      clearProcessedPaths();

      // Use pending attachments
      const images = [...pendingAttachments];

      // Build display message
      let displayMessage = value.trim();
      if (images.length > 0) {
        const imageMarkers = images.map(img => `[Image #${img.id}]`).join(" ");
        displayMessage = displayMessage ? `${imageMarkers}\n${displayMessage}` : imageMarkers;
      }

      // Clear pending attachments
      clearAttachments();

      // Show the prompt to user
      addOutput({ type: "user", content: displayMessage || "(images only)" });

      // Show image attachment info
      if (images.length > 0) {
        addOutput({ type: "system", content: `📎 Attached ${images.length} image(s)` });
      }

      // Send message
      await sendMessage(value.trim() || "What is in this image?", images);
    },
    [
      state.status,
      addOutput,
      exit,
      sendMessage,
      pendingAttachments,
      remoteCwd,
      client,
      sessionConfig,
      setSessionConfig,
      statusInfo,
      setStatusInfo,
      historyRef,
      clearAttachments,
      clearProcessedPaths,
      needsToken,
      submitToken,
      commandHistory,
    ]
  );

  // Cancel running task
  const cancelQuery = useCallback(async () => {
    if (client && state.status !== "idle") {
      addOutput({ type: "system", content: "⏹ Cancelled" });
      await client.cancel().catch(() => {});
      isSubmittingRef.current = false;
      setState({ status: "idle" });
    }
  }, [addOutput, client, state.status]);

  // Calculate output area size based on input lines
  const inputLineCount = input.split("\n").length;
  const terminalHeight = process.stdout.rows || 24;
  const showSuggestions = input.startsWith("/") && input.length >= 2;
  const activityBarHeight = state.status === "idle" ? 0 : 1;
  const topStatusBarHeight = 3;
  const inputBoxHeight = 4 + inputLineCount;
  const suggestionsHeight = showSuggestions ? 1 : 0;
  const attachmentsHeight = pendingAttachments.length > 0 ? 1 : 0;
  const permissionDialogHeight = permissionRequest ? 8 : 0; // Approximate height for dialog

  // Reserve 10% of terminal as minimum bottom space
  const minBottomBuffer = Math.max(2, Math.floor(terminalHeight * 0.1));
  const fixedElementsHeight = topStatusBarHeight + inputBoxHeight + activityBarHeight + suggestionsHeight + attachmentsHeight + permissionDialogHeight;

  // Max lines before input would go below the 90% mark
  const outputMaxLines = Math.max(3, terminalHeight - fixedElementsHeight - minBottomBuffer);

  // Estimate actual output height (rough: each output line + margin)
  const estimatedOutputLines = Math.min(output.length * 2, outputMaxLines);

  // If content is short, don't fill the terminal - let input follow content
  // If content is long, fill terminal and cap output
  const contentFillsScreen = estimatedOutputLines >= outputMaxLines;
  const containerHeight = contentFillsScreen ? terminalHeight : undefined;

  // Handle ESC key to cancel running query and Page Up/Down for scrolling
  useInput((inputChar, key) => {
    if (key.escape && state.status !== "idle") {
      cancelQuery();
    }

    // Page Up - scroll up through history
    if (key.pageUp) {
      const maxScroll = Math.max(0, output.length - outputMaxLines);
      setScrollOffset(prev => Math.min(maxScroll, prev + 5));
    }

    // Page Down - scroll down through history
    if (key.pageDown) {
      setScrollOffset(prev => Math.max(0, prev - 5));
    }

    // Home - scroll to top
    if (key.home) {
      const maxScroll = Math.max(0, output.length - outputMaxLines);
      setScrollOffset(maxScroll);
    }

    // End - scroll to bottom
    if (key.end) {
      setScrollOffset(0);
    }

    // 'c' or 'C' - open canvas when VMs exist (only when input is empty to avoid capturing typing)
    if ((inputChar === "c" || inputChar === "C") && vmStats && vmStats.total > 0 && input === "") {
      setShowTreeView(true);
    }
  });

  // Handle tree view actions
  const handleTreeAction = useCallback((action: string, vmId: string) => {
    switch (action) {
      case "open":
        // Open VM shell in browser/terminal
        addOutput({ type: "system", content: `Opening shell for VM ${vmId.slice(0, 8)}...` });
        break;
      case "focus":
        // Connect to this VM
        setShowTreeView(false);
        // Could trigger /vm connect here
        break;
      case "kill":
        addOutput({ type: "system", content: `Killing VM ${vmId.slice(0, 8)}...` });
        break;
    }
  }, [addOutput]);

  // Render interactive tree view if active
  if (showTreeView) {
    return (
      <BranchTree
        onClose={() => setShowTreeView(false)}
        onAction={handleTreeAction}
      />
    );
  }

  return (
    <Box flexDirection="column" height={containerHeight}>
      <TopStatusBar
        model={statusInfo.model}
        connected={connected}
        planMode={statusInfo.planMode}
        sessionId={statusInfo.sessionId}
        serverUrl={serverUrl}
        agentName={agentName}
        vmStats={vmStats || undefined}
        canvasUrl={serverUrl ? `${serverUrl}/shell` : undefined}
      />
      <OutputArea lines={output} maxLines={outputMaxLines} scrollOffset={scrollOffset} />
      <StatusBar state={state} />
      {/* Permission dialog - shown when agent requests user permission */}
      {permissionRequest && (
        <PermissionDialog
          request={permissionRequest}
          onRespond={respondToPermission}
          onCancel={cancelPermission}
        />
      )}
      {/* Agent output popup - shown when agent sends stderr output (e.g., /usage) */}
      {agentOutput && (
        <PopupWindow
          title="Agent Output"
          content={agentOutput}
          onClose={clearAgentOutput}
        />
      )}
      {/* Branch popup - shown when VM is created/branched */}
      {branchPopupVmId && (
        <BranchPopup
          newVmId={branchPopupVmId}
          onClose={() => setBranchPopupVmId(null)}
          onOpen={(vmId) => {
            addOutput({ type: "system", content: `Opening VM ${vmId.slice(0, 8)}...` });
          }}
        />
      )}
      {/* Show pending attachments above input like Claude Code */}
      {pendingAttachments.length > 0 && (
        <Box paddingX={1} marginBottom={0}>
          <Text color="magenta">
            {pendingAttachments.map((img) => `[Image #${img.id}]`).join(" ")}
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
        disabled={state.status !== "idle" || !!permissionRequest}
        continueMode={continueMode}
        tokenMode={needsToken}
        suggestionIndex={suggestionIndex}
        onSuggestionIndexChange={setSuggestionIndex}
        client={client}
        remoteCwd={remoteCwd}
        history={commandHistory}
        historyIndex={historyIndex}
        onHistoryNavigate={handleHistoryNavigate}
        agentCommands={agentCommands}
      />
    </Box>
  );
}

// Need Text for the pending attachments display
import { Text } from "ink";
