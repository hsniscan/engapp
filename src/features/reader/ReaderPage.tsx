// The reader, /oku/:textId (v0.5 İP1, decision 0043). Every text the app gets (pasted, PDF,
// article, photo, library, story) opens here: words drawn by what the user knows, "Bu metnin
// %96'sını biliyorsun", tap a word to guess then see it and add it as a card, "Dinleyerek
// oku", and the reading state (position, time, finished, "çok zor / çok kolay"). Everything
// works offline; the text never leaves the device except through the user's own sync.
//
// v0.5.1 (decision 0054): a library text reads from its shared sentences (graded_bodies,
// fetched once and kept), with each sentence's Turkish on request and its recorded audio for
// "Dinleyerek oku"; `/oku/<library id>` opens (or makes) the user's reading row for it; the
// position is tracked while scrolling (not measured after the screen is gone); a word the user
// has a card for shows its meaning at once; the colour legend shows once; and the end of the
// text sums up its new words and adds several at once.
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  getText,
  loadReaderKnowledge,
  logError,
  markReaderLegendSeen,
  readerKnowledgeSignature,
  readerLegendSeen,
  recordReaderEncounters,
  saveReadingProgress,
  setTextFeedback,
  setTextFinished,
  type ReaderKnowledge,
  type TextGloss,
} from '@/data';
import {
  getGradedBody,
  GradedUnavailableError,
  openGradedById,
  setGradedTextBody,
} from '@/data/library';
import { readingSlice } from '@/domain/encounters';
import { gradedReaderBody, type GradedSentenceRow, type GradedSpan } from '@/domain/library';
import { buildReaderView, knownPercent, newWordsIn, type NewWord } from '@/domain/readerView';
import {
  sentenceAt,
  tokenizeReaderText,
  wordCount,
  type TokenizedText,
} from '@/domain/readerTokens';
import { readerPath, type ReaderText, type TextFeedback } from '@/domain/texts';
import type { Id } from '@/domain/types';
import { storyCoverage, storyEncounterNotes } from '@/domain/story';
import { possessiveAccusativeSuffix } from '@/domain/trSuffix';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { StoryEnd, StoryGlossary } from '@/features/story/StoryParts';
import {
  Button,
  buttonClasses,
  Card,
  cn,
  EmptyState,
  Eyebrow,
  IconButton,
  Sheet,
  Skeleton,
  ThemeSwitcher,
  toast,
} from '@/ui';
import { useTextKindLabel } from './kindLabel';
import { MARK_CLASS } from './marks';
import { NewWordsSheet, type NewWordItem } from './NewWordsSheet';
import { ReaderBody, type Selection } from './ReaderBody';
import {
  AlwaysGuessSwitch,
  DifficultyPicker,
  HighlightSwitch,
  ListenSpeedPicker,
  TextSizePicker,
} from './ReadingSettings';
import { TEXT_SCALE, useReaderPrefs } from './readerPrefs';
import { useListenAlong } from './useListenAlong';
import { WordSheet, type WordPick } from './WordSheet';

/** Where ✕ goes when there is no page to go back to (Keşfet → Okuma). */
export const READER_EXIT = '/kesfet?f=okuma';
/**
 * The first entry of a page load always has the location key "default"; with the load's time
 * it still names one opening (a remount counts nothing again, a later visit does).
 */
const PAGE_LOAD = Date.now().toString(36);
const openingKey = (key: string) => (key === 'default' ? `default:${PAGE_LOAD}` : key);
/** Height of the sticky top bar: a sentence under it is not on screen. */
const TOP_BAR = 72;

export function ReaderPage() {
  const { textId = '' } = useParams();
  const text = useLiveQuery(async () => (await getText(textId)) ?? null, [textId]);
  if (text === undefined) return <ReaderSkeleton />;
  if (text === null) return <LibraryRedirect key={textId} id={textId} />;
  if (text.kind === 'graded') return <GradedReader key={text.id} text={text} />;
  return <Reader key={text.id} text={text} />;
}

