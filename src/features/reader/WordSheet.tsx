// The sheet a tapped word opens (v0.5 İP1, plan "dokununca önce tahmin et"; Çam look v0.5.2,
// docs/design.md §4.13). A non-modal bottom sheet, so the text stays tappable behind it: the
// word, its stage and part of speech, the sentence it is in (with its Turkish for library
// texts), then a guess first and the meaning. A word the user already has a card for shows its
// meaning at once unless "Hep tahmin ettir" is on (decision 0054). Actions: "Kelimelerime ekle"
// (the sentence becomes the card's source sentence) and "Biliyorum" (leaves the marks, with an
// undo). Meanings come from this device first (the user's card, the text's own gloss, Kelime
// Bankası, the cached shared lexicon: offline and instant); only when none of these has the
// word and the device is online is ai-enrich asked, with the word alone, never the sentence.
// When no meaning is found, the user can type one here and keep reading (B13).
import { fetchWordBank } from '@/features/wordbank/fetcher';
import { useWordBankEpoch } from '@/features/wordbank/prefetch';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addNoteWithSenses,
  logError,
  lookupReaderWord,
  markManyKnown,
  type ReaderMeaning,
  type ReaderWordInfo,
  type TextGloss,
  unmarkKnownKeys,
} from '@/data';
import type { WordStage } from '@/domain/stages';
import type { Id } from '@/domain/types';
import { useAuth } from '@/features/auth/session';
import { locateTerm } from '@/features/cards/locateTerm';
import { CardPicture } from '@/features/images';
import { lookupLexicon } from '@/features/import/lexicon';
import { playPronunciation, usePronunciationBusy } from '@/features/review/pronunciation';
import type { VoicePref } from '@/features/review/useSpeech';
import {
  Badge,
  Button,
  Card,
  cn,
  Icon,
  IconButton,
  Sheet,
  StagePill,
  Term,
  TextField,
  toast,
} from '@/ui';
import { EncounterLine } from './EncounterLine';

export interface WordPick {
  /** As written in the text ("gave up"). */
  written: string;
  /** Dictionary form ("give up"). */
  lemma: string;
  /** The sentence it is in, as written. */
  sentence: string;
  /** Stage of the user's own word, or null. */
  stage: WordStage | null;
  /** The user's note for it, or null. */
  noteId: Id | null;
  /** The selection can grow by the word before / after it (same sentence). */
  canExtend: { before: boolean; after: boolean };
  /** It is more than one word. */
  phrase: boolean;
  /** The sentence's Turkish (library texts), shown on request. */
  translation?: string | null;
}

interface Props {
  pick: WordPick | null;
  /** The text's own glosses (library texts, stories). */
  glosses?: readonly TextGloss[];
  voice: VoicePref;
  /** "Hep tahmin ettir": ask for a guess even for the user's own words. */
  alwaysGuess?: boolean;
  onClose: () => void;
  onExtend: (side: 'before' | 'after') => void;
  /** "Buradan dinle": listen-along from this sentence. */
  onListenHere?: () => void;
}

type Lookup =
  | { status: 'loading' }
  | { status: 'ready'; info: ReaderWordInfo; online: boolean }
  | { status: 'none'; reason: 'offline' | 'signIn' | 'notFound' };

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** The meanings of a pick: device first, then (online, signed in) the shared lexicon. */
function useWordLookup(pick: WordPick | null, glosses?: readonly TextGloss[]): Lookup {
  const auth = useAuth();
  const signedIn = auth.status === 'signed_in';
  const lemma = pick?.lemma ?? '';
  const written = pick?.written ?? '';
  const key = pick ? `${lemma}|${written}` : '';
  // New bank rows (the background download finishing) run a missed lookup again.
  const bankEpoch = useWordBankEpoch();
  const [state, setState] = useState<{ key: string; lookup: Lookup }>({
    key: '',
    lookup: { status: 'loading' },
  });
  useEffect(() => {
    if (!key) return;
    let live = true;
    const done = (lookup: Lookup) => live && setState({ key, lookup });
    void (async () => {
      try {
        let info = await lookupReaderWord(lemma, written, glosses);
        if (info.source) return done({ status: 'ready', info, online: false });
        if (!isOnline()) return done({ status: 'none', reason: 'offline' });
        // A device without the offline word bank fetches it and looks again (v0.5.3 A2):
        // a guest is never sent to sign in for a word the app ships.
        const bank = await fetchWordBank();
        if (!live) return;
        if (bank.status === 'done') {
          info = await lookupReaderWord(lemma, written, glosses);
          if (info.source) return done({ status: 'ready', info, online: false });
        }
        if (!signedIn) return done({ status: 'none', reason: 'signIn' });
        const res = await lookupLexicon(lemma, { more: false });
        if (!res.ok || res.senses.length === 0)
          return done({
            status: 'none',
            reason: res.ok || res.error !== 'offline' ? 'notFound' : 'offline',
          });
        const meanings: ReaderMeaning[] = res.senses.map((s) => ({
          meaning_tr: s.meaning_tr,
          gloss_en: s.gloss_en,
          pos: s.pos,
          lexicon_sense_id: s.lexicon_sense_id,
        }));
        done({
          status: 'ready',
          online: true,
          info: {
            term: lemma,
            source: 'lexicon',
            noteId: null,
            lexiconTermId: res.senses[0]?.lexicon_term_id ?? null,
            ipa: res.senses.find((s) => s.ipa)?.ipa ?? null,
            meanings,
            picture: null,
          },
        });
      } catch (e) {
        void logError(e, 'reader.lookup');
        done({ status: 'none', reason: 'notFound' });
      }
    })();
    return () => {
      live = false;
    };
    // `key` identifies the pick; the rest of it never changes for the same key.
  }, [key, lemma, written, signedIn, glosses, bankEpoch]);
  return state.key === key ? state.lookup : { status: 'loading' };
}

