/**
 * Objective Evaluator - runs build/test/lint commands and scores results
 * No LLM needed - pure deterministic evaluation
 */

import { detectProject, type EvalCommands, type ProjectType } from "./detector";

export interface EvalConfig {
  /** Override auto-detected commands */
  commands?: Partial<EvalCommands>;
  /** Timeout for each command in ms (default: 60000) */
  timeout?: number;
  /** Working directory */
  cwd: string;
  /** Skip certain checks */
  skip?: Array<"build" | "test" | "lint" | "typecheck">;
}

export interface CommandResult {
  command: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Parsed metrics from output */
  metrics?: {
    passed?: number;
    failed?: number;
    skipped?: number;
    total?: number;
    coverage?: number;
    errors?: number;
    warnings?: number;
  };
}

export interface EvalResult {
  /** Overall pass/fail */
  success: boolean;
  /** Detected project type */
  projectType: ProjectType;
  /** Detection confidence */
  detectionConfidence: number;
  /** Individual command results */
  results: {
    build?: CommandResult;
    test?: CommandResult;
    lint?: CommandResult;
    typecheck?: CommandResult;
  };
  /** Composite score 0-100 */
  score: number;
  /** Breakdown of score */
  scoreBreakdown: {
    build: number; // 0-25
    test: number; // 0-40
    lint: number; // 0-20
    typecheck: number; // 0-15
  };
  /** Total evaluation time */
  totalDurationMs: number;
}

/**
 * Run objective evaluation on a project
 */
export async function evaluate(config: EvalConfig): Promise<EvalResult> {
  const startTime = Date.now();
  const timeout = config.timeout ?? 60000;
  const skip = new Set(config.skip ?? []);

  // Detect project type
  const detection = await detectProject(config.cwd);

  // Merge detected commands with overrides
  const commands: EvalCommands = {
    ...detection.commands,
    ...config.commands,
  };

  const results: EvalResult["results"] = {};

  // Run each check (in order: build → typecheck → lint → test)
  // Build first since others may depend on it
  if (commands.build && !skip.has("build")) {
    results.build = await runCommand(commands.build, config.cwd, timeout);
  }

  // Typecheck after build
  if (commands.typecheck && !skip.has("typecheck")) {
    results.typecheck = await runCommand(commands.typecheck, config.cwd, timeout);
  }

  // Lint can run even if build failed
  if (commands.lint && !skip.has("lint")) {
    results.lint = await runCommand(commands.lint, config.cwd, timeout);
  }

  // Tests last (usually slowest)
  if (commands.test && !skip.has("test")) {
    results.test = await runCommand(commands.test, config.cwd, timeout);

    // Try to parse test metrics
    if (results.test) {
      results.test.metrics = parseTestOutput(
        results.test.stdout + results.test.stderr,
        detection.type
      );
    }
  }

  // Calculate score
  const scoreBreakdown = calculateScore(results);
  const score =
    scoreBreakdown.build +
    scoreBreakdown.test +
    scoreBreakdown.lint +
    scoreBreakdown.typecheck;

  // Overall success: build + test must pass (if they exist)
  const success =
    (!results.build || results.build.success) &&
    (!results.test || results.test.success);

  return {
    success,
    projectType: detection.type,
    detectionConfidence: detection.confidence,
    results,
    score,
    scoreBreakdown,
    totalDurationMs: Date.now() - startTime,
  };
}

/**
 * Run a single command and capture output
 */
