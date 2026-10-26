// Desteler › Destelerim (board DecksMine): search into Tüm kelimelerim, the "Tüm kelimelerim"
// card, the user's decks with their progress and today's load, new deck (by rules or by
// hand) and the organising tools (AI themes, tags, import).
import { useLiveQuery } from 'dexie-react-hooks';
import type { TFunction } from 'i18next';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { createDeck, getThemePreview, logError } from '@/data';
import { findTagDeck, getMyDecks, type MyDeck } from '@/data/deckHub';
import { cleanDeckName, MAX_DECK_NAME } from '@/domain/deckFilter';
import { cleanTag } from '@/domain/tags';
import { Button, cn, Dialog, DialogClose, Icon, Skeleton, TextField, toast } from '@/ui';
import { useLevelData } from '@/features/levels/useLevelData';
import { DeckEditorDialog } from './DeckEditorDialog';
import { MIN_THEME_WORDS } from '@/domain/themes';
import { deckStudyHref, DISCOVER_DECKS_HREF, MARK, nf, openImportSheet } from './deckUi';
import { Glyph, ProgressBar2 } from './parts';
import { titleIndex } from './suggested';
import { TagsDialog } from './TagsDialog';

type Kind = 'suggested' | 'struggling' | 'tag' | 'smart';

function kindOf(d: MyDeck, titles: Map<string, unknown>): Kind {
  const f = d.filter;
  if (!f) return 'smart';
  const tagOnly =
    f.tags?.length === 1 && !f.states?.length && !f.levels?.length && !f.topics?.length && !f.addedWithinDays;
  if (tagOnly && titles.has(f.tags![0]!.toLocaleLowerCase('tr'))) return 'suggested';
  if (f.states?.includes('struggling')) return 'struggling';
  return tagOnly ? 'tag' : 'smart';
}

