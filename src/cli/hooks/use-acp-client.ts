import { useState, useEffect, useRef, useCallback } from "react";
import { HttpAcpClient, connectToAcpServer } from "../../client/http-client";
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
import { getConfig } from "../../utils/config";

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
}

export function useAcpClient({
  serverUrl,
  continueMode,
  sessionConfig,
  onOutput,
}: UseAcpClientOptions): UseAcpClientResult {
  const [connected, setConnected] = useState(false);
  const [remoteCwd, setRemoteCwd] = useState<string | null>(null);
  const clientRef = useRef<HttpAcpClient | null>(null);
  const historyRef = useRef<ConversationHistory | null>(null);
  const sessionConfigRef = useRef(sessionConfig);

  // Remote mode: always use server for bash when connected via URL
  const isRemoteMode = !!serverUrl;

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
  });

  // Keep session config ref in sync
  useEffect(() => {
    sessionConfigRef.current = sessionConfig;
  }, [sessionConfig]);

  // Load conversation history on startup if continue mode
  useEffect(() => {
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
  }, [continueMode, persistedConfig.lastSessionId, onOutput]);

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
                setStatusInfo(prev => {
                  // Only show messages when actually changing modes
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
              // Text content from agent
              if ("text" in data && data.text) {
                const text = data.text as string;
                onOutput({ type: "text", content: text });
                // Save to history
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
                // Save to history
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
              // Plan entries updated
              if ("entries" in data && Array.isArray(data.entries)) {
                const entries = data.entries as Array<{ id: string; description: string; status: string }>;
                if (entries.length > 0) {
                  onOutput({ type: "system", content: `📋 Plan updated (${entries.length} entries):` });
                  for (const entry of entries.slice(0, 5)) { // Show first 5
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
          onOutput({
            type: "system",
            content: "↩ Ready to continue (session state managed by Claude Code)",
          });
        } else {
          await client.newSession(sessionConfigRef.current);
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
      })
      .catch((err) => {
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
  };
}
