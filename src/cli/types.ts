// CLI type definitions

// ACP tool kinds
export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";

// ACP tool status
export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

// ACP tool call location
export interface ToolLocation {
  path: string;
  line?: number;
}

// ACP tool call content types
export interface ToolContentDiff {
  type: "diff";
  path: string;
  oldText?: string;
  newText: string;
}

export interface ToolContentTerminal {
  type: "terminal";
  terminalId: string;
}

export interface ToolContentText {
  type: "content";
  content: { type: "text"; text: string };
}

export type ToolContent = ToolContentDiff | ToolContentTerminal | ToolContentText;

export type OutputLine = {
  id: string;
  type: "user" | "text" | "tool" | "tool-result" | "system" | "error" | "stats";
  content: string;
  color?: string;
  toolName?: string;
  // Rich ACP tool information
  toolTitle?: string;       // Human-readable title like "Read(file.ts) - Read 132 lines"
  toolKind?: ToolKind;      // Type of tool operation
  toolStatus?: ToolStatus;  // Current status
  toolCallId?: string;      // ID to match tool calls with results
  toolLocations?: ToolLocation[];  // File locations being accessed
  toolContent?: ToolContent[];     // Rich content (diffs, terminal output, etc.)
  // Streaming text support
  streaming?: boolean;      // True if this is a streaming chunk (not final)
};

export type AppState = {
  status: "idle" | "thinking" | "running-tool";
  currentTool?: string;
};

export interface CliOptions {
  continueSession?: boolean;
  serverUrl?: string;
}

export interface StatusInfo {
  model: string;
  cost: {
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  };
  planMode: boolean;
  sessionId: string | null;
}

export interface PathMatch {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface ProcessedImage {
  id: number;
  path: string;
  mediaType: string;
  base64: string;
}

// Permission request types
export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface PermissionOption {
  optionId: string;
  kind: PermissionOptionKind;
  name: string;
}

export interface PermissionToolCall {
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolStatus;
  locations?: ToolLocation[];
  content?: ToolContent[];
}

export interface PermissionRequest {
  requestId: string;
  toolCall: PermissionToolCall;
  options: PermissionOption[];
}