/**
 * `/oku/<library id>` (a suggestion on Bugün or Keşfet): the user's reading row for that
 * library text, made when needed, replaces the address. Otherwise "Metin bulunamadı".
 */
function LibraryRedirect({ id }: { id: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<'opening' | 'missing' | 'offline'>('opening');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    openGradedById(id)
      .then((rowId) => {
        if (!live) return;
        if (rowId) void navigate(readerPath(rowId), { replace: true });
        else setState('missing');
      })
      .catch((e: unknown) => {
        if (!live) return;
        // Not on this device yet and no internet: say so (no reading row is made, B5).
        if (e instanceof GradedUnavailableError && e.reason === 'offline') return setState('offline');
        if (!(e instanceof GradedUnavailableError)) void logError(e, 'reader.openLibrary');
        setState('missing');
      });
    return () => {
      live = false;
    };
  }, [id, navigate, attempt]);
  if (state === 'missing') return <NotFound />;
  if (state === 'opening') return <ReaderSkeleton />;
  return (
    <>
      <TopBar title="" />
      <div className="mx-auto max-w-(--page-reading) px-4 pt-10 sm:px-6">
        <EmptyState
          tone="card"
          icon="sync-offline"
          title={t('reader.graded.unavailableTitle')}
          description={t('reader.graded.offline')}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setState('opening');
                setAttempt((n) => n + 1);
              }}
            >
              {t('reader.graded.retry')}
            </Button>
          }
        />
      </div>
    </>
  );
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
  // Back where the user came from (Bugün, Keşfet, the add sheet); a direct link goes to Okuma.
  const close = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) void navigate(-1);
    else void navigate(READER_EXIT);
  };
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-border bg-canvas/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-(--page-reading) items-center gap-1 px-2">
        <IconButton icon="arrow-left" label={t('reader.close')} onClick={close} />
        <p
          lang="en"
          className="min-w-0 flex-1 truncate px-1 text-center text-ui font-semibold text-fg"
        >
          {title}
        </p>
        {children ?? <span aria-hidden="true" className="size-11 shrink-0" />}
      </div>
    </header>
  );
}

function ReaderSkeleton({ title = '' }: { title?: string }) {
  const { t } = useTranslation();
  return (
    <>
      <TopBar title={title} />
      <div className="mx-auto max-w-(--page-reading) px-5 pt-8" aria-busy="true">
        <span className="sr-only">{t('reader.loading')}</span>
        <Skeleton className="mb-3 h-3 w-40" />
        <Skeleton className="mb-8 h-7 w-2/3" />
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
      <div className="mx-auto max-w-(--page-reading) px-4 pt-10 sm:px-6">
        <EmptyState
          icon="file"
          title={t('reader.notFound.title')}
          description={t('reader.notFound.body')}
          action={
            <Link to={READER_EXIT} className={buttonClasses({ variant: 'secondary' })}>
              {t('reader.notFound.cta')}
            </Link>
          }
        />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ library texts

/** A library text's sentences on the reader's side: one per reader sentence. */
interface GradedExtras {
  spans: GradedSpan[];
  sentences: GradedSentenceRow[];
  /** The text's own glosses (graded_bodies.glosses): the word sheet's meaning for them. */
  glosses: TextGloss[];
}

type BodyState =
  | { status: 'loading' }
  | { status: 'ready'; body: string; extras: GradedExtras }
  | { status: 'unavailable'; reason: 'offline' | 'no_backend' | 'not_found' };

function GradedReader({ text }: { text: ReaderText }) {
  const { t } = useTranslation();
  const gid = text.graded_id ?? '';
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BodyState>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    getGradedBody(gid)
      .then((b) => {
        if (!live) return;
        const built = gradedReaderBody(b.sentences);
        setState({
          status: 'ready',
          body: built.body,
          extras: { spans: built.spans, sentences: b.sentences, glosses: b.glosses ?? [] },
        });
      })
      .catch((e: unknown) => {
        if (!live) return;
        if (!(e instanceof GradedUnavailableError)) void logError(e, 'reader.gradedBody');
        setState({
          status: 'unavailable',
          reason: e instanceof GradedUnavailableError ? e.reason : 'not_found',
        });
      });
    return () => {
      live = false;
    };
  }, [gid, attempt]);

  // The reading row keeps the text's plain body (progress, "Devam et", decision 0054).
  const readyBody = state.status === 'ready' ? state.body : null;
  useEffect(() => {
    if (readyBody === null || readyBody === text.body) return;
    void setGradedTextBody(text.id, readyBody).catch(
      (e: unknown) => void logError(e, 'reader.gradedBody.save'),
    );
  }, [readyBody, text.id, text.body]);

  if (state.status === 'ready')
    return <Reader text={{ ...text, body: state.body }} graded={state.extras} />;
  // Not on the device yet but read before: the stored text, without its Turkish and audio.
  if (text.body.trim()) return <Reader text={text} graded={null} />;
  if (state.status === 'loading') return <ReaderSkeleton title={text.title} />;
  return (
    <>
      <TopBar title={text.title} />
      <div className="mx-auto max-w-(--page-reading) px-4 pt-10 sm:px-6">
        <EmptyState
          tone="card"
          icon={state.reason === 'offline' ? 'sync-offline' : 'file'}
          title={t('reader.graded.unavailableTitle')}
          description={t(`reader.graded.${state.reason === 'offline' ? 'offline' : 'missing'}`)}
          action={
            state.reason === 'offline' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setState({ status: 'loading' });
                  setAttempt((n) => n + 1);
                }}
              >
                {t('reader.graded.retry')}
              </Button>
            ) : undefined
          }
        />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ the reader

