import { beforeEach, describe, expect, it, vi } from 'vitest';

const speak = vi.fn<(o: { text: string; lang: string }) => Promise<void>>();
vi.mock('@capacitor-community/text-to-speech', () => ({
  QueueStrategy: { Flush: 0, Add: 1 },
  TextToSpeech: { speak: (o: { text: string; lang: string }) => speak(o) },
}));
const toast = vi.fn();
vi.mock('@/ui', () => ({ toast: (...a: unknown[]) => toast(...a) }));

const { speakNative, resetNativeTtsForTesting } = await import('./tts');

describe('native device voice', () => {
  beforeEach(() => {
    speak.mockReset();
    toast.mockReset();
    resetNativeTtsForTesting();
  });

  it('speaks in the chosen accent', async () => {
    speak.mockResolvedValue();
    await speakNative('serendipity', 'en-GB');
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0]![0]).toMatchObject({ text: 'serendipity', lang: 'en-GB' });
    expect(toast).not.toHaveBeenCalled();
  });

  it('falls back to the US voice when British voice data is missing', async () => {
    speak.mockRejectedValueOnce(new Error('not supported')).mockResolvedValueOnce();
    await speakNative('lorry', 'en-GB');
    expect(speak.mock.calls.map((c) => c[0].lang)).toEqual(['en-GB', 'en-US']);
    expect(toast).not.toHaveBeenCalled();
  });

  it('explains how to fix the phone when nothing can speak, and still resolves', async () => {
    speak.mockRejectedValue(new Error('no engine'));
    await expect(speakNative('word', 'en-US')).resolves.toBeUndefined();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
