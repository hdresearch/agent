/**
 * Bicomodule Encoding: Prefix + Content + Postfix
 *
 * Maps the bicomodule framework to serialization:
 *   c (Control)   ↔ PREFIX  (type tag + length) — σ effect handler
 *   m (Interface) ↔ CONTENT (data bytes)        — state layer
 *   d (Data)      ↔ POSTFIX (checksum + close)  — ε counit
 *
 * Key law: ε ∘ δ = id (decode ∘ encode = identity)
 *
 * Format:
 *   <type:1><length:4><content:n><checksum:2><close:1>
 *
 * Example: string "hello"
 *   PREFIX:  S 00000005
 *   CONTENT: hello
 *   POSTFIX: A7 ;
 */

// ============================================================
// BICOMODULE TYPE SYSTEM
// ============================================================

export type BicoValue =
  | { type: 'null' }
  | { type: 'bool'; value: boolean }
  | { type: 'int'; value: number }
  | { type: 'string'; value: string }
  | { type: 'symbol'; value: string }
  | { type: 'list'; value: BicoValue[] }
  | { type: 'record'; tag: string; fields: BicoValue[] };

// Type tags (PREFIX layer - σ effect handler)
const TYPE_TAGS: Record<string, string> = {
  null: 'N',
  bool: 'B',
  int: 'I',
  string: 'S',
  symbol: 'Y',
  list: 'L',
  record: 'R',
};

// Close markers (POSTFIX layer - ε counit)
const CLOSE_MARKERS: Record<string, string> = {
  null: '.',
  bool: '!',
  int: '#',
  string: ';',
  symbol: "'",
  list: ']',
  record: '}',
};

// ============================================================
// σ: EFFECT HANDLER (PREFIX ENCODER)
// ============================================================

function encodePrefix(type: string, length: number): string {
  const tag = TYPE_TAGS[type] || '?';
  const lenHex = length.toString(16).padStart(8, '0');
  return `${tag}${lenHex}`;
}

function decodePrefix(input: string): { type: string; length: number; rest: string } {
  const tag = input[0];
  const type = Object.entries(TYPE_TAGS).find(([_, t]) => t === tag)?.[0] || 'unknown';
  const length = parseInt(input.slice(1, 9), 16);
  return { type, length, rest: input.slice(9) };
}

// ============================================================
// ε: COUNIT (POSTFIX ENCODER)
// ============================================================

function computeChecksum(content: string): string {
  // Simple checksum: sum of char codes mod 256, as hex
  let sum = 0;
  for (const c of content) {
    sum = (sum + c.charCodeAt(0)) & 0xff;
  }
  return sum.toString(16).padStart(2, '0').toUpperCase();
}

function encodePostfix(type: string, content: string): string {
  const checksum = computeChecksum(content);
  const close = CLOSE_MARKERS[type] || '.';
  return `${checksum}${close}`;
}

function verifyPostfix(type: string, content: string, postfix: string): boolean {
  const expectedChecksum = computeChecksum(content);
  const actualChecksum = postfix.slice(0, 2);
  const close = postfix[2];
  return expectedChecksum === actualChecksum && close === CLOSE_MARKERS[type];
}

// ============================================================
// BICOMODULE ENCODER (σ → m → ε)
// ============================================================

export function bicoEncode(value: BicoValue): string {
  switch (value.type) {
    case 'null': {
      const content = '';
      return encodePrefix('null', 0) + encodePostfix('null', content);
    }

    case 'bool': {
      const content = value.value ? 'T' : 'F';
      return encodePrefix('bool', 1) + content + encodePostfix('bool', content);
    }

    case 'int': {
      const content = value.value.toString();
      return encodePrefix('int', content.length) + content + encodePostfix('int', content);
    }

    case 'string': {
      return encodePrefix('string', value.value.length) +
             value.value +
             encodePostfix('string', value.value);
    }

    case 'symbol': {
      return encodePrefix('symbol', value.value.length) +
             value.value +
             encodePostfix('symbol', value.value);
    }

    case 'list': {
      const items = value.value.map(bicoEncode).join('');
      return encodePrefix('list', value.value.length) +
             items +
             encodePostfix('list', items);
    }

    case 'record': {
      const tagEncoded = bicoEncode({ type: 'symbol', value: value.tag });
      const fieldsEncoded = value.fields.map(bicoEncode).join('');
      const content = tagEncoded + fieldsEncoded;
      return encodePrefix('record', value.fields.length) +
             content +
             encodePostfix('record', content);
    }
  }
}

// ============================================================
// BICOMODULE DECODER (ε⁻¹ → m⁻¹ → σ⁻¹)
// ============================================================

class BicoDecoder {
  private pos = 0;

  constructor(private input: string) {}

