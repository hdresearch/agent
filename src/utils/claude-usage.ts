// Claude Code Usage Calculator
// Reads stats from ~/.claude/stats-cache.json and calculates session usage

import { homedir } from "os";
import { join } from "path";
import { logStream } from "./log-stream";

// Anthropic pricing (per million tokens)
const PRICING = {
  "claude-opus-4-5-20251101": {
    input: 15,
    output: 75,
    cacheRead: 1.5, // 90% discount
    cacheWrite: 18.75, // 25% premium
  },
  "claude-sonnet-4-5-20250929": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  // Fallback for unknown models
  default: {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
} as const;

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface StatsCache {
  modelUsage: Record<string, ModelUsage>;
  totalSessions: number;
  totalMessages: number;
  dailyActivity?: Array<{
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }>;
}

export interface UsageSnapshot {
  timestamp: Date;
  modelUsage: Record<string, ModelUsage>;
}

export interface UsageDelta {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface SessionUsage {
  sessionId: string | null;
  deltas: UsageDelta[];
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  snapshotAge: number; // milliseconds since snapshot
}

const STATS_CACHE_PATH = join(homedir(), ".claude", "stats-cache.json");

// Session baseline snapshot
let baselineSnapshot: UsageSnapshot | null = null;

/**
 * Read the Claude Code stats cache
 */
export async function readStatsCache(): Promise<StatsCache | null> {
  try {
    const file = Bun.file(STATS_CACHE_PATH);
    if (!(await file.exists())) {
      logStream.debug("[claude-usage] stats-cache.json not found");
      return null;
    }
    const text = await file.text();
    return JSON.parse(text) as StatsCache;
  } catch (err) {
    logStream.error("[claude-usage] Failed to read stats-cache.json", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Take a baseline snapshot of current usage
 * Call this when the agent session starts
 */
export async function snapshotBaseline(): Promise<void> {
  const stats = await readStatsCache();
  if (stats) {
    baselineSnapshot = {
      timestamp: new Date(),
      modelUsage: structuredClone(stats.modelUsage),
    };
    logStream.info("[claude-usage] Captured baseline snapshot", {
      models: Object.keys(stats.modelUsage),
    });
  } else {
    // Create empty baseline
    baselineSnapshot = {
      timestamp: new Date(),
      modelUsage: {},
    };
    logStream.warn("[claude-usage] No stats cache found, using empty baseline");
  }
}

/**
 * Calculate cost for a given model and token counts
 */
function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number
): number {
  const pricing = PRICING[model as keyof typeof PRICING] || PRICING.default;

  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cacheReadTokens / 1_000_000) * pricing.cacheRead +
    (cacheWriteTokens / 1_000_000) * pricing.cacheWrite;

  return cost;
}

/**
 * Get current session usage by comparing to baseline
 */
export async function getSessionUsage(sessionId: string | null): Promise<SessionUsage | null> {
  if (!baselineSnapshot) {
    logStream.warn("[claude-usage] No baseline snapshot, cannot calculate usage");
    return null;
  }

  const currentStats = await readStatsCache();
  if (!currentStats) {
    return null;
  }

  const deltas: UsageDelta[] = [];
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;

  // Calculate deltas for each model
  for (const [model, currentUsage] of Object.entries(currentStats.modelUsage)) {
    const baselineUsage = baselineSnapshot.modelUsage[model] || {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };

    const inputDelta = currentUsage.inputTokens - baselineUsage.inputTokens;
    const outputDelta = currentUsage.outputTokens - baselineUsage.outputTokens;
    const cacheReadDelta = currentUsage.cacheReadInputTokens - baselineUsage.cacheReadInputTokens;
    const cacheWriteDelta = currentUsage.cacheCreationInputTokens - baselineUsage.cacheCreationInputTokens;

    // Only include if there's actual usage
    if (inputDelta > 0 || outputDelta > 0 || cacheReadDelta > 0 || cacheWriteDelta > 0) {
      const cost = calculateCost(model, inputDelta, outputDelta, cacheReadDelta, cacheWriteDelta);

      deltas.push({
        model,
        inputTokens: inputDelta,
        outputTokens: outputDelta,
        cacheReadTokens: cacheReadDelta,
        cacheWriteTokens: cacheWriteDelta,
        costUsd: cost,
      });

      totalCostUsd += cost;
      totalInputTokens += inputDelta;
      totalOutputTokens += outputDelta;
      totalCacheReadTokens += cacheReadDelta;
      totalCacheWriteTokens += cacheWriteDelta;
    }
  }

  return {
    sessionId,
    deltas,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    snapshotAge: Date.now() - baselineSnapshot.timestamp.getTime(),
  };
}

/**
 * Format tokens for display (e.g., 1.2K, 45.3K, 1.2M)
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Reset the baseline (call when starting a new session)
 */
export function resetBaseline(): void {
  baselineSnapshot = null;
}

/**
 * Check if Claude Code stats are available
 */
export async function isClaudeUsageAvailable(): Promise<boolean> {
  const file = Bun.file(STATS_CACHE_PATH);
  return file.exists();
}
