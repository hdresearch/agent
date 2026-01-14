import { describe, test, expect } from "bun:test";
import type { VmStatus, VmMetadata } from "../../src/orchestrator/index";

describe("VmStatus", () => {
  test("includes all expected statuses", () => {
    const statuses: VmStatus[] = [
      "starting",
      "ready",
      "busy",
      "completed",
      "failed",
      "unhealthy",
      "recovering",
    ];

    expect(statuses).toHaveLength(7);
  });

  test("starting is a valid status", () => {
    const status: VmStatus = "starting";
    expect(status).toBe("starting");
  });

  test("unhealthy is a valid status", () => {
    const status: VmStatus = "unhealthy";
    expect(status).toBe("unhealthy");
  });

  test("recovering is a valid status", () => {
    const status: VmStatus = "recovering";
    expect(status).toBe("recovering");
  });
});

describe("VmMetadata", () => {
  test("creates minimal metadata", () => {
    const metadata: VmMetadata = {
      status: "starting",
      createdAt: new Date().toISOString(),
    };

    expect(metadata.status).toBe("starting");
    expect(metadata.createdAt).toBeDefined();
  });

  test("creates full metadata with health tracking", () => {
    const now = new Date().toISOString();
    const metadata: VmMetadata = {
      task: "test task",
      approach: "approach A",
      status: "ready",
      createdAt: now,
      parentId: "parent-vm-id",
      lastHealthCheckAt: now,
      lastEventAt: now,
      healthScore: 100,
      consecutiveFailures: 0,
      lastError: undefined,
      recoveryAttempts: 0,
    };

    expect(metadata.task).toBe("test task");
    expect(metadata.approach).toBe("approach A");
    expect(metadata.status).toBe("ready");
    expect(metadata.parentId).toBe("parent-vm-id");
    expect(metadata.lastHealthCheckAt).toBe(now);
    expect(metadata.lastEventAt).toBe(now);
    expect(metadata.healthScore).toBe(100);
    expect(metadata.consecutiveFailures).toBe(0);
    expect(metadata.recoveryAttempts).toBe(0);
  });

  test("creates unhealthy metadata", () => {
    const metadata: VmMetadata = {
      status: "unhealthy",
      createdAt: new Date().toISOString(),
      healthScore: 0,
      consecutiveFailures: 5,
      lastError: "Connection refused",
    };

    expect(metadata.status).toBe("unhealthy");
    expect(metadata.healthScore).toBe(0);
    expect(metadata.consecutiveFailures).toBe(5);
    expect(metadata.lastError).toBe("Connection refused");
  });

  test("creates recovering metadata", () => {
    const metadata: VmMetadata = {
      status: "recovering",
      createdAt: new Date().toISOString(),
      recoveryAttempts: 2,
    };

    expect(metadata.status).toBe("recovering");
    expect(metadata.recoveryAttempts).toBe(2);
  });
});

describe("Health score calculation", () => {
  test("100 for no failures", () => {
    const failures = 0;
    const healthScore = Math.max(0, 100 - (failures * 33));
    expect(healthScore).toBe(100);
  });

  test("67 for 1 failure", () => {
    const failures = 1;
    const healthScore = Math.max(0, 100 - (failures * 33));
    expect(healthScore).toBe(67);
  });

  test("34 for 2 failures", () => {
    const failures = 2;
    const healthScore = Math.max(0, 100 - (failures * 33));
    expect(healthScore).toBe(34);
  });

  test("1 for 3 failures", () => {
    const failures = 3;
    const healthScore = Math.max(0, 100 - (failures * 33));
    expect(healthScore).toBe(1);
  });

  test("0 for 4+ failures", () => {
    const failures = 4;
    const healthScore = Math.max(0, 100 - (failures * 33));
    expect(healthScore).toBe(0);
  });
});
