# 0015 — Interests and profile (v0.2 İP7)

## Context

The v0.2 plan (İP7, Ek A.1/A.2) asks for a list of 15 topics, a first-run choice, a profile
screen with a weight bar and a "neden" per topic, a way to turn a topic off, and a fixed weight
rule computed on the device from synced data (`settings.interests`, `sources.topics`, example
sentence feedback). İP5 uses the profile to choose which example-sentence tab opens first; a
later practice option ("ilgi alanımdan") ranks by it. This package ran in parallel with İP2
(extract-v3) and İP5 (content_feedback), so topics from the extract call and feedback are not
wired yet; the rule takes them as inputs.

## Decision

1. **Topic list** (`src/domain/topics.ts`): 16 stable snake_case keys — the plan's 15 plus
   `literature` ("Kitap ve edebiyat"), because books and novels are a main import source and
   fit no other topic. Keys are never renamed or removed. Names live in i18n (`topics.*`).
   Each topic maps to one of İP5's base contexts (`daily`, `business`, `technical`,
   `formal`); an interest context such as `travel` is the topic key itself.
2. **Rule** (`src/domain/profile.ts`, pure, tested with fixed scenarios and a property test):
   picked 3 + each live text about the topic 1 + each liked example 0.5 − each skipped 0.25,
   floored at 0; muted = 0. Deviations:
   - **Feedback also decays** with the 60-day half-life, not only texts: a like from a year
     ago should not outweigh what the user does now, and one rule is easier to explain.
   - **A text with two topics counts 1 for each** (not ½): "3 teknoloji metni yükledin" stays
     literally true.
   - **Deleted texts do not count; `reject` verdicts are ignored** (they say a sentence is
     wrong, not that the topic is dull). A `formal` example counts for no topic.
   - The "neden" shows plain counts ("Sen seçtin · 3 metin yükledin"); only the bar decays.
3. **API for other features**: `orderContexts(contexts, weights)` (equal scores keep the
   caller's order, so an empty profile changes nothing), `rankedTopics`, data-layer
   `getTopicProfile()` / `getOrderedContexts()`, hook `useTopicProfile()`,
   `setSourceTopics(sourceId, topics)` and `aggregateTopics(chunkTopics)` / `parseTopics` for
   the extract response, `loadFeedbackSignals()` as the single place İP5 fills in.
4. **Muting** removes the topic from `interests`; picking a muted topic turns it back on.
   "Kapat" has an undo toast. Turned-off topics are listed with "Aç".
5. **First run is a card on the dashboard, not a blocking screen**: shown after the first
   word (not on the empty "Hoş geldin" page), compact chips, "Kaydet" / "Şimdi değil". It
   shows while `settings.interests` is null; either answer sets it (`[]` for "Şimdi değil"),
   which syncs, so no other device asks again. Existing users see it once on the dashboard
   and one tap dismisses it.
6. **Profile screen** is `/settings/profile`, reached from a new "Profil" section in
   Ayarlar (a summary row + "Profili aç"), so the long settings page stays short.
7. **Data**: `settings.interests`, `settings.muted_topics`, `sources.topics` are `text[]`,
   free strings (not an enum), at most 40 keys of ≤ 40 chars (`public.is_topic_list`). A
   newer device may know more topics; unknown keys are kept on every write. On the client
   the fields are optional: absent/null = unknown, `[]` = none. **Null never overwrites**: a
   `keep_profile_fields` trigger (server) and `keepProfileFields` in `applyRemoteRows`
   (client) keep the stored list when an incoming row lacks it, so a theme change or backup
   on an older device cannot wipe the user's interests. The plan accepted that loss for
   `source_sentence_tr`; here it would re-open the first-run question.
8. **Dexie v7** (numbering agreed for the parallel packages): `sources` gains a `*topics`
   multi-entry index (for "texts about this topic", e.g. practice by topic); no row upgrade
   because the fields are optional. **Backup schema 4**: optional fields, so older files keep
   their checksum and restore; a v3 client refuses a v4 file instead of reporting a checksum
   error. Account merge copies a source's topics (text metadata, not history); the other
   account's settings (interests) are still dropped (decision 0009).
9. Migration `20261022000300_interests_profile.sql`; pgTAP `10_interests_profile.test.sql`.

## Not done (later, after İP2 / İP5 merge)

- extract-v3 returns `topics` per chunk → after a job, `setSourceTopics(source_id,
  aggregateTopics(chunkTopics))`.
- `loadFeedbackSignals()` reads İP5's `content_feedback` (like/skip on examples) joined with
  the example's context.
- İP5 orders its tabs with `orderContexts`; practice "ilgi alanımdan" (mode `topic`) selects
  notes whose senses' `source_id` has one of `rankedTopics`.
- No manual way to set a text's topics; the extract call is the only source for now.
