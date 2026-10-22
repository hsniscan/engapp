// Personal FSRS parameters (v0.3 İP4, docs/decisions/0022-fsrs-optimizer.md).
//
// A small FSRS-6 optimizer in plain TypeScript: the memory model below is the one ts-fsrs uses
// (same formulas, same parameter bounds, same "elapsed days" = difference of UTC dates), so the
// parameters it finds mean exactly what the scheduler does with them. Training follows the
// FSRS reference (fsrs-rs): binary log-loss of the predicted recall probability on every review
// that comes at least one day after the previous one, Adam with mini-batches and cosine
// learning-rate decay, parameters clipped to ts-fsrs' bounds after each step, plus a pretrain of
// the four initial stabilities and an L2 pull towards the starting parameters.
//
// Gradients are central finite differences: the loss of one batch is a cheap fold over its
// cards' histories, so 42 evaluations per step still finish in a few seconds for tens of
// thousands of reviews. Pure: no Dexie, no DOM; runs in a Web Worker
// (src/features/fsrs/optimizer.worker.ts) and in tests.
import { clipParameters, generatorParameters } from 'ts-fsrs';
import { FSRS_CONFIG } from './fsrsConfig';
import { expectedDailyReviews } from './workload';

export const PARAM_COUNT = 21;
/** Non-undone review logs (Anki imports included) before the app suggests a personal setting. */
export const MIN_REVIEWS = 1000;
/** After a run, the next suggestion comes this much later (and only with new reviews). */
export const REOPTIMIZE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
/** Share of the evaluable reviews (oldest first) used for training; the newest rest is held out. */
export const TRAIN_SHARE = 0.8;
/** Fewer held-out reviews than this: the comparison would be noise, nothing is changed. */
export const MIN_TEST_ITEMS = 100;

const DAY_MS = 86_400_000;
const S_MIN = 0.001;
const S_MAX = 36500;
const NUM_RELEARNING_STEPS = FSRS_CONFIG.relearning_steps.length;

/** The 21 FSRS-6 weights the scheduler uses for these stored params (null = ts-fsrs defaults). */
export function normalizeParams(w: readonly number[] | null | undefined): number[] {
  return generatorParameters({
    ...(w ? { w: [...w] } : {}),
    enable_short_term: FSRS_CONFIG.enable_short_term,
    relearning_steps: [...FSRS_CONFIG.relearning_steps],
  }).w.slice();
}

/** Clip to ts-fsrs' bounds (the scheduler would do the same when it loads them). */
export function clipToBounds(w: readonly number[]): number[] {
  return clipParameters([...w], NUM_RELEARNING_STEPS, FSRS_CONFIG.enable_short_term);
}

// ------------------------------------------------------------------ dataset

export interface DatasetLog {
  card_id: string;
  rating: number; // 1–4
  reviewed_at: number;
}

/** Review history in flat arrays (cheap to send to a worker and to loop over). */
export interface ReviewDataset {
  /** Index of each card's first review; the last entry is the total length. */
  cardStart: Int32Array;
  rating: Uint8Array;
  /** UTC day number of the review (ts-fsrs counts elapsed days between UTC dates). */
  day: Int32Array;
  at: Float64Array;
}

/** Group effective (non-undone) logs by card, each card in answer order. */
export function buildDataset(logs: readonly DatasetLog[]): ReviewDataset {
  const byCard = new Map<string, DatasetLog[]>();
  for (const l of logs) {
    if (l.rating < 1 || l.rating > 4) continue;
    let list = byCard.get(l.card_id);
    if (!list) byCard.set(l.card_id, (list = []));
    list.push(l);
  }
  const n = [...byCard.values()].reduce((a, l) => a + l.length, 0);
  const cardStart = new Int32Array(byCard.size + 1);
  const rating = new Uint8Array(n);
  const day = new Int32Array(n);
  const at = new Float64Array(n);
  let i = 0;
  let c = 0;
  for (const list of byCard.values()) {
    list.sort((a, b) => a.reviewed_at - b.reviewed_at);
    cardStart[c++] = i;
    for (const l of list) {
      rating[i] = l.rating;
      day[i] = Math.floor(l.reviewed_at / DAY_MS);
      at[i] = l.reviewed_at;
      i++;
    }
  }
  cardStart[c] = i;
  return { cardStart, rating, day, at };
}

