/**
 * Prints the docs/ai-pipeline.md section for the morpheme job, with the prompt and schema
 * exactly as the code sends them (src/ai/morpheme-docs.test.ts keeps the two in step).
 *
 *   node scripts/build-morphology/doc-section.ts
 */
import {
  MORPHEME_BATCH,
  MORPHEME_PROMPT_VERSION,
  MORPHEME_RESPONSE_SCHEMA,
  MORPHEME_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/morphemes.ts';

const fence = '```';
process.stdout.write(`## Root and affix meanings (\`${MORPHEME_PROMPT_VERSION}\`)

A one-off system job (İP6, ADR 0014), not an edge function. It runs with
\`scripts/build-morphology/meanings.ts\`, locally or in the "Build morphology data" workflow.

- **Input.** Reference data only: the morpheme's form, kind, origin and English gloss, plus up to
  6 example words from the frequency list. No user text is ever sent.
- **Batches.** ${MORPHEME_BATCH} morphemes per request, about 7 requests for the current 133.
  The job uses the system budget, never a user's quota.
- **Model.** \`GEMINI_MODEL\`, with \`GEMINI_FALLBACK_MODEL\` on quota or overload errors. Both
  come from the environment only.
- **Validation.** \`validateMorphemeAnswer\`:
  - \`meaning_tr\`: at most 40 characters and 6 words;
  - only letters and punctuation are allowed;
  - every id must be answered exactly once.

  Rejected items keep the hand-written meaning from \`inventory.ts\` and are retried on the next run.
- **Output.** \`data/reference/morpheme-meanings.tr.json\`. Each item records its model and the
  prompt version, and the owner can set \`"reviewed": true\` on an item. \`load-sql.ts\` writes it to
  \`ref_morphemes.meanings.tr\` with \`source: "ai"\`.

### System prompt

${fence}text
${MORPHEME_SYSTEM_PROMPT}
${fence}

### Response schema

${fence}json
${JSON.stringify(MORPHEME_RESPONSE_SCHEMA, null, 2)}
${fence}
`);
