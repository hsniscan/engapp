import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastSpy = vi.fn();
vi.mock('@/ui', () => ({ toast: (o: unknown) => toastSpy(o) }));

import { START_TIMEOUT_MS, speakEnglish } from './useSpeech';

class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = '';
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeSynth(voices: Partial<SpeechSynthesisVoice>[], behaviour: 'speaks' | 'silent') {
  const spoken: FakeUtterance[] = [];
  const s = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => voices as SpeechSynthesisVoice[],
    cancel: vi.fn(() => {
      s.speaking = false;
    }),
    resume: vi.fn(),
    speak: vi.fn((u: FakeUtterance) => {
      spoken.push(u);
      if (behaviour === 'speaks') {
        s.speaking = true;
        u.onstart?.();
      }
    }),
  };
  return { s, spoken };
}

describe('speakEnglish (mobile-safe TTS)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    toastSpy.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // jsdom has no speechSynthesis by default
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it('speaks with only a language when the phone lists no voices (Android Chrome)', () => {
    const { s, spoken } = fakeSynth([], 'speaks');
    Object.defineProperty(window, 'speechSynthesis', { value: s, configurable: true });
    expect(speakEnglish('reluctant', 'en-US')).toBe(true);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.lang).toBe('en-US');
    expect(spoken[0]!.voice).toBeNull();
    expect(s.cancel).not.toHaveBeenCalled();
  });

  it('uses the matching English voice when one is listed', () => {
    const v = { lang: 'en_GB', localService: true, name: 'UK' };
    const { s, spoken } = fakeSynth([{ lang: 'tr-TR', localService: true }, v], 'speaks');
    Object.defineProperty(window, 'speechSynthesis', { value: s, configurable: true });
    speakEnglish('flat', 'en-GB');
    expect(spoken[0]!.voice).toBe(v);
  });

  it('cancels a playing utterance and speaks the new one on the next tick', () => {
    const { s, spoken } = fakeSynth([], 'speaks');
    s.speaking = true;
    Object.defineProperty(window, 'speechSynthesis', { value: s, configurable: true });
    speakEnglish('second', 'en-US');
    expect(s.cancel).toHaveBeenCalledOnce();
    expect(spoken).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(spoken.map((u) => u.text)).toEqual(['second']);
  });

  it('tells the user how to fix it when nothing starts', () => {
    const { s } = fakeSynth([], 'silent');
    Object.defineProperty(window, 'speechSynthesis', { value: s, configurable: true });
    const onDone = vi.fn();
    speakEnglish('word', 'en-US', { onDone });
    vi.advanceTimersByTime(START_TIMEOUT_MS + 10);
    expect(toastSpy).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('returns false without a speech API', () => {
    expect(speakEnglish('word', 'en-US')).toBe(false);
  });
});
