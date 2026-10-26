// /altyazi — "Altyazı dosyası (.srt / .vtt)" (v0.5 İP2, decision 0044). The file is read and
// parsed on the device (domain/subtitles.ts); nothing is uploaded. The result opens in the
// reader as a 'subtitle' text, or goes to word extraction.
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { logError } from '@/data';
import { parseSubtitles, type SubtitleText } from '@/domain/subtitles';
import { Button, Page } from '@/ui';
import { TextResult } from './TextResult';

/** Subtitle files are small; anything larger is not one. */
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

type Problem = 'tooBig' | 'notSubtitle' | 'empty' | 'readFailed';

/** UTF-8 when the bytes are valid UTF-8, else windows-1252 (older .srt files). */
function decodeSubtitleBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function SubtitlePage() {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [result, setResult] = useState<(SubtitleText & { fileName: string }) | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProblem(null);
    setResult(null);
    if (file.size > MAX_SUBTITLE_BYTES) {
      setProblem('tooBig');
      return;
    }
    setBusy(true);
    try {
      const text = decodeSubtitleBytes(new Uint8Array(await file.arrayBuffer()));
      try {
        setResult({ ...parseSubtitles(text, file.name), fileName: file.name });
      } catch (err) {
        setProblem(/not a subtitle/.test(String(err)) ? 'notSubtitle' : 'empty');
      }
    } catch (err) {
      void logError(err, 'subtitle.read');
      setProblem('readFailed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={t('article.subtitles.title')} description={t('article.subtitles.lead')}>
      <div className="mb-6 flex flex-col gap-3">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".srt,.vtt,text/vtt,application/x-subrip"
          className="sr-only"
          onChange={(e) => void onFile(e)}
          data-testid="subtitle-file"
        />
        <div>
          <Button
            size="lg"
            variant={result ? 'secondary' : 'primary'}
            leadingIcon="upload"
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            {result ? t('article.subtitles.chooseOther') : t('article.subtitles.choose')}
          </Button>
        </div>
        {problem && (
          <p role="alert" className="text-sm text-danger-text" data-testid="subtitle-problem">
            {t(`article.subtitles.${problem}`)}
          </p>
        )}
      </div>
      {result && (
        <TextResult
          key={result.fileName + result.body.length}
          kind="subtitle"
          title={result.title || t('article.subtitles.defaultTitle')}
          meta={t('article.subtitles.cues', { count: result.cues })}
          paragraphs={result.body.split('\n\n')}
          sourceUrl={result.fileName}
        />
      )}
    </Page>
  );
}
