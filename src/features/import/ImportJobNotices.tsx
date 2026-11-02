// A notice when a background extraction finishes (v0.5.2, B2): wherever the user is, a toast
// says the words are ready and opens the preview. Mounted once in the root layout.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { db } from '@/data';
import { toast } from '@/ui';

export function ImportJobNotices() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const jobs = useLiveQuery(
    async () =>
      (await db.import_jobs.where('status').anyOf('queued', 'processing', 'ready').toArray()).map((j) => ({
        id: j.id,
        status: j.status,
        title: (j as { title?: string }).title ?? '',
      })),
    [],
  );
  const seen = useRef<Map<string, string> | null>(null);
  const here = useRef(pathname);
  useEffect(() => {
    here.current = pathname;
  }, [pathname]);
  useEffect(() => {
    if (!jobs) return;
    const before = seen.current;
    seen.current = new Map(jobs.map((j) => [j.id, j.status]));
    if (!before) return; // first look: only changes from now on are news
    for (const j of jobs) {
      const was = before.get(j.id);
      if (j.status !== 'ready' || (was !== 'queued' && was !== 'processing')) continue;
      if (here.current === `/import/${j.id}`) continue;
      toast({
        title: t('importer.jobs.readyToast'),
        description: j.title,
        tone: 'success',
        duration: 10_000,
        action: { label: t('importer.job.open'), onClick: () => void navigate(`/import/${j.id}`) },
      });
    }
  }, [jobs, navigate, t]);
  return null;
}
