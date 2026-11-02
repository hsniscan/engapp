// The cards of the Keşfet feed (v0.5.1, ADR 0057; Çam look v0.5.2, docs/design.md §4.12), one
// per feed kind, built only from src/ui: a Card with one Eyebrow line (and "Tümünü gör" where
// a filter lists everything of its kind), English in Literata (<Term>), one clear action.
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { addFromWordBank, logError } from '@/data';
import { openGradedText } from '@/data/library';
import { readingMinutes, type ScoredGradedText, understoodPercent } from '@/domain/library';
import type { FeedFilter } from '@/domain/discoverFeed';
import { readerPath, readingProgress, type ReaderText } from '@/domain/texts';
import type { CefrLevel } from '@/domain/types';
import type { WordBankEntry } from '@/domain/wordBank';
import { posLabel } from '@/features/cards/labels';
import type { DeckCard } from '@/features/decks/deckView';
import { specHref, specTitle } from '@/features/decks/suggested';
import { progressLabel } from '@/features/reader/progressLabel';
import { useTextKindLabel } from '@/features/reader/kindLabel';
import { TodayStoryRow } from '@/features/story/TodayStoryRow';
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  Eyebrow,
  Icon,
  IconButton,
  IconTile,
  type IconName,
  ProgressBar,
  Term,
  toast,
} from '@/ui';
import { CREATE_TEXT_HREF, filterHref } from './links';
import type { FeedItem } from './useDiscoverFeed';

const nf = new Intl.NumberFormat('tr-TR');

/** A card's top line: what it is (an h2 eyebrow) and, optionally, "Tümünü gör". */
function CardHead({ id, children, more }: { id: string; children: ReactNode; more?: FeedFilter }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-6 items-center justify-between gap-3">
      <Eyebrow as="h2">
        <span id={id}>{children}</span>
      </Eyebrow>
      {more && (
        <Link
          to={filterHref(more)}
          className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-my-2 -mr-3' })}
        >
          {t('discover.seeAll')}
          <Icon name="chevron-right" size={16} />
        </Link>
      )}
    </div>
  );
}

/** Rows inside a card, edge to edge, with hairlines between them. */
function CardRows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="-mx-4 divide-y divide-border border-t border-border sm:-mx-5">
      {children}
    </ul>
  );
}

const rowClass =
  'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-(--duration-micro) hover:bg-hover focus-visible:outline-offset-[-2px] sm:px-5';

