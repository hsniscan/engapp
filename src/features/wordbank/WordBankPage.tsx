// Kelime Bankası (decision 0038), now the third segment of Desteler (board DecksBank): every
// leveled list word with its Turkish meanings and an example. Filters (level, part of speech,
// order, hide what I know), select several and "Ekle" them to Tüm kelimelerim, or open a word
// to pick its meanings and add just that one. "Deste yap" opens the matching suggested deck.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { addFromWordBank, logError, type BankAddResult } from '@/data';
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
import { Button, Checkbox, cn, Icon, Skeleton, Switch, TextField, toast } from '@/ui';
import { posLabel } from '@/features/cards/labels';
import { BankMissing } from '@/features/decks/DeckCatalog';
import { nf } from '@/features/decks/deckUi';
import { FilterChip, FreqDots } from '@/features/decks/parts';
import { specHref, useBankData, useWordBankDownload } from '@/features/decks/suggested';

const PAGE = 50;
const OTHER = '__other';
type PosFilter = ContentPos | typeof OTHER | null;
type Sort = 'freq' | 'az';

/** The old /kelime-bankasi route: the bank lives in Desteler now. */
export function WordBankPage() {
  return <Navigate to="/decks?tab=bank" replace />;
}

const isContent = (pos: string): pos is ContentPos => (CONTENT_POS as readonly string[]).includes(pos);

