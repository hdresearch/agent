// VT Sequence Utilities for CLI Integration Testing
// Extracted and enhanced from scripts/vt-pty-test.ts

/**
 * VT sequence constants and generators
 */
export const VT = {
  // Control characters
  ESC: "\x1b",
  BEL: "\x07",
  CR: "\r",
  LF: "\n",
  NUL: "\x00",

  // Control codes for input
  ctrlA: "\x01",
  ctrlC: "\x03",
  ctrlD: "\x04",
  ctrlE: "\x05",
  ctrlK: "\x0b",
  ctrlU: "\x15",
  ctrlW: "\x17",

  // Common input sequences
  enter: "\r",
  escape: "\x1b",
  backspace: "\x7f",
  delete: "\x1b[3~",
  tab: "\t",

  // Arrow keys
  arrowUp: "\x1b[A",
  arrowDown: "\x1b[B",
  arrowRight: "\x1b[C",
  arrowLeft: "\x1b[D",

  // Page navigation
  pageUp: "\x1b[5~",
  pageDown: "\x1b[6~",
  home: "\x1b[H",
  end: "\x1b[F",

  // CSI sequence builder
  csi: (params: string, final: string) => `\x1b[${params}${final}`,

  // Cursor movement
  cursorUp: (n = 1) => `\x1b[${n}A`,
  cursorDown: (n = 1) => `\x1b[${n}B`,
  cursorForward: (n = 1) => `\x1b[${n}C`,
  cursorBack: (n = 1) => `\x1b[${n}D`,
  cursorPosition: (row: number, col: number) => `\x1b[${row};${col}H`,
  cursorColumn: (col: number) => `\x1b[${col}G`,
  saveCursor: "\x1b[s",
  restoreCursor: "\x1b[u",

  // SGR (Select Graphic Rendition)
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  blink: "\x1b[5m",
  inverse: "\x1b[7m",
  hidden: "\x1b[8m",
  strikethrough: "\x1b[9m",

  // Standard colors (foreground)
  fgBlack: "\x1b[30m",
  fgRed: "\x1b[31m",
  fgGreen: "\x1b[32m",
  fgYellow: "\x1b[33m",
  fgBlue: "\x1b[34m",
  fgMagenta: "\x1b[35m",
  fgCyan: "\x1b[36m",
  fgWhite: "\x1b[37m",

  // Bright colors (foreground)
  fgBrightBlack: "\x1b[90m",
  fgBrightRed: "\x1b[91m",
  fgBrightGreen: "\x1b[92m",
  fgBrightYellow: "\x1b[93m",
  fgBrightBlue: "\x1b[94m",
  fgBrightMagenta: "\x1b[95m",
  fgBrightCyan: "\x1b[96m",
  fgBrightWhite: "\x1b[97m",

  // 256-color
  fg256: (n: number) => `\x1b[38;5;${n}m`,
  bg256: (n: number) => `\x1b[48;5;${n}m`,

  // True color (24-bit RGB)
  fgRgb: (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`,
  bgRgb: (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,

  // Screen operations
  clearScreen: "\x1b[2J",
  clearLine: "\x1b[2K",
  clearToEndOfLine: "\x1b[K",
  clearToEndOfScreen: "\x1b[J",

  // OSC sequences
  setTitle: (title: string) => `\x1b]0;${title}\x07`,
  setClipboard: (text: string) => `\x1b]52;c;${btoa(text)}\x07`,
  hyperlink: (url: string, text: string) => `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`,
};

/**
 * Parsed VT sequence information
 */
export interface VtSequence {
  raw: string;
  type: "csi" | "osc" | "esc" | "unknown";
  params?: string;
  final?: string;
}

/**
 * SGR (Select Graphic Rendition) parameters
 */
export interface SgrParams {
  reset: boolean;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  inverse: boolean;
  hidden: boolean;
  strikethrough: boolean;
  fgColor?: number | { r: number; g: number; b: number };
  bgColor?: number | { r: number; g: number; b: number };
}

/**
 * Parse VT sequences from output data
 */
export function parseVtSequences(data: string): { text: string; sequences: VtSequence[] } {
  const sequences: VtSequence[] = [];

  // Match ESC sequences:
  // - CSI: ESC [ params final_byte
  // - OSC: ESC ] ... BEL or ESC ] ... ST
  // - Simple ESC: ESC char
  const seqRegex = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-9;]*m|[()][AB012]|[78DEHM])/g;

  let text = data;
  let match;

  while ((match = seqRegex.exec(data)) !== null) {
    const raw = match[0];
    let seq: VtSequence;

    if (raw.startsWith("\x1b[")) {
      // CSI sequence
      const csiMatch = raw.match(/\x1b\[([0-9;?]*)([A-Za-z])/);
      seq = {
        raw,
        type: "csi",
        params: csiMatch?.[1] || "",
        final: csiMatch?.[2] || "",
      };
    } else if (raw.startsWith("\x1b]")) {
      // OSC sequence
      const oscMatch = raw.match(/\x1b\](\d+);?([^\x07\x1b]*)/);
      seq = {
        raw,
        type: "osc",
        params: oscMatch?.[1] || "",
      };
    } else {
      // Simple ESC sequence
      seq = {
        raw,
        type: "esc",
      };
    }

    sequences.push(seq);
  }

  text = data.replace(seqRegex, "");

  return { text, sequences };
}

/**
 * Extract plain text from VT-encoded output
 */
export function extractText(data: string): string {
  return parseVtSequences(data).text;
}

/**
 * Parse SGR (m) sequence parameters
 */
export function parseSgr(seq: string): SgrParams {
  const result: SgrParams = {
    reset: false,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    blink: false,
    inverse: false,
    hidden: false,
    strikethrough: false,
  };

  const match = seq.match(/\x1b\[([0-9;:]+)?m/);
  if (!match) return result;

  const params = (match[1] || "0").split(";").map(Number);

  let i = 0;
  while (i < params.length) {
    const p = params[i];

    switch (p) {
      case 0:
        result.reset = true;
        break;
      case 1:
        result.bold = true;
        break;
      case 2:
        result.dim = true;
        break;
      case 3:
        result.italic = true;
        break;
      case 4:
        result.underline = true;
        break;
      case 5:
        result.blink = true;
        break;
      case 7:
        result.inverse = true;
        break;
      case 8:
        result.hidden = true;
        break;
      case 9:
        result.strikethrough = true;
        break;

      // Standard foreground colors
      case 30:
      case 31:
      case 32:
      case 33:
      case 34:
      case 35:
      case 36:
      case 37:
        result.fgColor = p - 30;
        break;

      // Bright foreground colors
      case 90:
      case 91:
      case 92:
      case 93:
      case 94:
      case 95:
      case 96:
      case 97:
        result.fgColor = p - 90 + 8;
        break;

      // 256-color or true color foreground
      case 38:
        if (params[i + 1] === 5) {
          // 256-color
          result.fgColor = params[i + 2];
          i += 2;
        } else if (params[i + 1] === 2) {
          // True color
          result.fgColor = {
            r: params[i + 2],
            g: params[i + 3],
            b: params[i + 4],
          };
          i += 4;
        }
        break;

      // 256-color or true color background
      case 48:
        if (params[i + 1] === 5) {
          // 256-color
          result.bgColor = params[i + 2];
          i += 2;
        } else if (params[i + 1] === 2) {
          // True color
          result.bgColor = {
            r: params[i + 2],
            g: params[i + 3],
            b: params[i + 4],
          };
          i += 4;
        }
        break;
    }

    i++;
  }

  return result;
}

/**
 * Extract all SGR sequences from output
 */
export function extractSgrSequences(data: string): Array<{ seq: string; params: SgrParams }> {
  const { sequences } = parseVtSequences(data);
  return sequences
    .filter((s) => s.type === "csi" && s.final === "m")
    .map((s) => ({
      seq: s.raw,
      params: parseSgr(s.raw),
    }));
}

/**
 * Check if output contains a specific foreground color
 */
export function hasColor(
  data: string,
  color: number | { r: number; g: number; b: number }
): boolean {
  const sgrSeqs = extractSgrSequences(data);
  return sgrSeqs.some((s) => {
    if (typeof color === "number") {
      return s.params.fgColor === color;
    } else if (typeof s.params.fgColor === "object" && s.params.fgColor !== null) {
      const fg = s.params.fgColor as { r: number; g: number; b: number };
      return fg.r === color.r && fg.g === color.g && fg.b === color.b;
    }
    return false;
  });
}

/**
 * Check if output contains specific SGR attributes
 */
export function hasAttribute(data: string, attr: keyof SgrParams): boolean {
  const sgrSeqs = extractSgrSequences(data);
  return sgrSeqs.some((s) => s.params[attr] === true);
}

/**
 * Wait for output to match a pattern
 */
export async function waitForOutput(
  getOutput: () => string,
  pattern: RegExp | string,
  timeoutMs: number = 5000
): Promise<string | null> {
  const startTime = Date.now();
  const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;

  while (Date.now() - startTime < timeoutMs) {
    const output = getOutput();
    if (regex.test(output)) {
      return output;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

/**
 * Strip all VT sequences from text
 */
export function stripVt(data: string): string {
  return extractText(data);
}

/**
 * Check if text contains box drawing characters
 */
export function hasBoxDrawing(data: string): boolean {
  // Common box drawing characters
  const boxChars = /[─│┌┐└┘├┤┬┴┼╔╗╚╝║═╠╣╦╩╬]/;
  return boxChars.test(data);
}

/**
 * Check if text contains the vers-agent status bar format
 */
export function hasStatusBar(data: string): boolean {
  // Status bar typically has model name, connection status, etc.
  const hasModel = /sonnet|opus|haiku/i.test(data);
  const hasConnection = /connected|disconnected|connecting/i.test(data);
  return hasModel || hasConnection;
}

/**
 * Type a string character by character with delays
 */
export function* typeString(text: string, delayMs: number = 50): Generator<{ char: string; delay: number }> {
  for (const char of text) {
    yield { char, delay: delayMs };
  }
}
