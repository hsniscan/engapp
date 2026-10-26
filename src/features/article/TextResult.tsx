// A fetched article or a parsed subtitle file, before it is saved: title, source line, the
// first paragraphs, and the two ways on: "Okuyucuda aç" (saved as a reader text) and
// "Kelimeleri çıkar" (the existing extraction preview).
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { logError } from '@/data';
import { readerPath, type TextKind } from '@/domain/texts';
import { useAuth } from '@/features/auth/session';
import { Button, Surface } from '@/ui';
import { saveForReader, startTextExtraction, wordCount } from './useArticle';

export interface TextResultProps {
  kind: Extract<TextKind, 'article' | 'subtitle'>;
  title: string;
  /** "Lena Ortiz · The Riverside Gazette", the file name, ... */
  meta?: string | null;
  paragraphs: string[];
  sourceUrl: string | null;
  notes?: ReactNode;
}

export function TextResult({ kind, title, meta, paragraphs, sourceUrl, notes }: TextResultProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const [busy, setBusy] = useState<'reader' | 'extract' | null>(null);
  const [failed, setFailed] = useState<'reader' | 'extract' | null>(null);
  const body = paragraphs.join('\n\n');

  const openReader = async () => {
    setBusy('reader');
    setFailed(null);
    try {
      const id = await saveForReader({ kind, title, body, sourceUrl });
      void navigate(readerPath(id));
    } catch (e) {
      void logError(e, 'article.save');
      setFailed('reader');
      setBusy(null);
    }
  };

  const extract = async () => {
    setBusy('extract');
    setFailed(null);
    try {
      const jobId = await startTextExtraction(body, title);
      void navigate(`/import/${jobId}`);
    } catch (e) {
      void logError(e, 'article.extract');
      setFailed('extract');
      setBusy(null);
    }
  };

  const signedIn = auth.status === 'signed_in';
  return (
    <div className="flex flex-col gap-5" data-testid="text-result">
      <Surface padding="md" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p
            lang="en"
            className="font-serif text-xl leading-snug font-semibold text-fg"
            data-testid="text-result-title"
          >
            {title}
          </p>
          <p className="text-sm text-fg-muted">
            {[meta, t('article.words', { count: wordCount(paragraphs) })]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div
          lang="en"
          className="flex max-h-56 flex-col gap-2 overflow-hidden font-serif text-[1.0625rem] leading-relaxed text-fg [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
          data-testid="text-result-body"
        >
          {paragraphs.slice(0, 4).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </Surface>
      {notes}
      {failed && (
        <p role="alert" className="text-sm text-danger-text">
          {failed === 'reader' ? t('article.saveFailed') : t('article.extractFailed')}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          size="lg"
          leadingIcon="file"
          loading={busy === 'reader'}
          disabled={busy !== null}
          onClick={() => void openReader()}
          data-testid="text-open-reader"
        >
          {t('article.openReader')}
        </Button>
        {signedIn && (
          <Button
            size="lg"
            variant="secondary"
            leadingIcon="search"
            loading={busy === 'extract'}
            disabled={busy !== null}
            onClick={() => void extract()}
            data-testid="text-extract"
          >
            {t('article.extract')}
          </Button>
        )}
      </div>
      {!signedIn && auth.status !== 'loading' && (
        <p className="text-sm text-fg-muted">{t('article.extractNeedsSignIn')}</p>
      )}
    </div>
  );
}
