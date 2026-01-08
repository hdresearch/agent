// Query runner - DEPRECATED
// This file previously used the Claude Agent SDK directly.
// All queries now go through the ACP subprocess runner via agent-manager.ts
//
// This file is kept for backwards compatibility but will be removed.

export type QueryEventType = "init" | "text_delta" | "text_complete" | "tool_use" | "tool_result" | "thinking" | "result" | "error" | "cancelled";

export interface QueryEvent {
  type: QueryEventType;
  data: unknown;
}

export interface QueryHandle {
  events: AsyncIterable<QueryEvent>;
  cancel: () => Promise<void>;
  isRunning: () => boolean;
}

export interface RunQueryOptions {
  prompt: string;
  model?: string;
  thinkingBudget?: number | null;
  resume?: string;
  continueLastSession?: boolean;
  cwd?: string;
  systemPrompt?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  images?: Array<{
    id: number;
    path: string;
    mediaType: string;
    base64?: string;
    error?: string;
  }>;
  mcpServers?: Record<string, unknown>;
  useSessionMode?: boolean;
}

/**
 * @deprecated Use agent-manager.ts runTask instead
 */
export function runQuery(_options: RunQueryOptions): QueryHandle {
  throw new Error(
    "runQuery is deprecated. Use agent-manager.ts runTask with ACP subprocess runner instead."
  );
}

// Re-export types for compatibility
export type AnyQueryEvent = QueryEvent;
