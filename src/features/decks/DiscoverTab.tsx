// Desteler › Keşfet (board DecksDiscover): suggested decks cut from the word bank on the device:
// a featured deck for the learner's level, "Senin için", the most-used words (100 … 3000), by
// level, by part of speech (with level × part of speech chips), false friends; phrasal verbs,
// idioms and topic decks have no data yet and are marked "Yakında".
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { listDecks } from '@/data';
import { parseDeckFilter } from '@/domain/deckFilter';
import { CEFR, levelRank } from '@/domain/level';
import {
  CONTENT_POS,
  type ContentPos,
  deckProgress,
  deckWords,
  type DeckProgress,
  deckWordStatus,
  DONE_SHARE,
  featuredSpec,
  forYouSpecs,
  knownShare,
  type OwnedIndex,
  posLevelCounts,
  type SuggestedSpec,
  TOP_SIZES,
  type TopSize,
} from '@/domain/suggestedDecks';
import { TOPIC_KEYS, type TopicKey } from '@/domain/topics';
import type { CefrLevel } from '@/domain/types';
import type { WordBankEntry } from '@/domain/wordBank';
import { Button, cn, EmptyState, Icon, Skeleton, Spinner, Surface } from '@/ui';
import { useTopicProfile } from '@/features/profile/useTopicProfile';
import { LEVEL_MARK, MARK, nf, pct } from './deckUi';
import { LevelPill, ProgressBar2, SegBar } from './parts';
import {
  falseFriendLemmas,
  specHref,
  specTitle,
  useBankData,
  useFalseFriends,
  useWordBankDownload,
} from './suggested';

interface DeckCard {
  spec: SuggestedSpec;
  words: WordBankEntry[];
  progress: DeckProgress;
}

const card = (
  entries: readonly WordBankEntry[],
  idx: OwnedIndex,
  spec: SuggestedSpec,
  ff?: ReadonlySet<string>,
): DeckCard => {
  const words = deckWords(entries, spec, { falseFriends: ff });
  return { spec, words, progress: deckProgress(words, idx) };
};

/** Bar heights of the frequency steps (px), as on the board. */
const TOP_HEIGHT: Record<TopSize, number> = { 100: 28, 500: 52, 1000: 72, 2000: 94, 3000: 116 };

