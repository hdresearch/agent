/**
 * SessionManager - Single source of truth for session ID management
 *
 * This module consolidates session ID handling that was previously spread across:
 * - server-state.ts (currentSessionId)
 * - acp-client.ts (sessionId, claudeSessionId)
 * - config.ts (lastSessionId)
 * - agent-manager.ts (callbacks)
 *
 * ## Two Session ID Concepts
 *
 * Claude Code has two different session ID systems that serve different purposes:
 *
 * 1. **ACP Session ID** (UUID format, e.g., "550e8400-e29b-41d4-a716-446655440000")
 *    - The session identifier used in the ACP protocol
 *    - Sent in session/new response and session/update notifications
 *    - Used for routing prompts within Claude Code's ACP interface
 *
 * 2. **Claude Internal ID** (8-char format, e.g., "a1b2c3d4")
 *    - Claude CLI's internal session identifier
 *    - Sent in session/update notifications
 *    - Required for --resume flag to restore previous context
 *    - This is what Claude CLI actually uses to persist and restore sessions
 *
 * The SessionManager abstracts this complexity by:
 * - Exposing a single "current session ID" to consumers
 * - Internally tracking the Claude internal ID for resume functionality
 * - Handling the synchronization with persistent storage
 */

import { updateSession, getSession, setConfigSync, resetSession as resetConfigSession } from "../utils/config";
import { sessionStore, sessionOutputStore } from "../utils/session-store";
import { logStream } from "../utils/log-stream";

function debug(message: string, data?: unknown): void {
  logStream.debug(`[session-manager] ${message}`, data);
}

function info(message: string, data?: unknown): void {
  logStream.info(`[session-manager] ${message}`, data);
}

/**
 * SessionManager manages session lifecycle and ID tracking.
 *
 * Usage:
 * ```typescript
 * const manager = new SessionManager();
 *
 * // Create new session
 * const sessionId = manager.createSession();
 *
 * // Update with ID from agent notification
 * manager.updateFromNotification(notificationSessionId);
 *
 * // Get current session ID
 * const id = manager.getCurrentId();
 *
 * // Get Claude's internal ID for resume
 * const claudeId = manager.getClaudeInternalId();
 *
 * // Clear session (e.g., for /clear command)
 * manager.clearSession();
 * ```
 */
export class SessionManager {
  /**
   * The canonical session ID - this is what we show to users and store in SQLite.
   * Typically a UUID from the ACP session/new response or notification.
   */
  private currentId: string | null = null;

  /**
   * Claude CLI's internal session ID (8-char format).
   * Captured from the first session/update notification.
   * This is immutable for the session lifetime - used for --resume.
   */
  private claudeInternalId: string | null = null;

  /**
   * Whether the Claude internal ID has been captured.
   * We only capture it once per session to ensure consistency for resume.
   */
  private claudeIdCaptured = false;

  /**
   * Get the current session ID.
   * This is the ID shown to users and used for session storage.
   */
  getCurrentId(): string | null {
    return this.currentId;
  }

  /**
   * Get Claude CLI's internal session ID.
   * This is the 8-char ID needed for the --resume flag.
   * Returns null if not yet received from agent.
   */
  getClaudeInternalId(): string | null {
    return this.claudeInternalId;
  }

  /**
   * Check if we have a Claude internal ID.
   * Useful for determining if resume is possible.
   */
  hasClaudeInternalId(): boolean {
    return this.claudeInternalId !== null;
  }

  /**
   * Create a new session with a generated ID.
   * Called when starting a fresh session (not resuming).
   * @returns The new session ID
   */
  createSession(): string {
    const id = crypto.randomUUID();
    this.setSession(id);
    info("Created new session", { sessionId: id });
    return id;
  }