async function runCommand(
  command: string,
  cwd: string,
  timeout: number
): Promise<CommandResult> {
  const startTime = Date.now();

  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        // Force color output for better parsing
        FORCE_COLOR: "1",
        // Disable interactive prompts
        CI: "true",
      },
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      proc.kill();
    }, timeout);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    clearTimeout(timeoutId);
    const exitCode = await proc.exited;

    return {
      command,
      success: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      command,
      success: false,
      exitCode: -1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Parse test output to extract metrics
 */
function parseTestOutput(
  output: string,
  projectType: ProjectType
): CommandResult["metrics"] {
  const metrics: CommandResult["metrics"] = {};

  // Bun test output: "560 pass" and "0 fail"
  // Also older format: "✓ 5 tests passed" / "✗ 2 tests failed"
  const bunPassMatch = output.match(/(\d+)\s+pass\b/i);
  const bunFailMatch = output.match(/(\d+)\s+fail\b/i);
  if (bunPassMatch || bunFailMatch) {
    metrics.passed = bunPassMatch?.[1] ? parseInt(bunPassMatch[1], 10) : 0;
    metrics.failed = bunFailMatch?.[1] ? parseInt(bunFailMatch[1], 10) : 0;
    metrics.total = (metrics.passed ?? 0) + (metrics.failed ?? 0);
    return metrics;
  }

  // Older Bun format: "✓ 5 tests passed"
  const bunOldMatch = output.match(/(\d+)\s+tests?\s+(passed|failed)/gi);
  if (bunOldMatch) {
    for (const match of bunOldMatch) {
      const innerMatch = match.match(/(\d+)\s+tests?\s+(passed|failed)/i);
      if (innerMatch?.[1] && innerMatch?.[2]) {
        const count = innerMatch[1];
        const status = innerMatch[2];
        if (status.toLowerCase() === "passed") {
          metrics.passed = parseInt(count, 10);
        } else if (status.toLowerCase() === "failed") {
          metrics.failed = parseInt(count, 10);
        }
      }
    }
    metrics.total = (metrics.passed ?? 0) + (metrics.failed ?? 0);
    return metrics;
  }

  // Jest/Vitest output: "Tests: 5 passed, 2 failed, 7 total"
  const jestMatch = output.match(
    /Tests:\s*(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?(?:,\s*(\d+)\s+total)?/i
  );
  if (jestMatch?.[1]) {
    metrics.passed = parseInt(jestMatch[1], 10);
    metrics.failed = jestMatch[2] ? parseInt(jestMatch[2], 10) : 0;
    metrics.skipped = jestMatch[3] ? parseInt(jestMatch[3], 10) : 0;
    metrics.total = jestMatch[4]
      ? parseInt(jestMatch[4], 10)
      : (metrics.passed ?? 0) + (metrics.failed ?? 0) + (metrics.skipped ?? 0);
    return metrics;
  }

  // pytest output: "5 passed, 2 failed"
  const pytestMatch = output.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i);
  if (pytestMatch?.[1]) {
    metrics.passed = parseInt(pytestMatch[1], 10);
    metrics.failed = pytestMatch[2] ? parseInt(pytestMatch[2], 10) : 0;
    metrics.total = (metrics.passed ?? 0) + (metrics.failed ?? 0);
    return metrics;
  }

  // Go test output: "ok" or "FAIL"
  // Count "--- PASS:" and "--- FAIL:"
  const goPassed = (output.match(/---\s+PASS:/g) || []).length;
  const goFailed = (output.match(/---\s+FAIL:/g) || []).length;
  if (goPassed > 0 || goFailed > 0) {
    metrics.passed = goPassed;
    metrics.failed = goFailed;
    metrics.total = goPassed + goFailed;
    return metrics;
  }

  // Rust/cargo test: "test result: ok. 5 passed; 0 failed"
  const cargoMatch = output.match(
    /test result:.*?(\d+)\s+passed;\s*(\d+)\s+failed/i
  );
  if (cargoMatch?.[1] && cargoMatch?.[2]) {
    metrics.passed = parseInt(cargoMatch[1], 10);
    metrics.failed = parseInt(cargoMatch[2], 10);
    metrics.total = (metrics.passed ?? 0) + (metrics.failed ?? 0);
    return metrics;
  }

  return metrics;
}

/**
 * Parse lint output to extract error/warning counts
 */
function parseLintOutput(output: string): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;

  // ESLint: "5 errors and 10 warnings"
  const eslintMatch = output.match(/(\d+)\s+errors?\s+and\s+(\d+)\s+warnings?/i);
  if (eslintMatch?.[1] && eslintMatch?.[2]) {
    errors = parseInt(eslintMatch[1], 10);
    warnings = parseInt(eslintMatch[2], 10);
    return { errors, warnings };
  }

  // Count lines with "error" or "warning" keywords
  const lines = output.split("\n");
  for (const line of lines) {
    if (/\berror\b/i.test(line)) errors++;
    if (/\bwarning\b/i.test(line)) warnings++;
  }

  return { errors, warnings };
}

/**
 * Calculate composite score from results
 */
function calculateScore(results: EvalResult["results"]): EvalResult["scoreBreakdown"] {
  const breakdown: EvalResult["scoreBreakdown"] = {
    build: 0,
    test: 0,
    lint: 0,
    typecheck: 0,
  };

  // Build: 25 points (all or nothing)
  if (results.build) {
    breakdown.build = results.build.success ? 25 : 0;
  } else {
    // No build command = assume success
    breakdown.build = 25;
  }

  // Test: 40 points (scaled by pass rate)
  if (results.test) {
    if (results.test.success) {
      // Full points if all pass
      breakdown.test = 40;
    } else if (results.test.metrics?.total) {
      // Partial credit based on pass rate
      const passRate =
        (results.test.metrics.passed ?? 0) / results.test.metrics.total;
      breakdown.test = Math.round(passRate * 30); // Max 30 if some fail
    } else {
      breakdown.test = 0;
    }
  } else {
    // No test command = assume success but lower confidence
    breakdown.test = 30;
  }

  // Lint: 20 points (all or nothing, but warnings are ok)
  if (results.lint) {
    breakdown.lint = results.lint.success ? 20 : 0;
  } else {
    breakdown.lint = 15; // Lower score without lint
  }

  // Typecheck: 15 points
  if (results.typecheck) {
    breakdown.typecheck = results.typecheck.success ? 15 : 0;
  } else {
    breakdown.typecheck = 10; // Lower score without typecheck
  }

  return breakdown;
}

/**
 * Quick evaluation - just run tests (fastest check)
 */
export async function evaluateQuick(cwd: string): Promise<{
  success: boolean;
  testResult?: CommandResult;
}> {
  const detection = await detectProject(cwd);

  if (!detection.commands.test) {
    return { success: true };
  }

  const testResult = await runCommand(detection.commands.test, cwd, 120000);
  testResult.metrics = parseTestOutput(
    testResult.stdout + testResult.stderr,
    detection.type
  );

  return {
    success: testResult.success,
    testResult,
  };
}
