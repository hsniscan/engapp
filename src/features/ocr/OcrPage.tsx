// /fotograf — "Fotoğraftan metin" (v0.5 İP3, plan criterion 4, docs/decisions/0045-ocr.md).
// Pick a photo (camera or gallery) → it is read on the device (ML Kit in the Android app,
// tesseract.js on the web) → the review screen → "Okuyucuda aç" (a texts row of kind 'ocr',
// opened at readerPath) or "Kelimeleri çıkar" (the existing extraction flow via /share).
//
// Camera and gallery are plain file inputs: in the Android app Capacitor's WebView answers
// `capture` with the system camera (no camera permission is declared, so none is asked) and the
// gallery with the system picker; on the web the browser does the same. No plugin, no upload.
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { logError } from '@/data';
import { saveText } from '@/data/texts';
import { ocrQuality, ocrTitle, toReviewLines, type ReviewLine } from '@/domain/ocr';
import { readerPath } from '@/domain/texts';
import { shareHref } from '@/features/share/route';
import { isNativeApp } from '@/native/platform';
import { Button, EmptyState, Icon, Page, ProgressBar, Spinner, cn, toast } from '@/ui';
import { NotAnImageError, prepareImage } from './image';
import { OcrReview } from './OcrReview';
import { defaultRecognizer } from './recognizer';
import type { PreparedImage, Recognizer } from './types';

type State =
  | { kind: 'pick'; error?: 'notImage' | 'failed' }
  | { kind: 'working'; progress: number | null }
  | { kind: 'review'; lines: ReviewLine[] }
  | { kind: 'empty' };

export interface OcrPageProps {
  /** Injected in tests; the app picks ML Kit or tesseract.js. */
  getRecognizer?: () => Promise<Recognizer>;
  prepare?: (file: Blob) => Promise<PreparedImage>;
  native?: boolean;
}

function coarsePointer(): boolean {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  } catch {
    return false;
  }
}

export function OcrPage({
  getRecognizer = defaultRecognizer,
  prepare = prepareImage,
  native = isNativeApp(),
}: OcrPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'pick' });
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const run = useRef(0);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // On a desktop browser `capture` does nothing: one "choose a photo" button is enough there.
  const showCamera = useMemo(() => native || coarsePointer(), [native]);

  useEffect(
    () => () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [photoUrl],
  );

  const reset = () => {
    run.current++;
    setPhotoUrl(null);
    setState({ kind: 'pick' });
  };

  const read = async (file: File) => {
    const id = ++run.current;
    const live = () => run.current === id;
    setState({ kind: 'working', progress: native ? null : 0 });
    setPhotoUrl(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);
    try {
      const [image, recognizer] = await Promise.all([prepare(file), getRecognizer()]);
      if (!live()) return;
      const result = await recognizer.recognize(image, (p) => {
        if (live()) setState({ kind: 'working', progress: p });
      });
      if (!live()) return;
      const lines = toReviewLines(result);
      setState(ocrQuality(lines).empty ? { kind: 'empty' } : { kind: 'review', lines });
    } catch (e) {
      if (!live()) return;
      if (!(e instanceof NotAnImageError)) void logError(e, 'ocr.recognize');
      setState({ kind: 'pick', error: e instanceof NotAnImageError ? 'notImage' : 'failed' });
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void read(file);
  };

  const openReader = async (text: string) => {
    try {
      const id = await saveText({
        kind: 'ocr',
        title: ocrTitle(text) || t('ocr.title'),
        body: text,
      });
      void navigate(readerPath(id));
    } catch (e) {
      void logError(e, 'ocr.saveText');
      toast({ title: t('ocr.saveFailed'), tone: 'danger' });
    }
  };

  const extract = (text: string) => void navigate(shareHref({ text, title: ocrTitle(text) }));

  const inputs = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFile}
        data-testid="ocr-camera-input"
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFile}
        data-testid="ocr-gallery-input"
      />
    </>
  );

  if (state.kind === 'review')
    return (
      <OcrReview
        initialLines={state.lines}
        photoUrl={photoUrl}
        onOpenReader={openReader}
        onExtract={extract}
        onRetake={reset}
      />
    );

  if (state.kind === 'working')
    return (
      <Page title={t('ocr.title')}>
        <div role="status" className="flex flex-col items-center gap-4 py-12 text-center">
          <Spinner size={24} />
          <p className="text-[0.9375rem] text-fg">
            {native ? t('ocr.working') : t('ocr.workingWeb')}
          </p>
          {state.progress !== null && (
            <ProgressBar
              value={Math.round(state.progress * 100)}
              label={t('ocr.progress')}
              valueText={`%${Math.round(state.progress * 100)}`}
              size="md"
              className="max-w-xs"
            />
          )}
          <Button variant="ghost" onClick={reset}>
            {t('common.cancel')}
          </Button>
        </div>
      </Page>
    );

  if (state.kind === 'empty')
    return (
      <Page title={t('ocr.title')} hideTitle>
        <EmptyState
          icon="image"
          title={t('ocr.emptyTitle')}
          description={t('ocr.emptyBody')}
          action={
            <Button leadingIcon="camera" onClick={reset}>
              {t('ocr.retake')}
            </Button>
          }
        />
      </Page>
    );

  return (
    <Page title={t('ocr.title')} description={t('ocr.lead')}>
      {inputs}
      {state.error && (
        <p role="alert" className="mb-4 text-sm text-danger-text" data-testid="ocr-error">
          {t(state.error === 'notImage' ? 'ocr.notImage' : 'ocr.failed')}
        </p>
      )}
      <div className={cn('mb-5 grid gap-3', showCamera && 'sm:grid-cols-2')}>
        {showCamera && (
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            data-testid="ocr-camera"
            className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-[20px] bg-accent px-4 py-5 text-accent-fg transition-colors duration-(--duration-micro) hover:bg-accent-hover"
          >
            <Icon name="camera" size={30} strokeWidth={1.6} />
            <span className="text-base font-semibold">{t('ocr.camera')}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          data-testid="ocr-gallery"
          className={cn(
            'flex min-h-28 flex-col items-center justify-center gap-2 rounded-[20px] px-4 py-5 transition-colors duration-(--duration-micro)',
            showCamera
              ? 'border border-border bg-surface-raised text-fg hover:bg-hover'
              : 'bg-accent text-accent-fg hover:bg-accent-hover',
          )}
        >
          <Icon name="image" size={30} strokeWidth={1.6} />
          <span className="text-base font-semibold">{t('ocr.gallery')}</span>
        </button>
      </div>
      <ul className="flex flex-col gap-2.5 text-sm text-fg-muted">
        <li className="flex items-start gap-2">
          <Icon name="check" size={18} className="mt-px shrink-0 text-success-text" />
          <span>{native ? t('ocr.privacy') : t('ocr.privacyWeb')}</span>
        </li>
        <li className="flex items-start gap-2">
          <Icon name="info" size={18} className="mt-px shrink-0" />
          <span>{t('ocr.tips')}</span>
        </li>
        {!native && (
          <li className="flex items-start gap-2" data-testid="ocr-web-note">
            <Icon name="info" size={18} className="mt-px shrink-0" />
            <span>{t('ocr.webSlow')}</span>
          </li>
        )}
      </ul>
    </Page>
  );
}
