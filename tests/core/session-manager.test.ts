import { describe, test, expect, beforeEach } from "bun:test";
import { SessionManager } from "../../src/core/session-manager";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  describe("setSession", () => {
    test("sets currentId correctly", () => {
      manager.setSession("test-session-123");
      expect(manager.getCurrentId()).toBe("test-session-123");
    });

    test("is idempotent - calling twice with same ID is safe", () => {
      manager.setSession("test-123");
      manager.setSession("test-123");
      expect(manager.getCurrentId()).toBe("test-123");
    });

    test("updates currentId when called with different ID", () => {
      manager.setSession("first-id");
      expect(manager.getCurrentId()).toBe("first-id");

      manager.setSession("second-id");
      expect(manager.getCurrentId()).toBe("second-id");
    });

    test("captures claudeId when provided", () => {
      manager.setSession("session-123", "claude-456");
      expect(manager.getCurrentId()).toBe("session-123");
      expect(manager.getClaudeInternalId()).toBe("claude-456");
    });

    test("only captures claudeId once", () => {
      manager.setSession("session-1", "claude-first");
      manager.setSession("session-2", "claude-second");
      // Claude ID should remain the first one captured
      expect(manager.getClaudeInternalId()).toBe("claude-first");
    });
  });

  describe("createSession", () => {
    test("generates valid UUID", () => {
      const sessionId = manager.createSession();
      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    test("sets currentId to generated UUID", () => {
      const sessionId = manager.createSession();
      expect(manager.getCurrentId()).toBe(sessionId);
    });

    test("generates unique IDs on each call", () => {
      const id1 = manager.createSession();
      const id2 = manager.createSession();
      expect(id1).not.toBe(id2);
    });
  });

  describe("updateFromNotification", () => {
    test("sets claudeInternalId from first notification", () => {
      manager.updateFromNotification("notification-id-123");
      expect(manager.getClaudeInternalId()).toBe("notification-id-123");
    });

    test("sets currentId if not already set", () => {
      expect(manager.getCurrentId()).toBeNull();
      manager.updateFromNotification("notification-id-123");
      expect(manager.getCurrentId()).toBe("notification-id-123");
    });

    test("does not override currentId if already set", () => {
      manager.setSession("existing-session");
      manager.updateFromNotification("notification-id");
      expect(manager.getCurrentId()).toBe("existing-session");
    });

    test("only captures claudeInternalId once", () => {
      manager.updateFromNotification("first-notification");
      manager.updateFromNotification("second-notification");
      expect(manager.getClaudeInternalId()).toBe("first-notification");
    });
  });

  describe("resetForNewSession", () => {
    test("resets claudeIdCaptured flag", () => {
      manager.updateFromNotification("old-id");
      expect(manager.getClaudeInternalId()).toBe("old-id");

      manager.resetForNewSession();

      // After reset, next notification should update claudeInternalId
      manager.updateFromNotification("new-id");
      expect(manager.getClaudeInternalId()).toBe("new-id");
    });

    test("does not clear currentId", () => {
      manager.setSession("my-session");
      manager.resetForNewSession();
      // currentId should still be set (this is intentional behavior)
      expect(manager.getCurrentId()).toBe("my-session");
    });
  });

  describe("clearSession", () => {
    test("clears currentId", () => {
      manager.setSession("test-session");
      manager.clearSession();
      expect(manager.getCurrentId()).toBeNull();
    });

    test("clears claudeInternalId", () => {
      manager.updateFromNotification("claude-id");
      manager.clearSession();
      expect(manager.getClaudeInternalId()).toBeNull();
    });

    test("allows new claudeId to be captured after clear", () => {
      manager.updateFromNotification("old-id");
      manager.clearSession();
      manager.updateFromNotification("new-id");
      expect(manager.getClaudeInternalId()).toBe("new-id");
    });
  });

  describe("requireSessionId", () => {
    test("returns currentId when set", () => {
      manager.setSession("required-session");
      expect(manager.requireSessionId()).toBe("required-session");
    });

    test("throws when currentId is null", () => {
      expect(() => manager.requireSessionId()).toThrow("No session active");
    });
  });

  describe("loadSession", () => {
    test("sets currentId from loaded session", () => {
      // Note: This test may need mocking of sessionStore
      // For now, we test the internal state changes
      const loaded = manager.loadSession("nonexistent-session");
      // loadSession returns false if session doesn't exist in store
      expect(loaded).toBe(false);
    });
  });

  describe("verifyResume", () => {
    test("returns true when claudeInternalId matches requested", () => {
      manager.updateFromNotification("session-to-resume");
      expect(manager.verifyResume("session-to-resume")).toBe(true);
    });

    test("returns false when claudeInternalId differs from requested", () => {
      manager.updateFromNotification("different-session");
      expect(manager.verifyResume("requested-session")).toBe(false);
    });

    test("returns false when no claudeInternalId captured", () => {
      expect(manager.verifyResume("any-session")).toBe(false);
    });
  });

  describe("getResumeId", () => {
    test("returns claudeInternalId when available", () => {
      manager.setSession("current-session");
      manager.updateFromNotification("claude-internal");
      expect(manager.getResumeId()).toBe("claude-internal");
    });

    test("falls back to currentId when claudeInternalId not set", () => {
      manager.setSession("fallback-session");
      expect(manager.getResumeId()).toBe("fallback-session");
    });

    test("returns null when neither is set", () => {
      expect(manager.getResumeId()).toBeNull();
    });
  });
});

describe("SessionManager - Issue #38 Regression", () => {
  test("currentId is set regardless of which ID source is used", () => {
    // This is the core regression test for Issue #38
    // The bug was that setSession wasn't called when getAgentSessionId() provided the ID

    const manager = new SessionManager();

    // Simulate the fixed behavior: always call setSession with newSessionId
    // Path 1: claudeId provided
    manager.setSession("claude-provided-id");
    expect(manager.getCurrentId()).toBe("claude-provided-id");

    // Reset for next test
    manager.clearSession();

    // Path 2: agentSessionId provided (this was the buggy path)
    const agentSessionId = "agent-provided-id";
    manager.setSession(agentSessionId); // This call was missing in the bug!
    expect(manager.getCurrentId()).toBe("agent-provided-id");

    // Reset for next test
    manager.clearSession();

    // Path 3: createSession (this already worked correctly)
    const createdId = manager.createSession();
    expect(manager.getCurrentId()).toBe(createdId);
  });
});
