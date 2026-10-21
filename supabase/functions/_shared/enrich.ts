// ai-enrich pipeline: a term typed by the user. Lexicon first; the model is called only
// when the lexicon has nothing for the term, or when the user asks for more senses.

import { enrichRequest, type EnrichResponse, type LexiconEntry } from './contracts.ts';
import { ApiError } from './errors.ts';
import { AiError } from './ai-provider.ts';
import {
  buildEnrichUserPrompt,
  ENRICH_PROMPT_VERSION,
  ENRICH_RESPONSE_SCHEMA,
  ENRICH_SYSTEM_PROMPT,
  enrichModelOutput,
  enrichModelSense,
  MAX_ENRICH_SENSES,
  type ExistingSenseLine,
} from './prompts.ts';
import {
  cleanGloss,
  cleanIpa,
  cleanMeaningTr,
  resolveNewSenses,
  type PendingSense,
  type PipelineDeps,
} from './extract.ts';
import type { LexTerm } from './store.ts';
import { cleanLemma, glossKey, isCleanLexiconText, normalizeLemma, normalizePos } from './text.ts';
import { lemmaForms, termForms } from './tokenize.ts';

function entriesOf(t: LexTerm): LexiconEntry[] {
  return t.senses.map((s) => ({
    id: s.id,
    term_id: t.term_id,
    lemma: t.lemma,
    lemma_norm: t.lemma_norm,
    term_type: t.term_type,
    pos: s.pos,
    gloss_en: s.gloss_en,
    meaning_tr: s.meaning_tr,
    ipa: s.ipa,
    updated_at: s.updated_at,
  }));
}

/** Is the model's lemma a plausible dictionary form of what the user typed? */
export function lemmaAcceptable(input: string, aiLemma: string): boolean {
  const inNorm = normalizeLemma(input);
  const aiNorm = normalizeLemma(aiLemma);
  if (!aiNorm || /^\p{Lu}/u.test(cleanLemma(aiLemma))) return false;
  if (aiNorm === inNorm || termForms(input).includes(aiNorm)) return true;
  // Multi-word: same first word (any base form) and a similar length,
  // e.g. "made up her mind" -> "make up one's mind".
  const a = inNorm.split(' ');
  const b = aiNorm.split(' ');
  if (a.length < 2 || b.length < 2 || Math.abs(a.length - b.length) > 2) return false;
  const fa = new Set(lemmaForms(a[0]!));
  return lemmaForms(b[0]!).some((f) => fa.has(f));
}