export function cardCount(ds: ReviewDataset): number {
  return ds.cardStart.length - 1;
}

// ------------------------------------------------------------------ memory model (= ts-fsrs)

interface Model {
  w: readonly number[];
  decay: number;
  factor: number;
  initDEasy: number;
}

function model(w: readonly number[]): Model {
  const decay = -w[20]!;
  const factor = Math.pow(0.9, 1 / decay) - 1;
  return { w, decay, factor, initDEasy: w[4]! - Math.exp(3 * w[5]!) + 1 };
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Probability of recall after t days at stability s. */
function recall(m: Model, t: number, s: number): number {
  return Math.pow(1 + (m.factor * t) / s, m.decay);
}

export interface MemoryState {
  stability: number;
  difficulty: number;
}

/**
 * One answer: the next memory state, as ts-fsrs' FSRSAlgorithm.next_state computes it
 * (without its rounding to 8 decimals). `prev` null = the card's first answer.
 */
function step(m: Model, prev: MemoryState | null, t: number, g: number): MemoryState {
  const w = m.w;
  if (!prev) {
    return {
      stability: Math.max(w[g - 1]!, 0.1),
      difficulty: clamp(w[4]! - Math.exp((g - 1) * w[5]!) + 1, 1, 10),
    };
  }
  const { stability: s, difficulty: d } = prev;
  let ns: number;
  if (t === 0) {
    const sinc = Math.pow(s, -w[19]!) * Math.exp(w[17]! * (g - 3 + w[18]!));
    ns = clamp(s * (g >= 2 ? Math.max(sinc, 1) : sinc), S_MIN, S_MAX);
  } else {
    const r = recall(m, t, s);
    if (g === 1) {
      const forget = clamp(
        w[11]! * Math.pow(d, -w[12]!) * (Math.pow(s + 1, w[13]!) - 1) * Math.exp((1 - r) * w[14]!),
        S_MIN,
        S_MAX,
      );
      ns = clamp(s / Math.exp(w[17]! * w[18]!), S_MIN, forget);
    } else {
      const hard = g === 2 ? w[15]! : 1;
      const easy = g === 4 ? w[16]! : 1;
      ns = clamp(
        s * (1 + Math.exp(w[8]!) * (11 - d) * Math.pow(s, -w[9]!) * (Math.exp((1 - r) * w[10]!) - 1) * hard * easy),
        S_MIN,
        S_MAX,
      );
    }
  }
  const nd = d + (-w[6]! * (g - 3) * (10 - d)) / 9;
  const difficulty = clamp(w[7]! * m.initDEasy + (1 - w[7]!) * nd, 1, 10);
  return { stability: ns, difficulty };
}

/** One answer under these weights (exported for simulations and tests). */
export function nextMemoryState(w: readonly number[], prev: MemoryState | null, t: number, g: number): MemoryState {
  return step(model(w), prev, t, g);
}

/** Probability of recall after `t` days at stability `s` under these weights. */
export function recallProbability(w: readonly number[], t: number, s: number): number {
  return recall(model(w), t, s);
}

/** Memory state after a sequence of answers ([rating, days since the previous answer]). */
export function memoryStateOf(w: readonly number[], answers: readonly (readonly [number, number])[]): MemoryState | null {
  const m = model(w);
  let st: MemoryState | null = null;
  for (const [g, t] of answers) st = step(m, st, t, g);
  return st;
}

type Visit = (index: number, p: number, recalled: boolean, t: number, reviewsBefore: number, lapsesBefore: number) => void;

/**
 * Walk one card's history; `visit` gets the predicted recall of every answer that comes on a
 * later day than the previous one (same-day answers only update the state, as in fsrs-rs).
 * Returns the final memory state.
 */
function walkCard(m: Model, ds: ReviewDataset, card: number, visit: Visit | null): MemoryState | null {
  const start = ds.cardStart[card]!;
  const end = ds.cardStart[card + 1]!;
  let st: MemoryState | null = null;
  let lapses = 0;
  for (let i = start; i < end; i++) {
    const g = ds.rating[i]!;
    const t = st ? ds.day[i]! - ds.day[i - 1]! : 0;
    if (st && t > 0 && visit) visit(i, recall(m, t, st.stability), g > 1, t, i - start, lapses);
    st = step(m, st, Math.max(0, t), g);
    if (g === 1) lapses++;
  }
  return st;
}

// ------------------------------------------------------------------ metrics

export interface Metrics {
  logLoss: number;
  /** Calibration error over bins of similar reviews (FSRS benchmark "RMSE (bins)"). */
  rmseBins: number;
  count: number;
}

const P_EPS = 1e-4;
function bce(p: number, y: boolean): number {
  const q = clamp(p, P_EPS, 1 - P_EPS);
  return y ? -Math.log(q) : -Math.log(1 - q);
}

const logBin = (x: number, base: number) => (x <= 1 ? x : 1 + Math.round(Math.log(x) / Math.log(base)));

/** Log-loss and RMSE (bins) of the predictions on the reviews `include` accepts (by time). */
export function evaluate(w: readonly number[], ds: ReviewDataset, include: (at: number) => boolean): Metrics {
  const m = model(w);
  let loss = 0;
  let n = 0;
  const bins = new Map<number, { n: number; p: number; y: number }>();
  for (let c = 0; c < cardCount(ds); c++) {
    walkCard(m, ds, c, (i, p, y, t, reps, lapses) => {
      if (!include(ds.at[i]!)) return;
      loss += bce(p, y);
      n++;
      // Bin by elapsed days, number of earlier answers and earlier lapses (log-spaced), as the
      // FSRS benchmark does: a model cannot look good by averaging unlike reviews together.
      const key = logBin(t, 1.7) * 10_000 + logBin(reps, 1.7) * 100 + logBin(lapses, 1.7);
      const b = bins.get(key) ?? { n: 0, p: 0, y: 0 };
      b.n++;
      b.p += p;
      b.y += y ? 1 : 0;
      bins.set(key, b);
    });
  }
  let se = 0;
  for (const b of bins.values()) se += b.n * (b.p / b.n - b.y / b.n) ** 2;
  return { logLoss: n ? loss / n : 0, rmseBins: n ? Math.sqrt(se / n) : 0, count: n };
}

// ------------------------------------------------------------------ training

export interface TrainOptions {
  /**
   * Passes over the training data; default: enough for ~150 Adam steps (1–40 passes), so the
   * work grows with the history only once one pass alone has more steps than that.
   */
  epochs?: number;
  /** Reviews per mini-batch (default 512, as fsrs-rs). */
  batchSize?: number;
  /** Adam learning rate (default 0.04, as fsrs-rs). */
  learningRate?: number;
  /** Weight of the pull towards the starting parameters (default 2). */
  gamma?: number;
  seed?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Deterministic PRNG (mulberry32): the same data gives the same parameters on every device. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rough spread of each weight (bounds' width), used to scale the L2 pull and the FD step. */
const RANGE = (() => {
  const lo = clipToBounds(new Array<number>(PARAM_COUNT).fill(-1e9));
  const hi = clipToBounds(new Array<number>(PARAM_COUNT).fill(1e9));
  return lo.map((l, i) => Math.max(hi[i]! - l, 0.01));
})();

/**
 * Initial stabilities (w0–w3) from the second answer of each card, per first rating: the S
 * that best explains how often it was remembered, pulled towards the current value when there
 * are few cards, and kept in order (Again ≤ Hard ≤ Good ≤ Easy).
 */
export function pretrainInitialStability(w: readonly number[], ds: ReviewDataset, include: (at: number) => boolean): number[] {
  const m = model(w);
  const groups: [number, boolean][][] = [[], [], [], []];
  for (let c = 0; c < cardCount(ds); c++) {
    const i = ds.cardStart[c]!;
    if (ds.cardStart[c + 1]! - i < 2) continue;
    // Only cards whose second answer is on a later day (same-day steps blur the first rating).
    const t = ds.day[i + 1]! - ds.day[i]!;
    if (t < 1 || !include(ds.at[i + 1]!)) continue;
    groups[ds.rating[i]! - 1]!.push([t, ds.rating[i + 1]! > 1]);
  }
  const out = [...w];
  for (let g = 0; g < 4; g++) {
    const items = groups[g]!;
    if (items.length < 10) continue;
    const prior = Math.log(Math.max(w[g]!, 0.1));
    const f = (ls: number) => {
      const s = Math.exp(ls);
      let l = (ls - prior) ** 2 * 2; // ≈ a couple of pseudo-reviews at the current value
      for (const [t, y] of items) l += bce(recall(m, t, s), y);
      return l;
    };
    // Golden-section search on log S in [ln 0.1, ln 100].
    let a = Math.log(0.1);
    let b = Math.log(100);
    const r = (Math.sqrt(5) - 1) / 2;
    let x1 = b - r * (b - a);
    let x2 = a + r * (b - a);
    let f1 = f(x1);
    let f2 = f(x2);
    for (let k = 0; k < 60; k++) {
      if (f1 < f2) {
        b = x2;
        x2 = x1;
        f2 = f1;
        x1 = b - r * (b - a);
        f1 = f(x1);
      } else {
        a = x1;
        x1 = x2;
        f1 = f2;
        x2 = a + r * (b - a);
        f2 = f(x2);
      }
    }
    out[g] = Math.exp((a + b) / 2);
  }
  for (let g = 1; g < 4; g++) out[g] = Math.max(out[g]!, out[g - 1]!);
  return clipToBounds(out);
}

/**
 * Fit the weights to the reviews `include` accepts, starting from `start`. Mini-batches are
 * whole cards (a card's history is one sequence); only accepted reviews enter the loss.
 */
export function trainParams(
  ds: ReviewDataset,
  start: readonly number[],
  include: (at: number) => boolean,
  opts: TrainOptions = {},
): number[] {
  const batchSize = opts.batchSize ?? 512;
  const lr0 = opts.learningRate ?? 0.04;
  const gamma = opts.gamma ?? 2;
  const rand = prng(opts.seed ?? 42);

  // Training reviews per card.
  const cards: number[] = [];
  const counts: number[] = [];
  let total = 0;
  for (let c = 0; c < cardCount(ds); c++) {
    let k = 0;
    for (let i = ds.cardStart[c]! + 1; i < ds.cardStart[c + 1]!; i++) {
      if (ds.day[i]! > ds.day[i - 1]! && include(ds.at[i]!)) k++;
    }
    if (k > 0) {
      cards.push(c);
      counts[c] = k;
      total += k;
    }
  }
  const startW = clipToBounds(start);
  if (total === 0) return startW;

  const batchesPerEpoch = Math.max(1, Math.round(total / batchSize));
  const epochs = opts.epochs ?? clamp(Math.ceil(150 / batchesPerEpoch), 1, 40);
  const totalSteps = epochs * batchesPerEpoch;

  const batchLoss = (w: readonly number[], batch: readonly number[], n: number): number => {
    const m = model(w);
    let loss = 0;
    for (const c of batch) {
      walkCard(m, ds, c, (i, p, y) => {
        if (include(ds.at[i]!)) loss += bce(p, y);
      });
    }
    let pen = 0;
    for (let j = 0; j < PARAM_COUNT; j++) pen += ((w[j]! - startW[j]!) / RANGE[j]!) ** 2;
    return (loss + (gamma * pen * n) / total) / n;
  };

  let w = startW.slice();
  const mom = new Array<number>(PARAM_COUNT).fill(0);
  const vel = new Array<number>(PARAM_COUNT).fill(0);
  const b1 = 0.9;
  const b2 = 0.999;
  let t = 0;
  const probe = w.slice();
  for (let e = 0; e < epochs; e++) {
    // Shuffle (Fisher–Yates), then cut into batches of about batchSize reviews.
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cards[i], cards[j]] = [cards[j]!, cards[i]!];
    }
    const batches: { cards: number[]; n: number }[] = [];
    let cur: number[] = [];
    let n = 0;
    for (const c of cards) {
      cur.push(c);
      n += counts[c]!;
      if (n >= batchSize) {
        batches.push({ cards: cur, n });
        cur = [];
        n = 0;
      }
    }
    if (cur.length) {
      // A small remainder joins the previous batch (the step count stays as estimated).
      const last = batches[batches.length - 1];
      if (last && n < batchSize / 2) {
        last.cards.push(...cur);
        last.n += n;
      } else batches.push({ cards: cur, n });
    }
    for (const batch of batches) {
      const grad = new Array<number>(PARAM_COUNT);
      for (let j = 0; j < PARAM_COUNT; j++) {
        const h = 1e-4 * Math.max(RANGE[j]!, 0.1);
        probe[j] = w[j]! + h;
        const up = batchLoss(probe, batch.cards, batch.n);
        probe[j] = w[j]! - h;
        const down = batchLoss(probe, batch.cards, batch.n);
        probe[j] = w[j]!;
        grad[j] = (up - down) / (2 * h);
      }
      t++;
      const lr = lr0 * 0.5 * (1 + Math.cos((Math.PI * Math.min(t, totalSteps)) / totalSteps));
      const next = w.slice();
      for (let j = 0; j < PARAM_COUNT; j++) {
        const g = Number.isFinite(grad[j]) ? grad[j]! : 0;
        mom[j] = b1 * mom[j]! + (1 - b1) * g;
        vel[j] = b2 * vel[j]! + (1 - b2) * g * g;
        const mh = mom[j]! / (1 - b1 ** t);
        const vh = vel[j]! / (1 - b2 ** t);
        next[j] = w[j]! - (lr * mh) / (Math.sqrt(vh) + 1e-8);
      }
      w = clipToBounds(next);
      for (let j = 0; j < PARAM_COUNT; j++) probe[j] = w[j]!;
      opts.onProgress?.(Math.min(t, totalSteps), totalSteps);
    }
  }
  return w;
}

// ------------------------------------------------------------------ decision

export type OptimizeReason =
  /** Both log-loss and RMSE (bins) improved on the held-out reviews: adopted. */
  | 'better'
  /** At least one of them did not improve: the current parameters stay. */
  | 'not_better'
  /** Not enough reviews to compare reliably: nothing changed. */
  | 'too_few';

export interface OptimizeResult {
  adopted: boolean;
  reason: OptimizeReason;
  /** Parameters to store when adopted; otherwise the current ones. */
  params: number[];
  candidate: number[] | null;
  current: Metrics | null;
  next: Metrics | null;
  /** Relative drop of the held-out RMSE (bins), in percent (0 when not adopted). */
  accuracyGainPct: number;
  /** Expected reviews per day with the current and the new parameters (same retention). */
  workloadNow: number;
  workloadNext: number;
  reviews: number;
  trainItems: number;
  testItems: number;
}

export interface OptimizeInput {
  /** Stored params (null = ts-fsrs defaults). */
  current: readonly number[] | null;
  request_retention: number;
  daily_new_limit: number;
}

export type Trainer = (
  ds: ReviewDataset,
  start: readonly number[],
  include: (at: number) => boolean,
  opts: TrainOptions,
) => number[];

/** Pretrain the initial stabilities, then train every weight (the default trainer). */
export const defaultTrainer: Trainer = (ds, start, include, opts) =>
  trainParams(ds, pretrainInitialStability(start, ds, include), include, opts);

/**
 * Time-series split (oldest 80 % of the evaluable reviews train, the newest 20 % test), train,
 * and adopt only when the candidate beats the current parameters on BOTH log-loss and RMSE
 * (bins) of the held-out reviews. Never returns worse parameters than the current ones.
 */
export function optimizeParams(
  ds: ReviewDataset,
  input: OptimizeInput,
  opts: TrainOptions & { trainer?: Trainer } = {},
): OptimizeResult {
  const currentW = normalizeParams(input.current);
  const reviews = ds.rating.length;
  const workloadNow = workloadFor(ds, currentW, input);

  const times: number[] = [];
  for (let c = 0; c < cardCount(ds); c++) {
    for (let i = ds.cardStart[c]! + 1; i < ds.cardStart[c + 1]!; i++) {
      if (ds.day[i]! > ds.day[i - 1]!) times.push(ds.at[i]!);
    }
  }
  times.sort((a, b) => a - b);
  const cut = Math.floor(times.length * TRAIN_SHARE);
  const cutoff = times[cut] ?? Infinity;
  const isTrain = (at: number) => at < cutoff;
  const isTest = (at: number) => at >= cutoff;
  const trainItems = times.filter(isTrain).length;
  const testItems = times.length - trainItems;
  const keep = (reason: OptimizeReason, extra: Partial<OptimizeResult> = {}): OptimizeResult => ({
    adopted: false,
    reason,
    params: currentW,
    candidate: null,
    current: null,
    next: null,
    accuracyGainPct: 0,
    workloadNow,
    workloadNext: workloadNow,
    reviews,
    trainItems,
    testItems,
    ...extra,
  });
  if (testItems < MIN_TEST_ITEMS || trainItems < MIN_TEST_ITEMS) return keep('too_few');

  const trainer = opts.trainer ?? defaultTrainer;
  const raw = trainer(ds, currentW, isTrain, opts);
  const candidate = raw.length === PARAM_COUNT && raw.every(Number.isFinite) ? clipToBounds(raw) : null;
  const current = evaluate(currentW, ds, isTest);
  if (!candidate) return keep('not_better', { current });
  const next = evaluate(candidate, ds, isTest);
  if (!(next.logLoss < current.logLoss && next.rmseBins < current.rmseBins)) {
    return keep('not_better', { candidate, current, next });
  }
  return {
    adopted: true,
    reason: 'better',
    params: candidate,
    candidate,
    current,
    next,
    accuracyGainPct: current.rmseBins > 0 ? ((current.rmseBins - next.rmseBins) / current.rmseBins) * 100 : 0,
    workloadNow,
    workloadNext: workloadFor(ds, candidate, input),
    reviews,
    trainItems,
    testItems,
  };
}

/** Final memory state of every card under these weights. */
export function finalStabilities(w: readonly number[], ds: ReviewDataset): number[] {
  const m = model(w);
  const out: number[] = [];
  for (let c = 0; c < cardCount(ds); c++) {
    const st = walkCard(m, ds, c, null);
    if (st) out.push(st.stability);
  }
  return out;
}

function workloadFor(ds: ReviewDataset, w: readonly number[], input: OptimizeInput): number {
  return expectedDailyReviews(finalStabilities(w, ds), w, input.request_retention, input.daily_new_limit);
}

/** Whether to suggest a (new) run: enough reviews, and a month since the last one with new reviews since. */
export function shouldSuggest(args: {
  reviews: number;
  reviewsSinceLastRun: number;
  lastRunAt: number | null | undefined;
  now: number;
}): boolean {
  if (args.reviews < MIN_REVIEWS) return false;
  if (args.lastRunAt == null) return true;
  return args.now - args.lastRunAt >= REOPTIMIZE_AFTER_MS && args.reviewsSinceLastRun > 0;
}
