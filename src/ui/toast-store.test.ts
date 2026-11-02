import { afterEach, describe, expect, it, vi } from 'vitest';
import { getToasts, resetToasts, toast } from './toast-store';

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
