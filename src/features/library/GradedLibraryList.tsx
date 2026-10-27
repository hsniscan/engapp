// The graded reading library list (v0.5 İP5, decision 0047): "Sana uygun" first (texts that
// fit the user's reading difficulty, measured against what they know), then every text with
// level and topic filters and a coverage chip. Opening a text makes (or reuses) its reading
// row and goes to the reader. Rendered by /kitaplik and inside Okuma (İP1). With `hideOwn`
// (under "Metinlerim"), texts the user already has a reading row for are left out: they are
// listed once, above, with their progress (v0.5.1, decision 0054).
//
// Everything reads the downloaded catalogue in Dexie; the only network call is the catalogue
// pull when the list mounts (public data, nothing about the user is sent).
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
  kickGradedCatalogPull,
  openGradedText,
  scoreLibrary,
  type GradedPullOutcome,
} from '@/data/library';
import { db } from '@/data/db';
import {
  filterLibrary,
  readingMinutes,
  suggestTexts,
  understoodPercent,
  type ScoredGradedText,
} from '@/domain/library';
import { readerPath } from '@/domain/texts';
import { GRADED_LEVELS, GRADED_TOPIC_KEYS } from '../../../supabase/functions/_shared/graded-contract';
import { FilterChip } from '@/features/decks/parts';
import { Badge, Button, cn, EmptyState, Icon, Skeleton, toast, type BadgeTone } from '@/ui';

const PAGE = 30;
const SUGGESTIONS = 3;
const TOPIC_ORDER: readonly string[] = GRADED_TOPIC_KEYS;

const FIT_KEY = { '-1': 'easy', '0': 'fits', '1': 'hard' } as const;
const FIT_TONE: Record<string, BadgeTone> = { '-1': 'neutral', '0': 'success', '1': 'warn' };

