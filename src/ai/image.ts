// Client of the shared picture surface (v0.4, docs/decisions/0031 and 0032):
//   - `ai-image` edge function: draw one picture now (signed-in users, 10 a day, budget);
//   - public.lexicon_images, read through PostgREST (RLS: approved rows, plus 'review' rows of
//     senses in the reader's own cards);
//   - the admin review functions (is_app_admin, image_review_queue, image_review_decide).
// Every answer is validated with the shared contract. Only the lexicon sense id is ever sent.
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  aiImageRequest,
  aiImageResponse,
  IMAGE_RPC,
  lexiconImageRow,
  type AiImageResponse,
  type ImageRejectReason,
  type LexiconImageRow,
} from '../../supabase/functions/_shared/image-contract';
import { errorBody } from '../../supabase/functions/_shared/contracts';
import type { ImageManifestRow } from '@/domain/images';
import { backendConfig, getAccessToken, supabase } from '@/lib/supabase';
import { AiClientError, type AiClientDeps } from './client';

export type { AiImageResponse, LexiconImageRow };

/** Draws a picture for a lexicon sense now. Timeout 90 s (the plan: under a minute). */
export async function requestImage(senseId: string, deps: AiClientDeps = {}): Promise<AiImageResponse> {
  const body = aiImageRequest.parse({ sense_id: senseId });
  const config = deps.config === undefined ? backendConfig : deps.config;
  if (!config) throw new AiClientError('not_configured', 'Supabase is not configured');
  const token = await (deps.getAccessToken ?? getAccessToken)();
  if (!token) throw new AiClientError('not_signed_in', 'Sign in to draw a picture');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 90_000);
  let res: Response;
  let json: unknown;
  try {
    res = await (deps.fetch ?? fetch)(`${config.url}/functions/v1/ai-image`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        apikey: config.key,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    json = await res.json().catch(() => null);
  } catch (e) {
    throw new AiClientError('offline', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = errorBody.safeParse(json);
    throw err.success
      ? new AiClientError(err.data.error.code, err.data.error.message, res.status)
      : new AiClientError(res.status === 401 ? 'unauthorized' : 'internal', `HTTP ${res.status}`, res.status);
  }
  const ok = aiImageResponse.safeParse(json);
  if (!ok.success) throw new AiClientError('bad_response', 'invalid ai-image response', res.status);
  return ok.data;
}

// ------------------------------------------------------------------ table reads

export type ImageApiErrorKind = 'not_configured' | 'network' | 'server' | 'invalid_response';

export class ImageApiError extends Error {
  readonly kind: ImageApiErrorKind;
  constructor(kind: ImageApiErrorKind, message: string) {
    super(message);
    this.name = 'ImageApiError';
    this.kind = kind;
  }
}

/** At most this many ids in one `in.(…)` filter (keeps the URL short). */
export const IMAGE_ID_CHUNK = 80;

const MANIFEST_COLUMNS = 'id,sense_id,variant,status,created_at';
const ROW_COLUMNS = 'id,sense_id,variant,svg,alt_tr,status,created_at';

const manifestRow = z.object({
  id: z.string(),
  sense_id: z.string(),
  variant: z.number().int(),
  status: z.string(),
  created_at: z.string(),
});

function client(c?: SupabaseClient | null): SupabaseClient {
  const s = c === undefined ? supabase : c;
  if (!s) throw new ImageApiError('not_configured', 'Supabase is not configured (guest mode)');
  return s;
}

function chunks<T>(items: readonly T[], size = IMAGE_ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function select(
  c: SupabaseClient,
  columns: string,
  column: 'sense_id' | 'id',
  ids: readonly string[],
): Promise<unknown[]> {
  let res: { data: unknown; error: { message: string; code?: string } | null };
  try {
    res = await c.from('lexicon_images').select(columns).in(column, [...ids]).in('status', ['approved', 'review']);
  } catch (e) {
    throw new ImageApiError('network', e instanceof Error ? e.message : String(e));
  }
  if (res.error) {
    const network = !res.error.code && /fetch|network|load failed/i.test(res.error.message);
    throw new ImageApiError(network ? 'network' : 'server', res.error.message);
  }
  if (!Array.isArray(res.data)) throw new ImageApiError('invalid_response', 'not a list');
  return res.data;
}

/** The pictures the server has for these lexicon senses, without their SVG. */
export async function listImageManifest(senseIds: readonly string[], c?: SupabaseClient | null): Promise<ImageManifestRow[]> {
  const cl = client(c);
  const out: ImageManifestRow[] = [];
  for (const part of chunks(senseIds)) {
    for (const row of await select(cl, MANIFEST_COLUMNS, 'sense_id', part)) {
      const p = manifestRow.safeParse(row);
      if (p.success) out.push(p.data);
    }
  }
  return out;
}

/** Full rows of these pictures. Rows that do not match the contract are left out. */
export async function downloadImages(ids: readonly string[], c?: SupabaseClient | null): Promise<LexiconImageRow[]> {
  const cl = client(c);
  const out: LexiconImageRow[] = [];
  for (const part of chunks(ids, 40)) {
    for (const row of await select(cl, ROW_COLUMNS, 'id', part)) {
      const p = lexiconImageRow.safeParse(row);
      if (p.success) out.push(p.data);
    }
  }
  return out;
}

// ------------------------------------------------------------------ admin review (İP4)

export const reviewQueueRow = z.object({
  image: lexiconImageRow,
  lemma: z.string(),
  pos: z.string().nullable().catch(null),
  gloss_tr: z.string(),
});
export type ReviewQueueRow = z.infer<typeof reviewQueueRow>;

export type ReviewDecision = 'approve' | 'reject' | 'redraw';

async function rpc(c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  let res: { data: unknown; error: { message: string; code?: string } | null };
  try {
    res = await c.rpc(fn, args);
  } catch (e) {
    throw new ImageApiError('network', e instanceof Error ? e.message : String(e));
  }
  if (res.error) {
    const network = !res.error.code && /fetch|network|load failed/i.test(res.error.message);
    throw new ImageApiError(network ? 'network' : 'server', `${res.error.code ?? ''} ${res.error.message}`.trim());
  }
  return res.data;
}

/** Is the signed-in user an app admin? (Checked again by every admin function on the server.) */
export async function isAppAdmin(c?: SupabaseClient | null): Promise<boolean> {
  return (await rpc(client(c), IMAGE_RPC.isAdmin, {})) === true;
}

/** The oldest pictures waiting for review. Rows that do not match the contract are left out. */
export async function fetchReviewQueue(limit = 20, c?: SupabaseClient | null): Promise<ReviewQueueRow[]> {
  const data = await rpc(client(c), IMAGE_RPC.reviewQueue, { p_limit: limit });
  if (!Array.isArray(data)) throw new ImageApiError('invalid_response', 'not a list');
  return data.flatMap((r) => {
    const p = reviewQueueRow.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

export async function decideReview(
  imageId: string,
  decision: ReviewDecision,
  reason: ImageRejectReason | null = null,
  c?: SupabaseClient | null,
): Promise<void> {
  await rpc(client(c), IMAGE_RPC.reviewDecide, {
    p_image_id: imageId,
    p_decision: decision,
    p_reason: decision === 'reject' ? reason : null,
  });
}
