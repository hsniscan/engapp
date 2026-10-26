// "Okuyucuda aç" in the paste and PDF flows (v0.5 İP1): the text is stored on this device
// (and in the user's own sync) and opens in the reader. No AI and no account needed, so it
// works offline and for guests too.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { logError, saveText } from '@/data';
import { MAX_TEXT_CHARS, readerPath, type NewText } from '@/domain/texts';
import { closeAddSheet } from '@/features/add/addSheetStore';
import { useAuth } from '@/features/auth/session';
import { Button, TextArea, TextField, toast } from '@/ui';

/** First words of a text as its title ("The morning was quiet and…"). */
function titleFrom(body: string, max = 60): string {
  const line = body.trim().split(/\n/)[0]?.trim() ?? '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).trimEnd()}…`;
}

function useOpenInReader() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const open = async (input: NewText) => {
    setBusy(true);
    try {
      const id = await saveText({
        ...input,
        title: input.title.trim() || titleFrom(input.body) || t('reader.open.defaultTitle'),
      });
      closeAddSheet();
      void navigate(readerPath(id));
    } catch (e) {
      void logError(e, 'reader.open');
      toast({ title: t('reader.open.failed'), tone: 'danger' });
      setBusy(false);
    }
  };
  return { busy, open };
}

/** A secondary "Okuyucuda aç" button next to an import's main action. */
export function OpenInReaderButton({
  input,
  disabled,
}: {
  input: () => NewText | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { busy, open } = useOpenInReader();
  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      loading={busy}
      disabled={disabled}
      onClick={() => {
        const v = input();
        if (v) void open(v);
      }}
      data-testid="open-in-reader"
    >
      {t('reader.open.cta')}
    </Button>
  );
}

/**
 * Paste a text straight into the reader: for guests and when the AI import is not available
 * (the word extraction needs an account; reading does not).
 */
export function ReaderPasteBox() {
  const { t } = useTranslation();
  const { busy, open } = useOpenInReader();
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!/\p{L}{2,}/u.test(text)) return setError(t('reader.open.tooShort'));
    if (text.length > MAX_TEXT_CHARS) return setError(t('reader.open.tooLong'));
    void open({ kind: 'paste', title, body: text });
  };
  if (!expanded) {
    return (
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-4 sm:px-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-serif text-lg font-semibold text-fg">{t('reader.open.boxTitle')}</h3>
          <p className="text-sm text-fg-muted">{t('reader.open.boxBody')}</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setExpanded(true)}
          data-testid="reader-paste-open"
        >
          {t('reader.open.expand')}
        </Button>
      </div>
    );
  }
  return (
    <form
      onSubmit={submit}
      noValidate
      className="mt-6 flex flex-col gap-4 rounded-card border border-border bg-surface px-4 py-4 sm:px-5"
      data-testid="reader-paste"
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-serif text-lg font-semibold text-fg">{t('reader.open.boxTitle')}</h3>
        <p className="text-sm text-fg-muted">{t('reader.open.boxBody')}</p>
      </div>
      <TextArea
        label={t('reader.open.textLabel')}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          if (error) setError(null);
        }}
        rows={6}
        lang="en"
        spellCheck={false}
        error={error ?? undefined}
        className="font-serif text-[1.0625rem]"
      />
      <TextField
        label={t('reader.open.titleLabel')}
        optional
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
      />
      <Button type="submit" size="lg" loading={busy} disabled={!body.trim()} className="self-end">
        {t('reader.open.cta')}
      </Button>
    </form>
  );
}

/** Below the import gate: the paste box for everyone the AI import is closed to. */
export function ReaderPasteFallback() {
  const auth = useAuth();
  if (auth.status === 'signed_in' || auth.status === 'loading') return null;
  return <ReaderPasteBox />;
}
