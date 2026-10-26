// Device voice in the Android app (docs/decisions/0028-server-tts.md, 0033-android-capacitor.md).
// Server audio stays first (src/features/review/pronunciation.ts); this replaces the browser's
// speechSynthesis as the fallback, because Android's WebView has no usable speechSynthesis. It
// speaks with the phone's TextToSpeech engine, which works offline once English voice data is
// installed (it is on most phones).
import { QueueStrategy, TextToSpeech } from '@capacitor-community/text-to-speech';
import i18n from '@/i18n';
import { toast } from '@/ui';

export type NativeVoice = 'en-US' | 'en-GB';

let lastFailureToast = 0;

function reportFailure(now = Date.now()) {
  if (now - lastFailureToast < 10_000) return;
  lastFailureToast = now;
  toast({
    title: i18n.t('review.voiceFailed'),
    description: i18n.t('review.voiceFailedHelp'),
    tone: 'danger',
    duration: 10_000,
  });
}

/** Speaks `text` in the accent; resolves when done or failed (failure shows the help toast). */
export async function speakNative(text: string, voice: NativeVoice, rate = 0.92): Promise<void> {
  const say = (lang: string) =>
    TextToSpeech.speak({ text, lang, rate, queueStrategy: QueueStrategy.Flush });
  try {
    await say(voice);
  } catch {
    // A phone without the British voice data still reads English: try the US voice once.
    try {
      if (voice === 'en-GB') await say('en-US');
      else throw new Error('no English voice');
    } catch {
      reportFailure();
    }
  }
}

/** For tests. */
export function resetNativeTtsForTesting(): void {
  lastFailureToast = 0;
}
