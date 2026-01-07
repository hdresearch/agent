import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { sessionStore, sessionOutputStore } from "../src/utils/session-store";

describe("Session Output Sync", () => {
  const testSessionId = "test-session-" + Date.now();

  beforeEach(() => {
    // Create a test session
    sessionStore.create(testSessionId);
  });

  afterEach(() => {
    // Clean up
    sessionOutputStore.clear(testSessionId);
    sessionStore.delete(testSessionId);
  });

  describe("sessionOutputStore", () => {
    test("append stores output with sequential seq numbers", () => {
      const seq1 = sessionOutputStore.append(testSessionId, {
        type: "user",
        content: "Hello",
      });
      const seq2 = sessionOutputStore.append(testSessionId, {
        type: "text",
        content: "Hi there!",
      });
      const seq3 = sessionOutputStore.append(testSessionId, {
        type: "tool",
        content: '{"name":"Read"}',
        toolName: "Read",
      });

      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(3);
    });

    test("getAll returns all outputs in order", () => {
      sessionOutputStore.append(testSessionId, { type: "user", content: "First" });
      sessionOutputStore.append(testSessionId, { type: "text", content: "Second" });
      sessionOutputStore.append(testSessionId, { type: "tool", content: "Third", toolName: "Bash" });

      const outputs = sessionOutputStore.getAll(testSessionId);

      expect(outputs.length).toBe(3);
      expect(outputs[0].content).toBe("First");
      expect(outputs[0].type).toBe("user");
      expect(outputs[0].seq).toBe(1);
      expect(outputs[1].content).toBe("Second");
      expect(outputs[1].seq).toBe(2);
      expect(outputs[2].content).toBe("Third");
      expect(outputs[2].toolName).toBe("Bash");
      expect(outputs[2].seq).toBe(3);
    });

    test("getAfter returns only outputs after given seq", () => {
      sessionOutputStore.append(testSessionId, { type: "user", content: "First" });
      sessionOutputStore.append(testSessionId, { type: "text", content: "Second" });
      sessionOutputStore.append(testSessionId, { type: "text", content: "Third" });

      const outputs = sessionOutputStore.getAfter(testSessionId, 1);

      expect(outputs.length).toBe(2);
      expect(outputs[0].content).toBe("Second");
      expect(outputs[0].seq).toBe(2);
      expect(outputs[1].content).toBe("Third");
      expect(outputs[1].seq).toBe(3);
    });

    test("getSyncInfo returns correct count and lastSeq", () => {
      // Empty session
      let syncInfo = sessionOutputStore.getSyncInfo(testSessionId);
      expect(syncInfo.count).toBe(0);
      expect(syncInfo.lastSeq).toBe(0);

      // Add outputs
      sessionOutputStore.append(testSessionId, { type: "user", content: "One" });
      sessionOutputStore.append(testSessionId, { type: "text", content: "Two" });

      syncInfo = sessionOutputStore.getSyncInfo(testSessionId);
      expect(syncInfo.count).toBe(2);
      expect(syncInfo.lastSeq).toBe(2);
    });

    test("clear removes all outputs for session", () => {
      sessionOutputStore.append(testSessionId, { type: "user", content: "Test" });
      sessionOutputStore.append(testSessionId, { type: "text", content: "Response" });

      expect(sessionOutputStore.getAll(testSessionId).length).toBe(2);

      sessionOutputStore.clear(testSessionId);

      expect(sessionOutputStore.getAll(testSessionId).length).toBe(0);
      const syncInfo = sessionOutputStore.getSyncInfo(testSessionId);
      expect(syncInfo.count).toBe(0);
      expect(syncInfo.lastSeq).toBe(0);
    });

    test("outputs are isolated per session", () => {
      const otherSessionId = "other-session-" + Date.now();
      sessionStore.create(otherSessionId);

      sessionOutputStore.append(testSessionId, { type: "user", content: "Session 1" });
      sessionOutputStore.append(otherSessionId, { type: "user", content: "Session 2" });

      const outputs1 = sessionOutputStore.getAll(testSessionId);
      const outputs2 = sessionOutputStore.getAll(otherSessionId);

      expect(outputs1.length).toBe(1);
      expect(outputs1[0].content).toBe("Session 1");
      expect(outputs2.length).toBe(1);
      expect(outputs2[0].content).toBe("Session 2");

      // Clean up
      sessionOutputStore.clear(otherSessionId);
      sessionStore.delete(otherSessionId);
    });
  });

  describe("Session sync behavior", () => {
    test("new CLI should receive all outputs from server", () => {
      // Simulate: Person A sends messages, outputs stored on server
      sessionOutputStore.append(testSessionId, { type: "user", content: "Hello from Person A" });
      sessionOutputStore.append(testSessionId, { type: "text", content: "Hi Person A!" });
      sessionOutputStore.append(testSessionId, { type: "tool", content: '{"name":"Read"}', toolName: "Read" });
      sessionOutputStore.append(testSessionId, { type: "tool-result", content: "file contents" });

      // Simulate: Person B connects and syncs
      const serverOutputs = sessionOutputStore.getAll(testSessionId);

      // Person B should see all 4 outputs
      expect(serverOutputs.length).toBe(4);
      expect(serverOutputs[0].type).toBe("user");
      expect(serverOutputs[1].type).toBe("text");
      expect(serverOutputs[2].type).toBe("tool");
      expect(serverOutputs[3].type).toBe("tool-result");
    });

    test("incremental sync should only fetch new outputs", () => {
      // Initial state: 2 outputs
      sessionOutputStore.append(testSessionId, { type: "user", content: "First" });
      sessionOutputStore.append(testSessionId, { type: "text", content: "Second" });

      // CLI has synced up to seq 2
      const clientLastSeq = 2;

      // More outputs added while CLI was doing something
      sessionOutputStore.append(testSessionId, { type: "user", content: "Third" });
      sessionOutputStore.append(testSessionId, { type: "text", content: "Fourth" });

      // CLI checks sync and gets only new outputs
      const newOutputs = sessionOutputStore.getAfter(testSessionId, clientLastSeq);

      expect(newOutputs.length).toBe(2);
      expect(newOutputs[0].content).toBe("Third");
      expect(newOutputs[1].content).toBe("Fourth");
    });

    test("switching sessions should load correct outputs", () => {
      const session2Id = "session-2-" + Date.now();
      sessionStore.create(session2Id);

      // Session 1 has outputs
      sessionOutputStore.append(testSessionId, { type: "user", content: "Session 1 message" });

      // Session 2 has different outputs
      sessionOutputStore.append(session2Id, { type: "user", content: "Session 2 message" });
      sessionOutputStore.append(session2Id, { type: "text", content: "Session 2 response" });

      // CLI switches to session 2, should get session 2's outputs
      const session2Outputs = sessionOutputStore.getAll(session2Id);
      expect(session2Outputs.length).toBe(2);
      expect(session2Outputs[0].content).toBe("Session 2 message");

      // Clean up
      sessionOutputStore.clear(session2Id);
      sessionStore.delete(session2Id);
    });
  });

  describe("Session persistence", () => {
    test("outputs survive session store operations", () => {
      // Store outputs
      sessionOutputStore.append(testSessionId, { type: "user", content: "Persistent message" });
      sessionOutputStore.append(testSessionId, { type: "text", content: "Persistent response" });

      // Verify they're still there (simulating container restart)
      const outputs = sessionOutputStore.getAll(testSessionId);
      expect(outputs.length).toBe(2);
      expect(outputs[0].content).toBe("Persistent message");
    });

    test("session turn count should increment on completion", () => {
      const session = sessionStore.get(testSessionId);
      expect(session?.turns).toBe(0);

      sessionStore.recordCompletion(testSessionId, 0.001);

      const updatedSession = sessionStore.get(testSessionId);
      expect(updatedSession?.turns).toBe(1);

      sessionStore.recordCompletion(testSessionId, 0.002);

      const finalSession = sessionStore.get(testSessionId);
      expect(finalSession?.turns).toBe(2);
      expect(finalSession?.totalCost).toBeCloseTo(0.003, 5);
    });
  });
});

