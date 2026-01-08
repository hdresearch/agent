#!/usr/bin/env bun
/**
 * 🔥 VT Sequence Fuzzer
 * 
 * Generates random, malformed, and edge-case VT sequences
 * to stress-test terminal parsing robustness.
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const ESC = "\x1b";
const CSI = `${ESC}[`;
const OSC = `${ESC}]`;
const DCS = `${ESC}P`;
const BEL = "\x07";
const ST = `${ESC}\\`;

// Colors for output
const rgb = (r: number, g: number, b: number) => `${CSI}38;2;${r};${g};${b}m`;
const R = `${CSI}0m`;
const B = `${CSI}1m`;
const G = rgb(152, 195, 121);
const Y = rgb(229, 192, 123);
const P = rgb(199, 120, 234);
const RD = rgb(224, 108, 117);
const C = rgb(86, 182, 194);
const GR = rgb(92, 99, 112);

// Random helpers
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randChoice = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const randByte = () => randInt(0, 255);
const randPrintable = () => String.fromCharCode(randInt(0x20, 0x7e));
const randParam = () => randInt(0, 9999);

// Fuzzing strategies
const fuzzers = {
  // Random CSI with valid structure but random params
  validCsi(): string {
    const paramCount = randInt(0, 16);
    const params = Array.from({ length: paramCount }, () => randParam()).join(";");
    const finals = "ABCDEFGHJKLMPSTXZcdfghlmnpqrstu@`";
    const final = randChoice([...finals]);
    const intermediates = Math.random() > 0.8 ? randChoice(["?", ">", "!", " "]) : "";
    return `${CSI}${intermediates}${params}${final}`;
  },

  // Malformed CSI - missing final byte
  malformedCsiNoFinal(): string {
    const params = Array.from({ length: randInt(1, 5) }, () => randParam()).join(";");
    return `${CSI}${params}`;
  },

  // CSI with way too many params
  csiTooManyParams(): string {
    const params = Array.from({ length: randInt(50, 100) }, () => randParam()).join(";");
    return `${CSI}${params}m`;
  },

  // CSI with huge param values
  csiHugeParams(): string {
    const huge = randInt(100000, 999999999);
    return `${CSI}${huge};${huge};${huge}m`;
  },

  // CSI with mixed separators (colon and semicolon)
  csiMixedSeparators(): string {
    const parts = [randParam(), randParam(), randParam(), randParam()];
    const seps = [";", ":", ";", ":"];
    let result = `${CSI}`;
    for (let i = 0; i < parts.length; i++) {
      result += parts[i];
      if (i < parts.length - 1) result += randChoice(seps);
    }
    return result + "m";
  },

  // SGR with all possible attributes
  sgrKitchenSink(): string {
    const attrs = [0, 1, 2, 3, 4, 5, 7, 8, 9, 21, 22, 23, 24, 25, 27, 28, 29,
                   30, 31, 32, 33, 34, 35, 36, 37, 39,
                   40, 41, 42, 43, 44, 45, 46, 47, 49,
                   90, 91, 92, 93, 94, 95, 96, 97,
                   100, 101, 102, 103, 104, 105, 106, 107];
    const count = randInt(3, 10);
    const selected = Array.from({ length: count }, () => randChoice(attrs));
    return `${CSI}${selected.join(";")}m`;
  },

  // True color with edge values
  trueColorEdge(): string {
    const edges = [0, 1, 127, 128, 254, 255, 256, -1, 999];
    const r = randChoice(edges);
    const g = randChoice(edges);
    const b = randChoice(edges);
    const type = randChoice([38, 48, 58]); // fg, bg, underline
    return `${CSI}${type};2;${r};${g};${b}m`;
  },

  // 256 color with edge values
  color256Edge(): string {
    const edges = [0, 1, 15, 16, 231, 232, 255, 256, -1, 999];
    const n = randChoice(edges);
    const type = randChoice([38, 48]);
    return `${CSI}${type};5;${n}m`;
  },

  // OSC with random content
  oscRandom(): string {
    const oscType = randChoice([0, 1, 2, 4, 7, 8, 9, 10, 11, 12, 52, 104, 133]);
    const content = Array.from({ length: randInt(1, 50) }, randPrintable).join("");
    const terminator = randChoice([BEL, ST]);
    return `${OSC}${oscType};${content}${terminator}`;
  },

  // OSC with very long content (potential buffer overflow)
  oscLong(): string {
    const content = "x".repeat(randInt(1000, 5000));
    return `${OSC}0;${content}${BEL}`;
  },

  // OSC with binary/null bytes
  oscBinary(): string {
    const binary = String.fromCharCode(...Array.from({ length: 20 }, randByte));
    return `${OSC}0;${binary}${BEL}`;
  },

  // Nested/recursive escapes
  nestedEscape(): string {
    return `${ESC}${ESC}${ESC}[${randParam()}m`;
  },

  // Interrupted sequence
  interruptedSequence(): string {
    return `${CSI}${randParam()};${ESC}[${randParam()}m`;
  },

  // DCS sequence
  dcsRandom(): string {
    const content = Array.from({ length: randInt(5, 50) }, randPrintable).join("");
    return `${DCS}${content}${ST}`;
  },

  // C0 control codes
  c0Controls(): string {
    const c0 = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 
                0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
                0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
                0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f];
    return String.fromCharCode(...Array.from({ length: randInt(3, 10) }, () => randChoice(c0)));
  },

  // C1 control codes (8-bit)
  c1Controls(): string {
    const c1 = Array.from({ length: 32 }, (_, i) => 0x80 + i);
    return String.fromCharCode(...Array.from({ length: randInt(3, 10) }, () => randChoice(c1)));
  },

  // UTF-8 sequences mixed with escapes
  utf8Mixed(): string {
    const emoji = ["🔥", "💀", "🚀", "✓", "❌", "⚠️", "🎯", "💻"];
    const parts: string[] = [];
    for (let i = 0; i < 5; i++) {
      parts.push(randChoice(emoji));
      parts.push(`${CSI}${randInt(30, 37)}m`);
    }
    return parts.join("");
  },

  // Cursor movement chaos
  cursorChaos(): string {
    const moves = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"];
    return Array.from({ length: randInt(5, 20) }, () => 
      `${CSI}${randInt(0, 999)}${randChoice(moves)}`
    ).join("");
  },

  // Private mode sequences
  privateModes(): string {
    const modes = [1, 3, 4, 5, 6, 7, 12, 25, 47, 1000, 1001, 1002, 1003, 
                   1004, 1005, 1006, 1007, 1015, 1016, 1047, 1048, 1049, 2004];
    const mode = randChoice(modes);
    const action = randChoice(["h", "l", "s", "r"]);
    return `${CSI}?${mode}${action}`;
  },

  // Completely random bytes
  randomBytes(): string {
    return String.fromCharCode(...Array.from({ length: randInt(10, 50) }, randByte));
  },

  // Valid escape followed by garbage
  escapeGarbage(): string {
    const garbage = Array.from({ length: randInt(5, 20) }, randByte);
    return ESC + String.fromCharCode(...garbage);
  },
};

interface FuzzResult {
  name: string;
  sequence: string;
  hexDump: string;
  crashed: boolean;
  rendered: boolean;
}

function hexDump(s: string, max = 30): string {
  const bytes = [...s].slice(0, max).map(c => c.charCodeAt(0).toString(16).padStart(2, "0"));
  return bytes.join(" ") + (s.length > max ? " ..." : "");
}

async function runFuzzer(iterations: number, speed: number) {
  const cols = process.stdout.columns || 80;
  const results: FuzzResult[] = [];
  let crashed = 0;
  let rendered = 0;
  
  console.log(`\n${P}${B}╔${"═".repeat(cols - 2)}╗${R}`);
  console.log(`${P}${B}║${R}${"🔥 VT SEQUENCE FUZZER 🔥".padStart((cols + 22) / 2).padEnd(cols - 2)}${P}${B}║${R}`);
  console.log(`${P}${B}╚${"═".repeat(cols - 2)}╝${R}\n`);
  
  console.log(`${GR}Running ${iterations} fuzz iterations...${R}\n`);
  
  const fuzzerNames = Object.keys(fuzzers) as (keyof typeof fuzzers)[];
  
  for (let i = 0; i < iterations; i++) {
    const fuzzerName = randChoice(fuzzerNames);
    const fuzzer = fuzzers[fuzzerName];
    
    let sequence: string;
    let didCrash = false;
    
    try {
      sequence = fuzzer();
    } catch (e) {
      sequence = "";
      didCrash = true;
      crashed++;
    }
    
    // Try to render it (wrapped in reset to prevent terminal corruption)
    let didRender = false;
    try {
      process.stdout.write(`${CSI}s`); // Save cursor
      process.stdout.write(sequence);
      process.stdout.write(`${R}`); // Reset
      process.stdout.write(`${CSI}u`); // Restore cursor
      process.stdout.write(`${CSI}K`); // Clear line
      didRender = true;
      rendered++;
    } catch {
      didCrash = true;
      crashed++;
    }
    
    // Show progress
    const pct = Math.floor((i / iterations) * 100);
    const status = didCrash ? `${RD}CRASH${R}` : `${G}OK${R}`;
    const hex = hexDump(sequence, 20);
    
    process.stdout.write(`\r${C}[${pct.toString().padStart(3)}%]${R} ${Y}${fuzzerName.padEnd(22)}${R} ${status} ${GR}${hex}${R}${" ".repeat(20)}`);
    
    results.push({
      name: fuzzerName,
      sequence,
      hexDump: hex,
      crashed: didCrash,
      rendered: didRender,
    });
    
    await sleep(speed);
  }
  
  // Summary
  console.log(`\n\n${P}${"─".repeat(cols)}${R}`);
  console.log(`\n${B}Fuzz Results:${R}`);
  console.log(`  ${G}${rendered} sequences rendered${R}`);
  console.log(`  ${crashed > 0 ? RD : GR}${crashed} crashes${R}`);
  console.log(`  ${C}${iterations} total iterations${R}`);
  
  // Fuzzer distribution
  console.log(`\n${B}Fuzzer Distribution:${R}`);
  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.name] = (counts[r.name] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted.slice(0, 10)) {
    const bar = "█".repeat(Math.floor(count / iterations * 40));
    console.log(`  ${Y}${name.padEnd(22)}${R} ${GR}${bar}${R} ${count}`);
  }
  
  // Edge cases found
  console.log(`\n${B}Sample Edge Cases:${R}`);
  const edgeCases = results.filter(r => 
    r.name.includes("Edge") || r.name.includes("Long") || r.name.includes("Huge")
  ).slice(0, 5);
  for (const ec of edgeCases) {
    console.log(`  ${C}${ec.name}${R}: ${GR}${ec.hexDump}${R}`);
  }
  
  if (crashed === 0) {
    console.log(`\n${G}${B}✓ Terminal survived all ${iterations} fuzz iterations!${R}\n`);
  } else {
    console.log(`\n${RD}${B}⚠ ${crashed} potential issues found${R}\n`);
  }
}

// Parse args
const args = process.argv.slice(2);
const iterations = parseInt(args[0] ?? "500");
const speed = parseInt(args[1] ?? "5");

runFuzzer(iterations, speed).catch(console.error);
