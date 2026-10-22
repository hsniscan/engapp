import { describe, expect, it } from 'vitest';
import { isRestoreRunning, subscribeRestoreRunning, whileRestoring } from './restoreState';

describe('restore running flag', () => {
  it('is set while a restore runs, also when it throws, and notifies on start and end', async () => {
    const seen: boolean[] = [];
    const off = subscribeRestoreRunning(() => seen.push(isRestoreRunning()));
    expect(isRestoreRunning()).toBe(false);
    await whileRestoring(async () => {
      expect(isRestoreRunning()).toBe(true);
      await whileRestoring(async () => expect(isRestoreRunning()).toBe(true));
      expect(isRestoreRunning()).toBe(true);
    });
    await expect(whileRestoring(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(isRestoreRunning()).toBe(false);
    expect(seen).toEqual([true, false, true, false]);
    off();
  });
});
