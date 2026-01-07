import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { getConfig, addToSession, updateSession, getMcpServers, getSessionMode } from "../utils/config";
import type { ProcessedImage } from "../utils/image-utils";

// Get Claude Code executable path at runtime (not module load time)
function getClaudeCodeExecutable(): string | undefined {
  return process.env.CLAUDE_CODE_EXECUTABLE;
}

// Query event types that consumers can subscribe to
export type QueryEventType =
  | "init"
  | "text_delta"
  | "text_complete"
  | "tool_use"
  | "tool_result"
  | "thinking"
  | "result"
  | "error"
  | "cancelled";

export interface QueryEvent {
  type: QueryEventType;
  data: unknown;
}

export interface TextDeltaEvent extends QueryEvent {
  type: "text_delta";
  data: { text: string };
}

export interface TextCompleteEvent extends QueryEvent {
  type: "text_complete";
  data: { text: string };
}

export interface ToolUseEvent extends QueryEvent {
  type: "tool_use";
  data: { name: string; input: Record<string, unknown> };
}

export interface ToolResultEvent extends QueryEvent {
  type: "tool_result";
  data: { toolUseId: string; content: unknown };
}

export interface ThinkingEvent extends QueryEvent {
  type: "thinking";
  data: { thinking: string };
}