export function WordSheet({
  pick,
  glosses,
  voice,
  alwaysGuess = false,
  onClose,
  onExtend,
  onListenHere,
}: Props) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={pick !== null}
      modal={false}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={pick ? <Term size="title">{pick.written}</Term> : ''}
      description={
        pick && pick.lemma !== pick.written.toLowerCase()
          ? t('reader.word.lemma', { lemma: pick.lemma })
          : undefined
      }
      className="max-h-[70dvh]"
    >
      {pick && (
        <SheetBody
          key={`${pick.lemma}|${pick.written}|${pick.sentence}`}
          pick={pick}
          glosses={glosses}
          voice={voice}
          guessFirst={alwaysGuess || pick.noteId === null}
          onExtend={onExtend}
          onListenHere={onListenHere}
          onDone={onClose}
        />
      )}
    </Sheet>
  );
}

function SheetBody({
  pick,
  glosses,
  voice,
  guessFirst,
  onExtend,
  onListenHere,
  onDone,
}: {
  pick: WordPick;
  glosses?: readonly TextGloss[];
  voice: VoicePref;
  guessFirst: boolean;
  onExtend: Props['onExtend'];
  onListenHere?: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const lookup = useWordLookup(pick, glosses);
  const [revealed, setRevealed] = useState(!guessFirst);
  const [showTr, setShowTr] = useState(false);
  const [chosen, setChosen] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addedId, setAddedId] = useState<Id | null>(null);
  const speaker = usePronunciationBusy();
  const listId = useId();
  const noteId = pick.noteId ?? addedId ?? (lookup.status === 'ready' ? lookup.info.noteId : null);
  const info = revealed && lookup.status === 'ready' ? lookup.info : null;
  const pos = info?.meanings[chosen]?.pos ?? info?.meanings[0]?.pos ?? null;

  // "Biliyorum" (v0.5.2, ADR 0063): a word the user knows, or a name, leaves the marks and the
  // coverage counts it as known. No card is made; "Geri al" takes it back.
  const markKnownWord = async () => {
    try {
      const added = await markManyKnown([pick.lemma]);
      onDone();
      toast.undo({
        title: t('reader.word.knownMarked', { term: pick.lemma }),
        undoLabel: t('ui.undo'),
        onUndo: () =>
          void unmarkKnownKeys(added).catch((e: unknown) => logError(e, 'reader.knownUndo')),
      });
    } catch (e) {
      void logError(e, 'reader.markKnown');
      toast({ title: t('reader.word.knownFailed'), tone: 'danger' });
    }
  };

  const save = async (term: string, m: ReaderMeaning, lexiconTermId: Id | null) => {
    setAdding(true);
    try {
      const res = await addNoteWithSenses({
        term,
        term_type: term.includes(' ') ? 'phrase' : 'word',
        lexicon_term_id: lexiconTermId,
        senses: [
          {
            meaning_tr: m.meaning_tr,
            pos: m.pos,
            gloss_en: m.gloss_en,
            lexicon_sense_id: m.lexicon_sense_id,
            source_sentence: pick.sentence,
            span: locateTerm(pick.sentence, pick.written),
          },
        ],
      });
      setAddedId(res.note.id);
      toast({ title: t('reader.word.added', { term: res.note.term }), tone: 'success' });
    } catch (e) {
      void logError(e, 'reader.addCard');
      toast({ title: t('reader.word.addFailed'), tone: 'danger' });
    } finally {
      setAdding(false);
    }
  };

  const add = () => {
    if (lookup.status !== 'ready') return;
    const m = lookup.info.meanings[chosen] ?? lookup.info.meanings[0];
    if (!m) return;
    void save(
      pick.phrase ? pick.lemma : lookup.info.term || pick.lemma,
      m,
      lookup.info.lexiconTermId,
    );
  };

  return (
    <div className="flex flex-col gap-4 pb-1">
      <div className="flex min-h-11 flex-wrap items-center gap-2">
        {pick.stage && <StagePill stage={pick.stage} />}
        {pos && (
          <Badge tone="outline">{t(`reader.pos.${pos}`, { defaultValue: pos })}</Badge>
        )}
        {info?.ipa && (
          <span lang="en" className="font-serif text-ui text-fg-muted">
            /{info.ipa.replace(/^\/|\/$/g, '')}/
          </span>
        )}
        <IconButton
          icon="speaker"
          variant="tonal"
          size="sm"
          label={t('reader.word.listen')}
          aria-busy={speaker.busy}
          className={cn('ml-auto', speaker.busy && 'motion-safe:animate-pulse')}
          onClick={() =>
            speaker.run(
              // The form the user tapped ("went"), as the title shows it, not the lemma (B12).
              () => void playPronunciation(pick.written, voice),
            )
          }
        />
      </div>

      <Card tone="sunken" padding="sm" className="flex flex-col gap-1 px-4">
        <p lang="en" className="font-serif text-lead text-fg">
          <Highlighted sentence={pick.sentence} written={pick.written} />
        </p>
        {pick.translation &&
          (showTr ? (
            <p lang="tr" className="text-ui text-fg-muted" data-testid="reader-sentence-tr">
              {pick.translation}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setShowTr(true)}
              className="-mx-1 min-h-11 self-start rounded-control px-1 text-ui font-medium text-accent-text hover:underline"
            >
              {t('reader.word.showTranslation')}
            </button>
          ))}
      </Card>

      {(pick.canExtend.before || pick.canExtend.after || onListenHere) && (
        <div className="-mx-2 -mt-2 flex flex-wrap gap-1">
          {pick.canExtend.before && (
            <Button variant="ghost" size="sm" onClick={() => onExtend('before')}>
              {t('reader.word.extendBefore')}
            </Button>
          )}
          {pick.canExtend.after && (
            <Button variant="ghost" size="sm" onClick={() => onExtend('after')}>
              {t('reader.word.extendAfter')}
            </Button>
          )}
          {onListenHere && (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon="speaker"
              onClick={onListenHere}
              data-testid="reader-listen-here"
            >
              {t('reader.word.listenHere')}
            </Button>
          )}
        </div>
      )}

      {!revealed ? (
        <div className="flex flex-col gap-3">
          <p className="text-ui text-fg-muted">{t('reader.word.guessHint')}</p>
          <Button size="lg" fullWidth onClick={() => setRevealed(true)} data-testid="reader-reveal">
            {t('reader.word.reveal')}
          </Button>
          {!noteId && (
            <Button
              variant="ghost"
              onClick={() => void markKnownWord()}
              data-testid="reader-mark-known"
            >
              {t('reader.word.markKnown')}
            </Button>
          )}
        </div>
      ) : lookup.status === 'loading' ? (
        <p className="text-ui text-fg-muted" aria-live="polite">
          {t('reader.word.loading')}
        </p>
      ) : lookup.status === 'none' ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="text-ui text-fg">{t(`reader.word.none.${lookup.reason}`)}</p>
          {noteId ? (
            <EncounterLine noteId={noteId} />
          ) : (
            <OwnMeaning
              busy={adding}
              onAdd={(meaning) =>
                void save(
                  pick.phrase ? pick.lemma : pick.lemma || pick.written,
                  { meaning_tr: meaning, gloss_en: null, pos: null, lexicon_sense_id: null },
                  null,
                )
              }
              onKnown={() => void markKnownWord()}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4" aria-live="polite">
          {lookup.info.picture && (
            <CardPicture
              image={lookup.info.picture}
              className="max-h-40 w-auto max-w-full self-start rounded-inner"
            />
          )}
          <h3 id={listId} className="sr-only">
            {t('reader.word.meanings')}
          </h3>
          <Meanings
            labelledBy={listId}
            meanings={lookup.info.meanings}
            selectable={!noteId && lookup.info.meanings.length > 1}
            chosen={chosen}
            onChoose={setChosen}
          />
          {lookup.online && <p className="text-meta text-fg-muted">{t('reader.word.fromOnline')}</p>}
          {noteId ? (
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-2 text-ui font-medium text-success-text">
                <Icon name="check" size={18} />
                {t('reader.word.inCards')}
              </p>
              <EncounterLine noteId={noteId} />
            </div>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Button
                size="lg"
                leadingIcon="plus"
                loading={adding}
                onClick={add}
                data-testid="reader-add-card"
              >
                {t('reader.word.addCard')}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => void markKnownWord()}
                data-testid="reader-mark-known"
              >
                {t('reader.word.markKnown')}
              </Button>
            </div>
          )}
        </div>
      )}
      {revealed && lookup.status === 'loading' && noteId && <EncounterLine noteId={noteId} />}
    </div>
  );
}

