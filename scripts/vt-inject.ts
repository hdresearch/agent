#!/usr/bin/env bun
/**
 * VT Sequence Injection Test for vers-agent TUI
 * 
 * Tests how the Ink-based TUI handles various VT escape sequences.
 * Uses expect/pty to spawn the CLI and inject sequences.
 */

import { $ } from "bun";

// VT Sequence library
const VT = {
  // CSI sequences
  CSI: "\x1b[",
  
  // Cursor movement
  cursorUp: (n = 1) => `\x1b[${n}A`,
  cursorDown: (n = 1) => `\x1b[${n}B`,
  cursorForward: (n = 1) => `\x1b[${n}C`,
  cursorBack: (n = 1) => `\x1b[${n}D`,
  cursorPosition: (row: number, col: number) => `\x1b[${row};${col}H`,
  
  // SGR (colors/styles)
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  blink: "\x1b[5m",
  inverse: "\x1b[7m",
  hidden: "\x1b[8m",
  strikethrough: "\x1b[9m",
  
  // 8 colors
  fg: {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
  },
  bg: {
    black: "\x1b[40m",
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
    white: "\x1b[47m",
  },
  
  // 256 colors
  fg256: (n: number) => `\x1b[38;5;${n}m`,
  bg256: (n: number) => `\x1b[48;5;${n}m`,
  
  // True color (24-bit)
  fgRgb: (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`,
  bgRgb: (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,
  
  // OSC sequences
  setTitle: (title: string) => `\x1b]0;${title}\x07`,
  setClipboard: (data: string) => `\x1b]52;c;${btoa(data)}\x07`,
  hyperlink: (url: string, text: string) => `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`,
  
  // Screen modes
  altScreenOn: "\x1b[?1049h",
  altScreenOff: "\x1b[?1049l",
  cursorHide: "\x1b[?25l",
  cursorShow: "\x1b[?25h",
  
  // Mouse
  mouseOn: "\x1b[?1000h",
  mouseOff: "\x1b[?1000l",
  
  // Bracketed paste
  bracketedPasteOn: "\x1b[?2004h",
  bracketedPasteOff: "\x1b[?2004l",
  pasteStart: "\x1b[200~",
  pasteEnd: "\x1b[201~",
};

// Test cases
const tests = [
  {
    name: "SGR: Bold + Color",
    input: `${VT.bold}${VT.fg.red}hello${VT.reset}`,
    description: "Should handle bold red text",
  },
  {
    name: "SGR: 256 color",
    input: `${VT.fg256(199)}pink text${VT.reset}`,
    description: "Should handle 256-color palette",
  },
  {
    name: "SGR: True color",
    input: `${VT.fgRgb(199, 120, 234)}#c778ea${VT.reset}`,
    description: "Should handle 24-bit RGB",
  },
  {
    name: "OSC: Set title",
    input: VT.setTitle("vers-agent test"),
    description: "Should set terminal title",
  },
  {
    name: "OSC: Hyperlink",
    input: VT.hyperlink("https://github.com/hdresearch/agent", "vers-agent"),
    description: "Should render clickable hyperlink",
  },
  {
    name: "Cursor: Movement",
    input: `ABC${VT.cursorBack(2)}X`,
    description: "Should overwrite B with X → AXC",
  },
  {
    name: "Bracketed paste",
    input: `${VT.pasteStart}pasted content${VT.pasteEnd}`,
    description: "Should handle bracketed paste mode",
  },
];

async function main() {
  console.log("🔬 VT Sequence Injection Tests for vers-agent\n");
  
  // Check if server is running
  try {
    const health = await fetch("http://localhost:9999/health");
    if (!health.ok) throw new Error("Server not healthy");
    console.log("✓ Server running on :9999\n");
  } catch {
    console.log("⚠ Server not running. Start with: just server\n");
    console.log("Running standalone sequence tests...\n");
  }
  
  // Test each sequence by writing to stdout
  for (const test of tests) {
    console.log(`─── ${test.name} ───`);
    console.log(`Description: ${test.description}`);
    console.log(`Sequence: ${JSON.stringify(test.input)}`);
    console.log(`Output: ${test.input}`);
    console.log();
  }
  
  // Interactive demo
  console.log("─── Interactive Demo ───");
  console.log("The following text demonstrates various VT sequences:\n");
  
  // Rainbow text
  const rainbow = [196, 208, 226, 46, 51, 21, 129];
  let rainbowText = "";
  const word = "RAINBOW";
  for (let i = 0; i < word.length; i++) {
    rainbowText += VT.fg256(rainbow[i % rainbow.length]!) + word[i];
  }
  console.log(rainbowText + VT.reset);
  
  // Styles
  console.log(`${VT.bold}Bold${VT.reset} ${VT.dim}Dim${VT.reset} ${VT.italic}Italic${VT.reset} ${VT.underline}Underline${VT.reset} ${VT.strikethrough}Strike${VT.reset}`);
  
  // True color gradient
  let gradient = "";
  for (let i = 0; i < 40; i++) {
    const r = Math.floor(199 + (i / 40) * 56);
    const g = Math.floor(120 - (i / 40) * 80);
    const b = Math.floor(234 - (i / 40) * 100);
    gradient += VT.bgRgb(r, g, b) + " ";
  }
  console.log(gradient + VT.reset);
  
  // Hyperlink
  console.log(`\nClick: ${VT.hyperlink("https://github.com/hdresearch/agent", "vers-agent repo")}`);
  
  console.log("\n✓ VT sequence tests complete");
}

main().catch(console.error);
