// "Anımsatıcı" in the word detail sheet (v0.3 İP2, docs/decisions/0020-mnemonics.md): per
// sense, the user's mnemonic and the shared suggestions, with Öner / Başka öner, Bunu seç,
// Düzenle, Kendin yaz, Reddet (with "Geri al") and Kaldır. What the user picks or writes
// stays in the user's account (user_content); suggestions come from ai-mnemonic.
import { useId, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  chooseMnemonic,
  logError,
  rejectMnemonic,
  removeMnemonic,
  saveOwnMnemonic,
  undoRejectMnemonic,
} from '@/data';
import {
  cleanMnemonicText,
  MAX_USER_MNEMONIC_CHARS,
  mnemonicTextError,
  type MnemonicItem,
} from '@/domain/mnemonics';
import type { Id, Sense } from '@/domain/types';
import { useAuth } from '@/features/auth/session';
import { useOnline } from '@/features/import/shared';
import { Badge, Button, cn, Dialog, TextArea, toast } from '@/ui';
import { useMnemonicView } from './hooks';
import { requestMnemonics, type MnemonicRequestDeps, type MnemonicRequestError } from './request';

export interface MnemonicSectionProps {
  /** The note's English term (normalized): the cache key of the shared suggestions. */
  termNorm: string;
  /** The note's live senses. */
  senses: Sense[];
  headingId?: string;
  /** Tests only. */
  requestDeps?: MnemonicRequestDeps;
}

export function MnemonicSection({ termNorm, senses, headingId, requestDeps }: MnemonicSectionProps) {
  const { t } = useTranslation();
  const id = useId();
  const hId = headingId ?? `${id}-h`;
  const [senseId, setSenseId] = useState<Id | null>(senses[0]?.id ?? null);
  const sense = senses.find((s) => s.id === senseId) ?? senses[0] ?? null;
  if (!sense) return null;
  return (
    <section aria-labelledby={hId} aria-live="off" className="flex flex-col gap-2" data-testid="mnemonic-section">
      <h3 id={hId} className="font-serif text-lg font-semibold text-fg">
        {t('mnemonic.title')}
      </h3>
      <p className="-mt-1 text-sm text-fg-muted">{t('mnemonic.intro')}</p>
      {senses.length > 1 && (
        <div role="group" aria-label={t('mnemonic.senseLabel')} className="flex flex-wrap gap-1.5">
          {senses.map((s, i) => {
            const on = s.id === sense.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => setSenseId(s.id)}
                className={cn(
                  'inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-(--duration-micro)',
                  on
                    ? 'border-accent bg-accent-soft text-accent-text'
                    : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                <span className="tabular font-serif font-semibold">{i + 1}.</span>
                <span className="truncate">{s.meaning_tr_override ?? s.meaning_tr}</span>
              </button>
            );
          })}
        </div>
      )}
      <SenseMnemonics key={sense.id} senseId={sense.id} termNorm={termNorm} requestDeps={requestDeps} />
    </section>
  );
}

type Note = { kind: 'info' | 'warn'; text: string } | null;

function errorText(t: TFunction, e: MnemonicRequestError): string {
  switch (e) {
    case 'offline':
      return t('mnemonic.offline');
    case 'signed_out':
      return t('mnemonic.guest');
    case 'daily_limit':
      return t('mnemonic.dailyLimit');
    case 'busy':
      return t('mnemonic.busy');
    case 'no_lexicon':
      return t('mnemonic.noLexicon');
    default:
      return t('mnemonic.failed');
  }
}

type Editing = { mode: 'write' } | { mode: 'edit'; text: string; fromId: Id | null } | null;

