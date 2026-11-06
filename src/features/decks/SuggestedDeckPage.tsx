// A suggested deck (/decks/suggested/:key, docs/design.md §4.9): what it is, how much of it the
// learner already has, its level spread, "Kelimelerime ekle" and the words with their status.
// "Ekle" only adds words the learner neither knows nor has (data/deckHub.addSuggestedDeck);
// the new cards then come a few a day through the normal queue and its smart order.
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { getSettings, logError, markKnown, unmarkKnown } from '@/data';
import { findTagDeck } from '@/data/deckHub';
import { runDeckAdd, useDeckAddProgress } from './deckAddRunner';
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
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  Eyebrow,
  ListGroup,
  ListRow,
  PageFrame,
  SectionHeader,
  Skeleton,
  StatTile,
  buttonClasses,
  toast,
  type BadgeTone,
} from '@/ui';
import { posLabel } from '@/features/cards/labels';
import { BankMissing } from './DeckCatalog';
import { DISCOVER_DECKS_HREF, levelColor, nf } from './deckUi';
import { SegBar } from './parts';
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

const STATUS: Record<
  DeckWordStatus,
  { tone: BadgeTone; key: 'sLearned' | 'sStudying' | 'sKnown' | 'sNew' }
> = {
  learned: { tone: 'success', key: 'sLearned' },
  studying: { tone: 'accent', key: 'sStudying' },
  known: { tone: 'success', key: 'sKnown' },
  new: { tone: 'outline', key: 'sNew' },
};

export function SuggestedDeckPage() {
  const { t } = useTranslation();
  const { key = '' } = useParams();
  const spec = parseSuggestedKey(key);
  const back = { to: DISCOVER_DECKS_HREF, label: t('deckHub.suggested.parent') };
  if (!spec)
    return (
      <PageFrame back={back} title={t('deckHub.suggested.notFound')} hideTitle>
        <EmptyState
          tone="card"
          icon="search"
          title={t('deckHub.suggested.notFound')}
          description={t('deckHub.suggested.notFoundBody')}
          action={
            <Link to={DISCOVER_DECKS_HREF} className={buttonClasses({ variant: 'secondary' })}>
              {t('deckHub.suggested.toDiscover')}
            </Link>
          }
        />
      </PageFrame>
    );
  return <SuggestedBody key={key} spec={spec} back={back} />;
}

