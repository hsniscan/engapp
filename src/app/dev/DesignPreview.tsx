import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  Eyebrow,
  HeatStrip,
  IconButton,
  Icon,
  ListGroup,
  ListRow,
  PageFrame,
  ProgressBar,
  ProgressRing,
  RatingBar,
  SectionHeader,
  SegmentedControl,
  Sheet,
  StageBar,
  StagePill,
  TabBar,
  Term,
  applyTheme,
  buttonClasses,
  cn,
  isNavActive,
  isThemePreference,
  type NavLinkItem,
} from '@/ui';
import { sampleCards, sampleIntervals } from '../pages/sampleCards';
import type tr from '@/i18n/tr.json';
import { previewReading } from './previewData';

type Pv = typeof tr.dev.preview;

/**
 * /dev/preview?screen=today|card|words|reader — static mock-ups of key v0.5.2 screens built
 * only from src/ui components (the blueprints in docs/design.md). Dev builds only; no data.
 */
export function DesignPreview() {
  const [params] = useSearchParams();
  const forced = params.get('theme');
  useEffect(() => {
    if (isThemePreference(forced)) applyTheme(forced);
  }, [forced]);
  const screen = params.get('screen') ?? 'today';
  return (
    <div className="min-h-dvh bg-canvas text-fg">
      {screen === 'card' ? (
        <CardBackScreen />
      ) : screen === 'words' ? (
        <WithTabs path="/decks">
          <WordsScreen />
        </WithTabs>
      ) : screen === 'reader' ? (
        <ReaderScreen />
      ) : (
        <WithTabs path="/">
          <TodayScreen />
        </WithTabs>
      )}
    </div>
  );
}

function WithTabs({ path, children }: { path: string; children: ReactNode }) {
  useLocation();
  const isActive = (item: NavLinkItem) => isNavActive(item, path);
  return (
    <>
      <main className="pb-[calc(var(--nav-height)+env(safe-area-inset-bottom)+1.5rem)]">
        {children}
      </main>
      <TabBar isActive={isActive} onAdd={() => {}} />
    </>
  );
}

function TodayScreen() {
  const { t } = useTranslation();
  const p = (k: keyof Pv['today']) => t(`dev.preview.today.${k}`);
  const week = (
    ['completed', 'completed', 'empty', 'active', 'completed', 'completed', 'completed'] as const
  ).map((level, i) => ({ level, label: String(i) }));
  return (
    <PageFrame eyebrow={t('dev.sampleEyebrow')} title={t('dev.sampleTitle')}>
      <div className="flex flex-col gap-8">
        <Card padding="lg" className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <ProgressRing
              value={12}
              max={30}
              size={76}
              label={p('ring')}
              valueText={p('ringValue')}
            >
              <span className="flex flex-col items-center leading-none">
                <span className="tabular text-title font-semibold">18</span>
                <span className="text-caption text-fg-muted">{p('remaining')}</span>
              </span>
            </ProgressRing>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-title font-semibold">{p('card')}</h2>
              <p className="text-ui text-fg-muted">{p('meta')}</p>
            </div>
          </div>
          <ChipRow label={p('modes')} bleed={false}>
            <Chip count={12}>{p('review')}</Chip>
            <Chip count={6}>{p('new')}</Chip>
            <Chip count={3}>{p('cloze')}</Chip>
          </ChipRow>
          <Button size="lg" fullWidth trailingIcon="arrow-right">
            {p('start')}
          </Button>
          <div className="flex items-center gap-4 border-t border-border pt-4">
            <HeatStrip days={week} label={t('dev.heatLabel')} className="max-w-36 flex-1" />
            <p className="flex items-center gap-1.5 text-meta font-semibold text-fg">
              <Icon name="flame" size={16} className="text-warn" />
              {t('dev.streak')}
            </p>
          </div>
        </Card>

        <section aria-labelledby="pv-words">
          <SectionHeader
            id="pv-words"
            title={p('words')}
            action={
              <Link
                to="/dev/preview?screen=words"
                className={buttonClasses({ variant: 'ghost', size: 'sm' })}
              >
                {p('all')}
              </Link>
            }
          />
          <Card className="flex flex-col gap-3">
            <p className="text-meta text-fg-muted">{p('wordsMeta')}</p>
            <StageBar
              stages={['learning', 'consolidating', 'learned', 'mastered']}
              counts={{ learning: 52, consolidating: 61, learned: 70, mastered: 31 }}
            />
          </Card>
        </section>

        <section aria-labelledby="pv-read">
          <SectionHeader id="pv-read" title={p('reading')} />
          <Card
            as={Link}
            to="/dev/preview?screen=reader"
            interactive
            className="flex flex-col gap-2"
          >
            <Eyebrow>{p('readingMeta')}</Eyebrow>
            <Term size="title" as="h3">
              {previewReading.title}
            </Term>
            <Term as="p" className="line-clamp-2 text-ui font-normal text-fg-muted">
              {previewReading.excerpt}
            </Term>
          </Card>
        </section>

        <section aria-labelledby="pv-short">
          <SectionHeader id="pv-short" title={p('shortcuts')} />
          <ListGroup>
            <ListRow
              to="/dev/preview"
              leadingIcon="alert"
              leadingTone="warn"
              title={p('hard')}
              description={p('hardDesc')}
              meta="7"
            />
            <ListRow
              to="/dev/preview"
              leadingIcon="layers"
              leadingTone="accent"
              title={p('bank')}
              description={p('bankDesc')}
            />
          </ListGroup>
        </section>
      </div>
    </PageFrame>
  );
}

