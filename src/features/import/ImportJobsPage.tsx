// "Kelime çıkarmaları" (/import, v0.5.2, B2): every extraction job from every source in one
// place, so a job started from a photo, a link or the quick sheet is easy to find again.
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db, type ImportJobRecord } from '@/data';
import { AddFlowPage } from '@/features/add/ui';
import { EmptyState, SectionHeader } from '@/ui';
import { JobCard } from './JobCard';

export function ImportJobsPage() {
  const { t } = useTranslation();
  const jobs = useLiveQuery(
    async () =>
      (await db.import_jobs
        .orderBy('created_at')
        .reverse()
        .limit(30)
        .toArray()) as ImportJobRecord[],
    [],
  );
  const open = (jobs ?? []).filter((j) => j.status !== 'done');
  const done = (jobs ?? []).filter((j) => j.status === 'done').slice(0, 10);
  return (
    <AddFlowPage title={t('importer.jobs.title')} description={t('importer.jobs.body')}>
      {jobs && jobs.length === 0 ? (
        <EmptyState
          tone="card"
          icon="file"
          title={t('importer.jobs.empty')}
          description={t('importer.jobs.emptyBody')}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {open.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
          {done.length > 0 && (
            <SectionHeader title={t('importer.jobs.finished')} className="mt-5 mb-0" />
          )}
          {done.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </div>
      )}
    </AddFlowPage>
  );
}