/** The meanings: the first big; with several and no card yet, the user picks the one to add. */
function Meanings({
  labelledBy,
  meanings,
  selectable,
  chosen,
  onChoose,
}: {
  labelledBy: string;
  meanings: readonly ReaderMeaning[];
  selectable: boolean;
  chosen: number;
  onChoose: (i: number) => void;
}) {
  const { t } = useTranslation();
  const shown = meanings.slice(0, 4);
  if (!selectable)
    return (
      <ul aria-labelledby={labelledBy} className="flex flex-col gap-1" data-testid="reader-meanings">
        {shown.map((m, i) => (
          <li
            key={`${m.lexicon_sense_id ?? ''}${i}`}
            className={cn('text-fg', i === 0 ? 'text-title font-semibold' : 'text-lead')}
          >
            {m.meaning_tr}
            {i > 0 && m.pos && (
              <span className="ml-2 text-meta text-fg-muted">
                {t(`reader.pos.${m.pos}`, { defaultValue: m.pos })}
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  return (
    <ul aria-labelledby={labelledBy} className="flex flex-col gap-2" data-testid="reader-meanings">
      {shown.map((m, i) => (
        <li key={`${m.lexicon_sense_id ?? ''}${i}`}>
          <button
            type="button"
            aria-pressed={chosen === i}
            onClick={() => onChoose(i)}
            className={cn(
              'flex min-h-12 w-full items-center gap-3 rounded-control border px-3 py-2 text-left transition-colors duration-(--duration-micro)',
              chosen === i
                ? 'border-accent bg-accent-soft'
                : 'border-border hover:bg-hover',
            )}
          >
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              <span className="text-lead font-semibold text-fg">{m.meaning_tr}</span>
              {m.pos && (
                <span className="text-meta text-fg-muted">
                  {t(`reader.pos.${m.pos}`, { defaultValue: m.pos })}
                </span>
              )}
            </span>
            {chosen === i && <Icon name="check" size={18} className="shrink-0 text-accent-text" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** No meaning on this device: type one and add the card here, with the sentence (B13). */
function OwnMeaning({
  busy,
  onAdd,
  onKnown,
}: {
  busy: boolean;
  onAdd: (meaning: string) => void;
  onKnown: () => void;
}) {
  const { t } = useTranslation();
  const [meaning, setMeaning] = useState('');
  const value = meaning.trim();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (value) onAdd(value);
      }}
    >
      <TextField
        label={t('reader.word.ownMeaning')}
        hint={t('reader.word.ownMeaningHint')}
        value={meaning}
        maxLength={200}
        autoComplete="off"
        onChange={(e) => setMeaning(e.target.value)}
        data-testid="reader-own-meaning"
      />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Button type="submit" size="lg" leadingIcon="plus" loading={busy} disabled={!value}>
          {t('reader.word.addCard')}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="secondary"
          onClick={onKnown}
          data-testid="reader-mark-known"
        >
          {t('reader.word.markKnown')}
        </Button>
      </div>
    </form>
  );
}

/** The sentence with the picked words in bold. */
function Highlighted({ sentence, written }: { sentence: string; written: string }) {
  const span = locateTerm(sentence, written);
  if (!span) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, span[0])}
      <strong className="font-semibold">{sentence.slice(span[0], span[1])}</strong>
      {sentence.slice(span[1])}
    </>
  );
}
