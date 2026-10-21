import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { addMorphemeCard, dismissMorphemeSuggestion, logError } from '@/data';
import {
  cardedMorphemes,
  familyOf,
  morphemeMeaning,
  morphemeOfNote,
  morphemeSuggestions,
  wordInfo,
  wordsWithMorpheme,
  type MorphemeEntry,
  type MorphologyIndex,
} from '@/domain/morphology';
import type { Note } from '@/domain/types';
import type { UserWordSets } from '@/data';
import { posLabel } from '@/features/cards/labels';
import { Button, cn, Icon, IconButton, Spinner, Surface, toast } from '@/ui';
import { addFamilyWord } from './addFamilyWord';
import { useDismissedMorphemes, useMorphology, useUserWords } from './hooks';
import { MORPHOLOGY_ASSET } from './morphologyAsset';

const COLLAPSED = 12;
const LICENSE_URL = MORPHOLOGY_ASSET.url.replace(/morphology-[0-9a-f]+\.json$/, 'morphology-LICENSE.txt');

/**
 * Word detail, "Aile": the word's family (carded words bold, the others faded and one tap to
 * add), its root and affixes with their Turkish meaning, and a root/affix card suggestion
 * when at least three of the user's words share one. For a root/affix note: the user's words
 * that carry it and a few more examples.
 */
export function FamilySection({ note }: { note: Note }) {
  const index = useMorphology();
  const words = useUserWords();
  const dismissed = useDismissedMorphemes();
  if (!index || !words || !dismissed) return null;
  return note.term_type === 'affix' ? (
    <MorphemeWords index={index} note={note} words={words} />
  ) : (
    <WordFamily index={index} note={note} words={words} dismissed={dismissed} />
  );
}

function Section({ children }: { children: (headingId: string) => React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3" data-testid="family-section">
      {children(id)}
    </section>
  );
}

function SourceNote() {
  const { t } = useTranslation();
  return (
    <a
      href={LICENSE_URL}
      target="_blank"
      rel="noreferrer"
      className="self-start text-xs text-fg-muted underline-offset-2 hover:underline"
    >
      {t('family.source')}
    </a>
  );
}

function WordFamily({
  index,
  note,
  words,
  dismissed,
}: {
  index: MorphologyIndex;
  note: Note;
  words: UserWordSets;
  dismissed: Set<string>;
}) {
  const { t } = useTranslation();
  const family = familyOf(index, note.term_norm, words.terms);
  const info = wordInfo(index, note.term_norm);
  const parts = info?.morphemes ?? [];
  const suggestions = morphemeSuggestions(index, note.term_norm, words.words, {
    carded: cardedMorphemes(index, words.affixTerms),
    dismissed,
  });
  if (!family && !parts.length) return null;
  return (
    <Section>
      {(headingId) => (
        <>
          <div className="flex flex-col gap-0.5">
            <h3 id={headingId} className="font-serif text-lg font-semibold text-fg">
              {t('family.title')}
            </h3>
            {family && <p className="text-sm text-fg-muted">{t('family.hint')}</p>}
          </div>
          {family && <WordChips members={family.members} />}
          {parts.length > 0 && <Parts parts={parts} />}
          {suggestions[0] && <Suggestion morpheme={suggestions[0].morpheme} words={suggestions[0].words.map((w) => w.term)} />}
          <SourceNote />
        </>
      )}
    </Section>
  );
}

function MorphemeWords({ index, note, words }: { index: MorphologyIndex; note: Note; words: UserWordSets }) {
  const { t } = useTranslation();
  const m = morphemeOfNote(index, note.term_norm);
  if (!m) return null;
  const mine = wordsWithMorpheme(index, m.id, words.words);
  const mineSet = new Set(mine.map((w) => w.term_norm));
  // A few more words with it that the user does not have: family base words first (the most
  // frequent of their family), then the shorter ones.
  const isBase = (lemma: string, family: number) => index.file.families[family]?.[0] === lemma;
  const others = [...index.byLemma.values()]
    .filter((w) => !mineSet.has(w.lemma) && !words.terms.has(w.lemma) && w.morphemes.some((x) => x.id === m.id))
    .sort((a, b) => Number(isBase(b.lemma, b.family)) - Number(isBase(a.lemma, a.family)) || a.lemma.length - b.lemma.length)
    .slice(0, 8)
    .map((w) => w.lemma);
  const { note: explanation } = morphemeMeaning(m);
  return (
    <Section>
      {(headingId) => (
        <>
          <div className="flex flex-col gap-0.5">
            <h3 id={headingId} className="font-serif text-lg font-semibold text-fg">
              {t('family.yourWords')}
            </h3>
            {explanation && <p className="text-sm text-fg-muted">{explanation}</p>}
          </div>
          {mine.length ? (
            <WordChips members={mine.map((w) => ({ lemma: w.term, pos: null, carded: true, self: false }))} />
          ) : (
            <p className="text-sm text-fg-muted">{t('family.noYourWords', { kind: t(`family.kind.${m.kind}`) })}</p>
          )}
          {others.length > 0 && (
            <>
              <h4 className="text-sm font-medium text-fg-muted">{t('family.otherWords')}</h4>
              <WordChips members={others.map((lemma) => ({ lemma, pos: null, carded: false, self: false }))} />
            </>
          )}
          <SourceNote />
        </>
      )}
    </Section>
  );
}

