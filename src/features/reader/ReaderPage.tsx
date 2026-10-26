// The reader, /oku/:textId (v0.5 İP1, decision 0043). Every text the app gets (pasted, PDF,
// article, photo, library, story) opens here: words drawn by what the user knows, "Bu metnin
// %96'sını biliyorsun", tap a word to guess then see it and add it as a card, "Dinleyerek
// oku", and the reading state (position, time, finished, "çok zor / çok kolay"). Everything
// works offline; the text never leaves the device except through the user's own sync.
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  getText,
  loadReaderKnowledge,
  logError,
  readerKnowledgeSignature,
  recordReaderEncounters,
  saveReadingProgress,
  setTextFeedback,
  setTextFinished,
  type ReaderKnowledge,
} from '@/data';
import { readingSlice } from '@/domain/encounters';
import { buildReaderView, knownPercent } from '@/domain/readerView';
import {
  sentenceAt,
  tokenizeReaderText,
  wordCount,
  type TokenizedText,
} from '@/domain/readerTokens';
import type { ReaderText, TextFeedback } from '@/domain/texts';
import type { Id } from '@/domain/types';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { Button, cn, Dialog, EmptyState, Icon, IconButton, Skeleton, toast } from '@/ui';
import { MARK_CLASS } from './marks';
import { ReaderBody, type Selection } from './ReaderBody';
import { DifficultyPicker, HighlightSwitch } from './ReadingSettings';
import { useListenAlong } from './useListenAlong';
import { WordSheet, type WordPick } from './WordSheet';

const EXIT = '/decks?tab=reading';
/**
 * The first entry of a page load always has the location key "default"; with the load's time
 * it still names one opening (a remount counts nothing again, a later visit does).
 */
const PAGE_LOAD = Date.now().toString(36);
const openingKey = (key: string) => (key === 'default' ? `default:${PAGE_LOAD}` : key);

export function ReaderPage() {
  const { textId = '' } = useParams();
  const text = useLiveQuery(async () => (await getText(textId)) ?? null, [textId]);
  if (text === undefined) return <ReaderSkeleton />;
  if (text === null) return <NotFound />;
  return <Reader key={text.id} text={text} />;
}

/** The knowledge model, reloaded when a card, an answer or a "Biliyorum" word changes it. */
function useReaderKnowledge(): ReaderKnowledge | null {
  const sig = useLiveQuery(() => readerKnowledgeSignature(), []);
  const [k, setK] = useState<ReaderKnowledge | null>(null);
  useEffect(() => {
    if (sig === undefined) return;
    let live = true;
    loadReaderKnowledge()
      .then((next) => live && setK(next))
      .catch((e: unknown) => void logError(e, 'reader.knowledge'));
    return () => {
      live = false;
    };
  }, [sig]);
  return k;
}

function TopBar({ title, children }: { title: string; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Back where the user came from (Bugün, Desteler, the add sheet); a direct link goes to Okuma.
  const close = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) void navigate(-1);
    else void navigate(EXIT);
  };
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-border bg-canvas/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-1 px-2 sm:px-4">
        <IconButton icon="x" label={t('reader.close')} onClick={close} />
        <p className="min-w-0 flex-1 truncate px-1 text-[0.9375rem] font-medium text-fg-muted">
          {title}
        </p>
        {children}
      </div>
    </header>
  );
}

function ReaderSkeleton() {
  return (
    <>
      <TopBar title="" />
      <div className="mx-auto max-w-[40rem] px-5 pt-8" aria-busy="true">
        <Skeleton className="mb-6 h-7 w-2/3" />
        <Skeleton lines={10} />
      </div>
    </>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <>
      <TopBar title="" />
      <div className="mx-auto max-w-xl px-5 pt-10">
        <EmptyState
          icon="info"
          title={t('reader.notFound.title')}
          description={t('reader.notFound.body')}
          action={
            <Link to={EXIT} className="font-medium text-accent-text underline underline-offset-4">
              {t('reader.notFound.cta')}
            </Link>
          }
        />
      </div>
    </>
  );
}

/** Body offset of the first sentence on screen (below the top bar), for resuming. */
function visibleOffset(tokens: TokenizedText): number {
  const top = 72;
  const els = document.querySelectorAll<HTMLElement>('[data-s]');
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.bottom > top) return tokens.sentences[Number(el.dataset.s)]?.start ?? 0;
  }
  return tokens.sentences.at(-1)?.start ?? 0;
}