function SenseMnemonics({
  senseId,
  termNorm,
  requestDeps,
}: {
  senseId: Id;
  termNorm: string;
  requestDeps?: MnemonicRequestDeps;
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const online = useOnline();
  const view = useMnemonicView(senseId);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [editing, setEditing] = useState<Editing>(null);

  if (view === undefined) return <p className="text-sm text-fg-muted">{t('common.loading')}</p>;
  if (view === null) return null;

  const signedIn = auth.status === 'signed_in';
  const canAsk = !!view.lexiconSenseId && signedIn && online;

  const ask = async (more: boolean) => {
    setBusy(true);
    setNote({ kind: 'info', text: t('mnemonic.suggesting') });
    const res = await requestMnemonics({ lexiconSenseId: view.lexiconSenseId, termNorm, more }, requestDeps);
    setBusy(false);
    if (!res.ok) {
      setNote({ kind: 'warn', text: errorText(t, res.error) });
      return;
    }
    if (res.newIds.length > 0) setNote({ kind: 'info', text: t('mnemonic.added') });
    else if (res.none) setNote(null); // the section says it in place
    else if (more) setNote({ kind: 'info', text: t(res.exhausted ? 'mnemonic.exhausted' : 'mnemonic.noneNew') });
    else setNote({ kind: 'info', text: t('mnemonic.fromShared') });
  };

  const failed = (e: unknown, where: string) => {
    void logError(e, where);
    toast({ title: t('mnemonic.saveFailed'), tone: 'danger' });
  };

  const choose = (s: MnemonicItem) =>
    chooseMnemonic(senseId, s.id).then(
      () => toast({ title: t('mnemonic.picked'), tone: 'success' }),
      (e: unknown) => failed(e, 'mnemonic.choose'),
    );

  const reject = (s: MnemonicItem) =>
    rejectMnemonic(senseId, s.id).then(
      ({ clearedChoice }) =>
        toast({
          title: t('mnemonic.rejected'),
          action: {
            label: t('common.undo'),
            onClick: () =>
              void undoRejectMnemonic(senseId, s.id, { restoreChoice: clearedChoice }).catch((e: unknown) =>
                failed(e, 'mnemonic.undoReject'),
              ),
          },
        }),
      (e: unknown) => failed(e, 'mnemonic.reject'),
    );

  const remove = () =>
    removeMnemonic(senseId).then(
      () => toast({ title: t('mnemonic.removed') }),
      (e: unknown) => failed(e, 'mnemonic.remove'),
    );

  const chosen = view.chosen;
  let status: string | null = null;
  if (!view.lexiconSenseId) status = t('mnemonic.noLexicon');
  else if (view.none) status = t('mnemonic.none');
  else if (view.asked && view.suggestions.length === 0) status = t('mnemonic.allRejected');
  else if (!view.asked && !chosen) {
    status = !signedIn ? t('mnemonic.emptyGuest') : !online ? t('mnemonic.emptyOffline') : t('mnemonic.empty');
  }

  return (
    <div className="flex flex-col gap-3">
      {chosen && (
        <div className="flex flex-col gap-2 rounded-control border border-accent/40 bg-accent-soft px-3 py-3" data-testid="mnemonic-chosen">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-medium text-accent-text">{t('mnemonic.yours')}</p>
            {chosen.fromId === null && <Badge tone="neutral">{t('mnemonic.own')}</Badge>}
            {chosen.edited && <Badge tone="neutral">{t('mnemonic.edited')}</Badge>}
          </div>
          <p lang="tr" className="text-[0.9375rem] leading-relaxed text-fg">
            {chosen.text}
          </p>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              leadingIcon="pencil"
              className="px-2.5"
              onClick={() => setEditing({ mode: 'edit', text: chosen.text, fromId: chosen.fromId })}
            >
              {t('mnemonic.edit')}
            </Button>
            <Button size="sm" variant="ghost" leadingIcon="x" className="px-2.5" onClick={() => void remove()}>
              {t('mnemonic.remove')}
            </Button>
          </div>
        </div>
      )}

      {view.suggestions.length > 0 && (
        <ul aria-label={t('mnemonic.suggestionsLabel')} className="flex flex-col gap-2">
          {view.suggestions.map((s) => {
            const picked = chosen?.fromId === s.id && !chosen.edited;
            return (
              <li key={s.id} className="flex flex-col gap-1.5 rounded-control bg-surface-sunken px-3 py-3" data-testid="mnemonic-suggestion">
                <Badge tone="neutral" className="self-start">
                  {t(`mnemonic.types.${s.type}`)}
                </Badge>
                <p lang="tr" className="text-[0.9375rem] leading-relaxed text-fg">
                  {s.text}
                </p>
                {s.why && (
                  <p lang="tr" className="text-sm text-fg-muted">
                    {s.why}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  <Button
                    size="sm"
                    variant={picked ? 'ghost' : 'secondary'}
                    leadingIcon="check"
                    aria-pressed={picked}
                    disabled={picked}
                    className={cn('px-2.5', picked && 'text-accent-text')}
                    onClick={() => void choose(s)}
                  >
                    {picked ? t('mnemonic.chosen') : t('mnemonic.choose')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon="pencil"
                    className="px-2.5"
                    onClick={() => setEditing({ mode: 'edit', text: s.text, fromId: s.id })}
                  >
                    {t('mnemonic.edit')}
                  </Button>
                  <Button size="sm" variant="ghost" leadingIcon="x" className="px-2.5" onClick={() => void reject(s)}>
                    {t('mnemonic.reject')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {status && <p className="text-sm text-fg-muted">{status}</p>}
      {view.rejected > 0 && view.suggestions.length > 0 && (
        <p className="text-sm text-fg-muted">{t('mnemonic.rejectedCount', { count: view.rejected })}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {view.lexiconSenseId && !view.asked && (
          <Button size="sm" variant="secondary" leadingIcon="refresh" loading={busy} disabled={!canAsk || busy} onClick={() => void ask(false)}>
            {t('mnemonic.suggest')}
          </Button>
        )}
        {view.lexiconSenseId && view.asked && !view.exhausted && (
          <Button size="sm" variant="secondary" leadingIcon="refresh" loading={busy} disabled={!canAsk || busy} onClick={() => void ask(true)}>
            {t('mnemonic.more')}
          </Button>
        )}
        {!chosen && (
          <Button size="sm" variant="ghost" leadingIcon="pencil" onClick={() => setEditing({ mode: 'write' })}>
            {t('mnemonic.write')}
          </Button>
        )}
      </div>
      {view.asked && view.exhausted && <p className="text-sm text-fg-muted">{t('mnemonic.exhausted')}</p>}
      <p role="status" className={cn('text-sm empty:hidden', note?.kind === 'warn' ? 'text-warn-text' : 'text-fg-muted')}>
        {note?.text ?? ''}
      </p>

      <MnemonicDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={async (text, fromId) => {
          await saveOwnMnemonic(senseId, text, { fromId });
          toast({ title: t('mnemonic.saved'), tone: 'success' });
        }}
      />
    </div>
  );
}

function MnemonicDialog({
  editing,
  onClose,
  onSave,
}: {
  editing: Editing;
  onClose: () => void;
  onSave: (text: string, fromId: Id | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const open = editing !== null;
  const initial = editing?.mode === 'edit' ? editing.text : '';
  const [text, setText] = useState(initial);
  const [seen, setSeen] = useState<Editing>(editing);
  const [saving, setSaving] = useState(false);
  if (editing !== seen) {
    setSeen(editing);
    if (editing) setText(initial);
  }
  const problem = mnemonicTextError(text);
  const error =
    problem === 'empty'
      ? t('mnemonic.emptyText')
      : problem === 'too_long'
        ? t('mnemonic.tooLong', { max: MAX_USER_MNEMONIC_CHARS })
        : undefined;

  const save = async () => {
    if (problem || !editing) return;
    setSaving(true);
    try {
      await onSave(cleanMnemonicText(text), editing.mode === 'edit' ? editing.fromId : null);
      onClose();
    } catch (e) {
      void logError(e, 'mnemonic.save');
      toast({ title: t('mnemonic.saveFailed'), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={editing?.mode === 'edit' ? t('mnemonic.editTitle') : t('mnemonic.writeTitle')}
      description={t('mnemonic.dialogHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!!problem}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <TextArea
        label={t('mnemonic.textLabel')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        lang="tr"
        maxLength={MAX_USER_MNEMONIC_CHARS + 50}
        className="min-h-20"
        error={text.trim() ? error : undefined}
      />
    </Dialog>
  );
}
