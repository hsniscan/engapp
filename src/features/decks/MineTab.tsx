// Kelimelerim › Destelerim (docs/design.md §4.5): the "Tüm kelimelerim" card with the five-stage
// bar, the user's decks with today's load, a new deck (by rules or by hand) and the organising
// tools (suggested decks in Keşfet, AI themes, tags, import). Search is the header's icon.
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { createDeck, getThemePreview, logError } from '@/data';
import { findTagDeck, getMyDecks, type MyDeck } from '@/data/deckHub';
import { cleanDeckName, MAX_DECK_NAME } from '@/domain/deckFilter';
import { cleanTag } from '@/domain/tags';
import {
  Badge,
  Button,
  Card,
  cn,
  Dialog,
  DialogClose,
  DropdownMenu,
  EmptyState,
  Eyebrow,
  Icon,
  ListGroup,
  ListRow,
  SectionHeader,
  Skeleton,
  StageBar,
  TextField,
  toast,
} from '@/ui';
import { useLevelData } from '@/features/levels/useLevelData';
import { useNow } from '@/features/settings/useNow';
import { useTodayStudy } from '@/features/review/studyModes';
import { DeckEditorDialog } from './DeckEditorDialog';
import { MIN_THEME_WORDS } from '@/domain/themes';
import { DISCOVER_DECKS_HREF, nf, openImportSheet } from './deckUi';
import { DeckInitial } from './parts';
import { titleIndex } from './suggested';
import { TagsDialog } from './TagsDialog';

type Kind = 'suggested' | 'struggling' | 'tag' | 'smart';

function kindOf(d: MyDeck, titles: Map<string, unknown>): Kind {
  const f = d.filter;
  if (!f) return 'smart';
  const tagOnly =
    f.tags?.length === 1 &&
    !f.states?.length &&
    !f.stages?.length &&
    !f.levels?.length &&
    !f.topics?.length &&
    !f.addedWithinDays;
  if (tagOnly && titles.has(f.tags![0]!.toLocaleLowerCase('tr'))) return 'suggested';
  if (f.states?.includes('struggling')) return 'struggling';
  return tagOnly ? 'tag' : 'smart';
}

