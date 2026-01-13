import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createHttpServer } from "../../src/server/http-server";
import {
  registerVm,
  receiveVmEvent,
  cleanup as cleanupAggregator,
} from "../../src/server/vm-event-aggregator";
import { authStore } from "../../src/utils/auth-store";
import type { SessionNotificationParams } from "../../src/protocol/acp-types";

describe("VM HTTP Endpoints", () => {
  let server: { close: () => void; port: number };
  let baseUrl: string;
  let authToken: string | null = null;

  beforeAll(async () => {
    cleanupAggregator();
    // Reset claim state for clean test
    authStore.resetClaim();

    server = createHttpServer(19800);
    baseUrl = `http://localhost:${server.port}`;

    // Claim the server to get auth token
    const claimResponse = await fetch(`${baseUrl}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const claimResult = await claimResponse.json() as { token?: string };
    authToken = claimResult.token || null;
  });

  afterAll(() => {
    server.close();
    cleanupAggregator();
  });

  async function rpc(method: string, params: unknown = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${baseUrl}/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    return response.json();
  }

  describe("vm/events", () => {
    test("returns empty events initially", async () => {
      const result = await rpc("vm/events", { afterSeq: 0 });

      expect(result.result).toBeDefined();
      expect(result.result.events).toEqual([]);
      expect(result.result.lastSeq).toBe(0);
      expect(result.result.connectionStatus).toBeDefined();
    });

    test("returns events after receiving them", async () => {
      // Register a VM and send some events
      registerVm("test-vm-1", "https://test-vm-1.vm.vers.sh");

      const notification: SessionNotificationParams = {
        type: "content_chunk",
        data: { type: "content_chunk", text: "Hello", final: false },
      };
      receiveVmEvent("test-vm-1", notification);

      const result = await rpc("vm/events", { afterSeq: 0 });

      expect(result.result.events.length).toBeGreaterThan(0);
      expect(result.result.events[0].vmId).toBe("test-vm-1");
    });

    test("filters by vmIds", async () => {
      // Register two VMs
      registerVm("filter-vm-1", "https://filter-vm-1.vm.vers.sh");
      registerVm("filter-vm-2", "https://filter-vm-2.vm.vers.sh");

      const notification: SessionNotificationParams = {
        type: "completed",
        data: { type: "completed", durationMs: 100 },
      };

      // Get current seq to filter from
      const beforeResult = await rpc("vm/events", { afterSeq: 0 });
      const afterSeq = beforeResult.result.lastSeq;

      receiveVmEvent("filter-vm-1", notification);
      receiveVmEvent("filter-vm-2", notification);

      // Filter to only vm-1
      const result = await rpc("vm/events", {
        afterSeq,
        vmIds: ["filter-vm-1"],
      });

      expect(result.result.events.length).toBe(1);
      expect(result.result.events[0].vmId).toBe("filter-vm-1");
    });

    test("respects limit parameter", async () => {
      registerVm("limit-vm", "https://limit-vm.vm.vers.sh");

      const beforeResult = await rpc("vm/events", { afterSeq: 0 });
      const afterSeq = beforeResult.result.lastSeq;

      const notification: SessionNotificationParams = {
        type: "content_chunk",
        data: { type: "content_chunk", text: "Test", final: false },
      };

      // Send 5 events
      for (let i = 0; i < 5; i++) {
        receiveVmEvent("limit-vm", notification);
      }

      const result = await rpc("vm/events", {
        afterSeq,
        limit: 2,
      });

      expect(result.result.events.length).toBe(2);
    });
  });

  describe("/events/vms SSE endpoint", () => {
    test("returns SSE stream", async () => {
      const url = authToken
        ? `${baseUrl}/events/vms?token=${encodeURIComponent(authToken)}`
        : `${baseUrl}/events/vms`;
      const response = await fetch(url);

      expect(response.ok).toBe(true);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      // Cancel the stream
      response.body?.cancel();
    });

    test("accepts vmIds filter parameter", async () => {
      let url = `${baseUrl}/events/vms?vmIds=vm-1,vm-2`;
      if (authToken) {
        url += `&token=${encodeURIComponent(authToken)}`;
      }
      const response = await fetch(url);

      expect(response.ok).toBe(true);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      response.body?.cancel();
    });
  });
});
