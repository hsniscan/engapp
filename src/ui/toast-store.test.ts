import { afterEach, describe, expect, it, vi } from 'vitest';
import { getToasts, resetToasts, setToastLimit, toast } from './toast-store';

afterEach(() => resetToasts());

describe('toast.undo', () => {
  it('queues a toast with a Geri al action that calls back', () => {
    const onUndo = vi.fn();
    toast.undo({ title: 'Kelime silindi', onUndo, undoLabel: 'Geri al' });
    const [t] = getToasts();
    expect(t?.title).toBe('Kelime silindi');
    expect(t?.duration).toBe(6000);
    expect(t?.action?.label).toBe('Geri al');
    expect(t?.action?.altText).toBe('Geri al: Kelime silindi');
    t?.action?.onClick();
    expect(onUndo).toHaveBeenCalledOnce();
  });
});

describe('setToastLimit', () => {
  it('shows one toast at a time while set, then three again', () => {
    toast('a');
    toast('b');
    const restore = setToastLimit(1);
    expect(getToasts().map((t) => t.title)).toEqual(['b']);
    toast('c');
    expect(getToasts().map((t) => t.title)).toEqual(['c']);
    restore();
    toast('d');
    toast('e');
    expect(getToasts().map((t) => t.title)).toEqual(['c', 'd', 'e']);
  });
});
