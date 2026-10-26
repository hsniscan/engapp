// The cards of the Keşfet feed (v0.5.1, ADR 0057), one per feed kind. Calm and in the app's
// language: warm surfaces, one small eyebrow line per card, English terms in the serif, a
// single clear action. A card links to the filter that lists everything of its kind.
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { addFromWordBank, logError } from '@/data';
import { openGradedText } from '@/data/library';
import { readingMinutes, type ScoredGradedText, understoodPercent } from '@/domain/library';
import type { FeedFilter } from '@/domain/discoverFeed';
import { readerPath, type ReaderText } from '@/domain/texts';
import type { CefrLevel } from '@/domain/types';
import type { WordBankEntry } from '@/domain/wordBank';
import { CREATE_TEXT_HREF, filterHref } from './links';
import { posLabel } from '@/features/cards/labels';
import { Featured, ForYouRow } from '@/features/decks/DeckCatalog';
import { nf } from '@/features/decks/deckUi';
import { LevelPill } from '@/features/decks/parts';
import { specHref, specTitle } from '@/features/decks/suggested';
import { TodayStoryRow } from '@/features/story/TodayStoryRow';
import { Button, buttonClasses, cn, Icon, type IconName, IconButton, toast } from '@/ui';
import type { FeedItem } from './useDiscoverFeed';


const shell = 'flex flex-col gap-3 rounded-[20px] border border-border bg-surface p-[18px]';

/** The small line on top of a card: an icon, what the card is, and "Tümünü gör". */
function Eyebrow({
  id,
  icon,
  children,
  more,
}: {
  id: string;
  icon: IconName;
  children: ReactNode;
  more?: FeedFilter;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-6 items-center justify-between gap-3">
      <h2
        id={id}
        className="flex items-center gap-2 text-[0.8125rem] font-semibold tracking-[0.04em] text-fg-muted uppercase"
      >
        <Icon name={icon} size={16} strokeWidth={1.8} className="text-accent-text" />
        {children}
      </h2>
      {more && (
        <Link
          to={filterHref(more)}
          className="-my-2.5 -mr-2 inline-flex min-h-11 items-center gap-0.5 rounded-control px-2 text-sm font-medium text-accent-text hover:bg-hover"
        >
          {t('discover.seeAll')}
          <Icon name="chevron-right" size={16} />
        </Link>
      )}
    </div>
  );
}

const textPct = (x: ReaderText) =>
  x.finished_at !== null ? 100 : x.body.length ? Math.min(99, Math.round((x.progress_offset / x.body.length) * 100)) : 0;

