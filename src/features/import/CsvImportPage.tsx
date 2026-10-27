// /import/csv — "CSV ya da kelime listesi" (v0.5.1, decision 0056): a .csv / .tsv / .txt file,
// or a list typed or pasted ("give up - vazgeçmek"), one word and its meaning per line, with an
// optional example sentence. The rows are checked on screen, then become the user's own cards
// on this device. No account, no AI.
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { logError } from '@/data';
import { importWordList, type WordListResult } from '@/data/wordList';
import { MAX_LIST_ROWS, parseWordList } from '@/domain/wordList';
import { locateTerm } from '@/features/cards/locateTerm';
import { Button, Icon, Page, ProgressBar, Surface, TextArea, buttonClasses, toast } from '@/ui';

/** Larger files are not word lists. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SHOWN = 8;

export function CsvImportPage() {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [result, setResult] = useState<WordListResult | null>(null);

  const parsed = useMemo(() => parseWordList(text), [text]);
  const rows = parsed.rows;

  const pick = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setFileError(null);
    setResult(null);
    if (file.size > MAX_FILE_BYTES) {
      setFileError(t('wordList.tooBig'));
      return;
    }
    try {
      setText(await file.text());
      setFileName(file.name);
    } catch (e) {
      void logError(e, 'wordList.read');
      setFileError(t('wordList.readFailed'));
    }
  };

  const run = async () => {
    setBusy(0);
    try {
      const withSpans = rows.map((r) => ({
        ...r,
        span: r.sentence ? locateTerm(r.sentence, r.term) : null,
      }));
      const res = await importWordList(withSpans, (n) => setBusy(n));
      setResult(res);
      setText('');
      setFileName(null);
    } catch (e) {
      void logError(e, 'wordList.import');
      toast({ title: t('wordList.failed'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  if (result)
    return (
      <Page title={t('wordList.title')}>
        <Surface
          padding="md"
          className="flex flex-col gap-3"
          role="status"
          data-testid="word-list-done"
        >
          <p className="flex items-center gap-2 font-serif text-xl font-semibold text-fg">
            <Icon name="check" size={22} className="text-success-text" />
            {t('wordList.done', { count: result.created })}
          </p>
          <ul className="flex flex-col gap-1 text-sm text-fg-muted">
            {result.addedSenses > 0 && (
              <li>{t('wordList.addedSenses', { count: result.addedSenses })}</li>
            )}
            {result.unchanged > 0 && (
              <li>{t('wordList.unchanged', { count: result.unchanged })}</li>
            )}
            {result.failed > 0 && <li>{t('wordList.failedRows', { count: result.failed })}</li>}
          </ul>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <Link to="/library" className={buttonClasses({})}>
              {t('wordList.toWords')}
            </Link>
            <Button variant="ghost" onClick={() => setResult(null)}>
              {t('wordList.again')}
            </Button>
          </div>
        </Surface>
      </Page>
    );

  return (
    <Page title={t('wordList.title')} description={t('wordList.lead')}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void pick(e.target.files?.[0])}
            data-testid="word-list-file"
          />
          <Button
            variant="secondary"
            size="lg"
            leadingIcon="upload"
            onClick={() => fileRef.current?.click()}
            className="self-start"
          >
            {fileName ? t('wordList.otherFile') : t('wordList.pickFile')}
          </Button>
          {fileName && <p className="text-sm text-fg-muted">{fileName}</p>}
          {fileError && (
            <p role="alert" className="text-sm text-danger-text">
              {fileError}
            </p>
          )}
        </div>
        <TextArea
          label={t('wordList.pasteLabel')}
          placeholder={t('wordList.placeholder')}
          hint={t('wordList.hint')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          rows={8}
          spellCheck={false}
          className="font-mono text-[0.9375rem]"
        />

        {rows.length > 0 && (
          <section aria-labelledby="word-list-preview" className="flex flex-col gap-2">
            <h2 id="word-list-preview" className="text-sm font-semibold text-fg-muted">
              {t('wordList.preview', { count: rows.length })}
            </h2>
            <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
              {rows.slice(0, SHOWN).map((r, i) => (
                <li key={i} className="flex flex-col gap-0.5 px-4 py-2.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span lang="en" className="font-serif text-[1.0625rem] font-semibold text-fg">
                      {r.term}
                    </span>
                    <span className="text-fg">{r.meaning}</span>
                  </span>
                  {r.sentence && (
                    <span lang="en" className="font-serif text-sm text-fg-muted italic">
                      {r.sentence}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {rows.length > SHOWN && (
              <p className="text-sm text-fg-muted">
                {t('wordList.more', { count: rows.length - SHOWN })}
              </p>
            )}
            {parsed.skipped > 0 && (
              <p className="text-sm text-fg-muted">
                {t('wordList.skipped', { count: parsed.skipped })}
              </p>
            )}
            {parsed.truncated && (
              <p className="text-sm text-warn-text">
                {t('wordList.truncated', { max: MAX_LIST_ROWS })}
              </p>
            )}
          </section>
        )}

        {busy !== null ? (
          <ProgressBar
            value={busy}
            max={Math.max(1, rows.length)}
            label={t('a11y.progress')}
            valueText={t('wordList.adding', { done: busy, total: rows.length })}
          />
        ) : (
          <Button
            size="lg"
            leadingIcon="plus"
            disabled={rows.length === 0}
            onClick={() => void run()}
            data-testid="word-list-add"
          >
            {rows.length ? t('wordList.add', { count: rows.length }) : t('wordList.addEmpty')}
          </Button>
        )}
      </div>
    </Page>
  );
}
