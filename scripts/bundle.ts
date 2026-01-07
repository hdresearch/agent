#!/usr/bin/env bun
/**
 * Bundle vers-agent with Claude Code CLI into a self-contained package
 */

import { mkdir, cp, chmod } from "fs/promises";
import { join, dirname } from "path";
import { $ } from "bun";

const ROOT = dirname(dirname(import.meta.path));
const SDK_PATH = join(ROOT, "node_modules/@anthropic-ai/claude-agent-sdk");
const DIST = join(ROOT, "dist");

async function bundle() {
  console.log("Building vers-agent bundle...\n");

  // Clean and create dist directory
  await $`rm -rf ${DIST}`;
  await mkdir(DIST, { recursive: true });
  await mkdir(join(DIST, "claude-code"), { recursive: true });

  // 1. Build the main executable
  console.log("1. Compiling vers-agent executable...");
  await $`bun build --compile --minify ${join(ROOT, "index.ts")} --outfile ${join(DIST, "vers-agent")}`;

  // 2. Copy Claude Code CLI and dependencies
  console.log("2. Copying Claude Code CLI...");

  const filesToCopy = [
    "cli.js",
    "resvg.wasm",
    "tree-sitter.wasm",
    "tree-sitter-bash.wasm",
  ];

  for (const file of filesToCopy) {
    await cp(join(SDK_PATH, file), join(DIST, "claude-code", file));
  }

  // Copy vendor directory if it exists
  try {
    await cp(join(SDK_PATH, "vendor"), join(DIST, "claude-code", "vendor"), { recursive: true });
  } catch {
    // vendor might not exist or be empty
  }

  // 3. Create a wrapper script that sets the path
  console.log("3. Creating launcher script...");

  const launcher = `#!/bin/bash
# vers-agent launcher - sets up Claude Code path and runs the agent

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
export CLAUDE_CODE_EXECUTABLE="\${SCRIPT_DIR}/claude-code/cli.js"

exec "\${SCRIPT_DIR}/vers-agent" "$@"
`;

  await Bun.write(join(DIST, "vers-agent-launcher"), launcher);
  await chmod(join(DIST, "vers-agent-launcher"), 0o755);

  // 4. Calculate sizes
  const stats = await $`du -sh ${DIST}/*`.text();

  console.log("\nBundle complete!");
  console.log("================");
  console.log(stats);
  console.log(`\nOutput: ${DIST}/`);
  console.log("\nUsage:");
  console.log("  ./dist/vers-agent-launcher           # Both server + CLI");
  console.log("  ./dist/vers-agent-launcher --server  # Server only");
  console.log("  ./dist/vers-agent-launcher --cli     # CLI only");
}

bundle().catch((err) => {
  console.error("Bundle failed:", err);
  process.exit(1);
});
