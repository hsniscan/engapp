// What the reader adds for a daily story (v0.5 İP8, decision 0050; Çam look v0.5.2): the hard
// words glossed before the text (only when the story stayed over the user's difficulty), and
// after it three comprehension questions and the story's words with their Turkish meanings.
// Answers stay on the screen: the story is practice and writes nothing to FSRS or review_logs.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoryInfo, StoryQuestionInfo } from '@/domain/story';
import { Card, cn, Eyebrow, Icon, ListGroup, ListRow, SectionHeader } from '@/ui';

/** "Önce şu kelimelere bir bak": the glossed hard words, or nothing. */
export function StoryGlossary({ story }: { story: StoryInfo }) {
  const { t } = useTranslation();
  if (story.glossed.length === 0) return null;
  return (
    <Card
      as="aside"
      tone="sunken"
      className="mb-8 flex flex-col gap-2"
      aria-label={t('story.glossed')}
      data-testid="story-glossed"
    >
      <Eyebrow>{t('story.glossed')}</Eyebrow>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {story.glossed.map((g) => (
          <li key={g.lemma} className="text-ui">
            <span lang="en" className="font-serif font-semibold text-fg">
              {g.lemma}
            </span>{' '}
            <span className="text-fg-muted">{g.gloss_tr}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Question({ q, n }: { q: StoryQuestionInfo; n: number }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<number | null>(null);
  const done = picked !== null;
  return (
    <fieldset className="flex flex-col gap-2" data-testid="story-question">
      <legend className="mb-3 font-serif text-lead text-fg" lang="en">
        <span className="tabular mr-2 font-sans text-ui font-semibold text-fg-muted">{n}.</span>
        {q.q}
      </legend>
      {q.options.map((o, i) => {
        const right = done && i === q.answer;
        const wrong = done && i === picked && i !== q.answer;
        return (
          <button
            key={i}
            type="button"
            lang="en"
            disabled={done}
            aria-pressed={picked === i}
            onClick={() => setPicked(i)}
            className={cn(
              'flex min-h-12 items-center gap-3 rounded-control border px-4 py-2.5 text-left font-serif text-body transition-colors duration-(--duration-micro)',
              !done && 'border-border bg-surface text-fg hover:border-border-strong/60 hover:bg-hover',
              done && !right && !wrong && 'border-border bg-surface text-fg-muted',
              right && 'border-success-text bg-success-soft text-fg',
              wrong && 'border-danger-text bg-danger-soft text-fg',
            )}
          >
            <span className="min-w-0 flex-1">{o}</span>
            {right && <Icon name="check" size={18} className="shrink-0 text-success-text" />}
            {wrong && <Icon name="x" size={18} className="shrink-0 text-danger-text" />}
          </button>
        );
      })}
      {done && (
        <p
          role="status"
          className={cn('text-ui', picked === q.answer ? 'text-success-text' : 'text-fg-muted')}
        >
          {picked === q.answer
            ? t('story.questions.right')
            : t('story.questions.wrong', { answer: q.options[q.answer] })}
        </p>
      )}
    </fieldset>
  );
}

/** After the text: the three questions, then the story's words. */
export function StoryEnd({ story }: { story: StoryInfo }) {
  const { t } = useTranslation();
  const words = story.targets.filter((w) => w.used);
  return (
    <section className="mt-12 flex flex-col gap-10" aria-labelledby="story-questions" data-testid="story-end">
      {story.questions.length > 0 && (
        <div className="flex flex-col gap-6">
          <SectionHeader id="story-questions" title={t('story.questions.title')} className="mb-0" />
          {story.questions.map((q, i) => (
            <Question key={i} q={q} n={i + 1} />
          ))}
        </div>
      )}
      {words.length > 0 && (
        <div>
          <SectionHeader title={t('story.words')} />
          <ListGroup data-testid="story-words">
            {words.map((w) => (
              <ListRow key={w.note_id} term title={w.lemma} description={w.gloss_tr || undefined} />
            ))}
          </ListGroup>
        </div>
      )}
    </section>
  );
}