export function MineTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const levelData = useLevelData();
  const data = useLiveQuery(() => getMyDecks(), [levelData]);
  const pending = useLiveQuery(async () => !!(await getThemePreview()), []);
  const titles = useMemo(() => titleIndex(t), [t]);
  const [editing, setEditing] = useState(false);
  const [manual, setManual] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [q, setQ] = useState('');

  const search = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    void navigate(term ? `/library?q=${encodeURIComponent(term)}` : '/library');
  };

  const decks = data?.decks ?? [];
  const wide = decks.filter((d) => kindOf(d, titles) === 'suggested');
  const grid = decks.filter((d) => kindOf(d, titles) !== 'suggested');

  return (
    <div className="flex flex-col gap-4">
      <form role="search" onSubmit={search}>
        <TextField
          label={t('deckHub.mine.search')}
          hideLabel
          type="search"
          leadingIcon="search"
          placeholder={t('deckHub.mine.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
        />
      </form>

      <Link
        to="/library"
        className="group flex items-center gap-4 rounded-[20px] border border-border bg-surface-raised p-[18px] text-fg hover:border-border-strong"
      >
        <StackArt />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-serif text-[21px] leading-tight font-semibold">
            {t('deckHub.mine.all')}
          </span>
          <span className="text-sm text-fg-muted">
            {data
              ? t('deckHub.wordsCards', {
                  words: nf.format(data.all.total),
                  cards: nf.format(data.all.cards),
                })
              : ' '}
          </span>
          {data && (
            <span
              className={cn(
                'text-[13px] font-semibold',
                data.all.dueToday > 0 ? 'text-accent-text' : 'text-fg-muted',
              )}
            >
              {data.all.dueToday > 0
                ? t('deckHub.mine.allDue', { count: data.all.dueToday })
                : t('deckHub.mine.allDueNone')}
            </span>
          )}
        </span>
        <Icon name="chevron-right" size={20} className="shrink-0 text-fg-subtle" />
      </Link>

      <section aria-labelledby="mine-decks-h" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between px-1 pt-1">
          <h2 id="mine-decks-h" className="font-serif text-[19px] font-semibold text-fg">
            {t('deckHub.mine.decks')}
          </h2>
          {data && decks.length > 0 && (
            <span className="text-[13px] text-fg-muted">
              {t('deckHub.mine.deckCount', { count: decks.length })}
            </span>
          )}
        </div>
        {data === undefined ? (
          <Skeleton lines={4} />
        ) : decks.length === 0 ? (
          <p className="rounded-[18px] border border-border bg-surface p-4 text-[0.9375rem] text-fg-muted">
            {t('deckHub.mine.empty')}{' '}
            <Link to={DISCOVER_DECKS_HREF} className="font-medium text-accent-text underline-offset-4 hover:underline">
              {t('deckHub.tabDiscover')}
            </Link>
          </p>
        ) : (
          <>
            {wide.map((d) => (
              <WideDeckCard key={d.deck.id} d={d} />
            ))}
            {grid.length > 0 && (
              <ul className="grid grid-cols-2 gap-3" aria-label={t('deckHub.mine.decks')}>
                {grid.map((d) => (
                  <GridDeckCard key={d.deck.id} d={d} kind={kindOf(d, titles)} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section
        aria-labelledby="mine-new-h"
        className="flex flex-col gap-3 rounded-[20px] border-[1.5px] border-dashed border-border-strong/45 p-4"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fg text-fg-inverse"
          >
            <Icon name="plus" size={20} />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 id="mine-new-h" className="font-serif text-[19px] font-semibold text-fg">
              {t('deckHub.mine.newTitle')}
            </h2>
            <span className="text-[13px] text-fg-muted">{t('deckHub.mine.newBody')}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <NewWay
            title={t('deckHub.mine.byRules')}
            body={t('deckHub.mine.byRulesBody')}
            onClick={() => setEditing(true)}
          />
          <NewWay
            title={t('deckHub.mine.byHand')}
            body={t('deckHub.mine.byHandBody')}
            onClick={() => setManual(true)}
          />
        </div>
      </section>

      <section
        aria-label={t('deckHub.mine.tools')}
        className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-surface"
      >
        {/* Grouping needs a few words to group: hidden for a new user (unless a preview waits). */}
        {(pending || (data?.all.total ?? 0) >= MIN_THEME_WORDS) && (
          <ToolRow
            to="/decks/themes"
            icon={<Glyph name="themes" />}
            accent
            title={t('deckHub.mine.themes')}
            body={
              pending
                ? t('deckHub.mine.themesPending')
                : t('deckHub.mine.themesBody', { count: data?.all.total ?? 0 })
            }
          />
        )}
        <ToolRow
          onClick={() => setTagsOpen(true)}
          icon={<Glyph name="tag" />}
          title={t('deckHub.mine.tags')}
          body={
            data && data.tagCount > 0
              ? t('deckHub.mine.tagsBody', { count: data.tagCount })
              : t('deckHub.mine.tagsNone')
          }
        />
        <ToolRow
          onClick={openImportSheet}
          icon={<Glyph name="download" />}
          title={t('deckHub.mine.importTitle')}
          body={t('deckHub.mine.importBody')}
        />
      </section>

      <DeckEditorDialog
        open={editing}
        onOpenChange={setEditing}
        deck={null}
        onSaved={(d) => void navigate(`/decks/${encodeURIComponent(d.id)}`)}
      />
      <ManualDeckDialog open={manual} onOpenChange={setManual} />
      <TagsDialog open={tagsOpen} onOpenChange={setTagsOpen} />
    </div>
  );
}

/** The three-card stack of the "Tüm kelimelerim" card. */
function StackArt() {
  return (
    <span aria-hidden="true" className="relative h-[72px] w-16 shrink-0">
      <span className="absolute top-0 left-2.5 h-[62px] w-[50px] rotate-[8deg] rounded-[9px] border border-border bg-surface-sunken" />
      <span className="absolute top-1 left-1.5 h-[62px] w-[50px] -rotate-[4deg] rounded-[9px] border border-accent/40 bg-accent-soft" />
      <span className="absolute top-2 left-1 flex h-[62px] w-[50px] items-center justify-center rounded-[9px] border border-border bg-surface font-serif text-[22px] font-semibold text-accent-text">
        Aa
      </span>
    </span>
  );
}

function dueText(t: TFunction, due: number) {
  return due > 0 ? t('deckHub.dueToday', { count: due }) : t('deckHub.dueNone');
}

function WideDeckCard({ d }: { d: MyDeck }) {
  const { t } = useTranslation();
  const mix = d.mix;
  const studied = mix ? mix.total - mix.fresh : 0;
  return (
    <article className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="self-start rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-text">
            {t('deckHub.mine.fromSuggestion')}
          </span>
          <Link
            to={`/decks/${encodeURIComponent(d.deck.id)}`}
            className="font-serif text-[19px] leading-tight font-semibold text-fg hover:underline hover:underline-offset-4"
          >
            {d.deck.name}
          </Link>
        </div>
        {mix && (
          <span className="tabular font-serif text-[22px] font-semibold whitespace-nowrap text-fg">
            {nf.format(mix.learned)}
            <span className="text-[15px] font-normal text-fg-muted"> / {nf.format(mix.total)}</span>
          </span>
        )}
      </div>
      {mix && (
        <ProgressBar2
          total={mix.total}
          first={mix.learned}
          second={mix.studying}
          label={t('deckHub.mine.progress', {
            learned: mix.learned,
            studying: mix.studying,
            fresh: mix.fresh,
          })}
        />
      )}
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-[13px] text-fg-muted">
          {mix ? (
            <>
              {t('deckHub.words', { count: mix.total, formatted: nf.format(mix.total) })} ·{' '}
              <span className={cn(d.dueToday > 0 && 'font-semibold text-fg')}>
                {dueText(t, d.dueToday)}
              </span>
            </>
          ) : (
            t('deckHub.mine.needsUpdate')
          )}
        </span>
        {studied > 0 && (
          <Link
            to={deckStudyHref(d.deck.id)}
            aria-label={t('deckHub.studyLabel', { name: d.deck.name })}
            className="inline-flex h-11 shrink-0 items-center rounded-xl bg-accent px-5 text-[15px] font-semibold text-accent-fg hover:bg-accent-hover"
          >
            {t('deckHub.study')}
          </Link>
        )}
      </div>
    </article>
  );
}

function GridDeckCard({ d, kind }: { d: MyDeck; kind: Kind }) {
  const { t } = useTranslation();
  const warm = kind === 'struggling';
  const mix = d.mix;
  const studied = mix ? mix.total - mix.fresh : 0;
  return (
    <li
      className={cn(
        'flex min-h-44 flex-col gap-2.5 rounded-[18px] border p-3.5',
        warm ? 'border-warn/30 bg-warn-soft' : 'border-border bg-surface',
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 text-xs font-semibold',
          warm ? 'text-warn-text' : 'text-fg-muted',
        )}
      >
        <Glyph name={kind === 'tag' ? 'tag' : 'rules'} size={14} />
        {kind === 'tag' ? t('deckHub.mine.kindTag') : t('deckHub.mine.kindSmart')}
      </span>
      <Link
        to={`/decks/${encodeURIComponent(d.deck.id)}`}
        className="font-serif text-lg leading-tight font-semibold break-words text-fg hover:underline hover:underline-offset-4"
      >
        {d.deck.name}
      </Link>
      <span className={cn('text-[13px]', warm ? 'text-warn-text' : 'text-fg-muted')}>
        {mix
          ? `${t('deckHub.words', { count: mix.total, formatted: nf.format(mix.total) })} · ${dueText(t, d.dueToday)}`
          : t('deckHub.mine.needsUpdate')}
      </span>
      {mix && mix.total > 0 && (
        <ProgressBar2
          total={mix.total}
          first={mix.learned}
          second={mix.studying}
          height={4}
          track={warm ? MARK.trackOnSoft : undefined}
          label={t('deckHub.mine.progress', {
            learned: mix.learned,
            studying: mix.studying,
            fresh: mix.fresh,
          })}
        />
      )}
      {studied > 0 && (
        <Link
          to={deckStudyHref(d.deck.id)}
          aria-label={t('deckHub.studyLabel', { name: d.deck.name })}
          className={cn(
            'mt-auto inline-flex h-11 items-center justify-center rounded-xl text-[15px] font-semibold',
            warm
              ? 'border border-warn/30 bg-surface text-warn-text'
              : d.dueToday > 0
                ? 'bg-accent-soft text-accent-text hover:bg-accent-soft/70'
                : 'bg-surface-sunken text-fg hover:bg-hover',
          )}
        >
          {d.dueToday > 0 || warm ? t('deckHub.study') : t('deckHub.studyAnyway')}
        </Link>
      )}
    </li>
  );
}

function NewWay({ title, body, onClick }: { title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[88px] flex-col gap-1 rounded-[14px] border border-border bg-surface p-3 text-left text-fg hover:border-border-strong"
    >
      <span className="text-[15px] font-semibold">{title}</span>
      <span className="text-[13px] leading-snug text-fg-muted">{body}</span>
    </button>
  );
}

function ToolRow({
  to,
  onClick,
  icon,
  title,
  body,
  accent,
}: {
  to?: string;
  onClick?: () => void;
  icon: ReactNode;
  title: string;
  body: string;
  accent?: boolean;
}) {
  const inner = (
    <>
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl',
          accent ? 'bg-accent-soft text-accent-text' : 'bg-surface-sunken text-fg-muted',
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[13px] text-fg-muted">{body}</span>
      </span>
      <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
    </>
  );
  const cls =
    'flex min-h-16 w-full items-center gap-3.5 border-b border-border px-4 py-3.5 text-left text-fg last:border-b-0 hover:bg-hover';
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/** "Elle seç": a deck on a tag of its own name; words are picked on its page. */
function ManualDeckDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const clean = cleanTag(cleanDeckName(name));
  const create = async () => {
    if (!clean) return;
    setBusy(true);
    try {
      if (await findTagDeck(clean)) {
        setError(t('deckHub.manual.exists'));
        return;
      }
      const deck = await createDeck({ name: clean, filter: { v: 1, tags: [clean] } });
      onOpenChange(false);
      setName('');
      void navigate(`/decks/${encodeURIComponent(deck.id)}?pick=1`);
    } catch (e) {
      void logError(e, 'Decks.manual');
      toast({ title: t('decks.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('deckHub.manual.title')}
      description={t('deckHub.manual.body')}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">{t('common.cancel')}</Button>
          </DialogClose>
          <Button loading={busy} disabled={!clean || busy} onClick={() => void create()}>
            {t('deckHub.manual.create')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('deckHub.manual.name')}
        placeholder={t('deckHub.manual.placeholder')}
        value={name}
        maxLength={MAX_DECK_NAME}
        error={error}
        onChange={(e) => {
          setName(e.target.value);
          setError(undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void create();
        }}
        autoComplete="off"
      />
    </Dialog>
  );
}
