// /import/anki — "Anki dosyası (.apkg)": pick a file → summary, SM-2 warning and field mapping
// with a 3-note preview → import with progress → result and the optional "Sözlükle eşleştir".
// All rules live in src/domain/anki.ts and src/data/anki.ts; this screen only collects the
// user's choices.
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { importAnkiPlan, listAnkiImports, logError, startAnkiEnrich } from '@/data';
import {
  isValidMapping,
  planAnkiImport,
  previewNote,
  summarizeAnki,
  type AnkiCollection,
  type AnkiFieldMapping,
  type AnkiMappings,
  type AnkiNoteTypeSummary,
  type AnkiSummary,
} from '@/domain/anki';
import type { AnkiImportCounts, AnkiImportRecord } from '@/domain/types';
import { useAuth } from '@/features/auth/session';
import { Button, Checkbox, Icon, Page, ProgressBar, Select, Spinner, Surface, buttonClasses, cn, toast } from '@/ui';
import { kickAnkiEnrich } from './enrichQueue';
import { AnkiReadFailure, MAX_APKG_BYTES, parseApkgFile, type AnkiReadError } from './parseApkg';

type State =
  | { phase: 'pick'; error?: { name: string; code: AnkiReadError | 'empty' } }
  | { phase: 'reading'; name: string }
  | { phase: 'review'; name: string; col: AnkiCollection; summary: AnkiSummary }
  | { phase: 'importing'; name: string; done: number; total: number }
  | { phase: 'done'; name: string; id: string; counts: AnkiImportCounts };

const MB = Math.round(MAX_APKG_BYTES / 1024 / 1024);
const n = (x: number) => x.toLocaleString('tr');

export function AnkiImportPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ phase: 'pick' });

  const read = async (file: File) => {
    setState({ phase: 'reading', name: file.name });
    try {
      const col = await parseApkgFile(file);
      const summary = summarizeAnki(col);
      if (summary.notes === 0) return setState({ phase: 'pick', error: { name: file.name, code: 'empty' } });
      setState({ phase: 'review', name: file.name, col, summary });
    } catch (e) {
      const code = e instanceof AnkiReadFailure ? e.code : 'unreadable';
      if (!(e instanceof AnkiReadFailure)) void logError(e, 'anki.read');
      setState({ phase: 'pick', error: { name: file.name, code } });
    }
  };

  const run = async (name: string, col: AnkiCollection, mappings: AnkiMappings) => {
    const plan = planAnkiImport(col, mappings, Date.now());
    setState({ phase: 'importing', name, done: 0, total: plan.notes.length });
    try {
      const res = await importAnkiPlan(plan, name, {
        onProgress: ({ done, total }) => setState({ phase: 'importing', name, done, total }),
      });
      setState({ phase: 'done', name, id: res.source_id, counts: res.counts });
    } catch (e) {
      void logError(e, 'anki.import');
      toast({ title: t('anki.errors.importFailed'), tone: 'danger' });
      setState({ phase: 'pick' });
    }
  };

  return (
    <Page title={t('anki.title')} description={t('anki.description')}>
      <div className="flex flex-col gap-6">
        {state.phase === 'pick' && <PickStep error={state.error} onFile={(f) => void read(f)} />}
        {state.phase === 'reading' && (
          <div role="status" className="flex items-center gap-3 rounded-card border border-border bg-surface px-5 py-6">
            <Spinner size={20} />
            <p className="min-w-0 flex-1 truncate font-medium text-fg">{t('anki.reading', { name: state.name })}</p>
          </div>
        )}
        {state.phase === 'review' && (
          <ReviewStep
            name={state.name}
            summary={state.summary}
            onCancel={() => setState({ phase: 'pick' })}
            onImport={(m) => void run(state.name, state.col, m)}
          />
        )}
        {state.phase === 'importing' && (
          <div role="status" className="flex flex-col gap-3 rounded-card border border-border bg-surface px-5 py-6">
            <div className="flex items-center gap-3">
              <Spinner size={20} />
              <p className="min-w-0 flex-1 truncate font-medium text-fg">{state.name}</p>
            </div>
            <ProgressBar
              value={state.done}
              max={Math.max(1, state.total)}
              label={t('a11y.progress')}
              valueText={t('anki.importing', { done: n(state.done), total: n(state.total) })}
            />
            <p className="tabular text-sm text-fg-muted">{t('anki.importing', { done: n(state.done), total: n(state.total) })}</p>
          </div>
        )}
        {state.phase === 'done' && <DoneStep id={state.id} counts={state.counts} onAnother={() => setState({ phase: 'pick' })} />}
        {(state.phase === 'pick' || state.phase === 'done') && <PastImports hideId={state.phase === 'done' ? state.id : null} />}
      </div>
    </Page>
  );
}

