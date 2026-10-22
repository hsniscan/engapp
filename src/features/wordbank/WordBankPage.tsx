// Kelime Bankası (decision 0038): every leveled list word with its Turkish meanings and an
// example, by level. "Ekle" adds a word through the normal add path; several can be picked at
// once, and "Bu seviyeden 10 kelime ekle" follows the level mix (domain/wordBank.ts).
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  addFromWordBank,
  getOwnedTerms,
  getSettings,
  listWordBank,
  logError,
  type BankAddResult,
} from '@/data';
import type { WordLevel } from '@/domain/level';
import type { CefrLevel } from '@/domain/types';
import {
  countByLevel,
  filterBank,
  pickLevelMix,
  QUICK_ADD_COUNT,
  type BankItem,
  type OwnedTerms,
  type WordBankEntry,
} from '@/domain/wordBank';
import { WORDBANK_POS } from '../../../supabase/functions/_shared/wordbank-contract';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Icon,
  IconButton,
  Page,
  SegmentedControl,
  Select,
  Skeleton,
  Spinner,
  Surface,
  Switch,
  TextField,
  cn,
  toast,
} from '@/ui';
import { posLabel } from '@/features/cards/labels';
import { LevelBadge } from '@/features/levels/LevelBadge';
import { fetchWordBank, type WordBankFetchOutcome } from './fetcher';

const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const PAGE = 50;
const ALL_POS = '__all';
const NO_OWNED: OwnedTerms = { known: new Set(), carded: new Set() };

const badgeLevel = (e: WordBankEntry): WordLevel => ({
  cefr: e.cefr,
  source: e.list_source,
  list_cefr: null,
  reason_tr: null,
  auto: null,
});

type Download = 'running' | WordBankFetchOutcome['status'];

