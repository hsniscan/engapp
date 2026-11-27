# 0087 — Add flows: owned meanings, Turkish input, typed-term cap

## Context

The 2026-11-26 browser review (`ekle.md` #6–#13, older items 3.5, 3.10, 3.11) found small
behaviour gaps in the ways to add words: an already-carded meaning was pre-ticked with a filled
"Karta ekle"; a Turkish word in "Kelime ekle" hit the AI / sign-in path; a Turkish-first CSV list
imported silently; a shared word landed on an empty form; the term field took 200 characters
without a word.

## Decision

- **Owned meanings.** A sense the user's card already has (same lexicon sense, the same meaning,
  or `isDuplicateSense`) is shown with a "Kartlarında" tag but cannot be picked. The first
  *new* sense is picked by default; when every sense is owned the button reads
  "Hepsi kartlarında" and is disabled. Same rule as the add path that would skip it.
- **Turkish input.** A term with a letter only Turkish uses (ç ğ ı İ ö ş ü) that nothing on the
  device knows gets "… Türkçe görünüyor. Buraya İngilizce kelimeyi yaz" in the sheets: no
  ai-enrich call, no sign-in card. The Elle form only warns (soft check) and still saves. Words
  without such letters ("kitap") cannot be told apart cheaply and are left alone.
- **Turkish-first lists.** When rows with Turkish letters in the term and none in the meaning
  clearly outnumber the other way round (and are at least a third of the list), the CSV page
  offers "Sütunları değiştir" (whole list, undoable) before saving. No per-row guessing.
- **Typed-term cap.** The add forms stop a typed term at 80 characters (`TYPED_TERM_MAX`);
  the column limit stays 200 for imports. Term and meaning fields show "n / max" in their
  last fifth.
- **Shared word.** `/share` with 1–3 words looks the word up on the device first and opens the
  Elle form with the dictionary form and its first new meaning, like "Elle düzenle".
- **Phrasal verbs.** The quick lookup also tries the base forms of a phrase's first word
  ("gave up" → "give up"). The phrases themselves come from the word bank (ADR 0074); no new
  data.

## Why

Each is the plain, learner-friendly reading of the review note, needs no schema or server
change, and keeps the existing rules (duplicate-sense check, word bank) as the single source.
