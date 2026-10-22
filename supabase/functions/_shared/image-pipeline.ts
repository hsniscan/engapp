// The picture pipeline, environment-neutral (decision 0030, docs/ai-image.md). Used by the
// ai-image edge function (instant path) and by scripts/img-batch.ts / img-pilot.ts (Node).
//
//   draw (image-v1) → parse → sanitize → token contrast → [render → coverage → vision check]
//   → store. A failed check gives one redraw with the matching fixed problem sentence; a second
//   failure stores the attempt as 'rejected' (never shown). Every model call reserves an upper
//   bound of its cost first and settles the real cost after (image_budget_*).

import type Anthropic from '@anthropic-ai/sdk';
import {
  checkUserText,
  buildCheckRequest,
  contrastCheck,
  parseCheckResponse,
  verdictProblem,
  MIN_COVERAGE,
  CHECK_MAX_TOKENS,
  IMAGE_CHECK_SYSTEM_PROMPT,
  type ContrastReport,
  type VisionVerdict,
} from './image-check.ts';
import {
  IMAGE_PROMPT_VERSION,
  type ImageRequestInput,
  type ImageStatus,
  type LexiconImageRow,
} from './image-contract.ts';
import {
  callCostUsd,
  reserveUsd,
  roundUsd,
  tokenBound,
  type ImageModels,
  type TokenUsage,
} from './image-models.ts';
import {
  buildImageRequest,
  parseImageResponse,
  IMAGE_MAX_TOKENS,
  IMAGE_SYSTEM_PROMPT,
  type ModelMessage,
  type ParsedImage,
  type RedrawProblem,
} from './image-prompt.ts';
import { sanitizeSvg } from './svg-sanitize.ts';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/** A finished model call as the pipeline needs it. */
export interface CalledMessage extends ModelMessage {
  model?: string;
  usage?: TokenUsage | null;
}

/**
 * Calls the Messages API. `fallback: true` (instant Opus calls only) adds the server-side
 * refusal fallback. Throws on transport/API errors.
 */
export type ClaudeCall = (
  params: Anthropic.MessageCreateParamsNonStreaming,
  opts: { fallback: boolean },
) => Promise<CalledMessage>;

export type BudgetPurpose = 'instant' | 'batch' | 'check' | 'visual' | 'pilot';

export interface BudgetStore {
  /** Hold id, or null when the month's budget cannot cover the amount. */
  reserve(amountUsd: number, capUsd: number, purpose: BudgetPurpose): Promise<string | null>;
  settle(holdId: string, actualUsd: number): Promise<void>;
}

export interface NewImage {
  sense_id: string;
  svg: string;
  alt_tr: string;
  status: ImageStatus;
  checks: Record<string, unknown>;
  model: string | null;
  prompt_version: string;
  cost_usd: number;
}

export interface ImageStore extends BudgetStore {
  insertImage(row: NewImage): Promise<LexiconImageRow & { cost_usd: number }>;
}

/** PNG renders of a sanitised SVG (Node only: scripts/lib/render.ts). */
export interface Rendered {
  light: { png: string; coverage: number };
  dark: { png: string; coverage: number };
}
export type Render = (svg: string) => Rendered | Promise<Rendered>;

