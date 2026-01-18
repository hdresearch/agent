import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { sessionManager } from "../../../src/core/session-manager";

// Mock the dependencies
const mockIsAgentRunning = mock(() => true);
const mockGetAgentSessionId = mock(() => "mocked-agent-session-id");
const mockInitializeAgent = mock(() => Promise.resolve());
const mockClearProjectDocsCache = mock(() => {});

// Mock the imports
mock.module("../../../src/core/agent-manager", () => ({
  isAgentRunning: mockIsAgentRunning,
  getAgentSessionId: mockGetAgentSessionId,
  initializeAgent: mockInitializeAgent,
  clearProjectDocsCache: mockClearProjectDocsCache,
}));

// Import after mocking
import { handleSessionNew } from "../../../src/server/handlers/session";

describe("handleSessionNew Integration - Issue #38", () => {
  const mockCtx = {
    getCurrentSessionId: () => sessionManager.getCurrentId(),
    setCurrentSessionId: (id: string | null) => {
      if (id) sessionManager.setSession(id);
      else sessionManager.clearSession();
    },
    getRunningTaskId: () => null,
    setRunningTaskId: () => {},
    sendSessionNotification: () => {},
    storeAndBroadcastOutput: () => {},
    executePrompt: () => Promise.resolve(),
  };

  beforeEach(() => {
    sessionManager.clearSession();
    mockIsAgentRunning.mockReset();
    mockGetAgentSessionId.mockReset();
    mockInitializeAgent.mockReset();

    // Default: agent is running, has session ID, no Claude ID from notification
    mockIsAgentRunning.mockImplementation(() => true);
    mockGetAgentSessionId.mockImplementation(() => "agent-session-from-subprocess");
  });

  test("CRITICAL: currentId must be set when getAgentSessionId provides ID", async () => {
    // This is the exact bug scenario:
    // - Agent is already running (no restart)
    // - No Claude ID captured from notifications (claudeId = null)
    // - getAgentSessionId() returns a valid ID

    // Verify initial state
    expect(sessionManager.getCurrentId()).toBeNull();
    expect(sessionManager.getClaudeInternalId()).toBeNull();

    // Call handleSessionNew
    const result = await handleSessionNew({}, mockCtx);

    // THE CRITICAL ASSERTION:
    // Without the fix, this would be null because setSession wasn't called
    // With the fix, this should be the agent session ID
    expect(sessionManager.getCurrentId()).not.toBeNull();
    expect(result.sessionId).toBeTruthy();

    // Verify the session ID matches what we expect
    // (either from getAgentSessionId or a newly created one)
    expect(result.sessionId).toBe(sessionManager.getCurrentId());
  });

  test("outputs can be stored after handleSessionNew", async () => {
    await handleSessionNew({}, mockCtx);

    // Simulate what http-server.ts does in sendSessionNotification
    const getCurrentSessionId = () => sessionManager.getCurrentId();

    // This is the check that gates output storage
    if (getCurrentSessionId()) {
      // Would store output here
      expect(true).toBe(true); // Output would be stored
    } else {
      // Without fix, we'd hit this path
      throw new Error("BUG: getCurrentSessionId is null, outputs won't be stored!");
    }
  });
});
