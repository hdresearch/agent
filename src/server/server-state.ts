// Server state management - single source of truth for HTTP server state
// Note: Session ID management has been moved to SessionManager (src/core/session-manager.ts)

import { sessionManager } from "../core/session-manager";

// Server state - encapsulated in a class for better organization
class ServerState {
  initialized = false;
  runningTaskId: string | null = null;
  accumulatedAssistantText = "";

  // VM connection state
  currentVmId: string | null = null;
  currentVmAgentUrl: string | null = null;

  // Reset state for new session
  resetForNewSession(): void {
    this.accumulatedAssistantText = "";
    sessionManager.resetForNewSession();
  }

  // Get current session ID or throw (delegates to sessionManager)
  requireSessionId(): string {
    return sessionManager.requireSessionId();
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

// Session ID functions - delegate to SessionManager for backward compatibility
// New code should import from '../core/session-manager' directly

export function setCurrentSessionId(id: string | null): void {
  if (id) {
    sessionManager.setSession(id);
  } else {
    sessionManager.clearSession();
  }
}

export function getCurrentSessionId(): string | null {
  return sessionManager.getCurrentId();
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
