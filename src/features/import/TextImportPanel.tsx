import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CaptureInput } from '@/features/add/capture';
import { CaptureActions } from '@/features/add/CaptureActions';
import { TextArea, TextField } from '@/ui';
import { ActiveJobs } from './JobCard';
import { MAX_IMPORT_CHARS } from './shared';

export interface ImportPanelProps {
  /** Kept for older callers: the privacy note now sits next to "kelimeleri çıkar". */
  hidePrivacyNote?: boolean;
}

/**
 * "Yapıştır" (v0.5.1, decision 0056): paste English text, then the capture's two ways on: open
 * it in the reader (anyone, offline too) or pick out its words (signed in). The text is saved
 * either way.
 */
export function TextImportPanel(_props: ImportPanelProps) {
  return (
    <>
      <TextImportForm />
      <ActiveJobs kind="text" />
    </>
  );
}

const countWords = (s: string) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

function TextImportForm() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX_IMPORT_CHARS;
  const words = useMemo(() => (trimmed ? countWords(trimmed) : 0), [trimmed]);
  const tooLongText = t('importer.paste.tooLong', { max: MAX_IMPORT_CHARS.toLocaleString('tr') });

  /** The capture, or null (with the reason shown) when the text cannot be used. */
  const input = (): CaptureInput | null => {
    if (!/\p{L}{2,}/u.test(trimmed)) {
      setError(t('importer.paste.tooShort'));
      return null;
    }
    if (tooLong) {
      setError(tooLongText);
      return null;
    }
    return { kind: 'paste', title, body: trimmed };
  };

  return (
    <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-5" noValidate>
      <TextArea
        label={t('importer.paste.label')}
        placeholder={t('importer.paste.placeholder')}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        rows={10}
        lang="en"
        spellCheck={false}
        error={error ?? (tooLong ? tooLongText : undefined)}
        hint={
          trimmed
            ? t('importer.paste.words', {
                count: words,
                chars: trimmed.length.toLocaleString('tr'),
              })
            : t('importer.paste.statsEmpty')
        }
        className="min-h-56 font-serif text-[1.0625rem]"
      />
      <TextField
        label={t('importer.paste.titleLabel')}
        optional
        placeholder={t('importer.paste.titlePlaceholder')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
      />
      <CaptureActions input={input} disabled={!trimmed || tooLong} />
    </form>
  );
}
