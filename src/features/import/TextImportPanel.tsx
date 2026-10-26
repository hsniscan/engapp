import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createImportJob, logError } from '@/data';
import { chunkText } from '@/domain/chunking';
import { Button, TextArea, TextField, toast } from '@/ui';
import { OpenInReaderButton, ReaderPasteFallback } from '@/features/reader/OpenInReader';
import { ImportGate } from './ImportGate';
import { ActiveJobs } from './JobCard';
import { ImportPrivacyNote } from './PrivacyNote';
import { kickImportQueue } from './queue';
import { firstWords, MAX_IMPORT_CHARS, useImportLevel } from './shared';

export interface ImportPanelProps {
  /** The Add page already shows the privacy note above its tabs. */
  hidePrivacyNote?: boolean;
}

/** "Metin yapıştır": paste English text → chunks → queued AI import. */
export function TextImportPanel({ hidePrivacyNote }: ImportPanelProps) {
  return (
    <>
      {!hidePrivacyNote && <ImportPrivacyNote />}
      <ImportGate>
        <TextImportForm />
      </ImportGate>
      <ReaderPasteFallback />
      <ActiveJobs kind="text" />
    </>
  );
}

function TextImportForm() {
  const { t } = useTranslation();
  const level = useImportLevel();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = text.trim();
  // Chunking is cheap but not free on 300k chars: only recompute when the text changes.
  const chunks = useMemo(() => (trimmed ? chunkText(trimmed) : []), [trimmed]);
  const tooLong = trimmed.length > MAX_IMPORT_CHARS;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/\p{L}{2,}/u.test(trimmed)) return setError(t('importer.paste.tooShort'));
    if (tooLong)
      return setError(t('importer.paste.tooLong', { max: MAX_IMPORT_CHARS.toLocaleString('tr') }));
    setBusy(true);
    try {
      await createImportJob({
        kind: 'text',
        title: title.trim() || firstWords(trimmed) || t('importer.paste.defaultTitle'),
        chunks,
        level,
      });
      kickImportQueue();
      setText('');
      setTitle('');
      setError(null);
    } catch (err) {
      void logError(err, 'import.text.create');
      toast({ title: t('importer.errors.unknown'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" noValidate>
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
        error={
          error ??
          (tooLong
            ? t('importer.paste.tooLong', { max: MAX_IMPORT_CHARS.toLocaleString('tr') })
            : undefined)
        }
        hint={
          trimmed
            ? t('importer.paste.stats', {
                chars: trimmed.length.toLocaleString('tr'),
                chunks: chunks.length,
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-muted">{t('importer.level', { level })}</p>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            type="submit"
            size="lg"
            leadingIcon="search"
            loading={busy}
            disabled={!trimmed || tooLong}
            className="sm:min-w-48"
          >
            {busy ? t('importer.starting') : t('importer.submit')}
          </Button>
          <OpenInReaderButton
            disabled={!trimmed || tooLong}
            input={() => ({ kind: 'paste', title, body: trimmed })}
          />
        </div>
      </div>
    </form>
  );
}
