// The quick sheet (v0.5 İP4, docs/decisions/0046-quick-capture.md): the only thing on screen
// when "Engapp" is tapped in another app's selection menu. On Android the calling app stays
// visible behind the scrim; on the web it sits on the plain canvas. Presentational: QuickPage
// supplies the data and the actions.
import * as RadixDialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import type { QuickAddResult, QuickMine, QuickPreview, QuickSense } from '@/data/quick';
import { posLabel } from '@/features/cards/labels';
import { CardPicture } from '@/features/images/CardPicture';
import { SignInNeeded } from '@/features/add/SignInNeeded';
import { ChoiceButton, Notice } from '@/features/add/ui';
import { Badge, Button, cn, Eyebrow, Icon, IconButton, Skeleton } from '@/ui';
import type { QuickRoute } from './route';

export type LookupState = 'idle' | 'searching' | 'offline' | 'signin' | 'notfound' | 'failed';

export interface QuickSheetProps {
  /** null: the selection has not arrived yet (Android cold start). */
  route: QuickRoute | null;
  /** The spelling the user selected (term routes). */
  selected?: string;
  /** undefined while the device lookup runs. */
  preview?: QuickPreview;
  lookup?: LookupState;
  picked?: ReadonlySet<string>;
  onToggleSense?: (key: string) => void;
  onAdd?: () => void;
  saving?: boolean;
  saved?: QuickAddResult | null;
  canSpeak?: boolean;
  onSpeak?: () => void;
  onWriteOwn?: () => void;
  onOpenReader?: () => void;
  onExtract?: () => void;
  onOpenLink?: () => void;
  /** Which hand-over is under way (its button shows a spinner). */
  busy?: 'reader' | 'extract' | 'link' | 'write' | null;
  error?: string | null;
  onClose: () => void;
}

export function QuickSheet(props: QuickSheetProps) {
  const { t } = useTranslation();
  const { route, onClose } = props;
  return (
    <RadixDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          data-testid="quick-scrim"
          className="fixed inset-0 z-40 bg-scrim data-[state=open]:animate-fade-in"
        />
        <RadixDialog.Content
          data-testid="quick-sheet"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-xl flex-col',
            'rounded-t-sheet border-t border-border bg-surface-raised text-fg shadow-overlay sm:border-x',
            'pb-[max(1.25rem,env(safe-area-inset-bottom))] data-[state=open]:animate-sheet-in',
            'focus-visible:outline-none',
          )}
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-3 mb-1 h-1 w-10 shrink-0 rounded-full bg-border-strong/40"
          />
          <div className="flex items-center justify-between gap-3 px-5 pt-1">
            <Eyebrow as="span">Engapp</Eyebrow>
            <RadixDialog.Close asChild>
              <IconButton icon="x" label={t('quick.close')} tooltip={false} className="-mr-2" />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 pt-1 pb-1">
            {route === null ? (
              <Waiting />
            ) : route.kind === 'term' ? (
              <TermBody {...props} term={route.term} />
            ) : route.kind === 'text' ? (
              <TextBody {...props} text={route.text} words={route.words} />
            ) : route.kind === 'link' ? (
              <LinkBody {...props} url={route.url} />
            ) : (
              <Empty />
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function Waiting() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-3 pt-2 pb-4">
      <RadixDialog.Title className="sr-only">{t('quick.title')}</RadixDialog.Title>
      <p role="status" className="sr-only">
        {t('quick.waiting')}
      </p>
      <Skeleton className="h-8 w-2/5" />
      <Skeleton lines={2} />
    </div>
  );
}

function Empty() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 pt-2 pb-4">
      <RadixDialog.Title className="text-title font-semibold text-fg">
        {t('quick.emptyTitle')}
      </RadixDialog.Title>
      <p className="text-ui text-fg-muted">{t('quick.emptyBody')}</p>
    </div>
  );
}

