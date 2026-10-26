import { useId, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { logError } from '@/data';
import { chunkText } from '@/domain/chunking';
import { CaptureActions } from '@/features/add/CaptureActions';
import { Button, Icon, ProgressBar, Spinner, TextField, cn } from '@/ui';
import { ActiveJobs } from './JobCard';
import { MAX_PDF_BYTES, PdfError, extractPdfText, type PdfErrorCode } from './pdf';
import { MAX_IMPORT_CHARS } from './shared';
import type { ImportPanelProps } from './TextImportPanel';

type PdfState =
  | { phase: 'empty' }
  | { phase: 'reading'; name: string; done: number; total: number }
  | { phase: 'ready'; name: string; pages: number; text: string; chunks: string[] }
  | { phase: 'error'; name: string; code: PdfErrorCode | 'too_long' };

const MB = Math.round(MAX_PDF_BYTES / 1024 / 1024);

/**
 * "PDF" (v0.5.1, decision 0056): pick a PDF, its text is read on this device (a worker), then
 * the capture's two ways on: the reader (anyone) or word extraction (signed in).
 */
export function PdfImportPanel(_props: ImportPanelProps) {
  return (
    <>
      <PdfImportForm />
      <ActiveJobs kind="pdf" />
    </>
  );
}

function PdfImportForm() {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<PdfState>({ phase: 'empty' });
  const [title, setTitle] = useState('');
  const [dragging, setDragging] = useState(false);
  const readId = useRef(0);

  const read = async (file: File) => {
    const id = ++readId.current;
    const name = file.name;
    setTitle(name.replace(/\.pdf$/i, ''));
    if (file.size > MAX_PDF_BYTES) return setState({ phase: 'error', name, code: 'too_big' });
    setState({ phase: 'reading', name, done: 0, total: 0 });
    try {
      const res = await extractPdfText(await file.arrayBuffer(), {
        onProgress: (done, total) => {
          if (id === readId.current) setState({ phase: 'reading', name, done, total });
        },
      });
      if (id !== readId.current) return;
      if (res.text.length > MAX_IMPORT_CHARS)
        return setState({ phase: 'error', name, code: 'too_long' });
      setState({
        phase: 'ready',
        name,
        pages: res.pageCount,
        text: res.text,
        chunks: chunkText(res.text),
      });
    } catch (e) {
      if (id !== readId.current) return;
      const code = e instanceof PdfError ? e.code : 'failed';
      if (code === 'failed') void logError(e, 'import.pdf.read');
      setState({ phase: 'error', name, code });
    }
  };

  const onPick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void read(f);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    onPick(e.dataTransfer.files);
  };

  const errorText = (code: PdfErrorCode | 'too_long') =>
    code === 'no_text'
      ? null
      : code === 'too_big'
        ? t('importer.pdf.tooBig', { mb: MB })
        : code === 'too_long'
          ? t('importer.paste.tooLong', { max: MAX_IMPORT_CHARS.toLocaleString('tr') })
          : code === 'encrypted'
            ? t('importer.pdf.encrypted')
            : code === 'not_pdf'
              ? t('importer.pdf.notPdf')
              : code === 'reader_unavailable'
                ? t('importer.pdf.readerUnavailable')
                : t('importer.pdf.failed');

  const fileInput = (
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      accept="application/pdf,.pdf"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => onPick(e.target.files)}
    />
  );

  if (state.phase === 'empty' || state.phase === 'error') {
    return (
      <div className="flex flex-col gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors duration-(--duration-micro)',
            dragging ? 'border-accent bg-accent-soft/50' : 'border-border-strong/50 bg-surface',
          )}
        >
          <span className="mb-4 flex size-12 items-center justify-center rounded-full border border-border text-fg-muted">
            <Icon name="upload" size={22} />
          </span>
          <p className="hidden font-serif text-lg font-semibold text-fg pointer-fine:block">
            {t('importer.pdf.drop')}
          </p>
          <p className="mt-1 mb-4 hidden text-sm text-fg-muted pointer-fine:block">
            {t('importer.pdf.or')}
          </p>
          {fileInput}
          <Button variant="secondary" leadingIcon="file" onClick={() => inputRef.current?.click()}>
            {t('importer.pdf.pick')}
          </Button>
          <p className="mt-4 max-w-xs text-sm text-fg-muted">
            {t('importer.pdf.hint', { mb: MB })}
          </p>
        </div>
        {state.phase === 'error' &&
          (state.code === 'no_text' ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-control border border-border bg-surface px-4 py-3"
            >
              <Icon name="info" size={20} className="mt-0.5 shrink-0 text-fg-muted" />
              <div className="flex flex-col gap-0.5">
                <p className="font-medium text-fg">{t('importer.pdf.noText')}</p>
                <p className="text-sm text-fg-muted">
                  <span className="font-medium text-fg">{state.name}</span> —{' '}
                  {t('importer.pdf.noTextBody')}
                </p>
              </div>
            </div>
          ) : (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2.5 text-sm text-danger-text"
            >
              <Icon name="alert" size={18} className="mt-px shrink-0" />
              <span>
                <span className="font-semibold">{state.name}:</span> {errorText(state.code)}
              </span>
            </p>
          ))}
      </div>
    );
  }

  if (state.phase === 'reading') {
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-card border border-border bg-surface px-5 py-6"
      >
        <div className="flex items-center gap-3">
          <Spinner size={20} />
          <p className="min-w-0 flex-1 truncate font-medium text-fg">{state.name}</p>
        </div>
        <ProgressBar
          value={state.done}
          max={Math.max(1, state.total)}
          label={t('a11y.progress')}
          valueText={
            state.total
              ? t('importer.pdf.reading', { done: state.done, total: state.total })
              : t('importer.pdf.readingStart')
          }
        />
        <p className="tabular text-sm text-fg-muted">
          {state.total
            ? t('importer.pdf.reading', { done: state.done, total: state.total })
            : t('importer.pdf.readingStart')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-card border border-border bg-surface px-4 py-4 sm:px-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent-text">
          <Icon name="file" size={20} />
        </span>
        <div className="flex min-w-40 flex-1 basis-40 flex-col gap-0.5">
          <p className="truncate font-medium text-fg">{state.name}</p>
          <p className="tabular text-sm text-fg-muted">
            {t('importer.pdf.summary', {
              pages: state.pages,
              chars: state.text.length.toLocaleString('tr'),
              chunks: state.chunks.length,
            })}
          </p>
        </div>
        {fileInput}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => inputRef.current?.click()}
          className="shrink-0 max-sm:ms-10"
        >
          {t('importer.pdf.change')}
        </Button>
      </div>
      <TextField
        label={t('importer.paste.titleLabel')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
      />
      <CaptureActions
        input={() => ({
          kind: 'pdf',
          title: title.trim() || state.name.replace(/\.pdf$/i, ''),
          body: state.text,
          sourceUrl: state.name,
          pageCount: state.pages,
        })}
      />
    </div>
  );
}
