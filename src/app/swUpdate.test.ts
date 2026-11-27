import { describe, expect, it, vi } from 'vitest';
import {
  activateWaitingAndReload,
  RELOAD_FALLBACK_MS,
  UPDATE_INTERVAL_MS,
  UPDATE_MIN_GAP_MS,
  watchForUpdates,
} from './swUpdate';

function fakeContainer() {
  const listeners = new Set<() => void>();
  return {
    addEventListener: vi.fn((_: string, fn: () => void) => void listeners.add(fn)),
    removeEventListener: vi.fn((_: string, fn: () => void) => void listeners.delete(fn)),
    fire: () => [...listeners].forEach((fn) => fn()),
  };
}

function setup() {
  const container = fakeContainer();
  const timers: { fn: () => void; ms: number }[] = [];
  const reload = vi.fn();
  const deps = {
    container: container as never,
    reload,
    setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
  };
  return { container, timers, reload, deps };
}

describe('Yenile activates the waiting service worker', () => {
  it('sends SKIP_WAITING and reloads once the new worker takes control', () => {
    const { container, reload, deps } = setup();
    const waiting = { postMessage: vi.fn() };
    activateWaitingAndReload({ waiting } as never, deps);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    container.fire();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads after a timeout when the worker never takes over, and only once', () => {
    const { container, timers, reload, deps } = setup();
    activateWaitingAndReload({ waiting: { postMessage: vi.fn() } } as never, deps);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(RELOAD_FALLBACK_MS);
    timers[0]!.fn();
    expect(reload).toHaveBeenCalledTimes(1);
    container.fire();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads at once when nothing is waiting', () => {
    const { container, reload, deps } = setup();
    activateWaitingAndReload({ waiting: null } as never, deps);
    activateWaitingAndReload(undefined, deps);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(container.addEventListener).not.toHaveBeenCalled();
  });
});

describe('looking for a new version', () => {
  function watch() {
    const update = vi.fn(() => Promise.resolve());
    let visibility: DocumentVisibilityState = 'visible';
    let onVisibility: (() => void) | null = null;
    const intervals: { fn: () => void; ms: number }[] = [];
    let now = 1_000_000;
    watchForUpdates({ waiting: null, update } as never, {
      doc: {
        addEventListener: ((_: string, fn: () => void) => (onVisibility = fn)) as never,
        get visibilityState() {
          return visibility;
        },
      },
      setInterval: (fn, ms) => intervals.push({ fn, ms }),
      now: () => now,
    });
    return {
      update,
      intervals,
      show: (v: DocumentVisibilityState) => {
        visibility = v;
        onVisibility?.();
      },
      advance: (ms: number) => (now += ms),
    };
  }

  it('checks on startup and every hour', () => {
    const w = watch();
    expect(w.update).toHaveBeenCalledTimes(1);
    expect(w.intervals[0]!.ms).toBe(UPDATE_INTERVAL_MS);
    w.intervals[0]!.fn();
    expect(w.update).toHaveBeenCalledTimes(2);
  });

  it('checks when the app comes back to the foreground, at most once a minute', () => {
    const w = watch();
    w.advance(UPDATE_MIN_GAP_MS - 1);
    w.show('visible');
    expect(w.update).toHaveBeenCalledTimes(1);
    w.advance(10 * 60_000);
    w.show('hidden');
    expect(w.update).toHaveBeenCalledTimes(1);
    w.show('visible');
    expect(w.update).toHaveBeenCalledTimes(2);
  });

  it('a failed check (offline) is ignored', async () => {
    const update = vi.fn(() => Promise.reject(new Error('offline')));
    expect(() =>
      watchForUpdates({ waiting: null, update } as never, {
        doc: { addEventListener: () => {}, visibilityState: 'visible' } as never,
        setInterval: () => 0,
        now: () => 0,
      }),
    ).not.toThrow();
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
