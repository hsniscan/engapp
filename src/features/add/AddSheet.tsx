// "Ne eklemek istersin?": the sheet behind the raised (+) of the tab bar (board AddSheet).
// A quick one-word add on top, then every way in: one word, a text or PDF, the word bank,
// ready-made decks and Anki. Each row leads to the existing flow; the sheet only routes.
import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { LIMITS } from '@/domain/limits';
import { cn, Dialog, Icon, type IconName } from '@/ui';
import { quickAddHref, setAddSheetOpen, useAddSheetOpen } from './addSheetStore';

interface Way {
  to: string;
  icon: IconName;
  tone: 'accent' | 'success' | 'neutral' | 'warn';
  title: string;
  body: string;
  testId: string;
}

const toneClass: Record<Way['tone'], string> = {
  accent: 'bg-accent-soft text-accent-text',
  success: 'bg-success-soft text-success-text',
  neutral: 'bg-surface-sunken text-fg',
  warn: 'bg-warn-soft text-warn-text',
};

export function AddSheet() {
  const open = useAddSheetOpen();
  return <AddSheetView open={open} onOpenChange={setAddSheetOpen} />;
}

export function AddSheetView({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');

  const close = () => {
    onOpenChange(false);
    setTerm('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!term.trim()) {
      inputRef.current?.focus();
      return;
    }
    const href = quickAddHref(term);
    close();
    void navigate(href);
  };

  const ways: Way[] = [
    {
      to: '/add',
      icon: 'pencil',
      tone: 'accent',
      title: t('addSheet.wordTitle'),
      body: t('addSheet.wordBody'),
      testId: 'add-way-word',
    },
    {
      to: '/add?tab=paste',
      icon: 'file',
      tone: 'success',
      title: t('addSheet.textTitle'),
      body: t('addSheet.textBody'),
      testId: 'add-way-text',
    },
    {
      to: '/decks?tab=bank',
      icon: 'layers',
      tone: 'neutral',
      title: t('addSheet.bankTitle'),
      body: t('addSheet.bankBody'),
      testId: 'add-way-bank',
    },
    {
      to: '/decks?tab=discover',
      icon: 'cards',
      tone: 'accent',
      title: t('addSheet.decksTitle'),
      body: t('addSheet.decksBody'),
      testId: 'add-way-decks',
    },
    {
      to: '/import/anki',
      icon: 'upload',
      tone: 'warn',
      title: t('addSheet.ankiTitle'),
      body: t('addSheet.ankiBody'),
      testId: 'add-way-anki',
    },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      variant="sheet"
      title={t('addSheet.title')}
      className="bg-surface pb-[max(1.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex flex-col gap-4" data-testid="add-sheet">
        <form onSubmit={submit} className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="pl-1 text-sm text-fg-muted">
            {t('addSheet.quickLabel')}
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              lang="en"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('addSheet.quickPlaceholder')}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={LIMITS.term}
              className={cn(
                'h-13 min-w-0 flex-1 rounded-[14px] border border-border bg-surface-raised px-4',
                'font-serif text-lg text-fg placeholder:text-fg-subtle',
                'focus-visible:border-accent',
              )}
            />
            <button
              type="submit"
              aria-label={t('addSheet.quickSubmit')}
              className="flex size-13 shrink-0 items-center justify-center rounded-[14px] bg-accent text-accent-fg transition-colors duration-(--duration-micro) hover:bg-accent-hover"
            >
              <Icon name="arrow-right" size={22} strokeWidth={2} />
            </button>
          </div>
        </form>

        <ul className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-surface-raised">
          {ways.map((w, i) => (
            <li key={w.testId} className={cn(i > 0 && 'border-t border-surface-sunken')}>
              <Link
                to={w.to}
                onClick={close}
                data-testid={w.testId}
                className="flex min-h-18 items-center gap-3.5 px-4 py-3.5 text-fg transition-colors duration-(--duration-micro) hover:bg-hover"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-11 shrink-0 items-center justify-center rounded-[13px]',
                    toneClass[w.tone],
                  )}
                >
                  <Icon name={w.icon} size={22} strokeWidth={1.7} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-base font-semibold">{w.title}</span>
                  <span className="text-sm text-fg-muted">{w.body}</span>
                </span>
                <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
