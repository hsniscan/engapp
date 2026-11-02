// Keşfet › Desteler: suggested decks cut from the word bank on the device: a featured deck for
// the learner's level, "Senin için", the most-used words (100 … 3000), by level, by part of
// speech (with level × part of speech links), false friends. Kinds without data yet (phrasal
// verbs, idioms, topics) are not shown at all (v0.5.1: no "Yakında" tiles).
// v0.5.2 "Çam" (ADR 0067): shared cards, rows and bars only; the CEFR ramp is drawn with the
// stage tokens (deckUi.levelColor).
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { listDecks } from '@/data';
import { parseDeckFilter } from '@/domain/deckFilter';
import { CEFR } from '@/domain/level';
import type { FalseFriendNote } from '@/domain/pairNotes';
import {
  CONTENT_POS,
  type ContentPos,
  deckWordStatus,
  knownShare,
  type OwnedIndex,
  type SuggestedSpec,
  type TopSize,
} from '@/domain/suggestedDecks';
import type { CefrLevel } from '@/domain/types';
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  ChipRow,
  EmptyState,
  Eyebrow,
  Icon,
  IconTile,
  ListGroup,
  ListRow,
  ProgressBar,
  SectionHeader,
  Skeleton,
  Spinner,
  Term,
} from '@/ui';
import { levelColor, nf } from './deckUi';
import { type DeckCard, deckCard, useDeckView } from './deckView';
import { SegBar } from './parts';
import { type BankData, falseFriendLemmas, specHref, specTitle } from './suggested';

const knownPct = (d: DeckCard) => Math.round(knownShare(d.progress) * 100);

/** A progress bar as decoration inside a link (the link's text already says the share). */
function QuietBar({ value }: { value: number }) {
  return (
    <span aria-hidden="true" className="block">
      <ProgressBar value={value} label="" />
    </span>
  );
}

/**
 * Every suggested deck (Keşfet › Desteler). The page owns the word bank download and passes
 * the bank rows in; `data` undefined while they load.
 */