  /**
   * Set the current session ID.
   * This updates all storage locations (memory, SQLite, config).
   * @param id - The session ID to set
   * @param claudeId - Optional Claude internal ID (8-char format)
   */
  setSession(id: string, claudeId?: string): void {
    const previousId = this.currentId;
    this.currentId = id;

    // Capture Claude internal ID if provided and not already captured
    if (claudeId && !this.claudeIdCaptured) {
      this.claudeInternalId = claudeId;
      this.claudeIdCaptured = true;
      debug("Captured Claude internal ID", { claudeId });
    }

    // Sync to config (persists lastSessionId)
    updateSession({ sessionId: id });

    // Ensure session exists in SQLite
    sessionStore.getOrCreate(id);

    debug("Session set", { previousId, newId: id, claudeInternalId: this.claudeInternalId });
  }

  /**
   * Update session ID from an agent notification.
   * Called when receiving session/update notifications from Claude Code.
   *
   * The first notification's sessionId is captured as the Claude internal ID
   * for resume functionality.
   *
   * @param notificationSessionId - Session ID from the notification
   */
  updateFromNotification(notificationSessionId: string): void {
    // Capture Claude internal ID from first notification
    if (!this.claudeIdCaptured) {
      this.claudeInternalId = notificationSessionId;
      this.claudeIdCaptured = true;
      info("Captured Claude internal ID from notification", { claudeId: notificationSessionId });
    }

    // Update current ID if we don't have one yet
    if (!this.currentId) {
      this.setSession(notificationSessionId);
    }
  }

  /**
   * Load an existing session for resume.
   * @param sessionId - The session ID to resume
   * @returns true if session exists in storage
   */
  loadSession(sessionId: string): boolean {
    const existing = sessionStore.get(sessionId);
    if (!existing) {
      debug("Session not found in storage", { sessionId });
      return false;
    }

    // Set as current session
    this.currentId = sessionId;

    // For resume, we assume the sessionId IS the Claude internal ID
    // (since that's what we stored originally)
    if (!this.claudeIdCaptured) {
      this.claudeInternalId = sessionId;
      this.claudeIdCaptured = true;
    }

    // Touch session to update lastUsedAt
    sessionStore.touch(sessionId);

    // Sync to config
    updateSession({ sessionId });

    info("Loaded session", { sessionId });
    return true;
  }

  /**
   * Clear the current session.
   * Called for /clear command to start fresh.
   */
  clearSession(): void {
    const previousId = this.currentId;
    this.currentId = null;
    this.claudeInternalId = null;
    this.claudeIdCaptured = false;

    // Reset config session stats
    resetConfigSession();

    info("Session cleared", { previousId });
  }

  /**
   * Reset for a new session without clearing storage.
   * Called when creating a new session to reset accumulated text, etc.
   */
  resetForNewSession(): void {
    this.claudeIdCaptured = false;
    resetConfigSession();
    debug("Reset for new session");
  }

  /**
   * Get the session ID to use for resume.
   * This returns the Claude internal ID if available, falling back to current ID.
   */
  getResumeId(): string | null {
    return this.claudeInternalId || this.currentId;
  }

  /**
   * Check if a resume attempt was successful.
   * Call this after requesting resume to verify Claude accepted it.
   * @param requestedId - The ID we requested to resume
   * @returns true if Claude resumed the requested session
   */
  verifyResume(requestedId: string): boolean {
    // If Claude gave us back the same ID we requested, resume succeeded
    if (this.claudeInternalId === requestedId) {
      return true;
    }

    // If we got a different ID, Claude created a new session instead
    if (this.claudeInternalId && this.claudeInternalId !== requestedId) {
      info("Resume verification failed - Claude created new session", {
        requestedId,
        actualId: this.claudeInternalId,
      });
      return false;
    }

    // No ID yet - can't verify
    return false;
  }

  /**
   * Require a session ID or throw.
   * Use in handlers that need an active session.
   */
  requireSessionId(): string {
    if (!this.currentId) {
      throw new Error("No session active");
    }
    return this.currentId;
  }
}

// Singleton instance for global access
export const sessionManager = new SessionManager();
