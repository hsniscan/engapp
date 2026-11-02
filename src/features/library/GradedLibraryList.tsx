// The graded reading library list (v0.5 İP5, decision 0047; Çam look v0.5.2): "Sana uygun"
// first (texts that fit the user's reading difficulty, measured against what they know), then
// every text with a search box (title or topic, v0.5.2), level and topic chips and a coverage
// badge. Opening a text makes (or reuses) its reading row and goes to the reader. With
// `hideOwn` (under "Metinlerim"), texts the user already has a reading row for are left out:
// they are listed once, above, with their progress (v0.5.1, decision 0054).
//
// Everything reads the downloaded catalogue in Dexie; the only network call is the catalogue
// pull when the list mounts (public data, nothing about the user is sent).
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  cn,
  EmptyState,
  Icon,
  SectionHeader,
  Skeleton,
  TextField,
  toast,
  type BadgeTone,
} from '@/ui';

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
  const offlineIds = useLiveQuery(
    async () => new Set((await db.graded_bodies.toCollection().primaryKeys()) as string[]),
    [],
  );
  const [pull, setPull] = useState<GradedPullOutcome | 'running'>('running');
  const [level, setLevel] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [query, setQuery] = useState('');
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

  const topicLabel = useCallback(
    (k: string) => t(`gradedLibrary.topics.${k}`, { defaultValue: k }),
    [t],
  );
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
  const filtered = useMemo(
    () => filterLibrary(listed, { level, topic, query, topicLabel }),
    [listed, level, topic, query, topicLabel],
  );
  const suggestions = useMemo(
    () => (lib ? suggestTexts(listed, lib.difficulty, SUGGESTIONS, lib.finished) : []),
    [lib, listed],
  );
  const filtering = level !== null || topic !== null || query.trim() !== '';
  const clear = () => {
    setLevel(null);
    setTopic(null);
    setQuery('');
    setShown(PAGE);
  };

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
        <Skeleton className="h-6 w-32" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-card" />
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
        tone="card"
        icon={status === 'offline' ? 'sync-offline' : 'book'}
        title={t('gradedLibrary.emptyTitle')}
        description={description}
        action={
          status === 'offline' || status === 'failed' ? (
            <Button variant="secondary" leadingIcon="refresh" onClick={() => refresh(true)}>
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
      topic={topicLabel(s.entry.topic)}
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
        <SectionHeader
          id="graded-for-you"
          title={t('gradedLibrary.forYou')}
          description={t('gradedLibrary.forYouHint', {
            difficulty: t(`gradedLibrary.difficulty.${lib.difficulty}`),
          })}
        />
        {suggestions.length > 0 ? (
          <ul
            aria-label={t('gradedLibrary.suggestionsLabel')}
            className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface"
          >
            {suggestions.map(row)}
          </ul>
        ) : (
          <Card tone="sunken" className="text-ui text-fg-muted">
            {t('gradedLibrary.forYouNone')}
          </Card>
        )}
      </section>

      <section aria-labelledby="graded-all" className="flex flex-col gap-3">
        <SectionHeader
          id="graded-all"
          className="mb-0"
          title={t('gradedLibrary.title')}
          description={t('gradedLibrary.heading', { count: filtered.length })}
        />
        <TextField
          type="search"
          label={t('gradedLibrary.search')}
          hideLabel
          placeholder={t('gradedLibrary.searchPlaceholder')}
          leadingIcon="search"
          value={query}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
          }}
          data-testid="library-search"
        />
        <div role="group" aria-label={t('gradedLibrary.filters')} className="flex flex-col gap-1">
          <ChipRow label={t('gradedLibrary.level')}>
            <Chip selected={level === null} onClick={() => (setLevel(null), setShown(PAGE))}>
              {t('gradedLibrary.allLevels')}
            </Chip>
            {levels.map((l) => (
              <Chip
                key={l}
                selected={level === l}
                onClick={() => (setLevel(level === l ? null : l), setShown(PAGE))}
              >
                {l}
              </Chip>
            ))}
          </ChipRow>
          <ChipRow label={t('gradedLibrary.topic')}>
            <Chip selected={topic === null} onClick={() => (setTopic(null), setShown(PAGE))}>
              {t('gradedLibrary.allTopics')}
            </Chip>
            {topics.map((k) => (
              <Chip
                key={k}
                selected={topic === k}
                onClick={() => (setTopic(topic === k ? null : k), setShown(PAGE))}
              >
                {topicLabel(k)}
              </Chip>
            ))}
          </ChipRow>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            compact
            tone="placeholder"
            icon="search"
            title={t('gradedLibrary.noMatch')}
            description={query.trim() ? t('gradedLibrary.noMatchQuery', { query: query.trim() }) : undefined}
            action={
              filtering ? (
                <Button variant="secondary" onClick={clear}>
                  {t('gradedLibrary.clearFilters')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul
            aria-label={t('gradedLibrary.listLabel')}
            className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface"
          >
            {filtered.slice(0, shown).map(row)}
          </ul>
        )}
        {filtered.length > shown && (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => setShown((n) => n + PAGE)}
          >
            {t('gradedLibrary.more', { count: filtered.length - shown })}
          </Button>
        )}
      </section>
    </div>
  );
}

function TextRow({
  s,
  topic,
  finished,
  started,
  offline,
  busy,
  onOpen,
}: {
  s: ScoredGradedText;
  topic: string;
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
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-(--duration-micro) hover:bg-hover focus-visible:outline-offset-[-2px]"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span lang="en" className="font-serif text-lead font-medium text-fg">
            {s.entry.title}
          </span>
          <span className="text-meta text-fg-muted">
            {t('gradedLibrary.meta', {
              level: s.entry.level,
              topic,
              minutes: readingMinutes(s.entry.words),
            })}
          </span>
          <span className="flex flex-wrap gap-1.5 pt-0.5">
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
        <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
      </button>
    </li>
  );
}
