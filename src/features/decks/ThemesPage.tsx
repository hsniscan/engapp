// "Kelimelerimi temalara ayır": send untagged words (term + English gloss only) to ai-themes,
// then let the user rename groups, take words out or reject groups before the approved group
// names become tags. The preview is stored on the device until it is saved or discarded.
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { AiClientError, groupThemes, type ThemesResponse } from '@/ai/client';
import {
  applyThemePreview,
  db,
  discardThemePreview,
  getThemePreview,
  getThemeSource,
  listTags,
  logError,
  saveThemePreview,
  updateThemePreview,
} from '@/data';
import {
  acceptedGroups,
  buildThemeBatches,
  keptNotes,
  MIN_THEME_WORDS,
  mergeThemeAnswers,
  THEME_BATCH_SIZE,
} from '@/domain/themes';
import { cleanTag, hasTag, MAX_TAG_LENGTH } from '@/domain/tags';
import type { Id, ThemePreview, ThemePreviewGroup } from '@/domain/types';
import { useAuth } from '@/features/auth/session';
import { ConfirmDialog } from '@/features/cards/ConfirmDialog';
import {
  Button,
  buttonClasses,
  cn,
  EmptyState,
  Icon,
  Page,
  Skeleton,
  Spinner,
  Surface,
  Switch,
  TextField,
  toast,
} from '@/ui';

export function ThemesPage() {
  const { t } = useTranslation();
  const preview = useLiveQuery(async () => (await getThemePreview()) ?? null, []);
  return (
    <Page title={t('themes.title')} description={t('themes.description')}>
      <Link
        to="/decks"
        className="-mt-3 mb-5 inline-flex min-h-11 items-center gap-1 text-[0.9375rem] font-medium text-accent-text underline-offset-4 hover:underline md:-mt-5"
      >
        <Icon name="chevron-left" size={18} />
        {t('decks.title')}
      </Link>
      {preview === undefined ? (
        <Surface aria-busy="true">
          <Skeleton lines={4} />
        </Surface>
      ) : preview ? (
        <PreviewView preview={preview} />
      ) : (
        <StartView />
      )}
    </Page>
  );
}

type ThemeErrorKey =
  'themes.errorOffline' | 'themes.errorDaily' | 'themes.errorBusy' | 'themes.errorFailed';

function errorKey(e: unknown): ThemeErrorKey {
  if (e instanceof AiClientError) {
    if (e.code === 'offline') return 'themes.errorOffline';
    if (e.code === 'daily_limit') return 'themes.errorDaily';
    if (e.code === 'quota_exceeded') return 'themes.errorBusy';
  }
  return 'themes.errorFailed';
}

