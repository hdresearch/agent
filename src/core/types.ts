export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TaskConfig {
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  cwd?: string;
}

export interface TaskAttachment {
  type: "file" | "image" | "url";
  content: string; // path, base64, or URL
  mimeType?: string;
}

export interface Task {
  id: string;
  prompt: string;
  config: TaskConfig;
  status: TaskStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: TaskResult;
  events: TaskEvent[];
  attachments?: TaskAttachment[];
}

export interface TaskResult {
  success: boolean;
  durationMs: number;
  totalCostUsd: number;
  numTurns: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export type TaskEventType =
  | "started"
  | "assistant_message"
  | "system_message"
  | "tool_use"
  | "tool_result"
  | "user_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "permission_request";

export interface TaskEvent {
  id: string;
  type: TaskEventType;
  timestamp: Date;
  data: unknown;
}

export interface CreateTaskRequest {
  prompt: string;
  config?: TaskConfig;
}

export interface UserInputRequest {
  input: string;
}
