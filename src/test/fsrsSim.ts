// Synthetic review histories for optimizer tests: cards answered by a simulated learner whose
// memory follows FSRS with `trueW`, scheduled by a scheduler that uses `schedW`.
import {
  type DatasetLog,
  type MemoryState,
  nextMemoryState,
  prng,
  recallProbability,
} from '../domain/fsrsOptimizer';
import { intervalDays } from '../domain/workload';

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 0, 1, 9);

export interface SimOptions {
  cards: number;
  trueW: readonly number[];
  schedW: readonly number[];
  days?: number;
  seed?: number;
  retention?: number;
}

export function simulateLogs(o: SimOptions): DatasetLog[] {
  const rand = prng(o.seed ?? 7);
  const days = o.days ?? 365;
  const retention = o.retention ?? 0.9;
  const logs: DatasetLog[] = [];
  for (let c = 0; c < o.cards; c++) {
    const id = `card-${String(c).padStart(5, '0')}`;
    let day = Math.floor(rand() * days * 0.6);
    let truth: MemoryState | null = null;
    let sched: MemoryState | null = null;
    let lastDay = day;
    const answer = (g: number, d: number, minute: number) => {
      const t = truth ? d - lastDay : 0;
      truth = nextMemoryState(o.trueW, truth, t, g);
      sched = nextMemoryState(o.schedW, sched, t, g);
      lastDay = d;
      logs.push({ card_id: id, rating: g, reviewed_at: T0 + d * DAY + minute * 60_000 });
    };
    // First sight: mostly Good, sometimes Again/Hard/Easy; then same-day learning steps.
    const u = rand();
    const first = u < 0.2 ? 1 : u < 0.3 ? 2 : u < 0.9 ? 3 : 4;
    answer(first, day, 0);
    if (first <= 2) answer(3, day, 10);
    while (true) {
      const ivl = intervalDays(o.schedW, sched!.stability, retention);
      day += ivl;
      if (day >= days) break;
      const p = recallProbability(o.trueW, day - lastDay, truth!.stability);
      if (rand() < p) {
        const v = rand();
        answer(v < 0.1 ? 2 : v < 0.95 ? 3 : 4, day, 0);
      } else {
        answer(1, day, 0);
        answer(3, day, 10); // relearning step
      }
    }
  }
  return logs;
}