function StartView() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [includeTagged, setIncludeTagged] = useState(false);
  const source = useLiveQuery(() => getThemeSource({ includeTagged }), [includeTagged]);
  const untagged = useLiveQuery(
    () => db.notes.filter((n) => n.deleted_at === null && n.tags.length === 0).count(),
    [],
  );
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const n = source?.notes.length ?? 0;
  const calls = Math.ceil(n / THEME_BATCH_SIZE);

  const run = async () => {
    if (!source) return;
    setError(null);
    cancelled.current = false;
    const batches = buildThemeBatches(source.notes);
    const answers: ThemesResponse[] = [];
    let failure: unknown = null;
    for (const [i, batch] of batches.entries()) {
      if (cancelled.current) break;
      setProgress({ done: i, total: batches.length });
      try {
        answers.push(await groupThemes({ words: batch.words }));
      } catch (e) {
        failure = e;
        break;
      }
    }
    setProgress(null);
    if (failure && !(failure instanceof AiClientError && failure.transient))
      void logError(failure, 'themes.run');
    if (answers.length > 0) {
      await saveThemePreview({
        created_at: Date.now(),
        model: answers[0]?.model ?? null,
        groups: mergeThemeAnswers(batches.slice(0, answers.length), answers),
        sent: batches.slice(0, answers.length).reduce((a, b) => a + b.words.length, 0),
      });
      if (failure) toast({ title: t('themes.errorPartial'), tone: 'warn' });
    } else if (failure) {
      setError(t(errorKey(failure)));
    }
  };

  if (auth.status === 'loading' || source === undefined) {
    return (
      <Surface aria-busy="true">
        <Skeleton lines={3} />
      </Surface>
    );
  }
  if (auth.status !== 'signed_in') {
    return (
      <Surface>
        <EmptyState
          icon="user"
          title={t('decks.themes.title')}
          description={t('themes.signIn')}
          action={
            auth.status === 'guest' ? (
              <Link to="/auth" className={buttonClasses({ variant: 'secondary' })}>
                {t('themes.signInAction')}
              </Link>
            ) : undefined
          }
        />
      </Surface>
    );
  }

  if (progress) {
    return (
      <Surface
        padding="lg"
        className="flex flex-col items-center gap-4 py-10 text-center"
        aria-live="polite"
      >
        <Spinner size={24} />
        <p className="font-serif text-xl font-semibold text-fg">{t('themes.running')}</p>
        {progress.total > 1 && (
          <p className="tabular text-sm text-fg-muted">
            {t('themes.runningStep', { done: progress.done + 1, total: progress.total })}
          </p>
        )}
        {progress.total > 1 && (
          <Button variant="ghost" onClick={() => (cancelled.current = true)}>
            {t('themes.cancel')}
          </Button>
        )}
      </Surface>
    );
  }

  const tooFew = n < MIN_THEME_WORDS;
  return (
    <Surface as="section" padding="none" className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <p className="text-[0.9375rem] text-fg">
          {t('themes.untagged', { count: untagged ?? 0 })}
          {includeTagged && <> {t('themes.selected', { count: source.total })}</>}
        </p>
        {source.total > n && (
          <p className="text-sm text-fg-muted">{t('themes.limitNote', { count: n })}</p>
        )}
      </div>
      <Switch
        label={t('themes.includeTagged')}
        description={t('themes.includeTaggedHint')}
        checked={includeTagged}
        onCheckedChange={setIncludeTagged}
      />
      <p className="flex gap-2 rounded-control bg-surface-sunken px-3 py-2.5 text-sm text-fg-muted">
        <Icon name="info" size={18} className="mt-px shrink-0" />
        <span>{t('themes.privacy')}</span>
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-control bg-danger-soft px-3 py-2.5 text-sm text-danger-text"
        >
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <Button size="lg" disabled={tooFew} onClick={() => void run()} className="sm:w-auto">
          {error ? t('themes.retry') : t('themes.start')}
        </Button>
        <p className="text-sm text-fg-muted">
          {tooFew
            ? t('themes.tooFew', { count: MIN_THEME_WORDS })
            : t('themes.calls', { count: calls })}
        </p>
      </div>
    </Surface>
  );
}

function PreviewView({ preview }: { preview: ThemePreview }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Terms of the notes in the preview (deleted notes drop out of the groups).
  const notes = useLiveQuery(async () => {
    const ids = [...new Set(preview.groups.flatMap((g) => g.note_ids))];
    const rows = await db.notes.bulkGet(ids);
    return new Map(rows.filter((n) => !!n && n.deleted_at === null).map((n) => [n!.id, n!.term]));
  }, [preview]);
  const tags = useLiveQuery(() => listTags(), []);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);

  if (!notes) return <Skeleton lines={4} />;
  const live = new Set(notes.keys());
  const accepted = acceptedGroups(preview.groups, live);

  const edit = (key: string, fn: (g: ThemePreviewGroup) => ThemePreviewGroup) =>
    void updateThemePreview((p) => ({
      ...p,
      groups: p.groups.map((g) => (g.key === key ? fn(g) : g)),
    })).catch((e: unknown) => logError(e, 'themes.edit'));

  const save = async () => {
    setBusy(true);
    try {
      const res = await applyThemePreview();
      toast({
        title: t('themes.saved', { count: res.tags.length }),
        description: t('themes.savedNotes', { count: res.notes }),
        tone: 'success',
      });
      await navigate('/decks');
    } catch (e) {
      void logError(e, 'themes.save');
      toast({ title: t('themes.saveFailed'), tone: 'danger' });
      setBusy(false);
    }
  };

  const visible = preview.groups.filter((g) => g.note_ids.some((id) => live.has(id)));

  return (
    <div className="flex flex-col gap-4">
      {visible.length === 0 ? (
        <Surface>
          <EmptyState icon="info" title={t('themes.noGroups')} />
        </Surface>
      ) : (
        <>
          <p className="text-[0.9375rem] text-fg-muted">
            {t('themes.summary', { count: visible.length })}
          </p>
          <ul aria-label={t('themes.groupsLabel')} className="flex flex-col gap-3">
            {visible.map((g) => (
              <GroupCard
                key={g.key}
                group={g}
                terms={notes}
                existing={
                  !!tags &&
                  hasTag(
                    tags.map((x) => x.tag),
                    g.name,
                  )
                }
                onEdit={(fn) => edit(g.key, fn)}
              />
            ))}
          </ul>
        </>
      )}

      <div className="sticky bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom)+0.75rem)] z-20 mt-2 grid grid-cols-2 gap-2 rounded-card border border-border bg-surface-raised p-2 shadow-overlay sm:flex sm:items-center sm:justify-end md:bottom-4">
        <Button variant="ghost" onClick={() => setDiscard(true)} disabled={busy}>
          {t('themes.discard')}
        </Button>
        <Button onClick={() => void save()} loading={busy} disabled={busy || accepted.length === 0}>
          {accepted.length ? t('themes.save', { count: accepted.length }) : t('themes.saveNone')}
        </Button>
      </div>

      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title={t('themes.discardTitle')}
        description={t('themes.discardBody')}
        confirmLabel={t('themes.discard')}
        onConfirm={async () => {
          await discardThemePreview();
          setDiscard(false);
        }}
      />
    </div>
  );
}

