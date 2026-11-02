// The text itself (v0.5 İP1; v0.5.2 Çam, docs/design.md §4.13): paragraphs, sentences and
// words exactly as written, each word drawn by its mark (domain/readerView.ts). Every word is a
// real <button> (a tap target and a keyboard target), with one click handler on the container
// (event delegation: a 1 000-word text is a thousand buttons, not a thousand listeners).
// Keyboard: one Tab stop per sentence (its first marked word, else its first word, a roving
// tabindex), ←/→ move word by word, Home/End jump to the sentence's ends. A marked word says
// what it is to a screen reader ("yeni kelime") through aria-describedby.
import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReaderView, WordMark } from '@/domain/readerView';
import type { ReaderParagraph, TokenizedText } from '@/domain/readerTokens';
import { cn } from '@/ui';
import { MARK_CLASS, MARK_DESCRIPTION_ID } from './marks';

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
  /** Tokens of a story's target words (İP8): drawn in bold. */
  targets?: ReadonlySet<number>;
  /** A library text's Turkish, one per paragraph, shown under it (null = none). */
  translations?: readonly (string | null)[] | null;
  /** Text size ("Yazı boyutu"): scale of the 19 px reading size, 1 = normal. */
  fontScale?: number;
}

const wordAt = (root: HTMLElement, i: number) =>
  root.querySelector<HTMLButtonElement>(`button[data-t="${i}"]`);

/** Moves the roving tab stop of a sentence to `el` and focuses it. */
function focusWord(root: HTMLElement, el: HTMLButtonElement) {
  const s = el.closest<HTMLElement>('[data-s]');
  s?.querySelectorAll<HTMLButtonElement>('button[tabindex="0"]').forEach((b) => {
    if (b !== el) b.tabIndex = -1;
  });
  // A sentence left behind keeps one stop: its first word.
  const prev = root.ownerDocument.activeElement;
  if (prev instanceof HTMLButtonElement && prev.dataset.t && prev !== el) {
    const ps = prev.closest<HTMLElement>('[data-s]');
    if (ps && ps !== s && !ps.querySelector('button[tabindex="0"]')) prev.tabIndex = 0;
  }
  el.tabIndex = 0;
  el.focus();
}

export function ReaderBody({
  body,
  text,
  view,
  highlight,
  selection,
  speaking,
  onWord,
  targets,
  translations,
  fontScale = 1,
}: Props) {
  const { t } = useTranslation();
  const pick = (e: MouseEvent<HTMLElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
    if (!el) return;
    e.preventDefault();
    onWord(Number(el.dataset.t));
  };
  const move = (e: KeyboardEvent<HTMLElement>) => {
    const el = e.target as HTMLElement;
    if (!(el instanceof HTMLButtonElement) || !el.dataset.t) return;
    const root = e.currentTarget;
    const i = Number(el.dataset.t);
    let to: HTMLButtonElement | null = null;
    if (e.key === 'ArrowRight') to = wordAt(root, i + 1);
    else if (e.key === 'ArrowLeft') to = wordAt(root, i - 1);
    else if (e.key === 'Home' || e.key === 'End') {
      const words = el.closest('[data-s]')?.querySelectorAll<HTMLButtonElement>('button[data-t]');
      to = words ? (e.key === 'Home' ? words[0] : words[words.length - 1]) ?? null : null;
    } else return;
    e.preventDefault();
    if (to) focusWord(root, to);
  };
  return (
    <div
      className="flex flex-col gap-5 font-serif text-reading text-fg [overflow-wrap:anywhere]"
      lang="en"
      style={fontScale === 1 ? undefined : { fontSize: `calc(var(--text-reading) * ${fontScale})` }}
      data-testid="reader-text"
      onClick={pick}
      onKeyDown={move}
    >
      {text.paragraphs.map((p, i) => {
        const tr = translations?.[i];
        const para = (
          <Paragraph
            key={i}
            index={i}
            body={body}
            text={text}
            paragraph={p}
            view={view}
            highlight={highlight}
            targets={targets}
            selection={selection && inParagraph(text, p, selection.first) ? selection : null}
            speaking={
              speaking !== null && speaking >= p.firstSentence && speaking < p.endSentence
                ? speaking
                : null
            }
          />
        );
        if (!tr) return para;
        return (
          <div key={i} className="flex flex-col gap-2">
            {para}
            <p
              lang="tr"
              className="border-l-2 border-border pl-3 font-sans text-ui font-normal text-fg-muted"
              data-testid="reader-translation"
            >
              {tr}
            </p>
          </div>
        );
      })}
      <span id={MARK_DESCRIPTION_ID.new} className="sr-only">
        {t('reader.mark.new')}
      </span>
      <span id={MARK_DESCRIPTION_ID.learning} className="sr-only">
        {t('reader.mark.learning')}
      </span>
      <span id={MARK_DESCRIPTION_ID.consolidating} className="sr-only">
        {t('reader.mark.consolidating')}
      </span>
      <span id={MARK_DESCRIPTION_ID.target} className="sr-only">
        {t('reader.mark.target')}
      </span>
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
  targets?: ReadonlySet<number>;
}

const describedBy = (mark: WordMark, target: boolean): string | undefined => {
  const ids = [
    target ? MARK_DESCRIPTION_ID.target : null,
    mark === 'plain' ? null : MARK_DESCRIPTION_ID[mark],
  ].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
};

const Paragraph = memo(function Paragraph({
  index,
  body,
  text,
  paragraph,
  view,
  highlight,
  selection,
  speaking,
  targets,
}: ParagraphProps) {
  const parts: React.ReactNode[] = [];
  for (let s = paragraph.firstSentence; s < paragraph.endSentence; s++) {
    const sen = text.sentences[s]!;
    // The sentence's Tab stop: its first marked word (or story word), else its first word.
    let stop = sen.firstToken;
    if (view)
      for (let i = sen.firstToken; i < sen.endToken; i++)
        if (view.marks[i] !== 'plain' || targets?.has(i)) {
          stop = i;
          break;
        }
    const words: React.ReactNode[] = [];
    let at = sen.start;
    for (let i = sen.firstToken; i < sen.endToken; i++) {
      const tok = text.tokens[i]!;
      if (tok.start > at) words.push(body.slice(at, tok.start));
      // What the word is (spoken even when the colours are off) and how it is drawn.
      const state = view ? view.marks[i]! : 'plain';
      const mark = highlight ? state : 'plain';
      const selected = selection !== null && i >= selection.first && i < selection.end;
      const target = targets?.has(i) === true;
      words.push(
        <button
          key={i}
          type="button"
          data-t={i}
          data-mark={mark === 'plain' ? undefined : mark}
          data-target={target || undefined}
          tabIndex={i === stop ? 0 : -1}
          aria-describedby={describedBy(state, target)}
          aria-expanded={selected || undefined}
          className={cn(
            'inline cursor-pointer rounded-xs text-left transition-colors duration-(--duration-micro) hover:bg-hover',
            MARK_CLASS[mark],
            target && 'font-semibold',
            selected && 'ring-2 ring-focus',
          )}
        >
          {tok.text}
        </button>,
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
          'rounded-xs transition-colors duration-(--duration-micro)',
          speaking === s && 'bg-surface-sunken',
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
