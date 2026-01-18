/**
 * Syrup: CapTP's Serialization Format (Alternative to JSON)
 *
 * Syrup is a simple, canonical, self-describing binary format.
 * Key differences from JSON:
 * - Binary-safe (can embed raw bytes)
 * - Canonical (one representation per value)
 * - Supports symbols and records (not just strings)
 * - Preserves object identity via references
 *
 * Format:
 *   Integer:  <digits>+         e.g., "42+"
 *   String:   <len>:<bytes>     e.g., "5:hello"
 *   Symbol:   <len>'<bytes>     e.g., "5'hello"
 *   List:     [<items>]         e.g., "[3+5:world]"
 *   Record:   {<tag><items>}    e.g., "{5'point3+4+}"
 *   Bool:     t / f
 *   Null:     n
 */

export type SyrupValue =
  | number
  | string
  | symbol
  | boolean
  | null
  | SyrupValue[]
  | SyrupRecord;

export interface SyrupRecord {
  tag: symbol;
  fields: SyrupValue[];
}

// ============================================================
// SYRUP ENCODER
// ============================================================

export function encode(value: SyrupValue): string {
  if (value === null) return 'n';
  if (value === true) return 't';
  if (value === false) return 'f';

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error('Syrup only supports integers');
    }
    return `${value}+`;
  }

  if (typeof value === 'string') {
    return `${value.length}:${value}`;
  }

  if (typeof value === 'symbol') {
    const name = value.description || '';
    return `${name.length}'${name}`;
  }

  if (Array.isArray(value)) {
    return `[${value.map(encode).join('')}]`;
  }

  if ('tag' in value && 'fields' in value) {
    const tagName = value.tag.description || '';
    return `{${tagName.length}'${tagName}${value.fields.map(encode).join('')}}`;
  }

  throw new Error(`Cannot encode: ${typeof value}`);
}

// ============================================================
// SYRUP DECODER
// ============================================================

class SyrupDecoder {
  private pos = 0;

  constructor(private input: string) {}

  decode(): SyrupValue {
    const c = this.input[this.pos];

    if (c === 'n') { this.pos++; return null; }
    if (c === 't') { this.pos++; return true; }
    if (c === 'f') { this.pos++; return false; }

    if (c === '[') {
      this.pos++;
      const items: SyrupValue[] = [];
      while (this.input[this.pos] !== ']') {
        items.push(this.decode());
      }
      this.pos++; // skip ']'
      return items;
    }

    if (c === '{') {
      this.pos++;
      const tag = this.decode();
      if (typeof tag !== 'symbol') {
        throw new Error('Record tag must be symbol');
      }
      const fields: SyrupValue[] = [];
      while (this.input[this.pos] !== '}') {
        fields.push(this.decode());
      }
      this.pos++; // skip '}'
      return { tag, fields };
    }

    // Integer or length-prefixed
    let numStr = '';
    while (/[0-9-]/.test(this.input[this.pos])) {
      numStr += this.input[this.pos++];
    }
    const num = parseInt(numStr, 10);

    const delimiter = this.input[this.pos++];
    if (delimiter === '+') {
      return num;
    }
    if (delimiter === ':') {
      const str = this.input.slice(this.pos, this.pos + num);
      this.pos += num;
      return str;
    }
    if (delimiter === "'") {
      const str = this.input.slice(this.pos, this.pos + num);
      this.pos += num;
      return Symbol.for(str);
    }

    throw new Error(`Unknown delimiter: ${delimiter}`);
  }
}

export function decode(input: string): SyrupValue {
  return new SyrupDecoder(input).decode();
}

// ============================================================
// CAPTP MESSAGE ENCODING
// ============================================================

export function encodeCapTPMessage(op: string, sturdyRef: { hex: string; seed: number; index: number }, args: unknown[]): string {
  const record: SyrupRecord = {
    tag: Symbol.for(op),
    fields: [
      { tag: Symbol.for('sturdy'), fields: [sturdyRef.hex, sturdyRef.seed, sturdyRef.index] },
      args.map(a => typeof a === 'string' ? a : JSON.stringify(a)) as SyrupValue[],
    ],
  };
  return encode(record);
}

export function encodeSessionHandoff(from: { hex: string }, to: { hex: string }, reason: string): string {
  const record: SyrupRecord = {
    tag: Symbol.for('op:handoff'),
    fields: [from.hex, to.hex, reason],
  };
  return encode(record);
}

// ============================================================
// S-EXPRESSION CONVERSION
// ============================================================

/**
 * Convert SyrupValue to S-expression string (Scheme/Guile format)
 *
 * Mapping:
 *   Syrup         →  S-expression
 *   ─────────────────────────────
 *   null (n)      →  #nil
 *   true (t)      →  #t
 *   false (f)     →  #f
 *   42+           →  42
 *   5:hello       →  "hello"
 *   5'hello       →  hello
 *   [...]         →  (...)
 *   {tag ...}     →  #s(tag ...)
 */
