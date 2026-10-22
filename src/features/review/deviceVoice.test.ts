import { describe, expect, it, vi } from 'vitest';

const speakNative = vi.fn<(text: string, voice: string) => Promise<void>>();
vi.mock('@/native/tts', () => ({ speakNative: (t: string, v: string) => speakNative(t, v) }));
const speakEnglish = vi.fn(() => true);
vi.mock('./useSpeech', () => ({ speakEnglish: (...a: unknown[]) => speakEnglish(...(a as [])) }));

const { deviceVoice } = await import('./pronunciation');

describe('device voice (fallback after server audio)', () => {
  it('uses the phone’s TextToSpeech in the Android app, not speechSynthesis', async () => {
    speakNative.mockResolvedValue();
    const done = vi.fn();
    expect(deviceVoice('serendipity', 'en-GB', done, true)).toBe(true);
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(speakNative).toHaveBeenCalledWith('serendipity', 'en-GB');
    expect(speakEnglish).not.toHaveBeenCalled();
  });

  it('still finishes when the native engine fails', async () => {
    speakNative.mockRejectedValue(new Error('x'));
    const done = vi.fn();
    deviceVoice('word', 'en-US', done, true);
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  });

  it('keeps speechSynthesis on the web', () => {
    const done = vi.fn();
    expect(deviceVoice('word', 'en-US', done, false)).toBe(true);
    expect(speakEnglish).toHaveBeenCalledTimes(1);
  });
});
