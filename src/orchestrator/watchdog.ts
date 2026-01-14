/**
 * Watchdog - Periodic cleanup and consistency checks
 *
 * Runs less frequently than health monitor. Handles:
 * - Cleaning up stale metadata (VMs that no longer exist)
 * - Pruning old branches (completed/failed branches)
 * - Checking consistency between metadata and vers API
 */

import { listVms, deleteVm } from "../vm/index";
import { loadMetadata, removeVmMetadata, type VmMetadata } from "./index";
import { logStream } from "../utils/log-stream";
import { type WatchdogConfig, DEFAULT_WATCHDOG_CONFIG } from "./monitoring-config";

// ============================================================
// Types
// ============================================================

export interface ConsistencyReport {
  /** Total VMs in vers API */
  vmCount: number;
  /** Total VMs in our metadata */
  metadataCount: number;
  /** Metadata entries for VMs that no longer exist */
  orphanedMetadata: string[];
  /** VMs in vers API that we don't have metadata for */
  missingMetadata: string[];
  /** Branches that are old and could be cleaned up */
  staleBranches: string[];
  /** VMs with completed/failed status that could be cleaned up */
  finishedBranches: string[];
}

export interface CleanupResult {
  /** Number of metadata entries removed */
  metadataRemoved: number;
  /** Number of VMs deleted */
  vmsDeleted: number;
  /** Errors encountered */
  errors: string[];
}

// ============================================================
// Watchdog Class
// ============================================================

export class Watchdog {
  private config: WatchdogConfig;
  private timer: Timer | null = null;
  private running = false;

  constructor(config?: Partial<WatchdogConfig>) {
    this.config = { ...DEFAULT_WATCHDOG_CONFIG, ...config };
  }

  /**
   * Start the watchdog timer
   */
  start(): void {
    if (this.running) {
      logStream.debug("[watchdog] Already running");
      return;
    }

    this.running = true;
    logStream.info("[watchdog] Starting", {
      intervalMs: this.config.intervalMs,
    });

    // Run after a delay (don't run immediately on startup)
    this.timer = setInterval(() => this.runChecks(), this.config.intervalMs);
  }

  /**
   * Stop the watchdog
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logStream.info("[watchdog] Stopped");
  }

  /**
   * Check if the watchdog is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Check consistency between metadata and vers API
   */
  async checkConsistency(): Promise<ConsistencyReport> {
    const [vms, metadata] = await Promise.all([
      listVms(),
      Promise.resolve(loadMetadata()),
    ]);

    const vmIds = new Set(vms.map(vm => vm.vm_id));
    const metadataIds = new Set(Object.keys(metadata));

    // Find orphaned metadata (we have metadata but VM doesn't exist)
    const orphanedMetadata: string[] = [];
    for (const id of metadataIds) {
      if (!vmIds.has(id)) {
        orphanedMetadata.push(id);
      }
    }

    // Find missing metadata (VM exists but we don't have metadata)
    const missingMetadata: string[] = [];
    for (const id of vmIds) {
      if (!metadataIds.has(id)) {
        missingMetadata.push(id);
      }
    }

    // Find stale branches (old completed/failed VMs)
    const now = Date.now();
    const staleBranches: string[] = [];
    const finishedBranches: string[] = [];

    for (const [vmId, vm] of Object.entries(metadata)) {
      // Skip if VM doesn't exist in vers API
      if (!vmIds.has(vmId)) continue;

      const createdAt = new Date(vm.createdAt).getTime();
      const age = now - createdAt;

      // Check if finished (completed or failed)
      if (vm.status === "completed" || vm.status === "failed") {
        finishedBranches.push(vmId);

        // Also mark as stale if old enough
        if (age > this.config.staleBranchAgeMs) {
          staleBranches.push(vmId);
        }
      }

      // Also check for very old branches regardless of status
      if (age > this.config.staleMetadataAgeMs) {
        if (!staleBranches.includes(vmId)) {
          staleBranches.push(vmId);
        }
      }
    }

    const report: ConsistencyReport = {
      vmCount: vmIds.size,
      metadataCount: metadataIds.size,
      orphanedMetadata,
      missingMetadata,
      staleBranches,
      finishedBranches,
    };

    logStream.debug("[watchdog] Consistency check", report);
    return report;
  }

