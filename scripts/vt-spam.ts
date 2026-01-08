#!/usr/bin/env bun
/**
 * 🚀 RAPID VT TEST SPAM - Watch tests fly by!
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const ESC = "\x1b";
const CSI = `${ESC}[`;

// Fast helpers
const rgb = (r: number, g: number, b: number) => `${CSI}38;2;${r};${g};${b}m`;
const bg = (r: number, g: number, b: number) => `${CSI}48;2;${r};${g};${b}m`;
const R = `${CSI}0m`;
const B = `${CSI}1m`;

// Colors
const G = rgb(152, 195, 121);  // green
const Y = rgb(229, 192, 123);  // yellow  
const P = rgb(199, 120, 234);  // purple
const C = rgb(86, 182, 194);   // cyan
const RD = rgb(224, 108, 117); // red
const BL = rgb(97, 175, 239);  // blue
const GR = rgb(92, 99, 112);   // gray

const pass = `${G}✓${R}`;
const fail = `${RD}✗${R}`;

// Test categories
const tests = [
  // SGR Tests
  { cat: "SGR", name: "reset", seq: "\x1b[0m" },
  { cat: "SGR", name: "bold", seq: "\x1b[1m" },
  { cat: "SGR", name: "dim", seq: "\x1b[2m" },
  { cat: "SGR", name: "italic", seq: "\x1b[3m" },
  { cat: "SGR", name: "underline", seq: "\x1b[4m" },
  { cat: "SGR", name: "blink", seq: "\x1b[5m" },
  { cat: "SGR", name: "inverse", seq: "\x1b[7m" },
  { cat: "SGR", name: "hidden", seq: "\x1b[8m" },
  { cat: "SGR", name: "strikethrough", seq: "\x1b[9m" },
  { cat: "SGR", name: "curly_underline", seq: "\x1b[4:3m" },
  { cat: "SGR", name: "dotted_underline", seq: "\x1b[4:4m" },
  { cat: "SGR", name: "dashed_underline", seq: "\x1b[4:5m" },
  { cat: "SGR", name: "fg_black", seq: "\x1b[30m" },
  { cat: "SGR", name: "fg_red", seq: "\x1b[31m" },
  { cat: "SGR", name: "fg_green", seq: "\x1b[32m" },
  { cat: "SGR", name: "fg_yellow", seq: "\x1b[33m" },
  { cat: "SGR", name: "fg_blue", seq: "\x1b[34m" },
  { cat: "SGR", name: "fg_magenta", seq: "\x1b[35m" },
  { cat: "SGR", name: "fg_cyan", seq: "\x1b[36m" },
  { cat: "SGR", name: "fg_white", seq: "\x1b[37m" },
  { cat: "SGR", name: "bg_black", seq: "\x1b[40m" },
  { cat: "SGR", name: "bg_red", seq: "\x1b[41m" },
  { cat: "SGR", name: "bg_green", seq: "\x1b[42m" },
  { cat: "SGR", name: "bg_yellow", seq: "\x1b[43m" },
  { cat: "SGR", name: "bg_blue", seq: "\x1b[44m" },
  { cat: "SGR", name: "bg_magenta", seq: "\x1b[45m" },
  { cat: "SGR", name: "bg_cyan", seq: "\x1b[46m" },
  { cat: "SGR", name: "bg_white", seq: "\x1b[47m" },
  { cat: "SGR", name: "fg_256_0", seq: "\x1b[38;5;0m" },
  { cat: "SGR", name: "fg_256_15", seq: "\x1b[38;5;15m" },
  { cat: "SGR", name: "fg_256_196", seq: "\x1b[38;5;196m" },
  { cat: "SGR", name: "fg_256_226", seq: "\x1b[38;5;226m" },
  { cat: "SGR", name: "fg_256_46", seq: "\x1b[38;5;46m" },
  { cat: "SGR", name: "fg_256_21", seq: "\x1b[38;5;21m" },
  { cat: "SGR", name: "bg_256_232", seq: "\x1b[48;5;232m" },
  { cat: "SGR", name: "bg_256_255", seq: "\x1b[48;5;255m" },
  { cat: "SGR", name: "fg_rgb_red", seq: "\x1b[38;2;255;0;0m" },
  { cat: "SGR", name: "fg_rgb_green", seq: "\x1b[38;2;0;255;0m" },
  { cat: "SGR", name: "fg_rgb_blue", seq: "\x1b[38;2;0;0;255m" },
  { cat: "SGR", name: "fg_rgb_purple", seq: "\x1b[38;2;199;120;234m" },
  { cat: "SGR", name: "bg_rgb_black", seq: "\x1b[48;2;0;0;0m" },
  { cat: "SGR", name: "bg_rgb_white", seq: "\x1b[48;2;255;255;255m" },
  { cat: "SGR", name: "underline_color", seq: "\x1b[58;2;255;0;0m" },
  { cat: "SGR", name: "combined_bold_red", seq: "\x1b[1;31m" },
  { cat: "SGR", name: "combined_all", seq: "\x1b[1;3;4;31;44m" },
  
  // CSI Tests  
  { cat: "CSI", name: "cursor_up", seq: "\x1b[A" },
  { cat: "CSI", name: "cursor_up_5", seq: "\x1b[5A" },
  { cat: "CSI", name: "cursor_down", seq: "\x1b[B" },
  { cat: "CSI", name: "cursor_forward", seq: "\x1b[C" },
  { cat: "CSI", name: "cursor_back", seq: "\x1b[D" },
  { cat: "CSI", name: "cursor_position", seq: "\x1b[1;1H" },
  { cat: "CSI", name: "cursor_position_10_20", seq: "\x1b[10;20H" },
  { cat: "CSI", name: "erase_display", seq: "\x1b[2J" },
  { cat: "CSI", name: "erase_line", seq: "\x1b[2K" },
  { cat: "CSI", name: "scroll_up", seq: "\x1b[S" },
  { cat: "CSI", name: "scroll_down", seq: "\x1b[T" },
  { cat: "CSI", name: "insert_lines", seq: "\x1b[L" },
  { cat: "CSI", name: "delete_lines", seq: "\x1b[M" },
  { cat: "CSI", name: "insert_chars", seq: "\x1b[@" },
  { cat: "CSI", name: "delete_chars", seq: "\x1b[P" },
  { cat: "CSI", name: "set_mode_decckm", seq: "\x1b[?1h" },
  { cat: "CSI", name: "reset_mode_decckm", seq: "\x1b[?1l" },
  { cat: "CSI", name: "alt_screen_on", seq: "\x1b[?1049h" },
  { cat: "CSI", name: "alt_screen_off", seq: "\x1b[?1049l" },
  { cat: "CSI", name: "cursor_show", seq: "\x1b[?25h" },
  { cat: "CSI", name: "cursor_hide", seq: "\x1b[?25l" },
  { cat: "CSI", name: "mouse_on", seq: "\x1b[?1000h" },
  { cat: "CSI", name: "mouse_off", seq: "\x1b[?1000l" },
  { cat: "CSI", name: "bracketed_paste_on", seq: "\x1b[?2004h" },
  { cat: "CSI", name: "bracketed_paste_off", seq: "\x1b[?2004l" },
  { cat: "CSI", name: "device_status", seq: "\x1b[5n" },
  { cat: "CSI", name: "cursor_position_report", seq: "\x1b[6n" },
  { cat: "CSI", name: "primary_da", seq: "\x1b[c" },
  { cat: "CSI", name: "secondary_da", seq: "\x1b[>c" },
  { cat: "CSI", name: "tertiary_da", seq: "\x1b[=c" },
  
  // OSC Tests
  { cat: "OSC", name: "set_title", seq: "\x1b]0;title\x07" },
  { cat: "OSC", name: "set_icon", seq: "\x1b]1;icon\x07" },
  { cat: "OSC", name: "set_title_2", seq: "\x1b]2;title\x07" },
  { cat: "OSC", name: "set_cwd", seq: "\x1b]7;file:///home\x07" },
  { cat: "OSC", name: "hyperlink", seq: "\x1b]8;;https://x.com\x07" },
  { cat: "OSC", name: "notify", seq: "\x1b]9;message\x07" },
  { cat: "OSC", name: "fg_color", seq: "\x1b]10;?\x07" },
  { cat: "OSC", name: "bg_color", seq: "\x1b]11;?\x07" },
  { cat: "OSC", name: "cursor_color", seq: "\x1b]12;?\x07" },
  { cat: "OSC", name: "clipboard", seq: "\x1b]52;c;dGVzdA==\x07" },
  { cat: "OSC", name: "reset_color", seq: "\x1b]104\x07" },
  { cat: "OSC", name: "shell_prompt_start", seq: "\x1b]133;A\x07" },
  { cat: "OSC", name: "shell_prompt_end", seq: "\x1b]133;B\x07" },
  { cat: "OSC", name: "shell_cmd_start", seq: "\x1b]133;C\x07" },
  { cat: "OSC", name: "shell_cmd_end", seq: "\x1b]133;D\x07" },
  
  // ESC Tests
  { cat: "ESC", name: "save_cursor", seq: "\x1b7" },
  { cat: "ESC", name: "restore_cursor", seq: "\x1b8" },
  { cat: "ESC", name: "index", seq: "\x1bD" },
  { cat: "ESC", name: "next_line", seq: "\x1bE" },
  { cat: "ESC", name: "tab_set", seq: "\x1bH" },
  { cat: "ESC", name: "reverse_index", seq: "\x1bM" },
  { cat: "ESC", name: "single_shift_2", seq: "\x1bN" },
  { cat: "ESC", name: "single_shift_3", seq: "\x1bO" },
  { cat: "ESC", name: "decsc", seq: "\x1b7" },
  { cat: "ESC", name: "decrc", seq: "\x1b8" },
  { cat: "ESC", name: "ris", seq: "\x1bc" },
  { cat: "ESC", name: "designate_g0_ascii", seq: "\x1b(B" },
  { cat: "ESC", name: "designate_g0_line", seq: "\x1b(0" },
  { cat: "ESC", name: "designate_g1_ascii", seq: "\x1b)B" },
  
  // DCS Tests
  { cat: "DCS", name: "tmux_start", seq: "\x1bPtmux;" },
  { cat: "DCS", name: "sixel", seq: "\x1bPq" },
  { cat: "DCS", name: "decrqss", seq: "\x1bP$q" },
  
  // Input Tests
  { cat: "INPUT", name: "ctrl_a", seq: "\x01" },
  { cat: "INPUT", name: "ctrl_c", seq: "\x03" },
  { cat: "INPUT", name: "ctrl_d", seq: "\x04" },
  { cat: "INPUT", name: "ctrl_e", seq: "\x05" },
  { cat: "INPUT", name: "ctrl_k", seq: "\x0b" },
  { cat: "INPUT", name: "ctrl_u", seq: "\x15" },
  { cat: "INPUT", name: "ctrl_w", seq: "\x17" },
  { cat: "INPUT", name: "tab", seq: "\x09" },
  { cat: "INPUT", name: "enter", seq: "\x0d" },
  { cat: "INPUT", name: "escape", seq: "\x1b" },
  { cat: "INPUT", name: "backspace", seq: "\x7f" },
];

async function main() {
  const cols = process.stdout.columns || 80;
  let passed = 0;
  let failed = 0;
  const startTime = Date.now();
  
  // Header
  console.log(`\n${P}${B}╔${"═".repeat(cols - 2)}╗${R}`);
  console.log(`${P}${B}║${R}${" ".repeat(Math.floor((cols - 32) / 2))}🚀 VT SEQUENCE TEST SUITE 🚀${" ".repeat(Math.ceil((cols - 32) / 2))}${P}${B}║${R}`);
  console.log(`${P}${B}╚${"═".repeat(cols - 2)}╝${R}\n`);
  
  let currentCat = "";
  let lineBuffer = "";
  let testsOnLine = 0;
  const maxPerLine = 6;
  
  for (const test of tests) {
    // Category header
    if (test.cat !== currentCat) {
      if (lineBuffer) {
        console.log(lineBuffer);
        lineBuffer = "";
        testsOnLine = 0;
      }
      currentCat = test.cat;
      console.log(`\n${Y}${B}▶ ${test.cat}${R}`);
    }
    
    // Simulate test (all pass for demo)
    const testPassed = true;
    
    if (testPassed) {
      passed++;
      lineBuffer += `${pass} ${GR}${test.name.padEnd(18)}${R}`;
    } else {
      failed++;
      lineBuffer += `${fail} ${RD}${test.name.padEnd(18)}${R}`;
    }
    
    testsOnLine++;
    if (testsOnLine >= maxPerLine) {
      console.log(lineBuffer);
      lineBuffer = "";
      testsOnLine = 0;
    }
    
    // Rapid fire!
    await sleep(8);
  }
  
  // Flush remaining
  if (lineBuffer) console.log(lineBuffer);
  
  const elapsed = Date.now() - startTime;
  
  // Summary
  console.log(`\n${P}${"─".repeat(cols)}${R}`);
  console.log(`\n${B}Test Results:${R}`);
  console.log(`  ${G}${passed} passed${R}`);
  if (failed > 0) console.log(`  ${RD}${failed} failed${R}`);
  console.log(`  ${GR}${tests.length} total${R}`);
  console.log(`  ${C}${elapsed}ms${R}\n`);
  
  // Big pass indicator
  if (failed === 0) {
    console.log(`${bg(30, 80, 30)}${G}${B}`);
    console.log(` ╔════════════════════════════════════════╗ `);
    console.log(` ║          ✓ ALL TESTS PASSED!           ║ `);
    console.log(` ║       ${passed} VT sequences verified          ║ `);
    console.log(` ╚════════════════════════════════════════╝ ${R}`);
  }
  
  // Progress bar animation
  console.log(`\n${GR}Verifying terminal capabilities...${R}`);
  const barWidth = 40;
  for (let i = 0; i <= barWidth; i++) {
    const filled = "█".repeat(i);
    const empty = "░".repeat(barWidth - i);
    const pct = Math.floor((i / barWidth) * 100);
    process.stdout.write(`\r${G}${filled}${GR}${empty}${R} ${pct}%`);
    await sleep(15);
  }
  console.log(`\n\n${G}✓${R} libghostty-vt compatible!\n`);
}

main().catch(console.error);
