// "Okunan metni kontrol et" (docs/decisions/0045-ocr.md): the recognised lines, each a toggle
// (tap to take it out of the text or back in) with a pencil to fix a misread word. Lines the
// engine was unsure of are marked, and the whole photo gets a warning when it read poorly. The
// text that leaves this screen is rebuilt by the pure `rebuildText` (src/domain/ocr.ts).
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isLowConfidence, ocrQuality, rebuildText, type ReviewLine } from '@/domain/ocr';
import { Badge, Button, Icon, IconButton, Page, cn } from '@/ui';
import { countWords } from '@/features/share/route';

/** A printed line is far shorter; the cap only stops a runaway paste. */
const MAX_LINE_CHARS = 500;

export interface OcrReviewProps {
  initialLines: ReviewLine[];
  /** Object URL of the photo, shown on demand to compare against. */
  photoUrl?: string | null;
  onOpenReader: (text: string) => Promise<void> | void;
  /** Absent for guests: word extraction needs an account (the screen says so instead). */
  onExtract?: (text: string) => Promise<void> | void;
  onRetake: () => void;
}

function LineRow({
  line,
  index,
  editing,
  onToggle,
  onEdit,
  onChange,
  onDone,
}: {
  line: ReviewLine;
  index: number;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const low = isLowConfidence(line);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    const key = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        onDone();
      }
    };
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <label htmlFor={inputId} className="sr-only">
          {t('ocr.editLabel')} {index + 1}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          lang="en"
          value={line.text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={key}
          onBlur={onDone}
          autoCapitalize="none"
          spellCheck={false}
          maxLength={MAX_LINE_CHARS}
          className="h-11 min-w-0 flex-1 rounded-control border border-accent bg-surface px-3 font-serif text-[1.0625rem] text-fg"
        />
        <Button
          size="sm"
          variant="secondary"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDone}
        >
          {t('ocr.doneEdit')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-1 pr-1">
      <button
        type="button"
        aria-pressed={line.included}
        onClick={onToggle}
        data-testid="ocr-line"
        className={cn(
          'flex min-h-12 min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left transition-colors duration-(--duration-micro) hover:bg-hover',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px] border',
            line.included
              ? 'border-accent bg-accent text-accent-fg'
              : 'border-border-strong bg-surface',
          )}
        >
          {line.included && <Icon name="check" size={14} strokeWidth={2.6} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            lang="en"
            className={cn(
              'font-serif text-[1.0625rem] leading-snug break-words',
              line.included ? 'text-fg' : 'text-fg-subtle line-through decoration-1',
            )}
          >
            {line.text}
          </span>
          {low && (
            <Badge tone="warn" dot data-testid="ocr-low">
              {t('ocr.lowLine')}
            </Badge>
          )}
        </span>
      </button>
      <IconButton
        icon="pencil"
        label={t('ocr.editLine')}
        size="sm"
        tooltip={false}
        onClick={onEdit}
      />
    </div>
  );
}

export function OcrReview({
  initialLines,
  photoUrl,
  onOpenReader,
  onExtract,
  onRetake,
}: OcrReviewProps) {
  const { t } = useTranslation();
  const [lines, setLines] = useState(initialLines);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const text = useMemo(() => rebuildText(lines), [lines]);
  const quality = useMemo(() => ocrQuality(initialLines), [initialLines]);
  const selected = lines.filter((l) => l.included && l.text.trim()).length;
  const words = text ? countWords(text) : 0;

  const update = (id: string, patch: Partial<ReviewLine>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const setAll = (included: boolean) => setLines((ls) => ls.map((l) => ({ ...l, included })));

  const openReader = async () => {
    if (!text || busy) return;
    setBusy(true);
    try {
      await onOpenReader(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={t('ocr.reviewTitle')} description={t('ocr.reviewLead')}>
      {quality.low && (
        <p
          role="status"
          data-testid="ocr-low-warning"
          className="mb-4 flex items-start gap-2 rounded-control bg-warn-soft px-3 py-2.5 text-sm text-warn-text"
        >
          <Icon name="alert" size={18} className="mt-px shrink-0" />
          <span>{t('ocr.lowWarning')}</span>
        </p>
      )}

      {photoUrl && (
        <details className="group mb-4 rounded-card border border-border bg-surface">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[0.9375rem] font-medium text-accent-text">
            <Icon name="image" size={18} />
            {t('ocr.showPhoto')}
            <Icon
              name="chevron-down"
              size={16}
              className="ml-auto transition-transform group-open:rotate-180"
            />
          </summary>
          <img src={photoUrl} alt={t('ocr.photoAlt')} className="block w-full rounded-b-card" />
        </details>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 pl-1">
        <p className="text-sm text-fg-muted" aria-live="polite" data-testid="ocr-count">
          {t('ocr.selected', { count: selected, total: lines.length })} ·{' '}
          {t('ocr.words', { count: words })}
        </p>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            {t('ocr.selectAll')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAll(false)}>
            {t('ocr.selectNone')}
          </Button>
        </div>
      </div>

      <ul
        aria-label={t('ocr.lines')}
        className="mb-6 flex flex-col overflow-hidden rounded-[20px] border border-border bg-surface-raised"
      >
        {lines.map((l, i) => (
          <li
            key={l.id}
            className={cn(
              i > 0 && 'border-t',
              i > 0 && lines[i - 1]!.block !== l.block ? 'border-border' : 'border-surface-sunken',
            )}
          >
            <LineRow
              line={l}
              index={i}
              editing={editing === l.id}
              onToggle={() => update(l.id, { included: !l.included })}
              onEdit={() => {
                update(l.id, { included: true });
                setEditing(l.id);
              }}
              onChange={(v) => update(l.id, { text: v })}
              onDone={() => setEditing((cur) => (cur === l.id ? null : cur))}
            />
          </li>
        ))}
      </ul>

      <div className="sticky bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-canvas px-4 pt-3 pb-3 sm:-mx-6 sm:flex-row sm:px-6 md:bottom-0">
        {!text && (
          <p role="status" className="text-sm text-fg-muted sm:self-center">
            {t('ocr.nothingSelected')}
          </p>
        )}
        <Button
          size="lg"
          leadingIcon="file"
          disabled={!text}
          loading={busy}
          onClick={() => void openReader()}
          data-testid="ocr-open-reader"
        >
          {t('ocr.openReader')}
        </Button>
        {onExtract ? (
          <Button
            size="lg"
            variant="secondary"
            leadingIcon="search"
            disabled={!text || extracting}
            loading={extracting}
            onClick={() => {
              setExtracting(true);
              void Promise.resolve(onExtract(text)).finally(() => setExtracting(false));
            }}
            data-testid="ocr-extract"
          >
            {t('capture.extract')}
          </Button>
        ) : (
          <p className="text-sm text-fg-muted sm:self-center" data-testid="ocr-extract-signin">
            {t('capture.extractSignIn')}
          </p>
        )}
        <Button size="lg" variant="ghost" leadingIcon="camera" onClick={onRetake}>
          {t('ocr.retake')}
        </Button>
      </div>
    </Page>
  );
}
