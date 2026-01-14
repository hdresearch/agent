import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  registerVm,
  receiveVmEvent,
  removeVmConnection,
  subscribeToVmEvents,
  getEventsSince,
  getLastSeq,
  getConnectionStatus,
  cleanup,
} from "../../src/server/vm-event-aggregator";
import type { SessionNotificationParams } from "../../src/protocol/acp-types";

describe("VM Event Aggregator", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  describe("registerVm", () => {
    test("registers a VM and sets status to connected", () => {
      registerVm("vm-1", "https://vm-1.vm.vers.sh");

      const status = getConnectionStatus();
      expect(status.has("vm-1")).toBe(true);
      expect(status.get("vm-1")?.status).toBe("connected");
    });

    test("does not duplicate registration", () => {
      registerVm("vm-1", "https://vm-1.vm.vers.sh");
      registerVm("vm-1", "https://vm-1.vm.vers.sh");

      const status = getConnectionStatus();
      expect(status.size).toBe(1);
    });
  });

  describe("receiveVmEvent", () => {
    test("receives events and increments sequence", () => {
      const notification: SessionNotificationParams = {
        type: "content_chunk",
        data: { type: "content_chunk", text: "Hello", final: false },
      };

      receiveVmEvent("vm-1", notification);
      receiveVmEvent("vm-1", notification);

      const events = getEventsSince(0);
      expect(events.length).toBe(2);
      expect(events[0].seq).toBe(1);
      expect(events[1].seq).toBe(2);
    });

    test("tags events with vmId", () => {
      const notification: SessionNotificationParams = {
        type: "completed",
        data: { type: "completed", durationMs: 100 },
      };

      receiveVmEvent("vm-1", notification);
      receiveVmEvent("vm-2", notification);

      const events = getEventsSince(0);
      expect(events[0].vmId).toBe("vm-1");
      expect(events[1].vmId).toBe("vm-2");
    });

    test("auto-registers unknown VMs", () => {
      const notification: SessionNotificationParams = {
        type: "content_chunk",
        data: { type: "content_chunk", text: "Hi", final: true },
      };

      receiveVmEvent("new-vm", notification);

      const status = getConnectionStatus();
      expect(status.has("new-vm")).toBe(true);
    });
  });

  describe("getEventsSince", () => {
    test("returns events after sequence number", () => {
      const notification: SessionNotificationParams = {
        type: "content_chunk",
        data: { type: "content_chunk", text: "Test", final: false },
      };

      receiveVmEvent("vm-1", notification);
      receiveVmEvent("vm-1", notification);
      receiveVmEvent("vm-1", notification);

      const events = getEventsSince(1);
      expect(events.length).toBe(2);
      expect(events[0].seq).toBe(2);
      expect(events[1].seq).toBe(3);
    });

    test("filters by vmIds", () => {
      const notification: SessionNotificationParams = {
        type: "content_chunk",
        data: { type: "content_chunk", text: "Test", final: false },
      };

      receiveVmEvent("vm-1", notification);
      receiveVmEvent("vm-2", notification);
      receiveVmEvent("vm-1", notification);

      const events = getEventsSince(0, ["vm-1"]);
      expect(events.length).toBe(2);
      expect(events.every(e => e.vmId === "vm-1")).toBe(true);
    });

    test("respects limit", () => {
      const notification: SessionNotificationParams = {
        type: "content_chunk",
        data: { type: "content_chunk", text: "Test", final: false },
      };

      for (let i = 0; i < 10; i++) {
        receiveVmEvent("vm-1", notification);
      }

      const events = getEventsSince(0, undefined, 3);
      expect(events.length).toBe(3);
    });
  });

  describe("subscribeToVmEvents", () => {
    test("notifies subscribers of new events", () => {
      const received: Array<{ vmId: string; seq: number }> = [];

      const unsubscribe = subscribeToVmEvents((event) => {
        received.push({ vmId: event.vmId, seq: event.seq });
      });

      const notification: SessionNotificationParams = {
        type: "completed",
        data: { type: "completed", durationMs: 100 },
      };

      receiveVmEvent("vm-1", notification);
      receiveVmEvent("vm-2", notification);

      expect(received.length).toBe(2);
      expect(received[0].vmId).toBe("vm-1");
      expect(received[1].vmId).toBe("vm-2");

      unsubscribe();
    });

    test("unsubscribe stops notifications", () => {
      const received: number[] = [];

      const unsubscribe = subscribeToVmEvents((event) => {
        received.push(event.seq);
      });

      const notification: SessionNotificationParams = {
        type: "completed",
        data: { type: "completed", durationMs: 100 },
      };

      receiveVmEvent("vm-1", notification);
      unsubscribe();
      receiveVmEvent("vm-1", notification);

      expect(received.length).toBe(1);
    });
  });

  describe("removeVmConnection", () => {
    test("removes VM from tracking", () => {
      registerVm("vm-1", "https://vm-1.vm.vers.sh");

      let status = getConnectionStatus();
      expect(status.has("vm-1")).toBe(true);

      removeVmConnection("vm-1");

      status = getConnectionStatus();
      expect(status.has("vm-1")).toBe(false);
    });
  });

  describe("getLastSeq", () => {
    test("returns current sequence number", () => {
      expect(getLastSeq()).toBe(0);

      const notification: SessionNotificationParams = {
        type: "completed",
        data: { type: "completed", durationMs: 100 },
      };

      receiveVmEvent("vm-1", notification);
      expect(getLastSeq()).toBe(1);

      receiveVmEvent("vm-2", notification);
      expect(getLastSeq()).toBe(2);
    });
  });
});
