import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Watchdog } from "../../src/orchestrator/watchdog";

describe("Watchdog", () => {
  let watchdog: Watchdog;

  beforeEach(() => {
    watchdog = new Watchdog({
      intervalMs: 1000,
      staleMetadataAgeMs: 60000,
      staleBranchAgeMs: 30000,
      maxBranchesPerRoot: 5,
    });
  });

  afterEach(() => {
    watchdog.stop();
  });

  describe("constructor", () => {
    test("creates with default config", () => {
      const wd = new Watchdog();
      expect(wd).toBeDefined();
      expect(wd.isRunning()).toBe(false);
      wd.stop();
    });

    test("creates with custom config", () => {
      const wd = new Watchdog({
        intervalMs: 10000,
        maxBranchesPerRoot: 10,
      });
      expect(wd).toBeDefined();
      wd.stop();
    });
  });

  describe("start/stop", () => {
    test("starts and stops correctly", () => {
      expect(watchdog.isRunning()).toBe(false);

      watchdog.start();
      expect(watchdog.isRunning()).toBe(true);

      watchdog.stop();
      expect(watchdog.isRunning()).toBe(false);
    });

    test("handles multiple start calls", () => {
      watchdog.start();
      watchdog.start(); // Should not throw
      expect(watchdog.isRunning()).toBe(true);
    });

    test("handles multiple stop calls", () => {
      watchdog.start();
      watchdog.stop();
      watchdog.stop(); // Should not throw
      expect(watchdog.isRunning()).toBe(false);
    });
  });
});

describe("ConsistencyReport", () => {
  test("has correct structure", () => {
    const report = {
      vmCount: 5,
      metadataCount: 4,
      orphanedMetadata: ["vm-1"],
      missingMetadata: ["vm-5", "vm-6"],
      staleBranches: ["vm-2"],
      finishedBranches: ["vm-3"],
    };

    expect(report.vmCount).toBe(5);
    expect(report.metadataCount).toBe(4);
    expect(report.orphanedMetadata).toHaveLength(1);
    expect(report.missingMetadata).toHaveLength(2);
    expect(report.staleBranches).toHaveLength(1);
    expect(report.finishedBranches).toHaveLength(1);
  });
});

describe("CleanupResult", () => {
  test("has correct structure", () => {
    const result = {
      metadataRemoved: 3,
      vmsDeleted: 2,
      errors: ["error 1"],
    };

    expect(result.metadataRemoved).toBe(3);
    expect(result.vmsDeleted).toBe(2);
    expect(result.errors).toHaveLength(1);
  });
});