export function MineTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const levelData = useLevelData();
  // "bugün N kart" rolls over at the day boundary: count again every hour, not only on writes.
  const hour = Math.floor(useNow() / 3_600_000);
  const data = useLiveQuery(() => getMyDecks(), [levelData, hour]);
  const pending = useLiveQuery(async () => !!(await getThemePreview()), []);
  // Today's count is Bugün's own (v0.5.3 A7): new cards and every mode included, so the two
  // screens never disagree ("51 kart" there, "11 kart" here).
  const study = useTodayStudy();
  const todayLeft = study?.left;
  const titles = useMemo(() => titleIndex(t), [t]);
  const [editing, setEditing] = useState(false);
  const [manual, setManual] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  const decks = data?.decks ?? [];

  return (
    <div className="flex flex-col gap-8">
      <Card as={Link} to="/library" interactive padding="lg" className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Eyebrow as="h2">{t('deckHub.mine.all')}</Eyebrow>
            <p className="tabular flex items-baseline gap-2 text-numeral font-semibold text-fg">
              {data ? nf.format(data.all.total) : '–'}
              <span className="text-ui font-medium tracking-normal text-fg-muted">
                {t('deckHub.mine.allUnit')}
              </span>
            </p>
            {data && todayLeft !== undefined && (
              <p
                data-testid="mine-all-today"
                className={cn(
                  'text-meta',
                  todayLeft > 0 ? 'font-semibold text-accent-text' : 'text-fg-muted',
                )}
              >
                {todayLeft > 0
                  ? t('deckHub.mine.allDue', { count: todayLeft })
                  : t('deckHub.mine.allDueNone')}
              </p>
            )}
          </div>
          <Icon name="chevron-right" size={20} className="mb-2 shrink-0 text-fg-subtle" />
        </div>
        {data && data.all.total > 0 && <StageBar counts={data.all.byStage} />}
      </Card>

      <section aria-labelledby="mine-decks-h" className="flex flex-col">
        <SectionHeader
          id="mine-decks-h"
          title={t('deckHub.mine.decks')}
          description={
            data && decks.length > 0
              ? t('deckHub.mine.deckCount', { count: decks.length })
              : undefined
          }
          action={
            <DropdownMenu
              label={t('deckHub.mine.newTitle')}
              trigger={
                <Button variant="ghost" size="sm" leadingIcon="plus">
                  {t('deckHub.mine.newTitle')}
                </Button>
              }
              items={[
                {
                  label: t('deckHub.mine.byRules'),
                  icon: 'filter',
                  onSelect: () => setEditing(true),
                },
                { label: t('deckHub.mine.byHand'), icon: 'check', onSelect: () => setManual(true) },
              ]}
            />
          }
        />
        {data === undefined ? (
          <div aria-busy="true">
            <Skeleton lines={4} />
          </div>
        ) : decks.length === 0 ? (
          <EmptyState
            tone="placeholder"
            compact
            icon="layers"
            title={t('deckHub.mine.emptyTitle')}
            description={t('deckHub.mine.empty')}
            action={
              <Button variant="secondary" leadingIcon="plus" onClick={() => setEditing(true)}>
                {t('deckHub.mine.byRules')}
              </Button>
            }
          />
        ) : (
          <ListGroup aria-label={t('deckHub.mine.decks')}>
            {decks.map((d) => (
              <DeckRow key={d.deck.id} d={d} kind={kindOf(d, titles)} />
            ))}
          </ListGroup>
        )}
      </section>

      <ListGroup label={t('deckHub.mine.tools')}>
        <ListRow
          to={DISCOVER_DECKS_HREF}
          leadingIcon="compass"
          leadingTone="accent"
          title={t('deckHub.mine.browse')}
          description={t('deckHub.mine.browseBody')}
        />
        {/* Grouping needs a few words to group: hidden for a new user (unless a preview waits). */}
        {(pending || (data?.all.total ?? 0) >= MIN_THEME_WORDS) && (
          <ListRow
            to="/decks/themes"
            leadingIcon="layers"
            title={t('deckHub.mine.themes')}
            description={
              pending
                ? t('deckHub.mine.themesPending')
                : t('deckHub.mine.themesBody', { count: data?.all.total ?? 0 })
            }
          />
        )}
        <ListRow
          onClick={() => setTagsOpen(true)}
          leadingIcon="tag"
          title={t('deckHub.mine.tags')}
          description={
            data && data.tagCount > 0
              ? t('deckHub.mine.tagsBody', { count: data.tagCount })
              : t('deckHub.mine.tagsNone')
          }
        />
        <ListRow
          onClick={openImportSheet}
          leadingIcon="upload"
          title={t('deckHub.mine.importTitle')}
          description={t('deckHub.mine.importBody')}
        />
      </ListGroup>

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

/** One deck: its initial, name, size and kind; today's load as a badge; the row opens it. */
function DeckRow({ d, kind }: { d: MyDeck; kind: Kind }) {
  const { t } = useTranslation();
  const mix = d.mix;
  const kindLabel =
    kind === 'suggested'
      ? t('deckHub.mine.fromSuggestion')
      : kind === 'tag'
        ? t('deckHub.mine.kindTag')
        : t('deckHub.mine.kindSmart');
  return (
    <ListRow
      to={`/decks/${encodeURIComponent(d.deck.id)}`}
      leading={<DeckInitial name={d.deck.name} />}
      title={d.deck.name}
      description={
        mix
          ? `${t('deckHub.words', { count: mix.total, formatted: nf.format(mix.total) })} · ${kindLabel}`
          : t('deckHub.mine.needsUpdate')
      }
      trailing={
        <span className="flex shrink-0 items-center gap-2">
          {d.dueToday > 0 && (
            <Badge tone={kind === 'struggling' ? 'warn' : 'accent'}>
              {t('deckHub.mine.dueBadge', { count: d.dueToday })}
            </Badge>
          )}
          <Icon name="chevron-right" size={18} className="text-fg-subtle" />
        </span>
      }
    />
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
    // Enter and the button share this guard: one deck per name, never two (B10).
    if (!clean || busy) return;
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
