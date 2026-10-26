// /profile (redesign, "Profil" board): who you are (account), your level and estimated
// vocabulary, what you like (interests), plus shortcuts. Settings sit behind the gear in the
// header. v0.5.1: numbers (streak, words learned) and goals live only on İlerleme; goals are
// edited there (/progress?edit=goals), so the old ?edit=goals link forwards.
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router';
import { db } from '@/data';
import { vocabularyFloor } from '@/domain/progressView';
import { Avatar } from '@/features/auth/Avatar';
import { useAuth } from '@/features/auth/session';
import { formatDate, useLevelOverview } from '@/features/leveltest/levelText';
import {
  Glyph,
  GlyphTile,
  type GlyphName,
  type GlyphTone,
} from '@/features/settings/SettingsGlyph';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { formatNumber } from '@/features/stats/format';
import { useWordStages } from '@/features/stats/useWordStages';
import { formatSince } from '@/features/auth/time';
import { useSyncStatus } from '@/sync/status';
import { buttonClasses, cn, Icon, Skeleton, Surface } from '@/ui';
import { scanCount, scanWhere } from '@/data/scan';

const card = 'flex flex-col rounded-card border border-border bg-surface';

export function ProfilePage() {
  const [params] = useSearchParams();
  if (params.get('edit') === 'goals') return <Navigate to="/progress?edit=goals" replace />;
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-10 sm:px-6 md:pt-10">
      <ProfileHeader />
      <div className="mt-3 flex flex-col gap-4">
        <LevelCard />
        <InterestsCard />
        <Shortcuts />
      </div>
    </div>
  );
}

