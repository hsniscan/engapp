import { LIMITS } from '@/domain/limits';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { addNoteWithSenses, ActionError, findNoteByTerm, logError, db } from '@/data';
import { normalizeTerm } from '@/domain/normalize';
import type { TermType } from '@/domain/types';
import {
  Badge,
  Button,
  Checkbox,
  Icon,
  IconButton,
  SegmentedControl,
  Select,
  Spinner,
  Surface,
  TextArea,
  TextField,
  buttonClasses,
  cn,
  toast,
} from '@/ui';
import { POS_VALUES, posLabel } from './labels';
import { locateTerm } from './locateTerm';
import { SentencePreview } from './SentencePreview';
import { TagInput } from './TagInput';
import { useLexiconLookup, type LexiconSuggestion } from './useLexiconLookup';

interface SenseDraft {
  key: string;
  meaning: string;
  gloss: string;
  pos: string;
  sentence: string;
  sentenceTr: string;
  /** Set when the sense came from the lexicon / AI suggestions. */
  lexicon_sense_id: string | null;
  showDetails: boolean;
}

let draftCounter = 0;
const blankSense = (): SenseDraft => ({
  key: `s${++draftCounter}`,
  meaning: '',
  gloss: '',
  pos: '',
  sentence: '',
  sentenceTr: '',
  lexicon_sense_id: null,
  showDetails: false,
});

const fromSuggestion = (s: LexiconSuggestion): SenseDraft => ({
  key: `l-${s.lexicon_sense_id}`,
  meaning: s.meaning_tr,
  gloss: s.gloss_en ?? '',
  pos: s.pos ?? '',
  sentence: '',
  sentenceTr: '',
  lexicon_sense_id: s.lexicon_sense_id,
  showDetails: false,
});

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const NO_POS = '__none';