function ContinueCard({ text }: { text: ReaderText }) {
  const { t } = useTranslation();
  const pct = textPct(text);
  return (
    <section aria-labelledby="kf-continue" className={shell} data-testid="kesfet-continue">
      <Eyebrow id="kf-continue" icon="book">
        {t('discover.continue.eyebrow')}
      </Eyebrow>
      <p lang="en" className="font-serif text-[1.375rem] leading-snug font-semibold text-fg">
        {text.title}
      </p>
      <div className="flex flex-col gap-1.5">
        <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(pct, 2)}%` }} />
        </span>
        <span className="text-[0.8125rem] text-fg-muted">
          {t(`reader.kind.${text.kind}`)} ·{' '}
          {pct > 0 ? t('discover.continue.pct', { pct }) : t('discover.continue.start')}
        </span>
      </div>
      <Link to={readerPath(text.id)} className={buttonClasses({ fullWidth: true })}>
        {t('discover.continue.action')}
        <Icon name="arrow-right" size={18} />
      </Link>
    </section>
  );
}

function StoryCard() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="kf-story" className={shell}>
      <Eyebrow id="kf-story" icon="book">
        {t('discover.story.eyebrow')}
      </Eyebrow>
      {/* The row draws its own divider for the Bugün card; here it is the card's body. */}
      <div className="[&>div]:mt-0 [&>div]:border-t-0 [&>div]:pt-0">
        <TodayStoryRow />
      </div>
    </section>
  );
}

/** Opens a graded library text in the reader (makes its reading row on the first open). */
function useOpenGraded() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (s: ScoredGradedText) => {
    if (busy) return;
    setBusy(s.entry.id);
    try {
      const id = await openGradedText({ id: s.entry.id, title: s.entry.title });
      void navigate(readerPath(id));
    } catch (e) {
      void logError(e, 'discover.openGraded');
      toast({ title: t('gradedLibrary.openFailed'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };
  return { open, busy };
}

function GradedRows({ texts, label }: { texts: ScoredGradedText[]; label: string }) {
  const { t } = useTranslation();
  const { open, busy } = useOpenGraded();
  return (
    <ul aria-label={label} className="-mx-1.5 flex flex-col">
      {texts.map((s) => (
        <li key={s.entry.id}>
          <button
            type="button"
            onClick={() => void open(s)}
            aria-busy={busy === s.entry.id || undefined}
            className="flex min-h-14 w-full items-center gap-3 rounded-[14px] px-1.5 py-2.5 text-left hover:bg-hover"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span lang="en" className="truncate font-serif text-[1.0625rem] font-semibold text-fg">
                {s.entry.title}
              </span>
              <span className="truncate text-[0.8125rem] text-fg-muted">
                {t('gradedLibrary.meta', {
                  level: s.entry.level,
                  topic: t(`gradedLibrary.topics.${s.entry.topic}`, { defaultValue: s.entry.topic }),
                  minutes: readingMinutes(s.entry.words),
                })}{' '}
                · {t('gradedLibrary.understood', { percent: understoodPercent(s.unknownRate) })}
              </span>
            </span>
            <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function SuggestionsCard({ texts, difficulty }: { texts: ScoredGradedText[]; difficulty: string }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="kf-suggest" className={shell}>
      <Eyebrow id="kf-suggest" icon="book" more="okuma">
        {t('discover.suggestions.eyebrow')}
      </Eyebrow>
      <p className="-mt-1 text-[0.8125rem] text-fg-muted">
        {t('discover.suggestions.body', {
          difficulty: t(`gradedLibrary.difficulty.${difficulty as 'dengeli'}`, { defaultValue: difficulty }),
        })}
      </p>
      <GradedRows texts={texts} label={t('discover.suggestions.label')} />
    </section>
  );
}

function NewTextsCard({ texts }: { texts: ScoredGradedText[] }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="kf-new" className={shell}>
      <Eyebrow id="kf-new" icon="layers" more="okuma">
        {t('discover.newTexts.eyebrow')}
      </Eyebrow>
      <GradedRows texts={texts} label={t('discover.newTexts.label')} />
    </section>
  );
}

function CreateTextCard() {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="kf-create"
      className="flex flex-col gap-3 rounded-[20px] border border-accent/25 bg-accent-soft p-[18px]"
    >
      <span className="flex items-center gap-2 text-[0.8125rem] font-semibold tracking-[0.04em] text-accent-text uppercase">
        <Icon name="pencil" size={16} strokeWidth={1.8} />
        {t('discover.createText.eyebrow')}
      </span>
      <h2 id="kf-create" className="font-serif text-[1.375rem] leading-snug font-semibold text-fg">
        {t('discover.createText.title')}
      </h2>
      <p className="text-[0.9375rem] text-fg-muted">{t('discover.createText.body')}</p>
      <Link to={CREATE_TEXT_HREF} className={buttonClasses({ variant: 'secondary', className: 'self-start' })}>
        {t('discover.createText.action')}
        <Icon name="arrow-right" size={18} />
      </Link>
    </section>
  );
}

function MyTextsCard({ texts, total }: { texts: ReaderText[]; total: number }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="kf-mine" className={shell}>
      <Eyebrow id="kf-mine" icon="file" more="okuma">
        {t('discover.myTexts.eyebrow')}
        <span className="font-normal tracking-normal normal-case">· {t('discover.myTexts.count', { count: total })}</span>
      </Eyebrow>
      <ul aria-label={t('discover.myTexts.label')} className="-mx-1.5 flex flex-col">
        {texts.map((x) => {
          const pct = textPct(x);
          return (
            <li key={x.id}>
              <Link
                to={readerPath(x.id)}
                className="flex min-h-14 items-center gap-3 rounded-[14px] px-1.5 py-2.5 hover:bg-hover"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span lang="en" className="truncate font-serif text-[1.0625rem] font-semibold text-fg">
                    {x.title}
                  </span>
                  <span className="text-[0.8125rem] text-fg-muted">
                    {t(`reader.kind.${x.kind}`)} ·{' '}
                    {x.finished_at !== null
                      ? t('reader.list.finished')
                      : pct > 0
                        ? t('reader.list.progress', { pct })
                        : t('reader.list.unread')}
                  </span>
                </span>
                <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ForYouCard({ item, level }: { item: Extract<FeedItem, { kind: 'forYouDecks' }>; level: CefrLevel }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="kf-foryou" className="flex flex-col gap-3">
      <div className="px-1">
        <Eyebrow id="kf-foryou" icon="cards" more="desteler">
          {t('discover.forYou.eyebrow')}
        </Eyebrow>
        <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{t('discover.forYou.body', { level })}</p>
      </div>
      <ForYouRow decks={item.decks} level={level} />
    </section>
  );
}

function ShelfCard({ item, level }: { item: Extract<FeedItem, { kind: 'deckShelf' }>; level: CefrLevel }) {
  const { t } = useTranslation();
  const chip =
    'flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-sm text-fg hover:border-border-strong';
  return (
    <section aria-labelledby="kf-shelf" className={shell}>
      <Eyebrow id="kf-shelf" icon="cards" more="desteler">
        {t('discover.shelf.eyebrow')}
      </Eyebrow>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg">{t('discover.shelf.levels')}</h3>
        <ul className="-mr-[18px] flex gap-2 overflow-x-auto pr-[18px] pb-1 [scrollbar-width:none]">
          {item.levels.map((d) => {
            const lv = (d.spec as { level: CefrLevel }).level;
            return (
              <li key={lv}>
                <Link
                  to={specHref(d.spec)}
                  aria-label={`${specTitle(t, d.spec)}, ${t('deckHub.words', { count: d.progress.total, formatted: nf.format(d.progress.total) })}`}
                  className={cn(chip, lv === level && 'border-accent bg-accent-soft font-semibold text-accent-text')}
                >
                  <span className="font-serif text-base font-semibold">{lv}</span>
                  <span className="tabular text-fg-muted">{nf.format(d.progress.total)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg">{t('discover.shelf.pos')}</h3>
        <ul className="-mr-[18px] flex gap-2 overflow-x-auto pr-[18px] pb-1 [scrollbar-width:none]">
          {item.levelPos.map((d) => (
            <li key={specHref(d.spec)}>
              <Link to={specHref(d.spec)} className={chip}>
                <span className="font-semibold">{specTitle(t, d.spec)}</span>
                <span className="tabular text-fg-muted">{nf.format(d.progress.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function WordOfDayCard({ entry }: { entry: WordBankEntry }) {
  const { t } = useTranslation();
  // The pick moves on once the word is in the cards: keep showing the one just added.
  const [added, setAdded] = useState<WordBankEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const word = added ?? entry;
  const sense = word.senses[0];
  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await addFromWordBank([{ entry }]);
      setAdded(entry);
      toast({ title: t('discover.word.addedToast', { word: entry.lemma }), tone: 'success' });
    } catch (e) {
      void logError(e, 'discover.wordOfDay');
      toast({ title: t('discover.word.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="kf-word" className={shell} data-testid="kesfet-word">
      <Eyebrow id="kf-word" icon="sun" more="kelimeler">
        {t('discover.word.eyebrow')}
      </Eyebrow>
      <div className="flex items-baseline gap-2.5">
        <p lang="en" className="font-serif text-[2rem] leading-none font-semibold text-fg">
          {word.lemma}
        </p>
        <span className="text-sm text-fg-muted">{posLabel(t, word.pos)}</span>
        <LevelPill level={word.cefr} className="ml-auto" />
      </div>
      {sense && (
        <>
          <p className="text-[1.0625rem] text-fg">{sense.meaning_tr}</p>
          <figure className="flex flex-col gap-1 rounded-[14px] bg-canvas px-3.5 py-3">
            <figcaption className="sr-only">{t('discover.word.example')}</figcaption>
            <p lang="en" className="font-serif text-[1.0625rem] text-fg italic">
              {sense.example_en}
            </p>
            <p className="text-sm text-fg-muted">{sense.example_tr}</p>
          </figure>
        </>
      )}
      {added ? (
        <p role="status" className="flex min-h-11 items-center gap-2 text-[0.9375rem] font-medium text-success-text">
          <Icon name="check" size={18} />
          {t('discover.word.added')}
        </p>
      ) : (
        <Button variant="secondary" leadingIcon="plus" loading={busy} onClick={() => void add()} className="self-start">
          {t('discover.word.add')}
        </Button>
      )}
    </section>
  );
}

function WordsAtLevelCard({ entries, level }: { entries: WordBankEntry[]; level: CefrLevel }) {
  const { t } = useTranslation();
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  // Keep the list as it was when the card appeared: added words stay, marked.
  const [shown] = useState(entries);
  const add = async (e: WordBankEntry) => {
    try {
      await addFromWordBank([{ entry: e }]);
      setAdded((s) => new Set(s).add(e.id));
      toast({ title: t('discover.wordsAtLevel.added', { word: e.lemma }), tone: 'success' });
    } catch (err) {
      void logError(err, 'discover.wordsAtLevel');
      toast({ title: t('discover.word.failed'), tone: 'danger' });
    }
  };
  return (
    <section aria-labelledby="kf-words" className={shell}>
      <Eyebrow id="kf-words" icon="plus" more="kelimeler">
        {t('discover.wordsAtLevel.eyebrow')}
      </Eyebrow>
      <p className="-mt-1 text-[0.8125rem] text-fg-muted">{t('discover.wordsAtLevel.body', { level })}</p>
      <ul aria-label={t('discover.wordsAtLevel.label')} className="flex flex-col divide-y divide-border">
        {shown.map((e) => (
          <li key={e.id} className="flex min-h-14 items-center gap-3 py-1.5">
            <span className="flex min-w-0 flex-1 flex-col">
              <span lang="en" className="font-serif text-[1.0625rem] font-semibold text-fg">
                {e.lemma}
              </span>
              <span className="truncate text-[0.8125rem] text-fg-muted">{e.senses[0]?.meaning_tr}</span>
            </span>
            {added.has(e.id) ? (
              <span className="flex size-11 items-center justify-center text-success-text">
                <Icon name="check" size={20} />
                <span className="sr-only">{t('discover.wordsAtLevel.added', { word: e.lemma })}</span>
              </span>
            ) : (
              <IconButton
                icon="plus"
                variant="secondary"
                label={t('discover.wordsAtLevel.add', { word: e.lemma })}
                tooltip={false}
                onClick={() => void add(e)}
              />
            )}
          </li>
        ))}
      </ul>
      <Link
        to="/decks?tab=bank"
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-accent-text hover:underline"
      >
        {t('discover.wordsAtLevel.bank')}
        <Icon name="chevron-right" size={16} />
      </Link>
    </section>
  );
}

function FalseFriendCard({ item }: { item: Extract<FeedItem, { kind: 'falseFriendOfDay' }> }) {
  const { t } = useTranslation();
  const n = item.note;
  return (
    <section aria-labelledby="kf-ff" className={shell}>
      <Eyebrow id="kf-ff" icon="alert">
        {t('discover.falseFriend.eyebrow')}
      </Eyebrow>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 rounded-[14px] bg-canvas p-3.5">
        <span className="flex flex-col gap-0.5">
          <span lang="en" className="font-serif text-[1.375rem] font-semibold text-fg">
            {n.term}
          </span>
          <span className="text-[0.8125rem] text-fg-muted">{n.content.en_meaning_tr}</span>
        </span>
        <span aria-label={t('deckHub.discover.notEqual')} className="font-serif text-2xl text-danger-text">
          ≠
        </span>
        <span className="flex flex-col gap-0.5 text-right">
          <span lang="tr" className="font-serif text-[1.375rem] text-fg italic">
            {n.content.tr_word}
          </span>
          <span className="text-[0.8125rem] text-fg-muted">{n.content.tr_meaning_tr}</span>
        </span>
      </div>
      {n.content.note_tr && <p className="text-sm text-fg-muted">{n.content.note_tr}</p>}
      <Link
        to={specHref({ kind: 'falseFriends' })}
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-accent-text hover:underline"
      >
        {t('discover.falseFriend.deck', { count: item.pairs })}
        <Icon name="chevron-right" size={16} />
      </Link>
    </section>
  );
}

/** One feed card. `level` is the learner's level (deck and word cards show it). */
export function FeedCard({ item, level, idx }: { item: FeedItem; level: CefrLevel; idx?: Parameters<typeof Featured>[0]['idx'] }) {
  switch (item.kind) {
    case 'continue':
      return <ContinueCard text={item.text} />;
    case 'story':
      return <StoryCard />;
    case 'textSuggestions':
      return <SuggestionsCard texts={item.texts} difficulty={item.difficulty} />;
    case 'createText':
      return <CreateTextCard />;
    case 'newTexts':
      return <NewTextsCard texts={item.texts} />;
    case 'myTexts':
      return <MyTextsCard texts={item.texts} total={item.total} />;
    case 'featuredDeck':
      return idx ? <Featured deck={item.deck} idx={idx} /> : null;
    case 'forYouDecks':
      return <ForYouCard item={item} level={level} />;
    case 'deckShelf':
      return <ShelfCard item={item} level={level} />;
    case 'wordOfDay':
      return <WordOfDayCard entry={item.entry} />;
    case 'wordsAtLevel':
      return <WordsAtLevelCard entries={item.entries} level={level} />;
    case 'falseFriendOfDay':
      return <FalseFriendCard item={item} />;
  }
}

/** Offline, failed or no server: what is missing comes later; never a dead end. */
export function MissingNote({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <aside
      aria-labelledby="kf-missing"
      className="flex items-start gap-3 rounded-[18px] border border-dashed border-border-strong/50 bg-surface px-4 py-3.5"
      data-testid="kesfet-missing"
    >
      <Icon name="sync-offline" size={20} className="mt-0.5 shrink-0 text-fg-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id="kf-missing" className="text-[0.9375rem] font-semibold text-fg">
          {t('discover.missing.title')}
        </h2>
        <p className="text-sm text-fg-muted">{t('discover.missing.body')}</p>
        <Button variant="secondary" size="sm" leadingIcon="refresh" onClick={onRetry} className="mt-1.5 self-start">
          {t('discover.missing.retry')}
        </Button>
      </div>
    </aside>
  );
}
