// Server state management - single source of truth for HTTP server state

import { randomUUID } from "crypto";
import { sessionStore, sessionOutputStore, type StoredOutput } from "../utils/session-store";
import { getSession, updateSession, setSessionMode, getSessionMode, resetSession } from "../utils/config";
import { logStream } from "../utils/log-stream";

// Server state - encapsulated in a class for better organization
class ServerState {
  initialized = false;
  authenticated = false;
  currentSessionId: string | null = null;
  runningTaskId: string | null = null;
  autoProcessQueue = true;
  currentAgentId = "claude.com";
  accumulatedAssistantText = "";

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

export function setAuthenticated(value: boolean): void {
  serverState.authenticated = value;
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

export function setAutoProcessQueue(value: boolean): void {
  serverState.autoProcessQueue = value;
}

export function shouldAutoProcessQueue(): boolean {
  return serverState.autoProcessQueue;
}

export function setCurrentAgentId(id: string): void {
  serverState.currentAgentId = id;
}

export function getCurrentAgentIdFromState(): string {
  return serverState.currentAgentId;
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