export interface PipelineDeps {
  claude: ClaudeCall;
  models: ImageModels;
  store: ImageStore;
  capUsd: number;
  /** Budget purpose of the drawing calls. */
  purpose: BudgetPurpose;
  /** Instant calls use the server-side fallback; batch calls cannot. */
  fallback: boolean;
  /** Without a renderer the vision check is left to the nightly job ('pending'). */
  render?: Render | null;
  /** Status of a picture that passed every check that ran. */
  passStatus: ImageStatus;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Checks of one drawing
// ---------------------------------------------------------------------------

export type Evaluation =
  | {
      kind: 'pass';
      svg: string;
      alt_tr: string;
      checks: Record<string, unknown>;
      checkCostUsd: number;
    }
  | {
      kind: 'fail';
      problem: RedrawProblem;
      /** The sanitised SVG when there is one (kept on the rejected row for review). */
      svg: string;
      alt_tr: string;
      checks: Record<string, unknown>;
      checkCostUsd: number;
    }
  | { kind: 'declined'; reason: 'declined' | 'refused' }
  | { kind: 'budget' };

type EvalDeps = Pick<PipelineDeps, 'claude' | 'models' | 'store' | 'capUsd' | 'render' | 'log'>;

/** Vision check of a rendered picture, inside the budget. Null verdict: the check failed. */
async function visionCheck(
  input: ImageRequestInput,
  rendered: Rendered,
  deps: EvalDeps,
): Promise<{ verdict: VisionVerdict | null; costUsd: number } | 'budget'> {
  const params = buildCheckRequest(
    input,
    { light: rendered.light.png, dark: rendered.dark.png },
    { model: deps.models.check },
  );
  // Two 256² PNGs ≈ 2 × 90 tokens; text ≈ prompt length.
  const inputTokens = tokenBound(IMAGE_CHECK_SYSTEM_PROMPT + checkUserText(input)) + 400;
  const bound = reserveUsd(deps.models.check, { inputTokens, maxTokens: CHECK_MAX_TOKENS });
  const hold = await deps.store.reserve(bound, deps.capUsd, 'check');
  if (!hold) return 'budget';
  let cost = 0;
  try {
    const msg = await deps.claude(params, { fallback: false });
    cost = callCostUsd(msg.model ?? deps.models.check, msg.usage);
    return { verdict: parseCheckResponse(msg), costUsd: cost };
  } finally {
    await deps.store.settle(hold, cost);
  }
}

/** Runs every check on one parsed answer. */
export async function evaluateDrawing(
  input: ImageRequestInput,
  parsed: ParsedImage,
  deps: EvalDeps,
): Promise<Evaluation> {
  if (parsed.kind === 'declined') return { kind: 'declined', reason: 'declined' };
  if (parsed.kind === 'refused') return { kind: 'declined', reason: 'refused' };
  if (parsed.kind === 'invalid') {
    return {
      kind: 'fail',
      problem: 'invalid_svg',
      svg: '',
      alt_tr: '',
      checks: { answer: parsed.reason },
      checkCostUsd: 0,
    };
  }
  const { image } = parsed;
  const clean = sanitizeSvg(image.svg);
  if (!clean.ok) {
    return {
      kind: 'fail',
      problem: 'invalid_svg',
      svg: '',
      alt_tr: image.alt_tr,
      checks: { sanitize: clean.reason, confidence: image.confidence },
      checkCostUsd: 0,
    };
  }
  const svg = clean.svg;
  const contrast: ContrastReport = contrastCheck(svg);
  const checks: Record<string, unknown> = {
    sanitize: 'ok',
    confidence: image.confidence,
    contrast: { ok: contrast.ok, problem: contrast.problem, detail: contrast.detail },
  };
  const fail = (problem: RedrawProblem, cost = 0): Evaluation => ({
    kind: 'fail',
    problem,
    svg,
    alt_tr: image.alt_tr,
    checks,
    checkCostUsd: cost,
  });
  if (!contrast.ok) return fail('low_contrast');

  if (!deps.render) {
    checks.vision = 'pending';
    return { kind: 'pass', svg, alt_tr: image.alt_tr, checks, checkCostUsd: 0 };
  }
  const rendered = await deps.render(svg);
  checks.coverage = {
    light: Math.round(rendered.light.coverage * 1000) / 1000,
    dark: Math.round(rendered.dark.coverage * 1000) / 1000,
  };
  if (rendered.light.coverage < MIN_COVERAGE || rendered.dark.coverage < MIN_COVERAGE) {
    return fail('low_contrast');
  }
  const v = await visionCheck(input, rendered, deps);
  if (v === 'budget') return { kind: 'budget' };
  checks.vision = v.verdict ?? 'failed';
  checks.vision_cost_usd = v.costUsd;
  if (!v.verdict) return fail('other', v.costUsd);
  const problem = verdictProblem(v.verdict);
  if (problem) return fail(problem, v.costUsd);
  return { kind: 'pass', svg, alt_tr: image.alt_tr, checks, checkCostUsd: v.costUsd };
}

// ---------------------------------------------------------------------------
// Synchronous drawing (instant path, pilot)
// ---------------------------------------------------------------------------

export type DrawOutcome =
  | { outcome: 'image'; image: LexiconImageRow; costUsd: number; attempts: number }
  | { outcome: 'not_visual'; costUsd: number; attempts: number }
  | { outcome: 'budget'; costUsd: number; attempts: number }
  | { outcome: 'failed'; costUsd: number; attempts: number; problem: RedrawProblem };

/** Upper bound of one image-v1 call. */
export function drawReserveUsd(
  model: string,
  input: ImageRequestInput,
  opts: { batch?: boolean; fallback?: boolean } = {},
): number {
  return reserveUsd(model, {
    inputTokens: tokenBound(IMAGE_SYSTEM_PROMPT) + tokenBound(JSON.stringify(input)) + 64,
    maxTokens: IMAGE_MAX_TOKENS,
    batch: opts.batch,
    fallback: opts.fallback,
  });
}

/**
 * Draws a picture for one sense now: at most two attempts (the second with the first one's
 * problem). Stores every attempt that produced an answer, with its real cost.
 */
export async function drawSense(
  input: ImageRequestInput,
  deps: PipelineDeps,
  opts: { problem?: RedrawProblem | null; attempts?: number } = {},
): Promise<DrawOutcome> {
  const max = opts.attempts ?? 2;
  let problem: RedrawProblem | null = opts.problem ?? null;
  let total = 0;
  for (let attempt = 1; attempt <= max; attempt++) {
    const model = deps.models.image;
    const hold = await deps.store.reserve(
      drawReserveUsd(model, input, { fallback: deps.fallback }),
      deps.capUsd,
      deps.purpose,
    );
    if (!hold) return { outcome: 'budget', costUsd: total, attempts: attempt - 1 };
    let msg: CalledMessage;
    let cost = 0;
    try {
      msg = await deps.claude(buildImageRequest(input, { model, problem }), {
        fallback: deps.fallback,
      });
      cost = callCostUsd(model, msg.usage);
    } finally {
      // A failed request (thrown) is not billed by the API: settle at 0.
      await deps.store.settle(hold, cost);
    }
    total += cost;
    const parsed = parseImageResponse(msg);
    const ev = await evaluateDrawing(input, parsed, deps);
    deps.log?.('image attempt', {
      sense_id: input.sense_id,
      attempt,
      result: ev.kind,
      ...(ev.kind === 'fail' ? { problem: ev.problem } : {}),
      cost_usd: cost,
    });
    if (ev.kind === 'declined') return { outcome: 'not_visual', costUsd: total, attempts: attempt };
    if (ev.kind === 'budget') {
      // The drawing exists but could not be checked this month: keep it for the next run.
      return { outcome: 'budget', costUsd: total, attempts: attempt };
    }
    total += ev.checkCostUsd;
    const rowCost = roundUsd(cost + ev.checkCostUsd);
    const servedBy = msg.model ?? model;
    if (ev.kind === 'pass') {
      const row = await deps.store.insertImage({
        sense_id: input.sense_id,
        svg: ev.svg,
        alt_tr: ev.alt_tr,
        status: deps.passStatus,
        checks: { ...ev.checks, attempt, ...(problem ? { redraw_of: problem } : {}) },
        model: servedBy,
        prompt_version: IMAGE_PROMPT_VERSION,
        cost_usd: rowCost,
      });
      // Only the client columns (no cost, no check details).
      const image: LexiconImageRow = {
        id: row.id,
        sense_id: row.sense_id,
        variant: row.variant,
        svg: row.svg,
        alt_tr: row.alt_tr,
        status: row.status,
        created_at: row.created_at,
      };
      return { outcome: 'image', image, costUsd: roundUsd(total), attempts: attempt };
    }
    await deps.store.insertImage({
      sense_id: input.sense_id,
      svg: ev.svg,
      alt_tr: ev.alt_tr,
      status: 'rejected',
      checks: { ...ev.checks, attempt, problem: ev.problem },
      model: servedBy,
      prompt_version: IMAGE_PROMPT_VERSION,
      cost_usd: rowCost,
    });
    problem = ev.problem;
    if (attempt === max) {
      return {
        outcome: 'failed',
        costUsd: roundUsd(total),
        attempts: attempt,
        problem: ev.problem,
      };
    }
  }
  /* c8 ignore next */
  return {
    outcome: 'failed',
    costUsd: roundUsd(total),
    attempts: max,
    problem: problem ?? 'other',
  };
}
