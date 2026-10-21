// "AI ile doldur" for the manual add form (plan: "Elle eklenen terimde önce ortak sözlüğe
// bakılır"). Order: this device's lexicon_cache → ai-enrich without `more` (the server
// answers from the shared lexicon without a model call when it has the term) →
// "Başka anlam ara" = ai-enrich with more: true.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AiClientError, enrichTerm, type EnrichResponse } from '@/ai/client';
import { cacheLexiconSenses, findLexiconSenses, getSettings, logError } from '@/data';
import type { LexiconSense } from '@/domain/types';
import type { LexiconLookup, LexiconSuggestion } from '@/features/cards/useLexiconLookup';
import { useAuth } from '@/features/auth/session';
import { importErrorMessage } from './errors';

export type { LexiconLookup, LexiconSuggestion };

export interface LookupDeps {
  enrich: typeof enrichTerm;
  isOnline: () => boolean;
}

const defaultDeps: LookupDeps = {
  enrich: (input) => enrichTerm(input),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
};

export type LookupResult =
  | { ok: true; senses: LexiconSuggestion[]; aiCalled: boolean }
  | { ok: false; error: 'offline' | 'empty' | string };

function suggestion(s: LexiconSense, origin: LexiconSuggestion['origin']): LexiconSuggestion {
  return {
    lexicon_sense_id: s.id,
    lexicon_term_id: s.term_id,
    pos: s.pos,
    gloss_en: s.gloss_en,
    meaning_tr: s.meaning_tr,
    ipa: s.ipa,
    origin,
  };
}

function fromEnrich(res: EnrichResponse): LexiconSuggestion[] {
  const fresh = new Set(res.new_sense_ids);
  return res.senses.map((s) => suggestion(s, res.ai_called && fresh.has(s.id) ? 'ai' : 'lexicon'));
}

/**
 * One lookup. `more: false`: local cache first, network only if the cache has nothing.
 * `more: true`: always ai-enrich with more (new senses come back marked 'ai').
 */
export async function lookupLexicon(
  term: string,
  opts: { more: boolean; sentence?: string },
  deps: LookupDeps = defaultDeps,
): Promise<LookupResult> {
  const typed = term.trim();
  if (!typed) return { ok: false, error: 'empty' };
  if (!opts.more) {
    const cached = await findLexiconSenses(typed);
    if (cached.length)
      return { ok: true, senses: cached.map((s) => suggestion(s, 'lexicon')), aiCalled: false };
  }
  if (!deps.isOnline()) return { ok: false, error: 'offline' };
  const level = (await getSettings()).level;
  try {
    const res = await deps.enrich({
      term: typed,
      more: opts.more,
      level,
      ...(opts.sentence ? { sentence: opts.sentence } : {}),
    });
    await cacheLexiconSenses(res.senses);
    return { ok: true, senses: fromEnrich(res), aiCalled: res.ai_called };
  } catch (e) {
    if (e instanceof AiClientError) return { ok: false, error: e.code };
    void logError(e, 'lexicon.lookup');
    return { ok: false, error: 'unknown' };
  }
}

interface HookState {
  term: string;
  status: LexiconLookup['status'];
  senses: LexiconSuggestion[];
  error: string | null;
  searched: boolean;
  moreDone: boolean;
}

const fresh = (term: string): HookState => ({
  term,
  status: 'idle',
  senses: [],
  error: null,
  searched: false,
  moreDone: false,
});

/** The hook the manual add form renders (contract: src/features/cards/useLexiconLookup.ts). */
export function useLexiconLookup(term: string, deps: LookupDeps = defaultDeps): LexiconLookup {
  const { t } = useTranslation();
  const auth = useAuth();
  const [raw, setState] = useState<HookState>(() => fresh(term));
  // A different term starts over (derived, so no effect is needed).
  const s = raw.term === term ? raw : fresh(term);

  const message = (code: string) =>
    code === 'offline'
      ? t('importer.lookup.offline')
      : code === 'not_signed_in' || code === 'unauthorized'
        ? t('importer.lookup.signIn')
        : importErrorMessage(code as Parameters<typeof importErrorMessage>[0]);

  const run = async (more: boolean) => {
    const asked = term;
    if (!asked.trim()) return;
    setState((p) => ({ ...(p.term === asked ? p : fresh(asked)), status: 'loading', error: null }));
    const res = await lookupLexicon(asked, { more }, deps);
    setState((p) => {
      if (p.term !== asked) return p; // the user typed on
      if (!res.ok) return { ...p, searched: true, status: 'error', error: message(res.error) };
      const seen = new Set(p.senses.map((x) => x.lexicon_sense_id));
      const senses = more
        ? [...p.senses, ...res.senses.filter((x) => !seen.has(x.lexicon_sense_id))]
        : res.senses;
      const empty = res.senses.length === 0;
      return {
        ...p,
        searched: true,
        moreDone: p.moreDone || more,
        senses,
        status: empty && senses.length === 0 ? 'error' : 'ready',
        error: empty ? (more ? t('importer.lookup.noMore') : t('importer.lookup.noSenses')) : null,
      };
    });
  };

  const available = auth.status === 'signed_in';
  return {
    available,
    status: s.status,
    senses: s.senses,
    error: s.error,
    fill: () => void run(false),
    searchMore: () => void run(true),
    canSearchMore:
      available && s.searched && !s.moreDone && s.status !== 'loading' && !!term.trim(),
  };
}
