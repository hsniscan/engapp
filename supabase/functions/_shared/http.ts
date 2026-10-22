// HTTP plumbing for the edge functions: CORS, JSON responses, the error shape
// {error: {code, message}} and a generic POST handler. Web-standard APIs only.

import { ApiError } from './errors.ts';

export interface CorsConfig {
  /** Allowed origins (exact match), or ['*']. From ALLOWED_ORIGINS, comma-separated. */
  allowedOrigins: string[];
}

/**
 * Origin of the Android app: Capacitor serves the bundled files from https://localhost
 * (docs/decisions/0033-android-capacitor.md). The deploy workflow always adds it to
 * ALLOWED_ORIGINS; calls still need a valid user JWT.
 */
export const CAPACITOR_ANDROID_ORIGIN = 'https://localhost';

export function parseOrigins(raw: string | undefined): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return list.length > 0 ? list : ['http://localhost:5173', 'http://127.0.0.1:5173'];
}

export function corsHeaders(req: Request, cfg: CorsConfig): Record<string, string> {
  const origin = req.headers.get('origin');
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (cfg.allowedOrigins.includes('*')) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && cfg.allowedOrigins.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorResponse(
  err: unknown,
  headers: Record<string, string> = {},
  log?: (m: string, d?: Record<string, unknown>) => void,
): Response {
  if (err instanceof ApiError) {
    const extra: Record<string, string> = { ...headers };
    if (err.retryAfterS) extra['Retry-After'] = String(err.retryAfterS);
    return json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.retryAfterS ? { retry_after_s: err.retryAfterS } : {}),
        },
      },
      err.status,
      extra,
    );
  }
  log?.('unhandled error', {
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  });
  return json({ error: { code: 'internal', message: 'Internal error' } }, 500, headers);
}

const MAX_BODY_BYTES = 64 * 1024;

export interface HandlerOptions<T> {
  cors: CorsConfig;
  /** Returns the caller's user id or throws ApiError('unauthorized'). */
  authenticate: (req: Request) => Promise<string>;
  run: (body: unknown, userId: string) => Promise<T>;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

export function createHandler<T>(opts: HandlerOptions<T>): (req: Request) => Promise<Response> {
  return async (req) => {
    const cors = corsHeaders(req, opts.cors);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (req.method !== 'POST') throw new ApiError('method_not_allowed', 'Use POST');
      const userId = await opts.authenticate(req);
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES)
        throw new ApiError('invalid_input', 'Body too large');
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new ApiError('invalid_input', 'Body must be JSON');
      }
      return json(await opts.run(body, userId), 200, cors);
    } catch (e) {
      return errorResponse(e, cors, opts.log);
    }
  };
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1]! : null;
}
