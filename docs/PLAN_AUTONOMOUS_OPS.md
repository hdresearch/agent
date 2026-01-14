# Autonomous Operation Implementation Plan

## Overview

Add three components to enable unattended, self-healing operation:

1. **Health Monitor** - Periodic health checks on all managed VMs
2. **Self-Healer** - Automatically fix issues (recreate VMs, cancel stuck tasks)
3. **Watchdog** - Top-level supervisor for cleanup and consistency

---

## Current State Summary

### What We Have ✅

| Component | Status | Notes |
|-----------|--------|-------|
| VM primitives | Complete | `createVm()`, `branch()`, `deleteVm()` via vers-sdk |
| Basic health check | Works | `curl /health` via SSH in bootstrap |
| Event streaming | Complete | SSE with reconnect, 1000-event buffer |
| VM metadata persistence | Basic | JSON file, tracks status/task/approach |
| Task lifecycle | Complete | Full state machine with cancel support |
| Connection tracking | Partial | Status enum but no heartbeat |

### What's Missing ❌

| Feature | Complexity | Notes |
|---------|------------|-------|
| Periodic health monitor | Low | Timer + existing health check |
| Stale VM detection | Low | Add `lastEventAt` tracking |
| Auto VM recreation | Medium | Reconnect flow needs care |
| Stuck task detection | Medium | Need timeout enforcement |
| Branch cleanup | Low | Age-based pruning |
| Circuit breaker | Medium | Failure rate tracking |
| Watchdog service | Low | Periodic scan loop |

---

## Implementation Plan

### Phase 1: Extend Metadata (Low Risk)

**Files:** `src/orchestrator/index.ts`, `src/protocol/acp-types.ts`

Extend `VmMetadata` to track health-related fields:

```typescript
interface VmMetadata {
  // Existing
  task?: string;
  approach?: string;
  status: VmStatus;
  createdAt: string;
  parentId?: string;

  // NEW: Health tracking
  lastHealthCheckAt?: string;    // Last successful health check
  lastEventAt?: string;          // Last event received
  healthScore?: number;          // 0-100, computed from checks
  consecutiveFailures?: number;  // For circuit breaker
  lastError?: string;            // Most recent error
  recoveryAttempts?: number;     // How many times we've tried to fix
}

type VmStatus =
  | "starting"    // Being created
  | "ready"       // Healthy, idle
  | "busy"        // Running a task
  | "completed"   // Task finished successfully
  | "failed"      // Task failed
  | "unhealthy"   // Health check failing    <- NEW
  | "recovering"; // Being recreated         <- NEW
```

**Effort:** ~30 min
**Risk:** None - additive change

---

### Phase 2: Health Monitor (Low Risk)

**New file:** `src/orchestrator/health-monitor.ts`

A simple timer-based service that:
1. Iterates all managed VMs every N seconds
2. Pings each VM's `/health` endpoint
3. Updates `lastHealthCheckAt` and `healthScore`
4. Emits events for status changes

```typescript
export interface HealthMonitorConfig {
  intervalMs: number;           // Default: 30000 (30s)
  timeoutMs: number;            // Default: 5000 (5s per check)
  unhealthyThreshold: number;   // Default: 3 consecutive failures
}

export class HealthMonitor {
  private timer: Timer | null = null;
  private running = false;

  start(): void;
  stop(): void;

  // Manual check (for testing)
  async checkVm(vmId: string): Promise<HealthCheckResult>;
  async checkAll(): Promise<Map<string, HealthCheckResult>>;

  // Subscribe to health events
  onHealthChange(cb: (vmId: string, status: HealthStatus) => void): () => void;
}

interface HealthCheckResult {
  vmId: string;
  healthy: boolean;
  responseTimeMs: number;
  error?: string;
  metrics?: {
    prompts: number;
    sessions: number;
    queueLength: number;
  };
}
```

**Implementation approach:**
1. Use existing `execute(vmId, "curl -s http://localhost:80/health")` from `src/vm/index.ts`
2. Parse JSON response properly (not just string grep)
3. Track consecutive failures for unhealthy detection
4. Update metadata after each check

**Effort:** ~2-3 hours
**Risk:** Low - uses existing primitives
**Experimental:** None - straightforward polling

---

### Phase 3: Self-Healer (Medium Risk)

**New file:** `src/orchestrator/self-healer.ts`

Listens for health events and takes corrective action:

```typescript
export interface SelfHealerConfig {
  maxRecoveryAttempts: number;  // Default: 3
  recoveryDelayMs: number;      // Default: 5000
  taskTimeoutMs: number;        // Default: 300000 (5 min)
}

export class SelfHealer {
  constructor(
    private healthMonitor: HealthMonitor,
    private config: SelfHealerConfig
  );

  start(): void;  // Subscribe to health events
  stop(): void;

  // Healing strategies
  private async healUnresponsive(vmId: string): Promise<HealResult>;
  private async healStuckTask(vmId: string): Promise<HealResult>;
  private async recreateFromParent(vmId: string): Promise<HealResult>;
}

interface HealResult {
  success: boolean;
  action: "recreated" | "cancelled" | "restarted" | "abandoned";
  newVmId?: string;  // If recreated
  error?: string;
}
```

