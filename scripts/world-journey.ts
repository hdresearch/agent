#!/usr/bin/env bun
/**
 * 🌍 Visual World Journey
 * 
 * A visual tour through the vers-agent architecture
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const ESC = "\x1b";
const CSI = `${ESC}[`;

const rgb = (r: number, g: number, b: number) => `${CSI}38;2;${r};${g};${b}m`;
const bg = (r: number, g: number, b: number) => `${CSI}48;2;${r};${g};${b}m`;
const R = `${CSI}0m`;
const B = `${CSI}1m`;
const DIM = `${CSI}2m`;

// Theme
const purple = rgb(199, 120, 234);  // #c778ea - ERGODIC
const green = rgb(152, 195, 121);   // #98c379 - PLUS
const red = rgb(224, 108, 117);     // #e06c75 - MINUS
const blue = rgb(97, 175, 239);
const yellow = rgb(229, 192, 123);
const cyan = rgb(86, 182, 194);
const gray = rgb(92, 99, 112);

const worlds = [
  {
    name: "SETUP",
    trit: "-1",
    color: red,
    icon: "📦",
    commands: ["install", "clean", "reset-claim", "clear-tokens"],
    desc: "Initialize and teardown"
  },
  {
    name: "PROCESS", 
    trit: "0",
    color: purple,
    icon: "⚙️",
    commands: ["build", "dev", "typecheck", "test", "test-unit", "test-integration"],
    desc: "Transform and verify"
  },
  {
    name: "EXECUTE",
    trit: "+1", 
    color: green,
    icon: "🚀",
    commands: ["agent", "server", "cli", "run", "test-interactive", "fuzz"],
    desc: "Run and interact"
  }
];

async function drawWorld(world: typeof worlds[0], row: number, delay: number) {
  const cols = process.stdout.columns || 80;
  const boxWidth = Math.floor(cols / 3) - 2;
  
  // Box top
  process.stdout.write(`${world.color}${B}╔${"═".repeat(boxWidth - 2)}╗${R}\n`);
  await sleep(delay);
  
  // Title
  const title = `${world.icon} ${world.name} [${world.trit}]`;
  const padding = Math.floor((boxWidth - title.length - 2) / 2);
  process.stdout.write(`${world.color}${B}║${R}${" ".repeat(padding)}${world.color}${B}${title}${R}${" ".repeat(boxWidth - padding - title.length - 2)}${world.color}${B}║${R}\n`);
  await sleep(delay);
  
  // Separator
  process.stdout.write(`${world.color}║${"─".repeat(boxWidth - 2)}║${R}\n`);
  await sleep(delay);
  
  // Commands
  for (const cmd of world.commands) {
    const line = `  ${green}✓${R} ${cmd}`;
    process.stdout.write(`${world.color}║${R}${line.padEnd(boxWidth + 10)}${world.color}║${R}\n`);
    await sleep(delay / 2);
  }
  
  // Description
  process.stdout.write(`${world.color}║${R}${gray}  ${world.desc.padEnd(boxWidth - 4)}${R}${world.color}║${R}\n`);
  await sleep(delay);
  
  // Box bottom
  process.stdout.write(`${world.color}${B}╚${"═".repeat(boxWidth - 2)}╝${R}\n`);
  await sleep(delay);
}

async function drawFlow() {
  const cols = process.stdout.columns || 80;
  
  console.log(`\n${purple}${B}${"━".repeat(cols)}${R}`);
  console.log(`${purple}${B}  WORKFLOW CHAINS${R}`);
  console.log(`${purple}${B}${"━".repeat(cols)}${R}\n`);
  
  const flows = [
    { name: "Bootstrap", chain: ["install", "→", "build", "→", "agent"], sum: "(-1) + (0) + (+1) = 0 ✓" },
    { name: "Dev Loop", chain: ["dev", "→", "typecheck", "→", "test"], sum: "(0) + (0) + (0) = 0 ✓" },
    { name: "VT Test", chain: ["test-interactive", "→", "fuzz", "→", "gvt"], sum: "(+1) + (+1) + (0) = 2" },
    { name: "Recovery", chain: ["nuke", "→", "reset-claim", "→", "agent"], sum: "(+1) + (-1) + (+1) = 1" },
  ];
  
  for (const flow of flows) {
    process.stdout.write(`  ${yellow}${flow.name.padEnd(12)}${R} `);
    for (const step of flow.chain) {
      if (step === "→") {
        process.stdout.write(`${gray}${step}${R} `);
      } else {
        process.stdout.write(`${cyan}${step}${R} `);
      }
      await sleep(50);
    }
    process.stdout.write(`${gray}= ${flow.sum}${R}\n`);
    await sleep(100);
  }
}

async function drawStats() {
  const cols = process.stdout.columns || 80;
  
  console.log(`\n${purple}${B}${"━".repeat(cols)}${R}`);
  console.log(`${purple}${B}  PR SUMMARY${R}`);
  console.log(`${purple}${B}${"━".repeat(cols)}${R}\n`);
  
  const stats = [
    { label: "New justfile recipes", value: "8", color: green },
    { label: "VT test scripts", value: "6", color: cyan },
    { label: "Fuzz strategies", value: "18", color: yellow },
    { label: "Test sequences", value: "118", color: purple },
    { label: "libghostty-vt tests", value: "2826", color: blue },
  ];
  
  for (const stat of stats) {
    const bar = "█".repeat(Math.min(parseInt(stat.value) / 50, 40));
    console.log(`  ${gray}${stat.label.padEnd(25)}${R} ${stat.color}${stat.value.padStart(5)}${R} ${stat.color}${bar}${R}`);
    await sleep(80);
  }
}

async function main() {
  const cols = process.stdout.columns || 80;
  
  // Header
  console.log(`\n${purple}${B}╔${"═".repeat(cols - 2)}╗${R}`);
  console.log(`${purple}${B}║${R}${"🌍 VERS-AGENT WORLD JOURNEY 🌍".padStart((cols + 28) / 2).padEnd(cols - 2)}${purple}${B}║${R}`);
  console.log(`${purple}${B}║${R}${gray}${"GF(3) Conservation: MINUS(-1) + ERGODIC(0) + PLUS(+1) = 0".padStart((cols + 54) / 2).padEnd(cols - 2)}${R}${purple}${B}║${R}`);
  console.log(`${purple}${B}╚${"═".repeat(cols - 2)}╝${R}\n`);
  
  // Draw worlds
  for (const world of worlds) {
    await drawWorld(world, 0, 30);
    console.log();
  }
  
  // Flow diagram
  await drawFlow();
  
  // Stats
  await drawStats();
  
  // Final message
  console.log(`\n${green}${B}✓ Journey complete!${R}`);
  console.log(`${gray}Ready for PR: just test-interactive && git add -A && git commit${R}\n`);
}

main().catch(console.error);
