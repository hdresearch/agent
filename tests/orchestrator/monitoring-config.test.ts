import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Mock the config directory for tests
const TEST_CONFIG_DIR = join(homedir(), ".vers-agent-test", "orchestrator");
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, "monitoring.json");

// We need to test the config module in isolation
// Import after setting up mocks would be ideal, but for now test the logic

describe("monitoring-config", () => {
  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  describe("DEFAULT_HEALTH_CONFIG", () => {
    test("has sensible defaults", async () => {
      const { DEFAULT_HEALTH_CONFIG } = await import("../../src/orchestrator/monitoring-config");

      expect(DEFAULT_HEALTH_CONFIG.intervalMs).toBe(30000);
      expect(DEFAULT_HEALTH_CONFIG.timeoutMs).toBe(5000);
      expect(DEFAULT_HEALTH_CONFIG.unhealthyThreshold).toBe(3);
      expect(DEFAULT_HEALTH_CONFIG.eventTimeoutMs).toBe(120000);
    });
  });

  describe("DEFAULT_WATCHDOG_CONFIG", () => {
    test("has sensible defaults", async () => {
      const { DEFAULT_WATCHDOG_CONFIG } = await import("../../src/orchestrator/monitoring-config");

      expect(DEFAULT_WATCHDOG_CONFIG.intervalMs).toBe(300000);
      expect(DEFAULT_WATCHDOG_CONFIG.staleMetadataAgeMs).toBe(86400000);
      expect(DEFAULT_WATCHDOG_CONFIG.staleBranchAgeMs).toBe(3600000);
      expect(DEFAULT_WATCHDOG_CONFIG.maxBranchesPerRoot).toBe(20);
    });
  });

  describe("DEFAULT_MONITORING_CONFIG", () => {
    test("is enabled by default", async () => {
      const { DEFAULT_MONITORING_CONFIG } = await import("../../src/orchestrator/monitoring-config");

      expect(DEFAULT_MONITORING_CONFIG.enabled).toBe(true);
      expect(DEFAULT_MONITORING_CONFIG.health).toBeDefined();
      expect(DEFAULT_MONITORING_CONFIG.watchdog).toBeDefined();
    });
  });
});
