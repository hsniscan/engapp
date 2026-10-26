// "Biraz daha çalış": once today's reviews are done, three ways to keep going.
//   1. extra new cards (today only), 2. a practice round that never changes the schedule,
//   3. tomorrow's reviews now (ordinary reviews).
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { addExtraNew, getMoreStudyOverview, logError, type MoreStudyOverview } from '@/data';
import { PRACTICE_SIZES, type PracticeSize, type PracticeSource } from '@/domain/practice';
import {
  Button,
  buttonClasses,
  cn,
  Icon,
  Page,
  SegmentedControl,
  Select,
  Skeleton,
  Surface,
  toast,
} from '@/ui';
import { extraNewSteps, practiceHref } from './links';

export function MoreStudyPage() {
  const { t } = useTranslation();
  const data = useLiveQuery(() => getMoreStudyOverview(), []);
  const description = !data
    ? ' '
    : data.dueNow > 0
      ? t('more.descPending', { count: data.dueNow })
      : t('more.descDone');

  return (
    <Page title={t('more.title')} description={description}>
      {!data ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Surface key={i} padding="lg">
              <Skeleton lines={3} />
            </Surface>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {data.dueNow > 0 && (
            <Link to="/study?mode=word" className={buttonClasses({ size: 'lg', fullWidth: true })}>
              {t('more.startReview')}
              <Icon name="chevron-right" size={20} />
            </Link>
          )}
          <NewCardsSection data={data} />
          <PracticeSection data={data} />
          <AheadSection data={data} />
        </div>
      )}
    </Page>
  );
}

function Section({
  id,
  title,
  body,
  children,
}: {
  id: string;
  title: string;
  body: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Surface as="section" aria-labelledby={id} padding="none" className="p-5 sm:p-6">
      <h2 id={id} className="font-serif text-xl font-semibold text-fg">
        {title}
      </h2>
      <div className="mt-1 text-[0.9375rem] text-fg-muted">{body}</div>
      {children && <div className="mt-5">{children}</div>}
    </Surface>
  );
}

function NewCardsSection({ data }: { data: MoreStudyOverview }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  const steps = extraNewSteps(data.newWaiting);

  const add = async (n: number) => {
    setBusy(n);
    try {
      await addExtraNew(n);
      await navigate('/study?mode=word');
    } catch (e) {
      void logError(e, 'more:addExtraNew');
      toast({ title: t('more.addFailed'), tone: 'danger' });
      setBusy(null);
    }
  };

  return (
    <Section
      id="more-new"
      title={t('more.newTitle')}
      body={
        <>
          <p>{t('more.newBody')}</p>
          <p className="mt-2 text-fg">
            {data.newWaiting > 0
              ? t('more.newWaiting', { count: data.newWaiting })
              : t('more.newNone')}
            {data.extraNewToday > 0 && (
              <span className="text-fg-muted">
                {' · '}
                {t('more.newExtraToday', { count: data.extraNewToday })}
              </span>
            )}
          </p>
        </>
      }
    >
      {steps.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {steps.map((n) => (
            <Button
              key={n}
              variant="secondary"
              className="sm:flex-1"
              loading={busy === n}
              disabled={busy !== null}
              onClick={() => void add(n)}
            >
              {t('more.newAdd', { count: n })}
            </Button>
          ))}
        </div>
      ) : (
        <Link to="/add" className={buttonClasses({ variant: 'secondary', fullWidth: true })}>
          <Icon name="plus" size={18} />
          {t('more.addCards')}
        </Link>
      )}
    </Section>
  );
}

interface SourceOption {
  value: PracticeSource;
  label: string;
  hint: string;
  count: number;
}