  /**
   * Clean up orphaned metadata entries
   */
  async cleanupStaleMetadata(): Promise<number> {
    const report = await this.checkConsistency();
    let removed = 0;

    for (const vmId of report.orphanedMetadata) {
      try {
        removeVmMetadata(vmId);
        removed++;
        logStream.info("[watchdog] Removed orphaned metadata", { vmId });
      } catch (err) {
        logStream.error("[watchdog] Failed to remove metadata", { vmId, error: err });
      }
    }

    return removed;
  }

  /**
   * Clean up old finished branches
   * Only deletes VMs with status completed/failed that are older than staleBranchAgeMs
   */
  async cleanupFinishedBranches(): Promise<CleanupResult> {
    const report = await this.checkConsistency();
    const result: CleanupResult = {
      metadataRemoved: 0,
      vmsDeleted: 0,
      errors: [],
    };

    for (const vmId of report.staleBranches) {
      const metadata = loadMetadata()[vmId];
      if (!metadata) continue;

      // Only auto-delete completed/failed branches
      if (metadata.status !== "completed" && metadata.status !== "failed") {
        continue;
      }

      try {
        logStream.info("[watchdog] Deleting stale branch", {
          vmId,
          status: metadata.status,
          createdAt: metadata.createdAt,
        });

        await deleteVm(vmId);
        result.vmsDeleted++;

        removeVmMetadata(vmId);
        result.metadataRemoved++;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        result.errors.push(`${vmId}: ${error}`);
        logStream.error("[watchdog] Failed to delete branch", { vmId, error });
      }
    }

    return result;
  }

  /**
   * Check for branches exceeding per-root limit
   * Returns VM IDs that could be pruned (oldest first)
   */
  async findExcessBranches(): Promise<Map<string, string[]>> {
    const vms = await listVms();
    const metadata = loadMetadata();

    // Group branches by root
    const branchesByRoot = new Map<string, Array<{ vmId: string; createdAt: string }>>();

    for (const vm of vms) {
      // Find root (VM with no parent)
      let rootId = vm.vm_id;
      let current = vm;
      while (current.parent) {
        rootId = current.parent;
        const parent = vms.find(v => v.vm_id === current.parent);
        if (!parent) break;
        current = parent;
      }

      // Add to root's branch list
      if (!branchesByRoot.has(rootId)) {
        branchesByRoot.set(rootId, []);
      }
      const vmMeta = metadata[vm.vm_id];
      branchesByRoot.get(rootId)!.push({
        vmId: vm.vm_id,
        createdAt: vmMeta?.createdAt ?? new Date().toISOString(),
      });
    }

    // Find roots with too many branches
    const excess = new Map<string, string[]>();

    for (const [rootId, branches] of branchesByRoot) {
      if (branches.length > this.config.maxBranchesPerRoot) {
        // Sort by creation time (oldest first)
        branches.sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        // Mark excess branches for pruning (keep newest ones)
        const toRemove = branches.length - this.config.maxBranchesPerRoot;
        const excessBranches = branches
          .slice(0, toRemove)
          .map(b => b.vmId)
          // Don't remove the root itself
          .filter(id => id !== rootId);

        if (excessBranches.length > 0) {
          excess.set(rootId, excessBranches);
          logStream.warn("[watchdog] Root has excess branches", {
            rootId,
            total: branches.length,
            excess: excessBranches.length,
          });
        }
      }
    }

    return excess;
  }

  /**
   * Run all watchdog checks (called by timer)
   */
  private async runChecks(): Promise<void> {
    if (!this.running) return;

    try {
      logStream.debug("[watchdog] Running checks");

      // Clean up orphaned metadata
      const metadataRemoved = await this.cleanupStaleMetadata();
      if (metadataRemoved > 0) {
        logStream.info("[watchdog] Cleaned up orphaned metadata", { count: metadataRemoved });
      }

      // Clean up old finished branches
      const cleanup = await this.cleanupFinishedBranches();
      if (cleanup.vmsDeleted > 0) {
        logStream.info("[watchdog] Cleaned up finished branches", {
          deleted: cleanup.vmsDeleted,
          errors: cleanup.errors.length,
        });
      }

      // Check for excess branches (just log, don't auto-delete)
      const excess = await this.findExcessBranches();
      if (excess.size > 0) {
        logStream.warn("[watchdog] Found roots with excess branches", {
          roots: Array.from(excess.keys()),
        });
      }

    } catch (err) {
      logStream.error("[watchdog] Error running checks", { error: err });
    }
  }
}
