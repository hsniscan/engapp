// Bulk tagging for the notes selected on the Cards screen: one sheet to add and remove tags.
// Every known tag is a checkbox showing how the selection has it now (all / some / none);
// typing filters the list and Enter creates a new tag. Nothing is written until "Uygula".
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listTags, logError, setNoteTags } from '@/data';
import { cleanTag, hasTag, MAX_TAG_LENGTH, tagKey } from '@/domain/tags';
import type { Note } from '@/domain/types';
import { Button, Checkbox, Dialog, DialogClose, Icon, TextField, toast } from '@/ui';
import { foldForSearch } from '@/features/cards/libraryFilter';

type TagState = 'on' | 'off' | 'mixed';

interface Row {
  tag: string;
  /** How many selected notes have it. */
  have: number;
  initial: TagState;
}

export function TagSheet({
  open,
  onOpenChange,
  notes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: Pick<Note, 'id' | 'tags'>[];
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('library.tagSheet.title')}
      description={t('library.tagSheet.desc', { count: notes.length })}
    >
      {open && <TagSheetBody notes={notes} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function TagSheetBody({
  notes,
  onDone,
}: {
  notes: Pick<Note, 'id' | 'tags'>[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const known = useLiveQuery(() => listTags(), []);
  const [created, setCreated] = useState<string[]>([]);
  const [changes, setChanges] = useState<Map<string, TagState>>(new Map());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const tag of [...created, ...(known ?? []).map((x) => x.tag)]) {
      const k = tagKey(tag);
      if (seen.has(k)) continue;
      seen.add(k);
      const have = notes.filter((n) => hasTag(n.tags, tag)).length;
      out.push({ tag, have, initial: have === 0 ? 'off' : have === notes.length ? 'on' : 'mixed' });
    }
    // Tags the selection already has first, then the rest (list order: most used first).
    return [...out.filter((r) => r.have > 0), ...out.filter((r) => r.have === 0)];
  }, [known, created, notes]);

  const stateOf = (r: Row): TagState => changes.get(tagKey(r.tag)) ?? r.initial;
  const cycle = (r: Row) => {
    const cur = stateOf(r);
    const next: TagState =
      cur === 'mixed' ? 'on' : cur === 'on' ? 'off' : r.initial === 'mixed' ? 'mixed' : 'on';
    setChanges((m) => new Map(m).set(tagKey(r.tag), next));
  };

  const q = foldForSearch(query);
  const visible = q ? rows.filter((r) => foldForSearch(r.tag).includes(q)) : rows;
  const draft = cleanTag(query);
  const tooLong = [...query.trim().replace(/^#+\s*/, '')].length > MAX_TAG_LENGTH;
  const exact = draft ? rows.find((r) => tagKey(r.tag) === tagKey(draft)) : undefined;

  const createDraft = () => {
    if (!draft) return;
    if (exact) {
      if (stateOf(exact) !== 'on') cycleTo(exact, 'on');
    } else {
      setCreated((c) => [draft, ...c]);
      setChanges((m) => new Map(m).set(tagKey(draft), 'on'));
    }
    setQuery('');
  };
  const cycleTo = (r: Row, s: TagState) => setChanges((m) => new Map(m).set(tagKey(r.tag), s));

  const add: string[] = [];
  const remove: string[] = [];
  for (const r of rows) {
    const s = stateOf(r);
    if (s === r.initial) continue;
    if (s === 'on') add.push(r.tag);
    else if (s === 'off') remove.push(r.tag);
  }
  const dirty = add.length + remove.length > 0;

  const apply = async () => {
    setBusy(true);
    try {
      const res = await setNoteTags(
        notes.map((n) => n.id),
        { add, remove },
      );
      toast({
        title: res.changed
          ? t('library.tagSheet.applied', { count: res.changed })
          : t('library.tagSheet.unchanged'),
        description: res.full ? t('library.tagSheet.full', { count: res.full }) : undefined,
        tone: res.full ? 'neutral' : 'success',
      });
      onDone();
    } catch (e) {
      void logError(e, 'TagSheet.apply');
      toast({ title: t('library.tagSheet.failed'), tone: 'danger' });
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label={t('library.tagSheet.search')}
        hideLabel
        leadingIcon="search"
        placeholder={t('library.tagSheet.search')}
        value={query}
        maxLength={MAX_TAG_LENGTH + 10}
        error={tooLong ? t('library.tagSheet.tooLong') : undefined}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            createDraft();
          }
        }}
        enterKeyHint="done"
        autoCapitalize="none"
        autoComplete="off"
      />
      {draft && !exact && (
        <button
          type="button"
          onClick={createDraft}
          className="flex min-h-11 items-center gap-2 rounded-control px-3 text-left text-[0.9375rem] font-medium text-accent-text hover:bg-hover"
        >
          <Icon name="plus" size={18} />
          {t('library.tagSheet.create', { tag: draft })}
        </button>
      )}

      {rows.length === 0 && !draft ? (
        <p className="py-2 text-[0.9375rem] text-fg-muted">{t('library.tagSheet.none')}</p>
      ) : visible.length === 0 && !draft ? (
        <p className="py-2 text-[0.9375rem] text-fg-muted">{t('library.tagSheet.noMatch')}</p>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {visible.map((r) => {
            const s = stateOf(r);
            const changed = s !== r.initial;
            return (
              <li key={tagKey(r.tag)} className="rounded-control px-1 hover:bg-hover">
                <Checkbox
                  label={<span className="font-medium">#{r.tag}</span>}
                  description={
                    changed
                      ? s === 'on'
                        ? t('library.tagSheet.willAdd')
                        : s === 'off'
                          ? t('library.tagSheet.willRemove')
                          : t('library.tagSheet.mixed', { count: r.have })
                      : r.initial === 'mixed'
                        ? t('library.tagSheet.mixed', { count: r.have })
                        : undefined
                  }
                  checked={s === 'on' ? true : s === 'mixed' ? 'indeterminate' : false}
                  onCheckedChange={() => cycle(r)}
                  className="pl-2"
                />
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky bottom-[calc(-1*max(1.25rem,env(safe-area-inset-bottom)))] z-10 -mx-5 mt-2 grid grid-cols-2 gap-2 border-t border-border bg-surface-raised px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:bottom-[-1.5rem] sm:-mx-6 sm:flex sm:justify-end sm:px-6 sm:pb-6">
        <DialogClose asChild>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </DialogClose>
        <Button onClick={() => void apply()} loading={busy} disabled={!dirty || busy}>
          {t('library.tagSheet.apply')}
        </Button>
      </div>
    </div>
  );
}
