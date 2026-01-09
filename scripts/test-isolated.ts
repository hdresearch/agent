#!/usr/bin/env bun
/**
 * Isolated Test Runner
 *
 * Runs each test file in a separate Bun process to prevent state leakage
 * between tests. This is particularly useful for:
 * - Ink component tests (stdin listener leakage)
 * - Docker tests (token/session state)
 *
 * Usage:
 *   bun scripts/test-isolated.ts                           # Run all tests
 *   bun scripts/test-isolated.ts tests/cli/components/     # Run directory
 *   bun scripts/test-isolated.ts tests/cli/components/*.tsx  # Run glob pattern
 *   bun scripts/test-isolated.ts --parallel 4 tests/       # Run with parallelism
 */

import { spawn } from "bun";
import { Glob } from "bun";

interface TestResult {
  file: string;
  exitCode: number;
  duration: number;
  stdout: string;
  stderr: string;
}

interface Options {
  parallel: number;
  verbose: boolean;
  bail: boolean;
}

function parseArgs(): { patterns: string[]; options: Options } {
  const args = process.argv.slice(2);
  const patterns: string[] = [];
  const options: Options = {
    parallel: 1, // Default to sequential for maximum isolation
    verbose: false,
    bail: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--parallel" || arg === "-p") {
      options.parallel = parseInt(args[++i] ?? "1", 10);
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--bail" || arg === "-b") {
      options.bail = true;
    } else if (!arg.startsWith("-")) {
      patterns.push(arg);
    }
  }

  // Default pattern if none provided
  if (patterns.length === 0) {
    patterns.push("tests/**/*.test.{ts,tsx}");
  }

  return { patterns, options };
}

async function findTestFiles(patterns: string[]): Promise<string[]> {
  const files = new Set<string>();

  for (const pattern of patterns) {
    // Determine if pattern is a directory by checking if it lacks wildcards and ends with /
    // or exists as a directory
    let globPattern = pattern;

    // If pattern doesn't contain wildcards, check if it's a directory
    if (!pattern.includes("*") && !pattern.includes("?")) {
      // Use Node.js fs to check if it's a directory
      const fs = await import("node:fs/promises");
      try {
        const stat = await fs.stat(pattern);
        if (stat.isDirectory()) {
          // Add trailing slash if needed and glob for test files
          const dir = pattern.endsWith("/") ? pattern : pattern + "/";
          globPattern = `${dir}**/*.test.{ts,tsx}`;
        }
      } catch {
        // Path doesn't exist, treat as glob pattern
      }
    }

    const glob = new Glob(globPattern);
    for await (const file of glob.scan({ cwd: process.cwd(), absolute: true })) {
      files.add(file);
    }
  }

  return Array.from(files).sort();
}

async function runTestFile(file: string, verbose: boolean): Promise<TestResult> {
  const start = Date.now();
  const stdout: string[] = [];
  const stderr: string[] = [];

  const proc = spawn(["bun", "test", file], {
    stdout: verbose ? "inherit" : "pipe",
    stderr: verbose ? "inherit" : "pipe",
    env: {
      ...process.env,
      VERS_AGENT_TEST_ISOLATED: "1",
      // Disable colors in non-verbose mode for cleaner output
      ...(verbose ? {} : { NO_COLOR: "1" }),
    },
  });

  // Collect output if not verbose
  if (!verbose && proc.stdout) {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stdout.push(decoder.decode(value));
    }
  }

  if (!verbose && proc.stderr) {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stderr.push(decoder.decode(value));
    }
  }

  const exitCode = await proc.exited;

  return {
    file,
    exitCode,
    duration: Date.now() - start,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

async function runTestsSequentially(
  files: string[],
  options: Options
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const relativePath = file.replace(process.cwd() + "/", "");

    if (!options.verbose) {
      process.stdout.write(`\r[${i + 1}/${files.length}] ${relativePath}...`);
    }

    const result = await runTestFile(file, options.verbose);
    results.push(result);

    if (!options.verbose) {
      const status = result.exitCode === 0 ? "✓" : "✗";
      const color = result.exitCode === 0 ? "\x1b[32m" : "\x1b[31m";
      console.log(`\r${color}${status}\x1b[0m ${relativePath} (${result.duration}ms)`);

      // Show output for failed tests
      if (result.exitCode !== 0) {
        console.log("\n--- Output ---");
        console.log(result.stdout);
        if (result.stderr) {
          console.log(result.stderr);
        }
        console.log("--------------\n");
      }
    }

    if (options.bail && result.exitCode !== 0) {
      console.log("\nBailing out due to test failure.");
      break;
    }
  }

  return results;
}

async function runTestsInParallel(
  files: string[],
  options: Options
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const inFlight: Promise<TestResult>[] = [];
  let completed = 0;

  for (const file of files) {
    // Start new test
    const promise = runTestFile(file, false).then((result) => {
      completed++;
      const relativePath = file.replace(process.cwd() + "/", "");
      const status = result.exitCode === 0 ? "✓" : "✗";
      const color = result.exitCode === 0 ? "\x1b[32m" : "\x1b[31m";
      console.log(`${color}${status}\x1b[0m [${completed}/${files.length}] ${relativePath} (${result.duration}ms)`);

      if (result.exitCode !== 0 && !options.verbose) {
        console.log("  Output:", result.stdout.slice(0, 200) + (result.stdout.length > 200 ? "..." : ""));
      }

      return result;
    });

    inFlight.push(promise);

    // If we've hit max parallelism, wait for one to complete
    if (inFlight.length >= options.parallel) {
      const result = await Promise.race(inFlight);
      results.push(result);
      inFlight.splice(inFlight.indexOf(promise), 1);

      if (options.bail && result.exitCode !== 0) {
        console.log("\nBailing out due to test failure.");
        break;
      }
    }
  }

  // Wait for remaining tests
  const remaining = await Promise.all(inFlight);
  results.push(...remaining);

  return results;
}

async function main() {
  const { patterns, options } = parseArgs();

  console.log("🧪 Isolated Test Runner\n");
  console.log(`Patterns: ${patterns.join(", ")}`);
  console.log(`Parallelism: ${options.parallel}`);
  console.log("");

  const files = await findTestFiles(patterns);

  if (files.length === 0) {
    console.log("No test files found matching patterns.");
    process.exit(0);
  }

  console.log(`Found ${files.length} test file(s)\n`);

  const results =
    options.parallel > 1
      ? await runTestsInParallel(files, options)
      : await runTestsSequentially(files, options);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("Summary\n");

  const passed = results.filter((r) => r.exitCode === 0);
  const failed = results.filter((r) => r.exitCode !== 0);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\x1b[32m✓ ${passed.length} passed\x1b[0m`);

  if (failed.length > 0) {
    console.log(`\x1b[31m✗ ${failed.length} failed\x1b[0m`);
    console.log("\nFailed tests:");
    for (const result of failed) {
      const relativePath = result.file.replace(process.cwd() + "/", "");
      console.log(`  - ${relativePath}`);
    }
  }

  console.log(`\nTotal time: ${(totalDuration / 1000).toFixed(2)}s`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Test runner error:", error);
  process.exit(1);
});
