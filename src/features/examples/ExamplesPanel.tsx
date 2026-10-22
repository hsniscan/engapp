// "Örnek cümleler" (v0.2 İP5): context tabs, one sentence at a time, and the user's
// controls over it (beğen, atla, yenisini üret, düzenle, reddet). Used on the back of a
// card (collapsible) and in the word detail sheet (open). Reads only local data; preparing
// sentences goes through the background queue or an explicit request.
import * as RadixTabs from '@radix-ui/react-tabs';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  getSenseExamples,
  logError,
  MAX_EDIT_CHARS,
  removeExampleEdit,
  saveExampleEdit,
  setExampleVerdict,
  type SenseExamplesView,
} from '@/data';
import { EXAMPLE_CONTEXT_KEYS, type ExampleItem } from '@/domain/examples';
import { findSpan, isValidSpan } from '@/domain/recognition';
import type { Id, Sense } from '@/domain/types';
import { useAuth } from '@/features/auth/session';
import { useOnline } from '@/features/import/shared';
import { usePronunciationBusy } from '@/features/review/pronunciation';
import { flags } from '@/features/settings/platform';
import { Badge, Button, cn, Dialog, DropdownMenu, Icon, IconButton, TextArea, toast } from '@/ui';
import { prioritizeExamples, requestExamples, type ExampleRequestError } from './queue';

export interface ExamplesSpeech {
  available: boolean;
  speak: (text: string) => void;
}

const OPEN_FLAG = 'examples.open';
const CONTEXT_FLAG = 'examples.context';

/** The sentence with the term set apart (mark + weight, not colour alone). */
function Marked({ text, span, term }: { text: string; span: [number, number] | null; term: string }) {
  const at = span && isValidSpan(text, span) ? span : findSpan(text, term);
  if (!at) return <>{text}</>;
  return (
    <>
      {text.slice(0, at[0])}
      <mark className="rounded-[3px] bg-accent-soft px-0.5 font-semibold text-fg not-italic [box-decoration-break:clone]">
        {text.slice(at[0], at[1])}
      </mark>
      {text.slice(at[1])}
    </>
  );
}

/**
 * Collapsible section for the back of a card. Closed by default; the open/closed choice is
 * remembered on this device. Clicks inside never reach the card.
 */
export function CardExamples(props: ExamplesProps) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(() => flags.get(OPEN_FLAG) === '1');
  const toggle = () => {
    setOpen(!open);
    flags.set(OPEN_FLAG, open ? '0' : '1');
  };
  return (
    // The back face is a polite live region: the section opts out so actions in it are not
    // announced as "the whole card changed" (it has its own status line).
    <div aria-live="off" className="w-full max-w-md text-left" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={toggle}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control px-1 text-[0.9375rem] font-medium text-fg-muted transition-colors duration-(--duration-micro) hover:text-fg"
      >
        <span>{t('examples.title')}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} />
      </button>
      {open && (
        <div id={`${id}-body`} className="pt-1">
          <ExamplesBody {...props} />
        </div>
      )}
    </div>
  );
}

export interface ExamplesProps {
  term: string;
  /** The note's live senses; only those linked to the shared lexicon can have sentences. */
  senses: Sense[];
  /** Sense to start with (the card's sense). */
  initialSenseId?: Id | null;
  speech?: ExamplesSpeech;
}

/** Always-open section (word detail sheet). */
export function ExamplesSection(props: ExamplesProps & { headingId?: string }) {
  const { t } = useTranslation();
  const id = useId();
  const headingId = props.headingId ?? `${id}-h`;
  return (
    <section aria-labelledby={headingId} aria-live="off" className="flex flex-col gap-2">
      <h3 id={headingId} className="font-serif text-lg font-semibold text-fg">
        {t('examples.title')}
      </h3>
      <ExamplesBody {...props} />
    </section>
  );
}

type Note = { kind: 'info' | 'warn'; text: string } | null;

