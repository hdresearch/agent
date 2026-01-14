import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { HealthMonitor } from "../../src/orchestrator/health-monitor";

// Mock the vm execute function
const mockExecute = mock(() => Promise.resolve({
  stdout: JSON.stringify({
    status: "ok",
    initialized: true,
    sessionId: "test-session",
    metrics: {
      prompts: 5,
      sessions: 2,
      queueLength: 0,
      sseClients: 1,
    },
  }),
  stderr: "",
}));

// Mock loadMetadata
const mockLoadMetadata = mock(() => ({
  "vm-1": {
    status: "ready",
    createdAt: new Date().toISOString(),
    task: "test task",
  },
  "vm-2": {
    status: "busy",
    createdAt: new Date().toISOString(),
    task: "another task",
  },
}));

// Mock updateVmMetadata
const mockUpdateVmMetadata = mock(() => {});

describe("HealthMonitor", () => {
  let healthMonitor: HealthMonitor;

  beforeEach(() => {
    // Reset mocks
    mockExecute.mockClear();
    mockLoadMetadata.mockClear();
    mockUpdateVmMetadata.mockClear();

    healthMonitor = new HealthMonitor({
      intervalMs: 1000,
      timeoutMs: 500,
      unhealthyThreshold: 2,
      eventTimeoutMs: 5000,
    });
  });

  afterEach(() => {
    healthMonitor.stop();
  });

  describe("constructor", () => {
    test("creates with default config", () => {
      const monitor = new HealthMonitor();
      expect(monitor).toBeDefined();
      expect(monitor.isRunning()).toBe(false);
      monitor.stop();
    });

    test("creates with custom config", () => {
      const monitor = new HealthMonitor({
        intervalMs: 5000,
        unhealthyThreshold: 5,
      });
      expect(monitor).toBeDefined();
      monitor.stop();
    });
  });

  describe("start/stop", () => {
    test("starts and stops correctly", () => {
      expect(healthMonitor.isRunning()).toBe(false);

      healthMonitor.start();
      expect(healthMonitor.isRunning()).toBe(true);

      healthMonitor.stop();
      expect(healthMonitor.isRunning()).toBe(false);
    });

    test("handles multiple start calls", () => {
      healthMonitor.start();
      healthMonitor.start(); // Should not throw
      expect(healthMonitor.isRunning()).toBe(true);
    });

    test("handles multiple stop calls", () => {
      healthMonitor.start();
      healthMonitor.stop();
      healthMonitor.stop(); // Should not throw
      expect(healthMonitor.isRunning()).toBe(false);
    });
  });

  describe("onHealthChange", () => {
    test("subscribes and unsubscribes", () => {
      const callback = mock(() => {});
      const unsubscribe = healthMonitor.onHealthChange(callback);

      expect(typeof unsubscribe).toBe("function");

      // Unsubscribe
      unsubscribe();
      // Should not throw
    });
  });

  describe("getFailureCount", () => {
    test("returns 0 for unknown VM", () => {
      expect(healthMonitor.getFailureCount("unknown-vm")).toBe(0);
    });
  });

  describe("resetFailureCount", () => {
    test("does not throw for unknown VM", () => {
      expect(() => healthMonitor.resetFailureCount("unknown-vm")).not.toThrow();
    });
  });
});

describe("HealthCheckResult parsing", () => {
  test("parses valid health response", () => {
    const response = {
      status: "ok",
      initialized: true,
      sessionId: "test-session",
      metrics: {
        prompts: 5,
        sessions: 2,
        queueLength: 0,
        sseClients: 1,
      },
    };

    expect(response.status).toBe("ok");
    expect(response.metrics.prompts).toBe(5);
  });

  test("handles missing metrics", () => {
    const response = {
      status: "ok",
      initialized: true,
    };

    expect(response.status).toBe("ok");
    expect((response as any).metrics).toBeUndefined();
  });
});
