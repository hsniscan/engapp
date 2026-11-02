// Kelime Bankası (decision 0038), the second view of Kelimelerim (docs/design.md §4.8): every
// leveled list word with its Turkish meanings and an example. Filters (level, part of speech,
// order, hide what I know); the round plus on a row adds the word at once ("Geri al" in the
// toast); open a word to read its examples, pick some of its meanings, or say "Biliyorum".
// "Deste yap" opens the matching suggested deck.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import {
  addFromWordBank,
  bulkSoftDeleteNotes,
  logError,
  markManyKnown,
  unmarkKnownKeys,
  type BankAddResult,
} from '@/data';
import { CEFR } from '@/domain/level';
import { CONTENT_POS, type ContentPos, type SuggestedSpec } from '@/domain/suggestedDecks';
import type { CefrLevel } from '@/domain/types';
import {
  filterBank,
  ownedStatus,
  pickLevelMix,
  QUICK_ADD_COUNT,
  type BankItem,
  type OwnedTerms,
  type WordBankEntry,
} from '@/domain/wordBank';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  ChipRow,
  DropdownMenu,
  EmptyState,
  Eyebrow,
  Icon,
  IconButton,
  ListGroup,
  Skeleton,
  Switch,
  Term,
  TextField,
  buttonClasses,
  cn,
  toast,
} from '@/ui';
import { posLabel } from '@/features/cards/labels';
import { BankMissing } from '@/features/decks/DeckCatalog';
import { nf } from '@/features/decks/deckUi';
import { ChipCount } from '@/features/decks/parts';
import { specHref, useBankData, useWordBankDownload } from '@/features/decks/suggested';

const PAGE = 50;
const OTHER = '__other';
type PosFilter = ContentPos | typeof OTHER | null;
type Sort = 'freq' | 'az';

/** The old /kelime-bankasi route: the bank lives in Kelimelerim now. */
export function WordBankPage() {
  return <Navigate to="/decks?tab=bank" replace />;
}

const isContent = (pos: string): pos is ContentPos =>
  (CONTENT_POS as readonly string[]).includes(pos);

const capital = (s: string) => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);

