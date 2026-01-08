import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { HttpAcpClient, type ConnectResult } from "../../client/http-client";
import type { SessionNotificationParams, SessionConfig } from "../../protocol/acp-types";
import { detectKeys } from "../../utils/keys";
import type { OutputLine, StatusInfo, PermissionRequest } from "../types";
import { formatTokens, uniqueId } from "../utils/formatting";
import { formatToolArgs } from "../utils/formatting";
import {
  loadHistory,
  saveHistory,
  createHistory,
  addMessage,
  type ConversationHistory,
} from "../../utils/history";
import { getConfig, setConfig } from "../../utils/config";

export interface UseAcpClientOptions {
  serverUrl?: string;
  continueMode: boolean;
  sessionConfig: SessionConfig;
  onOutput: (line: Omit<OutputLine, "id">) => void;
}

export interface UseAcpClientResult {
  client: HttpAcpClient | null;
  connected: boolean;
  statusInfo: StatusInfo;
  setStatusInfo: React.Dispatch<React.SetStateAction<StatusInfo>>;
  historyRef: React.MutableRefObject<ConversationHistory | null>;
  remoteCwd: string | null;
  isRemoteMode: boolean;
  // Token prompt handling
  needsToken: boolean;
  submitToken: (token: string) => void;
  // Permission request handling
  permissionRequest: PermissionRequest | null;
  respondToPermission: (optionId: string) => void;
  cancelPermission: () => void;
}

// Reconnect configuration
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]; // Exponential backoff