export interface ResultEvent extends QueryEvent {
  type: "result";
  data: {
    success: boolean;
    durationMs: number;
    totalCostUsd: number;
    numTurns: number;
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ErrorEvent extends QueryEvent {
  type: "error";
  data: { message: string };
}

export interface InitEvent extends QueryEvent {
  type: "init";
  data: { sessionId?: string; resumed: boolean };
}

export interface CancelledEvent extends QueryEvent {
  type: "cancelled";
  data: Record<string, never>;
}

// Options for running a query
export interface RunQueryOptions {
  prompt: string;
  // Override global config
  model?: string;
  thinkingBudget?: number | null;
  // Session management
  resume?: string; // session ID to resume
  continueLastSession?: boolean;
  // Execution options
  cwd?: string;
  systemPrompt?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  // Image attachments
  images?: ProcessedImage[];
  // MCP servers (if not provided, uses global config)
  mcpServers?: Record<string, unknown>;
  // Use session mode (default/plan) - if true, uses getSessionMode()
  useSessionMode?: boolean;
}

export interface QueryHandle {
  // Async iterator for events
  events: AsyncIterable<QueryEvent>;
  // Cancel the query
  cancel: () => Promise<void>;
  // Check if running
  isRunning: () => boolean;
}

// Run a query and return an async iterator of events
export function runQuery(options: RunQueryOptions): QueryHandle {
  const globalConfig = getConfig();

  // Merge options with global config
  const model = options.model || globalConfig.model;
  const thinkingBudget = options.thinkingBudget !== undefined
    ? options.thinkingBudget
    : globalConfig.thinkingBudget;

  // Determine permission mode - check session mode if useSessionMode is true
  let permMode: "default" | "acceptEdits" | "bypassPermissions" | "plan" = options.permissionMode ?? "bypassPermissions";
  if (options.useSessionMode !== false) {
    const sessionMode = getSessionMode();
    if (sessionMode === "plan") {
      permMode = "plan";
    }
  }

  let queryInstance: Query | null = null;
  let running = true;

  // Create async generator for events
  async function* generateEvents(): AsyncGenerator<QueryEvent> {
    let currentText = "";

    try {
      // Get MCP servers from options or global config
      const mcpServers = options.mcpServers ?? getMcpServers();

      const queryOptions: Record<string, unknown> = {
        model,
        systemPrompt: options.systemPrompt,
        cwd: options.cwd || process.cwd(),
        maxTurns: options.maxTurns ?? 50,
        maxBudgetUsd: options.maxBudgetUsd,
        allowedTools: options.allowedTools,
        permissionMode: permMode,
        allowDangerouslySkipPermissions: permMode === "bypassPermissions",
        includePartialMessages: true,
      };

      // Add MCP servers if any are configured
      if (Object.keys(mcpServers).length > 0) {
        queryOptions.mcpServers = mcpServers;
      }

      // Add optional parameters
      const claudeCodePath = getClaudeCodeExecutable();
      if (claudeCodePath) {
        queryOptions.pathToClaudeCodeExecutable = claudeCodePath;
      }
      if (thinkingBudget) {
        queryOptions.maxThinkingTokens = thinkingBudget;
      }
      if (options.continueLastSession) {
        queryOptions.continue = true;
      } else if (options.resume) {
        queryOptions.resume = options.resume;
      }

      // Build prompt - with or without images
      let promptInput: string | AsyncIterable<SDKUserMessage>;

      if (options.images && options.images.length > 0) {
        // Build content array with text and images
        const contentBlocks: Array<
          | { type: "text"; text: string }
          | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
        > = [];

        // Add text first
        if (options.prompt) {
          contentBlocks.push({ type: "text", text: options.prompt });
        }

        // Add images
        for (const img of options.images) {
          if (img.base64 && !img.error) {
            contentBlocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mediaType,
                data: img.base64,
              },
            });
          }
        }

        // Create async iterable with single user message
        async function* createUserMessageStream(): AsyncIterable<SDKUserMessage> {
          yield {
            type: "user",
            message: {
              role: "user",
              content: contentBlocks,
            },
            parent_tool_use_id: null,
            session_id: "", // Will be populated by SDK
          } as SDKUserMessage;
        }

        promptInput = createUserMessageStream();
      } else {
        // Simple string prompt
        promptInput = options.prompt;
      }

      const q = query({
        prompt: promptInput,
        options: queryOptions,
      });
      queryInstance = q;

      for await (const msg of q) {
        // Track session ID
        if ("session_id" in msg && msg.session_id) {
          updateSession({ sessionId: msg.session_id as string });
          yield {
            type: "init",
            data: {
              sessionId: msg.session_id as string,
              resumed: !!(options.resume || options.continueLastSession)
            },
          } as InitEvent;
        }

        if (msg.type === "assistant") {
          const content = msg.message?.content;
          if (content) {
            for (const block of content) {
              if ("text" in block && block.text) {
                const newText = block.text.slice(currentText.length);
                if (newText) {
                  yield { type: "text_delta", data: { text: newText } } as TextDeltaEvent;
                  currentText = block.text;
                }
              } else if ("name" in block) {
                yield {
                  type: "tool_use",
                  data: {
                    name: block.name,
                    input: (block.input || {}) as Record<string, unknown>,
                  },
                } as ToolUseEvent;
              } else if ("thinking" in block && block.thinking) {
                yield {
                  type: "thinking",
                  data: { thinking: block.thinking as string },
                } as ThinkingEvent;
              }
            }
          }
        } else if (msg.type === "user") {
          // Tool results come back as user messages
          const content = msg.message?.content;
          if (content) {
            for (const block of content) {
              if ("tool_use_id" in block) {
                yield {
                  type: "tool_result",
                  data: {
                    toolUseId: block.tool_use_id,
                    content: block.content,
                  },
                } as ToolResultEvent;
              }
            }
          }
        } else if (msg.type === "stream_event") {
          const event = msg.event;
          if (event.type === "content_block_delta" && "delta" in event) {
            const delta = event.delta as { type: string; text?: string; thinking?: string };
            if (delta.type === "text_delta" && delta.text) {
              currentText += delta.text; // Track accumulated text to avoid duplicates
              yield { type: "text_delta", data: { text: delta.text } } as TextDeltaEvent;
            } else if (delta.type === "thinking_delta" && delta.thinking) {
              yield { type: "thinking", data: { thinking: delta.thinking } } as ThinkingEvent;
            }
          }
        } else if (msg.type === "result") {
          const inputTokens = msg.usage?.input_tokens ?? 0;
          const outputTokens = msg.usage?.output_tokens ?? 0;

          // Update global session stats
          addToSession(msg.total_cost_usd, inputTokens, outputTokens);

          yield {
            type: "result",
            data: {
              success: msg.subtype === "success",
              durationMs: msg.duration_ms,
              totalCostUsd: msg.total_cost_usd,
              numTurns: msg.num_turns,
              inputTokens,
              outputTokens,
            },
          } as ResultEvent;

          // Emit text_complete if we have accumulated text
          if (currentText) {
            yield { type: "text_complete", data: { text: currentText } } as TextCompleteEvent;
          }
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Check if this was a cancellation
      if (errorMsg.includes("aborted") || errorMsg.includes("interrupted")) {
        yield { type: "cancelled", data: {} } as CancelledEvent;
      } else {
        yield { type: "error", data: { message: errorMsg } } as ErrorEvent;
      }
    } finally {
      running = false;
      queryInstance = null;
    }
  }

  return {
    events: generateEvents(),
    cancel: async () => {
      if (queryInstance) {
        await queryInstance.interrupt();
        queryInstance = null;
        running = false;
      }
    },
    isRunning: () => running,
  };
}

// Convenience type for pattern matching events
export type AnyQueryEvent =
  | InitEvent
  | TextDeltaEvent
  | TextCompleteEvent
  | ToolUseEvent
  | ToolResultEvent
  | ThinkingEvent
  | ResultEvent
  | ErrorEvent
  | CancelledEvent;