function SuggestedBody({
  spec,
  back,
}: {
  spec: SuggestedSpec;
  back: { to: string; label: string };
}) {
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
  const progress = useMemo(() => (data ? deckProgress(words, data.idx) : null), [data, words]);

  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const [scan, setScan] = useState(false);
  const [starting, setStarting] = useState(false);
  // A run of this deck going on (also one resumed at start-up) shows here (v0.5.3 A1).
  const run = useDeckAddProgress();
  const adding = run ? { done: run.done, total: run.total } : starting ? { done: 0, total: 0 } : null;

  const frame = (children: ReactNode) => (
    <PageFrame
      back={back}
      eyebrow={t(`deckHub.kind.${spec.kind}`)}
      title={title}
      description={specBody(t, spec)}
    >
      {children}
    </PageFrame>
  );

  if (!data || !progress || (spec.kind === 'falseFriends' && ffNotes === null))
    return frame(
      <div aria-busy="true" className="flex flex-col gap-4">
        <Skeleton className="h-48" />
        <Skeleton lines={6} />
      </div>,
    );
  if (data.entries.length === 0) return frame(<BankMissing download={download} onRetry={retry} />);

  const statusOf = (w: WordBankEntry) => deckWordStatus(w, data.idx);
  const visibleAll = words.filter((w) => {
    const s = statusOf(w);
    const f: Filter = scan ? 'new' : filter;
    return (
      f === 'all' ||
      (f === 'new'
        ? s === 'new'
        : f === 'known'
          ? s === 'known'
          : s === 'learned' || s === 'studying')
    );
  });
  const visible = visibleAll.slice(0, shown);
  const carded = progress.learned + progress.studying;
  const share = knownShare(progress);
  const spread = levelSpread(words);
  const days = perDay ? Math.ceil(progress.fresh / perDay) : null;
  const levels = CEFR.filter((l) => spread[l] > 0);

  const add = async () => {
    if (adding) return;
    setStarting(true);
    try {
      const r = await runDeckAdd(words, title);
      if (!r) return;
      if (r.added === 0) toast({ title: t('deckHub.suggested.addedNothing'), tone: 'warn' });
      else
        toast({
          title: t('deckHub.suggested.added', { name: title }),
          description: t('deckHub.suggested.addedBody', {
            words: nf.format(r.added),
            cards: nf.format(r.cards),
          }),
          tone: 'success',
        });
    } catch (e) {
      void logError(e, 'SuggestedDeck.add');
      toast({ title: t('deckHub.suggested.addFailed'), tone: 'danger' });
    } finally {
      setStarting(false);
    }
  };

  const know = async (w: WordBankEntry) => {
    try {
      await markKnown(w.lemma, 'manual');
      toast.undo({
        title: t('deckHub.suggested.markedKnown', { term: w.lemma }),
        undoLabel: t('ui.undo'),
        onUndo: () => void unmarkKnown(w.lemma),
      });
    } catch (e) {
      void logError(e, 'SuggestedDeck.known');
      toast({ title: t('deckHub.suggested.addFailed'), tone: 'danger' });
    }
  };

  const filters: [Filter, string][] = [
    ['all', t('deckHub.suggested.fAll', { count: progress.total })],
    ['new', t('deckHub.suggested.fNew', { count: progress.fresh })],
    ['carded', t('deckHub.suggested.fCarded', { count: carded })],
    ...(progress.known > 0
      ? ([['known', t('deckHub.suggested.fKnown', { count: progress.known })]] as [Filter, string][])
      : []),
  ];

  return frame(
    <div className="flex flex-col gap-8">
      <Card padding="lg" className="flex flex-col gap-6">
        <div
          role="group"
          aria-label={t('deckHub.suggested.status')}
          className="grid grid-cols-3 divide-x divide-border [&>*]:px-3 [&>*:first-child]:pl-0"
        >
          <StatTile bare value={nf.format(progress.total)} label={t('deckHub.detail.statWords')} />
          <StatTile
            bare
            value={t('deckHub.suggested.knownPct', { pct: Math.round(share * 100) })}
            label={t('deckHub.suggested.knownLabel')}
          />
          <StatTile bare value={nf.format(progress.fresh)} label={t('deckHub.suggested.freshLabel')} />
        </div>

        {spec.kind !== 'level' &&
          spec.kind !== 'levelPos' &&
          !(spec.kind === 'phrases' && spec.level) &&
          progress.total > 0 && (
          <div className="flex flex-col gap-2">
            <Eyebrow as="h2">{t('deckHub.suggested.levels')}</Eyebrow>
            <SegBar
              height={10}
              label={levels.map((l) => `${l} ${nf.format(spread[l])}`).join(', ')}
              parts={CEFR.map((l) => ({ value: spread[l], color: levelColor(l) }))}
            />
            <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1.5">
              {levels.map((l) => (
                <li key={l} className="flex items-center gap-1.5 text-meta text-fg-muted">
                  <span
                    className="size-2.5 rounded-full ring-1 ring-border-strong/40 ring-inset"
                    style={{ background: levelColor(l) }}
                  />
                  {l}
                  <span className="tabular font-semibold text-fg">{nf.format(spread[l])}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {progress.fresh > 0 && (
            <Button
              size="lg"
              fullWidth
              leadingIcon={adding ? undefined : 'plus'}
              loading={adding !== null}
              onClick={() => void add()}
            >
              {adding
                ? t('deckHub.suggested.adding', { done: adding.done, total: adding.total })
                : myDeck
                  ? t('deckHub.suggested.addMore', { count: progress.fresh })
                  : t('deckHub.suggested.add')}
            </Button>
          )}
          {myDeck && (
            <Link
              to={`/decks/${encodeURIComponent(myDeck.id)}`}
              className={buttonClasses({ variant: 'secondary', size: 'lg', fullWidth: true })}
            >
              {t('deckHub.suggested.openMine')}
            </Link>
          )}
          <p className="flex flex-wrap items-center justify-between gap-x-3 text-meta text-fg-muted">
            <span>
              {t('deckHub.suggested.pace', { perDay: perDay ?? '…' })}
              {' · '}
              {progress.fresh > 0 && days
                ? t('deckHub.suggested.paceBody', { count: progress.fresh, days })
                : t('deckHub.suggested.paceNone')}
            </span>
            <Link
              to="/settings/calisma"
              className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-mr-2' })}
            >
              {t('deckHub.suggested.paceChange')}
            </Link>
          </p>
          <p className="text-meta text-fg-muted">
            {t('deckHub.suggested.skipNote', {
              known: nf.format(progress.known),
              carded: nf.format(carded),
            })}
          </p>
        </div>
      </Card>

      <section aria-labelledby="sd-words" className="flex flex-col">
        <SectionHeader
          id="sd-words"
          title={t('deckHub.detail.wordsTitle')}
          description={scan ? t('deckHub.suggested.scanBody') : t('deckHub.suggested.order')}
          action={
            progress.fresh > 0 ? (
              <Button
                variant={scan ? 'tonal' : 'ghost'}
                size="sm"
                leadingIcon="check"
                aria-pressed={scan}
                onClick={() => {
                  setScan((s) => !s);
                  setShown(PAGE);
                }}
              >
                {scan ? t('deckHub.suggested.scanDone') : t('deckHub.suggested.scan')}
              </Button>
            ) : undefined
          }
        />
        <div className="flex flex-col gap-3">
          {!scan && (
            <ChipRow label={t('deckHub.suggested.filter')}>
              {filters.map(([f, label]) => (
                <Chip
                  key={f}
                  selected={filter === f}
                  onClick={() => {
                    setFilter(f);
                    setShown(PAGE);
                  }}
                >
                  {label}
                </Chip>
              ))}
            </ChipRow>
          )}
          {visible.length === 0 ? (
            <EmptyState tone="placeholder" compact title={t('deckHub.suggested.empty')} />
          ) : (
            <ListGroup aria-label={t('deckHub.suggested.words')}>
              {visible.map((w) => {
                const s = statusOf(w);
                return (
                  <ListRow
                    key={w.id}
                    term
                    title={w.lemma}
                    description={`${w.cefr} · ${posLabel(t, w.pos)} · ${w.senses.map((x) => x.meaning_tr).join(', ')}`}
                    trailing={
                      scan && s === 'new' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={t('deckHub.suggested.markKnownLabel', { term: w.lemma })}
                          onClick={() => void know(w)}
                        >
                          {t('deckHub.suggested.markKnown')}
                        </Button>
                      ) : (
                        <Badge tone={STATUS[s].tone}>{t(`deckHub.suggested.${STATUS[s].key}`)}</Badge>
                      )
                    }
                  />
                );
              })}
            </ListGroup>
          )}
          {visibleAll.length > shown && (
            <Button
              variant="ghost"
              className="self-center"
              onClick={() => setShown((n) => n + PAGE * 4)}
            >
              {t('deckHub.suggested.more', { count: Math.min(PAGE * 4, visibleAll.length - shown) })}
            </Button>
          )}
        </div>
      </section>
    </div>,
  );
}