export function DiscoverTab() {
  const { t } = useTranslation();
  const { download, retry } = useWordBankDownload();
  const data = useBankData();
  const ffNotes = useFalseFriends();
  const profile = useTopicProfile();
  // Tags of the decks in Destelerim made from a suggestion ("Destende").
  const mineTags = useLiveQuery(async () => {
    const out = new Set<string>();
    for (const d of await listDecks()) {
      const p = parseDeckFilter(d.filter);
      if (p.ok && p.filter.tags?.length === 1) out.add(p.filter.tags[0]!.toLocaleLowerCase('tr'));
    }
    return out;
  }, []);

  const view = useMemo(() => {
    if (!data || data.entries.length === 0) return null;
    const { entries, idx, level } = data;
    const featured = featuredSpec(entries, idx, level);
    return {
      featured: featured ? card(entries, idx, featured) : null,
      forYou: forYouSpecs(entries, idx, level, featured).map((x) => ({
        ...card(entries, idx, x.spec),
        upLevel: x.upLevel,
      })),
      top: TOP_SIZES.map((size) => card(entries, idx, { kind: 'top', size })),
      levels: CEFR.map((lv) => card(entries, idx, { kind: 'level', level: lv })),
      pos: posLevelCounts(entries),
      levelPos: CONTENT_POS.map((pos) => card(entries, idx, { kind: 'levelPos', level, pos })),
    };
  }, [data]);

  const ff = useMemo(() => {
    if (!data || !ffNotes || ffNotes.length === 0) return null;
    return card(data.entries, data.idx, { kind: 'falseFriends' }, falseFriendLemmas(ffNotes));
  }, [data, ffNotes]);

  if (!data) return <Skeleton lines={6} />;
  if (!view) return <BankMissing download={download} onRetry={retry} />;

  const inMine = (spec: SuggestedSpec) => mineTags?.has(specTitle(t, spec).toLocaleLowerCase('tr')) ?? false;
  const level = data.level;
  const interests = profile?.ranked.length ? profile.ranked : (profile?.interests ?? []);

  return (
    <div className="flex flex-col gap-[22px]">
      {view.featured && <Featured deck={view.featured} idx={data.idx} />}

      <section aria-labelledby="dc-foryou" className="flex flex-col gap-2.5">
        <SectionHead id="dc-foryou" title={t('deckHub.discover.forYou')} sub={t('deckHub.discover.forYouBody', { level })} />
        <ul className="-mr-4 flex snap-x gap-3 overflow-x-auto pr-4 pb-1 [scrollbar-width:none]">
          {view.forYou.map((d) => (
            <li key={specHref(d.spec)} className="w-[168px] shrink-0 snap-start">
              <Link
                to={specHref(d.spec)}
                className="flex h-full flex-col gap-2 rounded-[18px] border border-border bg-surface p-3.5 text-fg hover:border-border-strong"
              >
                {d.upLevel ? (
                  <span className="self-start rounded-[5px] bg-success-soft px-1.5 py-0.5 text-xs font-semibold text-success-text">
                    {t('deckHub.discover.upLevel')}
                  </span>
                ) : (
                  <LevelPill level={level} className="self-start" />
                )}
                <span className="font-serif text-lg leading-tight font-semibold">{specTitle(t, d.spec)}</span>
                <ProgressBar2
                  total={d.progress.total}
                  first={d.progress.learned + d.progress.known}
                  second={0}
                  height={6}
                  label={t('deckHub.discover.knownLeft', {
                    pct: pct(d.progress.learned + d.progress.known, d.progress.total),
                    left: nf.format(d.progress.fresh),
                  })}
                />
                <span className="text-[13px] text-fg-muted">
                  {t('deckHub.discover.deckPct', {
                    words: nf.format(d.progress.total),
                    pct: Math.round(knownShare(d.progress) * 100),
                  })}
                </span>
              </Link>
            </li>
          ))}
          {interests.slice(0, 1).map((topic) => (
            <li
              key={topic}
              className="flex w-[168px] shrink-0 snap-start flex-col gap-2 rounded-[18px] border-[1.5px] border-dashed border-border-strong/45 bg-surface p-3.5"
            >
              <span className="self-start rounded-[5px] bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn-text">
                {t('deckHub.discover.interest')}
              </span>
              <span className="font-serif text-lg leading-tight font-semibold text-fg">{t(`topics.${topic}`)}</span>
              <span className="text-[13px] leading-snug text-fg-muted">{t('deckHub.discover.aiSoon')}</span>
            </li>
          ))}
        </ul>
      </section>

      <TopSection decks={view.top} inMine={inMine} />

      <section aria-labelledby="dc-level" className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between px-1">
          <h2 id="dc-level" className="font-serif text-[19px] font-semibold text-fg">
            {t('deckHub.discover.byLevel')}
          </h2>
          <span className="text-[13px] text-fg-muted">{t('deckHub.discover.byLevelSource')}</span>
        </div>
        <ul className="grid grid-cols-3 gap-2.5">
          {view.levels.map((d) => {
            const lv = (d.spec as { level: CefrLevel }).level;
            const mine = lv === level;
            const share = knownShare(d.progress);
            return (
              <li key={lv}>
                <Link
                  to={specHref(d.spec)}
                  aria-label={`${specTitle(t, d.spec)}, ${t('deckHub.words', { count: d.progress.total, formatted: nf.format(d.progress.total) })}, %${Math.round(share * 100)}`}
                  className={cn(
                    'flex flex-col gap-1.5 rounded-2xl p-3 text-fg',
                    mine
                      ? 'border-[1.5px] border-accent bg-accent-soft'
                      : 'border border-border bg-surface hover:border-border-strong',
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="font-serif text-2xl leading-none font-semibold">{lv}</span>
                    {mine && (
                      <span className="text-[11px] font-semibold text-accent-text">{t('deckHub.discover.yourLevel')}</span>
                    )}
                  </span>
                  <span className="text-[13px] text-fg-muted">
                    {t('deckHub.words', { count: d.progress.total, formatted: nf.format(d.progress.total) })}
                  </span>
                  <span aria-hidden="true" className="h-1 overflow-hidden rounded-full" style={{ background: mine ? MARK.trackOnSoft : MARK.track }}>
                    <span
                      className="block h-1"
                      style={{
                        width: `${share * 100}%`,
                        background: levelRank(lv) <= levelRank(level) ? MARK.learned : share > 0.2 ? MARK.studying : MARK.faint,
                      }}
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <PosSection counts={view.pos} levelPos={view.levelPos} idx={data.idx} />

      {ff && ffNotes && ff.words.length > 0 && (
        <section aria-labelledby="dc-ff">
          <Link
            to={specHref(ff.spec)}
            className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface-raised p-[18px] text-fg hover:border-border-strong"
          >
            <span className="flex items-baseline justify-between">
              <h2 id="dc-ff" className="font-serif text-[19px] font-semibold">
                {t('deckHub.discover.falseFriends')}
              </h2>
              <span className="text-[13px] text-fg-muted">{t('deckHub.discover.pairs', { count: ffNotes.length })}</span>
            </span>
            <span className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 rounded-[14px] bg-canvas p-3.5">
              <span className="flex flex-col gap-0.5">
                <span lang="en" className="font-serif text-[22px] font-semibold">
                  {ffNotes[0]!.term}
                </span>
                <span className="text-[13px] text-fg-muted">{ffNotes[0]!.content.en_meaning_tr}</span>
              </span>
              <span aria-label={t('deckHub.discover.notEqual')} className="font-serif text-2xl text-danger-text">
                ≠
              </span>
              <span className="flex flex-col gap-0.5 text-right">
                <span lang="tr" className="font-serif text-[22px] italic">
                  {ffNotes[0]!.content.tr_word}
                </span>
                <span className="text-[13px] text-fg-muted">{ffNotes[0]!.content.tr_meaning_tr}</span>
              </span>
            </span>
            <span className="text-sm text-fg-muted">
              {t('deckHub.discover.falseFriendsBody', {
                examples: [...new Set(ffNotes.slice(1).map((n) => n.term))].slice(0, 3).join(', '),
              })}
            </span>
          </Link>
        </section>
      )}

      <section aria-labelledby="dc-patterns" className="flex flex-col gap-2.5">
        <SoonHead id="dc-patterns" title={t('deckHub.discover.patterns')} />
        <ul className="grid grid-cols-2 gap-2.5">
          <SoonCard title={t('deckHub.discover.phrasal')} example={t('deckHub.discover.phrasalExample')} />
          <SoonCard title={t('deckHub.discover.idioms')} example={t('deckHub.discover.idiomsExample')} />
        </ul>
      </section>

      <section aria-labelledby="dc-topics" className="flex flex-col gap-2.5">
        <SoonHead id="dc-topics" title={t('deckHub.discover.topics')} />
        <ul className="grid grid-cols-3 gap-2">
          {topicOrder(interests).map((k) => (
            <li
              key={k}
              className="flex flex-col gap-1.5 rounded-[14px] border border-border bg-surface px-3 py-2.5"
            >
              <TopicGlyph topic={k} />
              <span className="text-sm leading-tight font-semibold text-fg">{t(`topics.${k}`)}</span>
            </li>
          ))}
        </ul>
        <Link
          to="/settings/profile"
          className="flex h-11 items-center justify-center rounded-xl border border-border bg-surface text-sm font-semibold text-accent-text hover:border-border-strong"
        >
          {t('deckHub.discover.topicsInterests')}
        </Link>
      </section>
    </div>
  );
}

function SectionHead({ id, title, sub }: { id: string; title: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <h2 id={id} className="font-serif text-[19px] font-semibold text-fg">
        {title}
      </h2>
      {sub && <span className="text-[13px] text-fg-muted">{sub}</span>}
    </div>
  );
}

function SoonHead({ id, title }: { id: string; title: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-baseline justify-between px-1">
      <h2 id={id} className="font-serif text-[19px] font-semibold text-fg">
        {title}
      </h2>
      <span className="text-[13px] font-semibold text-warn-text">{t('deckHub.discover.soon')}</span>
    </div>
  );
}

function SoonCard({ title, example }: { title: string; example: string }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-1.5 rounded-[18px] border-[1.5px] border-dashed border-border-strong/45 p-3.5">
      <span lang="en" className="font-serif text-lg font-semibold text-fg">
        {title}
      </span>
      <span lang="en" className="font-serif text-sm text-fg-muted italic">
        {example}
      </span>
      <span className="text-xs text-warn-text">{t('deckHub.discover.aiPreparing')}</span>
    </li>
  );
}

function Featured({ deck, idx }: { deck: DeckCard; idx: OwnedIndex }) {
  const { t } = useTranslation();
  const spec = deck.spec;
  const pos = spec.kind === 'levelPos' ? spec.pos : 'verb';
  const sample = deck.words.filter((w) => deckWordStatus(w, idx) === 'new').slice(0, 5);
  const share = knownShare(deck.progress);
  return (
    <section
      aria-labelledby="dc-featured"
      className="flex flex-col gap-3.5 rounded-[20px] bg-accent p-5 text-accent-fg"
    >
      <span className="text-[13px] tracking-[0.04em] uppercase">{t('deckHub.discover.featured')}</span>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h2 id="dc-featured" className="font-serif text-[30px] leading-[1.05] font-semibold">
            {specTitle(t, spec)}
          </h2>
          <span className="text-sm leading-snug">{t(`deckHub.discover.featuredBody.${pos}`)}</span>
        </div>
        <span className="tabular font-serif text-[40px] leading-none font-semibold">{nf.format(deck.progress.total)}</span>
      </div>
      {sample.length > 0 && (
        <p lang="en" className="font-serif text-[17px] italic">
          {sample.map((w) => w.lemma).join(' · ')}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-white/20">
          <div className="h-1.5" style={{ width: `${share * 100}%`, background: 'light-dark(#9dbde3, #dbe6f3)' }} />
        </div>
        <span className="text-[13px]">
          {t('deckHub.discover.knownLeft', {
            pct: Math.round(share * 100),
            left: nf.format(deck.progress.fresh),
          })}
        </span>
      </div>
      <Link
        to={specHref(spec)}
        className="flex h-12 items-center justify-center gap-2 rounded-[14px] bg-surface text-base font-semibold hover:bg-surface-raised"
        style={{ color: 'light-dark(#1f3f63, #9dbde3)' }}
      >
        {t('deckHub.discover.inspect')}
        <Icon name="arrow-right" size={18} />
      </Link>
    </section>
  );
}

function TopSection({ decks, inMine }: { decks: DeckCard[]; inMine: (s: SuggestedSpec) => boolean }) {
  const { t } = useTranslation();
  const focus = decks.find((d) => knownShare(d.progress) < DONE_SHARE) ?? decks[decks.length - 1]!;
  const size = (d: DeckCard) => (d.spec as { size: TopSize }).size;
  return (
    <section
      aria-labelledby="dc-top"
      className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-surface p-[18px]"
    >
      <SectionHead id="dc-top" title={t('deckHub.discover.top')} sub={t('deckHub.discover.topBody')} />
      <ul className="grid h-[150px] grid-cols-5 items-end gap-2">
        {decks.map((d) => {
          const share = knownShare(d.progress);
          const mine = inMine(d.spec);
          const p = Math.round(share * 100);
          return (
            <li key={size(d)} className="h-full">
              <Link
                to={specHref(d.spec)}
                aria-label={
                  mine
                    ? t('deckHub.discover.topBarMine', { size: size(d), pct: p })
                    : t('deckHub.discover.topBar', { size: size(d), pct: p })
                }
                className="flex h-full flex-col justify-end gap-1.5 text-fg"
              >
                {mine && (
                  <span className="text-center text-[11px] font-semibold text-accent-text">{t('deckHub.discover.inDeck')}</span>
                )}
                <span
                  className={cn(
                    'flex flex-col justify-end overflow-hidden rounded-t-lg rounded-b',
                    mine && 'outline-2 outline-offset-2 outline-accent',
                  )}
                  style={{ height: TOP_HEIGHT[size(d)], background: MARK.track }}
                >
                  <span style={{ height: `${share * 100}%`, background: share >= 0.5 ? MARK.learned : MARK.studying }} />
                </span>
                <span className="tabular text-center font-serif text-lg font-semibold">{size(d)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-2.5 border-t border-surface-sunken pt-3">
        <span className="text-sm text-fg">
          <strong className="font-semibold">{t('deckHub.discover.topSummary', { size: size(focus) })}</strong>{' '}
          {t('deckHub.discover.topSummaryKnown', {
            known: nf.format(focus.progress.learned + focus.progress.known),
          })}
        </span>
        <Link
          to={specHref(focus.spec)}
          className="flex min-h-11 items-center text-sm font-semibold text-accent-text hover:underline"
        >
          {t('deckHub.discover.open')}
        </Link>
      </div>
      <span className="-mt-2 text-xs text-fg-muted">{t('deckHub.discover.topLegend')}</span>
    </section>
  );
}

function PosSection({
  counts,
  levelPos,
  idx,
}: {
  counts: Record<ContentPos, Record<CefrLevel, number>>;
  levelPos: DeckCard[];
  idx: OwnedIndex;
}) {
  const { t } = useTranslation();
  // Two words to show per part of speech: open words at the learner's level.
  const examples = useMemo(() => {
    const out = {} as Record<ContentPos, string[]>;
    for (const d of levelPos) {
      const pos = (d.spec as { pos: ContentPos }).pos;
      const open = d.words.filter((w) => deckWordStatus(w, idx) === 'new');
      out[pos] = (open.length >= 2 ? open : d.words).slice(0, 2).map((w) => w.lemma);
    }
    return out;
  }, [levelPos, idx]);
  return (
    <section aria-labelledby="dc-pos" className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1.5 px-1">
        <h2 id="dc-pos" className="font-serif text-[19px] font-semibold text-fg">
          {t('deckHub.discover.byPos')}
        </h2>
        <ul aria-label={t('deckHub.discover.posLegend')} className="flex flex-wrap gap-2.5 text-xs text-fg-muted">
          {CEFR.map((lv) => (
            <li key={lv} className="flex items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: LEVEL_MARK[lv] }} />
              {lv}
            </li>
          ))}
        </ul>
      </div>
      <ul className="grid grid-cols-2 gap-2.5">
        {CONTENT_POS.map((pos) => {
          const byLevel = counts[pos];
          const total = CEFR.reduce((n, lv) => n + byLevel[lv], 0);
          const spec: SuggestedSpec = { kind: 'pos', pos };
          return (
            <li key={pos}>
              <Link
                to={specHref(spec)}
                className="flex flex-col gap-2 rounded-[18px] border border-border bg-surface p-3.5 text-fg hover:border-border-strong"
              >
                <span className="flex items-baseline justify-between">
                  <span className="font-serif text-lg font-semibold">{specTitle(t, spec)}</span>
                  <span className="tabular text-[13px] text-fg-muted">{nf.format(total)}</span>
                </span>
                <span lang="en" className="truncate font-serif text-sm text-fg-muted italic">
                  {(examples[pos] ?? []).join(', ') || ' '}
                </span>
                <SegBar
                  label={CEFR.map((lv) => `${lv} ${nf.format(byLevel[lv])}`).join(', ')}
                  parts={CEFR.map((lv) => ({ value: byLevel[lv], color: LEVEL_MARK[lv] }))}
                  gap={1}
                  track="transparent"
                />
              </Link>
            </li>
          );
        })}
      </ul>
      <ul className="-mr-4 flex gap-2 overflow-x-auto pr-4 pb-1 [scrollbar-width:none]">
        {levelPos.map((d) => (
          <li key={specHref(d.spec)} className="shrink-0">
            <Link
              to={specHref(d.spec)}
              className="flex h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-sm text-fg hover:border-border-strong"
            >
              <span className="font-semibold">{specTitle(t, d.spec)}</span>
              <span className="tabular text-fg-muted">{nf.format(d.progress.total)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const DEFAULT_TOPICS: TopicKey[] = ['travel', 'business', 'health', 'technology', 'food', 'sports'];

function topicOrder(interests: readonly TopicKey[]): TopicKey[] {
  const out: TopicKey[] = [];
  for (const k of [...interests, ...DEFAULT_TOPICS, ...TOPIC_KEYS]) if (!out.includes(k)) out.push(k);
  return out.slice(0, 6);
}

const TOPIC_PATHS: Partial<Record<TopicKey, ReactNode>> = {
  travel: <path d="M3 14l18-7-6 15-3-6z" />,
  business: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5h6v2" />
    </>
  ),
  health: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />,
  technology: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </>
  ),
  food: <path d="M6 3v8a2 2 0 0 0 4 0V3M8 11v10M17 21V3c-2 1-3 4-3 8h3" />,
  sports: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4.5 9.5c3 1 5.5 3.5 6.5 10M19.5 9.5c-3 1-5.5 3.5-6.5 10" />
    </>
  ),
};

function TopicGlyph({ topic }: { topic: TopicKey }) {
  const path = TOPIC_PATHS[topic];
  if (!path) return <Icon name="layers" size={20} className="text-fg-subtle" />;
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-fg-subtle"
    >
      {path}
    </svg>
  );
}

/** The bank is empty: downloading, offline, failed or no backend. */
export function BankMissing({ download, onRetry }: { download: string; onRetry: () => void }) {
  const { t } = useTranslation();
  if (download === 'running')
    return (
      <Surface className="flex items-center gap-3" role="status">
        <Spinner />
        <span className="text-[0.9375rem] text-fg-muted">{t('deckHub.discover.loading')}</span>
      </Surface>
    );
  return (
    <Surface>
      <EmptyState
        icon="layers"
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
      />
    </Surface>
  );
}
