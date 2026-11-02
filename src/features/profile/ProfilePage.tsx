// /profile (v0.5.2 design 4.14): who you are (name, account, level as the eyebrow), the
// İlerleme glance, level and estimated vocabulary, interests, and one list of places
// (Hedefler, Tüm kelimelerim, Bildiğim kelimeler, Ayarlar, Eşitleme). Settings is a row, so
// the header has no settings icon (one way in). The old ?edit=goals link forwards to İlerleme.
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router';
import { db } from '@/data';
import { scanCount, scanWhere } from '@/data/scan';
import { vocabularyFloor } from '@/domain/progressView';
import { Avatar } from '@/features/auth/Avatar';
import { useAuth } from '@/features/auth/session';
import { syncTitle } from '@/features/auth/syncText';
import { formatSince } from '@/features/auth/time';
import { formatDate, useLevelOverview } from '@/features/leveltest/levelText';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { formatNumber } from '@/features/stats/format';
import { ProgressGlance } from '@/features/stats/ProgressGlance';
import { useWordStages } from '@/features/stats/useWordStages';
import { useSyncStatus } from '@/sync/status';
import {
  Badge,
  buttonClasses,
  Card,
  cn,
  Icon,
  ListGroup,
  ListRow,
  PageFrame,
  SectionHeader,
  Skeleton,
  SyncStatus,
} from '@/ui';

export function ProfilePage() {
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const auth = useAuth();
  const overview = useLevelOverview();
  if (params.get('edit') === 'goals') return <Navigate to="/progress?edit=goals" replace />;
  const signedIn = auth.status === 'signed_in' && auth.user;
  const name = signedIn
    ? (auth.user!.name ?? auth.user!.email ?? t('auth.noName'))
    : t('profile.home.guestName');
  const measured = overview ? overview.source !== 'default' : false;
  // "B1 · Hesaplı"; a guest's title already says "Misafir", so only a measured level shows.
  const eyebrow =
    [measured && overview ? overview.level : null, signedIn ? t('profile.home.planAccount') : null]
      .filter(Boolean)
      .join(' · ') || undefined;

  return (
    <PageFrame
      width="wide"
      eyebrow={eyebrow}
      title={name}
      description={
        auth.status === 'loading' ? (
          <Skeleton className="h-4 w-40" />
        ) : signedIn ? (
          t('profile.home.signedInGoogle')
        ) : (
          <span className="flex flex-wrap items-center gap-x-2">
            {t('profile.home.guestLine')}
            {auth.status === 'guest' && (
              <Link
                to="/auth"
                className="inline-flex min-h-11 items-center font-semibold text-accent-text underline-offset-4 hover:underline"
              >
                {t('profile.home.signIn')}
              </Link>
            )}
          </span>
        )
      }
      actions={
        signedIn ? (
          <Avatar src={auth.user!.avatarUrl} name={name} size={56} />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text"
          >
            <Icon name="user" size={26} />
          </span>
        )
      }
    >
      <SyncAlert />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-8">
          <ProgressGlance />
          <LevelCard />
          <InterestsCard />
        </div>
        <Shortcuts />
      </div>
    </PageFrame>
  );
}

/**
 * Bugün has no sync pill (design 4.1), so on phones Profil is where a sync problem shows:
 * quiet when fine (the row at the bottom), explicit when not (this card at the top). A refused
 * daily quota (ADR 0060/0070) says plainly that the changes are safe and go tomorrow.
 */
function SyncAlert() {
  const { t } = useTranslation();
  const sync = useSyncStatus();
  if (sync.mode !== 'account' || sync.state !== 'error') return null;
  const quota = sync.error === 'quota';
  return (
    <Link
      to="/settings/hesap#senkron"
      role="status"
      data-testid="profile-sync-alert"
      className={cn(
        'mb-8 flex min-h-14 items-start gap-3 rounded-card px-4 py-3 transition-colors duration-(--duration-micro) hover:brightness-[0.98]',
        quota ? 'bg-warn-soft text-warn-text' : 'bg-danger-soft text-danger-text',
      )}
    >
      <Icon name="sync-error" size={20} className="mt-0.5 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-ui font-semibold">{quota ? t('sync.quota') : t('sync.error')}</span>
        <span className="text-meta">
          {quota
            ? t('syncPanel.quotaHint')
            : sync.stuck > 0
              ? t('syncPanel.stuck', { count: sync.stuck })
              : t('syncPanel.errorHint')}
        </span>
      </span>
      <Icon name="chevron-right" size={18} className="mt-0.5 shrink-0" />
    </Link>
  );
}

