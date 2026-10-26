/**
 * Timing budgets for the perf e2e tests (perf, images-perf, restore-perf; decision 0037).
 *
 * The numbers are measured inside the page (performance.now / performance.measure), so the
 * Playwright round trips and expect polling are never part of them. What remains on a busy
 * machine is real CPU contention: another test run, a build, other agents. So:
 *
 *   CI                 the real budget, always (factor 1).
 *   E2E_PERF_SLACK=n   locally: every bound × n (1 ≤ n ≤ 10), e.g. on a shared sandbox.
 *   E2E_PERF_SLACK=1   locally: the real budget.
 *   unset / auto       locally: × the machine's load (1-minute load average per CPU × 2,
 *                      between 1 and 4), so an idle machine gets the real budget and a
 *                      loaded one does not fail on contention.
 *
 * The factor and the reason are printed with every result; a test never skips.
 */
import { availableParallelism, loadavg } from 'node:os';
import type { Page } from '@playwright/test';

export interface Slack {
  factor: number;
  reason: string;
}

export function perfSlack(
  env: NodeJS.ProcessEnv = process.env,
  load = loadavg()[0]!,
  cpus = availableParallelism(),
): Slack {
  if (env.CI) return { factor: 1, reason: 'CI: real budget' };
  const v = env.E2E_PERF_SLACK?.trim();
  if (v && v !== 'auto') {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 1) return { factor: Math.min(n, 10), reason: `E2E_PERF_SLACK=${v}` };
    return { factor: 1, reason: `E2E_PERF_SLACK=${v} is not a number >= 1: real budget` };
  }
  const perCpu = load / Math.max(1, cpus);
  const factor = Math.round(Math.min(4, Math.max(1, perCpu * 2)) * 10) / 10;
  return { factor, reason: `load ${load.toFixed(2)} on ${cpus} CPUs` };
}

/** The larger of the slack at the start and now (the load rises while a suite runs). */
export function slackNow(start: Slack): Slack {
  const now = perfSlack();
  return now.factor > start.factor ? now : start;
}

/** A budget in ms under the slack (the bound a test asserts against). */
export const budget = (ms: number, s: Slack) => Math.round(ms * s.factor);

/**
 * Time from `trigger` until an enabled "Cevabı göster" is painted, measured in the page.
 * `at`: the page's own clock (ms since its navigation start) when it was painted, so a cold
 * load is timed from navigation start without the test's round trip.
 */
export async function timeFirstCard(
  page: Page,
  trigger: 'click' | 'none',
): Promise<{ ms: number; at: number }> {
  return page.evaluate(async (how) => {
    const ready = () => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.textContent?.trim() === 'Cevabı göster',
      );
      return !!b && !b.disabled && !!document.querySelector('[data-card-type]');
    };
    const t0 = performance.now();
    if (how === 'click') (document.querySelector('a[data-testid="start-study"]') as HTMLAnchorElement).click();
    await new Promise<void>((resolve) => {
      if (ready()) return resolve();
      const mo = new MutationObserver(() => {
        if (ready()) {
          mo.disconnect();
          resolve();
        }
      });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // painted
    const at = performance.now();
    return { ms: at - t0, at };
  }, trigger);
}

export const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
export const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.ceil(a.length * 0.95) - 1]!;
export const round1 = (n: number) => Math.round(n * 10) / 10;