export function WordBankPanel() {
  const { t } = useTranslation();
  const { download, retry, rows, complete } = useWordBankDownload();
  const data = useBankData();

  const [level, setLevel] = useState<CefrLevel | null | undefined>(undefined);
  const [pos, setPos] = useState<PosFilter>(null);
  const [sort, setSort] = useState<Sort>('freq');
  const [query, setQuery] = useState('');
  const [hideOwned, setHideOwned] = useState(true);
  const [paging, setPaging] = useState({ key: '', shown: PAGE });
  const [busy, setBusy] = useState(false);

  const owned: OwnedTerms = useMemo(
    () =>
      data
        ? { known: data.idx.known, carded: new Set(data.idx.stage.keys()) }
        : { known: new Set(), carded: new Set() },
    [data],
  );
  // The learner's level until they pick another (null = every level).
  const activeLevel = level === undefined ? (data?.level ?? 'B1') : level;
  const searching = query.trim() !== '';

  const base = useMemo(
    () =>
      data
        ? filterBank(
            data.entries,
            { level: searching ? null : activeLevel, pos: null, query, showOwned: !hideOwned },
            owned,
          )
        : [],
    [data, activeLevel, searching, query, hideOwned, owned],
  );
  const posCounts = useMemo(() => {
    const c: Record<string, number> = { all: base.length, [OTHER]: 0 };
    for (const p of CONTENT_POS) c[p] = 0;
    for (const i of base) c[isContent(i.entry.pos) ? i.entry.pos : OTHER]!++;
    return c;
  }, [base]);
  const items: BankItem[] = useMemo(() => {
    const list = base.filter(
      (i) => pos === null || (pos === OTHER ? !isContent(i.entry.pos) : i.entry.pos === pos),
    );
    return sort === 'az' && !searching
      ? [...list].sort((a, b) => a.entry.lemma.localeCompare(b.entry.lemma, 'en'))
      : list;
  }, [base, pos, sort, searching]);

  const filterKey = `${activeLevel}|${pos}|${query}|${hideOwned}|${sort}`;
  const shown = paging.key === filterKey ? paging.shown : PAGE;
  const quickPick = useMemo(
    () =>
      data ? pickLevelMix(data.entries, owned, activeLevel ?? data.level, QUICK_ADD_COUNT) : [],
    [data, owned, activeLevel],
  );

  if (!data)
    return (
      <div aria-busy="true">
        <Skeleton lines={6} />
      </div>
    );
  if (data.entries.length === 0) return <BankMissing download={download} onRetry={retry} />;

  const report = (res: BankAddResult) => {
    if (res.added.length === 0) {
      toast({ title: t('wordBank.nothingNew'), tone: 'warn' });
      return;
    }
    const title =
      res.added.length === 1
        ? t('wordBank.addedOne', { term: res.added[0] })
        : t('wordBank.addedMany', { count: res.added.length });
    const description = t('wordBank.cardsCreated', { count: res.cards });
    // "Geri al" only when every added word is a new note (a new meaning of an owned word is not
    // taken back by deleting the note).
    if (res.created.length === res.added.length) {
      const ids = res.created;
      toast.undo({
        title,
        description,
        undoLabel: t('ui.undo'),
        onUndo: () => void bulkSoftDeleteNotes(ids).catch((e) => logError(e, 'wordBank.undo')),
      });
    } else toast({ title, description, tone: 'success' });
  };

  const add = async (picks: { entry: WordBankEntry; senses?: number[] }[]) => {
    if (picks.length === 0 || busy) return;
    setBusy(true);
    try {
      report(await addFromWordBank(picks));
    } catch (err) {
      void logError(err, 'wordBank.add');
      toast({ title: t('wordBank.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  // "Biliyorum": the word goes to Bildiğim kelimeler (hidden here while "Bildiklerimi gizle" is on).
  const markKnown = async (entries: WordBankEntry[]) => {
    if (entries.length === 0 || busy) return;
    setBusy(true);
    try {
      const added = await markManyKnown(entries.map((e) => e.lemma));
      toast.undo({
        title: t('wordBank.knownMarked', { count: added.length }),
        undoLabel: t('ui.undo'),
        onUndo: () =>
          void unmarkKnownKeys(added).catch((e) => logError(e, 'wordBank.knownUndo')),
      });
    } catch (err) {
      void logError(err, 'wordBank.known');
      toast({ title: t('wordBank.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const deckSpec: SuggestedSpec | null =
    !searching && activeLevel && pos && pos !== OTHER
      ? { kind: 'levelPos', level: activeLevel, pos }
      : !searching && activeLevel && pos === null
        ? { kind: 'level', level: activeLevel }
        : !searching && !activeLevel && pos && pos !== OTHER
          ? { kind: 'pos', pos }
          : null;
  const headingParts = [
    searching ? null : (activeLevel ?? t('deckHub.bank.allLevels')),
    pos === null ? null : pos === OTHER ? t('deckHub.bank.posOther') : posLabel(t, pos),
  ].filter(Boolean);
  const posChips: [PosFilter, string, number][] = [
    [null, t('deckHub.bank.posAll'), posCounts.all!],
    ...CONTENT_POS.map((p): [PosFilter, string, number] => [p, capital(posLabel(t, p)), posCounts[p]!]),
    ...(posCounts[OTHER]
      ? ([[OTHER, t('deckHub.bank.posOther'), posCounts[OTHER]]] as [PosFilter, string, number][])
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      {download === 'running' && complete === false ? (
        <Card tone="sunken" padding="sm" role="status" className="px-4 text-meta text-fg-muted">
          {t('deckHub.bank.downloading', { count: nf.format(rows ?? data.entries.length) })}
        </Card>
      ) : (
        complete === false &&
        download !== 'running' && (
          <Card
            tone="sunken"
            padding="sm"
            role="status"
            className="flex flex-wrap items-center gap-3 pl-4"
          >
            <Icon name="alert" size={18} className="shrink-0 text-warn-text" />
            <span className="min-w-0 flex-1 text-meta text-fg">
              {t('deckHub.bank.partial', { count: nf.format(data.entries.length) })}
            </span>
            <Button size="sm" variant="secondary" onClick={retry}>
              {t('common.retry')}
            </Button>
          </Card>
        )
      )}

      <div className="flex flex-col gap-3">
        <TextField
          label={t('deckHub.bank.search', { count: nf.format(data.entries.length) })}
          hideLabel
          placeholder={t('deckHub.bank.search', { count: nf.format(data.entries.length) })}
          leadingIcon="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <ChipRow label={t('deckHub.bank.level')} className={cn(searching && 'opacity-60')}>
          {CEFR.map((l) => (
            <Chip
              key={l}
              selected={!searching && activeLevel === l}
              onClick={() => setLevel(activeLevel === l ? null : l)}
            >
              {l}
            </Chip>
          ))}
          <Chip selected={!searching && activeLevel === null} onClick={() => setLevel(null)}>
            {t('deckHub.bank.allLevels')}
          </Chip>
        </ChipRow>
        <ChipRow label={t('deckHub.bank.pos')}>
          {posChips.map(([p, label, n]) => (
            <Chip key={p ?? 'all'} selected={pos === p} onClick={() => setPos(p)}>
              <ChipCount label={label} count={n} selected={pos === p} />
            </Chip>
          ))}
        </ChipRow>
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <DropdownMenu
            align="start"
            label={t('deckHub.bank.sort')}
            trigger={
              <Button variant="ghost" size="sm" trailingIcon="chevron-down" className="-ml-2">
                {t('deckHub.bank.sortLabel', {
                  order: sort === 'freq' ? t('deckHub.bank.sortFreq') : t('deckHub.bank.sortAz'),
                })}
              </Button>
            }
            items={[
              { label: t('deckHub.bank.sortFreq'), onSelect: () => setSort('freq') },
              { label: t('deckHub.bank.sortAz'), onSelect: () => setSort('az') },
            ]}
          />
          <Switch
            label={t('deckHub.bank.hideOwned')}
            checked={hideOwned}
            onCheckedChange={setHideOwned}
          />
        </div>
      </div>

      {!searching && (
        <Card
          data-testid="word-bank-quick"
          padding="sm"
          className="flex flex-wrap items-center justify-between gap-3 pl-4"
        >
          <span className="min-w-0 flex-1 text-meta text-fg-muted">
            {quickPick.length
              ? t('deckHub.bank.quick', { count: QUICK_ADD_COUNT })
              : t('wordBank.quickNone')}
          </span>
          <Button
            size="sm"
            variant="tonal"
            leadingIcon="plus"
            onClick={() => void add(quickPick.map((entry) => ({ entry })))}
            disabled={busy || quickPick.length === 0}
          >
            {t('wordBank.quickAction', { count: quickPick.length })}
          </Button>
        </Card>
      )}

      <section aria-labelledby="wb-heading" className="flex flex-col gap-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Eyebrow as="h2">
            <span id="wb-heading" aria-live="polite">
              {headingParts.length
                ? t('deckHub.bank.heading', {
                    parts: headingParts.join(' · '),
                    count: nf.format(items.length),
                  })
                : t('wordBank.countSearch', { count: items.length })}
            </span>
          </Eyebrow>
          {deckSpec && (
            <Link
              to={specHref(deckSpec)}
              className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-mr-2' })}
            >
              {t('deckHub.bank.makeDeck')}
            </Link>
          )}
        </div>

        {items.length === 0 ? (
          <EmptyState tone="placeholder" compact icon="search" title={t('wordBank.noMatch')} />
        ) : (
          <ListGroup aria-label={t('wordBank.listLabel')}>
            {items.slice(0, shown).map((item) => (
              <BankRow
                key={item.entry.id}
                item={item}
                owned={ownedStatus(item.entry, owned)}
                onAdd={(senses) => void add([{ entry: item.entry, senses }])}
                onKnown={() => void markKnown([item.entry])}
                busy={busy}
              />
            ))}
          </ListGroup>
        )}
        {items.length > 0 && (
          <div className="flex flex-col items-center gap-1">
            <span className="tabular text-meta text-fg-muted">
              {t('deckHub.bank.showing', {
                shown: nf.format(Math.min(shown, items.length)),
                total: nf.format(items.length),
              })}
            </span>
            {items.length > shown && (
              <Button
                variant="ghost"
                onClick={() => setPaging({ key: filterKey, shown: shown + PAGE })}
              >
                {t('wordBank.more', { count: items.length - shown })}
              </Button>
            )}
          </div>
        )}
      </section>

      <p className="text-caption font-normal text-fg-muted">
        {t('wordBank.credit')}{' '}
        <Link
          to="/settings/kaynaklar"
          className="font-semibold text-accent-text underline-offset-4 hover:underline"
        >
          {t('wordBank.creditLink')}
        </Link>
      </p>
    </div>
  );
}

function BankRow({
  item,
  owned,
  onAdd,
  onKnown,
  busy,
}: {
  item: BankItem;
  owned: 'known' | 'carded' | null;
  onAdd: (senses: number[]) => void;
  onKnown: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { entry } = item;
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([0]);
  const detailsId = `wb-${entry.id.replace(/[^a-z0-9]/gi, '-')}`;
  const many = entry.senses.length > 1;
  return (
    <div data-testid="word-bank-row">
      <div className="flex min-h-14 items-center gap-3 pr-2 pl-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 flex-col gap-0.5 py-3 text-left focus-visible:outline-offset-2"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span lang="en" className="truncate font-serif text-lead font-medium text-fg">
              {entry.lemma}
            </span>
            <span className="shrink-0 text-meta text-fg-muted">
              {posLabel(t, entry.pos)} · {entry.cefr}
            </span>
          </span>
          <span className="truncate text-meta text-fg-muted">
            {entry.senses.map((s) => s.meaning_tr).join(', ')}
          </span>
        </button>
        {owned === 'known' ? (
          <span className="shrink-0 px-2 text-meta text-fg-muted">{t('deckHub.bank.known')}</span>
        ) : owned === 'carded' ? (
          <span
            className="flex size-11 shrink-0 items-center justify-center text-accent-text"
            role="img"
            aria-label={t('wordBank.cardedLabel', { term: entry.lemma })}
          >
            <Icon name="check" size={20} />
          </span>
        ) : (
          <IconButton
            icon="plus"
            variant="tonal"
            label={t('wordBank.addLabel', { term: entry.lemma })}
            tooltip={false}
            disabled={busy}
            onClick={() => onAdd(many ? picked : [0])}
            className="shrink-0"
          />
        )}
      </div>
      {open && (
        <div id={detailsId} className="flex flex-col gap-4 px-4 pb-4">
          {many && <Eyebrow>{t('wordBank.meaningsPick')}</Eyebrow>}
          {entry.senses.map((s, i) => (
            <div key={i} className="flex flex-col gap-1">
              {many ? (
                <Checkbox
                  label={s.meaning_tr}
                  checked={picked.includes(i)}
                  onCheckedChange={(v) =>
                    setPicked((p) => (v === true ? [...p, i] : p.filter((x) => x !== i)))
                  }
                />
              ) : (
                <p className="text-ui font-semibold text-fg">{s.meaning_tr}</p>
              )}
              {s.example_en && (
                <Term italic className="text-fg">
                  {s.example_en}
                </Term>
              )}
              {s.example_tr && <p className="text-meta text-fg-muted">{s.example_tr}</p>}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {many && owned !== 'known' && (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon="plus"
                disabled={busy || picked.length === 0}
                onClick={() => onAdd(picked)}
              >
                {t('wordBank.addPicked', { count: picked.length })}
              </Button>
            )}
            {!owned && (
              <Button
                size="sm"
                variant="ghost"
                leadingIcon="check"
                aria-label={t('wordBank.markKnownLabel', { term: entry.lemma })}
                disabled={busy}
                onClick={onKnown}
              >
                {t('wordBank.markKnown')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