function ProfileHeader() {
  const { t } = useTranslation();
  const auth = useAuth();
  const signedIn = auth.status === 'signed_in' && auth.user;
  const name = signedIn
    ? (auth.user!.name ?? auth.user!.email ?? t('auth.noName'))
    : t('profile.home.guestName');
  return (
    <header className="flex items-center justify-between gap-3 pl-1">
      <div className="flex min-w-0 items-center gap-3.5">
        {signedIn ? (
          <Avatar src={auth.user!.avatarUrl} name={name} size={60} />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-[3.75rem] shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text"
          >
            <Icon name="user" size={28} />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate font-serif text-[1.75rem] leading-tight font-semibold text-fg">
            {name}
          </h1>
          {auth.status === 'loading' ? (
            <Skeleton className="h-4 w-40" />
          ) : signedIn ? (
            <span className="text-[0.8125rem] text-fg-muted">
              {t('profile.home.signedInGoogle')}
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-x-2 text-[0.8125rem] text-fg-muted">
              {t('profile.home.guestLine')}
              {auth.status === 'guest' && (
                <Link
                  to="/auth"
                  className="inline-flex min-h-11 items-center font-medium text-accent-text"
                >
                  {t('profile.home.signIn')}
                </Link>
              )}
            </span>
          )}
        </div>
      </div>
      <Link
        to="/settings"
        aria-label={t('profile.home.settings')}
        className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg-muted hover:text-fg"
      >
        <Glyph name="gear" size={22} strokeWidth={1.6} />
      </Link>
    </header>
  );
}

function LevelCard() {
  const { t } = useTranslation();
  const overview = useLevelOverview();
  const stages = useWordStages();
  if (!overview) {
    return (
      <Surface padding="lg" aria-busy="true">
        <Skeleton lines={3} />
      </Surface>
    );
  }
  // Never show the default "B1" as if it were measured (v0.5.1).
  const measured = overview.source !== 'default' || overview.testCount > 0;
  const floor = stages ? vocabularyFloor(stages.learnedTotal, stages.alreadyKnown) : null;
  const source = !measured
    ? t('profile.home.unmeasuredHint')
    : overview.source === 'default' || !overview.updatedAt
      ? t('profile.home.source.default')
      : t(`profile.home.source.${overview.source}`, { date: formatDate(overview.updatedAt) });
  return (
    <section
      aria-labelledby="profile-level"
      className={cn(card, 'gap-4 px-[1.125rem] pt-5 pb-[1.125rem]')}
    >
      <h2 id="profile-level" className="sr-only">
        {t('profile.home.levelLabel')}
      </h2>
      <dl className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <dt className="text-[0.8125rem] text-fg-muted">{t('profile.home.levelLabel')}</dt>
          <dd data-testid="profile-level">
            {measured ? (
              <span className="font-serif text-[2.5rem] leading-none font-semibold text-fg">
                {overview.level}
              </span>
            ) : (
              <span className="font-serif text-xl leading-tight font-semibold text-fg">
                {t('profile.home.unmeasured')}
              </span>
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-1 border-l border-border pl-4">
          <dt className="text-[0.8125rem] text-fg-muted">{t('profile.home.vocabLabel')}</dt>
          <dd data-testid="profile-vocab">
            {overview.hasBasis ? (
              <span className="tabular font-serif text-[2.5rem] leading-none font-semibold text-fg">
                ~{formatNumber(overview.vocab.estimate)}
              </span>
            ) : floor !== null ? (
              <span className="font-serif text-xl leading-tight font-semibold text-fg">
                {t('profile.home.vocabFloor', { count: floor, value: formatNumber(floor) })}
              </span>
            ) : (
              <span className="text-[0.9375rem] text-fg-muted">{t('profile.home.vocabNone')}</span>
            )}
          </dd>
        </div>
      </dl>
      {overview.hasBasis ? (
        <p className="-mt-1 text-xs text-fg-muted">{t('profile.home.vocabDisclaimer')}</p>
      ) : floor !== null ? (
        <p className="-mt-1 text-xs text-fg-muted">{t('profile.home.vocabFloorHint')}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3.5">
        <span className="min-w-0 flex-1 text-[0.8125rem] text-fg-muted">{source}</span>
        <Link
          to="/level-test"
          className={buttonClasses({
            variant: measured ? 'secondary' : 'primary',
            className: cn('shrink-0', measured && 'text-accent-text'),
          })}
        >
          {measured && <Icon name="refresh" size={18} />}
          {overview.testCount > 0 ? t('profile.home.testAgain') : t('profile.home.testStart')}
        </Link>
      </div>
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
    <section
      aria-labelledby="profile-interests"
      className={cn(card, 'gap-3 px-[1.125rem] pt-2 pb-[1.125rem]')}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="profile-interests" className="font-serif text-[1.1875rem] font-semibold text-fg">
          {t('profile.home.interestsTitle')}
        </h2>
        <Link
          to="/settings/ilgi-alanlari"
          aria-label={`${t('profile.home.interestsTitle')}: ${t('profile.home.interestsEdit')}`}
          className="-mr-2 inline-flex min-h-11 items-center rounded-control px-2 text-sm font-medium text-accent-text hover:bg-hover"
        >
          {t('profile.home.interestsEdit')}
        </Link>
      </div>
      {!settings ? (
        <Skeleton className="h-9 w-full" />
      ) : chosen.length ? (
        <ul aria-label={t('profile.home.interestsChosen')} className="flex flex-wrap gap-2">
          {chosen.map((k) => (
            <li
              key={k}
              className="rounded-full bg-accent-soft px-3.5 py-2 text-sm font-semibold text-accent-text"
            >
              {t(`topics.${k}`, { defaultValue: k })}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.9375rem] text-fg-muted">{t('profile.home.interestsNone')}</p>
      )}
      <p className="text-[0.8125rem] text-fg-muted">{t('profile.home.interestsHint')}</p>
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
  const syncLine =
    sync.mode !== 'account'
      ? t('syncPanel.localTitle')
      : sync.state === 'synced' && sync.lastSyncAt
        ? t('syncPanel.lastSync', { when: formatSince(sync.lastSyncAt) })
        : sync.state === 'pending'
          ? t('sync.pending', { count: sync.pending })
          : t(`sync.${sync.state}`);
  const rows: {
    to: string;
    glyph: GlyphName;
    tone: GlyphTone;
    title: string;
    count?: number;
    hint?: string;
  }[] = [
    {
      to: '/library',
      glyph: 'list',
      tone: 'accent',
      title: t('profile.home.allWords'),
      count: counts?.notes,
    },
    {
      to: '/settings/bilinen-kelimeler',
      glyph: 'check',
      tone: 'success',
      title: t('profile.home.knownWords'),
      count: counts?.known,
    },
    {
      to: '/settings/hesap#senkron',
      glyph: 'cloud',
      tone: 'accent',
      title: t('profile.home.sync'),
      hint: syncLine,
    },
    {
      to: '/settings',
      glyph: 'sliders',
      tone: 'neutral',
      title: t('profile.home.settings'),
      hint: t('profile.home.settingsHint'),
    },
  ];
  return (
    <nav aria-label={t('profile.home.shortcuts')}>
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        {rows.map((r) => (
          <li key={r.to}>
            <Link
              to={r.to}
              className="flex min-h-[3.75rem] items-center gap-3.5 px-4 py-3 text-fg hover:bg-surface-hover focus-visible:outline-offset-[-2px]"
            >
              <GlyphTile name={r.glyph} tone={r.tone} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[0.9375rem] font-semibold">
                  {r.title}
                  {r.count !== undefined && (
                    <span className="tabular font-normal text-fg-muted">
                      {' '}
                      · {formatNumber(r.count)}
                    </span>
                  )}
                </span>
                {r.hint && (
                  <span className="truncate text-[0.8125rem] text-fg-muted">{r.hint}</span>
                )}
              </span>
              <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
