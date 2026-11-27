import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { overlayDepth, startWebBack } from './webBack';

const tick = () => new Promise((r) => setTimeout(r, 5));

function openDialog(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  el.dataset.state = 'open';
  document.body.append(el);
  return el;
}

describe('startWebBack', () => {
  let stop: () => void;
  let navigating = false;
  let go: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    navigating = false;
    window.history.replaceState({ idx: 3, key: 'k' }, '');
    go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    stop = startWebBack({ navigating: () => navigating, subscribe: () => () => {} });
  });
  afterEach(() => {
    stop();
    go.mockRestore();
    document.body.innerHTML = '';
  });

  it('pushes one entry for the same page when a dialog opens, keeping the router state', async () => {
    const before = window.history.length;
    openDialog();
    await tick();
    expect(window.history.length).toBe(before + 1);
    expect(window.history.state).toMatchObject({ idx: 3, key: 'k' });
    expect(overlayDepth(window.history.state)).toBe(1);
  });

  it('closes the top overlay on Back instead of leaving the page', async () => {
    const dialog = openDialog();
    await tick();
    const escape = vi.fn();
    dialog.addEventListener('keydown', (e) => e.key === 'Escape' && escape());
    dialog.tabIndex = -1;
    dialog.focus();
    // The browser popped our entry: the page's own entry is current again.
    window.history.replaceState({ idx: 3, key: 'k' }, '');
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    expect(escape).toHaveBeenCalledOnce();
    dialog.remove();
    await tick();
    expect(go).not.toHaveBeenCalled();
  });

  it('takes its entry off when the dialog is closed another way (×)', async () => {
    const dialog = openDialog();
    await tick();
    dialog.dataset.state = 'closed';
    await tick();
    expect(go).toHaveBeenCalledWith(-1);
  });

  it('leaves history alone when the close comes with a navigation', async () => {
    const dialog = openDialog();
    await tick();
    navigating = true;
    dialog.remove();
    await tick();
    expect(go).not.toHaveBeenCalled();
  });
});
