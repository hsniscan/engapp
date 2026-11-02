// "Çalış" (v0.5.2 "Çam", docs/design.md §4.2, ADR 0066): the study modes as one list — icon,
// name, what it asks, what is left today (the same numbers as Bugün, ADR 0055) — the
// "Karışık çalış" switch, and one sticky button that starts the next mode. "Dikte" (v0.5 İP9)
// is listed only when this device can read the example sentences. A new user with no words
// gets a real empty state instead of a start button with nothing to study.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { db } from '@/data';
import type { StudyMode } from '@/domain/studyMode';
import { openAddSheet } from '@/features/add/addSheetStore';
import { DISCOVER_DECKS_HREF } from '@/features/decks/deckUi';
import { flags } from '@/features/settings/platform';
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  EmptyState,
  Icon,
  IconTile,
  type IconName,
  ListGroup,
  PageFrame,
  Skeleton,
  Switch,
} from '@/ui';
import { reconcileDictationCards } from '@/data/dictation';
import { mixedHint, modeText, startLabel } from './modeText';
import { type StudyModeCount, useTodayStudy } from './studyModes';

const MIXED_FLAG = 'study.mixed';

const left = (c: StudyModeCount) => c.due + c.newCount;

export const MODE_ICON: Record<StudyMode, IconName> = {
  word: 'cards',
  production: 'pen',
  cloze: 'cloze',
  dictation: 'speaker',
};

function ModeRow({ mode, count, main }: { mode: StudyMode; count: StudyModeCount; main: boolean }) {
  const { t } = useTranslation();
  const n = left(count);
  // Every mode with cards shows the same split, and learning steps are not called "tekrar"
  // (ADR 0055). A mode with nothing today says why instead.
  const split =
    t('study.split', { due: count.left.review, new: count.newCount }) +
    (count.left.learning > 0 ? ` · ${t('today.splitSteps', { count: count.left.learning })}` : '') +
    (count.estMinutes > 0 ? ` · ${t('study.minutes', { count: count.estMinutes })}` : '');
  const status = n > 0 ? split : modeText(t, mode, 'note');
  return (
    <Link
      to={`/study?mode=${mode}`}
      data-testid={`study-mode-${mode}`}
      className="flex min-h-14 w-full items-start gap-3 px-4 py-4 text-left transition-colors duration-(--duration-micro) hover:bg-hover focus-visible:outline-offset-[-2px]"
    >
      <IconTile icon={MODE_ICON[mode]} tone={main ? 'accent' : 'neutral'} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-ui font-semibold text-fg">{modeText(t, mode, 'name')}</span>
          <span className="text-meta text-fg-muted">{modeText(t, mode, 'dir')}</span>
          {mode === 'word' && <Badge tone="accent">{t('study.mainBadge')}</Badge>}
        </span>
        <span className="text-meta text-fg-muted">{modeText(t, mode, 'desc')}</span>
        {status && <span className="text-meta font-medium text-fg">{status}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end pt-0.5">
        <span className="tabular text-title font-semibold text-fg">{n}</span>
        <span className="text-caption text-fg-muted">{t('study.cardsUnit')}</span>
      </span>
    </Link>
  );
}

export function StudyModesPage() {
  const { t } = useTranslation();
  const study = useTodayStudy();
  const hasWords = useLiveQuery(
    async () => (await db.notes.filter((n) => n.deleted_at === null).first()) !== undefined,
    [],
  );
  const [mixed, setMixed] = useState(() => flags.get(MIXED_FLAG) === '1');
  // Dictation cards of words whose example sentences arrived since the last visit (cheap
  // when nothing changed; the counts follow through the live query).
  useEffect(() => {
    void reconcileDictationCards().catch(() => {});
  }, []);

  if (hasWords === false) return <StudyWelcome />;
  const counts = study?.counts;
  const total = study?.left ?? 0;
  const minutes = study?.minutes ?? 0;
  const main: StudyMode = study?.nextReady ?? study?.next ?? 'word';
  const startTo = mixed ? '/study?mode=mixed' : `/study?mode=${main}`;
  const done = !!study && total === 0;

  return (
    <PageFrame
      width="reading"
      back={{ to: '/', label: t('nav.home') }}
      title={t('study.pickerTitle')}
      description={
        <span aria-live="polite">
          {!counts
            ? ' '
            : total > 0
              ? t('study.leftToday', { count: total, min: minutes })
              : t('study.allDone')}
        </span>
      }
      frameClassName="flex min-h-[calc(100dvh-var(--nav-height)-1.5rem)] flex-col pb-0 md:min-h-dvh"
    >
      <div className="flex flex-1 flex-col gap-6">
        {study && counts ? (
          <ListGroup aria-label={t('study.empty.pickMode')}>
            {study.modes.map((m) => (
              <ModeRow key={m} mode={m} count={counts[m]} main={m === main && !mixed} />
            ))}
          </ListGroup>
        ) : (
          <Card aria-busy="true" padding="none" className="flex flex-col divide-y divide-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-3 p-4">
                <Skeleton className="size-10 rounded-control" />
                <Skeleton lines={2} className="flex-1" />
              </div>
            ))}
          </Card>
        )}

        <Card padding="none" className="px-4 py-1">
          <Switch
            label={t('study.mixed')}
            description={study ? mixedHint(t, study.modes) : t('study.mixedHint')}
            checked={mixed}
            onCheckedChange={(v) => {
              setMixed(v);
              flags.set(MIXED_FLAG, v ? '1' : '0');
            }}
          />
        </Card>

        {/* Above the tab bar on phones (AppShell pads the page for it), 16 px clear of it. */}
        <div className="sticky bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom))] -mx-4 mt-auto bg-canvas px-4 pt-3 pb-4 sm:-mx-6 sm:px-6 md:bottom-0 md:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {done ? (
            <Link
              to="/study/more"
              data-testid="study-more"
              className={buttonClasses({ variant: 'secondary', size: 'lg', fullWidth: true })}
            >
              {t('review.moreStudy')}
              <Icon name="arrow-right" size={20} />
            </Link>
          ) : (
            <Link
              to={startTo}
              data-testid="study-start"
              aria-disabled={!study || undefined}
              className={buttonClasses({
                size: 'lg',
                fullWidth: true,
                className: !study ? 'pointer-events-none opacity-45' : undefined,
              })}
            >
              {startLabel(t, mixed ? 'mixed' : main)}
              <Icon name="arrow-right" size={20} />
            </Link>
          )}
        </div>
      </div>
    </PageFrame>
  );
}

/** No words yet: the first steps instead of "Bugünlük bitti" and a start button with 0 cards. */
function StudyWelcome() {
  const { t } = useTranslation();
  return (
    <PageFrame width="reading" back={{ to: '/', label: t('nav.home') }} title={t('study.pickerTitle')}>
      <div data-testid="study-welcome">
        <EmptyState
          tone="card"
          icon="cards"
          title={t('study.welcomeTitle')}
          description={t('study.welcomeBody')}
          action={
            <>
              <Button size="lg" leadingIcon="plus" onClick={() => openAddSheet()} aria-haspopup="dialog">
                {t('home.emptyAction')}
              </Button>
              <Link to={DISCOVER_DECKS_HREF} className={buttonClasses({ variant: 'secondary' })}>
                {t('study.welcomeDecks')}
              </Link>
            </>
          }
        />
      </div>
    </PageFrame>
  );
}
