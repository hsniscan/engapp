import { describe, expect, it, vi } from 'vitest';
import type { WordBankFetchOutcome } from './fetcher';
import { mayPrefetch, startWordBankPrefetch, type PrefetchDeps, type PrefetchEnv } from './prefetch';

describe('mayPrefetch', () => {
  it('online on an unmetered connection (or one the browser does not describe)', () => {
    expect(mayPrefetch({ online: true, connection: null })).toBe(true);
    expect(mayPrefetch({ online: true, connection: { type: 'wifi', effectiveType: '4g' } })).toBe(true);
  });

  it('never offline, on data saver, on mobile data or a very slow line', () => {
    expect(mayPrefetch({ online: false, connection: null })).toBe(false);
    expect(mayPrefetch({ online: true, connection: { saveData: true } })).toBe(false);
    expect(mayPrefetch({ online: true, connection: { type: 'cellular' } })).toBe(false);
    expect(mayPrefetch({ online: true, connection: { effectiveType: '2g' } })).toBe(false);
  });
});

function deps(over: Partial<PrefetchDeps> & { env?: () => PrefetchEnv } = {}) {
  let online: (() => void) | null = null;
  const d: PrefetchDeps = {
    env: () => ({ online: true, connection: null }),
    complete: async () => true,
    fetch: vi.fn(async (): Promise<WordBankFetchOutcome> => ({ status: 'done', stored: 10, removed: 0 })),
    onOnline: (retry) => {
      online = retry;
      return () => {
        online = null;
      };
    },
    ...over,
  };
  return { d, goOnline: () => online?.() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('startWordBankPrefetch', () => {
  it('fetches once and stops listening when the bank is complete', async () => {
    const { d, goOnline } = deps();
    startWordBankPrefetch(d);
    await flush();
    expect(d.fetch).toHaveBeenCalledTimes(1);
    goOnline();
    await flush();
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it('offline first: waits, then fetches when the device comes back online', async () => {
    let on = false;
    const { d, goOnline } = deps({ env: () => ({ online: on, connection: null }) });
    startWordBankPrefetch(d);
    await flush();
    expect(d.fetch).not.toHaveBeenCalled();
    on = true;
    goOnline();
    await flush();
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it('a run cut short is tried again on the next online event (it resumes from its cursor)', async () => {
    let complete = false;
    const { d, goOnline } = deps({
      complete: async () => complete,
      fetch: vi.fn(async (): Promise<WordBankFetchOutcome> => ({ status: 'failed', error: 'x' })),
    });
    startWordBankPrefetch(d);
    await flush();
    complete = true;
    goOnline();
    await flush();
    expect(d.fetch).toHaveBeenCalledTimes(2);
  });

  it('never on mobile data', async () => {
    const { d } = deps({ env: () => ({ online: true, connection: { type: 'cellular' } }) });
    startWordBankPrefetch(d);
    await flush();
    expect(d.fetch).not.toHaveBeenCalled();
  });
});