export async function runEnrich(body: unknown, deps: PipelineDeps): Promise<EnrichResponse> {
  const parsed = enrichRequest.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      'invalid_input',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  const { sentence, more, level } = parsed.data;
  const input = cleanLemma(parsed.data.term);
  if (!input || !/\p{L}/u.test(input) || input.split(' ').length > 8) {
    throw new ApiError('invalid_input', 'term must be an English word or expression');
  }

  // 1. Lexicon lookup (typed form first, then base forms).
  const forms = termForms(input);
  const found = await deps.store.findTerms(forms);
  let term: LexTerm | undefined =
    found.find((t) => t.lemma_norm === forms[0]) ??
    forms.map((f) => found.find((t) => t.lemma_norm === f)).find(Boolean);
  const existing = term ? entriesOf(term) : [];

  if (term && existing.length > 0 && !more) {
    return {
      prompt_version: ENRICH_PROMPT_VERSION,
      ai_called: false,
      model: null,
      term: {
        id: term.term_id,
        lemma: term.lemma,
        lemma_norm: term.lemma_norm,
        term_type: term.term_type,
      },
      senses: existing,
      new_sense_ids: [],
      suggested_sense_id: null,
      usage: null,
    };
  }

  // 2. Daily limit.
  const usage = await deps.store.consumeAi(deps.userId, deps.dailyLimit);
  if (!usage.allowed)
    throw new ApiError('daily_limit', `Daily AI limit reached (${usage.used}/${usage.limit}).`);

  // 3. Model, told which senses exist so it does not repeat them.
  const lines: ExistingSenseLine[] = existing.map((e, i) => ({
    ref: `e${i + 1}`,
    pos: e.pos,
    gloss_en: e.gloss_en,
  }));
  let result;
  try {
    result = await deps.provider().generateJson({
      system: ENRICH_SYSTEM_PROMPT,
      user: buildEnrichUserPrompt(term?.lemma ?? input, level, lines, sentence),
      schema: ENRICH_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      validate: (d) =>
        enrichModelOutput.safeParse(d).success
          ? null
          : 'expected {valid, lemma, term_type, senses}',
      maxOutputTokens: 2048,
    });
  } catch (e) {
    if (e instanceof AiError) throw new ApiError(e.code, e.message, e.retryAfterS);
    throw e;
  }
  const out = enrichModelOutput.parse(result.data);
  const usageOut = { used: usage.used, limit: usage.limit };
  const base = {
    prompt_version: ENRICH_PROMPT_VERSION,
    ai_called: true,
    model: result.model,
    usage: usageOut,
  };

  const termInfo = (t: LexTerm) => ({
    id: t.term_id,
    lemma: t.lemma,
    lemma_norm: t.lemma_norm,
    term_type: t.term_type,
  });

  if (!out.valid && !term) {
    return { ...base, term: null, senses: [], new_sense_ids: [], suggested_sense_id: null };
  }

  // 4. Which lexicon term the senses belong to.
  let lemma = term?.lemma ?? input;
  if (!term && lemmaAcceptable(input, out.lemma)) {
    lemma = cleanLemma(out.lemma);
    const aiNorm = normalizeLemma(lemma);
    if (aiNorm !== normalizeLemma(input)) {
      term = (await deps.store.findTerms([aiNorm]))[0];
      if (term) existing.push(...entriesOf(term));
    }
  }
  const lemmaNorm = term?.lemma_norm ?? normalizeLemma(lemma);
  const rawType = out.term_type;
  const termType =
    term?.term_type ??
    (rawType === 'word' || rawType === 'phrase' || rawType === 'pattern'
      ? rawType
      : lemma.includes(' ')
        ? 'phrase'
        : 'word');

  // 5. Validate the new senses.
  const pending: PendingSense[] = [];
  const usedInSentence: boolean[] = [];
  for (const raw of out.valid ? out.senses.slice(0, MAX_ENRICH_SENSES) : []) {
    const p = enrichModelSense.safeParse(raw);
    if (!p.success) continue;
    const pos = normalizePos(p.data.pos);
    const gloss = cleanGloss(p.data.gloss_en);
    const key = glossKey(gloss);
    const meaning = cleanMeaningTr(p.data.meaning_tr);
    if (!pos || !gloss || gloss.length > 200 || !key || !meaning || meaning.length > 120) continue;
    const ipa = cleanIpa(p.data.ipa);
    // Shared with every user: no links, markup or foreign scripts (prompt injection via
    // the typed term or sentence), and a new term must itself look like an English term.
    if (
      (!term && !isCleanLexiconText(lemma, 'en')) ||
      !isCleanLexiconText(gloss, 'en') ||
      !isCleanLexiconText(meaning, 'tr') ||
      (ipa !== null && !isCleanLexiconText(ipa, 'ipa'))
    )
      continue;
    pending.push({
      lemma,
      lemma_norm: lemmaNorm,
      term_type: termType,
      sense: {
        pos,
        gloss_en: gloss,
        gloss_key: key,
        meaning_tr: meaning,
        ipa,
      },
    });
    usedInSentence.push(p.data.used_in_sentence === true);
  }

  const termsByNorm = new Map<string, LexTerm>(term ? [[term.lemma_norm, term]] : []);
  const resolved = await resolveNewSenses(pending, termsByNorm, deps.store, result.model);

  const existingIds = new Set(existing.map((e) => e.id));
  const newIds: string[] = [];
  for (const r of resolved) {
    if (r.senseId && !existingIds.has(r.senseId) && !newIds.includes(r.senseId))
      newIds.push(r.senseId);
  }

  let suggested: string | null = null;
  const ref = out.sentence_known_sense?.trim();
  if (sentence && ref && /^e\d+$/.test(ref))
    suggested = existing[Number(ref.slice(1)) - 1]?.id ?? null;
  if (sentence && !suggested) {
    const i = usedInSentence.indexOf(true);
    if (i >= 0) suggested = resolved[i]?.senseId || null;
  }

  const fresh = newIds.length > 0 ? await deps.store.getEntries(newIds) : [];
  const freshById = new Map(fresh.map((e) => [e.id, e]));
  const senses = [
    ...existing,
    ...newIds.map((id) => freshById.get(id)).filter((e): e is LexiconEntry => !!e),
  ];
  const first = senses[0];
  return {
    ...base,
    term: term
      ? termInfo(term)
      : first
        ? {
            id: first.term_id,
            lemma: first.lemma,
            lemma_norm: first.lemma_norm,
            term_type: first.term_type,
          }
        : null,
    senses,
    new_sense_ids: newIds.filter((id) => freshById.has(id)),
    suggested_sense_id: suggested,
  };
}
