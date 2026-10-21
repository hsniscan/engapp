import { LIMITS } from '@/domain/limits';
import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import {
  confirmImport,
  db,
  deleteImportJob,
  logError,
  markCandidateKnown,
  updateImportCandidate,
  type CandidateChoice,
  type ImportCandidateRecord,
  type ImportJobRecord,
} from '@/data';
import { BUCKETS } from '@/domain/candidates';
import type { CandidateBucket, TermType } from '@/domain/types';
import { posLabel } from '@/features/cards/labels';
import { LevelBadge } from '@/features/levels/LevelBadge';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { requestSync } from '@/sync';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  EmptyState,
  Icon,
  IconButton,
  Page,
  SegmentedControl,
  Skeleton,
  buttonClasses,
  cn,
  toast,
} from '@/ui';
import { JobCard } from './JobCard';

/** Candidates below this confidence are flagged ("Emin değil"). */
export const LOW_CONFIDENCE = 0.7;

type Filter = 'all' | TermType;

/** /import/:jobId — review AI candidates, fix meanings in place, add the chosen ones. */
export function ImportPreviewPage() {
  const { jobId = '' } = useParams();
  const { t } = useTranslation();
  const job = useLiveQuery(
    async () => ((await db.import_jobs.get(jobId)) as ImportJobRecord | undefined) ?? null,
    [jobId],
  );

  if (job === undefined) {
    return (
      <Page title={t('importer.preview.title')} width="wide">
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      </Page>
    );
  }
  if (job === null) {
    return (
      <Page title={t('importer.preview.title')}>
        <EmptyState
          icon="file"
          title={t('importer.preview.notFound')}
          description={t('importer.preview.notFoundBody')}
          action={
            <Link to="/add" className={buttonClasses({ variant: 'secondary' })}>
              {t('importer.preview.backToAdd')}
            </Link>
          }
        />
      </Page>
    );
  }
  if (job.status === 'done') {
    return (
      <Page title={t('importer.preview.title')}>
        <EmptyState
          icon="check"
          title={t('importer.preview.alreadyDone')}
          description={t('importer.preview.alreadyDoneBody')}
          action={
            <Link to="/library" className={buttonClasses({ variant: 'secondary' })}>
              {t('importer.preview.toLibrary')}
            </Link>
          }
        />
      </Page>
    );
  }
  if (job.status !== 'ready') {
    return (
      <Page title={t('importer.preview.title')} description={t('importer.preview.notReady')}>
        <JobCard job={job} />
      </Page>
    );
  }
  return <CandidateReview job={job} />;
}

interface RowState {
  selected: boolean;
  edit: string | null;
}

function CandidateReview({ job }: { job: ImportJobRecord }) {
  const { t } = useTranslation();
  const rows = useLiveQuery(
    async () =>
      (
        (await db.import_candidates
          .where('job_id')
          .equals(job.id)
          .toArray()) as ImportCandidateRecord[]
      ).sort((a, b) => (a.rank ?? a.order) - (b.rank ?? b.order)),
    [job.id],
  );
  if (!rows) {
    return (
      <Page title={t('importer.preview.title')} width="wide">
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      </Page>
    );
  }
  return <CandidateList job={job} rows={rows} />;
}

/** Preview sections in display order; "too_hard" is shown only for vocabulary lists. */
type Section = CandidateBucket;

/** A row's section (rows of jobs from before smart extraction: "Senin için"). */
const bucketOf = (r: ImportCandidateRecord): Section => r.bucket ?? 'for_you';
/** Shown rows: a word more than one level up is only counted for prose (owner's rule). */
const isShown = (r: ImportCandidateRecord) => bucketOf(r) !== 'too_hard' || r.from_list;