**Healing strategies:**

1. **Unresponsive VM** (health check fails 3+ times):
   - Get parent VM ID from metadata
   - Delete unresponsive VM
   - Branch from parent (or create new root if no parent)
   - Reconnect client
   - Re-run task if it was in progress

2. **Stuck Task** (busy status for > timeout):
   - Cancel task via `client.cancel()`
   - Wait briefly for cancellation
   - If still stuck, recreate VM
   - Mark task as failed

3. **Circuit Breaker** (too many failures):
   - If a VM has been recreated 3+ times
   - Mark it as "abandoned"
   - Don't auto-heal anymore
   - Log for human review

**Effort:** ~4-6 hours
**Risk:** Medium - need to handle edge cases
**Experimental areas:**
- Task re-running after VM recreation (need to preserve context)
- Race conditions between health check and task completion
- Handling VMs that are slow but not dead

---

### Phase 4: Stuck Task Detection (Medium Risk)

**Modify:** `src/orchestrator/index.ts`

Add timeout tracking to `runPrompt()`:

```typescript
export async function runPrompt(
  vmId: string,
  text: string,
  options?: { timeoutMs?: number }
): Promise<{ success: boolean; error?: string; timedOut?: boolean }> {
  const timeout = options?.timeoutMs ?? 300000; // 5 min default

  updateVmMetadata(vmId, { status: "busy" });

  const startTime = Date.now();

  // Create a promise that rejects on timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Task timed out")), timeout);
  });

  try {
    await Promise.race([
      managed.client.prompt(text),
      timeoutPromise
    ]);
    updateVmMetadata(vmId, { status: "ready" });
    return { success: true };
  } catch (e) {
    if (e.message === "Task timed out") {
      updateVmMetadata(vmId, { status: "unhealthy" });
      return { success: false, timedOut: true, error: "Task timed out" };
    }
    // ... existing error handling
  }
}
```

**Alternative approach:** Track `taskStartedAt` in metadata and let health monitor detect stuck tasks by checking duration.

**Effort:** ~1-2 hours
**Risk:** Medium - timeout behavior with SSE streams
**Experimental:** How `client.prompt()` behaves when cancelled mid-stream

---

### Phase 5: Watchdog (Low Risk)

**New file:** `src/orchestrator/watchdog.ts`

Top-level supervisor that runs less frequently:

```typescript
export interface WatchdogConfig {
  intervalMs: number;            // Default: 300000 (5 min)
  staleMetadataAgeMs: number;   // Default: 86400000 (24 hours)
  maxBranchesPerRoot: number;   // Default: 20
}

export class Watchdog {
  start(): void;
  stop(): void;

  // Individual checks (for testing)
  async cleanupStaleMetadata(): Promise<number>;
  async cleanupOrphanedBranches(): Promise<number>;
  async checkConsistency(): Promise<ConsistencyReport>;
}

interface ConsistencyReport {
  vmCount: number;
  metadataCount: number;
  orphanedMetadata: string[];   // Metadata for deleted VMs
  missingMetadata: string[];    // VMs without metadata
  staleBranches: string[];      // Old branches to clean up
}
```

**Tasks:**

1. **Metadata cleanup:**
   - Load metadata from JSON
   - Call `listVms()` from vers API
   - Delete metadata for VMs that no longer exist

2. **Branch cleanup:**
   - Find branches older than threshold
   - Find branches with status "completed" or "failed"
   - Delete them

3. **Consistency check:**
   - Compare in-memory `managedVms` vs JSON vs vers API
   - Log discrepancies
   - Optionally auto-fix

**Effort:** ~2-3 hours
**Risk:** Low - read-heavy, deletes are explicit
**Experimental:** None

---

### Phase 6: Integration & Config

**Modify:** `src/orchestrator/index.ts`

Add startup/shutdown for monitoring services:

```typescript
let healthMonitor: HealthMonitor | null = null;
let selfHealer: SelfHealer | null = null;
let watchdog: Watchdog | null = null;

export function startMonitoring(config?: MonitoringConfig): void {
  healthMonitor = new HealthMonitor(config?.health);
  selfHealer = new SelfHealer(healthMonitor, config?.healing);
  watchdog = new Watchdog(config?.watchdog);

  healthMonitor.start();
  selfHealer.start();
  watchdog.start();
}

export function stopMonitoring(): void {
  watchdog?.stop();
  selfHealer?.stop();
  healthMonitor?.stop();
}
```

**New config file:** `~/.vers-agent/orchestrator/config.json`

```json
{
  "monitoring": {
    "enabled": true,
    "health": {
      "intervalMs": 30000,
      "timeoutMs": 5000,
      "unhealthyThreshold": 3
    },
    "healing": {
      "enabled": true,
      "maxRecoveryAttempts": 3,
      "taskTimeoutMs": 300000
    },
    "watchdog": {
      "intervalMs": 300000,
      "staleMetadataAgeMs": 86400000
    }
  }
}
```