export function useAcpClient({
  serverUrl,
  continueMode,
  sessionConfig,
  onOutput,
}: UseAcpClientOptions): UseAcpClientResult {
  const [connected, setConnected] = useState(false);
  const [remoteCwd, setRemoteCwd] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const clientRef = useRef<HttpAcpClient | null>(null);
  const historyRef = useRef<ConversationHistory | null>(null);
  const sessionConfigRef = useRef(sessionConfig);
  const pendingTokenResolve = useRef<((token: string) => void) | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReconnectingRef = useRef(false);
  const lastSessionIdRef = useRef<string | null>(null);
  const seenToolCallsRef = useRef<Set<string>>(new Set());
  const seenToolResultsRef = useRef<Set<string>>(new Set());

  // Remote mode: when connecting to any external server (including localhost containers)
  // If serverUrl is specified, we're connecting to a server and should execute commands there
  const isRemoteMode = !!serverUrl;

  // Callback to submit token when prompted
  const submitToken = useCallback((token: string) => {
    if (pendingTokenResolve.current) {
      pendingTokenResolve.current(token);
      pendingTokenResolve.current = null;
    }
    setNeedsToken(false);
  }, []);

  // Callback to respond to a permission request
  const respondToPermission = useCallback((optionId: string) => {
    if (!permissionRequest || !clientRef.current) return;

    const requestId = permissionRequest.requestId;
    setPermissionRequest(null);

    // Send response to server
    clientRef.current.permissionRespond(requestId, optionId).catch((err) => {
      onOutput({ type: "error", content: `Failed to respond to permission: ${err.message}` });
    });
  }, [permissionRequest, onOutput]);

  // Callback to cancel a permission request
  const cancelPermission = useCallback(() => {
    if (!permissionRequest || !clientRef.current) return;

    const requestId = permissionRequest.requestId;
    setPermissionRequest(null);

    // Send cancel to server
    clientRef.current.permissionCancel(requestId).catch((err) => {
      onOutput({ type: "error", content: `Failed to cancel permission: ${err.message}` });
    });
  }, [permissionRequest, onOutput]);

  // Load persisted config
  const persistedConfig = getConfig();

  // Status bar state - initialized from persisted config
  const [statusInfo, setStatusInfo] = useState<StatusInfo>({
    model: persistedConfig.model,
    thinking: {
      enabled: persistedConfig.thinkingBudget !== null,
      budget: persistedConfig.thinkingBudget,
    },
    cost: { totalCost: 0, inputTokens: 0, outputTokens: 0 },
    planMode: false,
    sessionId: null,
  });

  // Keep session config ref in sync
  useEffect(() => {
    sessionConfigRef.current = sessionConfig;
  }, [sessionConfig]);

  // Load conversation history on startup if continue mode
  // BUT: for remote mode, skip local history - we'll load from server instead
  useEffect(() => {
    if (isRemoteMode) {
      // Remote mode: don't load local history, server will provide it
      historyRef.current = createHistory("remote");
      return;
    }

    if (continueMode) {
      loadHistory().then((history) => {
        if (history && history.messages.length > 0) {
          historyRef.current = history;
          // Replay messages to output
          for (const msg of history.messages) {
            if (msg.role === "user") {
              onOutput({ type: "system", content: `❯ ${msg.content}`, color: "cyan" });
            } else if (msg.role === "assistant") {
              onOutput({ type: "text", content: msg.content });
            } else if (msg.role === "tool" && msg.toolName) {
              onOutput({ type: "tool", content: `${msg.toolName}: ${msg.content}` });
            }
          }
        } else {
          // No history, create new
          historyRef.current = createHistory(persistedConfig.lastSessionId || "new");
        }
      });
    } else {
      // Fresh session
      historyRef.current = createHistory("new");
    }
  }, [continueMode, persistedConfig.lastSessionId, onOutput, isRemoteMode]);

  // Initialize ACP client
  useEffect(() => {
    const url = serverUrl || `http://localhost:${process.env.PORT || 9999}`;
    let isMounted = true;

    // Helper to wait for token from user
    const waitForToken = (): Promise<string> => {
      return new Promise((resolve) => {
        pendingTokenResolve.current = resolve;
        setNeedsToken(true);
        onOutput({
          type: "system",
          content: "🔐 Server is claimed. Enter your access token:",
        });
      });
    };

    // Schedule a reconnect attempt
    const scheduleReconnect = () => {
      if (!isMounted || isReconnectingRef.current) return;

      const attempt = reconnectAttemptRef.current;
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)] ?? 30000;

      onOutput({
        type: "system",
        content: `🔄 Connection lost. Reconnecting in ${delay / 1000}s...`,
      });

      reconnectTimeoutRef.current = setTimeout(() => {
        if (!isMounted) return;
        reconnectAttemptRef.current++;
        attemptReconnect();
      }, delay);
    };

    // Attempt to reconnect
    const attemptReconnect = async () => {
      if (!isMounted || isReconnectingRef.current) return;
      isReconnectingRef.current = true;

      onOutput({
        type: "system",
        content: "🔄 Attempting to reconnect...",
      });

      try {
        // Close old client
        clientRef.current?.close();

        // Create new client
        const client = new HttpAcpClient(url);
        clientRef.current = client;
        setupHandlers(client);

        // Try to connect
        const result = await client.connect();

        if (!result.success) {
          if (result.needsToken) {
            // Token required - can't auto-reconnect, need user input
            onOutput({ type: "error", content: "Server requires authentication. Use /connect to reconnect." });
            isReconnectingRef.current = false;
            return;
          }
          throw new Error(result.error || "Connection failed");
        }

        // Re-initialize
        await client.initialize();

        // Re-authenticate
        const localKeys = detectKeys();
        if (localKeys.length > 0) {
          const keysMap = Object.fromEntries(localKeys.map(k => [k.name, k.value]));
          await client.authenticate(keysMap);
        }

        // Load existing session if we have one
        if (lastSessionIdRef.current) {
          try {
            await client.loadSession(lastSessionIdRef.current);
          } catch {
            // Session may have expired, create new one
            const newResult = await client.newSession(sessionConfigRef.current);
            lastSessionIdRef.current = newResult.sessionId;
          }
        } else {
          const newResult = await client.newSession(sessionConfigRef.current);
          lastSessionIdRef.current = newResult.sessionId;
        }

        // Success!
        setConnected(true);
        reconnectAttemptRef.current = 0;
        isReconnectingRef.current = false;
        onOutput({
          type: "system",
          content: "✅ Reconnected to server",
        });
      } catch (err) {
        isReconnectingRef.current = false;
        if (reconnectAttemptRef.current < RECONNECT_DELAYS.length + 2) {
          scheduleReconnect();
        } else {
          onOutput({
            type: "error",
            content: "❌ Failed to reconnect after multiple attempts. Use /connect to try again.",
          });
        }
      }
    };

    // Setup handlers (notifications + disconnect)
    const setupHandlers = (client: HttpAcpClient) => {
      // Disconnect handler for auto-reconnect
      client.onDisconnect(() => {
        if (!isMounted) return;
        setConnected(false);
        scheduleReconnect();
      });

      setupNotificationHandler(client);
    };

    // Setup notification handlers
    const setupNotificationHandler = (client: HttpAcpClient) => {
      client.onNotification((params: SessionNotificationParams) => {
        const { type, data } = params;

        switch (type) {
          case "mode_update":
            if ("mode" in data) {
              const mode = data.mode as string;
              setStatusInfo(prev => {
                const wasInPlanMode = prev.planMode;
                const isNowPlanMode = mode === "plan";
                if (isNowPlanMode && !wasInPlanMode) {
                  onOutput({ type: "system", content: "📋 Entered plan mode" });
                } else if (!isNowPlanMode && wasInPlanMode) {
                  onOutput({ type: "system", content: "▶️ Exited plan mode" });
                }
                return { ...prev, planMode: isNowPlanMode };
              });
            }
            break;

          case "content_chunk":
            if ("text" in data && data.text) {
              const text = data.text as string;
              onOutput({ type: "text", content: text });
              if (historyRef.current) {
                addMessage(historyRef.current, "assistant", text);
                saveHistory(historyRef.current);
              }
            }
            break;

          case "tool_call": {
            // Type assertion for tool call data
            const toolData = data as import("../../protocol/acp-types").ToolCallData;
            const toolCallId = toolData.toolCallId || toolData.toolId || undefined;

            // Deduplicate tool calls by toolCallId
            if (toolCallId && seenToolCallsRef.current.has(toolCallId)) {
              break;
            }
            if (toolCallId) {
              seenToolCallsRef.current.add(toolCallId);
            }

            // Clean up title: strip surrounding quotes and filter invalid values
            const cleanTitle = (s: string | undefined): string | undefined => {
              if (!s || s === "undefined" || s.trim() === "") return undefined;
              // Strip surrounding quotes if present
              let cleaned = s.trim();
              if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
                  (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
                cleaned = cleaned.slice(1, -1);
              }
              return cleaned || undefined;
            };
            const rawToolName = toolData.toolName as string | undefined;
            const rawTitle = toolData.title as string | undefined;
            const validToolName = cleanTitle(rawToolName);
            const validTitle = cleanTitle(rawTitle);
            const toolName = validToolName || validTitle || toolCallId || "Tool";
            const toolArgs = formatToolArgs(toolName, (toolData.input || {}) as Record<string, unknown>);
            // Extract rich ACP tool information
            const toolTitle = validTitle || validToolName || toolCallId || "Tool";
            const toolKind = (toolData.kind as string) || undefined;
            const toolStatus = (toolData.status as string) || "in_progress";
            const toolLocations = toolData.locations as import("../types").ToolLocation[] | undefined;
            const toolContent = toolData.content as import("../types").ToolContent[] | undefined;

            onOutput({
              type: "tool",
              content: toolArgs,
              toolName,
              toolTitle,
              toolKind: toolKind as import("../types").ToolKind | undefined,
              toolStatus: toolStatus as import("../types").ToolStatus,
              toolCallId,
              toolLocations,
              toolContent,
            });
            if (historyRef.current) {
              addMessage(historyRef.current, "tool", toolTitle || toolArgs, toolName);
              saveHistory(historyRef.current);
            }
            break;
          }

          case "tool_result": {
            // Type assertion since we know this is ToolResultData from the switch
            const resultData = data as import("../../protocol/acp-types").ToolResultData & {
              locations?: import("../types").ToolLocation[];
              richContent?: import("../types").ToolContent[];
            };
            const toolCallId = resultData.toolCallId || resultData.toolId;

            // Deduplicate tool results by toolCallId
            if (toolCallId && seenToolResultsRef.current.has(toolCallId)) {
              break;
            }
            if (toolCallId) {
              seenToolResultsRef.current.add(toolCallId);
            }

            const status = resultData.status || (resultData.success ? "completed" : "failed");
            const content = resultData.content ? String(resultData.content).slice(0, 100) : "";

            // Skip showing simple "Done" results - they clutter the tool window
            // Only show results with meaningful content or errors
            const isSimpleDone = status === "completed" && (!content || content === "Done" || content.trim() === "");
            if (isSimpleDone) {
              break;
            }

            onOutput({
              type: "tool-result",
              content: content || "Done",
              toolCallId,
              toolStatus: status as import("../types").ToolStatus,
              toolLocations: resultData.locations,
              toolContent: resultData.richContent,
            });
            break;
          }

          case "completed":
            if ("totalCostUsd" in data && "inputTokens" in data && "outputTokens" in data) {
              setStatusInfo((prev) => ({
                ...prev,
                cost: {
                  totalCost: prev.cost.totalCost + (data.totalCostUsd as number),
                  inputTokens: prev.cost.inputTokens + (data.inputTokens as number),
                  outputTokens: prev.cost.outputTokens + (data.outputTokens as number),
                },
              }));
              const cost = data.totalCostUsd as number;
              const input = data.inputTokens as number;
              const output = data.outputTokens as number;
              onOutput({
                type: "stats",
                content: `$${cost.toFixed(4)} · ${formatTokens(input)} in · ${formatTokens(output)} out`,
              });
            }
            break;

          case "failed":
            if ("error" in data) {
              onOutput({ type: "error", content: `Error: ${data.error}` });
            }
            break;

          case "plan_update":
            if ("entries" in data && Array.isArray(data.entries)) {
              const entries = data.entries as Array<{ id: string; description: string; status: string }>;
              if (entries.length > 0) {
                onOutput({ type: "system", content: `📋 Plan updated (${entries.length} entries):` });
                for (const entry of entries.slice(0, 5)) {
                  const statusIcon = entry.status === "completed" ? "✓" :
                                    entry.status === "in_progress" ? "⏳" :
                                    entry.status === "failed" ? "✗" : "○";
                  onOutput({ type: "system", content: `  ${statusIcon} ${entry.description}` });
                }
                if (entries.length > 5) {
                  onOutput({ type: "system", content: `  ... and ${entries.length - 5} more` });
                }
              }
            }
            break;

          case "permission_request":
            if ("requestId" in data && "options" in data && "toolCall" in data) {
              const permData = data as {
                requestId: string;
                toolCall: {
                  toolCallId: string;
                  title?: string;
                  kind?: string;
                  status?: string;
                  locations?: Array<{ path: string; line?: number }>;
                  content?: unknown[];
                };
                options: Array<{
                  optionId: string;
                  kind: string;
                  name: string;
                }>;
              };
              setPermissionRequest({
                requestId: permData.requestId,
                toolCall: {
                  toolCallId: permData.toolCall.toolCallId,
                  title: permData.toolCall.title,
                  kind: permData.toolCall.kind as import("../types").ToolKind | undefined,
                  status: permData.toolCall.status as import("../types").ToolStatus | undefined,
                  locations: permData.toolCall.locations,
                  content: permData.toolCall.content as import("../types").ToolContent[] | undefined,
                },
                options: permData.options.map(opt => ({
                  optionId: opt.optionId,
                  kind: opt.kind as import("../types").PermissionOptionKind,
                  name: opt.name,
                })),
              });
            }
            break;
        }
      });
    };

    // Complete initialization after successful connection
    const completeInitialization = async (client: HttpAcpClient) => {
      await client.initialize();
      setConnected(true);

      // Detect and send API keys
      const localKeys = detectKeys();
      if (localKeys.length > 0) {
        const keysMap = Object.fromEntries(localKeys.map(k => [k.name, k.value]));
        await client.authenticate(keysMap);
      }

      // Create or load session
      let sessionLoaded = false;
      let currentSessionId: string | null = null;
      if (continueMode) {
        try {
          const sessions = await client.listSessions();
          if (sessions.sessions.length > 0) {
            const mostRecent = sessions.sessions[0]!;
            const loadResult = await client.loadSession(mostRecent.id);
            currentSessionId = loadResult.sessionId;
            sessionLoaded = true;
          }
        } catch {
          // Fall back to new session
        }
      }

      if (!sessionLoaded) {
        seenToolCallsRef.current.clear(); // Clear dedup sets for new session
        seenToolResultsRef.current.clear();
        const newResult = await client.newSession(sessionConfigRef.current);
        currentSessionId = newResult.sessionId;
      }

      if (currentSessionId) {
        lastSessionIdRef.current = currentSessionId;
        setStatusInfo(prev => ({ ...prev, sessionId: currentSessionId }));
      }

      // Note: Session outputs are loaded via SSE notifications when the session is loaded
      // No need to call getSessionOutputs() as it would duplicate messages

      // Fetch remote working directory if in remote mode
      if (isRemoteMode) {
        try {
          const cwdResult = await client.getCwd();
          setRemoteCwd(cwdResult.cwd);
          onOutput({
            type: "system",
            content: `📁 Remote working directory: ${cwdResult.cwd}`,
          });
        } catch {
          // Ignore cwd fetch errors
        }
      }
    };

    // Main connection flow
    const connectWithTokenFlow = async () => {
      const client = new HttpAcpClient(url);
      clientRef.current = client;
      setupHandlers(client);

      // Try to connect
      let result = await client.connect();

      // If needs token, prompt user and retry
      while (result.needsToken) {
        const token = await waitForToken();
        client.setToken(token);
        result = await client.connect();

        if (!result.success && !result.needsToken) {
          // Invalid token
          onOutput({ type: "error", content: result.error || "Invalid token" });
        }
      }

      if (!result.success) {
        onOutput({ type: "error", content: `Failed to connect: ${result.error}` });
        return;
      }

      // Connected successfully
      await completeInitialization(client);

      // Save remote server URL for auto-reconnect on next launch
      if (isRemoteMode && serverUrl) {
        setConfig({ lastServerUrl: serverUrl }).catch(() => {});
      }
    };

    connectWithTokenFlow().catch((err) => {
      onOutput({
        type: "error",
        content: `Failed to connect to server: ${err.message}`,
      });
    });

    return () => {
      isMounted = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      clientRef.current?.close();
    };
  }, [serverUrl, continueMode, onOutput, isRemoteMode]);

  return {
    client: clientRef.current,
    connected,
    statusInfo,
    setStatusInfo,
    historyRef,
    remoteCwd,
    isRemoteMode,
    needsToken,
    submitToken,
    permissionRequest,
    respondToPermission,
    cancelPermission,
  };
}