export function toSexp(value: SyrupValue): string {
  if (value === null) return '#nil';
  if (value === true) return '#t';
  if (value === false) return '#f';

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string') {
    // Escape special characters in strings
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }

  if (typeof value === 'symbol') {
    const name = value.description || '';
    // Symbols with special chars need |pipes|
    if (/[^a-zA-Z0-9_\-+*/<>=!?:.]/.test(name) || name === '') {
      return `|${name}|`;
    }
    return name;
  }

  if (Array.isArray(value)) {
    return `(${value.map(toSexp).join(' ')})`;
  }

  if ('tag' in value && 'fields' in value) {
    const tagName = value.tag.description || '';
    const fields = value.fields.map(toSexp).join(' ');
    // Guile record syntax: #s(tag field1 field2 ...)
    return `#s(${tagName}${fields ? ' ' + fields : ''})`;
  }

  throw new Error(`Cannot convert to sexp: ${typeof value}`);
}

/**
 * Parse S-expression string to SyrupValue
 */
class SexpParser {
  private pos = 0;

  constructor(private input: string) {}

  parse(): SyrupValue {
    this.skipWhitespace();

    if (this.pos >= this.input.length) {
      throw new Error('Unexpected end of input');
    }

    const c = this.input[this.pos];

    // #nil, #t, #f, #s(record)
    if (c === '#') {
      return this.parseHash();
    }

    // String
    if (c === '"') {
      return this.parseString();
    }

    // List
    if (c === '(') {
      return this.parseList();
    }

    // Piped symbol |foo bar|
    if (c === '|') {
      return this.parsePipedSymbol();
    }

    // Quote (convert 'x to (quote x))
    if (c === "'") {
      this.pos++;
      const quoted = this.parse();
      return { tag: Symbol.for('quote'), fields: [quoted] };
    }

    // Number or symbol
    return this.parseAtom();
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
    // Skip comments
    if (this.input[this.pos] === ';') {
      while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
        this.pos++;
      }
      this.skipWhitespace();
    }
  }

  private parseHash(): SyrupValue {
    this.pos++; // skip #
    const rest = this.input.slice(this.pos);

    if (rest.startsWith('nil')) {
      this.pos += 3;
      return null;
    }
    if (rest.startsWith('t')) {
      this.pos += 1;
      return true;
    }
    if (rest.startsWith('f')) {
      this.pos += 1;
      return false;
    }
    if (rest.startsWith('s(')) {
      this.pos += 2; // skip 's('
      this.skipWhitespace();

      // Parse tag (first element must be symbol)
      const tag = this.parseAtom();
      if (typeof tag !== 'symbol') {
        throw new Error('Record tag must be symbol');
      }

      // Parse fields
      const fields: SyrupValue[] = [];
      this.skipWhitespace();
      while (this.input[this.pos] !== ')') {
        fields.push(this.parse());
        this.skipWhitespace();
      }
      this.pos++; // skip ')'

      return { tag, fields };
    }

    throw new Error(`Unknown # sequence: ${rest.slice(0, 10)}`);
  }

  private parseString(): string {
    this.pos++; // skip opening "
    let result = '';

    while (this.input[this.pos] !== '"') {
      if (this.input[this.pos] === '\\') {
        this.pos++;
        const escaped = this.input[this.pos];
        switch (escaped) {
          case 'n': result += '\n'; break;
          case 't': result += '\t'; break;
          case '\\': result += '\\'; break;
          case '"': result += '"'; break;
          default: result += escaped;
        }
      } else {
        result += this.input[this.pos];
      }
      this.pos++;
    }
    this.pos++; // skip closing "
    return result;
  }

  private parseList(): SyrupValue[] {
    this.pos++; // skip '('
    const items: SyrupValue[] = [];

    this.skipWhitespace();
    while (this.input[this.pos] !== ')') {
      items.push(this.parse());
      this.skipWhitespace();
    }
    this.pos++; // skip ')'
    return items;
  }

  private parsePipedSymbol(): symbol {
    this.pos++; // skip opening |
    let name = '';
    while (this.input[this.pos] !== '|') {
      name += this.input[this.pos++];
    }
    this.pos++; // skip closing |
    return Symbol.for(name);
  }

  private parseAtom(): SyrupValue {
    let atom = '';
    while (
      this.pos < this.input.length &&
      !/[\s()\[\]{}"|;]/.test(this.input[this.pos])
    ) {
      atom += this.input[this.pos++];
    }

    // Try as number
    if (/^-?\d+$/.test(atom)) {
      return parseInt(atom, 10);
    }
    if (/^-?\d+\.\d+$/.test(atom)) {
      // Syrup doesn't support floats, but we parse them for compatibility
      return parseFloat(atom);
    }

    // It's a symbol
    return Symbol.for(atom);
  }
}

export function fromSexp(input: string): SyrupValue {
  return new SexpParser(input).parse();
}

/**
 * Bidirectional conversion: Syrup binary ↔ S-expression text
 */
export function syrupToSexp(syrup: string): string {
  return toSexp(decode(syrup));
}