/**
 * Body offset of the first sentence on screen (below the top bar), for resuming; the last one
 * when every sentence is above; null when the text is not on screen (the reader is closing).
 */
function visibleOffset(tokens: TokenizedText): number | null {
  const els = document.querySelectorAll<HTMLElement>('[data-s]');
  if (els.length === 0) return null;
  // Sentences are in reading order, so their bottoms only grow: a binary search measures ~15
  // of them instead of every one above the screen (long texts on slow phones, B19).
  let lo = 0;
  let hi = els.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (els[mid]!.getBoundingClientRect().bottom > TOP_BAR) hi = mid;
    else lo = mid + 1;
  }
  if (lo < els.length) return tokens.sentences[Number(els[lo]!.dataset.s)]?.start ?? 0;
  return tokens.sentences.at(-1)?.start ?? 0;
}

function Reader({ text, graded = null }: { text: ReaderText; graded?: GradedExtras | null }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { settings } = useAppSettings();
  const k = useReaderKnowledge();
  const tokens = useMemo(
    () =>
      tokenizeReaderText(
        text.body,
        graded ? { sentences: graded.spans.map((s) => [s.start, s.end] as const) } : {},
      ),
    [text.body, graded],
  );
  const view = useMemo(() => (k ? buildReaderView(tokens, k, k.noteTerms) : null), [tokens, k]);
  // Meanings the text itself carries: a library text's glosses, a story's glossed words. The
  // word sheet shows them offline and for guests too (B1).
  const textGlosses = useMemo<TextGloss[]>(() => {
    if (graded) return graded.glosses;
    const s = text.story;
    if (!s) return [];
    return [
      ...s.glossed.map((g) => ({ word: g.lemma, tr: g.gloss_tr })),
      ...s.targets.flatMap((g) => (g.gloss_tr ? [{ word: g.lemma, tr: g.gloss_tr }] : [])),
    ];
  }, [graded, text.story]);
  const sentences = useMemo(
    () => tokens.sentences.map((s) => text.body.slice(s.start, s.end)),
    [tokens, text.body],
  );
  // A library text: each reader sentence's own row (Turkish, recorded audio).
  const sentenceRows = useMemo(() => {
    if (!graded) return null;
    const byStart = new Map(graded.spans.map((s) => [s.start, graded.sentences[s.index] ?? null]));
    return tokens.sentences.map((s) => byStart.get(s.start) ?? null);
  }, [graded, tokens]);
  const clips = useMemo(
    () => sentenceRows?.map((r) => r?.audio_key ?? null) ?? null,
    [sentenceRows],
  );
  const voice = settings?.voice ?? 'en-US';
  const [prefs, setPrefs] = useReaderPrefs();
  const listen = useListenAlong(
    sentences,
    voice,
    // Only a library text can have shared recorded audio; a story is the user's own (B17).
    text.kind === 'graded',
    undefined,
    clips,
    Number(prefs.rate),
  );
  const highlight = settings?.reader_highlight !== false;
  const alwaysGuess = settings?.reader_always_guess === true;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [showTr, setShowTr] = useState(false);
  const finished = text.finished_at !== null;

  const translations = useMemo(() => {
    if (!showTr || !sentenceRows) return null;
    return tokens.paragraphs.map((p) => {
      const parts: string[] = [];
      for (let s = p.firstSentence; s < p.endSentence; s++) {
        const tr = sentenceRows[s]?.tr.trim();
        if (tr) parts.push(tr);
      }
      return parts.length ? parts.join(' ') : null;
    });
  }, [showTr, sentenceRows, tokens]);

  // ---- encounters: once per note per opening (the location key survives re-renders).
  const counted = useRef(false);
  useEffect(() => {
    if (!view || !k || counted.current) return;
    counted.current = true;
    const ids = [
      ...new Set([
        ...view.metTerms.map((term) => k.noteIdOf(term)).filter((x): x is Id => x !== null),
        // A daily story counts its target words (İP8) even where a form was not recognised.
        ...storyEncounterNotes(text.story),
      ]),
    ];
    const source = text.kind === 'story' ? 'story' : 'reader';
    if (ids.length)
      void recordReaderEncounters(text.id, openingKey(location.key), ids, undefined, source).catch(
        (e: unknown) => void logError(e, 'reader.encounters'),
      );
  }, [view, k, text.id, text.kind, text.story, location.key]);

  // ---- position: followed while the text is on screen (scrolling, resuming, listening), so
  // leaving saves where the user was, not what a screen being taken down happens to show.
  const offset = useRef(text.progress_offset);
  // After resuming, the position stays the resumed sentence until the user scrolls: the
  // programmatic scroll would otherwise record the sentence half under the top bar, and each
  // opening would move the resume point back (B9).
  const pinned = useRef(false);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (pinned.current) return;
      const at = visibleOffset(tokens);
      if (at !== null) offset.current = at;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const unpin = () => {
      pinned.current = false;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', unpin, { passive: true });
    window.addEventListener('touchstart', unpin, { passive: true });
    window.addEventListener('keydown', unpin);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', unpin);
      window.removeEventListener('touchstart', unpin);
      window.removeEventListener('keydown', unpin);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [tokens]);

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
    const at = cur.finished_at !== null ? cur.progress_offset : offset.current;
    void saveReadingProgress(cur.id, at, add).catch(
      (e: unknown) => void logError(e, 'reader.progress'),
    );
  }, []);
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
    if (!resumed || didResume.current || tokens.sentences.length === 0) return;
    didResume.current = true;
    const s = sentenceAt(tokens, resumeAt);
    document.getElementById(`reader-s-${s}`)?.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -80);
    offset.current = tokens.sentences[s]?.start ?? resumeAt;
    pinned.current = true;
  }, [resumed, resumeAt, tokens]);

  // ---- listen-along follows the sentence (and is where the user is).
  useEffect(() => {
    if (speaking === null) return;
    pinned.current = false;
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
      translation: sentenceRows?.[first.sentence]?.tr ?? null,
    };
  }, [selection, k, tokens, view, text.body, sentenceRows]);

  // ---- a daily story's target words, drawn in bold (İP8).
  const targets = useMemo(() => {
    if (!view || !text.story) return undefined;
    const lemmas = new Set(text.story.targets.filter((x) => x.used).map((x) => x.lemma));
    const out = new Set<number>();
    view.lemmas.forEach((l, i) => {
      const term = view.noteTerms[i];
      if (lemmas.has(l) || (term && lemmas.has(term))) out.add(i);
    });
    return out;
  }, [view, text.story]);

  // ---- the words that were new when the text opened (the end-of-text summary).
  const [newWords, setNewWords] = useState<NewWord[] | null>(null);
  if (view && newWords === null) setNewWords(newWordsIn(tokens, view));
  const [newWordsOpen, setNewWordsOpen] = useState(false);
  const addedCount = useMemo(
    () => (k && newWords ? newWords.filter((w) => k.noteIdOf(w.lemma) !== null).length : 0),
    [k, newWords],
  );
  const toAdd = useMemo<NewWordItem[]>(
    () =>
      k && newWords
        ? newWords
            .filter((w) => k.noteIdOf(w.lemma) === null)
            .map((w) => ({
              lemma: w.lemma,
              written: w.written,
              sentence: sentences[w.sentence] ?? '',
            }))
        : [],
    [k, newWords, sentences],
  );

  // A daily story is measured as it was accepted: without its target words, the lesson (B8).
  const storyTargets = text.story?.targets;
  const coverage = useMemo(() => {
    if (!view || !k) return null;
    if (storyTargets?.length)
      return knownPercent(storyCoverage(tokens, k, storyTargets.map((x) => x.lemma)));
    return knownPercent(view.coverage);
  }, [view, k, tokens, storyTargets]);
  const words = useMemo(() => wordCount(tokens), [tokens]);
  const minutes = Math.round(text.read_ms / 60_000);
  const kindLabel = useTextKindLabel();

  // The tapped word stays in sight above its sheet (the sheet covers the lower part).
  useEffect(() => {
    if (!selection) return;
    const id = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-t="${selection.first}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom > window.innerHeight * 0.42)
        window.scrollBy({ top: r.top - Math.max(TOP_BAR + 16, window.innerHeight * 0.22) });
    });
    return () => cancelAnimationFrame(id);
  }, [selection]);

  const toggleListen = () => {
    if (listen.current !== null) return listen.stop();
    const from = selection
      ? tokens.tokens[selection.first]!.sentence
      : sentenceAt(tokens, visibleOffset(tokens) ?? offset.current);
    if (!listen.start(from)) toast({ title: t('reader.listen.noVoice'), tone: 'danger' });
  };

  const finish = async (done: boolean) => {
    listen.stop();
    try {
      await setTextFinished(text.id, done);
      if (!done) {
        offset.current = 0;
        window.scrollTo({ top: 0 });
      }
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

  const listening = listen.current !== null;
  const meta = [
    kindLabel(text),
    t('reader.words', { count: words }),
    minutes > 0 ? t('reader.readMinutes', { count: minutes }) : null,
  ].filter(Boolean);

  return (
    <>
      <TopBar title={text.title}>
        <IconButton
          icon={listening ? 'pause' : 'play'}
          variant={listening ? 'tonal' : 'ghost'}
          label={listening ? t('reader.listen.stop') : t('reader.listen.start')}
          onClick={toggleListen}
          aria-pressed={listening}
          data-testid="reader-listen"
        />
        <IconButton
          icon="settings"
          label={t('reader.options.open')}
          onClick={() => setOptionsOpen(true)}
        />
      </TopBar>

      <article
        className={cn(
          'mx-auto max-w-(--page-reading) px-5 pt-8 sm:px-6 sm:pt-10',
          selection ? 'pb-[60dvh]' : 'pb-[max(3rem,env(safe-area-inset-bottom))]',
        )}
      >
        <Eyebrow>{meta.join(' · ')}</Eyebrow>
        <h1 lang="en" className="mt-2 font-serif text-heading font-semibold text-fg">
          {text.title}
        </h1>
        <div className="mt-3 mb-8 flex flex-wrap items-center gap-x-3 gap-y-1">
          {coverage !== null ? (
            <p className="text-ui text-fg-muted" data-testid="reader-coverage">
              {t(storyTargets?.length ? 'reader.coverageStory' : 'reader.coverage', {
                pct: coverage,
                suffix: possessiveAccusativeSuffix(coverage),
              })}
            </p>
          ) : (
            <Skeleton className="h-5 w-48" />
          )}
          {resumed && (
            <span className="flex items-center gap-3 text-ui text-fg-muted">
              <span aria-hidden="true">·</span>
              <span>{t('reader.resumed')}</span>
            </span>
          )}
          {sentenceRows && (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon="globe"
              aria-expanded={showTr}
              onClick={() => setShowTr((v) => !v)}
              data-testid="reader-translate"
              className="-ml-3"
            >
              {showTr ? t('reader.translation.hide') : t('reader.translation.show')}
            </Button>
          )}
        </div>

        {highlight && <FirstLegend />}

        {text.story && <StoryGlossary story={text.story} />}

        {text.body.trim() ? (
          <ReaderBody
            body={text.body}
            text={tokens}
            view={view}
            highlight={highlight}
            selection={selection}
            speaking={listen.current}
            fontScale={TEXT_SCALE[prefs.size]}
            onWord={onWord}
            targets={targets}
            translations={translations}
          />
        ) : (
          <p className="text-body text-fg-muted">{t('reader.emptyBody')}</p>
        )}

        {text.story && <StoryEnd story={text.story} />}

        {newWords && newWords.length > 0 && (
          <Card
            as="section"
            tone="accent"
            aria-labelledby="reader-summary"
            className="mt-12 flex flex-col gap-4"
            data-testid="reader-summary"
          >
            <div className="flex flex-col gap-1">
              <Eyebrow>{t('reader.summary.eyebrow')}</Eyebrow>
              <h2 id="reader-summary" className="text-title font-semibold text-fg">
                {addedCount > 0
                  ? t('reader.summary.line', {
                      count: newWords.length,
                      added: addedCount,
                      suffix: possessiveAccusativeSuffix(addedCount),
                    })
                  : t('reader.summary.lineNone', { count: newWords.length })}
              </h2>
            </div>
            {toAdd.length > 0 ? (
              <Button
                variant={finished ? 'primary' : 'secondary'}
                leadingIcon="plus"
                className="self-start"
                onClick={() => setNewWordsOpen(true)}
                data-testid="reader-new-words-open"
              >
                {t('reader.summary.cta')}
              </Button>
            ) : (
              <Link
                to="/study"
                className={buttonClasses({
                  variant: finished ? 'primary' : 'secondary',
                  className: 'self-start',
                })}
                data-testid="reader-study-new"
              >
                {t('reader.summary.study')}
              </Link>
            )}
          </Card>
        )}

        <footer className="mt-12 flex flex-col items-center gap-4 border-t border-border pt-8 text-center">
          {finished ? (
            <>
              <p className="text-title font-semibold text-fg">{t('reader.finished.title')}</p>
              <p className="text-ui text-fg-muted">{t('reader.feedback.question')}</p>
              <div
                className="grid w-full max-w-sm grid-cols-2 gap-2"
                role="group"
                aria-label={t('reader.feedback.question')}
              >
                {(['hard', 'easy'] as const).map((f) => (
                  <Button
                    key={f}
                    variant={text.feedback === f ? 'tonal' : 'secondary'}
                    aria-pressed={text.feedback === f}
                    leadingIcon={text.feedback === f ? 'check' : undefined}
                    onClick={() => void feedback(f)}
                  >
                    {t(`reader.feedback.${f}`)}
                  </Button>
                ))}
              </div>
              {text.feedback && (
                <p role="status" className="text-meta text-fg-muted">
                  {t('reader.feedback.thanks')}
                </p>
              )}
              <Button variant="ghost" leadingIcon="refresh" onClick={() => void finish(false)}>
                {t('reader.finished.again')}
              </Button>
            </>
          ) : (
            <Button
              size="lg"
              fullWidth
              className="max-w-sm"
              onClick={() => void finish(true)}
              data-testid="reader-finish"
            >
              {t('reader.finished.cta')}
            </Button>
          )}
        </footer>
      </article>

      <WordSheet
        pick={pick}
        glosses={textGlosses}
        voice={voice}
        alwaysGuess={alwaysGuess}
        onClose={() => setSelection(null)}
        onExtend={extend}
        onListenHere={() => {
          if (!selection) return;
          const from = tokens.tokens[selection.first]!.sentence;
          setSelection(null);
          if (!listen.start(from)) toast({ title: t('reader.listen.noVoice'), tone: 'danger' });
        }}
      />

      <NewWordsSheet
        open={newWordsOpen}
        onOpenChange={setNewWordsOpen}
        words={toAdd}
        glosses={textGlosses}
      />

      <Sheet open={optionsOpen} onOpenChange={setOptionsOpen} title={t('reader.options.title')}>
        <div className="flex flex-col gap-6 pb-1">
          <div className="flex flex-col gap-5">
            <TextSizePicker value={prefs.size} onChange={(size) => setPrefs({ size })} />
            <ThemeSwitcher />
            <ListenSpeedPicker value={prefs.rate} onChange={(rate) => setPrefs({ rate })} />
          </div>
          <div className="flex flex-col gap-4 border-t border-border pt-5">
            <HighlightSwitch />
            {highlight && (
              <Card tone="sunken" padding="sm" className="px-4">
                <Legend />
              </Card>
            )}
            <AlwaysGuessSwitch />
          </div>
          <div className="border-t border-border pt-5">
            <DifficultyPicker />
          </div>
        </div>
      </Sheet>
    </>
  );
}

/**
 * The colour legend, once (the first time a coloured text opens on this device); it can be
 * closed, and stays in Okuma ayarları.
 */
function FirstLegend() {
  const { t } = useTranslation();
  const seen = useLiveQuery(() => readerLegendSeen(), []);
  // Decided once per opening (shown when it was unseen) and recorded as seen right away.
  const [unseen, setUnseen] = useState<boolean | null>(null);
  if (unseen === null && seen !== undefined) setUnseen(!seen);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (unseen)
      void markReaderLegendSeen().catch((e: unknown) => void logError(e, 'reader.legend'));
  }, [unseen]);
  if (!unseen || closed) return null;
  return (
    <Card
      as="section"
      aria-labelledby="reader-legend"
      className="mb-8 flex flex-col gap-3"
      data-testid="reader-legend"
    >
      <div className="-mt-1 -mr-2 flex items-center justify-between gap-2">
        <h2 id="reader-legend" className="text-ui font-semibold text-fg">
          {t('reader.legend.title')}
        </h2>
        <IconButton
          icon="x"
          size="sm"
          label={t('reader.legend.close')}
          tooltip={false}
          onClick={() => setClosed(true)}
        />
      </div>
      <Legend />
      <p className="text-meta text-fg-muted">{t('reader.legend.later')}</p>
    </Card>
  );
}

function Legend() {
  const { t } = useTranslation();
  const items = [
    ['new', MARK_CLASS.new],
    ['learning', MARK_CLASS.learning],
    ['consolidating', MARK_CLASS.consolidating],
    ['known', MARK_CLASS.plain],
  ] as const;
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map(([key, cls]) => (
        <li key={key} className="flex items-center gap-3 text-meta text-fg-muted">
          <span className="w-16 shrink-0">
            <span lang="en" className={cn('rounded-xs font-serif text-body text-fg', cls)}>
              {t('reader.legend.sample')}
            </span>
          </span>
          {t(`reader.legend.${key}`)}
        </li>
      ))}
    </ul>
  );
}
