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

/** What the browser does on Back: the entry below becomes current, then popstate. */
function browserBack(state: unknown) {
  window.history.replaceState(state, '');
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
}

describe('startWebBack', () => {
  let stop: () => void;
  let go: ReturnType<typeof vi.spyOn>;
  const page = { idx: 3, key: 'k' };

  beforeEach(() => {
    window.history.replaceState(page, '');
    go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    stop = startWebBack({ subscribe: () => () => {} });
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
    expect(window.history.state).toMatchObject(page);
    expect(overlayDepth(window.history.state)).toBe(1);
  });

  it('closes the top overlay on Back instead of leaving the page', async () => {
    const dialog = openDialog();
    await tick();
    const escape = vi.fn();
    dialog.addEventListener('keydown', (e) => e.key === 'Escape' && escape());
    dialog.tabIndex = -1;
    dialog.focus();
    browserBack(page);
    expect(escape).toHaveBeenCalledOnce();
    dialog.remove();
    await tick();
    expect(go).not.toHaveBeenCalled();
  });

  it('never moves history when the dialog is closed another way (×)', async () => {
    const dialog = openDialog();
    await tick();
    dialog.dataset.state = 'closed';
    await tick();
    expect(go).not.toHaveBeenCalled();
  });

  it('a later Back over a closed dialog’s entry goes on and leaves the page', async () => {
    const dialog = openDialog();
    await tick();
    dialog.remove();
    await tick();
    browserBack(page); // took off the leftover entry: same page, nothing open
    expect(go).toHaveBeenCalledWith(-1);
  });

  it('Back from a page opened inside the sheet lands on the page, not its leftover', async () => {
    const dialog = openDialog();
    await tick();
    dialog.remove();
    // The router pushed the new page (idx 4); its subscribers fire.
    stop();
    window.history.replaceState({ idx: 4, key: 'n' }, '');
    stop = startWebBack({ subscribe: () => () => {} });
    browserBack({ ...page, engappOverlay: 1 });
    expect(go).toHaveBeenCalledWith(-1);
  });
});
