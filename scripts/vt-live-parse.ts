#!/usr/bin/env bun
/**
 * 🔬 Live VT Sequence Parser Visualization
 * 
 * Shows bytes flowing through the parser state machine in real-time,
 * like watching a terminal emulator's brain work.
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const ESC = "\x1b";
const CSI = `${ESC}[`;

// Colors
const rgb = (r: number, g: number, b: number) => `${CSI}38;2;${r};${g};${b}m`;
const bgRgb = (r: number, g: number, b: number) => `${CSI}48;2;${r};${g};${b}m`;
const reset = `${CSI}0m`;
const bold = `${CSI}1m`;
const dim = `${CSI}2m`;

const purple = rgb(199, 120, 234);
const green = rgb(152, 195, 121);
const red = rgb(224, 108, 117);
const blue = rgb(97, 175, 239);
const yellow = rgb(229, 192, 123);
const cyan = rgb(86, 182, 194);
const gray = rgb(92, 99, 112);

// Parser states (matching libghostty-vt's Parser.zig)
type State = "ground" | "escape" | "escape_intermediate" | "csi_entry" | "csi_param" | "csi_intermediate" | "osc_string";

interface ParserState {
  state: State;
  params: number[];
  intermediates: string;
  oscBuffer: string;
}

function stateColor(state: State): string {
  switch (state) {
    case "ground": return green;
    case "escape": return yellow;
    case "csi_entry": return cyan;
    case "csi_param": return blue;
    case "csi_intermediate": return purple;
    case "osc_string": return red;
    default: return gray;
  }
}

function byteColor(byte: number): string {
  if (byte === 0x1b) return red;           // ESC
  if (byte === 0x5b) return cyan;           // [
  if (byte === 0x5d) return yellow;         // ]
  if (byte >= 0x30 && byte <= 0x39) return green;  // 0-9
  if (byte === 0x3b) return gray;           // ;
  if (byte >= 0x40 && byte <= 0x7e) return purple; // Final byte
  return blue;
}

function formatByte(byte: number): string {
  const color = byteColor(byte);
  const hex = byte.toString(16).padStart(2, '0').toUpperCase();
  const char = byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.';
  return `${color}${hex}${reset}`;
}

function formatChar(byte: number): string {
  const color = byteColor(byte);
  if (byte === 0x1b) return `${color}ESC${reset}`;
  if (byte === 0x07) return `${color}BEL${reset}`;
  if (byte < 0x20) return `${color}^${String.fromCharCode(byte + 0x40)}${reset}`;
  return `${color}${String.fromCharCode(byte)}${reset}`;
}

// Simple VT parser simulation
function parseSequence(input: string): { state: State; action: string }[] {
  const events: { state: State; action: string }[] = [];
  let state: State = "ground";
  let params: number[] = [];
  let currentParam = 0;
  let oscBuffer = "";
  
  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i);
    const prevState = state;
    let action = "";
    
    switch (state) {
      case "ground":
        if (byte === 0x1b) {
          state = "escape";
          action = "ESC detected → escape";
        } else if (byte >= 0x20 && byte < 0x7f) {
          action = `print '${String.fromCharCode(byte)}'`;
        } else {
          action = `execute C0: ${byte.toString(16)}`;
        }
        break;
        
      case "escape":
        if (byte === 0x5b) { // [
          state = "csi_entry";
          action = "CSI start → csi_entry";
        } else if (byte === 0x5d) { // ]
          state = "osc_string";
          oscBuffer = "";
          action = "OSC start → osc_string";
        } else if (byte >= 0x40 && byte <= 0x5f) {
          state = "ground";
          action = `ESC dispatch: ${String.fromCharCode(byte)}`;
        } else {
          state = "escape_intermediate";
          action = `intermediate: ${String.fromCharCode(byte)}`;
        }
        break;
        
      case "csi_entry":
      case "csi_param":
        if (byte >= 0x30 && byte <= 0x39) { // 0-9
          state = "csi_param";
          currentParam = currentParam * 10 + (byte - 0x30);
          action = `param digit: ${currentParam}`;
        } else if (byte === 0x3b) { // ;
          params.push(currentParam);
          currentParam = 0;
          action = `param sep, collected: [${params.join(',')}]`;
        } else if (byte === 0x3a) { // :
          action = `subparam sep (colon)`;
        } else if (byte >= 0x40 && byte <= 0x7e) { // final byte
          params.push(currentParam);
          state = "ground";
          const final = String.fromCharCode(byte);
          action = `CSI dispatch: ${final} params=[${params.join(',')}]`;
          params = [];
          currentParam = 0;
        }
        break;
        
      case "osc_string":
        if (byte === 0x07 || byte === 0x1b) { // BEL or ESC (ST)
          state = "ground";
          action = `OSC end: "${oscBuffer.slice(0, 20)}${oscBuffer.length > 20 ? '...' : ''}"`;
          oscBuffer = "";
        } else {
          oscBuffer += String.fromCharCode(byte);
          action = `OSC collect: +${String.fromCharCode(byte)}`;
        }
        break;
    }
    
    events.push({ state, action });
  }
  
  return events;
}

async function visualizeParsing(label: string, sequence: string, delayMs = 100) {
  const cols = process.stdout.columns || 80;
  
  console.log(`\n${purple}${bold}━━━ ${label} ━━━${reset}`);
  console.log(`${dim}Input: ${reset}${gray}"${sequence.replace(/\x1b/g, '\\e').replace(/\x07/g, '\\a')}"${reset}`);
  console.log();
  
  // Header
  console.log(`${dim}  BYTE  │ STATE          │ ACTION${reset}`);
  console.log(`${dim}────────┼────────────────┼${"─".repeat(cols - 28)}${reset}`);
  
  const events = parseSequence(sequence);
  
  for (let i = 0; i < sequence.length; i++) {
    const byte = sequence.charCodeAt(i);
    const event = events[i];
    
    const byteStr = formatByte(byte).padEnd(12);
    const charStr = formatChar(byte);
    const stateStr = event ? `${stateColor(event.state)}${event.state.padEnd(14)}${reset}` : "";
    const actionStr = event?.action ?? "";
    
    process.stdout.write(`  ${byteStr} ${charStr}  │ ${stateStr} │ ${actionStr}\n`);
    
    await sleep(delayMs);
  }
  
  console.log(`${dim}────────┴────────────────┴${"─".repeat(cols - 28)}${reset}`);
  
  // Show rendered result
  console.log(`\n${dim}Rendered:${reset} ${sequence}`);
}

async function main() {
  console.log(`${purple}${bold}`);
  console.log(`╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║   🔬 LIVE VT SEQUENCE PARSER VISUALIZATION 🔬              ║`);
  console.log(`║   Watch the state machine process escape sequences        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝${reset}`);
  
  // Demo sequences
  await visualizeParsing(
    "SGR: Bold Red Text",
    `${CSI}1;31mHello${CSI}0m`,
    80
  );
  
  await visualizeParsing(
    "SGR: True Color (#c778ea)",
    `${CSI}38;2;199;120;234mPurple${CSI}0m`,
    60
  );
  
  await visualizeParsing(
    "OSC: Set Window Title",
    `${ESC}]0;vers-agent\x07`,
    80
  );
  
  await visualizeParsing(
    "Cursor Movement",
    `A${CSI}CB${CSI}2DC`,
    80
  );
  
  console.log(`\n${green}✓${reset} Parser visualization complete`);
  console.log(`${gray}This is how libghostty-vt processes your terminal output!${reset}\n`);
}

main().catch(console.error);
