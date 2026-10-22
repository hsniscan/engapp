# 0028 — Server pronunciation audio (tts)

**Context.** Read-aloud used the browser's `speechSynthesis`. On some Android phones it stays
silent even after the fix in `fix/mobile-tts` (speak with `lang` only, error toast) and even
with a TTS engine and English voice data installed. Device speech is outside our control, so
pronunciation moves to audio files that an ordinary `<audio>` element plays, which works on
every phone.

**Decision.**

- New edge function `tts` (`supabase/functions/tts`, `verify_jwt = false`, JWT checked inside
  like the `ai-*` functions). Request `{text, voice: 'en-US' | 'en-GB'}`; contract and
  normalisation (NFC, whitespace folded, ≤ 300 chars, at least one Latin letter) in
  `_shared/tts-contract.ts`, shared with the client.
- **Model:** Gemini TTS through `generateContent` with `responseModalities: ["AUDIO"]` and a
  prebuilt voice. `GEMINI_TTS_MODEL` (default `gemini-3.8-flash-tts`) with
  `GEMINI_TTS_FALLBACK_MODEL` (default `gemini-3.8-flash-lite-tts`) on quota errors. Both are
  on the free tier (Oct 2026), and TTS models have their own quota, separate from the text
  models that `ai-*` use. Names are configuration only (workflow variables → function secrets);
  the code defaults are a fallback, like `DEFAULT_GEMINI_MODEL`.
- **Voices/prompt:** prebuilt voices `Iapetus` (US) and `Erinome` (GB), both "Clear"
  (overridable: `GEMINI_TTS_VOICE_US` / `_GB`). Prebuilt voices take their accent from the
  prompt, so the prompt is a short neutral direction plus the text:
  `Say clearly, in a natural British English accent: <text>`.
- **Audio:** 3.8 TTS models answer a WAV (24 kHz, 16-bit, mono); older ones raw PCM
  (`audio/L16;rate=24000`). `_shared/wav.ts` passes a WAV through and wraps PCM in a 44-byte
  RIFF header. No re-encoding: a word is ~50 KB, a sentence ~200 KB, and an MP3/Opus encoder
  in Deno would be a heavy dependency for little gain.
- **Which text may be spoken.** Only text the user can have on a card
  (`tts_text_source(user, text)`, service role only):
  - `public`: a lexicon headword (`lemma_norm = lower(text)`) or a shared example sentence
    (`lexicon_examples.text_en`), plus the settings sample sentence;
  - `private`: only on the user's own cards (their note's term, a sense's source sentence, an
    edited example in `user_content`);
  - anything else → `invalid_input`; the client then uses the device voice.
- **Shared cache.** `public` audio is stored in the public Storage bucket `tts` (created by
  migration `20261024000100_tts.sql`, or by the function on first use) at
  `<voice>/<sha256(tts-v1 \n voice \n text)>.wav`, `Cache-Control: max-age=31536000`. The
  function checks the object first and returns its public URL; only a miss calls Gemini.
  Files can be fetched by name but not listed. `private` audio is generated and returned
  inline (base64 WAV) and never stored, so the server keeps nothing derived from a user's own
  text, and nobody can probe whether some sentence was ever spoken. Bumping
  `TTS_CACHE_VERSION` (prompt, voice or format change) retires the old files.
- **Daily cap.** Only misses count: `tts_consume()` on `tts_usage` (per user and UTC day,
  `TTS_DAILY_LIMIT`, default 150). Separate from `ai_usage` so pronunciations never use up the
  AI budget. A cap hit or a quota error simply falls back to the device voice.
- **Client.** `playPronunciation(text, voice)` (`src/features/review/pronunciation.ts`) is used
  by `useSpeech().speak` and the settings "Listen" button. It creates one shared `Audio`
  element and calls `play()` inside the tap (with a 50 ms silent clip while the real audio
  loads), which satisfies iOS and Android autoplay rules; then it sets the real source. Audio
  is kept as object URLs in memory and as files in Cache Storage (`engapp-tts`, ≤ 1000 files),
  so replays are instant and work offline. Guests, text over the limit, offline without a
  cached copy and every failure fall back to `speakEnglish`. A speaker button pulses
  (`aria-busy`) when the first fetch takes longer than 250 ms.

**Why.** An `<audio>` element is the one playback path every mobile browser supports. Shared
dictionary content is the same for everyone, so caching it once makes nearly every tap a free
CDN hit and keeps the free Gemini quota for new words. Validating against the lexicon and the
user's own rows stops the endpoint from being used as a general free TTS service.

**Known limits.** A card created on this device but not synced yet is not on the server, so
its own sentence is read by the device voice until the next sync. Accent control rests on the
prompt; if a voice sounds wrong, change `GEMINI_TTS_VOICE_*` or bump `TTS_CACHE_VERSION`.
