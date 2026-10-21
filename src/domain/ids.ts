// UUID v7 (RFC 9562): 48-bit unix ms timestamp, 12-bit counter in rand_a, 62 random bits.
// Monotonic within one JS realm: ids generated in the same millisecond (or while the
// wall clock runs backwards) keep increasing because the counter, not the clock, advances.

let lastMs = -1;
let counter = 0;

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** Generate a UUID v7. `now` is injectable for tests. */
export function uuidv7(now: number = Date.now()): string {
  const rnd = new Uint8Array(10);
  crypto.getRandomValues(rnd);

  let ms = Math.floor(now);
  if (ms <= lastMs) {
    ms = lastMs;
    counter += 1;
    if (counter > 0xfff) {
      // Counter exhausted: borrow the next millisecond.
      ms += 1;
      counter = ((rnd[0]! << 4) | (rnd[1]! >> 4)) & 0x7ff;
    }
  } else {
    // Start in the lower half so many ids in one ms still fit before overflow.
    counter = ((rnd[0]! << 4) | (rnd[1]! >> 4)) & 0x7ff;
  }
  lastMs = ms;

  const b = new Uint8Array(16);
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = 0x70 | ((counter >> 8) & 0x0f);
  b[7] = counter & 0xff;
  b[8] = 0x80 | (rnd[2]! & 0x3f);
  for (let i = 9; i < 16; i++) b[i] = rnd[i - 6]!;

  let s = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) s += '-';
    s += HEX[b[i]!];
  }
  return s;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Millisecond timestamp encoded in a UUID v7. */
export function uuidv7Time(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