export function WordBankPanel() {
  const { t } = useTranslation();
  const { download, retry } = useWordBankDownload();
  const data = useBankData();

  const [level, setLevel] = useState<CefrLevel | null | undefined>(undefined);
  const [pos, setPos] = useState<PosFilter>(null);
  const [sort, setSort] = useState<Sort>('freq');
  const [query, setQuery] = useState('');
  const [hideOwned, setHideOwned] = useState(true);
  const [paging, setPaging] = useState({ key: '', shown: PAGE });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const owned: OwnedTerms = useMemo(
    () =>
      data
        ? {
            known: data.idx.known,
            carded: new Set(data.idx.stage.keys()),
          }
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
  const byId = useMemo(() => new Map((data?.entries ?? []).map((e) => [e.id, e])), [data]);
  const quickPick = useMemo(
    () => (data ? pickLevelMix(data.entries, owned, activeLevel ?? data.level, QUICK_ADD_COUNT) : []),
    [data, owned, activeLevel],
  );

  if (!data) return <Skeleton lines={6} />;
  if (data.entries.length === 0) return <BankMissing download={download} onRetry={retry} />;

  const report = (res: BankAddResult) => {
    if (res.added.length === 0) {
      toast({ title: t('wordBank.nothingNew'), tone: 'warn' });
      return;
    }
    toast({
      title:
        res.added.length === 1
          ? t('wordBank.addedOne', { term: res.added[0] })
          : t('wordBank.addedMany', { count: res.added.length }),
      description: t('wordBank.cardsCreated', { count: res.cards }),
      tone: 'success',
    });
  };

  const add = async (picks: { entry: WordBankEntry; senses?: number[] }[]) => {
    if (picks.length === 0 || busy) return;
    setBusy(true);
    try {
      report(await addFromWordBank(picks));
      setSelected((sel) => {
        const next = new Set(sel);
        for (const p of picks) next.delete(p.entry.id);
        return next;
      });
    } catch (err) {
      void logError(err, 'wordBank.add');
      toast({ title: t('wordBank.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((sel) => {
      const next = new Set(sel);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

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

  return (
    <div className="flex flex-col gap-3.5 pb-24">
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

      <section
        aria-label={t('deckHub.bank.filters')}
        className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-surface p-3.5"
      >
        <div className={cn('flex flex-col gap-2', searching && 'opacity-60')}>
          <span id="wb-level" className="text-[13px] text-fg-muted">
            {t('deckHub.bank.level')}
          </span>
          <div role="group" aria-labelledby="wb-level" className="grid grid-cols-6 gap-1.5">
            {CEFR.map((l) => (
              <FilterChip
                key={l}
                pressed={!searching && activeLevel === l}
                onClick={() => setLevel(activeLevel === l ? null : l)}
                className="px-0 font-semibold"
              >
                {l}
              </FilterChip>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span id="wb-pos" className="text-[13px] text-fg-muted">
            {t('deckHub.bank.pos')}
          </span>
          <div role="group" aria-labelledby="wb-pos" className="flex flex-wrap gap-1.5">
            {(
              [
                [null, t('deckHub.bank.posAll'), posCounts.all],
                ...CONTENT_POS.map((p) => [p, posLabel(t, p), posCounts[p]] as const),
                ...(posCounts[OTHER] ? ([[OTHER, t('deckHub.bank.posOther'), posCounts[OTHER]]] as const) : []),
              ] as [PosFilter, string, number][]
            ).map(([p, label, n]) => (
              <FilterChip key={p ?? 'all'} tone="accent" pressed={pos === p} onClick={() => setPos(p)}>
                <span>{label.charAt(0).toLocaleUpperCase('tr') + label.slice(1)}</span>{' '}
                <span className={cn('tabular', pos === p ? '' : 'text-fg-muted')}>{nf.format(n)}</span>
              </FilterChip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-surface-sunken pt-3">
          <div role="group" aria-label={t('deckHub.bank.sort')} className="flex gap-0.5 rounded-[11px] bg-surface-sunken p-[3px]">
            {(['freq', 'az'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={sort === s}
                onClick={() => setSort(s)}
                className={cn(
                  'h-10 rounded-[9px] px-3 text-sm',
                  sort === s
                    ? 'bg-surface-raised font-semibold text-fg shadow-[0_1px_2px_rgb(31_29_26/0.12)]'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                {s === 'freq' ? t('deckHub.bank.sortFreq') : t('deckHub.bank.sortAz')}
              </button>
            ))}
          </div>
          <Switch label={t('deckHub.bank.hideOwned')} checked={hideOwned} onCheckedChange={setHideOwned} />
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 px-1 pt-1">
        <h2 className="font-serif text-[19px] font-semibold text-fg" aria-live="polite">
          {headingParts.length
            ? t('deckHub.bank.heading', { parts: headingParts.join(' · '), count: nf.format(items.length) })
            : t('wordBank.countSearch', { count: items.length })}
        </h2>
        {deckSpec && (
          <Link
            to={specHref(deckSpec)}
            className="flex min-h-11 shrink-0 items-center text-sm font-semibold text-accent-text hover:underline"
          >
            {t('deckHub.bank.makeDeck')}
          </Link>
        )}
      </div>

      {!searching && (
        <div
          data-testid="word-bank-quick"
          className="flex items-center justify-between gap-3 rounded-[18px] border border-border bg-surface py-2 pr-2 pl-4"
        >
          <span className="min-w-0 text-sm text-fg-muted">
            {quickPick.length
              ? t('deckHub.bank.quick', { count: QUICK_ADD_COUNT })
              : t('wordBank.quickNone')}
          </span>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon="plus"
            onClick={() => void add(quickPick.map((entry) => ({ entry })))}
            disabled={busy || quickPick.length === 0}
          >
            {t('wordBank.quickAction', { count: quickPick.length })}
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="rounded-[20px] border border-border bg-surface p-4 text-[15px] text-fg-muted">
          {t('wordBank.noMatch')}
        </p>
      ) : (
        <ul
          aria-label={t('wordBank.listLabel')}
          className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-surface"
        >
          {items.slice(0, shown).map((item) => (
            <BankRow
              key={item.entry.id}
              item={item}
              owned={ownedStatus(item.entry, owned)}
              selected={selected.has(item.entry.id)}
              onSelect={(on) => toggle(item.entry.id, on)}
              onAdd={(senses) => void add([{ entry: item.entry, senses }])}
              busy={busy}
            />
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <div className="flex flex-col items-center gap-1">
          <span className="tabular text-[13px] text-fg-muted">
            {t('deckHub.bank.showing', {
              shown: nf.format(Math.min(shown, items.length)),
              total: nf.format(items.length),
            })}
          </span>
          {items.length > shown && (
            <Button variant="ghost" onClick={() => setPaging({ key: filterKey, shown: shown + PAGE })}>
              {t('wordBank.more', { count: items.length - shown })}
            </Button>
          )}
        </div>
      )}

      <p className="text-xs text-fg-subtle">
        {t('wordBank.credit')}{' '}
        <Link to="/settings/kaynaklar" className="font-medium text-accent-text underline-offset-4 hover:underline">
          {t('wordBank.creditLink')}
        </Link>
      </p>

      {selected.size > 0 && (
        <div
          role="region"
          aria-label={t('wordBank.selectionBar')}
          className="fixed inset-x-3 bottom-[calc(var(--nav-height)+var(--nav-fab-rise)+env(safe-area-inset-bottom)+0.5rem)] z-20 md:bottom-6"
        >
          <div className="mx-auto flex max-w-xl items-center gap-2.5 rounded-[18px] bg-fg py-2 pr-2 pl-4 text-fg-inverse shadow-overlay">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="tabular text-[15px] font-semibold">
                {t('wordBank.selected', { count: selected.size })}
              </span>
              <span className="text-xs opacity-80">{t('deckHub.bank.selectedBody')}</span>
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="h-11 rounded-xl px-3 text-sm hover:bg-white/10"
            >
              {t('wordBank.clearSelection')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void add(
                  [...selected].flatMap((id) => {
                    const entry = byId.get(id);
                    return entry ? [{ entry }] : [];
                  }),
                )
              }
              className="h-11 rounded-xl bg-canvas px-[18px] text-[15px] font-semibold text-accent-text disabled:opacity-50"
            >
              {t('wordBank.addSelected')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BankRow({
  item,
  owned,
  selected,
  onSelect,
  onAdd,
  busy,
}: {
  item: BankItem;
  owned: 'known' | 'carded' | null;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onAdd: (senses: number[]) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { entry } = item;
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([0]);
  const detailsId = `wb-${entry.id.replace(/[^a-z0-9]/gi, '-')}`;
  return (
    <li
      data-testid="word-bank-row"
      className={cn('border-b border-surface-sunken last:border-b-0', selected && 'bg-accent-soft/50')}
    >
      <div className="flex min-h-16 items-center gap-3 py-2 pr-2.5 pl-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-control text-left"
        >
          <span className="flex items-baseline gap-2">
            <span lang="en" className="truncate font-serif text-lg font-semibold text-fg">
              {entry.lemma}
            </span>
            <span className="text-xs text-fg-muted">{posLabel(t, entry.pos)}</span>
            <span className="text-xs font-semibold text-fg-muted">{entry.cefr}</span>
          </span>
          <span className="truncate text-sm text-fg-muted">
            {entry.senses.map((s) => s.meaning_tr).join(', ')}
          </span>
        </button>
        <FreqDots zipf={entry.zipf} />
        <span className="flex w-[84px] shrink-0 justify-center">
          {owned === 'known' ? (
            <span className="text-[13px] text-fg-muted">{t('deckHub.bank.known')}</span>
          ) : owned === 'carded' ? (
            <span className="flex items-center gap-1 text-[13px] font-semibold text-success-text">
              <Icon name="check" size={14} />
              {t('deckHub.bank.carded')}
            </span>
          ) : (
            <button
              type="button"
              aria-pressed={selected}
              aria-label={t('wordBank.select', { term: entry.lemma })}
              onClick={() => onSelect(!selected)}
              className={cn(
                'flex size-11 items-center justify-center rounded-full',
                selected
                  ? 'bg-accent text-accent-fg'
                  : 'border border-border bg-surface-raised text-accent-text hover:border-border-strong',
              )}
            >
              <Icon name={selected ? 'check' : 'plus'} size={20} />
            </button>
          )}
        </span>
      </div>
      {open && (
        <div id={detailsId} className="flex flex-col gap-3 px-4 pb-4">
          {entry.senses.length > 1 && (
            <p className="text-sm font-medium text-fg-muted">{t('wordBank.meaningsPick')}</p>
          )}
          {entry.senses.map((s, i) => (
            <div key={i} className="flex flex-col gap-1">
              {entry.senses.length > 1 ? (
                <Checkbox
                  label={s.meaning_tr}
                  checked={picked.includes(i)}
                  onCheckedChange={(v) =>
                    setPicked((p) => (v === true ? [...p, i] : p.filter((x) => x !== i)))
                  }
                />
              ) : (
                <p className="font-medium text-fg">{s.meaning_tr}</p>
              )}
              <p lang="en" className="text-[0.9375rem] text-fg">
                {s.example_en}
              </p>
              <p className="text-sm text-fg-muted">{s.example_tr}</p>
            </div>
          ))}
          {!owned || owned === 'carded' ? (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon="plus"
              aria-label={t('wordBank.addLabel', { term: entry.lemma })}
              disabled={busy || picked.length === 0}
              onClick={() => onAdd(picked)}
              className="self-start"
            >
              {t('wordBank.add')}
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}