function GroupCard({
  group,
  terms,
  existing,
  onEdit,
}: {
  group: ThemePreviewGroup;
  terms: Map<Id, string>;
  existing: boolean;
  onEdit: (fn: (g: ThemePreviewGroup) => ThemePreviewGroup) => void;
}) {
  const { t } = useTranslation();
  const kept = keptNotes(group, new Set(terms.keys()));
  const removed = group.removed.filter((id) => terms.has(id));
  const [name, setName] = useState(group.name);
  const clean = cleanTag(name);
  const headingId = `theme-${group.key.replace(/[^\p{L}\p{N}]+/gu, '-')}`;

  return (
    <li>
      <Surface
        as="section"
        aria-labelledby={headingId}
        padding="none"
        className={cn(
          'flex flex-col gap-4 p-4 sm:p-5',
          group.rejected && 'bg-surface-sunken shadow-none',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id={headingId}
            className="min-w-0 pt-1 font-serif text-lg leading-snug font-semibold text-fg"
          >
            <span className={cn(group.rejected && 'text-fg-muted line-through decoration-1')}>
              {clean || group.suggested}
            </span>
            <span className="tabular block font-sans text-sm font-normal text-fg-muted sm:ml-2 sm:inline">
              {t('themes.words', { count: kept.length })}
            </span>
          </h2>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={group.rejected ? 'undo' : 'x'}
            onClick={() => onEdit((g) => ({ ...g, rejected: !g.rejected }))}
            className="-mr-2 shrink-0"
          >
            {group.rejected ? t('themes.restore') : t('themes.reject')}
          </Button>
        </div>
        {group.rejected ? (
          <p className="text-sm text-fg-muted">{t('themes.rejected')}</p>
        ) : (
          <>
            <TextField
              label={t('themes.nameLabel')}
              value={name}
              maxLength={MAX_TAG_LENGTH}
              error={!clean ? t('themes.nameRequired') : undefined}
              hint={clean && existing ? t('themes.nameExisting') : undefined}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => onEdit((g) => ({ ...g, name }))}
              autoComplete="off"
            />
            <ul className="flex flex-wrap gap-1.5" aria-label={clean || group.suggested}>
              {kept.map((id) => (
                <li
                  key={id}
                  className="inline-flex h-9 items-center gap-0.5 rounded-sm bg-surface-sunken pr-0.5 pl-2.5"
                >
                  <span lang="en" className="font-serif text-[0.9375rem] text-fg">
                    {terms.get(id)}
                  </span>
                  <button
                    type="button"
                    aria-label={t('themes.removeWord', { term: terms.get(id) })}
                    onClick={() => onEdit((g) => ({ ...g, removed: [...g.removed, id] }))}
                    className="relative inline-flex size-8 items-center justify-center rounded-[4px] text-fg-muted after:absolute after:-inset-1 after:content-[''] hover:bg-hover hover:text-fg"
                  >
                    <Icon name="x" size={16} />
                  </button>
                </li>
              ))}
            </ul>
            {removed.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-3 text-sm text-fg-muted">
                {t('themes.removed', { count: removed.length })}
                <button
                  type="button"
                  className="min-h-11 font-medium text-accent-text underline-offset-4 hover:underline"
                  onClick={() => onEdit((g) => ({ ...g, removed: [] }))}
                >
                  {t('themes.undoRemove')}
                </button>
              </p>
            )}
          </>
        )}
      </Surface>
    </li>
  );
}
