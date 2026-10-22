import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeTopOverlay, decideBack, historyIndex, overlayOpen } from './backButton';

describe('decideBack', () => {
  it('closes an open sheet before anything else, even on the home screen', () => {
    expect(decideBack({ overlayOpen: true, path: '/', canGoBack: false })).toBe('close-overlay');
    expect(decideBack({ overlayOpen: true, path: '/library', canGoBack: true })).toBe(
      'close-overlay',
    );
  });

  it('leaves the app only from the home screen', () => {
    expect(decideBack({ overlayOpen: false, path: '/', canGoBack: true })).toBe('exit');
    expect(decideBack({ overlayOpen: false, path: '/', canGoBack: false })).toBe('exit');
  });

  it('goes back in the history on other screens', () => {
    expect(decideBack({ overlayOpen: false, path: '/settings', canGoBack: true })).toBe('back');
  });

  it('goes home from a screen opened without history (share, notification)', () => {
    expect(decideBack({ overlayOpen: false, path: '/share', canGoBack: false })).toBe('home');
    expect(decideBack({ overlayOpen: false, path: '/review', canGoBack: false })).toBe('home');
  });
});

describe('overlays', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sees an open Radix dialog or menu, not a closed one', () => {
    document.body.innerHTML = '<div role="dialog" data-state="closed"></div>';
    expect(overlayOpen()).toBe(false);
    document.body.innerHTML = '<div role="dialog" data-state="open"></div>';
    expect(overlayOpen()).toBe(true);
    document.body.innerHTML = '<div role="menu" data-state="open"></div>';
    expect(overlayOpen()).toBe(true);
  });

  it('closes with an Escape keydown that reaches the document', () => {
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    closeTopOverlay();
    document.removeEventListener('keydown', seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect((seen.mock.calls[0]![0] as KeyboardEvent).key).toBe('Escape');
  });
});

describe('historyIndex', () => {
  it('reads react-router’s idx and defaults to 0', () => {
    expect(historyIndex({ idx: 3, key: 'x' })).toBe(3);
    expect(historyIndex(null)).toBe(0);
    expect(historyIndex({})).toBe(0);
  });
});
