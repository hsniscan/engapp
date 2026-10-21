import { LIMITS } from '@/domain/limits';
import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, cn } from '@/ui';

export interface TagInputProps {
  label: string;
  value: string[];
  onChange: (tags: string[]) => void;
  /** Existing tags offered as suggestions (datalist). */
  suggestions?: string[];
  className?: string;
}

function cleanTag(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim().replace(/^#/, '');
}

/** Chips + a text input. Enter or comma adds a tag; Backspace on an empty input removes the last one. */
export function TagInput({ label, value, onChange, suggestions = [], className }: TagInputProps) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const parts = raw.split(',').map(cleanTag).filter(Boolean);
    if (parts.length === 0) return;
    const next = [...value];
    for (const p of parts)
      if (!next.some((x) => x.toLocaleLowerCase('tr') === p.toLocaleLowerCase('tr'))) next.push(p);
    onChange(next.slice(0, LIMITS.tags)); // the server keeps at most LIMITS.tags tags per note
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      if (draft.trim()) {
        e.preventDefault();
        add(draft);
      } else if (e.key === ',') e.preventDefault();
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const unused = suggestions.filter((s) => !value.includes(s));

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className="flex items-baseline justify-between gap-2 text-sm font-medium text-fg"
      >
        <span>{label}</span>
        <span className="text-xs font-normal text-fg-muted">{t('common.optional')}</span>
      </label>
      <div
        className={cn(
          'flex min-h-11 flex-wrap items-center gap-1.5 rounded-control border border-border-strong/70 bg-surface px-2 py-1.5',
          'transition-[border-color] duration-(--duration-micro) hover:border-border-strong',
          'has-[input:focus-visible]:border-accent has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-focus/30',
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex h-8 items-center gap-1 rounded-sm bg-surface-sunken pr-0.5 pl-2 text-sm text-fg"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== tag))}
              aria-label={t('cards.tags.remove', { tag })}
              className="relative inline-flex size-7 items-center justify-center rounded-[4px] text-fg-muted hover:bg-hover hover:text-fg after:absolute after:-inset-1 after:content-['']"
            >
              <Icon name="x" size={16} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(',')) add(v);
            else setDraft(v);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
          list={unused.length ? `${id}-list` : undefined}
          placeholder={value.length ? '' : t('cards.tags.placeholder')}
          aria-describedby={`${id}-hint`}
          enterKeyHint="done"
          autoCapitalize="none"
          className="h-8 min-w-24 flex-1 bg-transparent px-1 text-base text-fg outline-none placeholder:text-fg-subtle"
        />
        {unused.length > 0 && (
          <datalist id={`${id}-list`}>
            {unused.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </div>
      <p id={`${id}-hint`} className="text-sm text-fg-muted">
        {t('cards.tags.hint')}
      </p>
    </div>
  );
}
