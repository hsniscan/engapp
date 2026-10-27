// One word's meanings, the quick sheet's lookup chain (v0.5 İP4, decision 0046), shared with the
// Add sheet's "Kelime ekle" (v0.5.1, decision 0056): the user's own card, then Kelime Bankası and
// the lexicon cache on this device (offline), and only when none of them knows the word, online
// and signed in, ai-enrich (which answers from the shared lexicon before it calls a model).
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logError } from '@/data';
import {
  addQuickCard,
  previewFromSenses,
  quickPreview,
  type QuickAddResult,
  type QuickPreview,
} from '@/data/quick';
import { startAuth, useAuth } from '@/features/auth/session';
import { lookupLexicon, type LexiconSuggestion } from '@/features/import/lexicon';
import type { LookupState } from './QuickSheet';
import { lookupForms } from './route';

export function useOnlineNow(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** One ai-enrich lookup per term per session (StrictMode runs effects twice). */
const asking = new Map<string, ReturnType<typeof lookupLexicon>>();
function askOnce(term: string): ReturnType<typeof lookupLexicon> {
  let p = asking.get(term);
  if (!p) {
    p = lookupLexicon(term, { more: false });
    // A failed or empty answer may be asked again on a later visit.
    void p.then((r) => {
      if (!r.ok || !r.senses.length) asking.delete(term);
    });
    asking.set(term, p);
  }
  return p;
}

export interface TermLookup {
  /** undefined while the device lookup runs. */
  preview: QuickPreview | undefined;
  lookup: LookupState;
  picked: ReadonlySet<string>;
  toggle: (key: string) => void;
  add: () => Promise<void>;
  saving: boolean;
  saved: QuickAddResult | null;
  addError: string | null;
}

/** The lookup and "Karta ekle" for one term ('' = nothing to look up yet). */
export function useTermLookup(term: string): TermLookup {
  const { t } = useTranslation();
  const auth = useAuth();
  const online = useOnlineNow();
  const forms = useMemo(() => lookupForms(term), [term]);
  const local = useLiveQuery(
    () => (term ? quickPreview(term, forms) : Promise.resolve(undefined)),
    [term, forms.join('|')],
  );

  // ai-enrich, once, only when the device has nothing for the word (not even the user's card).
  const [answer, setAnswer] = useState<{
    term: string;
    state: LookupState;
    senses: LexiconSuggestion[] | null;
  } | null>(null);
  const mine = answer?.term === term ? answer : null;
  const aiSenses = mine?.senses ?? null;
  const missing =
    !!term && local !== undefined && local.origin === 'none' && local.mine.length === 0;
  // Outside the shell nothing has started the session yet; only needed when the device has
  // nothing (an offline word-bank hit never touches the backend).
  useEffect(() => {
    if (missing && online) startAuth();
  }, [missing, online]);
  const signedIn = auth.status === 'signed_in';
  const shouldAsk = missing && online && signedIn && mine === null;
  const lookup: LookupState = !missing
    ? 'idle'
    : mine
      ? mine.state
      : !online
        ? 'offline'
        : signedIn
          ? 'searching'
          : auth.status === 'loading'
            ? 'searching'
            : auth.status === 'unavailable'
              ? 'notfound'
              : 'signin';

  useEffect(() => {
    if (!shouldAsk) return;
    let live = true;
    void askOnce(term).then((res) => {
      if (!live) return;
      if (!res.ok)
        setAnswer({ term, state: res.error === 'offline' ? 'offline' : 'failed', senses: null });
      else if (!res.senses.length) setAnswer({ term, state: 'notfound', senses: null });
      else setAnswer({ term, state: 'idle', senses: res.senses });
    });
    return () => {
      live = false;
    };
  }, [shouldAsk, term]);

  const preview = useMemo(
    () => (local && aiSenses ? previewFromSenses(local, aiSenses) : local),
    [local, aiSenses],
  );

  // The first meaning is picked by default (the most common one).
  const [chosen, setChosen] = useState<{ term: string; keys: Set<string> } | null>(null);
  const picked = useMemo(() => {
    const keys = new Set(preview?.senses.map((s) => s.key) ?? []);
    if (chosen && chosen.term === term) return new Set([...chosen.keys].filter((k) => keys.has(k)));
    const first = preview?.senses[0]?.key;
    return new Set(first ? [first] : []);
  }, [chosen, preview, term]);
  const toggle = useCallback(
    (key: string) => {
      const next = new Set(picked);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setChosen({ term, keys: next });
    },
    [picked, term],
  );

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<QuickAddResult | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  // A new word starts over.
  const [savedFor, setSavedFor] = useState(term);
  if (savedFor !== term) {
    setSavedFor(term);
    setSaved(null);
    setAddError(null);
  }
  const add = async () => {
    if (!preview || saving) return;
    setSaving(true);
    setAddError(null);
    try {
      setSaved(await addQuickCard(preview, [...picked]));
    } catch (e) {
      void logError(e, 'quick.add');
      setAddError(t('quick.addFailed'));
    } finally {
      setSaving(false);
    }
  };

  return {
    preview: term ? preview : undefined,
    lookup,
    picked,
    toggle,
    add,
    saving,
    saved,
    addError,
  };
}