function PracticeSection({ data }: { data: MoreStudyOverview }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { practice } = data;
  const options: SourceOption[] = [
    {
      value: 'hard',
      label: t('more.sourceHard'),
      hint: t('more.sourceHardHint'),
      count: practice.hard,
    },
    {
      value: 'recent',
      label: t('more.sourceRecent'),
      hint: t('more.sourceRecentHint'),
      count: practice.recent,
    },
  ];
  if (practice.tags.length > 0) {
    options.push({
      value: 'tag',
      label: t('more.sourceTag'),
      hint: t('more.sourceTagHint'),
      count: practice.tags.reduce((a, x) => Math.max(a, x.count), 0),
    });
  }
  if (practice.decks.length > 0) {
    options.push({
      value: 'deck',
      label: t('more.sourceDeck'),
      hint: t('more.sourceDeckHint'),
      count: practice.decks.reduce((a, x) => Math.max(a, x.count), 0),
    });
  }
  if (practice.interests > 0) {
    options.push({
      value: 'interests',
      label: t('more.sourceInterests'),
      hint: t('more.sourceInterestsHint'),
      count: practice.interests,
    });
  }
  const firstAvailable = options.find((o) => o.count > 0)?.value ?? 'hard';
  const [picked, setPicked] = useState<PracticeSource | null>(null);
  const source =
    picked && options.some((o) => o.value === picked && o.count > 0) ? picked : firstAvailable;
  const [tagPicked, setTag] = useState<string | null>(null);
  const tag =
    tagPicked && practice.tags.some((x) => x.tag === tagPicked)
      ? tagPicked
      : (practice.tags[0]?.tag ?? null);
  const [deckPicked, setDeck] = useState<string | null>(null);
  const deck =
    deckPicked && practice.decks.some((x) => x.id === deckPicked)
      ? deckPicked
      : (practice.decks[0]?.id ?? null);
  const [size, setSize] = useState<PracticeSize>(10);
  const nothing = options.every((o) => o.count === 0);

  return (
    <Section
      id="more-practice"
      title={t('more.practiceTitle')}
      body={<p>{t('more.practiceBody')}</p>}
    >
      {nothing ? (
        <p className="text-[0.9375rem] text-fg">{t('more.practiceNone')}</p>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void navigate(
              practiceHref({
                source,
                size,
                tag: source === 'tag' ? tag : null,
                deck: source === 'deck' ? deck : null,
              }),
            );
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-fg">{t('more.sourceLegend')}</legend>
            {options.map((o) => {
              const selected = o.value === source;
              const disabled = o.count === 0;
              return (
                <label
                  key={o.value}
                  className={cn(
                    'flex items-center gap-3 rounded-control border px-4 py-3',
                    'transition-[background-color,border-color] duration-(--duration-micro) ease-standard',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                    disabled
                      ? 'cursor-not-allowed border-border opacity-45'
                      : selected
                        ? 'cursor-pointer border-accent bg-accent-soft/60'
                        : 'cursor-pointer border-border hover:border-border-strong',
                  )}
                >
                  <input
                    type="radio"
                    name="practice-source"
                    value={o.value}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => setPicked(o.value)}
                    className="size-4 shrink-0 accent-(--accent)"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium text-fg">{o.label}</span>
                    <span className="text-sm text-fg-muted">{o.hint}</span>
                  </span>
                  {o.value !== 'tag' && o.value !== 'deck' && (
                    <span className="tabular shrink-0 text-sm text-fg-muted">
                      {t('more.sourceCount', { count: o.count })}
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>

          {source === 'tag' && tag && (
            <Select
              label={t('more.tagLabel')}
              value={tag}
              onValueChange={setTag}
              options={practice.tags.map((x) => ({
                value: x.tag,
                label: `${x.tag} · ${t('more.sourceCount', { count: x.count })}`,
              }))}
            />
          )}

          {source === 'deck' && deck && (
            <Select
              label={t('more.deckLabel')}
              value={deck}
              onValueChange={setDeck}
              options={practice.decks.map((x) => ({
                value: x.id,
                label: `${x.name} · ${t('more.sourceCount', { count: x.count })}`,
              }))}
            />
          )}

          <SegmentedControl
            legend={t('more.sizeLegend')}
            options={PRACTICE_SIZES.map((n) => ({
              value: String(n),
              label: t('more.size', { count: n }),
            }))}
            value={String(size)}
            onValueChange={(v) => setSize(Number(v) as PracticeSize)}
          />

          <Button type="submit" variant="secondary" fullWidth>
            {t('more.practiceStart')}
          </Button>
        </form>
      )}
    </Section>
  );
}

function AheadSection({ data }: { data: MoreStudyOverview }) {
  const { t } = useTranslation();
  const n = data.aheadCount;
  return (
    <Section
      id="more-ahead"
      title={t('more.aheadTitle')}
      body={
        n > 0 ? (
          <>
            <p className="text-fg">{t('more.aheadBody', { count: n })}</p>
            <p className="mt-1 text-sm">{t('more.aheadNote')}</p>
          </>
        ) : (
          <p>{t('more.aheadNone')}</p>
        )
      }
    >
      {n > 0 && (
        <Link
          to="/study?mode=ahead"
          className={buttonClasses({ variant: 'secondary', fullWidth: true })}
        >
          {t('more.aheadStart')}
        </Link>
      )}
    </Section>
  );
}
