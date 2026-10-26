// The sheet a tapped word opens (v0.5 İP1, plan "dokununca önce tahmin et"): first the
// sentence and "Tahmin et", then the meaning, the picture (when one is cached), the sound and
// "Karta ekle" with the sentence as the card's source sentence. Meanings come from this
// device first (the user's card, Kelime Bankası, the cached shared lexicon: offline and
// instant); only when none of these has the word and the device is online is ai-enrich asked,
// with the word alone, never the user's sentence.
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  addNoteWithSenses,
  logError,
  lookupReaderWord,
  type ReaderMeaning,
  type ReaderWordInfo,
} from '@/data';
import type { WordStage } from '@/domain/stages';
import type { Id } from '@/domain/types';
import { useAuth } from '@/features/auth/session';
import { locateTerm } from '@/features/cards/locateTerm';
import { CardPicture } from '@/features/images';
import { lookupLexicon } from '@/features/import/lexicon';
import { playPronunciation, usePronunciationBusy } from '@/features/review/pronunciation';
import type { VoicePref } from '@/features/review/useSpeech';
import { Badge, Button, cn, Dialog, IconButton, toast } from '@/ui';
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
}

interface Props {
  pick: WordPick | null;
  voice: VoicePref;
  onClose: () => void;
  onExtend: (side: 'before' | 'after') => void;
}

type Lookup =
  | { status: 'loading' }
  | { status: 'ready'; info: ReaderWordInfo; online: boolean }
  | { status: 'none'; reason: 'offline' | 'signIn' | 'notFound' };

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** The meanings of a pick: device first, then (online, signed in) the shared lexicon. */
function useWordLookup(pick: WordPick | null): Lookup {
  const auth = useAuth();
  const signedIn = auth.status === 'signed_in';
  const lemma = pick?.lemma ?? '';
  const written = pick?.written ?? '';
  const key = pick ? `${lemma}|${written}` : '';
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
        const info = await lookupReaderWord(lemma, written);
        if (info.source) return done({ status: 'ready', info, online: false });
        if (!isOnline()) return done({ status: 'none', reason: 'offline' });
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
  }, [key, lemma, written, signedIn]);
  return state.key === key ? state.lookup : { status: 'loading' };
}

export function WordSheet({ pick, voice, onClose, onExtend }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={pick !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      variant="sheet"
      title={pick ? <span lang="en">{pick.written}</span> : ''}
      description={
        pick && pick.lemma !== pick.written.toLowerCase()
          ? t('reader.word.lemma', { lemma: pick.lemma })
          : undefined
      }
    >
      {pick && (
        <SheetBody
          key={`${pick.lemma}|${pick.written}|${pick.sentence}`}
          pick={pick}
          voice={voice}
          onExtend={onExtend}
        />
      )}
    </Dialog>
  );
}