function ContinueCard({ text }: { text: ReaderText }) {
  const { t } = useTranslation();
  const kindLabel = useTextKindLabel();
  const p = readingProgress(text);
  return (
    <Card
      as="section"
      aria-labelledby="kf-continue"
      className="flex flex-col gap-4"
      data-testid="kesfet-continue"
    >
      <CardHead id="kf-continue">{t('discover.continue.eyebrow')}</CardHead>
      <div className="flex flex-col gap-2">
        <Term as="p" size="title" className="text-fg">
          {text.title}
        </Term>
        <p className="text-meta text-fg-muted">
          {kindLabel(text)} · {p.state === 'unread' ? t('discover.continue.start') : progressLabel(t, text)}
        </p>
        {p.pct > 0 && (
          <ProgressBar value={p.pct} label={t('discover.continue.eyebrow')} valueText={progressLabel(t, text)} />
        )}
      </div>
      <Link
        to={readerPath(text.id)}
        className={buttonClasses({ fullWidth: true, size: 'lg' })}
      >
        {t('discover.continue.action')}
        <Icon name="arrow-right" size={20} />
      </Link>
    </Card>
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
    <CardRows label={label}>
      {texts.map((s) => (
        <li key={s.entry.id}>
          <button
            type="button"
            onClick={() => void open(s)}
            aria-busy={busy === s.entry.id || undefined}
            className={rowClass}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Term className="text-fg">{s.entry.title}</Term>
              <span className="text-meta text-fg-muted">
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
    </CardRows>
  );
}

function SuggestionsCard({
  texts,
  difficulty,
  stretch = false,
}: {
  texts: ScoredGradedText[];
  difficulty: string;
  stretch?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card as="section" aria-labelledby="kf-suggest" className="flex flex-col gap-3 pb-0 sm:pb-0">
      <CardHead id="kf-suggest" more="okuma">
        {t('discover.suggestions.eyebrow')}
      </CardHead>
      <p className="text-meta text-fg-muted">
        {t(stretch ? 'discover.suggestions.stretch' : 'discover.suggestions.body', {
          difficulty: t(`gradedLibrary.difficulty.${difficulty as 'dengeli'}`, {
            defaultValue: difficulty,
          }),
        })}
      </p>
      <GradedRows texts={texts} label={t('discover.suggestions.label')} />
    </Card>
  );
}

function NewTextsCard({ texts }: { texts: ScoredGradedText[] }) {
  const { t } = useTranslation();
  return (
    <Card as="section" aria-labelledby="kf-new" className="flex flex-col gap-3 pb-0 sm:pb-0">
      <CardHead id="kf-new" more="okuma">
        {t('discover.newTexts.eyebrow')}
      </CardHead>
      <GradedRows texts={texts} label={t('discover.newTexts.label')} />
    </Card>
  );
}

function CreateTextCard() {
  const { t } = useTranslation();
  return (
    <Card as="section" tone="accent" aria-labelledby="kf-create" className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <IconTile icon="pen" tone="accent" className="bg-surface" />
        <div className="flex min-w-0 flex-col gap-1">
          <Eyebrow>{t('discover.createText.eyebrow')}</Eyebrow>
          <h2 id="kf-create" className="text-title font-semibold text-fg">
            {t('discover.createText.title')}
          </h2>
        </div>
      </div>
      <p className="text-ui text-fg-muted">{t('discover.createText.body')}</p>
      <Link
        to={CREATE_TEXT_HREF}
        className={buttonClasses({ variant: 'secondary', className: 'self-start' })}
      >
        {t('discover.createText.action')}
        <Icon name="arrow-right" size={18} />
      </Link>
    </Card>
  );
}

function MyTextsCard({ texts, total }: { texts: ReaderText[]; total: number }) {
  const { t } = useTranslation();
  const kindLabel = useTextKindLabel();
  return (
    <Card as="section" aria-labelledby="kf-mine" className="flex flex-col gap-3 pb-0 sm:pb-0">
      <CardHead id="kf-mine" more="okuma">
        {t('discover.myTexts.eyebrow')} · {t('discover.myTexts.count', { count: total })}
      </CardHead>
      <CardRows label={t('discover.myTexts.label')}>
        {texts.map((x) => (
          <li key={x.id}>
            <Link to={readerPath(x.id)} className={rowClass}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Term className="truncate text-fg">{x.title}</Term>
                <span className="text-meta text-fg-muted">
                  {kindLabel(x)} · {progressLabel(t, x)}
                </span>
              </span>
              <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
            </Link>
          </li>
        ))}
      </CardRows>
    </Card>
  );
}

const knownPct = (d: DeckCard) =>
  d.progress.total ? Math.round(((d.progress.learned + d.progress.known) / d.progress.total) * 100) : 0;

/** One suggested deck as a row: accent tile, name, count, badges. */
function DeckRow({ deck, badge }: { deck: DeckCard; badge?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li>
      <Link to={specHref(deck.spec)} className={rowClass}>
        <IconTile icon="cards" tone="accent" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-ui font-semibold text-fg">{specTitle(t, deck.spec)}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="tabular text-meta text-fg-muted">
              {t('deckHub.words', { count: deck.progress.total, formatted: nf.format(deck.progress.total) })}
            </span>
            {badge}
            {knownPct(deck) > 0 && (
              <Badge tone="neutral">{t('discover.decks.known', { pct: knownPct(deck) })}</Badge>
            )}
          </span>
        </span>
        <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
      </Link>
    </li>
  );
}

function FeaturedDeckCard({ deck, level }: { deck: DeckCard; level: CefrLevel }) {
  const { t } = useTranslation();
  const spec = deck.spec;
  const pos = spec.kind === 'levelPos' ? spec.pos : 'verb';
  const sample = deck.words.slice(0, 5);
  return (
    <Card
      as={Link}
      to={specHref(spec)}
      interactive
      className="flex flex-col gap-3"
      data-testid="kesfet-featured-deck"
    >
      <Eyebrow>{t('deckHub.discover.featured')}</Eyebrow>
      <div className="flex items-start gap-3">
        <IconTile icon="cards" tone="accent" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-title font-semibold text-fg">{specTitle(t, spec)}</h2>
          <p className="text-meta text-fg-muted">
            {t(`deckHub.discover.featuredBody.${pos as 'verb'}`, { defaultValue: '' })}
          </p>
        </div>
        <Icon name="chevron-right" size={18} className="mt-2.5 shrink-0 text-fg-subtle" />
      </div>
      {sample.length > 0 && (
        <Term as="p" italic className="text-fg-muted">
          {sample.map((w) => w.lemma).join(' · ')}
        </Term>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="accent">{level}</Badge>
        <Badge tone="neutral">
          {t('deckHub.words', { count: deck.progress.total, formatted: nf.format(deck.progress.total) })}
        </Badge>
        {knownPct(deck) > 0 && (
          <Badge tone="neutral">{t('discover.decks.known', { pct: knownPct(deck) })}</Badge>
        )}
      </div>
    </Card>
  );
}

function ForYouCard({ item, level }: { item: Extract<FeedItem, { kind: 'forYouDecks' }>; level: CefrLevel }) {
  const { t } = useTranslation();
  return (
    <Card as="section" aria-labelledby="kf-foryou" className="flex flex-col gap-3 pb-0 sm:pb-0">
      <CardHead id="kf-foryou" more="desteler">
        {t('discover.forYou.eyebrow')}
      </CardHead>
      <p className="text-meta text-fg-muted">{t('discover.forYou.body', { level })}</p>
      <CardRows label={t('discover.forYou.eyebrow')}>
        {item.decks.map((d) => (
          <DeckRow
            key={specHref(d.spec)}
            deck={d}
            badge={
              d.upLevel ? <Badge tone="success">{t('deckHub.discover.upLevel')}</Badge> : undefined
            }
          />
        ))}
      </CardRows>
    </Card>
  );
}

function ShelfCard({ item, level }: { item: Extract<FeedItem, { kind: 'deckShelf' }>; level: CefrLevel }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Card as="section" aria-labelledby="kf-shelf" className="flex flex-col gap-4">
      <CardHead id="kf-shelf" more="desteler">
        {t('discover.shelf.eyebrow')}
      </CardHead>
      <div className="flex flex-col gap-2">
        <h3 className="text-ui font-semibold text-fg">{t('discover.shelf.levels')}</h3>
        <ChipRow label={t('discover.shelf.levels')} bleed={false}>
          {item.levels
            .filter((d) => d.progress.total > 0)
            .map((d) => {
              const lv = (d.spec as { level: CefrLevel }).level;
              return (
                <Chip
                  key={lv}
                  count={d.progress.total}
                  selected={lv === level || undefined}
                  aria-pressed={undefined}
                  onClick={() => void navigate(specHref(d.spec))}
                >
                  {lv}
                </Chip>
              );
            })}
        </ChipRow>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-ui font-semibold text-fg">{t('discover.shelf.pos')}</h3>
        <ChipRow label={t('discover.shelf.pos')} bleed={false}>
          {item.levelPos
            .filter((d) => d.progress.total > 0)
            .map((d) => (
              <Chip
                key={specHref(d.spec)}
                count={d.progress.total}
                onClick={() => void navigate(specHref(d.spec))}
              >
                {specTitle(t, d.spec)}
              </Chip>
            ))}
        </ChipRow>
      </div>
    </Card>
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
    <Card as="section" aria-labelledby="kf-word" className="flex flex-col gap-3" data-testid="kesfet-word">
      <CardHead id="kf-word" more="kelimeler">
        {t('discover.word.eyebrow')}
      </CardHead>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Term as="p" size="title" className="text-fg">
          {word.lemma}
        </Term>
        <Badge tone="outline">{posLabel(t, word.pos)}</Badge>
        <Badge tone="accent">{word.cefr}</Badge>
      </div>
      {sense && (
        <>
          <p className="text-lead font-medium text-fg">{sense.meaning_tr}</p>
          {sense.example_en && (
            <Card tone="sunken" inset padding="sm" className="flex flex-col gap-1 px-4">
              <span className="sr-only">{t('discover.word.example')}</span>
              <Term as="p" italic className="font-normal text-fg">
                {sense.example_en}
              </Term>
              {sense.example_tr && <p className="text-ui text-fg-muted">{sense.example_tr}</p>}
            </Card>
          )}
        </>
      )}
      {added ? (
        <p role="status" className="flex min-h-11 items-center gap-2 text-ui font-medium text-success-text">
          <Icon name="check" size={18} />
          {t('discover.word.added')}
        </p>
      ) : (
        <Button
          variant="tonal"
          leadingIcon="plus"
          loading={busy}
          onClick={() => void add()}
          className="self-start"
        >
          {t('discover.word.add')}
        </Button>
      )}
    </Card>
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
    <Card as="section" aria-labelledby="kf-words" className="flex flex-col gap-3">
      <CardHead id="kf-words" more="kelimeler">
        {t('discover.wordsAtLevel.eyebrow')}
      </CardHead>
      <p className="text-meta text-fg-muted">{t('discover.wordsAtLevel.body', { level })}</p>
      <CardRows label={t('discover.wordsAtLevel.label')}>
        {shown.map((e) => (
          <li key={e.id} className="flex min-h-14 items-center gap-3 px-4 py-2 sm:px-5">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Term className="text-fg">{e.lemma}</Term>
              <span className="truncate text-meta text-fg-muted">{e.senses[0]?.meaning_tr}</span>
            </span>
            {added.has(e.id) ? (
              <span className="flex size-11 items-center justify-center text-success-text">
                <Icon name="check" size={20} />
                <span className="sr-only">{t('discover.wordsAtLevel.added', { word: e.lemma })}</span>
              </span>
            ) : (
              <IconButton
                icon="plus"
                variant="tonal"
                label={t('discover.wordsAtLevel.add', { word: e.lemma })}
                tooltip={false}
                onClick={() => void add(e)}
              />
            )}
          </li>
        ))}
      </CardRows>
      <Link
        to="/decks?tab=bank"
        className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 self-start' })}
      >
        {t('discover.wordsAtLevel.bank')}
        <Icon name="chevron-right" size={16} />
      </Link>
    </Card>
  );
}

function FalseFriendCard({ item }: { item: Extract<FeedItem, { kind: 'falseFriendOfDay' }> }) {
  const { t } = useTranslation();
  const n = item.note;
  return (
    <Card as="section" aria-labelledby="kf-ff" className="flex flex-col gap-3">
      <CardHead id="kf-ff">{t('discover.falseFriend.eyebrow')}</CardHead>
      <Card
        tone="sunken"
        inset
        padding="sm"
        className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4"
      >
        <span className="flex flex-col gap-0.5">
          <Term className="text-heading font-semibold text-fg">{n.term}</Term>
          <span className="text-meta text-fg-muted">{n.content.en_meaning_tr}</span>
        </span>
        <span role="img" aria-label={t('deckHub.discover.notEqual')} className="text-title text-danger-text">
          ≠
        </span>
        <span className="flex flex-col gap-0.5 text-right">
          <span lang="tr" className="text-heading font-semibold text-fg">
            {n.content.tr_word}
          </span>
          <span className="text-meta text-fg-muted">{n.content.tr_meaning_tr}</span>
        </span>
      </Card>
      {n.content.note_tr && <p className="text-ui text-fg-muted">{n.content.note_tr}</p>}
      <Link
        to={specHref({ kind: 'falseFriends' })}
        className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 self-start' })}
      >
        {t('discover.falseFriend.deck', { count: item.pairs })}
        <Icon name="chevron-right" size={16} />
      </Link>
    </Card>
  );
}

/**
 * One feed card. `level` is the learner's level (deck and word cards show it); `continueId` is
 * the text of the "Devam et" card, so the story card never repeats it (B11).
 */
export function FeedCard({
  item,
  level,
  continueId = null,
}: {
  item: FeedItem;
  level: CefrLevel;
  continueId?: string | null;
}) {
  switch (item.kind) {
    case 'continue':
      return <ContinueCard text={item.text} />;
    case 'story':
      return <TodayStoryRow variant="card" hideTextId={continueId} />;
    case 'textSuggestions':
      return <SuggestionsCard texts={item.texts} difficulty={item.difficulty} stretch={item.stretch} />;
    case 'createText':
      return <CreateTextCard />;
    case 'newTexts':
      return <NewTextsCard texts={item.texts} />;
    case 'myTexts':
      return <MyTextsCard texts={item.texts} total={item.total} />;
    case 'featuredDeck':
      return <FeaturedDeckCard deck={item.deck} level={level} />;
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
    <div data-testid="kesfet-missing">
      <EmptyState
        tone="card"
        compact
        icon={'sync-offline' satisfies IconName}
        title={t('discover.missing.title')}
        description={t('discover.missing.body')}
        action={
          <Button variant="secondary" leadingIcon="refresh" onClick={onRetry}>
            {t('discover.missing.retry')}
          </Button>
        }
      />
    </div>
  );
}
