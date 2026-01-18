/**
 * Gay Colors: Canonical color generation wrapper
 *
 * Uses Gay MCP service for canonical colors when available,
 * falls back to local golden-angle approximation.
 *
 * Canonical seed: 1069 (Claude Code)
 */

export type Trit = -1 | 0 | 1;

export interface ColorRef {
  hex: string;
  seed: number;
  index: number;
  trit?: Trit;
  rgb?: { r: number; g: number; b: number };
}

// Canonical Gay MCP palette for seed 1069 (pre-computed from mcp__gay__palette)
const CANONICAL_1069: Record<number, string> = {
  1: '#E67F86',   // + PLUS
  2: '#D06546',   // ○ ERGODIC
  3: '#1316BB',   // − MINUS
  4: '#BA2645',   // + PLUS
  5: '#49EE54',   // + PLUS
  6: '#11C710',   // ○ ERGODIC
  7: '#76B0F0',   // − MINUS
  8: '#E59798',   // ○ ERGODIC
  9: '#5333D9',   // − MINUS
  10: '#7E90EB',  // ○ ERGODIC
  11: '#1D9E7E',  // ○ ERGODIC
  12: '#DD7CB0',  // + PLUS
};

// Canonical Gay MCP palette for seed 2069
const CANONICAL_2069: Record<number, string> = {
  1: '#635CD8',
};

/**
 * Get canonical color from Gay MCP pre-computed values
 */
export function getCanonicalColor(seed: number, index: number): ColorRef | null {
  const palette = seed === 1069 ? CANONICAL_1069 : seed === 2069 ? CANONICAL_2069 : null;
  if (palette && palette[index]) {
    return {
      hex: palette[index],
      seed,
      index,
    };
  }
  return null;
}

/**
 * Local golden-angle approximation (for offline use)
 * Note: May not match Gay MCP canonical colors exactly
 */
export function localColorAt(seed: number, index: number): ColorRef {
  const PHI = (1 + Math.sqrt(5)) / 2;
  const GAMMA = 360 / PHI;

  // Golden angle hue with seed offset
  const hue = (index * GAMMA + seed * 0.618) % 360;
  const sat = 0.65;
  const lum = 0.55;

  // HSL to RGB
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lum - c / 2;

  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }

  const rgb = {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };

  const hex = '#' + [rgb.r, rgb.g, rgb.b]
    .map(c => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  // GF(3) trit from RGB sum
  const sum = rgb.r + rgb.g + rgb.b;
  const trit = ((sum % 3) - 1) as Trit;

  return { hex, seed, index, trit, rgb };
}

/**
 * Get color - uses canonical if available, otherwise local approximation
 */
export function colorAt(seed: number, index: number): ColorRef {
  const canonical = getCanonicalColor(seed, index);
  if (canonical) {
    // Add trit from hex
    const r = parseInt(canonical.hex.slice(1, 3), 16);
    const g = parseInt(canonical.hex.slice(3, 5), 16);
    const b = parseInt(canonical.hex.slice(5, 7), 16);
    const sum = r + g + b;
    return {
      ...canonical,
      trit: ((sum % 3) - 1) as Trit,
      rgb: { r, g, b },
    };
  }
  return localColorAt(seed, index);
}

/**
 * Compute GF(3) trit from hex color
 */
export function hexToTrit(hex: string): Trit {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const sum = r + g + b;
  return ((sum % 3) - 1) as Trit;
}

/**
 * Format trit as symbol
 */
export function tritSymbol(trit: Trit): string {
  return trit === -1 ? '−' : trit === 0 ? '○' : '+';
}

// ============================================================
// DEMO
// ============================================================

if (import.meta.main) {
  console.log('═══ Gay Colors Demo ═══\n');

  console.log('Canonical Colors (seed=1069):');
  for (let i = 1; i <= 8; i++) {
    const c = colorAt(1069, i);
    console.log(`  ${i}: ${c.hex} ${tritSymbol(c.trit!)}`);
  }

  console.log('\nCanonical Colors (seed=2069):');
  const codex = colorAt(2069, 1);
  console.log(`  1: ${codex.hex} ${tritSymbol(codex.trit!)}`);

  console.log('\nLocal Approximation (seed=42):');
  for (let i = 1; i <= 5; i++) {
    const c = localColorAt(42, i);
    console.log(`  ${i}: ${c.hex} ${tritSymbol(c.trit!)}`);
  }

  // Full trit analysis
  console.log('\nGF(3) Trit Analysis (first 12):');
  const colors = Array.from({ length: 12 }, (_, i) => colorAt(1069, i + 1));
  colors.forEach((c, i) => {
    console.log(`  ${i + 1}: ${c.hex} ${tritSymbol(c.trit!)} (${c.trit! === 1 ? 'PLUS' : c.trit! === 0 ? 'ERGODIC' : 'MINUS'})`);
  });

  // Find balanced quads
  console.log('\nBalanced Quads (sum ≡ 0 mod 3):');
  const quads = [
    [1, 2, 3, 6],  // +, ○, −, ○ = 0
    [4, 5, 7, 9],  // +, +, −, − = 0
    [2, 6, 8, 10], // ○, ○, ○, ○ = 0
  ];

  for (const quad of quads) {
    const qColors = quad.map(i => colorAt(1069, i));
    const qTrits = qColors.map(c => c.trit!);
    const qSum = qTrits.reduce((a, b) => a + b, 0 as Trit);
    console.log(`  [${quad.join(',')}]: ${qTrits.map(tritSymbol).join('')} = ${qSum} ${qSum % 3 === 0 ? '✓' : '✗'}`);
    console.log(`         ${qColors.map(c => c.hex).join(' ')}`);
  }

  // Claude + Codex handoff example
  console.log('\nSession Handoff GF(3):');
  const claude1 = colorAt(1069, 1);  // #E67F86 +
  const codex1 = colorAt(2069, 1);   // #635CD8 +
  console.log(`  Claude: ${claude1.hex} ${tritSymbol(claude1.trit!)}`);
  console.log(`  Codex:  ${codex1.hex} ${tritSymbol(codex1.trit!)}`);
  console.log(`  Combined: ${claude1.trit! + codex1.trit!} (need ${-((claude1.trit! + codex1.trit!) % 3)} to balance)`);
}
