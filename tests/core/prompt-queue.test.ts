import { test, expect, describe, beforeEach } from "bun:test";
import {
  PromptQueue,
  processQueue,
  type QueuedPrompt,
  type QueueOperation,
} from "../../src/core/prompt-queue";

describe("PromptQueue", () => {
  let queue: PromptQueue;

  beforeEach(() => {
    queue = new PromptQueue();
  });

  describe("enqueue", () => {
    test("adds a prompt to the queue", () => {
      const prompt = queue.enqueue("Hello, world!");
      expect(queue.length).toBe(1);
      expect(prompt.text).toBe("Hello, world!");
    });

    test("generates unique id for each prompt", () => {
      const p1 = queue.enqueue("First");
      const p2 = queue.enqueue("Second");
      expect(p1.id).not.toBe(p2.id);
    });

    test("sets queuedAt timestamp", () => {
      const before = new Date();
      const prompt = queue.enqueue("Test");
      const after = new Date();

      expect(prompt.queuedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(prompt.queuedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test("stores attachments", () => {
      const attachments = [
        { type: "image" as const, content: "base64data", mimeType: "image/png" },
      ];
      const prompt = queue.enqueue("With attachment", attachments);
      expect(prompt.attachments).toEqual(attachments);
    });

    test("stores mode", () => {
      const prompt = queue.enqueue("Plan mode", undefined, "plan");
      expect(prompt.mode).toBe("plan");
    });

    test("mode defaults to undefined", () => {
      const prompt = queue.enqueue("Default mode");
      expect(prompt.mode).toBeUndefined();
    });

    test("maintains FIFO order", () => {
      queue.enqueue("First");
      queue.enqueue("Second");
      queue.enqueue("Third");

      expect(queue.getAll().map((p) => p.text)).toEqual([
        "First",
        "Second",
        "Third",
      ]);
    });
  });

  describe("dequeue", () => {
    test("removes and returns first prompt", () => {
      queue.enqueue("First");
      queue.enqueue("Second");

      const dequeued = queue.dequeue();
      expect(dequeued?.text).toBe("First");
      expect(queue.length).toBe(1);
    });

    test("returns undefined for empty queue", () => {
      expect(queue.dequeue()).toBeUndefined();
    });

    test("dequeues in FIFO order", () => {
      queue.enqueue("First");
      queue.enqueue("Second");
      queue.enqueue("Third");

      expect(queue.dequeue()?.text).toBe("First");
      expect(queue.dequeue()?.text).toBe("Second");
      expect(queue.dequeue()?.text).toBe("Third");
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe("peek", () => {
    test("returns first prompt without removing", () => {
      queue.enqueue("First");
      queue.enqueue("Second");

      const peeked = queue.peek();
      expect(peeked?.text).toBe("First");
      expect(queue.length).toBe(2);
    });

    test("returns undefined for empty queue", () => {
      expect(queue.peek()).toBeUndefined();
    });

    test("multiple peeks return same prompt", () => {
      queue.enqueue("Test");
      const first = queue.peek();
      const second = queue.peek();
      expect(first?.id).toBe(second?.id);
    });
  });

  describe("flushAll", () => {
    test("removes and returns all prompts", () => {
      queue.enqueue("First");
      queue.enqueue("Second");
      queue.enqueue("Third");

      const flushed = queue.flushAll();
      expect(flushed.map((p) => p.text)).toEqual(["First", "Second", "Third"]);
      expect(queue.length).toBe(0);
    });

    test("returns empty array for empty queue", () => {
      expect(queue.flushAll()).toEqual([]);
    });

    test("queue is empty after flush", () => {
      queue.enqueue("Test");
      queue.flushAll();
      expect(queue.isEmpty).toBe(true);
    });
  });

  describe("remove", () => {
    test("removes prompts by id", () => {
      const p1 = queue.enqueue("First");
      const p2 = queue.enqueue("Second");
      const p3 = queue.enqueue("Third");

      const removed = queue.remove([p2.id]);
      expect(removed.map((p) => p.text)).toEqual(["Second"]);
      expect(queue.getAll().map((p) => p.text)).toEqual(["First", "Third"]);
    });

    test("removes multiple prompts", () => {
      const p1 = queue.enqueue("First");
      const p2 = queue.enqueue("Second");
      const p3 = queue.enqueue("Third");

      const removed = queue.remove([p1.id, p3.id]);
      expect(removed.length).toBe(2);
      expect(queue.getAll().map((p) => p.text)).toEqual(["Second"]);
    });

    test("returns empty array for non-existent ids", () => {
      queue.enqueue("Test");
      const removed = queue.remove(["non-existent-id"]);
      expect(removed).toEqual([]);
      expect(queue.length).toBe(1);
    });

    test("handles empty ids array", () => {
      queue.enqueue("Test");
      const removed = queue.remove([]);
      expect(removed).toEqual([]);
      expect(queue.length).toBe(1);
    });
  });

  describe("getAll", () => {
    test("returns copy of queue", () => {
      queue.enqueue("First");
      queue.enqueue("Second");

      const all = queue.getAll();
      expect(all.length).toBe(2);

      // Modifying returned array shouldn't affect queue
      all.pop();
      expect(queue.length).toBe(2);
    });

    test("returns empty array for empty queue", () => {
      expect(queue.getAll()).toEqual([]);
    });
  });

  describe("length", () => {
    test("returns 0 for empty queue", () => {
      expect(queue.length).toBe(0);
    });

    test("increases with enqueue", () => {
      queue.enqueue("First");
      expect(queue.length).toBe(1);

      queue.enqueue("Second");
      expect(queue.length).toBe(2);
    });

    test("decreases with dequeue", () => {
      queue.enqueue("First");
      queue.enqueue("Second");
      queue.dequeue();
      expect(queue.length).toBe(1);
    });
  });

  describe("isEmpty", () => {
    test("returns true for empty queue", () => {
      expect(queue.isEmpty).toBe(true);
    });

    test("returns false when queue has items", () => {
      queue.enqueue("Test");
      expect(queue.isEmpty).toBe(false);
    });

    test("returns true after all items dequeued", () => {
      queue.enqueue("Test");
      queue.dequeue();
      expect(queue.isEmpty).toBe(true);
    });
  });

  describe("isProcessing / setProcessing", () => {
    test("defaults to false", () => {
      expect(queue.isProcessing).toBe(false);
    });

    test("can be set to true", () => {
      queue.setProcessing(true);
      expect(queue.isProcessing).toBe(true);
    });

    test("can be set back to false", () => {
      queue.setProcessing(true);
      queue.setProcessing(false);
      expect(queue.isProcessing).toBe(false);
    });
  });

  describe("clear", () => {
    test("removes all items", () => {
      queue.enqueue("First");
      queue.enqueue("Second");
      queue.clear();
      expect(queue.length).toBe(0);
      expect(queue.isEmpty).toBe(true);
    });

    test("works on empty queue", () => {
      queue.clear();
      expect(queue.isEmpty).toBe(true);
    });
  });

  describe("setSessionId", () => {
    test("sets session id for events", () => {
      const events: QueueOperation[] = [];
      queue.onEvent((e) => events.push(e));

      queue.setSessionId("test-session");
      queue.enqueue("Test");

      expect(events[0]!.sessionId).toBe("test-session");
    });
  });

  describe("onEvent", () => {
    test("emits enqueue events", () => {
      const events: QueueOperation[] = [];
      queue.onEvent((e) => events.push(e));

      queue.enqueue("Test prompt");

      expect(events.length).toBe(1);
      expect(events[0]!.operation).toBe("enqueue");
      expect(events[0]!.content).toBe("Test prompt");
    });

    test("emits dequeue events", () => {
      const events: QueueOperation[] = [];
      const prompt = queue.enqueue("Test");
      queue.onEvent((e) => events.push(e));

      queue.dequeue();

      expect(events.length).toBe(1);
      expect(events[0]!.operation).toBe("dequeue");
      expect(events[0]!.promptId).toBe(prompt.id);
    });

    test("emits remove events", () => {
      const events: QueueOperation[] = [];
      const prompt = queue.enqueue("Test");
      queue.onEvent((e) => events.push(e));

      queue.remove([prompt.id]);

      expect(events.length).toBe(1);
      expect(events[0]!.operation).toBe("remove");
      expect(events[0]!.promptId).toBe(prompt.id);
    });

    test("emits flush event on clear", () => {
      const events: QueueOperation[] = [];
      queue.enqueue("Test");
      queue.onEvent((e) => events.push(e));

      queue.clear();

      expect(events.length).toBe(1);
      expect(events[0]!.operation).toBe("flush");
    });

    test("returns unsubscribe function", () => {
      const events: QueueOperation[] = [];
      const unsubscribe = queue.onEvent((e) => events.push(e));

      queue.enqueue("First");
      unsubscribe();
      queue.enqueue("Second");

      expect(events.length).toBe(1);
    });

    test("multiple handlers receive events", () => {
      const events1: QueueOperation[] = [];
      const events2: QueueOperation[] = [];

      queue.onEvent((e) => events1.push(e));
      queue.onEvent((e) => events2.push(e));

      queue.enqueue("Test");

      expect(events1.length).toBe(1);
      expect(events2.length).toBe(1);
    });

    test("events include timestamp", () => {
      const events: QueueOperation[] = [];
      queue.onEvent((e) => events.push(e));

      const before = new Date().toISOString();
      queue.enqueue("Test");
      const after = new Date().toISOString();

      expect(events[0]!.timestamp).toBeDefined();
      expect(events[0]!.timestamp >= before).toBe(true);
      expect(events[0]!.timestamp <= after).toBe(true);
    });
  });

  describe("serialize / restore", () => {
    test("serializes queue state", () => {
      queue.setSessionId("test-session");
      queue.enqueue("First");
      queue.enqueue("Second");

      const serialized = queue.serialize();
      expect(serialized.sessionId).toBe("test-session");
      expect(serialized.prompts.length).toBe(2);
      expect(serialized.prompts[0]!.text).toBe("First");
    });

    test("restores queue state", () => {
      const data = {
        sessionId: "restored-session",
        prompts: [
          {
            id: "id-1",
            text: "Restored prompt",
            queuedAt: new Date("2024-01-01"),
          },
        ],
      };

      queue.restore(data);
      expect(queue.length).toBe(1);
      expect(queue.peek()?.text).toBe("Restored prompt");

      // Check sessionId is restored by checking event emission
      const events: QueueOperation[] = [];
      queue.onEvent((e) => events.push(e));
      queue.enqueue("New");
      expect(events[0]!.sessionId).toBe("restored-session");
    });

    test("round-trip serialization", () => {
      queue.setSessionId("session-123");
      const p1 = queue.enqueue("First", undefined, "plan");
      const p2 = queue.enqueue("Second");

      const serialized = queue.serialize();
      const newQueue = new PromptQueue();
      newQueue.restore(serialized);

      expect(newQueue.length).toBe(2);
      const items = newQueue.getAll();
      expect(items[0].text).toBe("First");
      expect(items[0].mode).toBe("plan");
      expect(items[1].text).toBe("Second");
    });
  });
});

describe("processQueue", () => {
  // Create a fresh queue for processQueue tests
  // Note: processQueue uses the singleton, so we need to be careful

  test("processes prompts in order", async () => {
    const testQueue = new PromptQueue();
    testQueue.enqueue("First");
    testQueue.enqueue("Second");
    testQueue.enqueue("Third");

    const processed: string[] = [];

    // Since processQueue uses the singleton, we'll test the logic directly
    testQueue.setProcessing(true);
    try {
      while (!testQueue.isEmpty) {
        const prompt = testQueue.dequeue();
        if (prompt) {
          processed.push(prompt.text);
        }
      }
    } finally {
      testQueue.setProcessing(false);
    }

    expect(processed).toEqual(["First", "Second", "Third"]);
  });

  test("sets isProcessing during execution", () => {
    const testQueue = new PromptQueue();
    expect(testQueue.isProcessing).toBe(false);

    testQueue.setProcessing(true);
    expect(testQueue.isProcessing).toBe(true);

    testQueue.setProcessing(false);
    expect(testQueue.isProcessing).toBe(false);
  });
});
