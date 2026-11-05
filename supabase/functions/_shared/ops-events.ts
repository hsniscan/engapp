// Counted events of the edge functions (decision 0076, D4). Supabase Free keeps function logs
// for one day and nobody reads them, so failures and AI provider fallbacks are also counted
// in public.ops_events (service role, no user column), which the nightly health check sums
// up (ops_health_reliability: fn_errors_24h, ai_fallbacks_24h, ai_quota_24h).
//
//   fn_error     a request answered 5xx (except quota): ai_failed, fetch_failed, internal …
//   ai_quota     a provider quota or the monthly text budget refused the call
//   ai_fallback  the first AI provider ran out of quota and the second answered instead
//
// Details hold the function name and an error code only, never user text or ids. Recording
// is fire-and-forget: it never delays or fails the request.

type Log = (msg: string, data?: Record<string, unknown>) => void;

/** Minimal RPC surface (SupabaseClient satisfies it). */
export interface OpsRpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
}

export type OpsEventKind = 'fn_error' | 'ai_quota' | 'ai_fallback';

/** Error codes the user caused or that are expected; not counted as failures. */
const NOT_FAILURES = new Set([
  'unauthorized',
  'invalid_input',
  'daily_limit', // counted by the SQL limit functions themselves
  'method_not_allowed',
  'blocked_url',
  'robots_disallowed',
  'not_html',
  'too_large',
  'paywalled',
  'extract_failed',
]);

/** The ops event for an error answer, or null when it is not worth counting. */
export function eventForError(code: string): OpsEventKind | null {
  if (NOT_FAILURES.has(code)) return null;
  if (code === 'quota_exceeded' || code === 'budget_exhausted') return 'ai_quota';
  return 'fn_error';
}

export interface OpsEvents {
  record(kind: OpsEventKind, detail?: Record<string, string>): void;
  /** For createHandler's onError: counts the error answers that matter. */
  onError(code: string): void;
  /** The function log, plus an ai_fallback event for every "provider fallback" line. */
  wrapLog(log: Log): Log;
}

const CODE_RE = /^[a-z0-9_]{1,40}$/;

export function opsEvents(client: OpsRpc | null, fn: string, log?: Log): OpsEvents {
  const record = (kind: OpsEventKind, detail: Record<string, string> = {}) => {
    if (!client) return;
    try {
      void Promise.resolve(client.rpc('ops_event', { p_kind: kind, p_detail: { fn, ...detail } })).then(
        (r) => {
          if (r.error) log?.('ops event not stored', { kind, error: r.error.message.slice(0, 120) });
        },
        () => {},
      );
    } catch {
      // Counting must never break a request.
    }
  };
  return {
    record,
    onError(code) {
      const kind = eventForError(code);
      if (kind) record(kind, { code: CODE_RE.test(code) ? code : 'other' });
    },
    wrapLog(inner) {
      return (msg, data) => {
        inner(msg, data);
        if (msg === 'provider fallback') record('ai_fallback');
      };
    },
  };
}