// ------------------------------------------------------------------ pick

function PickStep({ error, onFile }: { error?: { name: string; code: AnkiReadError | 'empty' }; onFile: (f: File) => void }) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
    if (inputRef.current) inputRef.current.value = '';
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  };
  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors duration-(--duration-micro)',
          dragging ? 'border-accent bg-accent-soft/50' : 'border-border-strong/50 bg-surface',
        )}
      >
        <span className="mb-4 flex size-12 items-center justify-center rounded-full border border-border text-fg-muted">
          <Icon name="layers" size={22} />
        </span>
        <p className="hidden font-serif text-lg font-semibold text-fg pointer-fine:block">{t('anki.pick.drop')}</p>
        <p className="mt-1 mb-4 hidden text-sm text-fg-muted pointer-fine:block">{t('anki.pick.or')}</p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".apkg,.colpkg,application/octet-stream,application/zip"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="anki-file"
          onChange={(e) => pick(e.target.files)}
        />
        <Button variant="secondary" leadingIcon="file" onClick={() => inputRef.current?.click()}>
          {t('anki.pick.button')}
        </Button>
        <p className="mt-4 max-w-xs text-sm text-fg-muted">{t('anki.pick.hint', { mb: MB })}</p>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2.5 text-sm text-danger-text">
          <Icon name="alert" size={18} className="mt-px shrink-0" />
          <span className="min-w-0 break-words">
            <span className="font-semibold">{error.name}:</span> {t(`anki.errors.${error.code}`, { mb: MB })}
          </span>
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ review

function ReviewStep({
  name,
  summary,
  onCancel,
  onImport,
}: {
  name: string;
  summary: AnkiSummary;
  onCancel: () => void;
  onImport: (m: AnkiMappings) => void;
}) {
  const { t } = useTranslation();
  const importable = summary.noteTypes.filter((nt) => nt.mapping);
  const cloze = summary.noteTypes.filter((nt) => !nt.mapping).reduce((s, nt) => s + nt.noteCount, 0);
  const [mappings, setMappings] = useState<AnkiMappings>(() => Object.fromEntries(importable.map((nt) => [nt.id, nt.mapping])));
  const [off, setOff] = useState<Set<string>>(new Set());
  const valid = (nt: AnkiNoteTypeSummary) => {
    const m = mappings[nt.id];
    return !!m && isValidMapping({ id: nt.id, name: nt.name, kind: nt.kind, fields: nt.fields, templates: [] }, m);
  };
  const chosen = importable.filter((nt) => !off.has(nt.id));
  const total = chosen.reduce((s, nt) => s + nt.noteCount, 0);
  const ok = chosen.length > 0 && chosen.every(valid);

  const submit = () => {
    const out: AnkiMappings = {};
    for (const nt of summary.noteTypes) out[nt.id] = off.has(nt.id) ? null : (mappings[nt.id] ?? null);
    onImport(out);
  };

  return (
    <div className="flex flex-col gap-5">
      <Surface className="flex flex-col gap-1">
        <p className="min-w-0 truncate text-sm text-fg-muted">{name}</p>
        <p className="font-serif text-xl font-semibold text-fg" data-testid="anki-summary">
          {t('anki.summary', { notes: n(summary.notes), cards: n(summary.cards), reviews: n(summary.reviews) })}
        </p>
        {summary.mediaFiles > 0 && <p className="text-sm text-fg-muted">{t('anki.media', { count: summary.mediaFiles, n: n(summary.mediaFiles) })}</p>}
      </Surface>

      <div role="note" className="flex items-start gap-3 rounded-control bg-warn-soft px-4 py-3 text-warn-text">
        <Icon name="info" size={20} className="mt-0.5 shrink-0" />
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold">{t('anki.fsrs.title')}</p>
          <p className="text-sm">{t('anki.fsrs.body')}</p>
        </div>
      </div>

      <section aria-labelledby="anki-mapping" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="anki-mapping" className="font-serif text-xl font-semibold text-fg">
            {t('anki.mapping.title')}
          </h2>
          <p className="text-[0.9375rem] text-fg-muted">{t('anki.mapping.intro')}</p>
        </div>
        {importable.map((nt) => (
          <NoteTypeMapping
            key={nt.id}
            nt={nt}
            showToggle={importable.length > 1}
            included={!off.has(nt.id)}
            onIncluded={(v) =>
              setOff((s) => {
                const next = new Set(s);
                if (v) next.delete(nt.id);
                else next.add(nt.id);
                return next;
              })
            }
            mapping={mappings[nt.id]!}
            valid={valid(nt)}
            onMapping={(m) => setMappings((s) => ({ ...s, [nt.id]: m }))}
          />
        ))}
        {cloze > 0 && <p className="text-sm text-fg-muted">{t('anki.mapping.cloze', { count: cloze, n: n(cloze) })}</p>}
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel}>
          {t('anki.cancel')}
        </Button>
        <Button disabled={!ok} onClick={submit}>
          {t('anki.submit', { count: total, n: n(total) })}
        </Button>
      </div>
    </div>
  );
}