function errorText(t: TFunction, e: ExampleRequestError): string {
  switch (e) {
    case 'offline':
      return t('examples.waitingOffline');
    case 'signed_out':
      return t('examples.guest');
    case 'daily_limit':
      return t('examples.dailyLimit');
    case 'busy':
      return t('examples.busy');
    case 'no_lexicon':
      return t('examples.noLexicon');
    default:
      return t('examples.failed');
  }
}

export function ExamplesBody({ term, senses, initialSenseId, speech }: ExamplesProps) {
  const { t } = useTranslation();
  const linked = senses.filter((s) => s.lexicon_sense_id);
  const [senseId, setSenseId] = useState<Id | null>(
    () => (linked.find((s) => s.id === initialSenseId) ?? linked[0])?.id ?? null,
  );
  const sense = linked.find((s) => s.id === senseId) ?? linked[0] ?? null;

  if (!sense) {
    return <StatusLine note={{ kind: 'info', text: t('examples.noLexicon') }} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {linked.length > 1 && (
        <div role="group" aria-label={t('examples.senseLabel')} className="flex flex-wrap gap-1.5">
          {linked.map((s) => {
            const n = senses.indexOf(s) + 1;
            const on = s.id === sense.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => setSenseId(s.id)}
                className={cn(
                  'inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-(--duration-micro)',
                  on
                    ? 'border-accent bg-accent-soft text-accent-text'
                    : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                <span className="tabular font-serif font-semibold">{n}.</span>
                <span className="truncate">{s.meaning_tr_override ?? s.meaning_tr}</span>
              </button>
            );
          })}
        </div>
      )}
      <SenseExamplesPanel key={sense.lexicon_sense_id!} lexiconSenseId={sense.lexicon_sense_id!} senseId={sense.id} term={term} speech={speech} />
    </div>
  );
}