export function WordBankPage() {
  const { t } = useTranslation();
  const entries = useLiveQuery(() => listWordBank(), []);
  // The list waits for owned words and the level, so nothing known flashes or gets added.
  const ownedLoaded = useLiveQuery(() => getOwnedTerms(), []);
  const owned = ownedLoaded ?? NO_OWNED;
  const userLevel = useLiveQuery(async () => (await getSettings()).level, []);

  const [level, setLevel] = useState<CefrLevel | null>(null);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState(ALL_POS);
  const [showOwned, setShowOwned] = useState(false);
  const [paging, setPaging] = useState({ key: '', shown: PAGE });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState<Download>('running');

  const activeLevel: CefrLevel = level ?? userLevel ?? 'B1';
  // A new level, filter or search starts the list from its first page again.
  const filterKey = `${activeLevel}|${pos}|${query}|${showOwned}`;
  const shown = paging.key === filterKey ? paging.shown : PAGE;
  const showMore = () => setPaging({ key: filterKey, shown: shown + PAGE });

  const download$ = useCallback(
    (force: boolean) => fetchWordBank(undefined, { force }).then((r) => setDownload(r.status)),
    [],
  );
  useEffect(() => {
    void download$(false);
  }, [download$]);
  const retryDownload = () => {
    setDownload('running');
    void download$(true);
  };

  const items: BankItem[] = useMemo(
    () =>
      filterBank(
        entries ?? [],
        {
          level: query.trim() ? null : activeLevel,
          pos: pos === ALL_POS ? null : pos,
          query,
          showOwned,
        },
        owned,
      ),
    [entries, activeLevel, pos, query, showOwned, owned],
  );
  const perLevel = useMemo(() => countByLevel(entries ?? [], owned), [entries, owned]);
  const byId = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e])), [entries]);

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

  const quickPick = useMemo(
    () => pickLevelMix(entries ?? [], owned, activeLevel, QUICK_ADD_COUNT),
    [entries, owned, activeLevel],
  );

  const toggle = (id: string, on: boolean) =>
    setSelected((sel) => {
      const next = new Set(sel);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const empty = entries !== undefined && entries.length === 0;

  return (
    <Page title={t('wordBank.title')} description={t('wordBank.description')}>
      <div className="flex flex-col gap-5 pb-24">
        {entries === undefined || ownedLoaded === undefined || userLevel === undefined ? (
          <Surface>
            <Skeleton lines={4} />
          </Surface>
        ) : empty ? (
          download === 'running' ? (
            <Surface className="flex items-center gap-3" role="status">
              <Spinner />
              <span className="text-[0.9375rem] text-fg-muted">{t('wordBank.loading')}</span>
            </Surface>
          ) : (
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
                  <Button variant="secondary" onClick={retryDownload}>
                    {t('wordBank.retry')}
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <SegmentedControl
              legend={t('wordBank.level')}
              options={LEVELS.map((l) => ({ value: l, label: l }))}
              value={activeLevel}
              onValueChange={(v) => setLevel(v)}
            />

            <Surface className="flex flex-col gap-2" data-testid="word-bank-quick">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">
                    {t('wordBank.quickTitle', { count: QUICK_ADD_COUNT })}
                  </p>
                  <p className="text-sm text-fg-muted">
                    {t('wordBank.quickHint', { level: activeLevel })}
                  </p>
                </div>
                <Button
                  onClick={() => void add(quickPick.map((entry) => ({ entry })))}
                  disabled={busy || quickPick.length === 0}
                >
                  <Icon name="plus" size={18} />
                  {t('wordBank.quickAction', { count: quickPick.length })}
                </Button>
              </div>
              {quickPick.length === 0 && (
                <p className="text-sm text-fg-muted">{t('wordBank.quickNone')}</p>
              )}
            </Surface>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <TextField
                label={t('wordBank.search')}
                hideLabel
                placeholder={t('wordBank.search')}
                leadingIcon="search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                fieldClassName="flex-1"
              />
              <Select
                label={t('wordBank.pos')}
                hideLabel
                value={pos}
                onValueChange={setPos}
                options={[
                  { value: ALL_POS, label: t('wordBank.posAll') },
                  ...WORDBANK_POS.map((p) => ({ value: p, label: posLabel(t, p) })),
                ]}
                className="sm:w-48"
              />
            </div>
            <Switch
              label={t('wordBank.showOwned')}
              checked={showOwned}
              onCheckedChange={setShowOwned}
            />

            <p className="tabular text-sm text-fg-muted" aria-live="polite">
              {query.trim()
                ? t('wordBank.countSearch', { count: items.length })
                : t('wordBank.countLevel', {
                    count: items.length,
                    level: activeLevel,
                    left: perLevel[activeLevel],
                  })}
            </p>

            {items.length === 0 ? (
              <p className="text-[0.9375rem] text-fg-muted">{t('wordBank.noMatch')}</p>
            ) : (
              <ul
                aria-label={t('wordBank.listLabel')}
                className="divide-y divide-border rounded-card border border-border bg-surface"
              >
                {items.slice(0, shown).map((item) => (
                  <BankRow
                    key={item.entry.id}
                    item={item}
                    selected={selected.has(item.entry.id)}
                    onSelect={(on) => toggle(item.entry.id, on)}
                    onAdd={(senses) => void add([{ entry: item.entry, senses }])}
                    busy={busy}
                  />
                ))}
              </ul>
            )}
            {items.length > shown && (
              <Button variant="secondary" onClick={showMore} className="self-center">
                {t('wordBank.more', { count: items.length - shown })}
              </Button>
            )}
          </>
        )}

        <p className="text-xs text-fg-subtle">
          {t('wordBank.credit')}{' '}
          <Link
            to="/settings/kaynaklar"
            className="font-medium text-accent-text underline-offset-4 hover:underline"
          >
            {t('wordBank.creditLink')}
          </Link>
        </p>
      </div>

      {selected.size > 0 && (
        <div
          role="region"
          aria-label={t('wordBank.selectionBar')}
          className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 px-4 md:bottom-6"
        >
          <Surface className="mx-auto flex max-w-xl items-center gap-3 shadow-lg">
            <span className="tabular min-w-0 flex-1 text-[0.9375rem] font-medium text-fg">
              {t('wordBank.selected', { count: selected.size })}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {t('wordBank.clearSelection')}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void add(
                  [...selected].flatMap((id) => {
                    const entry = byId.get(id);
                    return entry ? [{ entry }] : [];
                  }),
                )
              }
            >
              {t('wordBank.addSelected')}
            </Button>
          </Surface>
        </div>
      )}
    </Page>
  );
}

function BankRow({
  item,
  selected,
  onSelect,
  onAdd,
  busy,
}: {
  item: BankItem;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onAdd: (senses: number[]) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { entry, owned } = item;
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([0]);
  const detailsId = `wb-${entry.id.replace(/[^a-z0-9]/gi, '-')}`;
  return (
    <li className="flex flex-col gap-2 py-2 pr-2 pl-3" data-testid="word-bank-row">
      <div className="flex items-start gap-2">
        <Checkbox
          label={t('wordBank.select', { term: entry.lemma })}
          hideLabel
          checked={selected}
          onCheckedChange={(v) => onSelect(v === true)}
          className="mt-2.5"
        />
        <div className="min-w-0 flex-1 py-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span lang="en" className="font-serif text-lg font-semibold text-fg">
              {entry.lemma}
            </span>
            <span className="text-sm text-fg-muted">{posLabel(t, entry.pos)}</span>
            <LevelBadge level={badgeLevel(entry)} />
            {owned && (
              <Badge tone={owned === 'carded' ? 'accent' : 'success'}>
                {t(owned === 'carded' ? 'wordBank.carded' : 'wordBank.known')}
              </Badge>
            )}
          </div>
          <p className="text-[0.9375rem] text-fg-muted">
            {entry.senses.map((s) => s.meaning_tr).join(' · ')}
          </p>
        </div>
        <IconButton
          icon={open ? 'chevron-up' : 'chevron-down'}
          label={t('wordBank.details', { term: entry.lemma })}
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((o) => !o)}
          variant="ghost"
        />
        <Button
          size="sm"
          variant={owned ? 'ghost' : 'secondary'}
          aria-label={t('wordBank.addLabel', { term: entry.lemma })}
          disabled={busy}
          onClick={() => onAdd(open && picked.length > 0 ? picked : [0])}
          className="mt-1"
        >
          {t('wordBank.add')}
        </Button>
      </div>
      {open && (
        <div id={detailsId} className="flex flex-col gap-3 pb-2 pl-11">
          {entry.senses.length > 1 && (
            <p className="text-sm font-medium text-fg-muted">{t('wordBank.meaningsPick')}</p>
          )}
          {entry.senses.map((s, i) => (
            <div key={i} className={cn('flex flex-col gap-1', entry.senses.length > 1 && 'pl-0')}>
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
        </div>
      )}
    </li>
  );
}