/** "Elle" tab: type a term and one or more senses. Detects an existing note and adds senses to it. */
export function ManualAddForm() {
  const { t } = useTranslation();
  const formId = useId();
  const termRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');
  // The term type follows the spelling (a space → phrase) until the user picks one.
  const [chosenType, setChosenType] = useState<TermType | null>(null);
  const termType: TermType = chosenType ?? (term.trim().includes(' ') ? 'phrase' : 'word');
  const [ipa, setIpa] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [senses, setSenses] = useState<SenseDraft[]>(() => [blankSense()]);
  const [errors, setErrors] = useState<{ term?: string; senses?: Record<string, string> }>({});
  const [saving, setSaving] = useState(false);

  const debouncedTerm = useDebounced(term.trim(), 250);
  const existing = useLiveQuery(
    () => (debouncedTerm ? findNoteByTerm(debouncedTerm) : Promise.resolve(null)),
    [debouncedTerm],
  );
  // Ignore a result that belongs to an earlier spelling (the live query keeps it while reloading).
  const existingNote =
    existing && existing.note.term_norm === normalizeTerm(term) ? existing : null;

  const allTags = useLiveQuery(async () => {
    const set = new Set<string>();
    await db.notes
      .filter((n) => n.deleted_at === null)
      .each((n) => n.tags.forEach((x) => set.add(x)));
    return [...set].sort((a, b) => a.localeCompare(b, 'tr'));
  }, []);

  const lookup = useLexiconLookup(term.trim());

  const patchSense = (key: string, patch: Partial<SenseDraft>) =>
    setSenses((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const toggleSuggestion = (s: LexiconSuggestion, on: boolean) =>
    setSenses((list) => {
      if (!on) {
        const rest = list.filter((d) => d.lexicon_sense_id !== s.lexicon_sense_id);
        return rest.length ? rest : [blankSense()];
      }
      const blanks = list.filter(
        (d) => !d.meaning.trim() && !d.sentence.trim() && !d.lexicon_sense_id,
      );
      const kept = list.length === blanks.length ? [] : list;
      return [...kept, fromSuggestion(s)];
    });

  const reset = () => {
    setTerm('');
    setIpa('');
    setChosenType(null);
    setSenses([blankSense()]);
    setErrors({});
    termRef.current?.focus();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const nextErrors: { term?: string; senses?: Record<string, string> } = {};
    if (!term.trim()) nextErrors.term = t('cards.add.termRequired');
    const senseErrors: Record<string, string> = {};
    for (const s of senses)
      if (!s.meaning.trim()) senseErrors[s.key] = t('cards.add.meaningRequired');
    if (Object.keys(senseErrors).length) nextErrors.senses = senseErrors;
    setErrors(nextErrors);
    if (nextErrors.term) {
      termRef.current?.focus();
      return;
    }
    if (nextErrors.senses) {
      const first = senses.find((s) => senseErrors[s.key]);
      document.getElementById(`${formId}-${first?.key}-meaning`)?.focus();
      return;
    }

    setSaving(true);
    try {
      const res = await addNoteWithSenses({
        term,
        term_type: termType,
        ipa: ipa.trim() || null,
        tags,
        lexicon_term_id:
          lookup.senses.find((x) => senses.some((d) => d.lexicon_sense_id === x.lexicon_sense_id))
            ?.lexicon_term_id ?? null,
        senses: senses.map((s) => ({
          meaning_tr: s.meaning.trim(),
          gloss_en: s.gloss.trim() || null,
          pos: s.pos || null,
          source_sentence: s.sentence.trim() || null,
          source_sentence_tr: s.sentenceTr.trim() || null,
          span: s.sentence.trim() ? locateTerm(s.sentence.trim(), term) : null,
          lexicon_sense_id: s.lexicon_sense_id,
        })),
      });
      const added = res.addedSenses.length;
      if (added === 0) {
        toast({ title: t('cards.add.nothingNew', { term: res.note.term }), tone: 'warn' });
      } else {
        toast({
          title:
            res.status === 'existing'
              ? t('cards.add.senseAdded', { term: res.note.term, count: added })
              : t('cards.add.saved', { term: res.note.term }),
          description: t('cards.add.cardsCreated', { count: res.createdCards.length }),
          tone: 'success',
        });
        reset();
      }
    } catch (err) {
      if (err instanceof ActionError && err.code === 'invalid_input') {
        toast({ title: t('cards.add.invalid'), tone: 'danger' });
      } else {
        void logError(err, 'ManualAddForm.submit');
        toast({ title: t('cards.add.failed'), tone: 'danger' });
      }
    } finally {
      setSaving(false);
    }
  };

  const pickedLexicon = useMemo(
    () => new Set(senses.map((s) => s.lexicon_sense_id).filter(Boolean)),
    [senses],
  );
  const existingMeanings = existingNote?.senses
    .slice()
    .sort((a, b) => a.sense_no - b.sense_no)
    .map((s) => s.meaning_tr_override?.trim() || s.meaning_tr);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-6"
      aria-labelledby={`${formId}-title`}
    >
      <h2 id={`${formId}-title`} className="sr-only">
        {t('cards.add.manualTitle')}
      </h2>

      <div className="flex flex-col gap-3">
        <TextField
          maxLength={LIMITS.term}
          ref={termRef}
          label={t('cards.add.term')}
          hint={t('cards.add.termHint')}
          error={errors.term}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            if (errors.term) setErrors((x) => ({ ...x, term: undefined }));
          }}
          lang="en"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="next"
        />

        {existingNote && (
          <Surface tone="sunken" padding="sm" className="flex gap-3 px-4" role="status">
            <Icon name="info" size={20} className="mt-0.5 shrink-0 text-accent-text" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-[0.9375rem] font-medium text-fg">{t('cards.add.exists')}</p>
              <p className="text-sm text-fg-muted">
                {t('cards.add.existsHas', { count: existingMeanings?.length ?? 0 })}{' '}
                <span className="text-fg">
                  {existingMeanings?.map((m, i) => `${i + 1}. ${m}`).join(' · ')}
                </span>
              </p>
              <Link
                to={`/library?note=${existingNote.note.id}`}
                className="mt-1 inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-accent-text underline-offset-4 hover:underline"
              >
                {t('cards.add.openInLibrary')}
                <Icon name="chevron-right" size={16} />
              </Link>
            </div>
          </Surface>
        )}

        {lookup.available && (
          <LexiconBlock
            lookup={lookup}
            disabled={!term.trim()}
            picked={pickedLexicon}
            onToggle={toggleSuggestion}
          />
        )}
      </div>

      {!existingNote && (
        <SegmentedControl<TermType>
          legend={t('cards.add.termType')}
          value={termType}
          onValueChange={setChosenType}
          options={[
            { value: 'word', label: t('cards.termType.word') },
            { value: 'phrase', label: t('cards.termType.phrase') },
            { value: 'pattern', label: t('cards.termType.pattern') },
          ]}
        />
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 flex w-full items-baseline justify-between">
          <span className="font-serif text-xl font-semibold text-fg">
            {existingNote ? t('cards.add.newSenses') : t('cards.add.senses')}
          </span>
        </legend>
        <ol className="flex flex-col gap-3">
          {senses.map((s, i) => (
            <SenseEditor
              key={s.key}
              idBase={`${formId}-${s.key}`}
              index={i + (existingNote?.senses.length ?? 0)}
              draft={s}
              term={term}
              error={errors.senses?.[s.key]}
              canRemove={senses.length > 1}
              onChange={(patch) => {
                patchSense(s.key, patch);
                if (patch.meaning !== undefined && errors.senses?.[s.key]) {
                  setErrors((x) => {
                    const rest = { ...x.senses };
                    delete rest[s.key];
                    return { ...x, senses: rest };
                  });
                }
              }}
              onRemove={() => setSenses((list) => list.filter((d) => d.key !== s.key))}
            />
          ))}
        </ol>
        <Button
          variant="ghost"
          leadingIcon="plus"
          className="self-start"
          onClick={() => {
            const d = blankSense();
            setSenses((list) => [...list, d]);
            requestAnimationFrame(() =>
              document.getElementById(`${formId}-${d.key}-meaning`)?.focus(),
            );
          }}
        >
          {t('cards.add.addSense')}
        </Button>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        {!existingNote?.note.ipa && (
          <TextField
            maxLength={LIMITS.ipa}
            label={t('cards.add.ipa')}
            hint={t('cards.add.ipaHint')}
            optional
            value={ipa}
            onChange={(e) => setIpa(e.target.value)}
            className="font-serif"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        )}
        <TagInput
          label={t('cards.tags.label')}
          value={tags}
          onChange={setTags}
          suggestions={allTags ?? []}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-muted">{t('cards.add.cardsHint')}</p>
        <Button
          type="submit"
          size="lg"
          loading={saving}
          leadingIcon="check"
          className="sm:min-w-48"
        >
          {existingNote ? t('cards.add.submitSense') : t('cards.add.submit')}
        </Button>
      </div>
    </form>
  );
}

function SenseEditor({
  idBase,
  index,
  draft,
  term,
  error,
  canRemove,
  onChange,
  onRemove,
}: {
  idBase: string;
  index: number;
  draft: SenseDraft;
  term: string;
  error?: string;
  canRemove: boolean;
  onChange: (patch: Partial<SenseDraft>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const sentence = draft.sentence.trim();
  const span = useMemo(
    () => (sentence && term.trim() ? locateTerm(sentence, term) : null),
    [sentence, term],
  );
  const detailsId = `${idBase}-details`;
  return (
    <li>
      <Surface padding="none" className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="-mt-1 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium text-fg-muted">
            <span className="tabular font-serif text-base font-semibold text-fg">{index + 1}.</span>
            {t('cards.add.senseN')}
            {draft.lexicon_sense_id && <Badge tone="accent">{t('cards.add.fromLexicon')}</Badge>}
          </h3>
          {canRemove && (
            <IconButton
              icon="trash"
              size="sm"
              label={t('cards.add.removeSense', { n: index + 1 })}
              onClick={onRemove}
              className="-mr-2"
            />
          )}
        </div>
        <TextField
          maxLength={LIMITS.meaning_tr}
          id={`${idBase}-meaning`}
          label={t('cards.add.meaning')}
          hint={t('cards.add.meaningHint')}
          error={error}
          value={draft.meaning}
          onChange={(e) => onChange({ meaning: e.target.value })}
          lang="tr"
          autoComplete="off"
        />
        <TextArea
          maxLength={LIMITS.source_sentence}
          label={t('cards.add.sentence')}
          hint={sentence ? undefined : t('cards.add.sentenceHint')}
          optional
          rows={2}
          value={draft.sentence}
          onChange={(e) => onChange({ sentence: e.target.value })}
          lang="en"
          className="min-h-16 font-serif"
        />
        {sentence && <SentencePreview sentence={sentence} span={span} />}
        {sentence && (
          <TextArea
            label={t('cards.add.sentenceTr')}
            hint={t('cards.add.sentenceTrHint')}
            optional
            rows={2}
            value={draft.sentenceTr}
            onChange={(e) => onChange({ sentenceTr: e.target.value })}
            lang="tr"
            className="min-h-16"
          />
        )}

        <div>
          <button
            type="button"
            aria-expanded={draft.showDetails}
            aria-controls={detailsId}
            onClick={() => onChange({ showDetails: !draft.showDetails })}
            className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-control px-1 text-sm font-medium text-fg-muted hover:text-fg"
          >
            <Icon
              name="chevron-down"
              size={16}
              className={cn(
                'transition-transform duration-(--duration-micro)',
                draft.showDetails && 'rotate-180',
              )}
            />
            {t('cards.add.moreDetails')}
            {!draft.showDetails && (draft.gloss || draft.pos) && (
              <span className="font-normal text-fg-subtle">
                · {[draft.pos && posLabel(t, draft.pos), draft.gloss].filter(Boolean).join(', ')}
              </span>
            )}
          </button>
          {draft.showDetails && (
            <div id={detailsId} className="mt-3 grid gap-4 sm:grid-cols-2">
              <TextField
                maxLength={LIMITS.gloss_en}
                label={t('cards.add.gloss')}
                hint={t('cards.add.glossHint')}
                optional
                value={draft.gloss}
                onChange={(e) => onChange({ gloss: e.target.value })}
                lang="en"
              />
              <Select
                label={t('cards.add.pos')}
                optional
                value={draft.pos || NO_POS}
                onValueChange={(v) => onChange({ pos: v === NO_POS ? '' : v })}
                options={[
                  { value: NO_POS, label: t('cards.add.posNone') },
                  ...POS_VALUES.map((p) => ({ value: p, label: posLabel(t, p) })),
                ]}
              />
            </div>
          )}
        </div>
      </Surface>
    </li>
  );
}

function LexiconBlock({
  lookup,
  disabled,
  picked,
  onToggle,
}: {
  lookup: ReturnType<typeof useLexiconLookup>;
  disabled: boolean;
  picked: Set<string | null>;
  onToggle: (s: LexiconSuggestion, on: boolean) => void;
}) {
  const { t } = useTranslation();
  const lexicon = lookup.senses.filter((s) => s.origin === 'lexicon');
  const ai = lookup.senses.filter((s) => s.origin === 'ai');
  const row = (s: LexiconSuggestion) => (
    <li key={s.lexicon_sense_id}>
      <Checkbox
        checked={picked.has(s.lexicon_sense_id)}
        onCheckedChange={(v) => onToggle(s, v === true)}
        label={s.meaning_tr}
        description={[s.pos && posLabel(t, s.pos), s.gloss_en].filter(Boolean).join(' · ')}
      />
    </li>
  );
  return (
    <Surface padding="sm" className="flex flex-col gap-2 px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">{t('cards.ai.hint')}</p>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          loading={lookup.status === 'loading'}
          onClick={lookup.fill}
        >
          {t('cards.ai.fill')}
        </Button>
      </div>
      {lookup.status === 'loading' && lookup.senses.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner size={16} /> {t('cards.ai.loading')}
        </p>
      )}
      {lookup.error && <p className="text-sm text-danger-text">{lookup.error}</p>}
      {lexicon.length > 0 && (
        <>
          <p className="mt-1 text-xs font-medium tracking-wide text-fg-muted uppercase">
            {t('cards.ai.fromLexicon')}
          </p>
          <ul>{lexicon.map(row)}</ul>
        </>
      )}
      {ai.length > 0 && (
        <>
          <p className="mt-1 text-xs font-medium tracking-wide text-fg-muted uppercase">
            {t('cards.ai.fromAi')}
          </p>
          <ul>{ai.map(row)}</ul>
        </>
      )}
      {lookup.canSearchMore && (
        <button
          type="button"
          onClick={lookup.searchMore}
          className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'self-start' })}
        >
          <Icon name="search" size={16} />
          {t('cards.ai.searchMore')}
        </button>
      )}
    </Surface>
  );
}
