// The text itself (v0.5 İP1): paragraphs, sentences and words exactly as written, each word
// drawn by its mark (domain/readerView.ts). One click handler on the container (event
// delegation): a 1 000-word text is a thousand spans, not a thousand listeners. Marked words
// are focusable, so a keyboard reaches the words worth looking up without a thousand tab stops.
import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import type { ReaderView } from '@/domain/readerView';
import type { ReaderParagraph, TokenizedText } from '@/domain/readerTokens';
import { cn } from '@/ui';
import { MARK_CLASS } from './marks';

export interface Selection {
  /** Tokens [first, end) in one sentence. */
  first: number;
  end: number;
}

interface Props {
  body: string;
  text: TokenizedText;
  view: ReaderView | null;
  highlight: boolean;
  selection: Selection | null;
  /** The sentence being read aloud. */
  speaking: number | null;
  onWord: (token: number) => void;
}

export function ReaderBody({ body, text, view, highlight, selection, speaking, onWord }: Props) {
  const pick = (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
    if (!el) return;
    e.preventDefault();
    onWord(Number(el.dataset.t));
  };
  return (
    <div
      className="flex flex-col gap-[1.1em] font-serif text-[1.1875rem] leading-[1.8] text-fg [overflow-wrap:anywhere]"
      lang="en"
      data-testid="reader-text"
      onClick={pick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') pick(e);
      }}
    >
      {text.paragraphs.map((p, i) => (
        <Paragraph
          key={i}
          index={i}
          body={body}
          text={text}
          paragraph={p}
          view={view}
          highlight={highlight}
          selection={selection && inParagraph(text, p, selection.first) ? selection : null}
          speaking={
            speaking !== null && speaking >= p.firstSentence && speaking < p.endSentence
              ? speaking
              : null
          }
        />
      ))}
    </div>
  );
}

const inParagraph = (text: TokenizedText, p: ReaderParagraph, token: number) => {
  const s = text.tokens[token]?.sentence;
  return s !== undefined && s >= p.firstSentence && s < p.endSentence;
};

interface ParagraphProps {
  index: number;
  body: string;
  text: TokenizedText;
  paragraph: ReaderParagraph;
  view: ReaderView | null;
  highlight: boolean;
  selection: Selection | null;
  speaking: number | null;
}

const Paragraph = memo(function Paragraph({
  index,
  body,
  text,
  paragraph,
  view,
  highlight,
  selection,
  speaking,
}: ParagraphProps) {
  const parts: React.ReactNode[] = [];
  for (let s = paragraph.firstSentence; s < paragraph.endSentence; s++) {
    const sen = text.sentences[s]!;
    const words: React.ReactNode[] = [];
    let at = sen.start;
    for (let i = sen.firstToken; i < sen.endToken; i++) {
      const tok = text.tokens[i]!;
      if (tok.start > at) words.push(body.slice(at, tok.start));
      const mark = highlight && view ? view.marks[i]! : 'plain';
      const selected = selection !== null && i >= selection.first && i < selection.end;
      words.push(
        <span
          key={i}
          data-t={i}
          data-mark={mark === 'plain' ? undefined : mark}
          tabIndex={mark === 'plain' ? undefined : 0}
          className={cn(
            'cursor-pointer rounded-[3px] transition-colors duration-(--duration-micro) hover:bg-hover',
            MARK_CLASS[mark],
            selected && 'bg-accent-soft text-fg no-underline ring-1 ring-accent/40',
          )}
        >
          {tok.text}
        </span>,
      );
      at = tok.end;
    }
    if (sen.end > at) words.push(body.slice(at, sen.end));
    parts.push(
      <span
        key={`s${s}`}
        id={`reader-s-${s}`}
        data-s={s}
        className={cn(
          'rounded-[4px] transition-colors duration-(--duration-micro)',
          speaking === s && 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]',
        )}
      >
        {words}
      </span>,
    );
    const next = text.sentences[s + 1];
    if (s + 1 < paragraph.endSentence && next)
      parts.push(body.slice(sen.end, next.start).replace(/\s+/g, ' '));
  }
  return <p data-p={index}>{parts}</p>;
});
