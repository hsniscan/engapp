// The voices of the hands-free round (v0.5 İP9, ADR 0051). English goes through the app's
// pronunciation path (memory → Cache Storage → the pre-generated MP3 → the tts function → the
// device voice, ADR 0042), so a word heard before plays offline. Turkish meanings have no
// pre-generated audio: the device's Turkish voice reads them (speechSynthesis on the web, the
// phone's TextToSpeech in the app). With no Turkish voice the meaning is only shown.
import { playPronunciation, stopPronunciation } from '@/features/review/pronunciation';
import type { VoicePref } from '@/features/review/useSpeech';
import { isNativeApp } from '@/native/platform';

/** How long a Turkish utterance may take to start before it is skipped. */
const START_TIMEOUT_MS = 2500;
/** A silent stand-in for a meaning that cannot be spoken: time to read it. */
const READ_MS = 1800;

export interface HandsFreeVoice {
  english(text: string, voice: VoicePref, onDone: () => void): void;
  turkish(text: string, onDone: () => void): void;
  stop(): void;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

function turkishVoice(s: SpeechSynthesis): SpeechSynthesisVoice | null {
  const tr = s.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('tr'));
  return tr.find((v) => v.localService) ?? tr[0] ?? null;
}

let current: SpeechSynthesisUtterance | null = null;

function speakTurkishWeb(text: string, onDone: () => void): void {
  const s = synth();
  if (!s) {
    window.setTimeout(onDone, READ_MS);
    return;
  }
  let done = false;
  let started = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (current === u) current = null;
    onDone();
  };
  const u = new SpeechSynthesisUtterance(text);
  const v = turkishVoice(s);
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'tr-TR';
  u.rate = 0.95;
  u.onstart = () => {
    started = true;
  };
  u.onend = finish;
  u.onerror = finish;
  if (s.speaking || s.pending) s.cancel();
  current = u; // a reference keeps Chrome firing its events
  s.speak(u);
  window.setTimeout(() => {
    if (!started && !done && !s.speaking) {
      s.cancel();
      finish();
    }
  }, START_TIMEOUT_MS);
}

export const handsFreeVoice: HandsFreeVoice = {
  english(text, voice, onDone) {
    if (!playPronunciation(text, voice, { onDone })) onDone();
  },
  turkish(text, onDone) {
    if (!isNativeApp()) return speakTurkishWeb(text, onDone);
    void import('@/native/tts')
      .then((m) => m.speakNativeTurkish(text))
      .then((ok) => (ok ? onDone() : void window.setTimeout(onDone, READ_MS)))
      .catch(() => onDone());
  },
  stop() {
    stopPronunciation();
    synth()?.cancel();
    if (isNativeApp()) void import('@/native/tts').then((m) => m.stopNative()).catch(() => {});
  },
};
