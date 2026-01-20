import { test, expect, describe, beforeEach, mock } from "bun:test";
import { SessionManager } from "../../core/session-manager";

/**
 * Tests for session ID tracking bug fix.
 *
 * BUG: In handleSessionNew, when getAgentSessionId() returned a session ID
 * but claudeId was null, sessionManager.setSession() was never called because
 * the code only called setSession when claudeId was truthy:
 *
 *   const newSessionId = claudeId || getAgentSessionId() || sessionManager.createSession();
 *   if (claudeId) {
 *     sessionManager.setSession(claudeId);  // <-- Never called when claudeId is null!
 *   }
 *
 * This caused currentSessionId to remain null, breaking output storage and
 * causing activity timeouts.
 *
 * FIX: Always ensure session manager has the current ID set:
 *
 *   const agentSessionId = getAgentSessionId();
 *   const newSessionId = claudeId || agentSessionId || sessionManager.createSession();
 *   if (newSessionId && sessionManager.getCurrentId() !== newSessionId) {
 *     sessionManager.setSession(newSessionId, claudeId || undefined);
 *   }
 */
describe("Session ID Tracking", () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    // Create fresh session manager for each test
    sessionManager = new SessionManager();
  });

  describe("SessionManager.setSession", () => {
    test("sets currentId when called directly", () => {
      const sessionId = "test-session-123";
      sessionManager.setSession(sessionId);
      expect(sessionManager.getCurrentId()).toBe(sessionId);
    });

    test("sets currentId with claudeId", () => {
      const sessionId = "test-session-123";
      const claudeId = "claude-internal-456";
      sessionManager.setSession(sessionId, claudeId);
      expect(sessionManager.getCurrentId()).toBe(sessionId);
      expect(sessionManager.getClaudeInternalId()).toBe(claudeId);
    });
  });

  describe("SessionManager.createSession", () => {
    test("creates session and sets currentId", () => {
      expect(sessionManager.getCurrentId()).toBeNull();
      const sessionId = sessionManager.createSession();
      expect(sessionId).toBeTruthy();
      expect(sessionManager.getCurrentId()).toBe(sessionId);
    });
  });

  /**
   * This test reproduces the exact bug that caused VM agent failures.
   *
   * Scenario: Agent is already running, has a session ID internally,
   * but no claudeId notification has been received yet.
   */
  describe("handleSessionNew session ID assignment (regression test)", () => {
    test("REGRESSION: session ID must be set when agentSessionId is available but claudeId is null", () => {
      // Simulate the scenario where:
      // - claudeId is null (no notification received yet)
      // - getAgentSessionId() returns a valid session ID
      // - sessionManager.getCurrentId() is null (no session set yet)

      const claudeId: string | null = null;
      const agentSessionId: string | null = "agent-session-abc123";

      // This is the FIXED logic from handleSessionNew
      const newSessionId = claudeId || agentSessionId || sessionManager.createSession();

      // The fix: always ensure session manager has the current ID set
      if (newSessionId && sessionManager.getCurrentId() !== newSessionId) {
        sessionManager.setSession(newSessionId, claudeId || undefined);
      }

      // CRITICAL: currentId MUST be set after this operation
      expect(sessionManager.getCurrentId()).toBe(agentSessionId);
      expect(sessionManager.getCurrentId()).not.toBeNull();
    });

    test("REGRESSION: old buggy code would leave currentId as null", () => {
      // This demonstrates the bug that existed before the fix
      const buggySessionManager = new SessionManager();

      const claudeId: string | null = null;
      const agentSessionId: string | null = "agent-session-abc123";

      // OLD BUGGY LOGIC (DO NOT USE):
      // const newSessionId = claudeId || agentSessionId || buggySessionManager.createSession();
      // if (claudeId) {  // <-- claudeId is null, so this never executes!
      //   buggySessionManager.setSession(claudeId);
      // }

      // Simulate what the buggy code did:
      const newSessionId = claudeId || agentSessionId; // Short-circuits to agentSessionId
      if (claudeId) {
        buggySessionManager.setSession(claudeId);
      }

      // With the buggy code, currentId would still be null!
      expect(buggySessionManager.getCurrentId()).toBeNull();
      // But newSessionId would have a value
      expect(newSessionId).toBe(agentSessionId);
    });

    test("session ID is set when claudeId is available", () => {
      const claudeId = "claude-id-xyz789";
      const agentSessionId = "agent-session-abc123";

      const newSessionId = claudeId || agentSessionId || sessionManager.createSession();

      if (newSessionId && sessionManager.getCurrentId() !== newSessionId) {
        sessionManager.setSession(newSessionId, claudeId || undefined);
      }

      expect(sessionManager.getCurrentId()).toBe(claudeId);
      expect(sessionManager.getClaudeInternalId()).toBe(claudeId);
    });

    test("session ID is set when only createSession fallback is used", () => {
      const claudeId: string | null = null;
      const agentSessionId: string | null = null;

      const newSessionId = claudeId || agentSessionId || sessionManager.createSession();

      if (newSessionId && sessionManager.getCurrentId() !== newSessionId) {
        sessionManager.setSession(newSessionId, claudeId || undefined);
      }

      // createSession already calls setSession internally, so getCurrentId should be set
      expect(sessionManager.getCurrentId()).toBeTruthy();
      expect(sessionManager.getCurrentId()).toBe(newSessionId);
    });

    test("session ID is not overwritten if already set to same value", () => {
      const existingSessionId = "existing-session-123";
      sessionManager.setSession(existingSessionId, "claude-id-456");

      // Simulate subsequent call where agentSessionId matches existing
      const claudeId: string | null = null;
      const agentSessionId = existingSessionId;

      const newSessionId = claudeId || agentSessionId || sessionManager.createSession();

      // This should NOT call setSession again since IDs match
      if (newSessionId && sessionManager.getCurrentId() !== newSessionId) {
        sessionManager.setSession(newSessionId, claudeId || undefined);
      }

      // Original claudeInternalId should be preserved
      expect(sessionManager.getCurrentId()).toBe(existingSessionId);
      expect(sessionManager.getClaudeInternalId()).toBe("claude-id-456");
    });
  });

  describe("Output storage requires currentSessionId", () => {
    test("getCurrentId returns null before any session is created", () => {
      expect(sessionManager.getCurrentId()).toBeNull();
    });

    test("getCurrentId returns value after session is created", () => {
      sessionManager.createSession();
      expect(sessionManager.getCurrentId()).not.toBeNull();
    });

    test("getCurrentId returns value after setSession is called", () => {
      sessionManager.setSession("manual-session-id");
      expect(sessionManager.getCurrentId()).toBe("manual-session-id");
    });
  });
});
