import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { db, deleteImportJob, retryImportJob, type ImportJobRecord } from '@/data';
import { getText } from '@/data/texts';
import { readerPath } from '@/domain/texts';
import type { Id, Source } from '@/domain/types';
import { Button, Icon, ProgressBar, Spinner, Surface, buttonClasses, cn } from '@/ui';
import { importErrorMessage } from './errors';
import { kickImportQueue } from './queue';
import { useOnline } from './shared';

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
        'inline-flex min-h-11 items-center gap-1.5 self-start text-[0.9375rem] font-medium text-accent-text underline-offset-4 hover:underline',
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
    job.status === 'processing' || (waiting && online && job.error_code !== 'not_signed_in');
  const failed = job.status === 'failed';
  const ready = job.status === 'ready';
  const done = job.status === 'done';

  const statusText = failed
    ? t('importer.job.failed')
    : ready
      ? t('importer.job.ready')
      : done
        ? t('importer.job.done')
        : waiting && job.error_code === 'not_signed_in'
          ? importErrorMessage('not_signed_in')
          : waiting && !online
            ? t('importer.job.queuedOffline')
            : job.chunk_done === 0 && waiting
              ? t('importer.job.queued')
              : t('importer.job.processing', {
                  done: Math.min(job.chunk_done + 1, job.chunk_total),
                  total: job.chunk_total,
                });

  const icon = failed
    ? 'alert'
    : ready || done
      ? 'check'
      : waiting && !online
        ? 'sync-offline'
        : null;

  return (
    <Surface padding="md" className={cn('flex flex-col gap-3', className)} aria-live="polite">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
            failed
              ? 'bg-danger-soft text-danger-text'
              : ready || done
                ? 'bg-success-soft text-success-text'
                : 'bg-surface-sunken text-fg-muted',
          )}
        >
          {icon ? (
            <Icon name={icon} size={18} />
          ) : working ? (
            <Spinner size={16} />
          ) : (
            <Icon name={(job.kind as Source['kind']) === 'pdf' ? 'upload' : 'file'} size={18} />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate font-medium text-fg">{job.title}</p>
          <p className={cn('text-sm', failed ? 'text-danger-text' : 'text-fg-muted')}>
            {statusText}
          </p>
        </div>
        <span className="tabular shrink-0 pt-0.5 text-sm text-fg-muted">
          {t('importer.job.progress', { done: job.chunk_done, total: job.chunk_total })}
        </span>
      </div>

      {!ready && !done && (
        <ProgressBar
          value={job.chunk_done}
          max={job.chunk_total}
          label={t('a11y.progress')}
          valueText={t('importer.job.progress', { done: job.chunk_done, total: job.chunk_total })}
          className={cn(pct === 0 && working && 'opacity-60')}
        />
      )}

      {failed && <p className="text-sm text-fg">{importErrorMessage(job.error_code)}</p>}

      {(job.chunk_cache_hits ?? 0) > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-fg-muted">
          <Icon name="check" size={16} />
          {t('importer.job.cacheHits', { count: job.chunk_cache_hits })}
        </p>
      )}

      <ReadTextLink textId={job.text_id} />

      {ready && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg-muted">
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

      {failed && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
    </Surface>
  );
}

/** Jobs of one kind that are not finished yet (newest first). */
export function ActiveJobs({ kind }: { kind: Source['kind'] }) {
  const { t } = useTranslation();
  const jobs =
    useLiveQuery(
      async () =>
        (await db.import_jobs.orderBy('created_at').reverse().toArray()).filter(
          (j) => (j as ImportJobRecord).kind === kind && j.status !== 'done',
        ) as ImportJobRecord[],
      [kind],
    ) ?? [];
  if (jobs.length === 0) return null;
  return (
    <section aria-labelledby={`jobs-${kind}`} className="mt-8 flex flex-col gap-3">
      <h2 id={`jobs-${kind}`} className="text-sm font-medium text-fg-muted">
        {t('importer.job.recent')}
      </h2>
      {jobs.slice(0, 5).map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </section>
  );
}
