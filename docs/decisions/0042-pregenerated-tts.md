# 0042 — Pre-generated pronunciation audio (Kokoro-82M, MP3)

**Context.** Since 0028 a speaker tap calls the `tts` edge function, which serves a cached WAV
or asks Gemini TTS. A first tap takes 5–6 s (function start, a Storage HEAD, often the model),
and the free Gemini TTS quota (a few hundred clips a day) can never cover the whole dictionary
(~20,000 texts × 2 accents).

**Decision.**

- **Engine:** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) v1.0 (Apache-2.0, commercial
  use allowed), run on CPU in GitHub Actions through `kokoro-onnx` (MIT) and onnxruntime. The
  phonemes come from `misaki` (Apache-2.0), the G2P Kokoro was trained with, in US or GB mode
  (e.g. _schedule_ skˈɛʤul / ʃˈɛdjuːl, _tomato_ təmˈAɾO / təmˈɑːtQ); espeak-ng is its fallback for
  words outside its dictionary (a build-time tool only, nothing of it ships). Voices: **en-US
  `af_heart`** and **en-GB `bf_emma`**, the best-rated voices of each accent in Kokoro's own
  voice list. Speed 0.92 (like the device voice's rate), 50 ms of silence before and 150 ms after
  (some phones clip the start). Model files come from the kokoro-onnx GitHub release, pinned by
  SHA-256 in the workflow. No paid API, no Gemini call.
- **Format:** MP3, 48 kbps CBR, mono, 24 kHz (Kokoro's rate; MPEG-2 Layer III, which every
  browser and iOS plays). Measured: a word ≈ 7 KB, a 70-character sentence ≈ 24 KB, about a
  sixth of the old WAVs. Encoded with `lameenc` (LAME, LGPL, build tool only).
- **Key:** `TTS_CACHE_VERSION` is now `tts-v3`; a file is
  `tts/<voice>/<sha256("tts-v3\n" + voice + "\n" + normalised text)>.mp3`. The helpers
  (`ttsObjectPath`, `ttsTextCandidates`, `ttsPublicUrl`, `ttsSha256Hex`) moved into
  `_shared/tts-contract.ts`, which the client, the function and the job all import, and a test
  pins the exact key. Headwords are public in any casing (`lemma_norm = lower(text)`), so the
  job makes both `lemma_norm` and the display spelling when they differ ("Monday"), and lookups
  try the text as shown and then its lower-case form (only for texts ≤ 120 characters, the
  headword limit).
- **Text set**, mirroring `tts_text_source(…) = 'public'`: every `lexicon_terms` headword, every
  **active** `lexicon_examples.text_en` (retired examples are never on screen; if one is ever
  asked for, the on-demand path still reads it), and the settings sample. Texts the function
  would refuse (no Latin letter, > 300 characters) are skipped.
- **Job:** `scripts/tts-pregen.ts` (`plan` | `run` | `prune-ondemand`) drives the Python worker
  `scripts/tts-kokoro.py` over JSON lines; `.github/workflows/tts-pregen.yml` runs it by hand
  (inputs: voice, shards, max, plan_only, prune_ondemand) and, with `TTS_PREGEN_WEEKLY=true`,
  every Sunday for new entries. It lists the bucket once (service role), plans only the
  missing files of its shard (by file hash, so shards never overlap), and uploads each clip as
  soon as it is made (`upsert`, content-addressed). So it is **idempotent and resumable**: a
  cancelled or timed-out job is run again and continues. It stops on its own before the
  runner's time limit (`--minutes 330`) and after 20 failures in a row. `plan` also reports the
  bucket's current size (MP3 and WAV, from the listing), so it is the safe way to see usage.
- **Edge function:** for public text it now looks for the MP3 (both casings), then for an
  earlier on-demand WAV, and only then calls Gemini, storing the result as before under the old
  key `tts-v2` (`ttsOnDemandObjectPath`). Kokoro cannot run inside an edge function (CPU and
  memory limits), so on-demand audio stays Gemini WAV: only for private text and for
  dictionary entries newer than the last run, which the weekly job then replaces. Keeping the
  old key means the WAVs made so far keep serving those misses; `prune-ondemand` deletes the
  ones an MP3 has replaced.
- **Client fast path** (`src/features/review/pronunciation.ts`): memory → Cache Storage →
  **the public Storage URL of the MP3, fetched directly** (6 s timeout) → the edge function
  only when Storage answers 4xx (Storage says 400 or 404 for a missing object) or cannot be
  reached → the device voice. The MP3 goes into Cache Storage (`engapp-tts`, ≤ 1000 files) and
  memory as before, so replays are instant and work offline. The review screen prefetches the
  word on screen (`prefetchPronunciations`: Storage only, never the function, skipped for
  guests, offline and with data saver). Guests keep the device voice, as in 0028: their tap
  must speak inside the gesture on iOS.
- **Bucket:** migration `20261027000100_tts_mp3.sql` adds `audio/mpeg` to the allowed types
  (the job also does it through the Storage API if the migration could not).

**Size and time** (measured on a 4-core x86 machine; GitHub's standard runner has 4 vCPUs). With
~10,000 headwords and ~10,000 example sentences of ~60 characters: words 2 × 10,300 × 7 KB ≈
150 MB, sentences 2 × 10,000 × 21 KB ≈ 410 MB, **≈ 560 MB in all**; about **10 CPU-hours**,
so ≈ 1.5 h of wall time with 8 shards (free: the repository is public). The bucket shares the
1 GB of the free plan with the pictures; if space runs short, `BITRATE_KBPS = 32` in
`tts-kokoro.py` (with a version bump) cuts it by a third, and `prune-ondemand` frees the old
WAVs. The `plan` step prints the real counts.

**Why.** A file fetched from the Storage CDN by a name the client can compute needs no
function start, no auth round trip and no database lookup: a tap costs one cached GET, or
nothing after the first time. One engine for the whole dictionary gives every word the same
voice. Kokoro is the best-sounding permissively licensed model that runs well on CPU; its
misaki G2P gets US and GB pronunciations right where espeak alone often does not.

**Known limits.** Kokoro occasionally mis-stresses rare words or reads abbreviations oddly; a
bad clip can be fixed by deleting its file (the next run remakes it) or, for a systematic
problem, by a version bump. The client cannot tell public from private text, so it also asks
Storage for the hash of a user's own word or sentence (a 404) before calling the function:
the project's Storage logs see that hash, which for a short word can be guessed. Nothing is
stored, and only the project owner sees those logs. A
lexicon entry added after the last run is read by Gemini (or the device voice) until the next
run.