function WordChips({ members }: { members: { lemma: string; pos: string | null; carded: boolean; self: boolean }[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const shown = expanded ? members : members.slice(0, COLLAPSED);
  const rest = members.length - shown.length;

  const add = async (lemma: string) => {
    setBusy(lemma);
    try {
      const res = await addFamilyWord(lemma);
      if (res.status === 'added') {
        toast({
          title: t('family.added', { word: lemma }),
          description: t('family.addedBody', { meaning: res.meaning }),
          tone: 'success',
        });
      } else {
        // No meaning without the dictionary (guest, offline): the add form, word filled in.
        void navigate(`/add?term=${encodeURIComponent(lemma)}`);
      }
    } catch (e) {
      void logError(e, 'FamilySection.add');
      toast({ title: t('family.addFailed', { word: lemma }), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="flex flex-wrap gap-2" aria-label={t('family.title')}>
      {shown.map((m) =>
        m.carded ? (
          <li key={m.lemma}>
            <span
              lang="en"
              aria-current={m.self || undefined}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-control bg-surface-sunken px-3 font-serif text-[1.0625rem] font-semibold text-fg',
                m.self && 'ring-1 ring-border-strong ring-inset',
              )}
            >
              {m.lemma}
              {m.pos && <span className="font-sans text-xs font-normal text-fg-muted">{posLabel(t, m.pos)}</span>}
            </span>
          </li>
        ) : (
          <li key={m.lemma}>
            <button
              type="button"
              lang="en"
              disabled={busy !== null}
              aria-label={t(busy === m.lemma ? 'family.adding' : 'family.addWord', { word: m.lemma })}
              onClick={() => void add(m.lemma)}
              className="inline-flex h-9 items-center gap-1.5 rounded-control border border-dashed border-border px-3 font-serif text-[1.0625rem] text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-60"
            >
              {m.lemma}
              {busy === m.lemma ? <Spinner size={16} /> : <Icon name="plus" size={14} />}
            </button>
          </li>
        ),
      )}
      {(rest > 0 || expanded) && members.length > COLLAPSED && (
        <li>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex h-9 items-center px-2 text-sm font-medium text-accent-text hover:underline"
          >
            {expanded ? t('family.showLess') : t('family.showMore', { count: rest })}
          </button>
        </li>
      )}
    </ul>
  );
}

function Parts({ parts }: { parts: MorphemeEntry[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-sm font-medium text-fg-muted">{t('family.parts')}</h4>
      <ul className="flex flex-col gap-1">
        {parts.map((m) => {
          const { meaning } = morphemeMeaning(m);
          return (
            <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 text-[0.9375rem]">
              <span lang="en" className="font-serif font-semibold text-fg">
                {m.form}
              </span>
              <span className="text-xs text-fg-muted">{t(`family.kind.${m.kind}`)}</span>
              <span className="text-fg">{meaning}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Suggestion({ morpheme, words }: { morpheme: MorphemeEntry; words: string[] }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await addMorphemeCard(morpheme);
      toast({
        title: t('family.morphemeAdded', { form: morpheme.form }),
        description: t('family.morphemeAddedBody', { form: morpheme.form }),
        tone: 'success',
      });
    } catch (e) {
      void logError(e, 'FamilySection.addMorpheme');
      toast({ title: t('family.addFailed', { word: morpheme.form }), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Surface tone="flat" padding="sm" className="flex flex-col gap-2 px-4" data-testid="morpheme-suggestion">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[0.9375rem] text-fg">
          {t('family.suggest', {
            form: morpheme.form,
            kind: t(`family.kindOf.${morpheme.kind}`),
            count: words.length,
            words: words.slice(0, 5).join(', '),
          })}{' '}
          <span className="text-fg-muted">{t('family.suggestWhy')}</span>
        </p>
        <IconButton
          icon="x"
          size="sm"
          label={t('family.dismissSuggestion')}
          onClick={() => void dismissMorphemeSuggestion(morpheme.id)}
          className="-mt-1 -mr-2"
        />
      </div>
      <Button variant="secondary" size="sm" leadingIcon="plus" loading={busy} onClick={() => void add()} className="self-start">
        {morpheme.kind === 'root' ? t('family.addRootCard') : t('family.addAffixCard')}
      </Button>
    </Surface>
  );
}