function SenseExamplesPanel({
  lexiconSenseId,
  senseId,
  term,
  speech,
}: {
  lexiconSenseId: Id;
  senseId: Id;
  term: string;
  speech?: ExamplesSpeech;
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const online = useOnline();
  const view = useLiveQuery(() => getSenseExamples(lexiconSenseId), [lexiconSenseId]);
  const signedIn = auth.status === 'signed_in';
  const [context, setContext] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<null | 'fresh' | 'context'>(null);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    if (signedIn) void prioritizeExamples(lexiconSenseId).catch((e: unknown) => logError(e, 'examples.prioritize'));
  }, [lexiconSenseId, signedIn]);

  const active = useMemo(() => (view ? pickContext(view, context) : null), [view, context]);
  if (!view || !active) return <p className="text-sm text-fg-muted">{t('common.loading')}</p>;

  const items = view.examples.byContext.get(active) ?? [];
  const at = Math.min(index, Math.max(0, items.length - 1));
  const item = items[at] ?? null;
  const others = EXAMPLE_CONTEXT_KEYS.filter((c) => !view.examples.contexts.includes(c));

  const choose = (c: string) => {
    setContext(c);
    setIndex(0);
    setNote(null);
    flags.set(CONTEXT_FLAG, c);
  };

  const ask = async (c: string, fresh: boolean) => {
    setBusy(fresh ? 'fresh' : 'context');
    setNote({ kind: 'info', text: t('examples.generating') });
    const res = await requestExamples({ lexiconSenseId, band: view.band, context: c, fresh });
    setBusy(null);
    if (!res.ok) {
      setNote({ kind: 'warn', text: errorText(t, res.error) });
      return;
    }
    if (res.newIds.length === 0) {
      setNote({ kind: 'info', text: t(fresh ? 'examples.noneNew' : 'examples.emptyAsked') });
      return;
    }
    setNote({ kind: 'info', text: t('examples.added') });
    // Show the new sentence (it is sorted with the other unrated ones).
    const fresh1 = await getSenseExamples(lexiconSenseId);
    const list = fresh1.examples.byContext.get(c) ?? [];
    const pos = list.findIndex((x) => res.newIds.includes(x.id));
    if (pos >= 0) setIndex(pos);
  };

  return (
    <RadixTabs.Root value={active} onValueChange={choose} className="flex flex-col gap-3">
      <div className="flex items-end gap-1 border-b border-border">
        <RadixTabs.List
          aria-label={t('examples.contextsLabel')}
          className="-mb-px flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"
        >
          {view.examples.contexts.map((c) => (
            <RadixTabs.Trigger
              key={c}
              value={c}
              className={cn(
                'flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-sm font-medium whitespace-nowrap text-fg-muted',
                'transition-colors duration-(--duration-micro) hover:text-fg data-[state=active]:border-fg data-[state=active]:text-fg',
                'focus-visible:outline-offset-[-2px]',
              )}
            >
              {contextLabel(t, c)}
              <span className="tabular text-xs font-normal text-fg-muted">
                {view.examples.byContext.get(c)?.length ?? 0}
              </span>
            </RadixTabs.Trigger>
          ))}
        </RadixTabs.List>
        {others.length > 0 && (
          <DropdownMenu
            label={t('examples.addContextTitle')}
            trigger={
              <IconButton icon="plus" size="sm" label={t('examples.addContext')} disabled={busy !== null} className="mb-0.5" />
            }
            items={others.map((c) => ({
              label: contextLabel(t, c),
              onSelect: () => {
                choose(c);
                void ask(c, false);
              },
            }))}
          />
        )}
      </div>
      {view.examples.contexts.map((c) => (
        <RadixTabs.Content key={c} value={c} className="flex flex-col gap-3 focus-visible:outline-offset-4">
          {c === active &&
            (item ? (
              <SentenceCard
                key={item.id}
                item={item}
                term={term}
                senseId={senseId}
                position={{ n: at + 1, total: items.length }}
                onMove={(d) => setIndex((at + d + items.length) % items.length)}
                trVisible={view.trVisible}
                speech={speech}
                busy={busy}
                canGenerate={signedIn}
                onRegenerate={() => void ask(c, true)}
              />
            ) : (
              <EmptyContext
                view={view}
                context={c}
                signedIn={signedIn}
                online={online}
                busy={busy !== null}
                onAsk={() => void ask(c, false)}
              />
            ))}
        </RadixTabs.Content>
      ))}
      <StatusLine note={note} />
    </RadixTabs.Root>
  );
}

function contextLabel(t: TFunction, key: string): string {
  // Contexts from a newer client have no label yet: show the key.
  return t(`examples.contexts.${key}` as 'examples.contexts.daily', { defaultValue: key });
}

/** The tab to open: the user's choice, else the last used one with sentences, else the first with sentences. */
function pickContext(view: SenseExamplesView, chosen: string | null): string | null {
  const tabs = view.examples.contexts;
  if (chosen && tabs.includes(chosen)) return chosen;
  const has = (c: string) => (view.examples.byContext.get(c)?.length ?? 0) > 0;
  const last = flags.get(CONTEXT_FLAG);
  if (last && tabs.includes(last) && has(last)) return last;
  return tabs.find(has) ?? tabs[0] ?? null;
}