function SheetBody({
  pick,
  voice,
  onExtend,
}: {
  pick: WordPick;
  voice: VoicePref;
  onExtend: Props['onExtend'];
}) {
  const { t } = useTranslation();
  const lookup = useWordLookup(pick);
  const [revealed, setRevealed] = useState(false);
  const [chosen, setChosen] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addedId, setAddedId] = useState<Id | null>(null);
  const speaker = usePronunciationBusy();
  const listId = useId();
  const noteId = pick.noteId ?? addedId ?? (lookup.status === 'ready' ? lookup.info.noteId : null);

  const add = async () => {
    if (lookup.status !== 'ready') return;
    const m = lookup.info.meanings[chosen] ?? lookup.info.meanings[0];
    if (!m) return;
    setAdding(true);
    try {
      const term = pick.phrase ? pick.lemma : lookup.info.term || pick.lemma;
      const res = await addNoteWithSenses({
        term,
        term_type: term.includes(' ') ? 'phrase' : 'word',
        lexicon_term_id: lookup.info.lexiconTermId,
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

  return (
    <div className="flex flex-col gap-4 pt-1 pb-1">
      <div className="flex flex-wrap items-center gap-2">
        {pick.stage && <Badge tone="accent">{t(`reader.stage.${pick.stage}`)}</Badge>}
        <IconButton
          icon="speaker"
          variant="ghost"
          size="sm"
          label={t('reader.word.listen')}
          aria-busy={speaker.busy}
          className={speaker.busy ? 'animate-pulse' : undefined}
          onClick={() =>
            speaker.run(
              () => void playPronunciation(pick.phrase ? pick.written : pick.lemma, voice),
            )
          }
        />
        <div className="ml-auto flex gap-1">
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
        </div>
      </div>

      <blockquote
        lang="en"
        className="rounded-card bg-surface-sunken px-4 py-3 font-serif text-[1.0625rem] leading-relaxed text-fg"
      >
        <Highlighted sentence={pick.sentence} written={pick.written} />
      </blockquote>

      {!revealed ? (
        <div className="flex flex-col gap-3">
          <p className="text-[0.9375rem] text-fg-muted">{t('reader.word.guessHint')}</p>
          <Button size="lg" onClick={() => setRevealed(true)} data-testid="reader-reveal">
            {t('reader.word.reveal')}
          </Button>
        </div>
      ) : lookup.status === 'loading' ? (
        <p className="text-sm text-fg-muted" aria-live="polite">
          {t('reader.word.loading')}
        </p>
      ) : lookup.status === 'none' ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="text-[0.9375rem] text-fg">{t(`reader.word.none.${lookup.reason}`)}</p>
          {!noteId && (
            <Link
              to={`/add?term=${encodeURIComponent(pick.lemma)}`}
              className="self-start text-[0.9375rem] font-medium text-accent-text underline underline-offset-4"
            >
              {t('reader.word.addYourself')}
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4" aria-live="polite">
          {lookup.info.picture && (
            <CardPicture
              image={lookup.info.picture}
              className="mx-auto max-h-40 w-auto max-w-full rounded-card"
            />
          )}
          {lookup.info.ipa && (
            <p className="text-sm text-fg-muted">/{lookup.info.ipa.replace(/^\/|\/$/g, '')}/</p>
          )}
          <h3 id={listId} className="sr-only">
            {t('reader.word.meanings')}
          </h3>
          <ul
            aria-labelledby={listId}
            className="-mt-4 flex flex-col gap-1.5"
            data-testid="reader-meanings"
          >
            {lookup.info.meanings.slice(0, 4).map((m, i) => {
              const selectable = !noteId && lookup.info.meanings.length > 1;
              return (
                <li key={`${m.lexicon_sense_id ?? ''}${i}`}>
                  <button
                    type="button"
                    disabled={!selectable}
                    aria-pressed={selectable ? chosen === i : undefined}
                    onClick={() => setChosen(i)}
                    className={cn(
                      'flex w-full items-baseline gap-2 rounded-control px-3 py-2 text-left',
                      selectable && 'border border-border hover:bg-hover',
                      selectable && chosen === i && 'border-accent bg-accent-soft',
                    )}
                  >
                    <span className="text-[1.0625rem] font-medium text-fg">{m.meaning_tr}</span>
                    {m.pos && (
                      <span className="text-[0.8125rem] text-fg-muted">
                        {t(`reader.pos.${m.pos}`, { defaultValue: m.pos })}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {lookup.online && (
            <p className="text-[0.8125rem] text-fg-muted">{t('reader.word.fromOnline')}</p>
          )}
          {noteId ? (
            <div className="flex flex-col gap-1">
              <p className="text-[0.9375rem] font-medium text-success-text">
                {t('reader.word.inCards')}
              </p>
              <EncounterLine noteId={noteId} />
            </div>
          ) : (
            <Button
              size="lg"
              leadingIcon="plus"
              loading={adding}
              onClick={() => void add()}
              data-testid="reader-add-card"
            >
              {t('reader.word.addCard')}
            </Button>
          )}
        </div>
      )}
      {revealed && lookup.status !== 'ready' && noteId && <EncounterLine noteId={noteId} />}
    </div>
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
