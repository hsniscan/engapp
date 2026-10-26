# 0051 — Dikte, typed answers, "Eller serbest"

## Context

v0.5 İP9 (plan "İP9 Yeni çalışma modları", appendix A.6, acceptance criterion 8: a one-letter
typo in a word of five letters or more is "neredeyse", synonyms are accepted, and the rating is
the user's). The learning model stays as in ADR 0041: only the recognition card decides the
stage and the Aktif badge; other card types never change them; practice writes no FSRS state
and no review_logs.

## Decision

### Typed answers (Üretim, Boşluk doldurma)

1. **One lenient check** (`src/domain/answerCheck.ts`, pure). Both sides are normalised (NFC,
   straight quotes and dashes, lower case) and folded (diacritics stripped, ı→i, ß→ss and
   similar, apostrophes removed, `-`/`_` read as spaces). The accepted forms of a term drop a
   leading `to/a/an/the`, the placeholders (sb, sth, someone, one's…), expand `(optional)`
   parts and `a/b` alternatives, and add British/American spellings. The or/our, re/er and
   ence/ense rules use stem lists, so "four" never passes for "for".
2. **Verdicts:** `correct`, `synonym`, `close` ("neredeyse"), `wrong`, `skipped`. "Close" means
   a Damerau–Levenshtein distance within `closeLimit`: 0 for words of 1–2 letters, 1 for 3–7,
   and 2 for 8 or more. A transposition counts as one edit. The verdict only *suggests* a
   rating (correct or synonym → İyi, or Zor after a hint; close → Zor; wrong → Tekrar). The
   user presses the rating, and FSRS runs as before. Nothing is auto-graded.
3. **Synonyms** (`src/domain/synonyms.ts`, `src/data/synonyms.ts`) are the other English
   lemmas in word_bank, lexicon_cache and the user's own notes that share a Turkish meaning
   (`isSameMeaningTr`) with a compatible part of speech. They are looked up only when the
   verdict is close or wrong. A synonym is shown in success colours with "eş anlamlısı da
   olur" and the expected word.
4. **Modes are per-device flags**, not synced settings (`engapp.modes.answer.production` and
   `.cloze`). This follows the existing localStorage preferences and needs no migration. Üretim
   is **typed by default**, which deviates from the brief's "off by default", because the shipped
   redesign board and the existing e2e expect typing. "Aklımdan" (flip, then rate) is the
   opt-out. Boşluk doldurma keeps its choices by default; "Yazarak cevapla" is the opt-in. Inputs
   set `autocapitalize`, `autocorrect` and `spellcheck` to off.

### Dikte

5. **A new card type `dictation`**, one per sense, with its own FSRS card. A sense gets one when
   it has at least one *shared, unedited* lexicon example with a span: these have pre-generated
   audio (tts-v3), so playback costs nothing. The user's own source sentence and edited
   sentences are never used, since they would need live TTS. The card unlocks like the other
   derived cards when the recognition card reaches Pekişiyor (`recognitionUnlocks`) and locks
   again on undo. Answering it never changes the stage (`syncFromPrimary` runs only for
   recognition).
6. **Cards are reconciled**, as image cards are (`reconcileDictationCards`), at bootstrap, after
   new examples are stored and when /study opens. A signature (counts, newest updated_at, the
   user's example feedback and edits) skips the work when nothing changed. Ids are derived
   (`contentRowId`), so two devices make the same card. The rotation over sentences uses
   `card.reps`.
7. **The screen** plays the sentence with the word blanked. It autoplays only after a user
   gesture, and has "Tekrar dinle" and "Yavaş dinle" (playbackRate 0.7 with pitch kept; the
   device-voice fallback also takes the rate). The typed check accepts no synonyms (the word
   is in the sentence), and a different inflection of the base form counts as close.
8. **Storage:** Dexie **v33** with no index change and a `cards` re-pull backfill, so an older
   device that dropped unknown card types picks them up again. Migration
   `20261101000900_dictation_cards.sql` widens the `cards.card_type` check constraint (pgTAP
   `51_dictation_cards.test.sql`). Counts appear in `useStudyModeCounts`, in `/study` (a fourth
   tile), `/study?mode=dictation` and `/study/more` ("Dinleyerek çalış"). The home tiles stay
   at three.

### "Eller serbest" (hands-free)

9. `/practice?mode=audio&source=…&size=10|20`. For each word: the English word, a 2.5 s pause
   to recall, the Turkish meaning, then an example sentence (shared first). Large controls:
   Duraklat/Devam, Sonraki, Bitir. A run token makes a late "done" from a stopped voice
   harmless.
10. **It writes nothing**: no FSRS state, no review_logs, **no practice_logs and no
    encounters**. The encounters contract belongs to reading and stories, and listening in the
    background is not an exposure the user chose per word. A test compares every table before
    and after a round.
11. **Voices:** English goes through the existing pronunciation path (memory → Cache Storage →
    pre-generated MP3 → edge function → device voice). Turkish uses the device voice
    (speechSynthesis `tr-TR`, or native TextToSpeech on Android), because there is no Turkish
    pre-generated audio and no live AI calls are allowed here.
12. **Screen dimmed:** the web cannot keep playing with the screen fully off. The round
    requests a Screen Wake Lock, sets Media Session metadata and play/pause/next handlers, and
    offers "Ekranı karart" (a black overlay). When the page is hidden, browsers throttle the
    timers, so pauses may stretch. The Android app's WebView behaves the same.

## Deferred

- Synced answer-mode preferences (a settings column) if users ask for them per account.
- Dikte for user sentences once their audio can be generated offline or cached cheaply.
- A true background audio session (native media service) for hands-free with the screen off.
- Turkish pre-generated audio for meanings.
