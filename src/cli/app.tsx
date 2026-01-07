import React, { useState, useCallback, useRef } from "react";
import { Box, useApp, useInput } from "ink";

// Components
import {
  TopStatusBar,
  OutputArea,
  StatusBar,
  InputBar,
} from "./components";

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
import { getConfig } from "../utils/config";
import { addMessage, saveHistory } from "../utils/history";

interface AppProps {
  initialContinue: boolean;
  serverUrl?: string;
}

export function App({ initialContinue, serverUrl }: AppProps) {
  const { exit } = useApp();
  const [input, setInputRaw] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [queuedInput, setQueuedInput] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [state, setState] = useState<AppState>({ status: "idle" });
  const [scrollOffset, setScrollOffset] = useState(0);
  // In remote mode, default to continuing the most recent session
  const [continueMode, setContinueMode] = useState(initialContinue || !!serverUrl);

  // Submission guards
  const isSubmittingRef = useRef(false);
  const lastSubmitTimeRef = useRef(0);

  // Session config
  const persistedConfig = getConfig();
  const [sessionConfig, setSessionConfigState] = useState<SessionConfig>({
    model: persistedConfig.model,
    thinkingBudget: persistedConfig.thinkingBudget,
  });

  const setSessionConfig = useCallback((updates: Partial<SessionConfig>) => {
    setSessionConfigState(prev => ({ ...prev, ...updates }));
  }, []);

  // Output helper - auto-scroll to bottom when adding output
  const addOutput = useCallback((line: Omit<OutputLine, "id">) => {
    setOutput((prev) => [...prev, { ...line, id: uniqueId() }]);
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
  }, [processInput]);

  // ACP client hook
  const {
    client,
    connected,
    statusInfo,
    setStatusInfo,
    historyRef,
    remoteCwd,
    isRemoteMode,
  } = useAcpClient({
    serverUrl,
    continueMode,
    sessionConfig,
    onOutput: addOutput,
  });

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
      // Allow empty text if there are pending attachments
      if (!value.trim() && pendingAttachments.length === 0) return;

      // Debounce: ignore submissions within 100ms of the last one
      const now = Date.now();
      if (now - lastSubmitTimeRef.current < 100) {
        return;
      }
      lastSubmitTimeRef.current = now;

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
          isRemoteMode,
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
      isRemoteMode,
      remoteCwd,
      client,
      sessionConfig,
      setSessionConfig,
      statusInfo,
      setStatusInfo,
      historyRef,
      clearAttachments,
      clearProcessedPaths,
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

  // Reserve 10% of terminal as minimum bottom space
  const minBottomBuffer = Math.max(2, Math.floor(terminalHeight * 0.1));
  const fixedElementsHeight = topStatusBarHeight + inputBoxHeight + activityBarHeight + suggestionsHeight + attachmentsHeight;

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
  });

  return (
    <Box flexDirection="column" height={containerHeight}>
      <TopStatusBar
        model={statusInfo.model}
        thinking={statusInfo.thinking}
        cost={statusInfo.cost}
        connected={connected}
        planMode={statusInfo.planMode}
        sessionId={statusInfo.sessionId}
      />
      <OutputArea lines={output} maxLines={outputMaxLines} scrollOffset={scrollOffset} />
      <StatusBar state={state} />
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
        disabled={state.status !== "idle"}
        continueMode={continueMode}
        suggestionIndex={suggestionIndex}
        onSuggestionIndexChange={setSuggestionIndex}
        client={client}
      />
    </Box>
  );
}

// Need Text for the pending attachments display
import { Text } from "ink";
