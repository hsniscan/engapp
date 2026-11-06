// The recorded clip of each library sentence in the reader's accent (decision 0073). The en-US
// keys are stored with the text, so they are ready at once; the British paths are hashed from
// the sentences (Web Crypto), and until that finishes the stored en-US clips are used.
import { useEffect, useMemo, useState } from 'react';
import type { TtsVoice } from '../../../supabase/functions/_shared/tts-contract';
import { voicedClipKey } from './gradedAudio';

type Row = { en: string; audio_key: string | null } | null;

export function useVoicedClips(rows: readonly Row[] | null, voice: TtsVoice): (string | null)[] | null {
  const stored = useMemo(() => rows?.map((r) => r?.audio_key ?? null) ?? null, [rows]);
  const [voiced, setVoiced] = useState<{ rows: readonly Row[]; voice: TtsVoice; keys: (string | null)[] } | null>(null);
  useEffect(() => {
    if (!rows || voice === 'en-US') return;
    let live = true;
    void Promise.all(rows.map((r) => (r ? voicedClipKey(r, voice) : Promise.resolve(null)))).then(
      (keys) => {
        if (live) setVoiced({ rows, voice, keys });
      },
      () => undefined, // no Web Crypto: the stored en-US clips stay
    );
    return () => {
      live = false;
    };
  }, [rows, voice]);
  if (voiced && voiced.rows === rows && voiced.voice === voice) return voiced.keys;
  return stored;
}