function CardBackScreen() {
  const { t } = useTranslation();
  const p = (k: keyof Pv['card']) => t(`dev.preview.card.${k}`);
  const card = sampleCards[0];
  return (
    <div className="mx-auto flex min-h-dvh max-w-(--page-reading) flex-col">
      <header className="safe-top flex h-14 items-center gap-3 px-2">
        <IconButton icon="x" label={p('close')} tooltip={false} />
        <ProgressBar
          value={12}
          max={30}
          label={p('progress')}
          valueText={p('counter')}
          className="flex-1"
        />
        <span className="tabular pr-3 text-meta font-semibold text-fg-muted">{p('counter')}</span>
      </header>
      <main className="flex flex-1 flex-col gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <h1 className="sr-only">{t('dev.preview.title')}</h1>
        <Card tone="raised" padding="lg" className="flex flex-1 flex-col">
          <div className="flex items-center justify-between">
            <StagePill stage="consolidating" />
            <IconButton icon="speaker" label={t('common.listen')} variant="tonal" tooltip={false} />
          </div>
          <div className="flex flex-1 flex-col justify-center py-6">
            <div className="flex flex-col gap-1">
              <Term size="display" as="p">
                {card.term}
              </Term>
              <p className="flex items-center gap-2 text-ui text-fg-muted">
                <span lang="en" className="font-serif">
                  {card.ipa}
                </span>
                <Badge tone="outline">{card.pos}</Badge>
              </p>
            </div>
            <div className="my-6 border-t border-border" />
            <div className="flex flex-col gap-1.5">
              <Eyebrow>{p('meaning')}</Eyebrow>
              <p className="text-heading font-semibold">{card.meaning}</p>
            </div>
            <div className="mt-6 flex flex-col gap-1.5">
              <Eyebrow>{p('example')}</Eyebrow>
              <Term as="p" italic className="text-lead font-normal">
                {card.example}
              </Term>
              <p className="text-ui text-fg-muted">{card.exampleTr}</p>
            </div>
          </div>
        </Card>
        <RatingBar onRate={() => {}} intervals={sampleIntervals} />
      </main>
    </div>
  );
}