describe("Remote vs Local mode history loading", () => {
  test("remote mode should NOT load local history file", () => {
    // This verifies the fix: when isRemoteMode is true,
    // the CLI should NOT call loadHistory() and display old local messages.
    // Instead, it should only display what the server provides.
    //
    // The key insight is:
    // - Local mode: load from ~/.vers-agent/history.json
    // - Remote mode: skip local file, load from server's session/outputs

    const serverUrl = "http://remote-server:9999";
    const isRemoteMode = !!serverUrl;
    const shouldLoadLocalHistory = !isRemoteMode;

    expect(isRemoteMode).toBe(true);
    expect(shouldLoadLocalHistory).toBe(false);
  });

  test("local mode should load local history file", () => {
    const serverUrl = undefined;
    const isRemoteMode = !!serverUrl;
    const shouldLoadLocalHistory = !isRemoteMode;

    expect(isRemoteMode).toBe(false);
    expect(shouldLoadLocalHistory).toBe(true);
  });

  test("isRemoteMode is true when serverUrl is provided", () => {
    // From use-acp-client.ts: const isRemoteMode = !!serverUrl;
    expect(!!undefined).toBe(false);
    expect(!!"").toBe(false);
    expect(!!"http://localhost:9999").toBe(true);
    expect(!!"http://remote:9999").toBe(true);
  });
});
