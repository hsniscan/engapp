// "Bu metindeki yeni kelimeler" (v0.5.1, decision 0054): the words the reader drew as new, each
// with its meaning from this device (Kelime Bankası, the cached shared dictionary: the same
// lookup as the word sheet, offline and free), ticked when a meaning was found; one tap adds
// the ticked ones as cards with the text's sentence. Only a signed-in user online is offered to
// look the remaining words up in the shared dictionary (which may ask the yapay zekâ).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addNoteWithSenses, logError, lookupReaderWord, type ReaderMeaning } from '@/data';
import { useAuth } from '@/features/auth/session';
import { locateTerm } from '@/features/cards/locateTerm';
import { lookupLexicon } from '@/features/import/lexicon';
import { Button, Checkbox, Dialog, Skeleton, toast } from '@/ui';

export interface NewWordItem {
  lemma: string;
  written: string;
  /** The sentence it first appears in, as written. */
  sentence: string;
}

/** At most this many words are listed (a long text's rarest words are rarely all wanted). */
export const NEW_WORDS_MAX = 40;

interface Row {
  item: NewWordItem;
  term: string;
  lexiconTermId: string | null;
  meaning: ReaderMeaning | null;
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function NewWordsSheet({
  open,
  onOpenChange,
  words,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  words: readonly NewWordItem[];
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      title={t('reader.newWords.title')}
      description={t('reader.newWords.description')}
    >
      {open && <SheetBody words={words} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function SheetBody({ words, onDone }: { words: readonly NewWordItem[]; onDone: () => void }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'adding' | 'looking' | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Row[] = [];
      for (const item of words.slice(0, NEW_WORDS_MAX)) {
        try {
          const info = await lookupReaderWord(item.lemma, item.written);
          out.push({
            item,
            term: info.source ? info.term || item.lemma : item.lemma,
            lexiconTermId: info.lexiconTermId,
            meaning: info.meanings[0] ?? null,
          });
        } catch (e) {
          void logError(e, 'reader.newWords.lookup');
          out.push({ item, term: item.lemma, lexiconTermId: null, meaning: null });
        }
      }
      if (!live) return;
      setRows(out);
      setPicked(new Set(out.filter((r) => r.meaning).map((r) => r.item.lemma)));
    })();
    return () => {
      live = false;
    };
  }, [words]);

  const missing = useMemo(() => rows?.filter((r) => !r.meaning) ?? [], [rows]);
  const canLookUp = auth.status === 'signed_in' && missing.length > 0 && isOnline();

  const lookUpMissing = async () => {
    if (!rows) return;
    setBusy('looking');
    const found = new Map<string, Row>();
    for (const r of missing) {
      try {
        const res = await lookupLexicon(r.item.lemma, { more: false });
        const s = res.ok ? res.senses[0] : undefined;
        if (s)
          found.set(r.item.lemma, {
            ...r,
            lexiconTermId: s.lexicon_term_id ?? null,
            meaning: {
              meaning_tr: s.meaning_tr,
              gloss_en: s.gloss_en,
              pos: s.pos,
              lexicon_sense_id: s.lexicon_sense_id,
            },
          });
        else if (!res.ok && res.error === 'offline') break;
      } catch (e) {
        void logError(e, 'reader.newWords.lexicon');
      }
    }
    setRows(rows.map((r) => found.get(r.item.lemma) ?? r));
    setPicked((p) => new Set([...p, ...found.keys()]));
    if (found.size < missing.length) toast({ title: t('reader.newWords.someMissing') });
    setBusy(null);
  };

  const add = async () => {
    if (!rows) return;
    setBusy('adding');
    let added = 0;
    for (const r of rows) {
      if (!r.meaning || !picked.has(r.item.lemma)) continue;
      try {
        await addNoteWithSenses({
          term: r.term,
          term_type: r.term.includes(' ') ? 'phrase' : 'word',
          lexicon_term_id: r.lexiconTermId,
          senses: [
            {
              meaning_tr: r.meaning.meaning_tr,
              pos: r.meaning.pos,
              gloss_en: r.meaning.gloss_en,
              lexicon_sense_id: r.meaning.lexicon_sense_id,
              source_sentence: r.item.sentence,
              span: locateTerm(r.item.sentence, r.item.written),
            },
          ],
        });
        added++;
      } catch (e) {
        void logError(e, 'reader.newWords.add');
      }
    }
    setBusy(null);
    if (added > 0) {
      toast({ title: t('reader.newWords.added', { count: added }), tone: 'success' });
      onDone();
    } else toast({ title: t('reader.word.addFailed'), tone: 'danger' });
  };

  if (rows === null)
    return (
      <div className="flex flex-col gap-2 pb-1" aria-busy="true">
        <span className="sr-only">{t('reader.word.loading')}</span>
        <Skeleton lines={4} />
      </div>
    );
  if (rows.length === 0)
    return <p className="pb-1 text-[0.9375rem] text-fg-muted">{t('reader.newWords.none')}</p>;

  const count = rows.filter((r) => r.meaning && picked.has(r.item.lemma)).length;
  return (
    <div className="flex flex-col gap-4 pb-1">
      <ul
        className="-mx-1 flex max-h-[50dvh] flex-col overflow-y-auto px-1"
        data-testid="reader-new-words"
      >
        {rows.map((r) => (
          <li key={r.item.lemma} className="border-b border-border last:border-b-0">
            <Checkbox
              checked={!!r.meaning && picked.has(r.item.lemma)}
              disabled={!r.meaning || busy !== null}
              onCheckedChange={(on) =>
                setPicked((p) => {
                  const next = new Set(p);
                  if (on === true) next.add(r.item.lemma);
                  else next.delete(r.item.lemma);
                  return next;
                })
              }
              label={
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span lang="en" className="font-serif text-[1.0625rem] font-semibold text-fg">
                    {r.term}
                  </span>{' '}
                  <span className={r.meaning ? 'text-fg' : 'text-fg-muted'}>
                    {r.meaning ? r.meaning.meaning_tr : t('reader.newWords.noMeaning')}
                  </span>
                </span>
              }
              className="py-0.5"
            />
          </li>
        ))}
      </ul>
      {canLookUp && (
        <Button
          variant="secondary"
          loading={busy === 'looking'}
          disabled={busy === 'adding'}
          onClick={() => void lookUpMissing()}
        >
          {t('reader.newWords.lookUp', { count: missing.length })}
        </Button>
      )}
      <Button
        size="lg"
        leadingIcon="plus"
        loading={busy === 'adding'}
        disabled={count === 0 || busy === 'looking'}
        onClick={() => void add()}
        data-testid="reader-new-words-add"
      >
        {t('reader.newWords.add', { count })}
      </Button>
    </div>
  );
}
