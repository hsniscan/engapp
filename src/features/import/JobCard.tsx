import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  db,
  deleteImportJob,
  previewPartialImportJob,
  retryImportJob,
  type ImportJobRecord,
} from '@/data';
import { getText } from '@/data/texts';
import { readerPath } from '@/domain/texts';
import type { Id, Source } from '@/domain/types';
import {
  Button,
  Card,
  Icon,
  IconTile,
  ProgressBar,
  SectionHeader,
  Spinner,
  buttonClasses,
  cn,
} from '@/ui';
import { importErrorMessage } from './errors';
import { kickImportQueue } from './queue';
import { useOnline } from '@/lib/online';

/**
 * "Metni oku" (v0.5.1, decision 0056): the text the words come from, saved before the extraction.
 * Nothing when the job has no text (older jobs) or the text was deleted.
 */
export function ReadTextLink({ textId, className }: { textId?: Id | null; className?: string }) {
  const { t } = useTranslation();
  const exists = useLiveQuery(async () => (textId ? !!(await getText(textId)) : false), [textId]);
  if (!textId || !exists) return null;
  return (
    <Link
      to={readerPath(textId)}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 self-start text-ui font-medium text-accent-text underline-offset-4 hover:underline',
        className,
      )}
      data-testid="read-text"
    >
      <Icon name="file" size={18} />
      {t('capture.readText')}
    </Link>
  );
}

/** Live progress of one import job: queue state, chunk progress, cache hits, errors, result. */
export function JobCard({ job, className }: { job: ImportJobRecord; className?: string }) {
  const { t } = useTranslation();
  const online = useOnline();
  const candidates =
    useLiveQuery(
      () => db.import_candidates.where('job_id').equals(job.id).count(),
      [job.id, job.chunk_done],
    ) ?? 0;

  const pct = job.chunk_total ? job.chunk_done / job.chunk_total : 0;
  const waiting = job.status === 'queued';
  const working =
    job.status === 'processing' ||
    (waiting && online && job.error_code !== 'not_signed_in' && job.error_code !== 'daily_limit');
  const failed = job.status === 'failed';
  const ready = job.status === 'ready';
  const done = job.status === 'done';
  // Stopped by the daily AI limit: waits and resumes by itself after the server's day ends.
  const tomorrow = waiting && job.error_code === 'daily_limit';
  const navigate = useNavigate();
  const partial = (failed || tomorrow) && job.chunk_done > 0;

  const statusText = failed
    ? t('importer.job.failed')
    : ready
      ? t('importer.job.ready')
      : done
        ? t('importer.job.done')
        : tomorrow
          ? t('importer.job.tomorrow')
          : waiting && job.error_code === 'not_signed_in'
            ? importErrorMessage('not_signed_in')
            : waiting && !online
              ? t('importer.job.queuedOffline')
              : job.chunk_done === 0 && waiting
                ? t('importer.job.queued')
                : t('importer.job.processing', { pct: Math.round(pct * 100) });

  const icon = failed
    ? 'alert'
    : ready || done
      ? 'check'
      : waiting && !online
        ? 'sync-offline'
        : null;

  return (
    <Card
      className={cn('flex flex-col gap-3', className)}
      aria-live="polite"
      data-testid="job-card"
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <IconTile icon={icon} tone={failed ? 'danger' : ready || done ? 'accent' : 'neutral'} />
        ) : working ? (
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted"
          >
            <Spinner size={20} />
          </span>
        ) : (
          <IconTile icon={(job.kind as Source['kind']) === 'pdf' ? 'upload' : 'file'} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-ui font-semibold text-fg">{job.title}</p>
          <p className={cn('text-meta', failed ? 'text-danger-text' : 'text-fg-muted')}>
            {statusText}
          </p>
        </div>
        <span className="tabular shrink-0 pt-0.5 text-meta text-fg-muted">
          {t('importer.job.progress', { pct: Math.round(pct * 100) })}
        </span>
      </div>

      {!ready && !done && (
        <ProgressBar
          value={job.chunk_done}
          max={job.chunk_total}
          label={t('a11y.progress')}
          valueText={t('importer.job.progress', { pct: Math.round(pct * 100) })}
          className={cn(pct === 0 && working && 'opacity-60')}
        />
      )}

      {failed && <p className="text-meta text-fg">{importErrorMessage(job.error_code)}</p>}

      {(job.chunk_cache_hits ?? 0) > 0 && (
        <p className="flex items-center gap-1.5 text-meta text-fg-muted">
          <Icon name="check" size={16} />
          {t('importer.job.cacheHits', { count: job.chunk_cache_hits })}
        </p>
      )}

      <ReadTextLink textId={job.text_id} />

      {ready && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-meta text-fg-muted">
            {candidates > 0
              ? t('importer.job.readyBody', { count: candidates })
              : t('importer.job.readyEmpty')}
          </p>
          <div className="flex gap-2">
            {candidates === 0 && (
              <Button variant="ghost" onClick={() => void deleteImportJob(job.id)}>
                {t('importer.job.discard')}
              </Button>
            )}
            {candidates > 0 && (
              <Link
                to={`/import/${job.id}`}
                className={buttonClasses({ className: 'w-full sm:w-auto' })}
              >
                {t('importer.job.open')}
              </Link>
            )}
          </div>
        </div>
      )}

      {partial && (
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-meta text-fg-muted">{t('importer.job.partialBody')}</p>
          <Button
            variant="tonal"
            onClick={async () => {
              if (await previewPartialImportJob(job.id)) void navigate(`/import/${job.id}`);
            }}
          >
            {t('importer.job.partialOpen')}
          </Button>
        </div>
      )}

      {tomorrow && (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => void deleteImportJob(job.id)}>
            {t('importer.job.discard')}
          </Button>
        </div>
      )}

      {failed && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => void deleteImportJob(job.id)}>
            {t('importer.job.discard')}
          </Button>
          <Button
            variant="secondary"
            leadingIcon="refresh"
            onClick={async () => {
              await retryImportJob(job.id);
              kickImportQueue();
            }}
          >
            {t('importer.job.retry')}
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Extraction jobs that are not finished yet, from every source (paste, PDF, photo, link,
 * subtitle, share, quick sheet), newest first (B2). `kind` narrows the list.
 */
export function ActiveJobs({ kind, limit = 5 }: { kind?: Source['kind']; limit?: number }) {
  const { t } = useTranslation();
  const jobs =
    useLiveQuery(
      async () =>
        (await db.import_jobs.orderBy('created_at').reverse().toArray()).filter(
          (j) => (!kind || (j as ImportJobRecord).kind === kind) && j.status !== 'done',
        ) as ImportJobRecord[],
      [kind],
    ) ?? [];
  if (jobs.length === 0) return null;
  const id = `jobs-${kind ?? 'all'}`;
  return (
    <section aria-labelledby={id} className="mt-8 flex flex-col gap-3">
      <SectionHeader
        id={id}
        title={t('importer.job.recent')}
        className="mb-0"
        action={
          jobs.length > limit && (
            <Link to="/import" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
              {t('importer.job.all', { count: jobs.length })}
            </Link>
          )
        }
      />
      {jobs.slice(0, limit).map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </section>
  );
}