function WordsScreen() {
  const { t } = useTranslation();
  const p = (k: Exclude<keyof Pv['words'], 'due'>) => t(`dev.preview.words.${k}`);
  const decks = [
    { name: p('deck1'), desc: p('deck1Desc'), due: 6, letter: 'S' },
    { name: p('deck2'), desc: p('deck2Desc'), due: 0, letter: 'İ' },
    { name: p('deck3'), desc: p('deck3Desc'), due: 2, letter: 'O' },
  ];
  return (
    <PageFrame
      title={p('title')}
      actions={<IconButton icon="search" label={p('search')} tooltip={false} />}
    >
      <div className="flex flex-col gap-6">
        <SegmentedControl
          legend={p('views')}
          hideLegend
          value="decks"
          onValueChange={() => {}}
          options={[
            { value: 'decks', label: p('decks') },
            { value: 'bank', label: p('bank') },
          ]}
        />
        <Card
          as={Link}
          to="/dev/preview?screen=words"
          interactive
          padding="lg"
          className="flex flex-col gap-4"
        >
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Eyebrow as="h2">{p('all')}</Eyebrow>
              <p className="tabular flex items-baseline gap-2 text-numeral font-semibold">
                {p('allCount')}
                <span className="text-ui font-medium tracking-normal text-fg-muted">
                  {p('allUnit')}
                </span>
              </p>
            </div>
            <Icon name="chevron-right" size={20} className="mb-2 text-fg-subtle" />
          </div>
          <StageBar
            counts={{ new: 34, learning: 52, consolidating: 61, learned: 70, mastered: 31 }}
          />
        </Card>

        <section aria-labelledby="pv-decks" className="flex flex-col">
          <SectionHeader
            id="pv-decks"
            title={p('myDecks')}
            action={
              <Button variant="ghost" size="sm" leadingIcon="plus">
                {p('newDeck')}
              </Button>
            }
          />
          <ListGroup>
            {decks.map((d) => (
              <ListRow
                key={d.name}
                to="/dev/preview?screen=words"
                leading={
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-ui font-semibold text-accent-text"
                  >
                    {d.letter}
                  </span>
                }
                title={d.name}
                description={d.desc}
                trailing={
                  <span className="flex items-center gap-2">
                    {d.due > 0 && (
                      <Badge tone="accent">{t('dev.preview.words.due', { count: d.due })}</Badge>
                    )}
                    <Icon name="chevron-right" size={18} className="text-fg-subtle" />
                  </span>
                }
              />
            ))}
          </ListGroup>
          <EmptyState
            tone="placeholder"
            compact
            icon="plus"
            title={p('emptyTitle')}
            description={p('emptyBody')}
            className="mt-4"
          />
        </section>
      </div>
    </PageFrame>
  );
}

function ReaderScreen() {
  const { t } = useTranslation();
  const p = (k: keyof Pv['reader']) => t(`dev.preview.reader.${k}`);
  const w = previewReading.word;
  return (
    <>
      <header className="safe-top sticky top-0 z-10 border-b border-border bg-canvas/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-(--page-reading) items-center gap-2 px-2">
          <IconButton icon="arrow-left" label={p('back')} tooltip={false} />
          <p lang="en" className="min-w-0 flex-1 truncate text-center text-ui font-semibold">
            {previewReading.title}
          </p>
          <IconButton icon="settings" label={p('settings')} tooltip={false} />
        </div>
      </header>
      <main className="mx-auto max-w-(--page-reading) px-5 pt-8 pb-80">
        <Eyebrow>{p('meta')}</Eyebrow>
        <h1 lang="en" className="mt-2 mb-6 font-serif text-heading font-semibold">
          {previewReading.title}
        </h1>
        <div lang="en" className="flex flex-col gap-5 font-serif text-reading text-fg">
          {previewReading.paragraphs.map((para, i) => (
            <p key={i}>
              {para.map(([text, mark], j) =>
                mark ? (
                  <button
                    key={j}
                    type="button"
                    aria-describedby={`pv-mark-${mark}`}
                    className={cn(
                      'rounded-xs px-0.5 text-left',
                      mark === 'new'
                        ? 'bg-accent-soft text-accent-text underline decoration-accent-text decoration-dotted decoration-2 underline-offset-[5px]'
                        : 'underline decoration-accent-text/60 decoration-2 underline-offset-[5px]',
                      text === w.term && 'ring-2 ring-focus',
                    )}
                  >
                    {text}
                  </button>
                ) : (
                  <span key={j}>{text}</span>
                ),
              )}
            </p>
          ))}
        </div>
        <span id="pv-mark-new" className="sr-only">
          {p('newWord')}
        </span>
        <span id="pv-mark-learning" className="sr-only">
          {p('learningWord')}
        </span>
      </main>
      <Sheet
        open
        modal={false}
        title={
          <span className="flex items-baseline gap-3">
            <Term size="title">{w.term}</Term>
            <span lang="en" className="font-serif text-ui font-normal text-fg-muted">
              {w.ipa}
            </span>
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <StagePill stage="new" />
            <Badge tone="outline">{w.pos}</Badge>
            <IconButton
              icon="speaker"
              label={t('common.listen')}
              variant="tonal"
              size="sm"
              tooltip={false}
              className="ml-auto"
            />
          </div>
          <p className="text-title font-semibold">{w.meaning}</p>
          <div className="flex flex-col gap-1">
            <Term as="p" italic className="text-ui font-normal">
              {w.example}
            </Term>
            <p className="text-meta text-fg-muted">{w.exampleTr}</p>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 pt-1">
            <Button leadingIcon="plus">{p('add')}</Button>
            <Button variant="secondary">{p('known')}</Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
