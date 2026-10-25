// A suggested deck (board DeckDetail, /decks/suggested/:key): what it is, how much of it the
// learner already has, its level spread, "Destemlere ekle" and the words with their status.
// "Ekle" only adds words the learner neither knows nor has (data/deckHub.addSuggestedDeck);
// the new cards then come a few a day through the normal queue and its smart order.
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { getSettings, logError, markKnown, unmarkKnown } from '@/data';
import { addSuggestedDeck, findTagDeck } from '@/data/deckHub';
import { CEFR } from '@/domain/level';
import {
  deckProgress,
  deckWords,
  deckWordStatus,
  type DeckWordStatus,
  knownShare,
  levelSpread,
  type SuggestedSpec,
} from '@/domain/suggestedDecks';
import type { WordBankEntry } from '@/domain/wordBank';
import { Button, cn, EmptyState, Icon, Skeleton, Surface, toast } from '@/ui';
import { posLabel } from '@/features/cards/labels';
import { BankMissing } from './DiscoverTab';
import { LEVEL_MARK, MARK, nf } from './deckUi';
import {
  BackBar,
  FilterChip,
  LegendRow,
  LevelPill,
  Ring,
  SegBar,
  StatusPill,
  type PillTone,
} from './parts';
import {
  falseFriendLemmas,
  parseSuggestedKey,
  specBody,
  specTitle,
  useBankData,
  useFalseFriends,
  useWordBankDownload,
} from './suggested';

const PAGE = 50;

type Filter = 'all' | 'new' | 'carded' | 'known';

const STATUS_PILL: Record<DeckWordStatus, { tone: PillTone; key: 'sLearned' | 'sStudying' | 'sKnown' | 'sNew' }> = {
  learned: { tone: 'success', key: 'sLearned' },
  studying: { tone: 'accent', key: 'sStudying' },
  known: { tone: 'success', key: 'sKnown' },
  new: { tone: 'outline', key: 'sNew' },
};

export function SuggestedDeckPage() {
  const { t } = useTranslation();
  const { key = '' } = useParams();
  const spec = parseSuggestedKey(key);
  return (
    <div className="pb-10">
      <BackBar to="/decks?tab=discover" parent={t('deckHub.suggested.parent')} />
      {spec ? (
        <SuggestedBody key={key} spec={spec} />
      ) : (
        <div className="mx-auto max-w-2xl px-4 pt-6">
          <Surface>
            <EmptyState
              icon="search"
              title={t('deckHub.suggested.notFound')}
              description={t('deckHub.suggested.notFoundBody')}
              action={
                <Link to="/decks?tab=discover" className="font-medium text-accent-text hover:underline">
                  {t('deckHub.suggested.toDiscover')}
                </Link>
              }
            />
          </Surface>
        </div>
      )}
    </div>
  );
}

