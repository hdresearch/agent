/**
 * Configuration for autonomous operation monitoring
 */

import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

// ============================================================
// Types
// ============================================================

export interface HealthMonitorConfig {
  /** How often to check VM health (ms). Default: 30000 (30s) */
  intervalMs: number;
  /** Timeout for each health check (ms). Default: 5000 (5s) */
  timeoutMs: number;
  /** How many consecutive failures before marking unhealthy. Default: 3 */
  unhealthyThreshold: number;
  /** How long without events before considering stale (ms). Default: 120000 (2 min) */
  eventTimeoutMs: number;
}

export interface WatchdogConfig {
  /** How often to run watchdog (ms). Default: 300000 (5 min) */
  intervalMs: number;
  /** Delete metadata older than this (ms). Default: 86400000 (24 hours) */
  staleMetadataAgeMs: number;
  /** Delete completed/failed branches older than this (ms). Default: 3600000 (1 hour) */
  staleBranchAgeMs: number;
  /** Max branches per root VM before pruning. Default: 20 */
  maxBranchesPerRoot: number;
}

export interface MonitoringConfig {
  /** Enable monitoring. Default: true */
  enabled: boolean;
  /** Health monitor settings */
  health: HealthMonitorConfig;
  /** Watchdog settings */
  watchdog: WatchdogConfig;
}

// ============================================================
// Defaults
// ============================================================

export const DEFAULT_HEALTH_CONFIG: HealthMonitorConfig = {
  intervalMs: 30000,           // 30 seconds
  timeoutMs: 5000,             // 5 seconds per check
  unhealthyThreshold: 3,       // 3 consecutive failures
  eventTimeoutMs: 120000,      // 2 minutes without events
};

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  intervalMs: 300000,          // 5 minutes
  staleMetadataAgeMs: 86400000, // 24 hours
  staleBranchAgeMs: 3600000,   // 1 hour
  maxBranchesPerRoot: 20,
};

export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  enabled: true,
  health: DEFAULT_HEALTH_CONFIG,
  watchdog: DEFAULT_WATCHDOG_CONFIG,
};

// ============================================================
// Config Persistence
// ============================================================

const CONFIG_DIR = join(homedir(), ".vers-agent", "orchestrator");
const CONFIG_FILE = join(CONFIG_DIR, "monitoring.json");

function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

/**
 * Load monitoring config from disk, merging with defaults
 */
export function loadMonitoringConfig(): MonitoringConfig {
  ensureConfigDir();

  if (!existsSync(CONFIG_FILE)) {
    return DEFAULT_MONITORING_CONFIG;
  }

  try {
    const stored = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    // Deep merge with defaults
    return {
      enabled: stored.enabled ?? DEFAULT_MONITORING_CONFIG.enabled,
      health: {
        ...DEFAULT_HEALTH_CONFIG,
        ...stored.health,
      },
      watchdog: {
        ...DEFAULT_WATCHDOG_CONFIG,
        ...stored.watchdog,
      },
    };
  } catch {
    return DEFAULT_MONITORING_CONFIG;
  }
}

/**
 * Save monitoring config to disk
 */
export function saveMonitoringConfig(config: MonitoringConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Update specific config values
 */
export function updateMonitoringConfig(updates: Partial<MonitoringConfig>): MonitoringConfig {
  const current = loadMonitoringConfig();
  const updated: MonitoringConfig = {
    ...current,
    ...updates,
    health: {
      ...current.health,
      ...(updates.health ?? {}),
    },
    watchdog: {
      ...current.watchdog,
      ...(updates.watchdog ?? {}),
    },
  };
  saveMonitoringConfig(updated);
  return updated;
}
