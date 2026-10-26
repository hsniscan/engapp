import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/router', () => ({ router: { navigate: vi.fn() } }));
const { openPath, openProcessText } = await import('./quick');
const { bootedAsQuickHost, closeQuick, continueInApp, isQuickHost } = await import('./quickHost');

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

describe('Android selection menu → /quick', () => {
  it('opens the sheet on the selection, once per intent (cold start and onNewIntent)', () => {
    const navigate = vi.fn();
    const intent = { id: '1-1', text: 'serendipity', readonly: true };
    openProcessText(intent, navigate);
    openProcessText(intent, navigate); // the retained event delivered again
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/quick?text=serendipity', { replace: true });
    openProcessText({ id: '2-1', text: 'give up', readonly: false }, navigate);
    expect(navigate).toHaveBeenLastCalledWith('/quick?text=give+up', { replace: true });
  });

  it('the main app opens only reader and add-form addresses handed over by the sheet', () => {
    const navigate = vi.fn();
    openPath({ id: 'p1', path: '/oku/0192f3a0-1b2c-7d4e-8f90-123456789abc' }, navigate);
    openPath({ id: 'p1', path: '/oku/0192f3a0-1b2c-7d4e-8f90-123456789abc' }, navigate);
    openPath({ id: 'p2', path: '/settings/hesap' }, navigate);
    openPath({ id: 'p3', path: '/add?term=serendipity' }, navigate);
    expect(navigate.mock.calls).toEqual([
      ['/oku/0192f3a0-1b2c-7d4e-8f90-123456789abc'],
      ['/add?term=serendipity'],
    ]);
  });
});

describe('quick host (web build)', () => {
  it('only the native app started on /quick is the see-through sheet', () => {
    expect(bootedAsQuickHost({ pathname: '/quick' }, true)).toBe(true);
    expect(bootedAsQuickHost({ pathname: '/' }, true)).toBe(false);
    expect(bootedAsQuickHost({ pathname: '/quick' }, false)).toBe(false);
  });

  it('in the browser closing and handing over fall back to navigation', async () => {
    expect(await isQuickHost()).toBe(false);
    const back = vi.fn();
    await closeQuick(back);
    expect(back).toHaveBeenCalledTimes(1);
    const go = vi.fn();
    await continueInApp({ path: '/oku/x' }, go);
    expect(go).toHaveBeenCalledTimes(1);
  });
});
