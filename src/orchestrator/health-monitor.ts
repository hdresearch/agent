/**
 * Health Monitor - Periodic health checks for managed VMs
 *
 * Runs on a timer, checks each VM's /health endpoint via SSH,
 * updates metadata with results, and emits events on status changes.
 */

import { execute } from "../vm/index";
import { loadMetadata, updateVmMetadata, type VmMetadata, type VmStatus } from "./index";
import { logStream } from "../utils/log-stream";
import { type HealthMonitorConfig, DEFAULT_HEALTH_CONFIG } from "./monitoring-config";

// ============================================================
// Types
// ============================================================

export interface HealthCheckResult {
  vmId: string;
  healthy: boolean;
  responseTimeMs: number;
  timestamp: string;
  error?: string;
  metrics?: {
    status: string;
    initialized: boolean;
    sessionId?: string;
    prompts?: number;
    sessions?: number;
    queueLength?: number;
    sseClients?: number;
  };
}

export type HealthStatus = "healthy" | "unhealthy" | "unknown";

export type HealthChangeCallback = (
  vmId: string,
  newStatus: HealthStatus,
  result: HealthCheckResult
) => void;

// ============================================================
// Health Monitor Class
// ============================================================

export class HealthMonitor {
  private config: HealthMonitorConfig;
  private timer: Timer | null = null;
  private running = false;
  private subscribers = new Set<HealthChangeCallback>();

  // Track consecutive failures per VM (not persisted, resets on restart)
  private failureCounts = new Map<string, number>();

