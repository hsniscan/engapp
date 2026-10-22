// Read-aloud. `speak` plays server audio through playPronunciation (pronunciation.ts,
// docs/decisions/0028-server-tts.md); the browser's speechSynthesis below is its fallback.
//
// Text-to-speech through the browser's speechSynthesis, with the English voice from settings.
//
// Mobile browsers need extra care (decision: fix/mobile-tts):
// - Android Chrome often lists no voices (getVoices() stays empty, voiceschanged may never fire)
//   although the system engine speaks fine when only `lang` is set. So "available" means the API
//   exists, and an utterance without a matching voice is still spoken with `lang`.
// - cancel() immediately followed by speak() drops the new utterance on some Android versions,
//   so we only cancel when something is playing and then speak on the next tick.
// - Chrome can stay "paused" after the tab was in the background; resume() first.
// - Chrome stops firing events for an utterance that was garbage-collected; keep a reference.
// - When nothing starts (no TTS engine or no English data on the phone), tell the user how to fix it.
import { useCallback, useEffect, useState } from 'react';

import i18n from '@/i18n';
import { toast } from '@/ui';

import { playPronunciation, pronunciationSupported } from './pronunciation';

export type VoicePref = 'en-US' | 'en-GB';

const norm = (lang: string) => lang.replace('_', '-').toLowerCase();

/** Best English voice: exact accent on-device, then exact accent, then any on-device English. */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  pref: VoicePref,
): SpeechSynthesisVoice | null {
  const want = pref.toLowerCase();
  const en = voices.filter((v) => norm(v.lang).startsWith('en'));
  return (
    en.find((v) => norm(v.lang) === want && v.localService) ??
    en.find((v) => norm(v.lang) === want) ??
    en.find((v) => v.localService) ??
    en[0] ??
    null
  );
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null;
}

/** True when the browser has a speech API at all (voices may still be loading or unlisted). */
export function speechSupported(): boolean {
  return synth() !== null;
}

/** How long an utterance may take to start before we assume the device cannot speak. */
export const START_TIMEOUT_MS = 2500;

let current: SpeechSynthesisUtterance | null = null;
let lastFailureToast = 0;

function reportFailure() {
  const now = Date.now();
  if (now - lastFailureToast < 10_000) return;
  lastFailureToast = now;
  toast({
    title: i18n.t('review.voiceFailed'),
    description: i18n.t('review.voiceFailedHelp'),
    tone: 'danger',
    duration: 10_000,
  });
}

export interface SpeakOptions {
  rate?: number;
  /** Called once when the utterance ends, fails or is replaced. */
  onDone?: () => void;
}

/** Speaks English text. Returns false when the browser has no speech API. */
export function speakEnglish(text: string, pref: VoicePref, opts: SpeakOptions = {}): boolean {
  const s = synth();
  if (!s || !text.trim()) return false;

  // Re-read the voice list on every tap: on mobile it often fills in after the first render.
  const voice = pickVoice(s.getVoices(), pref);
  const u = new SpeechSynthesisUtterance(text);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = pref;
  }
  u.rate = opts.rate ?? 0.92;

  let started = false;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (current === u) current = null;
    opts.onDone?.();
  };
  u.onstart = () => {
    started = true;
  };
  u.onend = finish;
  u.onerror = (e) => {
    finish();
    if (e.error !== 'canceled' && e.error !== 'interrupted') reportFailure();
  };

  const busy = s.speaking || s.pending;
  if (busy) s.cancel();
  if (s.paused) s.resume();
  current = u;
  const go = () => {
    if (current !== u) return; // a newer tap replaced it
    s.speak(u);
    window.setTimeout(() => {
      if (!started && !done && current === u && !s.speaking) {
        s.cancel();
        finish();
        reportFailure();
      }
    }, START_TIMEOUT_MS);
  };
  // Speak inside the tap when nothing was playing (iOS wants the first utterance in the gesture).
  if (busy) window.setTimeout(go, 60);
  else go();
  return true;
}

export function useSpeech(pref: VoicePref) {
  // Kept so the hook re-renders when voices arrive (the voice itself is picked per tap).
  const [, setVoices] = useState<readonly SpeechSynthesisVoice[]>(() => synth()?.getVoices() ?? []);

  useEffect(() => {
    const s = synth();
    if (!s) return;
    const update = () => setVoices(s.getVoices());
    update();
    s.addEventListener?.('voiceschanged', update);
    return () => {
      s.removeEventListener?.('voiceschanged', update);
      s.cancel();
    };
  }, []);

  const speak = useCallback((text: string) => void playPronunciation(text, pref), [pref]);

  return { available: pronunciationSupported(), speak };
}
