// Minimal protobuf reader for the two config blobs the newer Anki collection format
// (collection.anki21b, schema 18) keeps in SQLite: a note type's config (field 1 = kind,
// 0 normal / 1 cloze) and a card template's config (field 1 = front template, field 2 = back).
// Only varint and length-delimited fields are needed; the others are skipped by wire type.

export type ProtoValue = number | Uint8Array;

/** Every field of one message, by field number, in order of appearance. */
export function readProtoFields(bytes: Uint8Array): Map<number, ProtoValue[]> {
  const out = new Map<number, ProtoValue[]>();
  let pos = 0;
  const varint = (): number => {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      if (pos >= bytes.length) throw new Error('truncated varint');
      const b = bytes[pos++]!;
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return result;
      mul *= 128;
    }
    throw new Error('varint too long');
  };
  while (pos < bytes.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    let value: ProtoValue;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const len = varint();
      if (pos + len > bytes.length) throw new Error('truncated field');
      value = bytes.subarray(pos, pos + len);
      pos += len;
    } else if (wire === 1) {
      pos += 8;
      continue;
    } else if (wire === 5) {
      pos += 4;
      continue;
    } else throw new Error(`unsupported wire type ${wire}`);
    const list = out.get(field);
    if (list) list.push(value);
    else out.set(field, [value]);
  }
  return out;
}

const utf8 = new TextDecoder();

/** First string value of a field ('' when absent or not a string). */
export function protoString(fields: Map<number, ProtoValue[]>, field: number): string {
  const v = fields.get(field)?.[0];
  return v instanceof Uint8Array ? utf8.decode(v) : '';
}

/** First varint value of a field (0 when absent, the protobuf default). */
export function protoNumber(fields: Map<number, ProtoValue[]>, field: number): number {
  const v = fields.get(field)?.[0];
  return typeof v === 'number' ? v : 0;
}

// ---------------------------------------------------------------- writer (fixtures and tests)

function writeVarint(out: number[], n: number): void {
  let v = n;
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

/** Encode a flat message of varint (number) and string/bytes fields. */
export function encodeProto(fields: [number, number | string | Uint8Array][]): Uint8Array {
  const out: number[] = [];
  const enc = new TextEncoder();
  for (const [no, value] of fields) {
    if (typeof value === 'number') {
      writeVarint(out, no * 8);
      writeVarint(out, value);
    } else {
      const bytes = typeof value === 'string' ? enc.encode(value) : value;
      writeVarint(out, no * 8 + 2);
      writeVarint(out, bytes.length);
      for (const b of bytes) out.push(b);
    }
  }
  return Uint8Array.from(out);
}