function NoteTypeMapping({
  nt,
  showToggle,
  included,
  onIncluded,
  mapping,
  valid,
  onMapping,
}: {
  nt: AnkiNoteTypeSummary;
  showToggle: boolean;
  included: boolean;
  onIncluded: (v: boolean) => void;
  mapping: AnkiFieldMapping;
  valid: boolean;
  onMapping: (m: AnkiFieldMapping) => void;
}) {
  const { t } = useTranslation();
  const fieldOptions = nt.fields.map((f, i) => ({ value: String(i), label: f || t('anki.mapping.unnamed', { n: i + 1 }) }));
  const previews = useMemo(() => (valid ? nt.samples.map((s) => previewNote(s, mapping)) : []), [nt.samples, mapping, valid]);
  return (
    <Surface className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-semibold text-fg break-words">{nt.name}</h3>
        <p className="text-sm text-fg-muted">{t('anki.mapping.notes', { count: nt.noteCount, n: n(nt.noteCount) })}</p>
      </div>
      {showToggle && <Checkbox label={t('anki.mapping.include')} checked={included} onCheckedChange={(v) => onIncluded(v === true)} />}
      {included && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label={t('anki.mapping.term')}
              options={fieldOptions}
              value={String(mapping.term)}
              onValueChange={(v) => onMapping({ ...mapping, term: Number(v) })}
            />
            <Select
              label={t('anki.mapping.meaning')}
              options={fieldOptions}
              value={String(mapping.meaning)}
              onValueChange={(v) => onMapping({ ...mapping, meaning: Number(v) })}
            />
            <Select
              label={t('anki.mapping.sentence')}
              optional
              options={[{ value: 'none', label: t('anki.mapping.none') }, ...fieldOptions]}
              value={mapping.sentence === null ? 'none' : String(mapping.sentence)}
              onValueChange={(v) => onMapping({ ...mapping, sentence: v === 'none' ? null : Number(v) })}
            />
          </div>
          {!valid && (
            <p role="alert" className="text-sm text-danger-text">
              {t('anki.mapping.invalid')}
            </p>
          )}
          {previews.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-medium text-fg-muted">{t('anki.mapping.preview')}</h4>
              <ul className="flex flex-col divide-y divide-border rounded-control border border-border" data-testid="anki-preview">
                {previews.map((p, i) => (
                  <li key={i} className="flex flex-col gap-0.5 px-3 py-2.5">
                    <p className="break-words">
                      <span className="font-serif text-lg font-semibold text-fg">{p.term || t('anki.mapping.empty')}</span>
                      <span className="text-fg-muted"> — </span>
                      <span className="text-fg">{p.meaning || t('anki.mapping.empty')}</span>
                    </p>
                    {p.sentence && <p className="text-sm break-words text-fg-muted italic">{p.sentence}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Surface>
  );
}

// ------------------------------------------------------------------ result

function DoneStep({ id, counts, onAnother }: { id: string; counts: AnkiImportCounts; onAnother: () => void }) {
  const { t } = useTranslation();
  const skipped = counts.skippedNoteType + counts.skippedEmpty;
  type Line = 'created' | 'sensesAdded' | 'alreadyHad' | 'logs' | 'suspended' | 'sameInFile' | 'skipped' | 'ignored' | 'media';
  const lines: [Line, number][] = [
    ['created', counts.created],
    ['sensesAdded', counts.sensesAdded],
    ['alreadyHad', counts.alreadyHad],
    ['logs', counts.logs],
    ['suspended', counts.suspended],
    ['sameInFile', counts.sameInFile],
    ['skipped', skipped],
    ['ignored', counts.cardsIgnored + counts.cardsMerged],
    ['media', counts.media],
  ];
  return (
    <div className="flex flex-col gap-5">
      <Surface className="flex flex-col gap-3" role="status">
        <h2 className="flex items-center gap-2 font-serif text-xl font-semibold text-fg">
          <Icon name="check" size={22} className="text-success-text" />
          {t('anki.done.title')}
        </h2>
        <ul className="flex flex-col gap-1 text-[0.9375rem] text-fg" data-testid="anki-result">
          {lines
            .filter(([key, v]) => v > 0 || key === 'created')
            .map(([key, v]) => (
              <li key={key}>{t(`anki.done.${key}`, { count: v, n: n(v) })}</li>
            ))}
        </ul>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link to="/library" className={buttonClasses({ variant: 'primary' })}>
            {t('anki.done.toLibrary')}
          </Link>
          <Button variant="secondary" onClick={onAnother}>
            {t('anki.done.another')}
          </Button>
        </div>
      </Surface>
      <EnrichCard id={id} />
    </div>
  );
}

function EnrichCard({ id }: { id: string }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const rec = useLiveQuery(() => listAnkiImports().then((all) => all.find((r) => r.id === id) ?? null), [id]);
  const [busy, setBusy] = useState(false);
  if (!rec || rec.note_ids.length === 0) return null;
  const start = async () => {
    setBusy(true);
    try {
      await startAnkiEnrich(id);
      kickAnkiEnrich();
    } catch (e) {
      void logError(e, 'anki.enrich.start');
      toast({ title: t('anki.errors.importFailed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Surface className="flex flex-col gap-3" aria-labelledby="anki-enrich">
      <h2 id="anki-enrich" className="font-serif text-xl font-semibold text-fg">
        {t('anki.enrich.title')}
      </h2>
      <p className="text-[0.9375rem] text-fg-muted">{t('anki.enrich.body')}</p>
      {rec.enrich.status === 'off' ? (
        auth.status === 'signed_in' ? (
          <>
            <p className="text-sm text-fg-muted">{t('anki.enrich.quota')}</p>
            <Button className="self-start" leadingIcon="refresh" loading={busy} onClick={() => void start()}>
              {t('anki.enrich.start')}
            </Button>
          </>
        ) : (
          <p className="text-sm text-fg-muted">{t('anki.enrich.signIn')}</p>
        )
      ) : (
        <EnrichStatus rec={rec} />
      )}
    </Surface>
  );
}

function EnrichStatus({ rec }: { rec: AnkiImportRecord }) {
  const { t } = useTranslation();
  const e = rec.enrich;
  const done = e.matched + e.term_only + e.unmatched;
  const total = done + e.pending.length;
  if (e.status === 'done')
    return (
      <p role="status" className="text-sm text-fg">
        {t('anki.enrich.done', { matched: n(e.matched), termOnly: n(e.term_only), unmatched: n(e.unmatched) })}
      </p>
    );
  const text =
    e.status === 'paused'
      ? e.error === 'daily_limit'
        ? t('anki.enrich.paused', { done: n(done), total: n(total) })
        : t('anki.enrich.pausedRetry', { done: n(done), total: n(total) })
      : t('anki.enrich.running', { done: n(done), total: n(total) });
  return (
    <div role="status" className="flex flex-col gap-2">
      <ProgressBar value={done} max={Math.max(1, total)} label={t('anki.enrich.title')} valueText={text} />
      <p className="tabular text-sm text-fg-muted">{text}</p>
    </div>
  );
}

function PastImports({ hideId }: { hideId: string | null }) {
  const { t } = useTranslation();
  const all = useLiveQuery(() => listAnkiImports(), []) ?? [];
  const rows = all.filter((r) => r.id !== hideId);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="anki-history" className="flex flex-col gap-3">
      <h2 id="anki-history" className="font-serif text-lg font-semibold text-fg">
        {t('anki.history.title')}
      </h2>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.id}>
            <Surface className="flex flex-col gap-2">
              <p className="min-w-0 font-medium break-words text-fg">{r.file_name}</p>
              <p className="text-sm text-fg-muted">{t('anki.history.words', { count: r.note_ids.length, n: n(r.note_ids.length) })}</p>
              {r.enrich.status !== 'off' && <EnrichStatus rec={r} />}
            </Surface>
          </li>
        ))}
      </ul>
    </section>
  );
}