**Effort:** ~1 hour
**Risk:** Low

---

## File Structure

```
src/orchestrator/
├── index.ts                 # Existing - add startMonitoring()
├── health-monitor.ts        # NEW - periodic health checks
├── self-healer.ts           # NEW - auto-recovery logic
├── watchdog.ts              # NEW - cleanup and consistency
└── config.ts                # NEW - monitoring configuration
```

---

## Risk Assessment

### Low Risk (Straightforward)
- Health monitor polling - just a timer + existing curl
- Metadata extension - additive schema change
- Watchdog cleanup - read-heavy, explicit deletes
- Configuration - standard JSON parsing

### Medium Risk (Needs Care)
- Self-healer recreate flow - must handle edge cases:
  - What if parent VM is also dead?
  - What if branch fails?
  - What if task was mid-completion?
- Stuck task timeout - SSE stream behavior when cancelled
- Circuit breaker - need to avoid infinite loops

### Experimental (Unknown Behavior)
- **Task context preservation**: If a VM dies mid-task, can we resume? Currently no - we'd have to restart from scratch or use session persistence.
- **Network flakiness**: How often do Vers VMs become transiently unreachable? Unknown. May need to tune thresholds.
- **Golden image staleness**: If the golden commit becomes outdated, restoration may fail. Need fallback.

---

## Implementation Order

### Part A: Non-Experimental (Implement First)

These are straightforward - just timers, polling, and CRUD on existing primitives:

```
1. Extend Metadata (30 min)
   - Add health tracking fields to VmMetadata
   - No behavior change, just schema

2. Health Monitor (2-3 hrs)
   - Timer + existing execute(vmId, "curl /health")
   - Parse JSON response
   - Update metadata with results
   - Emit events on status change

3. Watchdog (2-3 hrs)
   - Periodic cleanup of stale metadata
   - Compare JSON file vs vers API
   - Delete orphaned entries
   - Age-based branch pruning

4. Config & Integration (1 hr)
   - Config file for intervals/thresholds
   - startMonitoring() / stopMonitoring()
```

**Total Part A: ~6-8 hours**

### Part B: Experimental (Implement Later)

These have unknowns that need investigation or careful design:

```
5. Stuck Task Detection (1-2 hrs)
   EXPERIMENTAL: SSE stream timeout behavior
   - What happens when we timeout client.prompt()?
   - Does cancel() work reliably mid-stream?
   - Need to test with real agent

6. Self-Healer (4-6 hrs)
   EXPERIMENTAL: Multiple unknowns
   - Task resumption: restart vs continue vs fail?
   - Race conditions: health check vs task completion
   - Parent chain: what if parent VM is also dead?
   - Network flakiness: what thresholds work?
```

**Total Part B: ~5-8 hours**

---

## Testing Strategy

### Unit Tests
- Health check parsing (mock curl responses)
- Metadata update logic
- Timeout calculations
- Circuit breaker state machine

### Integration Tests (require VMs)
- Create VM → health check → verify healthy
- Create VM → stop agent → verify unhealthy
- Create VM → run long task → verify stuck detection
- Self-healer: kill VM → verify recreation

### Manual Testing
- Start orchestrator with monitoring
- Create 3-5 VMs
- Manually kill agent on one VM (via SSH)
- Observe: health check fails → self-healer kicks in → VM recreated
- Run long task → observe stuck detection

---

## Open Questions

1. **Task resumption**: When we recreate a VM, should we:
   - A) Restart the task from scratch
   - B) Try to load session and continue
   - C) Mark as failed and notify caller

   Recommendation: Start with (C), add (A) later.

2. **Notification mechanism**: How should we surface issues?
   - Log only (current approach)
   - Add `onIssue()` callback
   - Emit events via SSE

   Recommendation: All three - logs always, callbacks for programmatic use, events for CLI.

3. **Healing authorization**: Should auto-healing be:
   - Always on (default)
   - Opt-in per VM
   - Configurable globally

   Recommendation: Global config with per-VM override.

4. **Resource limits**: Should we enforce:
   - Max concurrent VMs
   - Max branches per root
   - Max total branches

   Recommendation: Yes, with sensible defaults (10, 20, 50).

---

## Summary

| Component | Effort | Risk | Experimental |
|-----------|--------|------|--------------|
| Metadata extension | 30 min | None | No |
| Health Monitor | 2-3 hrs | Low | No |
| Watchdog | 2-3 hrs | Low | No |
| Stuck Task Detection | 1-2 hrs | Medium | Timeout behavior |
| Self-Healer | 4-6 hrs | Medium | Task resumption, race conditions |
| Config & Integration | 1 hr | Low | No |
| **Total** | **12-16 hrs** | **Medium** | **Some** |

The foundation is solid. Most work is straightforward timer/polling logic using existing primitives. The main experimental areas are:
1. Task resumption after VM recreation
2. Network flakiness thresholds
3. Race conditions between healing and normal operations
