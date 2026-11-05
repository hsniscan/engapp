// Error reports (decision 0076, D4): what of a local error-log entry may leave the device.
// Pure functions; the sender is src/sync/errorReport.ts. Nothing that could be the user's
// own text goes out: URLs, e-mail addresses, quoted text and long numbers or ids are
// replaced, and every field is cut short. The server (client_errors) cuts again.

import type { ErrorLogRow } from './types';

export interface ClientErrorRow {
  occurred_at: string;
  fingerprint: string;
  message: string;
  context: string | null;
  stack: string | null;
  app_version: string | null;
  platform: 'web' | 'pwa' | 'android';
}

export const MAX_MESSAGE = 300;
export const MAX_CONTEXT = 120;
export const MAX_STACK = 600;
export const MAX_STACK_FRAMES = 4;

/** Replaces anything that could hold the user's own words or identifiers. */
export function scrub(text: string): string {
  return (
    text
      // URLs (any scheme) → "file.js:line:col" when it is a script, else a marker.
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)'"]+/gi, (u) => {
        const file = /\/([\w.-]+\.(?:js|mjs|ts|tsx))(?:[?#][^\s:]*)?((?::\d+)*)$/.exec(u);
        return file ? `${file[1]}${file[2]}` : '<url>';
      })
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>')
      // Quoted text: "…", “…”, ‘…’, «…», `…`, and '…' after a space or punctuation.
      .replace(/"[^"]*"|“[^”]*”|‘[^’]*’|«[^»]*»|`[^`]*`/g, '"…"')
      .replace(/(^|[\s(:=,])'[^']*'/g, `$1'…'`)
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
      // Long numbers, but not the line:column of a stack frame.
      .replace(/(^|[^:\w])\d{5,}\b/g, '$1<n>')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** The top stack frames as "function file:line:col", without the origin. */
export function scrubStack(stack: string | null): string | null {
  if (!stack) return null;
  const frames = stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^at\s|@/.test(l))
    .slice(0, MAX_STACK_FRAMES)
    .map((l) => scrub(l).slice(0, 140));
  return frames.length ? frames.join(' | ').slice(0, MAX_STACK) : null;
}

/** The context's code label and its non-identifying rest (ids and URLs scrubbed). */
export function scrubContext(context: string | null): string | null {
  if (!context) return null;
  // "sync.push rejected notes/0197…": the row id after a slash is user data, not a clue.
  const s = scrub(context).replace(/\/[\w-]{6,}/g, '/<id>');
  return s.slice(0, MAX_CONTEXT) || null;
}

/** Short stable hash (FNV-1a, base 36) of the error's kind: same bug, same fingerprint. */
export function fingerprint(message: string, context: string | null): string {
  const label = (context ?? '').split(' ')[0] ?? '';
  // Numbers vary between occurrences of one bug: leave them out of the key.
  const key = `${label}|${message.replace(/\d+/g, '#').slice(0, 120)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The rows to send for these entries: scrubbed, one per fingerprint. */
export function toReportRows(
  entries: ErrorLogRow[],
  appVersion: string | null,
  platform: ClientErrorRow['platform'],
): ClientErrorRow[] {
  const seen = new Set<string>();
  const out: ClientErrorRow[] = [];
  for (const e of entries) {
    const message = scrub(e.message).slice(0, MAX_MESSAGE);
    if (!message) continue;
    const context = scrubContext(e.context);
    const fp = fingerprint(message, context);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push({
      occurred_at: new Date(e.at).toISOString(),
      fingerprint: fp,
      message,
      context,
      stack: scrubStack(e.stack),
      app_version: appVersion && /^[0-9A-Za-z.+_-]{1,32}$/.test(appVersion) ? appVersion : null,
      platform,
    });
  }
  return out;
}