export function GradedLibraryList({
  className,
  hideOwn = false,
}: { className?: string; hideOwn?: boolean } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const lib = useLiveQuery(() => scoreLibrary(), []);
  const offlineIds = useLiveQuery(async () => new Set((await db.graded_bodies.toCollection().primaryKeys()) as string[]), []);
  const [pull, setPull] = useState<GradedPullOutcome | 'running'>('running');
  const [level, setLevel] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [opening, setOpening] = useState<string | null>(null);

  const refresh = (force = false) => {
    setPull('running');
    void kickGradedCatalogPull({ force }).then(setPull);
  };
  useEffect(() => {
    let live = true;
    void kickGradedCatalogPull().then((r) => live && setPull(r));
    return () => {
      live = false;
    };
  }, []);

  const topics = useMemo(() => {
    const present = new Set(lib?.texts.map((s) => s.entry.topic));
    return TOPIC_ORDER.filter((k) => present.has(k));
  }, [lib]);
  const levels = useMemo(() => {
    const present = new Set(lib?.texts.map((s) => s.entry.level));
    return GRADED_LEVELS.filter((l) => present.has(l));
  }, [lib]);
  // The texts listed: all of them, or (under "Metinlerim") those the user has not opened.
  const listed = useMemo(
    () => (lib ? (hideOwn ? lib.texts.filter((s) => !lib.rows.has(s.entry.id)) : lib.texts) : []),
    [lib, hideOwn],
  );
  const filtered = useMemo(() => filterLibrary(listed, { level, topic }), [listed, level, topic]);
  const suggestions = useMemo(
    () => (lib ? suggestTexts(listed, lib.difficulty, SUGGESTIONS, lib.finished) : []),
    [lib, listed],
  );

  const open = async (s: ScoredGradedText) => {
    if (opening) return;
    setOpening(s.entry.id);
    try {
      const id = await openGradedText({ id: s.entry.id, title: s.entry.title });
      void navigate(readerPath(id));
    } catch {
      toast({ title: t('gradedLibrary.openFailed'), tone: 'danger' });
    } finally {
      setOpening(null);
    }
  };

  if (lib === undefined || (lib.texts.length === 0 && pull === 'running')) {
    return (
      <div className={cn('flex flex-col gap-3', className)} aria-busy="true">
        <span className="sr-only">{t('gradedLibrary.loading')}</span>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (lib.texts.length === 0) {
    const status = typeof pull === 'string' ? pull : pull.status;
    const description =
      status === 'offline'
        ? t('gradedLibrary.emptyOffline')
        : status === 'no_backend'
          ? t('gradedLibrary.emptyNoBackend')
          : status === 'failed'
            ? t('gradedLibrary.emptyFailed')
            : t('gradedLibrary.emptySoon');
    return (
      <EmptyState
        className={className}
        icon="layers"
        title={t('gradedLibrary.emptyTitle')}
        description={description}
        action={
          status === 'offline' || status === 'failed' ? (
            <Button variant="secondary" onClick={() => refresh(true)}>
              {t('gradedLibrary.retry')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  const row = (s: ScoredGradedText) => (
    <TextRow
      key={s.entry.id}
      s={s}
      finished={lib.finished.has(s.entry.id)}
      started={lib.started.has(s.entry.id)}
      offline={offlineIds?.has(s.entry.id) ?? false}
      busy={opening === s.entry.id}
      onOpen={() => void open(s)}
    />
  );

  return (
    <div className={cn('flex flex-col gap-8', className)}>
      <section aria-labelledby="graded-for-you">
        <h2 id="graded-for-you" className="font-serif text-xl font-semibold text-fg">
          {t('gradedLibrary.forYou')}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          {t('gradedLibrary.forYouHint', { difficulty: t(`gradedLibrary.difficulty.${lib.difficulty}`) })}
        </p>
        {suggestions.length > 0 ? (
          <ul aria-label={t('gradedLibrary.suggestionsLabel')} className="mt-3 flex flex-col gap-2">
            {suggestions.map(row)}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-fg-muted">
            {t('gradedLibrary.forYouNone')}
          </p>
        )}
      </section>

      <section aria-labelledby="graded-all">
        <h2 id="graded-all" className="font-serif text-xl font-semibold text-fg">
          {t('gradedLibrary.heading', { count: filtered.length })}
        </h2>
        <div role="group" aria-label={t('gradedLibrary.filters')} className="mt-3 flex flex-col gap-2">
          <ChipRow label={t('gradedLibrary.level')}>
            <FilterChip pressed={level === null} onClick={() => (setLevel(null), setShown(PAGE))}>
              {t('gradedLibrary.all')}
            </FilterChip>
            {levels.map((l) => (
              <FilterChip key={l} pressed={level === l} onClick={() => (setLevel(level === l ? null : l), setShown(PAGE))}>
                {l}
              </FilterChip>
            ))}
          </ChipRow>
          <ChipRow label={t('gradedLibrary.topic')}>
            <FilterChip pressed={topic === null} onClick={() => (setTopic(null), setShown(PAGE))}>
              {t('gradedLibrary.all')}
            </FilterChip>
            {topics.map((k) => (
              <FilterChip key={k} pressed={topic === k} onClick={() => (setTopic(topic === k ? null : k), setShown(PAGE))}>
                {t(`gradedLibrary.topics.${k}`, { defaultValue: k })}
              </FilterChip>
            ))}
          </ChipRow>
        </div>
        {filtered.length === 0 ? (
          <div className="mt-4 flex flex-col items-start gap-2">
            <p className="text-sm text-fg-muted">{t('gradedLibrary.noMatch')}</p>
            <Button variant="secondary" onClick={() => (setLevel(null), setTopic(null))}>
              {t('gradedLibrary.clearFilters')}
            </Button>
          </div>
        ) : (
          <ul aria-label={t('gradedLibrary.listLabel')} className="mt-4 flex flex-col gap-2">
            {filtered.slice(0, shown).map(row)}
          </ul>
        )}
        {filtered.length > shown && (
          <Button variant="secondary" className="mt-4" onClick={() => setShown((n) => n + PAGE)}>
            {t('gradedLibrary.more', { count: filtered.length - shown })}
          </Button>
        )}
      </section>
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {children}
    </div>
  );
}

function TextRow({
  s,
  finished,
  started,
  offline,
  busy,
  onOpen,
}: {
  s: ScoredGradedText;
  finished: boolean;
  started: boolean;
  offline: boolean;
  busy: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const fit = String(s.fit) as '-1' | '0' | '1';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-busy={busy || undefined}
        className="flex w-full min-h-11 items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-border-strong"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-medium text-fg" lang="en">
            {s.entry.title}
          </span>
          <span className="text-sm text-fg-muted">
            {t('gradedLibrary.meta', {
              level: s.entry.level,
              topic: t(`gradedLibrary.topics.${s.entry.topic}`, { defaultValue: s.entry.topic }),
              minutes: readingMinutes(s.entry.words),
            })}
          </span>
          <span className="flex flex-wrap gap-1.5">
            <Badge tone={FIT_TONE[fit]} data-testid="coverage-chip">
              {t('gradedLibrary.understood', { percent: understoodPercent(s.unknownRate) })} ·{' '}
              {t(`gradedLibrary.fit.${FIT_KEY[fit]}`)}
            </Badge>
            {finished ? (
              <Badge tone="accent">{t('gradedLibrary.finished')}</Badge>
            ) : started ? (
              <Badge tone="outline">{t('gradedLibrary.started')}</Badge>
            ) : null}
            {offline && <Badge tone="outline">{t('gradedLibrary.offlineReady')}</Badge>}
          </span>
        </span>
        <Icon name="chevron-right" size={20} className="mt-0.5 shrink-0 text-fg-muted" />
      </button>
    </li>
  );
}
