// Minimal MessagePack decoder: enough for wordfreq's `*.msgpack.gz` files (nested arrays of
// strings plus a small header map). No dependency for a 60-line format reader.

export function decodeMsgpack(buf: Uint8Array): unknown {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const text = new TextDecoder();
  let pos = 0;

  const str = (n: number): string => {
    const s = text.decode(buf.subarray(pos, pos + n));
    pos += n;
    return s;
  };
  const arr = (n: number): unknown[] => {
    const out = new Array<unknown>(n);
    for (let i = 0; i < n; i++) out[i] = read();
    return out;
  };
  const map = (n: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) {
      const k = read();
      out[String(k)] = read();
    }
    return out;
  };

  function read(): unknown {
    if (pos >= buf.length) throw new Error('msgpack: unexpected end of input');
    const b = buf[pos++]!;
    if (b <= 0x7f) return b;
    if (b >= 0xe0) return b - 0x100;
    if ((b & 0xe0) === 0xa0) return str(b & 0x1f);
    if ((b & 0xf0) === 0x90) return arr(b & 0x0f);
    if ((b & 0xf0) === 0x80) return map(b & 0x0f);
    switch (b) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xcc:
        return buf[pos++]!;
      case 0xcd:
        pos += 2;
        return view.getUint16(pos - 2);
      case 0xce:
        pos += 4;
        return view.getUint32(pos - 4);
      case 0xd0:
        pos += 1;
        return view.getInt8(pos - 1);
      case 0xd1:
        pos += 2;
        return view.getInt16(pos - 2);
      case 0xd2:
        pos += 4;
        return view.getInt32(pos - 4);
      case 0xca:
        pos += 4;
        return view.getFloat32(pos - 4);
      case 0xcb:
        pos += 8;
        return view.getFloat64(pos - 8);
      case 0xd9:
        return str(buf[pos++]!);
      case 0xda:
        pos += 2;
        return str(view.getUint16(pos - 2));
      case 0xdb:
        pos += 4;
        return str(view.getUint32(pos - 4));
      case 0xdc:
        pos += 2;
        return arr(view.getUint16(pos - 2));
      case 0xdd:
        pos += 4;
        return arr(view.getUint32(pos - 4));
      case 0xde:
        pos += 2;
        return map(view.getUint16(pos - 2));
      case 0xdf:
        pos += 4;
        return map(view.getUint32(pos - 4));
      default:
        throw new Error(`msgpack: unsupported type byte 0x${b.toString(16)}`);
    }
  }

  return read();
}