  constructor(config?: Partial<HealthMonitorConfig>) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
  }

  /**
   * Start the health monitor timer
   */
  start(): void {
    if (this.running) {
      logStream.debug("[health-monitor] Already running");
      return;
    }

    this.running = true;
    logStream.info("[health-monitor] Starting", {
      intervalMs: this.config.intervalMs,
      unhealthyThreshold: this.config.unhealthyThreshold,
    });

    // Run immediately, then on interval
    this.runChecks();
    this.timer = setInterval(() => this.runChecks(), this.config.intervalMs);
  }

  /**
   * Stop the health monitor
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logStream.info("[health-monitor] Stopped");
  }

  /**
   * Check if the monitor is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Subscribe to health status changes
   */
  onHealthChange(callback: HealthChangeCallback): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Run health checks on all managed VMs
   */
  async checkAll(): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();
    const metadata = loadMetadata();
    const vmIds = Object.keys(metadata).filter(id => {
      // Guard against corrupted metadata with invalid vmIds
      if (!id || id === "undefined" || id === "null") {
        logStream.warn("[health-monitor] Skipping invalid vmId in metadata", { id });
        return false;
      }
      return true;
    });

    logStream.debug("[health-monitor] Checking VMs", { count: vmIds.length });

    // Run checks in parallel
    const checks = vmIds.map(async (vmId) => {
      const result = await this.checkVm(vmId);
      results.set(vmId, result);
      return result;
    });

    await Promise.allSettled(checks);
    return results;
  }

  /**
   * Check a single VM's health
   */
  async checkVm(vmId: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    try {
      // Execute curl via SSH with timeout
      const result = await Promise.race([
        execute(vmId, "curl -s http://localhost:80/health"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), this.config.timeoutMs)
        ),
      ]);

      const responseTimeMs = Date.now() - startTime;

      // Parse JSON response
      let metrics: HealthCheckResult["metrics"];
      try {
        const json = JSON.parse(result.stdout);
        metrics = {
          status: json.status,
          initialized: json.initialized,
          sessionId: json.sessionId,
          prompts: json.metrics?.prompts,
          sessions: json.metrics?.sessions,
          queueLength: json.metrics?.queueLength,
          sseClients: json.metrics?.sseClients,
        };
      } catch {
        // JSON parse failed but curl succeeded - partial health
        logStream.debug("[health-monitor] Failed to parse health response", { vmId, stdout: result.stdout });
      }

      const healthy = metrics?.status === "ok";
      const checkResult: HealthCheckResult = {
        vmId,
        healthy,
        responseTimeMs,
        timestamp,
        metrics,
      };

      // Update state
      this.handleCheckResult(vmId, checkResult);
      return checkResult;

    } catch (err) {
      const responseTimeMs = Date.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);

      const checkResult: HealthCheckResult = {
        vmId,
        healthy: false,
        responseTimeMs,
        timestamp,
        error,
      };

      this.handleCheckResult(vmId, checkResult);
      return checkResult;
    }
  }

  /**
   * Process a health check result and update state
   */
  private handleCheckResult(vmId: string, result: HealthCheckResult): void {
    const metadata = loadMetadata();
    const vm = metadata[vmId];
    if (!vm) return;

    const previousStatus = vm.status;
    let newVmStatus: VmStatus = vm.status;

    if (result.healthy) {
      // Reset failure count on success
      this.failureCounts.delete(vmId);

      // Update metadata
      updateVmMetadata(vmId, {
        lastHealthCheckAt: result.timestamp,
        healthScore: 100,
        consecutiveFailures: 0,
        lastError: undefined,
      });

      // If was unhealthy, mark as ready
      if (previousStatus === "unhealthy") {
        newVmStatus = "ready";
        updateVmMetadata(vmId, { status: "ready" });
        this.notifySubscribers(vmId, "healthy", result);
      }

    } else {
      // Increment failure count
      const failures = (this.failureCounts.get(vmId) ?? 0) + 1;
      this.failureCounts.set(vmId, failures);

      // Calculate health score (0-100 based on recent failures)
      const healthScore = Math.max(0, 100 - (failures * 33));

      // Update metadata
      updateVmMetadata(vmId, {
        lastHealthCheckAt: result.timestamp,
        healthScore,
        consecutiveFailures: failures,
        lastError: result.error,
      });

      // Mark as unhealthy if threshold reached
      if (failures >= this.config.unhealthyThreshold) {
        // Don't mark as unhealthy if it's in a terminal state or recovering
        if (!["completed", "failed", "recovering"].includes(previousStatus)) {
          newVmStatus = "unhealthy";
          updateVmMetadata(vmId, { status: "unhealthy" });
          this.notifySubscribers(vmId, "unhealthy", result);

          logStream.warn("[health-monitor] VM marked unhealthy", {
            vmId,
            failures,
            error: result.error,
          });
        }
      }
    }

    logStream.debug("[health-monitor] Check complete", {
      vmId,
      healthy: result.healthy,
      responseTimeMs: result.responseTimeMs,
      status: newVmStatus,
    });
  }

  /**
   * Check for stale VMs (no events for too long)
   */
  async checkStaleVms(): Promise<string[]> {
    const metadata = loadMetadata();
    const now = Date.now();
    const staleVmIds: string[] = [];

    for (const [vmId, vm] of Object.entries(metadata)) {
      // Skip VMs in terminal states
      if (["completed", "failed", "recovering"].includes(vm.status)) {
        continue;
      }

      // Check last event time
      if (vm.lastEventAt) {
        const lastEventTime = new Date(vm.lastEventAt).getTime();
        const timeSinceEvent = now - lastEventTime;

        if (timeSinceEvent > this.config.eventTimeoutMs) {
          staleVmIds.push(vmId);
          logStream.warn("[health-monitor] VM is stale (no events)", {
            vmId,
            lastEventAt: vm.lastEventAt,
            timeSinceEventMs: timeSinceEvent,
          });
        }
      }
    }

    return staleVmIds;
  }

  /**
   * Notify subscribers of health status change
   */
  private notifySubscribers(vmId: string, status: HealthStatus, result: HealthCheckResult): void {
    for (const callback of this.subscribers) {
      try {
        callback(vmId, status, result);
      } catch (err) {
        logStream.debug("[health-monitor] Subscriber error", { error: err });
      }
    }
  }

  /**
   * Run all health checks (called by timer)
   */
  private async runChecks(): Promise<void> {
    if (!this.running) return;

    try {
      await this.checkAll();
      await this.checkStaleVms();
    } catch (err) {
      logStream.error("[health-monitor] Error running checks", { error: err });
    }
  }

  /**
   * Get current failure count for a VM
   */
  getFailureCount(vmId: string): number {
    return this.failureCounts.get(vmId) ?? 0;
  }

  /**
   * Reset failure count for a VM (e.g., after manual intervention)
   */
  resetFailureCount(vmId: string): void {
    this.failureCounts.delete(vmId);
  }
}
