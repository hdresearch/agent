import { useState, useEffect, useRef, useCallback } from "react";
import { HttpAcpClient, type ConnectResult } from "../../client/http-client";
import type { SessionNotificationParams, SessionConfig } from "../../protocol/acp-types";
import { detectKeys } from "../../utils/keys";
import type { OutputLine, StatusInfo } from "../types";
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
}

export function useAcpClient({
  serverUrl,
  continueMode,
  sessionConfig,
  onOutput,
}: UseAcpClientOptions): UseAcpClientResult {
  const [connected, setConnected] = useState(false);
  const [remoteCwd, setRemoteCwd] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const clientRef = useRef<HttpAcpClient | null>(null);
  const historyRef = useRef<ConversationHistory | null>(null);
  const sessionConfigRef = useRef(sessionConfig);
  const pendingTokenResolve = useRef<((token: string) => void) | null>(null);

  // Remote mode: only when connecting to a non-localhost server
  const isRemoteMode = (() => {
    if (!serverUrl) return false;
    try {
      const url = new URL(serverUrl);
      const host = url.hostname.toLowerCase();
      return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
    } catch {
      return false;
    }
  })();

  // Callback to submit token when prompted
  const submitToken = useCallback((token: string) => {
    if (pendingTokenResolve.current) {
      pendingTokenResolve.current(token);
      pendingTokenResolve.current = null;
    }
    setNeedsToken(false);
  }, []);

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

          case "tool_call":
            if ("toolName" in data) {
              const toolName = data.toolName as string;
              const toolArgs = formatToolArgs(toolName, (data.input || {}) as Record<string, unknown>);
              onOutput({ type: "tool", content: toolArgs, toolName });
              if (historyRef.current) {
                addMessage(historyRef.current, "tool", toolArgs, toolName);
                saveHistory(historyRef.current);
              }
            }
            break;

          case "tool_result":
            onOutput({ type: "tool-result", content: "" });
            break;

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
            const mostRecent = sessions.sessions[0];
            const loadResult = await client.loadSession(mostRecent.id);
            currentSessionId = loadResult.sessionId;
            sessionLoaded = true;
          }
        } catch {
          // Fall back to new session
        }
      }

      if (!sessionLoaded) {
        const newResult = await client.newSession(sessionConfigRef.current);
        currentSessionId = newResult.sessionId;
      }

      if (currentSessionId) {
        setStatusInfo(prev => ({ ...prev, sessionId: currentSessionId }));
      }

      // Sync outputs from server
      try {
        const outputsResult = await client.getSessionOutputs();
        if (outputsResult.outputs.length > 0) {
          onOutput({ type: "system", content: `📜 Loading ${outputsResult.outputs.length} previous messages...` });
          for (const output of outputsResult.outputs) {
            onOutput({
              type: output.type as OutputLine["type"],
              content: output.content,
              color: output.color,
              toolName: output.toolName,
            });
          }
        }
      } catch {
        // Ignore sync errors
      }

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
      setupNotificationHandler(client);

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
  };
}
