# AGENTS.md — rules for coding agents working on Engapp

Engapp is an offline-first English→Turkish flashcard PWA. The product plan is
`docs/plan-v0.1.md` (Turkish). Technical details live in `docs/`:
`architecture.md`, `data-model.md`, `sync-strategy.md`, `ai-pipeline.md`,
`design.md`, `phases.md`, and decision records in `docs/decisions/`.

## Rules

1. The plan is the main reference. You may improve on it; when you deviate,
   record a short decision in `docs/decisions/NNNN-title.md` (context, decision, why).
2. Start each work package by listing its acceptance criteria and tests.
3. Small commits; every commit passes typecheck, lint and tests. End a package
   with a summary: what was done, what was deferred, known issues.
4. Business logic lives in `src/domain/` as pure functions. UI components hold no
   business logic. `src/domain/` never imports React, Dexie or network code.
5. Never: update or delete a `review_logs` row; take `user_id` from the client on
   the server; put an API key in the client; hard-code a model name; write a
   user's sentence or text into the shared lexicon.
6. Before calling the AI, always check the chunk cache and the shared lexicon;
   never ask the AI to regenerate content the lexicon already has.
7. Justify every new dependency in the PR / commit message.
8. UI strings live only in `src/i18n/tr.json` (and `en.json`).
9. Every schema change: Dexie version bump + upgrade function + test; Supabase
   side: a new file in `supabase/migrations/`.
10. If unsure, ask instead of guessing.

## Commands

```
pnpm install
pnpm dev          # local app (guest mode works without any env vars)
pnpm typecheck
pnpm lint
pnpm test         # vitest unit/property/data tests
pnpm e2e          # Playwright
pnpm build
```