export function DeckCatalog({
  data,
  ffNotes,
  download,
  onRetry,
}: {
  data: BankData | undefined;
  ffNotes: FalseFriendNote[] | null;
  download: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  // Tags of the decks in Destelerim made from a suggestion ("Destende").
  const mineTags = useLiveQuery(async () => {
    const out = new Set<string>();
    for (const d of await listDecks()) {
      const p = parseDeckFilter(d.filter);
      if (p.ok && p.filter.tags?.length === 1) out.add(p.filter.tags[0]!.toLocaleLowerCase('tr'));
    }
    return out;
  }, []);
  const view = useDeckView(data);

  const ff = useMemo(() => {
    if (!data || !ffNotes || ffNotes.length === 0) return null;
    return deckCard(data.entries, data.idx, { kind: 'falseFriends' }, falseFriendLemmas(ffNotes));
  }, [data, ffNotes]);

  if (!data) return <Skeleton lines={6} />;
  if (!view) return <BankMissing download={download} onRetry={onRetry} />;

  const inMine = (spec: SuggestedSpec) =>
    mineTags?.has(specTitle(t, spec).toLocaleLowerCase('tr')) ?? false;
  const level = data.level;

  return (
    <div className="flex flex-col gap-8">
      {view.featured && <Featured deck={view.featured} idx={data.idx} />}

      {view.forYou.length > 0 && (
        <section aria-labelledby="dc-foryou" className="flex flex-col gap-3">
          <SectionHeader
            id="dc-foryou"
            title={t('deckHub.discover.forYou')}
            description={t('deckHub.discover.forYouBody', { level })}
          />
          <ListGroup aria-labelledby="dc-foryou">
            {view.forYou.map((d) => (
              <ListRow
                key={specHref(d.spec)}
                to={specHref(d.spec)}
                leading={<IconTile icon="cards" tone="accent" />}
                title={specTitle(t, d.spec)}
                description={t('deckHub.discover.deckPct', {
                  words: nf.format(d.progress.total),
                  pct: knownPct(d),
                })}
                trailing={
                  <span className="flex shrink-0 items-center gap-2">
                    {d.upLevel ? (
                      <Badge tone="success">{t('deckHub.discover.upLevel')}</Badge>
                    ) : (
                      <Badge tone="neutral">{level}</Badge>
                    )}
                    <Icon name="chevron-right" size={18} className="text-fg-subtle" />
                  </span>
                }
              />
            ))}
          </ListGroup>
        </section>
      )}

      <TopSection decks={view.top} inMine={inMine} />

      <section aria-labelledby="dc-level" className="flex flex-col gap-3">
        <SectionHeader
          id="dc-level"
          title={t('deckHub.discover.byLevel')}
          description={t('deckHub.discover.byLevelSource')}
        />
        <ul className="grid grid-cols-2 gap-3 min-[400px]:grid-cols-3">
          {view.levels.map((d) => {
            const lv = (d.spec as { level: CefrLevel }).level;
            const mine = lv === level;
            return (
              <li key={lv}>
                <Card
                  as={Link}
                  to={specHref(d.spec)}
                  interactive
                  padding="sm"
                  tone={mine ? 'accent' : 'default'}
                  className="flex h-full flex-col gap-2"
                >
                  <span className="sr-only">{specTitle(t, d.spec)}</span>
                  <span aria-hidden="true" className="flex items-center justify-between gap-2">
                    <span className="tabular text-heading font-semibold text-fg">{lv}</span>
                    {mine && <Badge tone="accent">{t('deckHub.discover.yourLevel')}</Badge>}
                  </span>
                  <span className="text-meta text-fg-muted">
                    {t('deckHub.discover.deckPct', {
                      words: nf.format(d.progress.total),
                      pct: knownPct(d),
                    })}
                  </span>
                  <QuietBar value={knownPct(d)} />
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <PosSection
        counts={view.pos}
        levelPos={view.levelPos}
        idx={data.idx}
        ambiguous={view.ambiguous}
      />

      {ff && ffNotes && ff.words.length > 0 && (
        <section aria-labelledby="dc-ff" className="flex flex-col gap-3">
          <SectionHeader
            id="dc-ff"
            title={t('deckHub.discover.falseFriends')}
            description={t('deckHub.discover.pairs', { count: ffNotes.length })}
          />
          <Card as={Link} to={specHref(ff.spec)} interactive className="flex flex-col gap-3">
            <Card
              tone="sunken"
              padding="sm"
              className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <Term className="text-heading font-semibold text-fg">{ffNotes[0]!.term}</Term>
                <span className="text-meta text-fg-muted">{ffNotes[0]!.content.en_meaning_tr}</span>
              </span>
              <span
                role="img"
                aria-label={t('deckHub.discover.notEqual')}
                className="text-title text-danger-text"
              >
                ≠
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 text-right">
                <span lang="tr" className="text-heading font-semibold text-fg">
                  {ffNotes[0]!.content.tr_word}
                </span>
                <span className="text-meta text-fg-muted">{ffNotes[0]!.content.tr_meaning_tr}</span>
              </span>
            </Card>
            <span className="flex items-center gap-3">
              <span className="min-w-0 flex-1 text-ui text-fg-muted">
                {t('deckHub.discover.falseFriendsBody', {
                  examples: [...new Set(ffNotes.slice(1).map((n) => n.term))]
                    .slice(0, 3)
                    .join(', '),
                })}
              </span>
              <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
            </span>
          </Card>
        </section>
      )}
    </div>
  );
}

/** The featured deck for the learner's level: what it is, a few words, how much is known. */
function Featured({ deck, idx }: { deck: DeckCard; idx: OwnedIndex }) {
  const { t } = useTranslation();
  const spec = deck.spec;
  const pos = spec.kind === 'levelPos' ? spec.pos : 'verb';
  const sample = deck.words.filter((w) => deckWordStatus(w, idx) === 'new').slice(0, 5);
  const share = knownPct(deck);
  return (
    <Card tone="accent" as="section" aria-labelledby="dc-featured" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Eyebrow>{t('deckHub.discover.featured')}</Eyebrow>
          <h2 id="dc-featured" className="text-title font-semibold text-fg">
            {specTitle(t, spec)}
          </h2>
          <p className="text-ui text-fg-muted">{t(`deckHub.discover.featuredBody.${pos}`)}</p>
        </div>
        <span className="flex shrink-0 flex-col items-end">
          <span className="tabular text-numeral font-semibold text-fg">
            {nf.format(deck.progress.total)}
          </span>
          <span className="text-caption text-fg-muted">
            {t('deckHub.mine.allUnit')}
          </span>
        </span>
      </div>
      {sample.length > 0 && (
        <Term as="p" italic className="text-fg-muted">
          {sample.map((w) => w.lemma).join(' · ')}
        </Term>
      )}
      <div className="flex flex-col gap-1.5">
        <ProgressBar value={share} label={t('deckHub.discover.featured')} valueText={`%${share}`} />
        <span className="text-meta text-fg-muted">
          {t('deckHub.discover.knownLeft', { pct: share, left: nf.format(deck.progress.fresh) })}
        </span>
      </div>
      <Link
        to={specHref(spec)}
        className={buttonClasses({
          variant: 'primary',
          className: 'w-full sm:w-auto sm:self-start',
        })}
      >
        {t('deckHub.discover.inspect')}
        <Icon name="arrow-right" size={18} />
      </Link>
    </Card>
  );
}

/** The most-used words in steps (100 … 3000): one row each, "Destende" when it is in Destelerim. */
function TopSection({
  decks,
  inMine,
}: {
  decks: DeckCard[];
  inMine: (s: SuggestedSpec) => boolean;
}) {
  const { t } = useTranslation();
  const size = (d: DeckCard) => (d.spec as { size: TopSize }).size;
  return (
    <section aria-labelledby="dc-top" className="flex flex-col gap-3">
      <SectionHeader
        id="dc-top"
        title={t('deckHub.discover.top')}
        description={t('deckHub.discover.topBody')}
      />
      <ListGroup aria-labelledby="dc-top">
        {decks.map((d) => (
          <ListRow
            key={size(d)}
            to={specHref(d.spec)}
            leading={
              <span
                aria-hidden="true"
                className="tabular flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-meta font-semibold text-fg"
              >
                {nf.format(size(d))}
              </span>
            }
            title={specTitle(t, d.spec)}
            description={t('deckHub.discover.knownLeft', {
              pct: knownPct(d),
              left: nf.format(d.progress.fresh),
            })}
            trailing={
              <span className="flex shrink-0 items-center gap-2">
                {inMine(d.spec) && <Badge tone="accent">{t('deckHub.discover.inDeck')}</Badge>}
                <Icon name="chevron-right" size={18} className="text-fg-subtle" />
              </span>
            }
          />
        ))}
      </ListGroup>
    </section>
  );
}

function PosSection({
  counts,
  levelPos,
  idx,
  ambiguous,
}: {
  counts: Record<ContentPos, Record<CefrLevel, number>>;
  levelPos: DeckCard[];
  idx: OwnedIndex;
  /** Words listed under several parts of speech: not used as examples. */
  ambiguous: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  // Two words to show per part of speech: open words at the learner's level.
  const examples = useMemo(() => {
    const out = {} as Record<ContentPos, string[]>;
    for (const d of levelPos) {
      const pos = (d.spec as { pos: ContentPos }).pos;
      const clear = d.words.filter((w) => !ambiguous.has(w.lemma_norm));
      const open = clear.filter((w) => deckWordStatus(w, idx) === 'new');
      out[pos] = (open.length >= 2 ? open : clear).slice(0, 2).map((w) => w.lemma);
    }
    return out;
  }, [levelPos, idx, ambiguous]);
  return (
    <section aria-labelledby="dc-pos" className="flex flex-col gap-3">
      <SectionHeader
        id="dc-pos"
        title={t('deckHub.discover.byPos')}
        description={
          <span className="flex flex-col gap-1.5">
            {t('deckHub.discover.posLegend')}
            <span aria-hidden="true" className="flex flex-wrap gap-x-3 gap-y-1 text-caption">
              {CEFR.map((lv) => (
                <span key={lv} className="flex items-center gap-1">
                  <span className="size-2 rounded-xs" style={{ background: levelColor(lv) }} />
                  {lv}
                </span>
              ))}
            </span>
          </span>
        }
      />
      <ul className="grid grid-cols-2 gap-3">
        {CONTENT_POS.map((pos) => {
          const byLevel = counts[pos];
          const total = CEFR.reduce((n, lv) => n + byLevel[lv], 0);
          const spec: SuggestedSpec = { kind: 'pos', pos };
          return (
            <li key={pos}>
              <Card
                as={Link}
                to={specHref(spec)}
                interactive
                padding="sm"
                className="flex h-full flex-col gap-2"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-ui font-semibold text-fg">{specTitle(t, spec)}</span>
                  <span className="tabular text-meta text-fg-muted">{nf.format(total)}</span>
                </span>
                <Term italic className="truncate text-meta text-fg-muted">
                  {(examples[pos] ?? []).join(', ') || ' '}
                </Term>
                <SegBar
                  label={CEFR.map((lv) => `${lv} ${nf.format(byLevel[lv])}`).join(', ')}
                  parts={CEFR.map((lv) => ({ value: byLevel[lv], color: levelColor(lv) }))}
                  height={6}
                  gap={1}
                  track="transparent"
                />
              </Card>
            </li>
          );
        })}
      </ul>
      {levelPos.length > 0 && (
        <ChipRow label={t('deckHub.discover.byPos')} bleed={false}>
          {levelPos.map((d) => (
            <Link
              key={specHref(d.spec)}
              to={specHref(d.spec)}
              className={buttonClasses({
                variant: 'secondary',
                size: 'sm',
                className: 'shrink-0 snap-start rounded-full',
              })}
            >
              {specTitle(t, d.spec)}
              <span className="tabular font-normal text-fg-muted">
                {nf.format(d.progress.total)}
              </span>
            </Link>
          ))}
        </ChipRow>
      )}
    </section>
  );
}

/** The bank is empty: downloading, offline, failed or no backend. */
export function BankMissing({ download, onRetry }: { download: string; onRetry: () => void }) {
  const { t } = useTranslation();
  if (download === 'running')
    return (
      <Card className="flex items-center gap-3" role="status">
        <Spinner />
        <span className="text-ui text-fg-muted">{t('deckHub.discover.loading')}</span>
      </Card>
    );
  const quiet = download === 'offline' || download === 'no_backend';
  return (
    <EmptyState
      tone={quiet ? 'card' : 'error'}
      icon={quiet ? 'cloud' : 'alert'}
      title={t('wordBank.emptyTitle')}
      description={
        download === 'no_backend'
          ? t('wordBank.emptyNoBackend')
          : download === 'offline'
            ? t('wordBank.emptyOffline')
            : t('wordBank.emptyFailed')
      }
      action={
        download === 'no_backend' ? undefined : (
          <Button variant="secondary" onClick={onRetry}>
            {t('wordBank.retry')}
          </Button>
        )
      }
      className="rounded-card border border-border bg-surface"
    />
  );
}
