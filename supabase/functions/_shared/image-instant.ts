// ai-image: draw one picture now (contract: aiImageRequest / aiImageResponse in
// image-contract.ts; decision 0030). Signed-in users only, for senses in their own cards,
// IMAGE_DAILY_LIMIT a day, inside the monthly budget. The edge runtime cannot render SVG, so
// the picture is stored as 'review' (visible to the requester's cards and the review screen)
// with the vision check marked 'pending'; the nightly job runs it.

import { ApiError } from './errors.ts';
import {
  aiImageRequest,
  IMAGE_DAILY_LIMIT,
  type AiImageResponse,
  type ImageRequestInput,
} from './image-contract.ts';
import type { ImageModels } from './image-models.ts';
import { drawReserveUsd, drawSense, type ClaudeCall, type ImageStore } from './image-pipeline.ts';

type Env = (key: string) => string | undefined;

export function imageDailyLimit(env: Env): number {
  const n = Number(env('IMAGE_DAILY_LIMIT'));
  return Number.isInteger(n) && n > 0 ? n : IMAGE_DAILY_LIMIT;
}

export interface InstantStore extends ImageStore {
  consumeDaily(
    userId: string,
    limit: number,
  ): Promise<{ allowed: boolean; used: number; limit: number }>;
  userHasSense(userId: string, senseId: string): Promise<boolean>;
  senseInputs(senseIds: string[]): Promise<ImageRequestInput[]>;
  upsertRequest(senseId: string, patch: { state: string; source?: 'auto' | 'user' }): Promise<void>;
}

export interface InstantDeps {
  userId: string;
  store: InstantStore;
  claude: () => ClaudeCall;
  models: ImageModels;
  capUsd: number;
  dailyLimit: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export async function runAiImage(body: unknown, deps: InstantDeps): Promise<AiImageResponse> {
  const req = aiImageRequest.safeParse(body);
  if (!req.success) throw new ApiError('invalid_input', 'Expected {sense_id: uuid}');
  const senseId = req.data.sense_id;
  const { store } = deps;

  if (!(await store.userHasSense(deps.userId, senseId))) {
    throw new ApiError('invalid_input', 'This meaning is not in your cards');
  }
  const [input] = await store.senseInputs([senseId]);
  if (!input) throw new ApiError('invalid_input', 'Unknown sense');

  // Budget first, so a spent month does not use up one of the user's daily pictures.
  const probe = await store.reserve(
    drawReserveUsd(deps.models.image, input, { fallback: true }),
    deps.capUsd,
    'instant',
  );
  if (!probe) return { ok: false, reason: 'budget' };
  await store.settle(probe, 0);

  const day = await store.consumeDaily(deps.userId, deps.dailyLimit);
  if (!day.allowed) return { ok: false, reason: 'daily_limit' };

  let out;
  try {
    out = await drawSense(input, {
      claude: deps.claude(),
      models: deps.models,
      store,
      capUsd: deps.capUsd,
      purpose: 'instant',
      fallback: true,
      render: null,
      passStatus: 'review',
      log: deps.log,
    });
  } catch (e) {
    deps.log?.('image call failed', { error: e instanceof Error ? e.name : 'unknown' });
    throw new ApiError('ai_failed', 'The picture could not be drawn; try again later');
  }
  deps.log?.('image done', { outcome: out.outcome, cost_usd: out.costUsd, attempts: out.attempts });

  switch (out.outcome) {
    case 'image':
      await store.upsertRequest(senseId, { state: 'done' });
      return { ok: true, image: out.image };
    case 'not_visual':
      await store.upsertRequest(senseId, { state: 'skipped' });
      return { ok: false, reason: 'not_visual' };
    case 'budget':
      return { ok: false, reason: 'budget' };
    case 'failed':
      return { ok: false, reason: 'failed' };
  }
}
