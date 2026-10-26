// What the reader adds for a daily story (v0.5 İP8, decision 0050): the hard words glossed
// before the text (only when the story stayed over the user's difficulty), and after it three
// comprehension questions and the story's words with their Turkish meanings. Answers stay on
// the screen: the story is practice and writes nothing to FSRS or review_logs.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoryInfo, StoryQuestionInfo } from '@/domain/story';
import { cn } from '@/ui';

/** "Önce şu kelimelere bir bak": the glossed hard words, or nothing. */
export function StoryGlossary({ story }: { story: StoryInfo }) {
  const { t } = useTranslation();
  if (story.glossed.length === 0) return null;
  return (
    <aside
      className="mb-7 rounded-[14px] bg-surface-sunken px-4 py-3 text-[0.9375rem]"
      aria-label={t('story.glossed')}
      data-testid="story-glossed"
    >
      <p className="mb-1.5 text-sm text-fg-muted">{t('story.glossed')}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {story.glossed.map((g) => (
          <li key={g.lemma}>
            <span lang="en" className="font-serif font-semibold text-fg">
              {g.lemma}
            </span>{' '}
            <span className="text-fg-muted">{g.gloss_tr}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Question({ q, n }: { q: StoryQuestionInfo; n: number }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<number | null>(null);
  const done = picked !== null;
  return (
    <fieldset className="flex flex-col gap-2" data-testid="story-question">
      <legend className="mb-2 font-serif text-[1.0625rem] leading-snug text-fg" lang="en">
        <span className="mr-1.5 font-sans text-sm text-fg-muted">{n}.</span>
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
              'min-h-11 rounded-[12px] border px-3.5 py-2 text-left text-[0.9375rem] transition-colors duration-(--duration-micro)',
              !done && 'border-border bg-surface text-fg hover:bg-hover',
              done && !right && !wrong && 'border-border bg-surface text-fg-muted',
              right && 'border-success-text bg-success-soft text-fg',
              wrong && 'border-danger-text bg-danger-soft text-fg',
            )}
          >
            {o}
          </button>
        );
      })}
      {done && (
        <p
          role="status"
          className={cn('text-sm', picked === q.answer ? 'text-success-text' : 'text-fg-muted')}
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
    <section className="mt-12 flex flex-col gap-8" aria-labelledby="story-questions" data-testid="story-end">
      {story.questions.length > 0 && (
        <div className="flex flex-col gap-6">
          <h2 id="story-questions" className="text-[0.8125rem] font-semibold tracking-wide text-fg-muted uppercase">
            {t('story.questions.title')}
          </h2>
          {story.questions.map((q, i) => (
            <Question key={i} q={q} n={i + 1} />
          ))}
        </div>
      )}
      {words.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-[0.8125rem] font-semibold tracking-wide text-fg-muted uppercase">
            {t('story.words')}
          </h2>
          <ul className="flex flex-col gap-1.5 text-[0.9375rem]" data-testid="story-words">
            {words.map((w) => (
              <li key={w.note_id} className="flex items-baseline gap-2">
                <span lang="en" className="font-serif font-semibold text-fg">
                  {w.lemma}
                </span>
                {w.gloss_tr && <span className="text-fg-muted">{w.gloss_tr}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
