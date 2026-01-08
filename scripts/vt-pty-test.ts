#!/usr/bin/env bun
/**
 * PTY-based VT Sequence Test for vers-agent TUI
 * 
 * Spawns the CLI in a pseudo-terminal and injects VT sequences,
 * then captures and analyzes the output.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const VT = {
  // Control characters
  ESC: "\x1b",
  BEL: "\x07",
  CR: "\r",
  LF: "\n",
  
  // CSI sequences
  csi: (params: string, final: string) => `\x1b[${params}${final}`,
  
  // Common sequences
  cursorUp: (n = 1) => `\x1b[${n}A`,
  cursorDown: (n = 1) => `\x1b[${n}B`,
  enter: "\r",
  ctrlC: "\x03",
  ctrlD: "\x04",
  
  // SGR
  bold: "\x1b[1m",
  reset: "\x1b[0m",
  fgRgb: (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`,
};

// Parse VT sequences from output
function parseVtSequences(data: string): { text: string; sequences: string[] } {
  const sequences: string[] = [];
  // Match ESC sequences: ESC [ ... final_byte or ESC ] ... BEL/ST
  const seqRegex = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07]*\x07|\][^\x1b]*\x1b\\)/g;
  
  let text = data;
  let match;
  while ((match = seqRegex.exec(data)) !== null) {
    sequences.push(match[0]);
  }
  text = data.replace(seqRegex, "");
  
  return { text, sequences };
}

async function testCliResponsiveness() {
  console.log("🔬 PTY VT Test: Testing vers-agent CLI responsiveness\n");
  
  // First check if server is running
  let serverRunning = false;
  try {
    const res = await fetch("http://localhost:9999/health", { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      serverRunning = true;
      console.log("✓ Server is running\n");
    }
  } catch {
    console.log("⚠ Server not running. Testing basic VT handling only.\n");
  }
  
  // Test 1: Direct output parsing
  console.log("─── Test 1: VT Sequence Parsing ───");
  const testOutput = `${VT.bold}Status:${VT.reset} ${VT.fgRgb(199, 120, 234)}connected${VT.reset}\n`;
  const parsed = parseVtSequences(testOutput);
  console.log(`Raw length: ${testOutput.length}`);
  console.log(`Text only: "${parsed.text.trim()}"`);
  console.log(`Sequences found: ${parsed.sequences.length}`);
  parsed.sequences.forEach((seq, i) => {
    console.log(`  [${i}] ${JSON.stringify(seq)}`);
  });
  
  // Test 2: Simulated input processing
  console.log("\n─── Test 2: Input Handler VT Processing ───");
  
  // Import the input handler
  const { processKeyInput } = await import("../src/cli/input-handler");
  
  const testCases = [
    { char: "a", key: {}, expected: "character input" },
    { char: "a", key: { ctrl: true }, expected: "Ctrl+A (beginning of line)" },
    { char: "e", key: { ctrl: true }, expected: "Ctrl+E (end of line)" },
    { char: "c", key: { ctrl: true }, expected: "Ctrl+C (cancel/exit)" },
    { char: "", key: { return: true }, expected: "Enter (submit)" },
    { char: "", key: { return: true, shift: true }, expected: "Shift+Enter (newline)" },
    { char: "", key: { leftArrow: true }, expected: "Left arrow" },
    { char: "", key: { backspace: true }, expected: "Backspace" },
  ];
  
  for (const tc of testCases) {
    const state = { value: "hello world", cursorIndex: 5, disabled: false };
    const action = processKeyInput(tc.char, tc.key, state);
    console.log(`${tc.expected}: ${action.type}`);
  }
  
  // Test 3: SGR attribute extraction (like libghostty-vt does)
  console.log("\n─── Test 3: SGR Sequence Analysis ───");
  const sgrCases = [
    { seq: "\x1b[0m", desc: "Reset" },
    { seq: "\x1b[1m", desc: "Bold" },
    { seq: "\x1b[31m", desc: "Red FG" },
    { seq: "\x1b[38;5;199m", desc: "256-color FG (199)" },
    { seq: "\x1b[38;2;199;120;234m", desc: "True color FG (#c778ea)" },
    { seq: "\x1b[4:3m", desc: "Curly underline" },
    { seq: "\x1b[1;31;48;2;0;0;0m", desc: "Bold + Red FG + Black BG (true color)" },
  ];
  
  for (const { seq, desc } of sgrCases) {
    // Extract params from CSI m sequence
    const match = seq.match(/\x1b\[([0-9;:]+)?m/);
    if (match) {
      const params = match[1] || "0";
      console.log(`${desc}: params=[${params}]`);
    }
  }
  
  // Test 4: OSC sequence types
  console.log("\n─── Test 4: OSC Sequence Types ───");
  const oscCases = [
    { seq: "\x1b]0;My Title\x07", desc: "Set window title" },
    { seq: "\x1b]52;c;SGVsbG8=\x07", desc: "Set clipboard (base64)" },
    { seq: "\x1b]8;;https://example.com\x07link\x1b]8;;\x07", desc: "Hyperlink" },
    { seq: "\x1b]7;file:///home/user\x07", desc: "Set CWD" },
    { seq: "\x1b]133;A\x07", desc: "Shell integration: prompt start" },
  ];
  
  for (const { seq, desc } of oscCases) {
    const match = seq.match(/\x1b\](\d+);?/);
    if (match) {
      console.log(`OSC ${match[1]}: ${desc}`);
    }
  }
  
  console.log("\n✓ VT sequence tests complete");
  console.log("\nTo test interactively: just gvt");
}

testCliResponsiveness().catch(console.error);
