// A fetched article or a parsed subtitle file, before it is saved: title, source line, the
// first paragraphs, and the capture's two ways on (CaptureActions): "Okuyucuda aç" and
// "Bu metindeki kelimeleri çıkar" (the text is saved first and linked to the extraction).
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TextKind } from '@/domain/texts';
import { CaptureActions } from '@/features/add/CaptureActions';
import { Surface } from '@/ui';
import { wordCount } from './useArticle';

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
  const body = paragraphs.join('\n\n');
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
      <CaptureActions
        input={() => ({ kind, title, body, sourceUrl })}
        readerTestId="text-open-reader"
        extractTestId="text-extract"
      />
    </div>
  );
}