function EmptyContext({
  view,
  context,
  signedIn,
  online,
  busy,
  onAsk,
}: {
  view: SenseExamplesView;
  context: string;
  signedIn: boolean;
  online: boolean;
  busy: boolean;
  onAsk: () => void;
}) {
  const { t } = useTranslation();
  const job = view.job;
  const asked = job?.status === 'done' && job.contexts.includes(context);
  let text: string;
  let action: ReactNode = null;
  if (!signedIn) text = t('examples.guest');
  else if (!online) text = t('examples.waitingOffline');
  else if (job?.status === 'queued' && job.contexts.includes(context)) {
    text = job.error === 'daily_limit' ? t('examples.dailyLimit') : t('examples.preparing');
  } else if (asked || job?.status === 'failed') {
    text = asked ? t('examples.emptyAsked') : t('examples.failed');
    action = (
      <Button size="sm" variant="secondary" leadingIcon="refresh" onClick={onAsk} loading={busy}>
        {t('common.retry')}
      </Button>
    );
  } else {
    text = t('examples.empty');
    action = (
      <Button size="sm" variant="secondary" leadingIcon="refresh" onClick={onAsk} loading={busy}>
        {t('examples.regenerate')}
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2 rounded-control bg-surface-sunken px-3 py-3">
      <p className="text-sm text-fg-muted">{text}</p>
      {action}
    </div>
  );
}

function StatusLine({ note }: { note: Note }) {
  return (
    <p role="status" className={cn('text-sm empty:hidden', note?.kind === 'warn' ? 'text-warn-text' : 'text-fg-muted')}>
      {note?.text ?? ''}
    </p>
  );
}

function SentenceCard({
  item,
  term,
  senseId,
  position,
  onMove,
  trVisible,
  speech,
  busy,
  canGenerate,
  onRegenerate,
}: {
  item: ExampleItem;
  term: string;
  senseId: Id;
  position: { n: number; total: number };
  onMove: (delta: number) => void;
  trVisible: boolean;
  speech?: ExamplesSpeech;
  busy: null | 'fresh' | 'context';
  canGenerate: boolean;
  onRegenerate: () => void;
}) {
  const { t } = useTranslation();
  const speaking = usePronunciationBusy();
  const [showTr, setShowTr] = useState(trVisible);
  const [editing, setEditing] = useState(false);
  const liked = item.verdict === 'like';
  const skipped = item.verdict === 'skip';

  const verdict = (v: 'like' | 'skip' | null) =>
    setExampleVerdict(item.id, v).catch((e: unknown) => {
      void logError(e, 'examples.verdict');
      toast({ title: t('examples.saveFailed'), tone: 'danger' });
    });

  const reject = async () => {
    try {
      await setExampleVerdict(item.id, 'reject');
      toast({
        title: t('examples.rejected'),
        action: { label: t('common.undo'), onClick: () => void verdict(null) },
      });
    } catch (e) {
      void logError(e, 'examples.reject');
      toast({ title: t('examples.saveFailed'), tone: 'danger' });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-1">
        <p lang="en" className="min-w-0 flex-1 font-serif text-[1.0625rem] leading-relaxed text-fg italic">
          <Marked text={item.text} span={item.span} term={term} />
        </p>
        {speech && (
          <IconButton
            icon="speaker"
            size="sm"
            label={speech.available ? t('examples.speak') : t('review.noVoice')}
            aria-disabled={!speech.available || undefined}
            aria-busy={speaking.busy || undefined}
            className={cn('shrink-0', !speech.available && 'opacity-45', speaking.busy && 'animate-pulse')}
            onClick={() => speech.available && speaking.run(() => speech.speak(item.text))}
          />
        )}
      </div>

      {(item.editId || skipped) && (
        <div className="flex flex-wrap gap-1.5">
          {item.editId && <Badge tone="neutral">{t('examples.edited')}</Badge>}
          {skipped && <Badge tone="neutral">{t('examples.skipped')}</Badge>}
        </div>
      )}

      {item.tr || item.editId ? (
        showTr ? (
          <p lang="tr" className="text-[0.9375rem] leading-relaxed text-fg-muted">
            {item.tr ?? t('examples.noTr')}
            {!trVisible && (
              <>
                {' '}
                <button type="button" className="text-sm font-medium text-accent-text underline-offset-2 hover:underline" onClick={() => setShowTr(false)}>
                  {t('examples.hideTr')}
                </button>
              </>
            )}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setShowTr(true)}
            className="self-start text-sm font-medium text-accent-text underline-offset-2 hover:underline"
          >
            {t('examples.showTr')}
          </button>
        )
      ) : null}

      <div className="flex flex-wrap items-center gap-1 pt-1">
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={liked}
          onClick={() => void verdict(liked ? null : 'like')}
          className={cn('px-2.5', liked && 'bg-accent-soft text-accent-text')}
        >
          <Icon name="heart" size={16} fill={liked ? 'currentColor' : 'none'} />
          {liked ? t('examples.liked') : t('examples.like')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={skipped}
          title={t('examples.skipHint')}
          // A skipped sentence moves to the end of the list, so the next one takes its place.
          onClick={() => void verdict(skipped ? null : 'skip')}
          className={cn('px-2.5', skipped && 'bg-hover')}
        >
          <Icon name="arrow-right" size={16} />
          {t('examples.skip')}
        </Button>
        {canGenerate && (
          <Button size="sm" variant="ghost" leadingIcon="refresh" loading={busy === 'fresh'} disabled={busy !== null} onClick={onRegenerate} className="px-2.5">
            {t('examples.regenerate')}
          </Button>
        )}
        <span className="flex-1" />
        <DropdownMenu
          label={t('examples.actions')}
          trigger={<IconButton icon="more" size="sm" label={t('examples.actions')} />}
          items={[
            { label: t('examples.edit'), icon: 'pencil', onSelect: () => setEditing(true) },
            ...(item.editId
              ? [{ label: t('examples.undoEdit'), icon: 'undo' as const, onSelect: () => void removeExampleEdit(item.id) }]
              : []),
            { kind: 'separator' as const },
            { label: t('examples.reject'), icon: 'x' as const, danger: true, onSelect: () => void reject() },
          ]}
        />
      </div>

      {position.total > 1 && (
        <div className="flex items-center justify-center gap-1">
          <IconButton icon="chevron-left" size="sm" label={t('examples.previous')} onClick={() => onMove(-1)} />
          <span className="tabular min-w-12 text-center text-sm text-fg-muted">
            {t('examples.position', { n: position.n, total: position.total })}
          </span>
          <IconButton icon="chevron-right" size="sm" label={t('examples.next')} onClick={() => onMove(1)} />
        </div>
      )}

      <EditDialog open={editing} onOpenChange={setEditing} item={item} term={term} senseId={senseId} />
    </div>
  );
}

function EditDialog({
  open,
  onOpenChange,
  item,
  term,
  senseId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: ExampleItem;
  term: string;
  senseId: Id;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(item.text);
  const [saving, setSaving] = useState(false);
  const [seen, setSeen] = useState(open);
  if (open !== seen) {
    setSeen(open);
    if (open) setText(item.text);
  }
  const clean = text.replace(/\s+/g, ' ').trim();
  const error = !clean
    ? t('examples.emptyText')
    : clean.length > MAX_EDIT_CHARS
      ? t('examples.tooLong', { max: MAX_EDIT_CHARS })
      : undefined;
  const surface = item.span ? item.text.slice(item.span[0], item.span[1]) : term;
  const located = clean ? (findSpan(clean, surface) ?? findSpan(clean, term)) : null;

  const save = async () => {
    if (error) return;
    setSaving(true);
    try {
      await saveExampleEdit(item.id, clean, { senseId });
      toast({ title: t('examples.saved'), tone: 'success' });
      onOpenChange(false);
    } catch (e) {
      void logError(e, 'examples.edit');
      toast({ title: t('examples.saveFailed'), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('examples.editTitle')}
      description={t('examples.editHint')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!!error}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
        <TextArea
          label={t('examples.editLabel')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          lang="en"
          maxLength={MAX_EDIT_CHARS + 50}
          className="min-h-20 font-serif"
          error={clean ? error : undefined}
        />
        {clean && !located && (
          <p className="flex items-start gap-1.5 text-sm text-warn-text">
            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
            <span>{t('examples.termMissing', { term })}</span>
          </p>
        )}
        {item.editId && (
          <p className="text-sm text-fg-muted">
            {t('examples.original')}:{' '}
            <span lang="en" className="font-serif italic">
              {item.original}
            </span>
          </p>
        )}
      </div>
    </Dialog>
  );
}
