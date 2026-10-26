// /quick?text=… — the text-selection sheet (v0.5 İP4, plan A.4, acceptance criterion 5;
// docs/decisions/0046-quick-capture.md). Outside the app shell: no navigation, only the sheet.
//
// On Android "Engapp" in another app's selection menu opens QuickCaptureActivity on this route
// (the selection arrives through the ShareTarget plugin, src/native/quick.ts); the card is saved
// on the device without opening the main app, then the activity finishes back to the calling
// app. In the browser the same route works as a page (closing goes back).
//
// A word is looked up on the device first (Kelime Bankası, then the lexicon cache), so it works
// offline; only when neither knows it, and the user is online and signed in, ai-enrich is asked
// (it answers from the shared lexicon before it calls a model).
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { getSettings, logError } from '@/data';
import { addQuickCard, previewFromSenses, quickPreview, type QuickAddResult } from '@/data/quick';
import { saveText } from '@/data/texts';
import { readerPath } from '@/domain/texts';
import { useAuth } from '@/features/auth/session';
import { lookupLexicon, type LexiconSuggestion } from '@/features/import/lexicon';
import { playPronunciation, pronunciationSupported } from '@/features/review/pronunciation';
import { shareHref } from '@/features/share/route';
import { historyIndex } from '@/native/backButton';
import { isNativeApp } from '@/native/platform';
import { closeQuick, continueInApp } from '@/native/quickHost';
import { QuickSheet, type LookupState } from './QuickSheet';
import { addFormPath, lookupForms, quickTitle, routeQuick } from './route';

/** How long the sheet stays after "Karta ekle" before it closes (the confirmation). */
export const SAVED_CLOSE_MS = 1200;
/** Android cold start: how long to wait for the selection before showing the empty state. */
const WAIT_FOR_SELECTION_MS = 4000;

function useOnlineNow(): boolean {
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

export function QuickPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const text = params.get('text');
  const route = useMemo(() => routeQuick(text), [text]);

  // In the Android sheet the selection arrives a moment after the page (cold start).
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (text !== null || !isNativeApp()) return;
    const id = window.setTimeout(() => setWaited(true), WAIT_FOR_SELECTION_MS);
    return () => window.clearTimeout(id);
  }, [text]);
  const waiting = text === null && isNativeApp() && !waited;

  const close = useCallback(
    () =>
      void closeQuick(() => {
        // Web: back to where the selection came from (in the app, or the page before it);
        // a sheet opened in a fresh window (share target, a link) goes to the home screen.
        if (historyIndex(window.history.state) > 0) void navigate(-1);
        else if (window.history.length > 1) window.history.back();
        else void navigate('/', { replace: true });
      }),
    [navigate],
  );

  const [busy, setBusy] = useState<'reader' | 'extract' | 'link' | 'write' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handOver = async (
    which: NonNullable<typeof busy>,
    target: () => Promise<{ path: string } | { shareText: string }>,
  ) => {
    setBusy(which);
    setError(null);
    try {
      const to = await target();
      await continueInApp(
        to,
        () =>
          void navigate('path' in to ? to.path : shareHref({ text: to.shareText }), {
            replace: true,
          }),
      );
    } catch (e) {
      void logError(e, `quick.${which}`);
      setError(t('quick.openFailed'));
    } finally {
      setBusy(null);
    }
  };

  const common = { onClose: close, busy, error };
  if (waiting) return <QuickSheet route={null} {...common} />;
  if (route.kind === 'term')
    return (
      <TermSheet
        key={route.term}
        term={route.term}
        onClose={close}
        busy={busy}
        error={error}
        onWriteOwn={() => void handOver('write', async () => ({ path: addFormPath(route.term) }))}
      />
    );
  if (route.kind === 'text')
    return (
      <QuickSheet
        route={route}
        {...common}
        onOpenReader={() =>
          void handOver('reader', async () => {
            const id = await saveText({
              kind: 'paste',
              title: quickTitle(route.text),
              body: route.text,
            });
            return { path: readerPath(id) };
          })
        }
        onExtract={() => void handOver('extract', async () => ({ shareText: route.text }))}
      />
    );
  if (route.kind === 'link')
    return (
      <QuickSheet
        route={route}
        {...common}
        onOpenLink={() => void handOver('link', async () => ({ shareText: route.url }))}
      />
    );
  return <QuickSheet route={route} {...common} />;
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

function TermSheet({
  term,
  onClose,
  onWriteOwn,
  busy,
  error,
}: {
  term: string;
  onClose: () => void;
  onWriteOwn: () => void;
  busy: 'reader' | 'extract' | 'link' | 'write' | null;
  error: string | null;
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const online = useOnlineNow();
  const forms = useMemo(() => lookupForms(term), [term]);
  const local = useLiveQuery(() => quickPreview(term, forms), [term, forms.join('|')]);
  const voice = useLiveQuery(async () => (await getSettings()).voice, []) ?? 'en-US';

  // ai-enrich, once, only when the device has nothing for the word.
  const [answer, setAnswer] = useState<{
    state: LookupState;
    senses: LexiconSuggestion[] | null;
  } | null>(null);
  const aiSenses = answer?.senses ?? null;
  const missing = local !== undefined && local.origin === 'none';
  const signedIn = auth.status === 'signed_in';
  const shouldAsk = missing && online && signedIn && answer === null;
  const lookup: LookupState = !missing
    ? 'idle'
    : answer
      ? answer.state
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
        setAnswer({ state: res.error === 'offline' ? 'offline' : 'failed', senses: null });
      else if (!res.senses.length) setAnswer({ state: 'notfound', senses: null });
      else setAnswer({ state: 'idle', senses: res.senses });
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
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const picked = useMemo(() => {
    const keys = new Set(preview?.senses.map((s) => s.key) ?? []);
    if (chosen) return new Set([...chosen].filter((k) => keys.has(k)));
    const first = preview?.senses[0]?.key;
    return new Set(first ? [first] : []);
  }, [chosen, preview]);
  const toggle = (key: string) =>
    setChosen(() => {
      const next = new Set(picked);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<QuickAddResult | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
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
  useEffect(() => {
    if (!saved) return;
    const id = window.setTimeout(onClose, SAVED_CLOSE_MS);
    return () => window.clearTimeout(id);
  }, [saved, onClose]);

  const spoken = preview?.term ?? term;
  return (
    <QuickSheet
      route={{ kind: 'term', term }}
      selected={term}
      preview={preview}
      lookup={lookup}
      picked={picked}
      onToggleSense={toggle}
      onAdd={() => void add()}
      saving={saving}
      saved={saved}
      canSpeak={pronunciationSupported()}
      onSpeak={() => void playPronunciation(spoken, voice)}
      onWriteOwn={onWriteOwn}
      busy={busy}
      error={addError ?? error}
      onClose={onClose}
    />
  );
}