function Reader({ text }: { text: ReaderText }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { settings } = useAppSettings();
  const k = useReaderKnowledge();
  const tokens = useMemo(() => tokenizeReaderText(text.body), [text.body]);
  const view = useMemo(() => (k ? buildReaderView(tokens, k, k.noteTerms) : null), [tokens, k]);
  const sentences = useMemo(
    () => tokens.sentences.map((s) => text.body.slice(s.start, s.end)),
    [tokens, text.body],
  );
  const voice = settings?.voice ?? 'en-US';
  const listen = useListenAlong(sentences, voice, text.kind === 'graded' || text.kind === 'story');
  const highlight = settings?.reader_highlight !== false;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const finished = text.finished_at !== null;

  // ---- encounters: once per note per opening (the location key survives re-renders).
  const counted = useRef(false);
  useEffect(() => {
    if (!view || !k || counted.current) return;
    counted.current = true;
    const ids = [
      ...new Set(view.metTerms.map((term) => k.noteIdOf(term)).filter((x): x is Id => x !== null)),
    ];
    if (ids.length)
      void recordReaderEncounters(text.id, openingKey(location.key), ids).catch(
        (e: unknown) => void logError(e, 'reader.encounters'),
      );
  }, [view, k, text.id, location.key]);

  // ---- reading time (activity-based, idle gaps capped) and position, saved on leave / hide.
  const acc = useRef(0);
  const last = useRef(0);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  const flush = useCallback(() => {
    const now = Date.now();
    acc.current += readingSlice(last.current, now);
    last.current = now;
    const add = acc.current;
    acc.current = 0;
    const cur = textRef.current;
    const offset = cur.finished_at !== null ? cur.progress_offset : visibleOffset(tokens);
    void saveReadingProgress(cur.id, offset, add).catch(
      (e: unknown) => void logError(e, 'reader.progress'),
    );
  }, [tokens]);
  useEffect(() => {
    last.current = Date.now();
    const activity = () => {
      const now = Date.now();
      acc.current += readingSlice(last.current, now);
      last.current = now;
    };
    const vis = () => {
      if (document.visibilityState === 'hidden') flush();
      else last.current = Date.now();
    };
    window.addEventListener('scroll', activity, { passive: true });
    window.addEventListener('pointerdown', activity, { passive: true });
    window.addEventListener('keydown', activity);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('scroll', activity);
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);
  // Listening counts as reading.
  const speaking = listen.current;
  useEffect(() => {
    if (speaking === null) return;
    const now = Date.now();
    acc.current += readingSlice(last.current, now);
    last.current = now;
  }, [speaking]);

  // ---- resume where the user left off.
  const [resumed] = useState(() => !finished && text.progress_offset > 0);
  const [resumeAt] = useState(text.progress_offset);
  const didResume = useRef(false);
  useEffect(() => {
    // Once, when the text first renders, at the position it was opened with.
    if (!resumed || didResume.current) return;
    didResume.current = true;
    const s = sentenceAt(tokens, resumeAt);
    document.getElementById(`reader-s-${s}`)?.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -80);
  }, [resumed, resumeAt, tokens]);

  // ---- listen-along follows the sentence.
  useEffect(() => {
    if (speaking === null) return;
    document
      .getElementById(`reader-s-${speaking}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [speaking]);

  // ---- word selection.
  const onWord = useCallback(
    (i: number) => {
      const tok = tokens.tokens[i];
      if (!tok || !/\p{L}/u.test(tok.text)) return;
      const ph = view?.phrases.find((p) => i >= p.first && i < p.end);
      setSelection(ph ? { first: ph.first, end: ph.end } : { first: i, end: i + 1 });
    },
    [tokens, view],
  );
  const extend = (side: 'before' | 'after') =>
    setSelection((sel) => {
      if (!sel) return sel;
      const sen = tokens.sentences[tokens.tokens[sel.first]!.sentence]!;
      if (side === 'before' && sel.first > sen.firstToken) return { ...sel, first: sel.first - 1 };
      if (side === 'after' && sel.end < sen.endToken) return { ...sel, end: sel.end + 1 };
      return sel;
    });
  const pick = useMemo<WordPick | null>(() => {
    if (!selection || !k) return null;
    const first = tokens.tokens[selection.first]!;
    const lastTok = tokens.tokens[selection.end - 1]!;
    const sen = tokens.sentences[first.sentence]!;
    const phrase = selection.end - selection.first > 1;
    const written = text.body.slice(first.start, lastTok.end);
    const words = tokens.tokens.slice(selection.first, selection.end);
    const lemma = phrase
      ? [k.lemmatize(words[0]!.norm), ...words.slice(1).map((w) => w.norm)].join(' ')
      : (view?.lemmas[selection.first] ?? k.lemmatize(first.norm));
    const noteTerm = view?.noteTerms[selection.first] ?? null;
    const ownTerm = noteTerm && (!phrase || noteTerm === lemma) ? noteTerm : phrase ? lemma : null;
    const noteId = ownTerm ? k.noteIdOf(ownTerm) : null;
    return {
      written,
      lemma,
      sentence: text.body.slice(sen.start, sen.end),
      stage: noteId && ownTerm ? k.stage(ownTerm) : null,
      noteId,
      canExtend: {
        before: selection.first > sen.firstToken,
        after: selection.end < sen.endToken && selection.end - selection.first < 6,
      },
      phrase,
    };
  }, [selection, k, tokens, view, text.body]);

  const coverage = view ? knownPercent(view.coverage) : null;
  const words = useMemo(() => wordCount(tokens), [tokens]);
  const minutes = Math.round(text.read_ms / 60_000);

  const toggleListen = () => {
    if (listen.current !== null) return listen.stop();
    const from = selection
      ? tokens.tokens[selection.first]!.sentence
      : sentenceAt(tokens, visibleOffset(tokens));
    if (!listen.start(from)) toast({ title: t('reader.listen.noVoice'), tone: 'danger' });
  };

  const finish = async (done: boolean) => {
    listen.stop();
    try {
      await setTextFinished(text.id, done);
      if (!done) window.scrollTo({ top: 0 });
    } catch (e) {
      void logError(e, 'reader.finish');
    }
  };
  const feedback = async (f: TextFeedback) => {
    try {
      await setTextFeedback(text.id, text.feedback === f ? null : f);
    } catch (e) {
      void logError(e, 'reader.feedback');
    }
  };

  return (
    <>
      <TopBar title={text.title}>
        <Button
          variant={listen.current !== null ? 'secondary' : 'ghost'}
          size="sm"
          onClick={toggleListen}
          aria-pressed={listen.current !== null}
          data-testid="reader-listen"
        >
          {listen.current !== null ? <Icon name="pause" size={18} /> : <PlayGlyph />}
          <span className="max-sm:sr-only">
            {listen.current !== null ? t('reader.listen.stop') : t('reader.listen.start')}
          </span>
        </Button>
        <IconButton
          icon="settings"
          label={t('reader.options.open')}
          onClick={() => setOptionsOpen(true)}
        />
      </TopBar>

      <article className="mx-auto max-w-[40rem] px-5 pt-6 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-10">
        <h1
          lang="en"
          className="font-serif text-[1.75rem] leading-tight font-semibold text-fg sm:text-[2rem]"
        >
          {text.title}
        </h1>
        <div className="mt-3 mb-7 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fg-muted">
          {coverage !== null ? (
            <span
              className="inline-flex h-7 items-center rounded-full bg-surface-sunken px-3 font-medium text-fg"
              data-testid="reader-coverage"
            >
              {t('reader.coverage', { pct: coverage })}
            </span>
          ) : (
            <Skeleton className="h-7 w-48 rounded-full" />
          )}
          <span>{t('reader.words', { count: words })}</span>
          {minutes > 0 && <span>{t('reader.readMinutes', { count: minutes })}</span>}
          {resumed && <span>{t('reader.resumed')}</span>}
        </div>

        {text.body.trim() ? (
          <ReaderBody
            body={text.body}
            text={tokens}
            view={view}
            highlight={highlight}
            selection={selection}
            speaking={listen.current}
            onWord={onWord}
          />
        ) : (
          <p className="text-fg-muted">{t('reader.emptyBody')}</p>
        )}

        <footer className="mt-12 flex flex-col items-center gap-4 border-t border-border pt-8 text-center">
          {finished ? (
            <>
              <p className="font-serif text-xl font-semibold text-fg">
                {t('reader.finished.title')}
              </p>
              <p className="text-sm text-fg-muted">{t('reader.feedback.question')}</p>
              <div className="flex gap-2" role="group" aria-label={t('reader.feedback.question')}>
                {(['hard', 'easy'] as const).map((f) => (
                  <Button
                    key={f}
                    variant={text.feedback === f ? 'primary' : 'secondary'}
                    aria-pressed={text.feedback === f}
                    onClick={() => void feedback(f)}
                  >
                    {t(`reader.feedback.${f}`)}
                  </Button>
                ))}
              </div>
              {text.feedback && (
                <p className="text-sm text-fg-muted">{t('reader.feedback.thanks')}</p>
              )}
              <Button variant="ghost" onClick={() => void finish(false)}>
                {t('reader.finished.again')}
              </Button>
            </>
          ) : (
            <Button size="lg" onClick={() => void finish(true)} data-testid="reader-finish">
              {t('reader.finished.cta')}
            </Button>
          )}
        </footer>
      </article>

      <WordSheet pick={pick} voice={voice} onClose={() => setSelection(null)} onExtend={extend} />

      <Dialog
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        variant="sheet"
        title={t('reader.options.title')}
      >
        <div className="flex flex-col gap-5 pb-1">
          <HighlightSwitch />
          <Legend highlight={highlight} />
          <DifficultyPicker />
        </div>
      </Dialog>
    </>
  );
}

function Legend({ highlight }: { highlight: boolean }) {
  const { t } = useTranslation();
  if (!highlight) return null;
  const items = [
    ['new', MARK_CLASS.new],
    ['learning', MARK_CLASS.learning],
    ['consolidating', MARK_CLASS.consolidating],
    ['known', MARK_CLASS.plain],
  ] as const;
  return (
    <ul className="flex flex-col gap-2 text-sm text-fg-muted">
      {items.map(([key, cls]) => (
        <li key={key} className="flex items-center gap-3">
          <span lang="en" className={cn('w-16 font-serif text-base text-fg', cls)}>
            {t('reader.legend.sample')}
          </span>
          {t(`reader.legend.${key}`)}
        </li>
      ))}
    </ul>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" fill="currentColor">
      <path d="M8 5.5v13a.75.75 0 0 0 1.14.64l10.4-6.5a.75.75 0 0 0 0-1.28L9.14 4.86A.75.75 0 0 0 8 5.5z" />
    </svg>
  );
}