function CandidateList({ job, rows }: { job: ImportJobRecord; rows: ImportCandidateRecord[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { settings } = useAppSettings();
  // Selection and edits live in React state (instant on 300+ rows) and are written through
  // to Dexie in the background, so a reload keeps them.
  const [state, setState] = useState(
    () =>
      new Map<string, RowState>(
        rows.map((r) => [r.id, { selected: r.selected, edit: r.meaning_tr_edit }]),
      ),
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  // null = the default: "Kolay olabilir" follows show_easy_candidates, the others are closed.
  const [open, setOpen] = useState<Partial<Record<Section, boolean>>>({});
  const isOpen = (s: Section) =>
    s === 'for_you' || (open[s] ?? (s === 'easy' && settings?.show_easy_candidates === true));

  const counts = useMemo(() => {
    const c = { all: 0, word: 0, phrase: 0, pattern: 0 };
    for (const r of rows) {
      if (!isShown(r)) continue;
      c.all++;
      c[r.term_type]++;
    }
    return c;
  }, [rows]);

  const sections = useMemo(() => {
    const by: Record<Section, ImportCandidateRecord[]> = {
      for_you: [],
      easy: [],
      known: [],
      too_hard: [],
    };
    for (const r of rows) by[bucketOf(r)].push(r);
    return by;
  }, [rows]);

  const visibleIn = useCallback(
    (s: Section) =>
      sections[s].filter((r) => isShown(r) && (filter === 'all' || r.term_type === filter)),
    [sections, filter],
  );

  const selectedCount = useMemo(() => {
    let n = 0;
    for (const v of state.values()) if (v.selected) n++;
    return n;
  }, [state]);

  const toggle = useCallback((id: string, selected: boolean) => {
    setState((s) => {
      const next = new Map(s);
      next.set(id, { ...next.get(id)!, selected });
      return next;
    });
    void updateImportCandidate(id, { selected });
  }, []);

  const editMeaning = useCallback((id: string, edit: string | null) => {
    setState((s) => {
      const next = new Map(s);
      next.set(id, { ...next.get(id)!, edit });
      return next;
    });
  }, []);

  const persistMeaning = useCallback((id: string, edit: string | null) => {
    void updateImportCandidate(id, { meaning_tr_edit: edit });
  }, []);

  const markKnown = useCallback(
    async (id: string, term: string) => {
      try {
        const moved = await markCandidateKnown(id);
        setState((s) => {
          const next = new Map(s);
          for (const m of moved) next.set(m, { ...next.get(m)!, selected: false });
          return next;
        });
        toast({ title: t('importer.preview.markedKnown', { term }) });
      } catch (e) {
        void logError(e, 'import.markKnown');
        toast({ title: t('importer.preview.markKnownFailed'), tone: 'danger' });
      }
    },
    [t],
  );

  const setAll = (list: ImportCandidateRecord[], selected: boolean) => {
    setState((s) => {
      const next = new Map(s);
      for (const r of list) next.set(r.id, { ...next.get(r.id)!, selected });
      return next;
    });
    void db.transaction('rw', db.import_candidates, async () => {
      for (const r of list) await db.import_candidates.update(r.id, { selected });
    });
  };

  const confirm = async () => {
    if (selectedCount === 0) return;
    setBusy(true);
    try {
      const choices = new Map<string, CandidateChoice>();
      for (const [id, v] of state)
        choices.set(id, {
          selected: v.selected,
          meaning_tr_edit: v.edit?.trim() ? v.edit.trim() : null,
        });
      const res = await confirmImport(job.id, { choices });
      requestSync();
      toast({
        title:
          res.notesCreated > 0
            ? t('importer.preview.added', { notes: res.notesCreated })
            : t('importer.preview.addedSenses', { count: res.sensesAdded }),
        description: t('importer.preview.addedBody', {
          senses: res.sensesAdded,
          cards: res.cardsCreated,
        }),
        tone: 'success',
      });
      void navigate('/library');
    } catch (e) {
      void logError(e, 'import.confirm');
      toast({ title: t('importer.preview.confirmFailed'), tone: 'danger' });
      setBusy(false);
    }
  };

  const discard = async () => {
    await deleteImportJob(job.id);
    toast({ title: t('importer.preview.discarded') });
    void navigate('/add', { replace: true });
  };

  const filterOptions = (['all', 'word', 'phrase', 'pattern'] as const)
    .filter((f) => f === 'all' || counts[f] > 0)
    .map((f) => ({ value: f, label: `${t(`importer.preview.${f}`)} ${counts[f]}` }));

  const hiddenHard = sections.too_hard.filter((r) => !r.from_list).length;
  const shownSections = BUCKETS.filter((s) => s === 'for_you' || sections[s].some(isShown));

  return (
    <Page
      title={t('importer.preview.title')}
      description={t('importer.preview.source', { title: job.title, count: counts.all })}
      width="wide"
      actions={
        <Dialog
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          trigger={<IconButton icon="trash" label={t('importer.preview.discard')} />}
          title={t('importer.preview.discardTitle')}
          description={t('importer.preview.discardBody')}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="secondary">{t('common.cancel')}</Button>
              </DialogClose>
              <Button variant="danger" onClick={() => void discard()}>
                {t('common.delete')}
              </Button>
            </>
          }
        />
      }
    >
      <p className="text-[0.9375rem] text-fg-muted" data-testid="smart-summary">
        {t('importer.preview.smartSummary', {
          level: job.level,
          total: counts.all + hiddenHard,
          forYou: sections.for_you.length,
          easy: sections.easy.length,
          known: sections.known.length,
        })}
        {hiddenHard > 0 && <> {t('importer.preview.tooHardHidden', { count: hiddenHard })}</>}
      </p>

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        {filterOptions.length > 2 ? (
          <SegmentedControl<Filter>
            legend={t('importer.preview.filter')}
            hideLegend
            options={filterOptions}
            value={filter}
            onValueChange={setFilter}
            className="md:max-w-md md:flex-1 [&_label]:whitespace-nowrap max-sm:[&_label]:px-1.5"
          />
        ) : (
          <span />
        )}
        <span className="tabular text-sm text-fg-muted md:text-right" aria-live="polite">
          {t('importer.preview.summary', { selected: selectedCount, total: counts.all })}
        </span>
      </div>

      <div className="mt-5 flex flex-col gap-6">
        {shownSections.map((s) => {
          const visible = visibleIn(s);
          const total = sections[s].filter(isShown).length;
          const expanded = isOpen(s);
          const allSelected = visible.length > 0 && visible.every((r) => state.get(r.id)?.selected);
          const noneSelected = visible.every((r) => !state.get(r.id)?.selected);
          const headingId = `section-${s}`;
          const bodyId = `section-${s}-body`;
          return (
            <section key={s} aria-labelledby={headingId} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border pb-2">
                <h2 id={headingId} className="m-0 text-base font-semibold text-fg">
                  {s === 'for_you' ? (
                    <span className="inline-flex items-baseline gap-2">
                      {t(`importer.preview.sections.${s}`)}{' '}
                      <span className="tabular text-sm font-normal text-fg-muted">{total}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={bodyId}
                      onClick={() => setOpen((o) => ({ ...o, [s]: !expanded }))}
                      className="-ml-1 inline-flex min-h-11 items-center gap-2 rounded-control px-1 text-left hover:text-accent-text"
                    >
                      <Icon
                        name="chevron-down"
                        size={18}
                        className={cn(
                          'shrink-0 text-fg-muted transition-transform duration-(--duration-micro)',
                          expanded && 'rotate-180',
                        )}
                      />
                      {t(`importer.preview.sections.${s}`)}{' '}
                      <span className="tabular text-sm font-normal text-fg-muted">{total}</span>
                    </button>
                  )}
                </h2>
                {expanded && visible.length > 0 && (
                  <span className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAll(visible, true)}
                      disabled={allSelected}
                      aria-label={t('importer.preview.selectAllIn', {
                        section: t(`importer.preview.sections.${s}`),
                      })}
                    >
                      {t('importer.preview.selectAll')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAll(visible, false)}
                      disabled={noneSelected}
                      aria-label={t('importer.preview.selectNoneIn', {
                        section: t(`importer.preview.sections.${s}`),
                      })}
                    >
                      {t('importer.preview.selectNone')}
                    </Button>
                  </span>
                )}
              </div>
              {expanded && (
                <div id={bodyId} className="flex flex-col gap-3">
                  <p className="-mt-1 text-sm text-fg-muted">
                    {t(`importer.preview.sectionHints.${s}`, { level: job.level })}
                  </p>
                  {s === 'for_you' && !sections.for_you.some((r) => r.cefr === job.level) && (
                    <p className="rounded-card border border-border bg-surface-sunken/60 px-4 py-3 text-[0.9375rem] text-fg">
                      {t('importer.preview.forYouEmpty', { level: job.level })}
                    </p>
                  )}
                  {visible.length === 0 ? (
                    total > 0 && (
                      <p className="py-4 text-center text-fg-muted">
                        {t('importer.preview.emptyFilter')}
                      </p>
                    )
                  ) : (
                    <ul
                      className="flex flex-col gap-3"
                      aria-label={t(`importer.preview.sections.${s}`)}
                    >
                      {visible.map((r) => {
                        const st = state.get(r.id)!;
                        return (
                          <CandidateRow
                            key={r.id}
                            c={r}
                            selected={st.selected}
                            edit={st.edit}
                            onToggle={toggle}
                            onEdit={editMeaning}
                            onCommit={persistMeaning}
                            onKnown={s === 'known' ? undefined : markKnown}
                          />
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="sticky bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom))] z-10 -mx-4 mt-6 border-t border-border bg-canvas/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 md:bottom-0">
        <div className="flex items-center justify-between gap-3">
          <span className="tabular hidden text-sm text-fg-muted sm:inline">
            {t('importer.preview.summary', { selected: selectedCount, total: counts.all })}
          </span>
          <Button
            size="lg"
            loading={busy}
            disabled={selectedCount === 0}
            onClick={() => void confirm()}
            className="w-full sm:w-auto sm:min-w-56"
          >
            {busy
              ? t('importer.preview.confirming')
              : selectedCount === 0
                ? t('importer.preview.confirmNone')
                : t('importer.preview.confirm', { count: selectedCount })}
          </Button>
        </div>
      </div>
    </Page>
  );
}

// ------------------------------------------------------------------ row

interface RowProps {
  c: ImportCandidateRecord;
  selected: boolean;
  edit: string | null;
  onToggle: (id: string, selected: boolean) => void;
  onEdit: (id: string, edit: string | null) => void;
  onCommit: (id: string, edit: string | null) => void;
  /** "Biliyorum": absent in the "Biliyorsun" section. */
  onKnown?: (id: string, term: string) => void;
}

/** The source sentence with the term's surface highlighted (span from the server). */
export function HighlightedSentence({
  sentence,
  span,
  surface,
}: {
  sentence: string;
  span: [number, number] | null;
  surface: string;
}) {
  let [a, b] = span ?? [-1, -1];
  if (!(a >= 0 && b > a && b <= sentence.length)) {
    a = sentence.toLowerCase().indexOf(surface.toLowerCase());
    b = a + surface.length;
  }
  if (a < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, a)}
      <mark className="rounded-[3px] bg-accent-soft px-0.5 font-semibold text-fg not-italic">
        {sentence.slice(a, b)}
      </mark>
      {sentence.slice(b)}
    </>
  );
}

const CandidateRow = memo(function CandidateRow({
  c,
  selected,
  edit,
  onToggle,
  onEdit,
  onCommit,
  onKnown,
}: RowProps) {
  const { t } = useTranslation();
  const base = c.meaning_tr ?? '';
  const value = edit ?? base;
  const edited = edit !== null && edit.trim() !== '' && edit.trim() !== base;
  const low = c.confidence < LOW_CONFIDENCE;
  const pct = Math.round(c.confidence * 100);
  const lastCommitted = useRef(edit);

  const status =
    c.user_status === 'exists'
      ? {
          tone: 'neutral' as const,
          label: t('importer.preview.exists'),
          hint: t('importer.preview.existsHint'),
        }
      : c.user_status === 'add_sense'
        ? {
            tone: 'accent' as const,
            label: t('importer.preview.addSense'),
            hint: t('importer.preview.addSenseHint'),
          }
        : { tone: 'success' as const, label: t('importer.preview.new'), hint: null };

  const commit = () => {
    const v = edit !== null && edit.trim() !== '' && edit.trim() !== base ? edit.trim() : null;
    if (v !== lastCommitted.current) {
      lastCommitted.current = v;
      onCommit(c.id, v);
    }
  };

  return (
    <li
      className={cn(
        'flex gap-3 rounded-card border bg-surface py-3 pr-4 pl-3 transition-[border-color,background-color,opacity] duration-(--duration-micro) sm:gap-4 sm:py-4 sm:pr-5 sm:pl-4',
        '[contain-intrinsic-size:auto_168px] [content-visibility:auto]',
        selected ? 'border-border-strong/60' : 'border-border',
        low && 'border-l-[3px] border-l-warn',
      )}
    >
      <Checkbox
        label={t('importer.preview.select', { term: c.term })}
        hideLabel
        checked={selected}
        onCheckedChange={(v) => onToggle(c.id, v === true)}
        className="-mt-1.5"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span lang="en" className="font-serif text-xl leading-snug font-semibold text-fg">
            {c.term}
          </span>
          {c.ipa && (
            <span lang="en" className="text-sm text-fg-muted">
              {c.ipa}
            </span>
          )}
          {c.pos && <span className="text-sm text-fg-muted italic">{posLabel(t, c.pos)}</span>}
          <span className="flex flex-wrap items-center gap-1.5 self-center sm:ml-auto">
            {c.cefr && (
              <LevelBadge
                level={{
                  cefr: c.cefr,
                  source: c.cefr_source ?? 'freq',
                  list_cefr: null,
                  reason_tr: null,
                  auto: null,
                }}
              />
            )}
            {low && (
              <Badge tone="warn" title={t('importer.preview.lowConfidenceHint', { pct })}>
                <Icon name="alert" size={14} />
                {t('importer.preview.lowConfidence')}
                <span className="tabular">%{pct}</span>
              </Badge>
            )}
            <Badge tone={status.tone} title={status.hint ?? undefined}>
              {c.user_status === 'exists' && <Icon name="check" size={14} />}
              {status.label}
            </Badge>
          </span>
        </div>

        <p lang="en" className="font-serif text-[1.0625rem] leading-relaxed text-fg-muted italic">
          <HighlightedSentence sentence={c.source_sentence} span={c.span} surface={c.surface} />
        </p>
        {c.source_sentence_tr && (
          <p lang="tr" className="-mt-1 text-[0.9375rem] leading-relaxed text-fg-muted">
            {c.source_sentence_tr}
          </p>
        )}

        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <label className="sr-only" htmlFor={`m-${c.id}`}>
            {t('importer.preview.meaning', { term: c.term })}
          </label>
          <input
            id={`m-${c.id}`}
            value={value}
            maxLength={LIMITS.meaning_tr}
            onChange={(e) => onEdit(c.id, e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className={cn(
              'h-10 w-full rounded-control border border-transparent bg-surface-sunken/70 px-3 font-serif text-[1.0625rem] text-fg sm:max-w-sm',
              'transition-[border-color,background-color] duration-(--duration-micro) hover:border-border-strong/60',
              'focus-visible:border-accent focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus/30',
            )}
          />
          {c.gloss_en && (
            <span lang="en" className="min-w-0 text-sm text-fg-muted">
              {c.gloss_en}
            </span>
          )}
        </div>
        {onKnown && (
          <div className="-mb-1 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              leadingIcon="check"
              aria-label={t('importer.preview.knowIt', { term: c.term })}
              onClick={() => onKnown(c.id, c.term)}
            >
              {t('importer.preview.knowItShort')}
            </Button>
          </div>
        )}
        {edited && (
          <p className="flex items-center gap-2 text-xs text-fg-muted">
            <Icon name="pencil" size={14} />
            {t('importer.preview.meaningEdited')}
            <button
              type="button"
              className="rounded-sm text-accent-text underline-offset-2 hover:underline"
              onClick={() => {
                onEdit(c.id, null);
                lastCommitted.current = null;
                onCommit(c.id, null);
              }}
            >
              {t('importer.preview.resetMeaning')}
            </button>
          </p>
        )}
      </div>
    </li>
  );
});
