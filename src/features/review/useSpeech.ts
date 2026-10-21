// Text-to-speech through the browser's speechSynthesis, with the English voice from settings.
import { useCallback, useEffect, useState } from 'react';

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

export function useSpeech(pref: VoicePref) {
  const [voices, setVoices] = useState<readonly SpeechSynthesisVoice[]>(
    () => synth()?.getVoices() ?? [],
  );

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

  const voice = pickVoice(voices, pref);

  const speak = useCallback(
    (text: string) => {
      const s = synth();
      if (!s || !voice) return;
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 0.92;
      s.speak(u);
    },
    [voice],
  );

  return { available: voice !== null, speak };
}