function TermBody({
  term,
  preview,
  lookup = 'idle',
  picked,
  onToggleSense,
  onAdd,
  saving,
  saved,
  canSpeak,
  onSpeak,
  onWriteOwn,
  busy,
  error,
}: QuickSheetProps & { term: string }) {
  const { t } = useTranslation();
  const shown = preview?.term ?? term;
  const differs = preview?.matched && preview.term.toLowerCase() !== term.toLowerCase();

  if (saved) {
    const nothing = saved.added === 0;
    return (
      <div role="status" data-testid="quick-saved" className="flex items-center gap-3.5 pt-3 pb-5">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-full',
            nothing ? 'bg-surface-sunken text-fg-muted' : 'bg-accent-soft text-accent-text',
          )}
        >
          <Icon name={nothing ? 'info' : 'check'} size={24} strokeWidth={2.2} />
        </span>
        <span className="flex min-w-0 flex-col">
          <RadixDialog.Title className="text-lead font-semibold text-fg">
            {nothing
              ? t('quick.nothingNew', { term: saved.term })
              : t('quick.saved', { term: saved.term })}
          </RadixDialog.Title>
          {!nothing && (
            <span className="text-meta text-fg-muted">
              {t('quick.savedCards', { count: saved.cards })}
            </span>
          )}
        </span>
      </div>
    );
  }

  const senses = preview?.senses ?? [];
  const mine = preview?.mine ?? [];
  const loading = preview === undefined || (senses.length === 0 && lookup === 'searching');

  return (
    <div className="flex flex-col gap-4 pt-1 pb-1">
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <RadixDialog.Title
              lang="en"
              data-testid="quick-term"
              className="min-w-0 font-serif text-page font-semibold break-words text-fg"
            >
              {shown}
            </RadixDialog.Title>
            {canSpeak && onSpeak && (
              <IconButton
                icon="speaker"
                label={t('quick.listen', { term: shown })}
                tooltip={false}
                onClick={onSpeak}
                className="shrink-0 text-accent-text"
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-fg-muted">
            {preview?.ipa && (
              <span lang="en" className="font-serif">
                /{preview.ipa.replace(/^\/|\/$/g, '')}/
              </span>
            )}
            {preview?.cefr && <Badge tone="outline">{preview.cefr}</Badge>}
            {differs && <span lang="en">{t('quick.selected', { selected: term })}</span>}
            {preview?.owned && (
              <Badge tone={preview.owned === 'carded' ? 'accent' : 'neutral'} dot>
                {t(`quick.owned.${preview.owned}`)}
              </Badge>
            )}
          </div>
        </div>
        {preview?.picture && (
          <CardPicture
            image={preview.picture}
            showNew={false}
            className="size-22 overflow-hidden rounded-inner bg-surface-sunken"
          />
        )}
      </div>

      {mine.length > 0 && <MineMeanings mine={mine} />}

      {loading ? (
        <div aria-busy="true" className="flex flex-col gap-2.5">
          {lookup === 'searching' && (
            <p role="status" className="sr-only">
              {t('quick.searching')}
            </p>
          )}
          <Skeleton className="h-14 w-full rounded-inner" />
          <Skeleton className="h-14 w-full rounded-inner" />
        </div>
      ) : senses.length > 0 ? (
        <SenseChoices senses={senses} picked={picked} onToggle={onToggleSense} />
      ) : mine.length > 0 ? null : lookup === 'signin' ? (
        // A guest gets the Google button right here, not only a sentence (B4).
        <SignInNeeded title={t('quick.signIn')} testId="quick-signin" />
      ) : (
        <Notice tone={lookup === 'failed' ? 'danger' : 'muted'}>
          {t(
            lookup === 'offline'
              ? 'quick.offline'
              : lookup === 'failed'
                ? 'quick.failed'
                : 'quick.notFound',
          )}
        </Notice>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      {senses.length > 0 ? (
        <Button
          size="lg"
          fullWidth
          leadingIcon="plus"
          loading={saving}
          disabled={loading || !picked?.size}
          onClick={onAdd}
          data-testid="quick-add"
        >
          {t('quick.add')}
        </Button>
      ) : (
        !loading &&
        mine.length === 0 &&
        onWriteOwn && (
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            leadingIcon="pencil"
            loading={busy === 'write'}
            onClick={onWriteOwn}
          >
            {t('quick.writeOwn')}
          </Button>
        )
      )}
    </div>
  );
}

/** The meanings on the user's own card (v0.5.1): a carded word always shows what it means. */
export function MineMeanings({ mine }: { mine: readonly QuickMine[] }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('quick.mine')}
      className="flex flex-col gap-1 rounded-inner bg-accent-soft px-4 py-3"
      data-testid="quick-mine"
    >
      <span className="text-meta font-semibold text-accent-text">{t('quick.mine')}</span>
      <ul className="flex flex-col gap-0.5">
        {mine.map((m, i) => (
          <li key={i} className="text-lead font-medium text-fg">
            {m.meaning_tr}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The meanings to put on the card, each a toggle; the first is on by default. */
export function SenseChoices({
  senses,
  picked,
  onToggle,
}: {
  senses: readonly QuickSense[];
  picked?: ReadonlySet<string>;
  onToggle?: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('quick.meanings')} className="flex flex-col gap-2">
      {senses.length > 1 && <p className="text-meta text-fg-muted">{t('quick.pickHint')}</p>}
      <ul className="flex flex-col gap-2">
        {senses.map((s) => {
          const on = picked?.has(s.key) ?? false;
          return (
            <li key={s.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle?.(s.key)}
                data-testid="quick-sense"
                className={cn(
                  'flex min-h-14 w-full items-start gap-3 rounded-inner border px-4 py-3 text-left',
                  'transition-colors duration-(--duration-micro)',
                  on
                    ? 'border-accent bg-accent-soft'
                    : 'border-border bg-surface hover:border-border-strong/60 hover:bg-surface-hover',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                    on ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong',
                  )}
                >
                  {on && <Icon name="check" size={14} strokeWidth={2.4} />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-lead font-medium text-fg">{s.meaning_tr}</span>
                  {(s.pos || s.gloss_en) && (
                    <span className="text-meta text-fg-muted">
                      {s.pos && posLabel(t, s.pos)}
                      {s.pos && s.gloss_en && ' · '}
                      {s.gloss_en && <span lang="en">{s.gloss_en}</span>}
                    </span>
                  )}
                  {s.example_en && (
                    <span lang="en" className="font-serif text-meta text-fg-muted italic">
                      {s.example_en}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TextBody({
  text,
  words,
  onOpenReader,
  onExtract,
  busy,
  error,
}: QuickSheetProps & { text: string; words: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 pt-1 pb-1">
      <div className="flex flex-col gap-1">
        <RadixDialog.Title className="text-title font-semibold text-fg">
          {t('quick.textTitle')}
        </RadixDialog.Title>
        <span className="text-meta text-fg-muted">{t('quick.textWords', { count: words })}</span>
      </div>
      <blockquote
        lang="en"
        data-testid="quick-text"
        className="line-clamp-5 border-l-2 border-accent pl-4 font-serif text-lead whitespace-pre-line text-fg"
      >
        {text}
      </blockquote>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex flex-col gap-3">
        <ChoiceButton
          primary
          icon="file"
          title={t('quick.openReader')}
          hint={t('quick.openReaderHint')}
          loading={busy === 'reader'}
          disabled={!!busy}
          onClick={onOpenReader}
          testId="quick-reader"
        />
        <ChoiceButton
          icon="search"
          title={t('quick.extract')}
          hint={t('quick.extractHint')}
          loading={busy === 'extract'}
          disabled={!!busy}
          onClick={onExtract}
          testId="quick-extract"
        />
      </div>
    </div>
  );
}

function LinkBody({ url, onOpenLink, busy, error }: QuickSheetProps & { url: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 pt-1 pb-1">
      <RadixDialog.Title className="text-title font-semibold text-fg">
        {t('quick.linkTitle')}
      </RadixDialog.Title>
      <p className="text-meta break-all text-fg-muted" data-testid="quick-url">
        {url}
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button size="lg" fullWidth loading={busy === 'link'} onClick={onOpenLink}>
        {t('quick.openLink')}
      </Button>
    </div>
  );
}
