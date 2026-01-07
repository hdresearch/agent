import { test, expect, describe, beforeEach } from "bun:test";
import {
  TaskStore,
  taskStore,
} from "../../src/core/tasks";
import type {
  Task,
  TaskConfig,
  TaskEvent,
  TaskEventType,
  TaskResult,
  TaskStatus,
  TaskAttachment,
} from "../../src/core/types";

describe("TaskStore", () => {
  let store: TaskStore;

  beforeEach(() => {
    store = new TaskStore();
  });

  describe("create", () => {
    test("creates a task with basic prompt", () => {
      const task = store.create("Hello, world!");

      expect(task.prompt).toBe("Hello, world!");
      expect(task.status).toBe("pending");
      expect(task.events).toEqual([]);
      expect(task.config).toEqual({});
    });

    test("generates unique id", () => {
      const task1 = store.create("Task 1");
      const task2 = store.create("Task 2");

      expect(task1.id).not.toBe(task2.id);
    });

    test("sets createdAt timestamp", () => {
      const before = new Date();
      const task = store.create("Test");
      const after = new Date();

      expect(task.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(task.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test("stores config options", () => {
      const config: TaskConfig = {
        model: "claude-3-opus",
        systemPrompt: "You are helpful",
        maxTurns: 10,
        maxBudgetUsd: 5.0,
        allowedTools: ["read", "write"],
        permissionMode: "acceptEdits",
        cwd: "/tmp",
      };

      const task = store.create("Test", config);
      expect(task.config).toEqual(config);
    });

    test("stores attachments", () => {
      const attachments: TaskAttachment[] = [
        { type: "file", content: "/path/to/file.txt" },
        { type: "image", content: "base64data", mimeType: "image/png" },
      ];

      const task = store.create("With attachments", {}, attachments);
      expect(task.attachments).toEqual(attachments);
    });

    test("attachments default to undefined", () => {
      const task = store.create("No attachments");
      expect(task.attachments).toBeUndefined();
    });
  });

  describe("get", () => {
    test("retrieves task by id", () => {
      const created = store.create("Test task");
      const retrieved = store.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.prompt).toBe("Test task");
    });

    test("returns undefined for non-existent id", () => {
      expect(store.get("non-existent-id")).toBeUndefined();
    });

    test("returns same task object", () => {
      const created = store.create("Test");
      const retrieved = store.get(created.id);

      expect(retrieved).toBe(created);
    });
  });

  describe("list", () => {
    test("returns empty array for empty store", () => {
      expect(store.list()).toEqual([]);
    });

    test("returns all tasks", () => {
      store.create("Task 1");
      store.create("Task 2");
      store.create("Task 3");

      const tasks = store.list();
      expect(tasks.length).toBe(3);
      expect(tasks.map((t) => t.prompt)).toEqual(["Task 1", "Task 2", "Task 3"]);
    });

    test("returns fresh array", () => {
      store.create("Test");
      const list1 = store.list();
      const list2 = store.list();

      expect(list1).not.toBe(list2);
      expect(list1).toEqual(list2);
    });
  });

  describe("updateStatus", () => {
    test("updates status from pending to running", () => {
      const task = store.create("Test");
      store.updateStatus(task.id, "running");

      expect(store.get(task.id)?.status).toBe("running");
    });

    test("sets startedAt when transitioning to running", () => {
      const task = store.create("Test");
      expect(task.startedAt).toBeUndefined();

      const before = new Date();
      store.updateStatus(task.id, "running");
      const after = new Date();

      expect(task.startedAt).toBeDefined();
      expect(task.startedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(task.startedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test("does not overwrite startedAt on subsequent running updates", () => {
      const task = store.create("Test");
      store.updateStatus(task.id, "running");
      const originalStartedAt = task.startedAt;

      store.updateStatus(task.id, "running");
      expect(task.startedAt).toBe(originalStartedAt);
    });

    test("sets completedAt when transitioning to completed", () => {
      const task = store.create("Test");
      expect(task.completedAt).toBeUndefined();

      store.updateStatus(task.id, "completed");
      expect(task.completedAt).toBeDefined();
    });

    test("sets completedAt when transitioning to failed", () => {
      const task = store.create("Test");
      store.updateStatus(task.id, "failed");
      expect(task.completedAt).toBeDefined();
    });

    test("sets completedAt when transitioning to cancelled", () => {
      const task = store.create("Test");
      store.updateStatus(task.id, "cancelled");
      expect(task.completedAt).toBeDefined();
    });

    test("silently ignores non-existent task", () => {
      // Should not throw
      store.updateStatus("non-existent-id", "running");
    });

    test("supports all status values", () => {
      const statuses: TaskStatus[] = ["pending", "running", "completed", "failed", "cancelled"];

      for (const status of statuses) {
        const task = store.create(`Test ${status}`);
        store.updateStatus(task.id, status);
        expect(task.status).toBe(status);
      }
    });
  });

  describe("setResult", () => {
    test("sets task result", () => {
      const task = store.create("Test");
      const result: TaskResult = {
        success: true,
        durationMs: 1500,
        totalCostUsd: 0.05,
        numTurns: 3,
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
        },
      };

      store.setResult(task.id, result);
      expect(task.result).toEqual(result);
    });

    test("silently ignores non-existent task", () => {
      // Should not throw
      store.setResult("non-existent-id", {
        success: true,
        durationMs: 100,
        totalCostUsd: 0.01,
        numTurns: 1,
        usage: { inputTokens: 100, outputTokens: 50 },
      });
    });

    test("overwrites existing result", () => {
      const task = store.create("Test");
      const result1: TaskResult = {
        success: true,
        durationMs: 100,
        totalCostUsd: 0.01,
        numTurns: 1,
        usage: { inputTokens: 100, outputTokens: 50 },
      };
      const result2: TaskResult = {
        success: false,
        durationMs: 200,
        totalCostUsd: 0.02,
        numTurns: 2,
        usage: { inputTokens: 200, outputTokens: 100 },
      };

      store.setResult(task.id, result1);
      store.setResult(task.id, result2);
      expect(task.result).toEqual(result2);
    });
  });

  describe("setError", () => {
    test("sets task error", () => {
      const task = store.create("Test");
      store.setError(task.id, "Something went wrong");

      expect(task.error).toBe("Something went wrong");
    });

    test("silently ignores non-existent task", () => {
      // Should not throw
      store.setError("non-existent-id", "Error");
    });

    test("overwrites existing error", () => {
      const task = store.create("Test");
      store.setError(task.id, "First error");
      store.setError(task.id, "Second error");

      expect(task.error).toBe("Second error");
    });
  });

  describe("addEvent", () => {
    test("adds event to task", () => {
      const task = store.create("Test");
      const event = store.addEvent(task.id, "started");

      expect(task.events.length).toBe(1);
      expect(task.events[0]).toBe(event);
    });

    test("event has unique id", () => {
      const task = store.create("Test");
      const event1 = store.addEvent(task.id, "started");
      const event2 = store.addEvent(task.id, "completed");

      expect(event1.id).not.toBe(event2.id);
    });

    test("event has timestamp", () => {
      const task = store.create("Test");
      const before = new Date();
      const event = store.addEvent(task.id, "started");
      const after = new Date();

      expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(event.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test("event stores type", () => {
      const task = store.create("Test");
      const event = store.addEvent(task.id, "tool_use");

      expect(event.type).toBe("tool_use");
    });

    test("event stores data", () => {
      const task = store.create("Test");
      const eventData = { tool: "read_file", args: { path: "/tmp/test.txt" } };
      const event = store.addEvent(task.id, "tool_use", eventData);

      expect(event.data).toEqual(eventData);
    });

    test("data defaults to empty object", () => {
      const task = store.create("Test");
      const event = store.addEvent(task.id, "started");

      expect(event.data).toEqual({});
    });

    test("throws for non-existent task", () => {
      expect(() => {
        store.addEvent("non-existent-id", "started");
      }).toThrow("Task non-existent-id not found");
    });

    test("supports all event types", () => {
      const task = store.create("Test");
      const eventTypes: TaskEventType[] = [
        "started",
        "assistant_message",
        "system_message",
        "tool_use",
        "tool_result",
        "user_input",
        "completed",
        "failed",
        "cancelled",
      ];

      for (const type of eventTypes) {
        const event = store.addEvent(task.id, type);
        expect(event.type).toBe(type);
      }

      expect(task.events.length).toBe(eventTypes.length);
    });

    test("events are in chronological order", () => {
      const task = store.create("Test");
      store.addEvent(task.id, "started");
      store.addEvent(task.id, "assistant_message");
      store.addEvent(task.id, "completed");

      expect(task.events.map((e) => e.type)).toEqual([
        "started",
        "assistant_message",
        "completed",
      ]);
    });
  });

  describe("subscribe", () => {
    test("receives events after subscribing", () => {
      const task = store.create("Test");
      const events: TaskEvent[] = [];

      store.subscribe(task.id, (event) => events.push(event));
      store.addEvent(task.id, "started");
      store.addEvent(task.id, "completed");

      expect(events.length).toBe(2);
      expect(events[0].type).toBe("started");
      expect(events[1].type).toBe("completed");
    });

    test("returns unsubscribe function", () => {
      const task = store.create("Test");
      const events: TaskEvent[] = [];

      const unsubscribe = store.subscribe(task.id, (event) => events.push(event));
      store.addEvent(task.id, "started");

      unsubscribe();
      store.addEvent(task.id, "completed");

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("started");
    });

    test("multiple subscribers receive events", () => {
      const task = store.create("Test");
      const events1: TaskEvent[] = [];
      const events2: TaskEvent[] = [];

      store.subscribe(task.id, (event) => events1.push(event));
      store.subscribe(task.id, (event) => events2.push(event));
      store.addEvent(task.id, "started");

      expect(events1.length).toBe(1);
      expect(events2.length).toBe(1);
    });

    test("unsubscribe only affects specific handler", () => {
      const task = store.create("Test");
      const events1: TaskEvent[] = [];
      const events2: TaskEvent[] = [];

      const unsub1 = store.subscribe(task.id, (event) => events1.push(event));
      store.subscribe(task.id, (event) => events2.push(event));

      store.addEvent(task.id, "started");
      unsub1();
      store.addEvent(task.id, "completed");

      expect(events1.length).toBe(1);
      expect(events2.length).toBe(2);
    });

    test("can subscribe before any events are added", () => {
      const task = store.create("Test");
      const events: TaskEvent[] = [];

      store.subscribe(task.id, (event) => events.push(event));

      expect(events.length).toBe(0);
      store.addEvent(task.id, "started");
      expect(events.length).toBe(1);
    });

    test("subscriber for one task does not receive events from another", () => {
      const task1 = store.create("Task 1");
      const task2 = store.create("Task 2");
      const events1: TaskEvent[] = [];

      store.subscribe(task1.id, (event) => events1.push(event));
      store.addEvent(task2.id, "started");

      expect(events1.length).toBe(0);
    });
  });

  describe("delete", () => {
    test("removes task from store", () => {
      const task = store.create("Test");
      expect(store.get(task.id)).toBeDefined();

      store.delete(task.id);
      expect(store.get(task.id)).toBeUndefined();
    });

    test("returns true when task exists", () => {
      const task = store.create("Test");
      expect(store.delete(task.id)).toBe(true);
    });

    test("returns false when task does not exist", () => {
      expect(store.delete("non-existent-id")).toBe(false);
    });

    test("cleans up subscribers", () => {
      const task = store.create("Test");
      const events: TaskEvent[] = [];

      store.subscribe(task.id, (event) => events.push(event));
      store.addEvent(task.id, "started");
      expect(events.length).toBe(1);

      store.delete(task.id);

      // After deletion, creating a new task with events shouldn't affect old subscriber
      const task2 = store.create("New task");
      store.addEvent(task2.id, "started");
      expect(events.length).toBe(1); // Still 1, not 2
    });

    test("removes from list", () => {
      const task1 = store.create("Task 1");
      const task2 = store.create("Task 2");
      const task3 = store.create("Task 3");

      store.delete(task2.id);

      const tasks = store.list();
      expect(tasks.length).toBe(2);
      expect(tasks.map((t) => t.prompt)).toEqual(["Task 1", "Task 3"]);
    });
  });
});

describe("taskStore singleton", () => {
  test("is a TaskStore instance", () => {
    expect(taskStore).toBeInstanceOf(TaskStore);
  });

  test("can create tasks", () => {
    const task = taskStore.create(`Singleton test ${Date.now()}`);
    expect(task).toBeDefined();
    expect(task.id).toBeDefined();

    // Cleanup
    taskStore.delete(task.id);
  });
});
