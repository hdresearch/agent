// CLI type definitions

export type OutputLine = {
  id: string;
  type: "user" | "text" | "tool" | "tool-result" | "system" | "error" | "stats";
  content: string;
  color?: string;
  toolName?: string;
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
  thinking: {
    enabled: boolean;
    budget?: number | null;
  };
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
