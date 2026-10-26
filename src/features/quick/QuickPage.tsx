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
import { getAuthState } from '@/features/auth/session';
import { getSettings, logError } from '@/data';
import { readerPath } from '@/domain/texts';
import { extractCapture, saveCapture } from '@/features/add/capture';
import { playPronunciation, pronunciationSupported } from '@/features/review/pronunciation';
import { shareHref } from '@/features/share/route';
import { historyIndex } from '@/native/backButton';
import { isNativeApp } from '@/native/platform';
import { closeQuick, continueInApp, isQuickHost } from '@/native/quickHost';
import { QuickSheet } from './QuickSheet';
import { addFormPath, quickTitle, routeQuick } from './route';
import { useTermLookup } from './useTermLookup';

/** How long the sheet stays after "Karta ekle" before it closes (the confirmation). */
export const SAVED_CLOSE_MS = 1200;
/** Android cold start: how long to wait for the selection before showing the empty state. */
const WAIT_FOR_SELECTION_MS = 4000;

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
            const id = await saveCapture({
              kind: 'paste',
              title: quickTitle(route.text),
              body: route.text,
            });
            return { path: readerPath(id) };
          })
        }
        onExtract={() =>
          void handOver('extract', async () => {
            // In the Android sheet, and for guests (who are asked to sign in there), the text
            // goes to "Paylaş → Engapp", which shows the same two choices. In the browser a
            // signed-in user's choice is final: the text is saved and its extraction opens.
            if ((await isQuickHost()) || getAuthState().status !== 'signed_in')
              return { shareText: route.text };
            const job = await extractCapture({
              kind: 'paste',
              title: quickTitle(route.text),
              body: route.text,
            });
            return { path: `/import/${job}` };
          })
        }
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
  const voice = useLiveQuery(async () => (await getSettings()).voice, []) ?? 'en-US';
  const { preview, lookup, picked, toggle, add, saving, saved, addError } = useTermLookup(term);
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
