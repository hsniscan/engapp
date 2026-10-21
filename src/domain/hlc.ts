// Hybrid logical clock (Kulkarni et al. 2014), encoded as a fixed-width string so that
// plain string comparison orders events: "<ms:15 digits>:<counter:5 digits>:<node>".
//
// Wrong device clocks: the physical part never goes backwards (max of last and now), and
// a remote timestamp from a fast clock is adopted, so later local edits still win LWW
// against it. Ordering of sync pages uses the server sequence, not the HLC.

export interface Hlc {
  ms: number;
  counter: number;
  node: string;
}

const MS_WIDTH = 15;
const COUNTER_WIDTH = 5;
const COUNTER_MAX = 10 ** COUNTER_WIDTH - 1;

export const HLC_ZERO = '0'.repeat(MS_WIDTH) + ':' + '0'.repeat(COUNTER_WIDTH) + ':';

export function encodeHlc(h: Hlc): string {
  return `${String(h.ms).padStart(MS_WIDTH, '0')}:${String(h.counter).padStart(COUNTER_WIDTH, '0')}:${h.node}`;
}

export function decodeHlc(s: string): Hlc {
  const first = s.indexOf(':');
  const second = s.indexOf(':', first + 1);
  if (first !== MS_WIDTH || second !== MS_WIDTH + COUNTER_WIDTH + 1) {
    throw new Error(`Invalid HLC: ${s}`);
  }
  const ms = Number(s.slice(0, first));
  const counter = Number(s.slice(first + 1, second));
  if (!Number.isFinite(ms) || !Number.isFinite(counter)) throw new Error(`Invalid HLC: ${s}`);
  return { ms, counter, node: s.slice(second + 1) };
}

export function isHlc(s: string): boolean {
  try {
    decodeHlc(s);
    return true;
  } catch {
    return false;
  }
}

function normalizeCounter(ms: number, counter: number): { ms: number; counter: number } {
  return counter > COUNTER_MAX ? { ms: ms + 1, counter: 0 } : { ms, counter };
}

/** Advance the clock for a local event. */
export function tick(last: Hlc, now: number): Hlc {
  const ms = Math.max(last.ms, Math.floor(now));
  const counter = ms === last.ms ? last.counter + 1 : 0;
  return { ...normalizeCounter(ms, counter), node: last.node };
}

/** Merge a remote timestamp into the local clock (on receiving synced rows). */
export function receive(local: Hlc, remote: Hlc, now: number): Hlc {
  const ms = Math.max(local.ms, remote.ms, Math.floor(now));
  let counter: number;
  if (ms === local.ms && ms === remote.ms) counter = Math.max(local.counter, remote.counter) + 1;
  else if (ms === local.ms) counter = local.counter + 1;
  else if (ms === remote.ms) counter = remote.counter + 1;
  else counter = 0;
  return { ...normalizeCounter(ms, counter), node: local.node };
}

export function compareHlc(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxHlc(a: string, b: string): string {
  return a >= b ? a : b;
}

/** True when a remote timestamp is further ahead of our clock than `maxDriftMs` (diagnostics only). */
export function isClockSkewed(remote: string, now: number, maxDriftMs = 24 * 3600_000): boolean {
  return decodeHlc(remote).ms - now > maxDriftMs;
}