export function sexpToSyrup(sexp: string): string {
  return encode(fromSexp(sexp));
}

// ============================================================
// COMPARISON: JSON vs SYRUP
// ============================================================

export function compareFormats() {
  const message = {
    method: 'session/prompt',
    params: {
      sessionId: 'cc-8f7c4ac2',
      prompt: 'Implement GF(3)',
    },
  };

  const jsonStr = JSON.stringify(message);

  const syrupStr = encode({
    tag: Symbol.for('session/prompt'),
    fields: ['cc-8f7c4ac2', 'Implement GF(3)'],
  } as SyrupRecord);

  return {
    json: { str: jsonStr, len: jsonStr.length },
    syrup: { str: syrupStr, len: syrupStr.length },
    savings: `${Math.round((1 - syrupStr.length / jsonStr.length) * 100)}%`,
  };
}

// ============================================================
// DEMO
// ============================================================

if (import.meta.main) {
  console.log('═══ Syrup Serialization Demo ═══\n');

  // Basic types
  console.log('Basic Types:');
  console.log(`  null: "${encode(null)}"`);
  console.log(`  true: "${encode(true)}"`);
  console.log(`  42: "${encode(42)}"`);
  console.log(`  "hello": "${encode('hello')}"`);
  console.log(`  'point (symbol): "${encode(Symbol.for('point'))}"`);

  // List
  const list = [1, 2, 'three'];
  console.log(`\nList [1, 2, "three"]: "${encode(list)}"`);

  // Record
  const record: SyrupRecord = {
    tag: Symbol.for('point'),
    fields: [3, 4],
  };
  console.log(`Record {point 3 4}: "${encode(record)}"`);

  // Roundtrip
  const encoded = encode(record);
  const decoded = decode(encoded);
  console.log(`\nRoundtrip: ${JSON.stringify(decoded, (k, v) => typeof v === 'symbol' ? `Symbol(${v.description})` : v)}`);

  // CapTP message
  console.log('\nCapTP Message:');
  const captpMsg = encodeCapTPMessage(
    'op:deliver',
    { hex: '#E67F86', seed: 1069, index: 1 },
    ['prompt', 'Implement GF(3)']
  );
  console.log(`  "${captpMsg}"`);

  // Session handoff
  console.log('\nSession Handoff:');
  const handoff = encodeSessionHandoff(
    { hex: '#E67F86' },
    { hex: '#64F86C' },
    'context_threshold'
  );
  console.log(`  "${handoff}"`);

  // Format comparison
  console.log('\nJSON vs Syrup:');
  const cmp = compareFormats();
  console.log(`  JSON (${cmp.json.len} chars): ${cmp.json.str}`);
  console.log(`  Syrup (${cmp.syrup.len} chars): ${cmp.syrup.str}`);
  console.log(`  Savings: ${cmp.savings}`);

  // S-expression conversion
  console.log('\n═══ Syrup ↔ S-expression ═══\n');

  // Basic types
  console.log('Syrup → S-expression:');
  console.log(`  n (null)        → ${toSexp(null)}`);
  console.log(`  t (true)        → ${toSexp(true)}`);
  console.log(`  42+ (int)       → ${toSexp(42)}`);
  console.log(`  5:hello (str)   → ${toSexp('hello')}`);
  console.log(`  5'point (sym)   → ${toSexp(Symbol.for('point'))}`);

  // Complex structures
  const captpRecord: SyrupRecord = {
    tag: Symbol.for('op:deliver'),
    fields: [
      { tag: Symbol.for('sturdy'), fields: ['#E67F86', 1069, 1] },
      ['prompt', 'Implement GF(3)'],
    ],
  };
  console.log(`\nCapTP Record → S-exp:`);
  console.log(`  Syrup: ${encode(captpRecord)}`);
  console.log(`  S-exp: ${toSexp(captpRecord)}`);

  // S-expression → Syrup
  console.log('\nS-expression → Syrup:');
  const sexpExamples = [
    '#nil',
    '#t',
    '42',
    '"hello world"',
    'my-symbol',
    '(1 2 3)',
    '#s(point 3 4)',
    '(define (square x) (* x x))',
  ];

  for (const sexp of sexpExamples) {
    try {
      const parsed = fromSexp(sexp);
      const syrup = encode(parsed);
      console.log(`  ${sexp.padEnd(30)} → ${syrup}`);
    } catch (e) {
      console.log(`  ${sexp.padEnd(30)} → (error: ${(e as Error).message})`);
    }
  }

  // Roundtrip demo
  console.log('\nRoundtrip: Syrup → Sexp → Syrup');
  const original = encode(captpRecord);
  const sexp = syrupToSexp(original);
  const backToSyrup = sexpToSyrup(sexp);
  console.log(`  Original:  ${original}`);
  console.log(`  As S-exp:  ${sexp}`);
  console.log(`  Back:      ${backToSyrup}`);
  console.log(`  Match:     ${original === backToSyrup ? '✓' : '✗'}`);
}
