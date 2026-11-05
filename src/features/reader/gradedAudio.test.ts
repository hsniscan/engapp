// The library's recorded sentences in the reader's accent (decision 0073).
import { describe, expect, it } from 'vitest';
import { ttsObjectPath } from '../../../supabase/functions/_shared/tts-contract';
import { gradedClipUrls, voicedClipKey } from './gradedAudio';

const from = { audioBaseUrl: 'https://audio.example.com', supabaseUrl: null };

describe('graded clips', () => {
  it('turns a key into its addresses, and several keys into all of them in order', () => {
    expect(gradedClipUrls('en-US/abc.mp3', from)).toEqual(['https://audio.example.com/en-US/abc.mp3']);
    expect(gradedClipUrls('en-GB/def.mp3 en-US/abc.mp3', from)).toEqual([
      'https://audio.example.com/en-GB/def.mp3',
      'https://audio.example.com/en-US/abc.mp3',
    ]);
    expect(gradedClipUrls('  ', from)).toEqual([]);
    expect(gradedClipUrls('../x.mp3 en-US/abc.mp3', from)).toEqual(['https://audio.example.com/en-US/abc.mp3']);
  });

  it('plays the British clip first for a British voice, then the stored en-US one', async () => {
    const row = { en: 'The train was late.', audio_key: 'en-US/abc.mp3' };
    expect(await voicedClipKey(row, 'en-US')).toBe('en-US/abc.mp3');
    expect(await voicedClipKey(row, 'en-GB')).toBe(
      `${await ttsObjectPath('en-GB', 'The train was late.')} en-US/abc.mp3`,
    );
    expect(await voicedClipKey({ en: 'x', audio_key: null }, 'en-GB')).toBeNull();
  });
});
