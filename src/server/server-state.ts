// Server state management - single source of truth for HTTP server state

import { updateSession, resetSession } from "../utils/config";

// Server state - encapsulated in a class for better organization
class ServerState {
  initialized = false;
  currentSessionId: string | null = null;
  runningTaskId: string | null = null;
  accumulatedAssistantText = "";

  // VM connection state
  currentVmId: string | null = null;
  currentVmAgentUrl: string | null = null;

  // Reset state for new session
  resetForNewSession(): void {
    this.accumulatedAssistantText = "";
    resetSession();
  }

  // Get current session ID or throw
  requireSessionId(): string {
    if (!this.currentSessionId) {
      throw new Error("No session active");
    }
    return this.currentSessionId;
  }
}

// Singleton instance
export const serverState = new ServerState();

// Helper functions for server state operations
export function setInitialized(value: boolean): void {
  serverState.initialized = value;
}

export function isInitialized(): boolean {
  return serverState.initialized;
}

export function setCurrentSessionId(id: string | null): void {
  serverState.currentSessionId = id;
  if (id) {
    updateSession({ sessionId: id });
  }
}

export function getCurrentSessionId(): string | null {
  return serverState.currentSessionId;
}

export function setRunningTaskId(id: string | null): void {
  serverState.runningTaskId = id;
}

export function getRunningTaskId(): string | null {
  return serverState.runningTaskId;
}

export function isTaskRunning(): boolean {
  return serverState.runningTaskId !== null;
}

// Text accumulation for streaming responses
export function appendAssistantText(text: string): void {
  serverState.accumulatedAssistantText += text;
}

export function getAccumulatedAssistantText(): string {
  return serverState.accumulatedAssistantText;
}

export function resetAccumulatedAssistantText(): void {
  serverState.accumulatedAssistantText = "";
}

export function flushAccumulatedText(sessionId: string, storeCallback: (type: string, content: string) => void): void {
  if (serverState.accumulatedAssistantText) {
    storeCallback("text", serverState.accumulatedAssistantText);
    serverState.accumulatedAssistantText = "";
  }
}

// VM connection state
export function setCurrentVmId(id: string | null): void {
  serverState.currentVmId = id;
}

export function getCurrentVmId(): string | null {
  return serverState.currentVmId;
}

export function setCurrentVmAgentUrl(url: string | null): void {
  serverState.currentVmAgentUrl = url;
}

export function getCurrentVmAgentUrl(): string | null {
  return serverState.currentVmAgentUrl;
}

// Clear VM connection state
export function clearVmConnection(): void {
  serverState.currentVmId = null;
  serverState.currentVmAgentUrl = null;
}