function LevelCard() {
  const { t } = useTranslation();
  const overview = useLevelOverview();
  const stages = useWordStages();
  if (!overview) {
    return (
      <Card padding="lg" aria-busy="true">
        <Skeleton lines={3} />
      </Card>
    );
  }
  // Never show the default "B1" as if it were measured (v0.5.1). An unreliable test leaves the
  // level unmeasured too (v0.5.2, B4): it gets its own hint instead of a big "B1".
  const measured = overview.source !== 'default';
  const floor = stages ? vocabularyFloor(stages.learnedTotal, stages.alreadyKnown) : null;
  const source = !measured
    ? overview.testCount > 0
      ? t('profile.home.unreliableHint')
      : t('profile.home.unmeasuredHint')
    : !overview.updatedAt
      ? t('profile.home.source.default')
      : t(`profile.home.source.${overview.source}`, { date: formatDate(overview.updatedAt) });
  return (
    <section aria-labelledby="profile-level-title">
      <SectionHeader id="profile-level-title" title={t('profile.home.levelSection')} />
      <Card className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 divide-x divide-border">
          <div className="flex min-w-0 flex-col-reverse justify-end gap-1 pr-4">
            <dt className="text-meta text-fg-muted">{t('profile.home.levelLabel')}</dt>
            <dd
              data-testid="profile-level"
              className={cn('font-semibold text-fg', measured ? 'text-heading' : 'text-title')}
            >
              {measured ? overview.level : t('profile.home.unmeasured')}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col-reverse justify-end gap-1 pl-4">
            <dt className="text-meta text-fg-muted">{t('profile.home.vocabLabel')}</dt>
            <dd
              data-testid="profile-vocab"
              className={cn(
                'tabular font-semibold text-fg',
                overview.hasBasis ? 'text-heading' : 'text-title',
              )}
            >
              {overview.hasBasis ? (
                `~${formatNumber(overview.vocab.estimate)}`
              ) : floor !== null ? (
                t('profile.home.vocabFloor', { count: floor, value: formatNumber(floor) })
              ) : (
                <span className="text-ui font-medium text-fg-muted">
                  {t('profile.home.vocabNone')}
                </span>
              )}
            </dd>
          </div>
        </dl>
        {(overview.hasBasis || floor !== null) && (
          <p className="text-meta text-fg-muted">
            {overview.hasBasis
              ? t('profile.home.vocabDisclaimer')
              : t('profile.home.vocabFloorHint')}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="min-w-0 flex-1 basis-48 text-meta text-fg-muted">{source}</p>
          <Link
            to="/level-test"
            className={buttonClasses({
              variant: measured ? 'secondary' : 'primary',
              className: 'shrink-0',
            })}
          >
            {measured && <Icon name="refresh" size={18} />}
            {overview.testCount > 0 ? t('profile.home.testAgain') : t('profile.home.testStart')}
          </Link>
        </div>
      </Card>
    </section>
  );
}

function InterestsCard() {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const chosen = (settings?.interests ?? []).filter(
    (k) => !(settings?.muted_topics ?? []).includes(k),
  );
  return (
    <section aria-labelledby="profile-interests">
      <SectionHeader
        id="profile-interests"
        title={t('profile.home.interestsTitle')}
        action={
          <Link
            to="/settings/ilgi-alanlari"
            aria-label={`${t('profile.home.interestsTitle')}: ${t('profile.home.interestsEdit')}`}
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
          >
            {t('profile.home.interestsEdit')}
          </Link>
        }
      />
      <Card className="flex flex-col gap-3">
        {!settings ? (
          <Skeleton className="h-6 w-full" />
        ) : chosen.length ? (
          <ul aria-label={t('profile.home.interestsChosen')} className="flex flex-wrap gap-2">
            {chosen.map((k) => (
              <li key={k}>
                <Badge tone="accent">{t(`topics.${k}`, { defaultValue: k })}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ui text-fg">{t('profile.home.interestsNone')}</p>
        )}
        <p className="text-meta text-fg-muted">{t('profile.home.interestsHint')}</p>
      </Card>
    </section>
  );
}

function Shortcuts() {
  const { t } = useTranslation();
  const counts = useLiveQuery(async () => {
    const [notes, known] = await Promise.all([
      scanCount(db.notes, (n) => n.deleted_at === null),
      scanWhere(db.known_terms, (k) => k.deleted_at === null),
    ]);
    return { notes, known: new Set(known.map((k) => k.term_norm)).size };
  }, []);
  const sync = useSyncStatus();
  const quota = sync.mode === 'account' && sync.state === 'error' && sync.error === 'quota';
  const syncLine = quota
    ? t('syncPanel.quotaHint')
    : sync.mode === 'account' && sync.state === 'synced' && sync.lastSyncAt
      ? t('syncPanel.lastSync', { when: formatSince(sync.lastSyncAt) })
      : syncTitle(t, sync);
  return (
    <nav aria-label={t('profile.home.shortcuts')} className="flex flex-col gap-3">
      <h2 className="sr-only">{t('profile.home.shortcuts')}</h2>
      <ListGroup>
        <ListRow
          to="/progress?edit=goals"
          leadingIcon="target"
          title={t('profile.home.goals')}
          description={t('profile.home.goalsHint')}
        />
        <ListRow
          to="/library"
          leadingIcon="list"
          title={t('profile.home.allWords')}
          meta={counts ? formatNumber(counts.notes) : undefined}
        />
        <ListRow
          to="/settings/bilinen-kelimeler"
          leadingIcon="check"
          title={t('profile.home.knownWords')}
          meta={counts ? formatNumber(counts.known) : undefined}
        />
        <ListRow
          to="/settings"
          leadingIcon="settings"
          title={t('profile.home.settings')}
          description={t('profile.home.settingsHint')}
        />
      </ListGroup>
      <ListGroup>
        <ListRow
          to="/settings/hesap#senkron"
          leadingIcon="cloud"
          title={t('profile.home.sync')}
          description={syncLine}
          trailing={
            quota ? (
              <Badge tone="warn">{t('sync.quotaShort')}</Badge>
            ) : sync.mode === 'account' ? (
              <SyncStatus state={sync.state} pendingCount={sync.pending} />
            ) : undefined
          }
        />
      </ListGroup>
    </nav>
  );
}