  decode(): BicoValue {
    const { type, length, rest } = decodePrefix(this.input.slice(this.pos));
    this.pos += 9; // tag + 8 hex digits

    switch (type) {
      case 'null': {
        this.pos += 3; // postfix
        return { type: 'null' };
      }

      case 'bool': {
        const content = this.input[this.pos];
        this.pos += 1 + 3; // content + postfix
        return { type: 'bool', value: content === 'T' };
      }

      case 'int': {
        const content = this.input.slice(this.pos, this.pos + length);
        this.pos += length + 3; // content + postfix
        return { type: 'int', value: parseInt(content, 10) };
      }

      case 'string': {
        const content = this.input.slice(this.pos, this.pos + length);
        this.pos += length + 3; // content + postfix
        return { type: 'string', value: content };
      }

      case 'symbol': {
        const content = this.input.slice(this.pos, this.pos + length);
        this.pos += length + 3; // content + postfix
        return { type: 'symbol', value: content };
      }

      case 'list': {
        const items: BicoValue[] = [];
        const startPos = this.pos;
        for (let i = 0; i < length; i++) {
          items.push(this.decode());
        }
        this.pos += 3; // postfix
        return { type: 'list', value: items };
      }

      case 'record': {
        const tag = this.decode();
        if (tag.type !== 'symbol') throw new Error('Record tag must be symbol');
        const fields: BicoValue[] = [];
        for (let i = 0; i < length; i++) {
          fields.push(this.decode());
        }
        this.pos += 3; // postfix
        return { type: 'record', tag: tag.value, fields };
      }

      default:
        throw new Error(`Unknown type: ${type}`);
    }
  }
}

export function bicoDecode(input: string): BicoValue {
  return new BicoDecoder(input).decode();
}

// ============================================================
// COMPARISON: SYRUP vs BICOMODULE
// ============================================================

function syrupEncode(s: string): string {
  return `${s.length}:${s}`;
}

export function compareEncodings(value: string) {
  const bicoVal: BicoValue = { type: 'string', value };
  const bico = bicoEncode(bicoVal);
  const syrup = syrupEncode(value);
  const json = JSON.stringify(value);

  return {
    value,
    encodings: {
      syrup: { str: syrup, len: syrup.length, format: 'prefix only' },
      bicomodule: { str: bico, len: bico.length, format: 'prefix + content + postfix' },
      json: { str: json, len: json.length, format: 'delimiter only' },
    },
  };
}

// ============================================================
// GF(3) TRIT FROM ENCODING
// ============================================================

export function encodingTrit(encoded: string): -1 | 0 | 1 {
  let sum = 0;
  for (const c of encoded) {
    sum += c.charCodeAt(0);
  }
  return ((sum % 3) - 1) as -1 | 0 | 1;
}

// ============================================================
// DEMO
// ============================================================

if (import.meta.main) {
  console.log('═══ Bicomodule Encoding Demo ═══\n');

  console.log('Structure:');
  console.log('  PREFIX  (σ): Type tag + length (9 chars)');
  console.log('  CONTENT (m): Data bytes (n chars)');
  console.log('  POSTFIX (ε): Checksum + close (3 chars)');
  console.log('');
  console.log('  Law: ε ∘ δ = id (roundtrip preserves identity)\n');

  // Basic examples
  const examples: BicoValue[] = [
    { type: 'null' },
    { type: 'bool', value: true },
    { type: 'int', value: 42 },
    { type: 'string', value: 'hello' },
    { type: 'symbol', value: 'point' },
    { type: 'list', value: [
      { type: 'int', value: 1 },
      { type: 'int', value: 2 },
    ]},
    { type: 'record', tag: 'op:deliver', fields: [
      { type: 'string', value: '#E67F86' },
      { type: 'int', value: 1069 },
    ]},
  ];

  console.log('Encodings:\n');
  for (const val of examples) {
    const encoded = bicoEncode(val);
    const decoded = bicoDecode(encoded);
    const trit = encodingTrit(encoded);
    const tritSym = trit === -1 ? '−' : trit === 0 ? '○' : '+';

    console.log(`  ${val.type.padEnd(8)} → ${encoded}`);
    console.log(`           ├─ prefix: ${encoded.slice(0, 9)}`);
    console.log(`           ├─ content: ${encoded.slice(9, -3) || '(empty)'}`);
    console.log(`           ├─ postfix: ${encoded.slice(-3)}`);
    console.log(`           └─ trit: ${tritSym} (GF(3))`);
    console.log('');
  }

  // Comparison
  console.log('═══ Format Comparison ═══\n');
  console.log('Encoding "hello":\n');
  const cmp = compareEncodings('hello');
  console.log(`  Syrup:      ${cmp.encodings.syrup.str.padEnd(25)} (${cmp.encodings.syrup.len} chars) - ${cmp.encodings.syrup.format}`);
  console.log(`  Bicomodule: ${cmp.encodings.bicomodule.str.padEnd(25)} (${cmp.encodings.bicomodule.len} chars) - ${cmp.encodings.bicomodule.format}`);
  console.log(`  JSON:       ${cmp.encodings.json.str.padEnd(25)} (${cmp.encodings.json.len} chars) - ${cmp.encodings.json.format}`);

  // Roundtrip verification
  console.log('\n═══ Bicomodule Law: ε ∘ δ = id ═══\n');
  const testRecord: BicoValue = {
    type: 'record',
    tag: 'session',
    fields: [
      { type: 'string', value: '#E67F86' },
      { type: 'int', value: 1069 },
      { type: 'symbol', value: 'claude' },
    ],
  };

  const encoded = bicoEncode(testRecord);
  const decoded = bicoDecode(encoded);
  const reencoded = bicoEncode(decoded);

  console.log('  Original:  ', JSON.stringify(testRecord));
  console.log('  Encoded:   ', encoded);
  console.log('  Decoded:   ', JSON.stringify(decoded));
  console.log('  Re-encoded:', reencoded);
  console.log('  ε ∘ δ = id:', encoded === reencoded ? '✓' : '✗');
}