function SuggestedBody({ spec }: { spec: SuggestedSpec }) {
  const { t } = useTranslation();
  const { download, retry } = useWordBankDownload();
  const data = useBankData();
  const ffNotes = useFalseFriends();
  const title = specTitle(t, spec);
  const perDay = useLiveQuery(async () => (await getSettings()).daily_new_limit, []);
  const myDeck = useLiveQuery(() => findTagDeck(title), [title]);

  const words = useMemo(
    () =>
      data
        ? deckWords(data.entries, spec, {
            falseFriends: spec.kind === 'falseFriends' ? falseFriendLemmas(ffNotes) : undefined,
          })
        : [],
    [data, spec, ffNotes],
  );
  const progress = useMemo(
    () => (data ? deckProgress(words, data.idx) : null),
    [data, words],
  );

  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const [scan, setScan] = useState(false);
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);

  if (!data || !progress || (spec.kind === 'falseFriends' && ffNotes === null))
    return (
      <div className="mx-auto max-w-2xl px-4 pt-4">
        <Skeleton lines={6} />
      </div>
    );
  if (data.entries.length === 0)
    return (
      <div className="mx-auto max-w-2xl px-4 pt-4">
        <BankMissing download={download} onRetry={retry} />
      </div>
    );

  const statusOf = (w: WordBankEntry) => deckWordStatus(w, data.idx);
  const visibleAll = words.filter((w) => {
    const s = statusOf(w);
    const f: Filter = scan ? 'new' : filter;
    return f === 'all' || (f === 'new' ? s === 'new' : f === 'known' ? s === 'known' : s === 'learned' || s === 'studying');
  });
  const visible = visibleAll.slice(0, shown);
  const carded = progress.learned + progress.studying;
  const share = knownShare(progress);
  const spread = levelSpread(words);
  const days = perDay ? Math.ceil(progress.fresh / perDay) : null;

  const add = async () => {
    if (adding) return;
    setAdding({ done: 0, total: progress.fresh });
    try {
      const r = await addSuggestedDeck(words, title, {
        onProgress: (done, total) => setAdding({ done, total }),
      });
      if (r.added === 0) toast({ title: t('deckHub.suggested.addedNothing'), tone: 'warn' });
      else
        toast({
          title: t('deckHub.suggested.added', { name: title }),
          description: t('deckHub.suggested.addedBody', { words: nf.format(r.added), cards: nf.format(r.cards) }),
          tone: 'success',
        });
    } catch (e) {
      void logError(e, 'SuggestedDeck.add');
      toast({ title: t('deckHub.suggested.addFailed'), tone: 'danger' });
    } finally {
      setAdding(null);
    }
  };

  const know = async (w: WordBankEntry) => {
    try {
      await markKnown(w.lemma, 'manual');
      toast({
        title: t('deckHub.suggested.markedKnown', { term: w.lemma }),
        tone: 'success',
        action: { label: t('deckHub.suggested.undo'), onClick: () => void unmarkKnown(w.lemma) },
      });
    } catch (e) {
      void logError(e, 'SuggestedDeck.known');
      toast({ title: t('deckHub.suggested.addFailed'), tone: 'danger' });
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-2">
      <div className="flex flex-col gap-2 px-1">
        <span className="self-start rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-text">
          {t(`deckHub.kind.${spec.kind}`)}
        </span>
        <h1 className="font-serif text-[30px] leading-[1.12] font-semibold text-fg">{title}</h1>
        <p className="text-[15px] leading-relaxed text-fg-muted">{specBody(t, spec)}</p>
      </div>

      <section
        aria-label={t('deckHub.suggested.status')}
        className="flex items-center gap-5 rounded-[20px] border border-border bg-surface p-[18px]"
      >
        <Ring
          total={progress.total}
          segments={[
            { value: progress.learned + progress.known, color: MARK.learned },
            { value: progress.studying, color: MARK.studying },
          ]}
          center={t('deckHub.suggested.knownPct', { pct: Math.round(share * 100) })}
          caption={t('deckHub.suggested.knownLabel')}
        />
        <ul className="flex flex-1 flex-col gap-2.5">
          <LegendRow color={MARK.learned} value={progress.learned} label={t('deckHub.suggested.learned')} />
          {progress.known > 0 && (
            <LegendRow color={MARK.learned} value={progress.known} label={t('deckHub.suggested.known')} />
          )}
          <LegendRow color={MARK.studying} value={progress.studying} label={t('deckHub.suggested.studying')} />
          <LegendRow color={MARK.faint} value={progress.fresh} label={t('deckHub.suggested.fresh')} />
        </ul>
      </section>

      {spec.kind !== 'level' && spec.kind !== 'levelPos' && progress.total > 0 && (
        <section
          aria-labelledby="sd-levels"
          className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface px-[18px] py-4"
        >
          <h2 id="sd-levels" className="font-serif text-[17px] font-semibold text-fg">
            {t('deckHub.suggested.levels')}
          </h2>
          <SegBar
            height={14}
            track="transparent"
            label={CEFR.filter((l) => spread[l] > 0)
              .map((l) => `${l} ${nf.format(spread[l])}`)
              .join(', ')}
            parts={CEFR.map((l) => ({ value: spread[l], color: LEVEL_MARK[l] }))}
          />
          <div aria-hidden="true" className="flex justify-between text-[13px] text-fg-muted">
            {CEFR.filter((l) => spread[l] > 0).map((l) => (
              <span key={l}>
                <strong className="font-semibold text-fg">{l}</strong> {nf.format(spread[l])}
              </span>
            ))}
          </div>
        </section>
      )}

      <section aria-label={t('deckHub.suggested.addSection')} className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2.5 rounded-[18px] border border-border bg-surface py-3 pr-3 pl-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold text-fg">
              {t('deckHub.suggested.pace', { perDay: perDay ?? '…' })}
            </span>
            <span className="text-[13px] text-fg-muted">
              {progress.fresh > 0 && days
                ? t('deckHub.suggested.paceBody', { count: progress.fresh, days })
                : t('deckHub.suggested.paceNone')}
            </span>
          </div>
          <Link
            to="/settings/calisma"
            className="inline-flex min-h-11 shrink-0 items-center rounded-control px-2 text-sm font-semibold text-accent-text hover:underline"
          >
            {t('deckHub.suggested.paceChange')}
          </Link>
        </div>
        {progress.fresh > 0 ? (
          <Button
            size="lg"
            fullWidth
            leadingIcon={adding ? undefined : 'plus'}
            loading={adding !== null}
            onClick={() => void add()}
            className="rounded-[14px] text-[17px] font-semibold"
          >
            {adding
              ? t('deckHub.suggested.adding', { done: adding.done, total: adding.total })
              : myDeck
                ? t('deckHub.suggested.addMore', { count: progress.fresh })
                : t('deckHub.suggested.add')}
          </Button>
        ) : null}
        {myDeck && (
          <Link
            to={`/decks/${encodeURIComponent(myDeck.id)}`}
            className="flex h-[52px] items-center justify-center gap-2 rounded-[14px] border border-border bg-surface text-[15px] text-fg hover:border-border-strong"
          >
            <Icon name="check" size={19} className="text-accent-text" />
            <span>
              <strong className="font-semibold">{t('deckHub.suggested.inMine')}</strong>{' '}
              <span className="text-fg-muted">· {t('deckHub.suggested.openMine')}</span>
            </span>
          </Link>
        )}
        {progress.fresh > 0 && (
          <button
            type="button"
            aria-pressed={scan}
            onClick={() => {
              setScan((s) => !s);
              setShown(PAGE);
            }}
            className={cn(
              'flex h-[52px] items-center justify-center gap-2 rounded-[14px] border text-[15px] text-fg',
              scan ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:border-border-strong',
            )}
          >
            <Icon name="check" size={19} className="text-accent-text" />
            {scan ? (
              <strong className="font-semibold">{t('deckHub.suggested.scanDone')}</strong>
            ) : (
              <span>
                <strong className="font-semibold">{t('deckHub.suggested.scan')}</strong>{' '}
                <span className="text-fg-muted">· {t('deckHub.suggested.scanHint')}</span>
              </span>
            )}
          </button>
        )}
        <span className="text-center text-[13px] text-fg-muted">
          {scan
            ? t('deckHub.suggested.scanBody')
            : t('deckHub.suggested.skipNote', { known: nf.format(progress.known), carded: nf.format(carded) })}
        </span>
      </section>

      <section aria-labelledby="sd-words" className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between px-1 pt-1">
          <h2 id="sd-words" className="font-serif text-[19px] font-semibold text-fg">
            {t('deckHub.suggested.words')}
          </h2>
          <span className="text-[13px] text-fg-muted">{t('deckHub.suggested.order')}</span>
        </div>
        {!scan && (
          <div role="group" aria-label={t('deckHub.suggested.filter')} className="-mr-4 flex gap-2 overflow-x-auto pr-4 [scrollbar-width:none]">
            {(
              [
                ['all', t('deckHub.suggested.fAll', { count: progress.total })],
                ['new', t('deckHub.suggested.fNew', { count: progress.fresh })],
                ['carded', t('deckHub.suggested.fCarded', { count: carded })],
                ...(progress.known > 0
                  ? ([['known', t('deckHub.suggested.fKnown', { count: progress.known })]] as const)
                  : []),
              ] as [Filter, string][]
            ).map(([f, label]) => (
              <FilterChip
                key={f}
                pressed={filter === f}
                onClick={() => {
                  setFilter(f);
                  setShown(PAGE);
                }}
              >
                {label}
              </FilterChip>
            ))}
          </div>
        )}
        {visible.length === 0 ? (
          <p className="rounded-[20px] border border-border bg-surface p-4 text-[15px] text-fg-muted">
            {t('deckHub.suggested.empty')}
          </p>
        ) : (
          <ul
            aria-label={t('deckHub.suggested.words')}
            className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-surface"
          >
            {visible.map((w) => {
              const s = statusOf(w);
              const pill = STATUS_PILL[s];
              return (
                <li
                  key={w.id}
                  data-testid="suggested-word"
                  className="flex min-h-[58px] items-center gap-2.5 border-b border-surface-sunken px-4 py-2.5 last:border-b-0"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2">
                      <span lang="en" className="truncate font-serif text-lg font-semibold text-fg">
                        {w.lemma}
                      </span>
                      <span className="text-xs text-fg-muted">{posLabel(t, w.pos)}</span>
                    </span>
                    <span className="truncate text-sm text-fg-muted">
                      {w.senses.map((x) => x.meaning_tr).join(', ')}
                    </span>
                  </span>
                  <LevelPill level={w.cefr} />
                  {scan && s === 'new' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={t('deckHub.suggested.markKnownLabel', { term: w.lemma })}
                      onClick={() => void know(w)}
                      className="w-[5.75rem]"
                    >
                      {t('deckHub.suggested.markKnown')}
                    </Button>
                  ) : (
                    <StatusPill tone={pill.tone}>{t(`deckHub.suggested.${pill.key}`)}</StatusPill>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {visibleAll.length > shown && (
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE * 4)}
            className="flex h-12 items-center justify-center text-[15px] font-semibold text-accent-text hover:underline"
          >
            {t('deckHub.suggested.more', { count: Math.min(PAGE * 4, visibleAll.length - shown) })}
          </button>
        )}
      </section>
    </div>
  );
}
