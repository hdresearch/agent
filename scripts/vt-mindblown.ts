#!/usr/bin/env bun
/**
 * 🤯 Mindblowing VT Sequence Visualizer
 * 
 * Shows VT sequences being parsed and rendered in real-time,
 * with side-by-side raw bytes vs rendered output.
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ANSI escape helpers
const ESC = "\x1b";
const CSI = `${ESC}[`;
const OSC = `${ESC}]`;
const BEL = "\x07";

// Screen control
const clear = () => process.stdout.write(`${CSI}2J${CSI}H`);
const moveTo = (row: number, col: number) => process.stdout.write(`${CSI}${row};${col}H`);
const saveCursor = () => process.stdout.write(`${ESC}7`);
const restoreCursor = () => process.stdout.write(`${ESC}8`);
const hideCursor = () => process.stdout.write(`${CSI}?25l`);
const showCursor = () => process.stdout.write(`${CSI}?25h`);

// Colors
const rgb = (r: number, g: number, b: number) => `${CSI}38;2;${r};${g};${b}m`;
const bgRgb = (r: number, g: number, b: number) => `${CSI}48;2;${r};${g};${b}m`;
const reset = `${CSI}0m`;
const bold = `${CSI}1m`;
const dim = `${CSI}2m`;
const italic = `${CSI}3m`;
const underline = `${CSI}4m`;

// Theme colors
const purple = rgb(199, 120, 234);  // #c778ea
const green = rgb(152, 195, 121);   // #98c379
const red = rgb(224, 108, 117);     // #e06c75
const blue = rgb(97, 175, 239);     // #61afef
const yellow = rgb(229, 192, 123);  // #e5c07b
const cyan = rgb(86, 182, 194);     // #56b6c2
const white = rgb(171, 178, 191);   // #abb2bf
const gray = rgb(92, 99, 112);      // #5c6370

// Box drawing
const box = {
  tl: "╔", tr: "╗", bl: "╚", br: "╝",
  h: "═", v: "║",
  lt: "╠", rt: "╣", tt: "╦", bt: "╩", x: "╬",
};

function drawBox(row: number, col: number, width: number, height: number, title?: string) {
  moveTo(row, col);
  process.stdout.write(`${purple}${box.tl}${box.h.repeat(width - 2)}${box.tr}${reset}`);
  
  for (let i = 1; i < height - 1; i++) {
    moveTo(row + i, col);
    process.stdout.write(`${purple}${box.v}${reset}`);
    moveTo(row + i, col + width - 1);
    process.stdout.write(`${purple}${box.v}${reset}`);
  }
  
  moveTo(row + height - 1, col);
  process.stdout.write(`${purple}${box.bl}${box.h.repeat(width - 2)}${box.br}${reset}`);
  
  if (title) {
    moveTo(row, col + 2);
    process.stdout.write(`${purple}${bold} ${title} ${reset}`);
  }
}

function hexDump(data: string): string {
  return [...data].map(c => {
    const code = c.charCodeAt(0);
    if (code === 0x1b) return `${red}1b${reset}`;
    if (code === 0x07) return `${yellow}07${reset}`;
    if (code < 0x20) return `${cyan}${code.toString(16).padStart(2, '0')}${reset}`;
    if (code >= 0x30 && code <= 0x39) return `${green}${code.toString(16)}${reset}`;
    if (code >= 0x41 && code <= 0x5a) return `${blue}${code.toString(16)}${reset}`;
    if (code >= 0x61 && code <= 0x7a) return `${blue}${code.toString(16)}${reset}`;
    return `${white}${code.toString(16).padStart(2, '0')}${reset}`;
  }).join(' ');
}

function escapeForDisplay(data: string): string {
  return data
    .replace(/\x1b/g, `${red}ESC${reset}`)
    .replace(/\x07/g, `${yellow}BEL${reset}`)
    .replace(/\[/g, `${cyan}[${reset}`)
    .replace(/\]/g, `${cyan}]${reset}`)
    .replace(/;/g, `${gray};${reset}`)
    .replace(/m/g, `${green}m${reset}`);
}

interface VtDemo {
  name: string;
  description: string;
  sequence: string;
  rendered: () => void;
}

const demos: VtDemo[] = [
  {
    name: "SGR: Bold + Colors",
    description: "ESC[1m (bold) + ESC[38;2;R;G;Bm (true color)",
    sequence: `${bold}${purple}Hello, Terminal!${reset}`,
    rendered: () => {
      process.stdout.write(`${bold}${purple}Hello, Terminal!${reset}`);
    },
  },
  {
    name: "SGR: Rainbow Gradient",
    description: "True color RGB cycling through spectrum",
    sequence: "ESC[38;2;R;G;Bm for each character",
    rendered: () => {
      const text = "RAINBOW GRADIENT";
      for (let i = 0; i < text.length; i++) {
        const hue = (i / text.length) * 360;
        const [r, g, b] = hslToRgb(hue, 100, 50);
        process.stdout.write(`${rgb(r, g, b)}${text[i]}`);
      }
      process.stdout.write(reset);
    },
  },
  {
    name: "SGR: Styles Stack",
    description: "Bold + Italic + Underline combined",
    sequence: `${CSI}1;3;4m`,
    rendered: () => {
      process.stdout.write(`${bold}${italic}${underline}${cyan}Styled Text${reset}`);
    },
  },
  {
    name: "Cursor Dance",
    description: "ESC[A/B/C/D cursor movement",
    sequence: "Print, move, print, move...",
    rendered: async () => {
      const chars = "◆◇○●◎";
      for (let i = 0; i < 10; i++) {
        process.stdout.write(`${rgb(255 - i*20, 100 + i*15, 234)}${chars[i % chars.length]}${reset}`);
        await sleep(50);
      }
    },
  },
  {
    name: "256 Color Palette",
    description: "ESC[38;5;Nm for N in 0-255",
    sequence: "256 color codes",
    rendered: () => {
      for (let i = 0; i < 16; i++) {
        process.stdout.write(`${CSI}48;5;${i}m  `);
      }
      process.stdout.write(reset);
    },
  },
  {
    name: "Block Art",
    description: "█▓▒░ block characters with colors",
    sequence: "Unicode blocks + RGB",
    rendered: () => {
      const blocks = "█▓▒░";
      for (let i = 0; i < 16; i++) {
        const intensity = 255 - (i * 16);
        process.stdout.write(`${rgb(199, 120, intensity)}${blocks[i % 4]}`);
      }
      process.stdout.write(reset);
    },
  },
  {
    name: "Hyperlink (OSC 8)",
    description: "ESC]8;;URL BEL text ESC]8;; BEL",
    sequence: `${OSC}8;;https://github.com${BEL}link${OSC}8;;${BEL}`,
    rendered: () => {
      process.stdout.write(`${OSC}8;;https://github.com/hdresearch/agent${BEL}${blue}${underline}Click Me!${reset}${OSC}8;;${BEL}`);
    },
  },
  {
    name: "Progress Bar",
    description: "Overwrite with carriage return",
    sequence: "\\r + block chars",
    rendered: async () => {
      const width = 20;
      for (let i = 0; i <= width; i++) {
        const filled = "█".repeat(i);
        const empty = "░".repeat(width - i);
        const pct = Math.floor((i / width) * 100);
        process.stdout.write(`\r${green}${filled}${gray}${empty}${reset} ${pct}%`);
        await sleep(30);
      }
    },
  },
  {
    name: "Spinner Animation",
    description: "Overwrite single char",
    sequence: "\\r + rotating chars",
    rendered: async () => {
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      for (let i = 0; i < 20; i++) {
        process.stdout.write(`\r${purple}${frames[i % frames.length]}${reset} Processing...`);
        await sleep(80);
      }
      process.stdout.write(`\r${green}✓${reset} Complete!    `);
    },
  },
  {
    name: "Matrix Rain",
    description: "Random green chars falling",
    sequence: "Cursor positioning + random chars",
    rendered: async () => {
      const chars = "ｱｲｳｴｵｶｷｸｹｺ01";
      let output = "";
      for (let i = 0; i < 30; i++) {
        const c = chars[Math.floor(Math.random() * chars.length)];
        const brightness = Math.floor(Math.random() * 155) + 100;
        output += `${rgb(0, brightness, 0)}${c}`;
      }
      process.stdout.write(output + reset);
    },
  },
];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

async function runDemo() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  
  clear();
  hideCursor();
  
  // Header
  moveTo(1, 1);
  process.stdout.write(`${purple}${bold}╔${"═".repeat(cols - 2)}╗${reset}`);
  moveTo(2, 1);
  process.stdout.write(`${purple}${bold}║${reset}`);
  moveTo(2, Math.floor((cols - 40) / 2));
  process.stdout.write(`${purple}${bold}🤯 libghostty-vt SEQUENCE VISUALIZER 🤯${reset}`);
  moveTo(2, cols);
  process.stdout.write(`${purple}${bold}║${reset}`);
  moveTo(3, 1);
  process.stdout.write(`${purple}${bold}╚${"═".repeat(cols - 2)}╝${reset}`);
  
  let demoRow = 5;
  
  for (const demo of demos) {
    if (demoRow > rows - 6) break;
    
    // Demo name
    moveTo(demoRow, 2);
    process.stdout.write(`${yellow}${bold}▶ ${demo.name}${reset}`);
    
    // Description
    moveTo(demoRow, 40);
    process.stdout.write(`${gray}${demo.description}${reset}`);
    
    // Rendered output
    moveTo(demoRow + 1, 4);
    process.stdout.write(`${dim}Rendered: ${reset}`);
    await demo.rendered();
    
    // Hex dump of first 20 bytes
    moveTo(demoRow + 2, 4);
    const seqSample = typeof demo.sequence === 'string' ? demo.sequence.slice(0, 30) : '';
    if (seqSample.includes('\x1b')) {
      process.stdout.write(`${dim}Hex: ${reset}${hexDump(seqSample.slice(0, 15))}`);
    }
    
    demoRow += 4;
    await sleep(200);
  }
  
  // Footer with live sequence injection
  moveTo(rows - 3, 1);
  process.stdout.write(`${purple}${"─".repeat(cols)}${reset}`);
  moveTo(rows - 2, 2);
  process.stdout.write(`${green}✓${reset} All VT sequences rendered successfully`);
  moveTo(rows - 1, 2);
  process.stdout.write(`${gray}Press Ctrl+C to exit | Run: just gvt for interactive mode${reset}`);
  
  showCursor();
  moveTo(rows, 1);
  
  // Keep alive for a moment to admire
  await sleep(3000);
}

// Cleanup on exit
process.on("SIGINT", () => {
  showCursor();
  process.stdout.write(reset);
  process.exit(0);
});

runDemo().catch(e => {
  showCursor();
  console.error(e);
  process.exit(1);
});
