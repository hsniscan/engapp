// "Ne eklemek istersin?": the sheet behind the raised (+) of the tab bar (v0.5.1, decision 0056).
// Four groups, top to bottom:
//
//   Kelime ekle                  a word, looked up at once (the user's card → Kelime Bankası →
//                                the lexicon → yapay zekâ when signed in); "Elle düzenle" opens
//                                the full form
//   Metin ekle                   Yapıştır · PDF · Bağlantı · Fotoğraf · Altyazı: each saves the
//                                text and opens the reader (word extraction is the second choice)
//   Kelimelerimle metin oluştur  a short text around 3–8 of the user's own words
//   İçe aktar                    Anki, CSV, a backup file
//
// Ready-made decks and the word bank live in Keşfet and Kelimelerim, not here.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LIMITS } from '@/domain/limits';
import { MineMeanings, SenseChoices } from '@/features/quick/QuickSheet';
import { useTermLookup } from '@/features/quick/useTermLookup';
import { Badge, Button, cn, Dialog, Icon, Skeleton, type IconName } from '@/ui';
import {
  quickAddHref,
  setAddSheetOpen,
  useAddSheetState,
  type AddSheetSection,
} from './addSheetStore';

export function AddSheet() {
  const { open, section } = useAddSheetState();
  return <AddSheetView open={open} section={section} onOpenChange={setAddSheetOpen} />;
}

interface Way {
  to: string;
  icon: IconName;
  label: string;
  testId: string;
}

export function AddSheetView({
  open,
  section = null,
  onOpenChange,
}: {
  open: boolean;
  section?: AddSheetSection | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const close = () => onOpenChange(false);
  const groups = useRef<Partial<Record<AddSheetSection, HTMLElement | null>>>({});
  const groupRef = (key: AddSheetSection) => (el: HTMLElement | null) => {
    groups.current[key] = el;
  };
  const inputRef = useRef<HTMLInputElement>(null);

  // Opened at a group: bring it into view once the sheet has laid out ('word' also focuses).
  useEffect(() => {
    if (!open || !section) return;
    const id = window.setTimeout(() => {
      if (section === 'word') inputRef.current?.focus();
      else groups.current[section]?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }, 60);
    return () => window.clearTimeout(id);
  }, [open, section]);

  const textWays: Way[] = [
    { to: '/add?tab=paste', icon: 'file', label: t('addSheet.text.paste'), testId: 'add-way-text' },
    { to: '/add?tab=pdf', icon: 'upload', label: t('addSheet.text.pdf'), testId: 'add-way-pdf' },
    { to: '/makale', icon: 'link', label: t('addSheet.text.link'), testId: 'add-way-article' },
    { to: '/fotograf', icon: 'camera', label: t('addSheet.text.photo'), testId: 'add-way-photo' },
    {
      to: '/altyazi',
      icon: 'captions',
      label: t('addSheet.text.subtitle'),
      testId: 'add-way-subtitle',
    },
  ];
  const importWays: (Way & { body: string })[] = [
    {
      to: '/import/anki',
      icon: 'layers',
      label: t('addSheet.import.anki'),
      body: t('addSheet.import.ankiBody'),
      testId: 'add-way-anki',
    },
    {
      to: '/import/csv',
      icon: 'file',
      label: t('addSheet.import.csv'),
      body: t('addSheet.import.csvBody'),
      testId: 'add-way-csv',
    },
    {
      to: '/settings/veri',
      icon: 'refresh',
      label: t('addSheet.import.backup'),
      body: t('addSheet.import.backupBody'),
      testId: 'add-way-backup',
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
      <div className="flex flex-col gap-6" data-testid="add-sheet">
        <Group id="add-sheet-word" title={t('addSheet.word.title')} sectionRef={groupRef('word')}>
          <WordAdd inputRef={inputRef} onNavigate={close} />
        </Group>

        <Group id="add-sheet-text" title={t('addSheet.text.title')} sectionRef={groupRef('text')}>
          <ul className="grid grid-cols-5 gap-2">
            {textWays.map((w) => (
              <li key={w.testId} className="min-w-0">
                <Link
                  to={w.to}
                  onClick={close}
                  data-testid={w.testId}
                  className="flex min-h-19 flex-col items-center justify-center gap-1.5 rounded-[16px] border border-border bg-surface-raised px-1 py-2.5 text-center text-fg transition-colors duration-(--duration-micro) hover:bg-hover"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 items-center justify-center rounded-[11px] bg-success-soft text-success-text"
                  >
                    <Icon name={w.icon} size={20} strokeWidth={1.7} />
                  </span>
                  <span className="w-full truncate text-[0.8125rem] font-medium">{w.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-1 text-sm text-fg-muted">{t('addSheet.text.body')}</p>
        </Group>

        <Group
          id="add-sheet-compose"
          title={t('addSheet.compose.title')}
          sectionRef={groupRef('compose')}
        >
          <Link
            to="/metin-olustur"
            onClick={close}
            data-testid="add-way-compose"
            className="flex min-h-18 items-center gap-3.5 rounded-[20px] border border-accent/30 bg-accent-soft px-4 py-3.5 text-fg transition-colors duration-(--duration-micro) hover:border-accent/60"
          >
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-[13px] bg-accent text-accent-fg"
            >
              <Icon name="pencil" size={22} strokeWidth={1.7} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-base font-semibold">{t('addSheet.compose.cta')}</span>
              <span className="text-sm text-fg-muted">{t('addSheet.compose.body')}</span>
            </span>
            <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
          </Link>
        </Group>

        <Group
          id="add-sheet-import"
          title={t('addSheet.import.title')}
          sectionRef={groupRef('import')}
        >
          <ul className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-surface-raised">
            {importWays.map((w, i) => (
              <li key={w.testId} className={cn(i > 0 && 'border-t border-surface-sunken')}>
                <Link
                  to={w.to}
                  onClick={close}
                  data-testid={w.testId}
                  className="flex min-h-15 items-center gap-3.5 px-4 py-3 text-fg transition-colors duration-(--duration-micro) hover:bg-hover"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-surface-sunken text-fg"
                  >
                    <Icon name={w.icon} size={19} strokeWidth={1.7} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[0.9375rem] font-semibold">{w.label}</span>
                    <span className="text-sm text-fg-muted">{w.body}</span>
                  </span>
                  <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        </Group>
      </div>
    </Dialog>
  );
}

function Group({
  id,
  title,
  sectionRef,
  children,
}: {
  id: string;
  title: string;
  sectionRef: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section
      ref={sectionRef}
      aria-labelledby={id}
      data-testid={id}
      className="flex scroll-mt-4 flex-col gap-2.5"
    >
      <h3 id={id} className="pl-1 text-xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** "Kelime ekle": type a word, its meanings appear here; one tap puts it on a card. */
function WordAdd({
  inputRef,
  onNavigate,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = term.trim().slice(0, LIMITS.term);
    if (!clean) {
      inputRef.current?.focus();
      return;
    }
    setQuery(clean);
  };
  const again = () => {
    setTerm('');
    setQuery('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="pl-1 text-sm text-fg-muted">
          {t('addSheet.word.label')}
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            lang="en"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              if (query) setQuery('');
            }}
            placeholder={t('addSheet.quickPlaceholder')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={LIMITS.term}
            data-testid="add-word-input"
            className={cn(
              'h-13 min-w-0 flex-1 rounded-[14px] border border-border bg-surface-raised px-4',
              'font-serif text-lg text-fg placeholder:text-fg-subtle',
              'focus-visible:border-accent',
            )}
          />
          <button
            type="submit"
            aria-label={t('addSheet.word.submit')}
            className="flex size-13 shrink-0 items-center justify-center rounded-[14px] bg-accent text-accent-fg transition-colors duration-(--duration-micro) hover:bg-accent-hover"
          >
            <Icon name="search" size={22} strokeWidth={2} />
          </button>
        </div>
      </form>
      {query ? (
        <WordResult key={query} term={query} onNavigate={onNavigate} onAgain={again} />
      ) : (
        <Link
          to="/add"
          onClick={onNavigate}
          className="inline-flex min-h-11 items-center gap-1.5 self-start pl-1 text-[0.9375rem] font-medium text-accent-text underline-offset-4 hover:underline"
          data-testid="add-way-word"
        >
          <Icon name="pencil" size={16} />
          {t('addSheet.word.manual')}
        </Link>
      )}
    </div>
  );
}

function WordResult({
  term,
  onNavigate,
  onAgain,
}: {
  term: string;
  onNavigate: () => void;
  onAgain: () => void;
}) {
  const { t } = useTranslation();
  const { preview, lookup, picked, toggle, add, saving, saved, addError } = useTermLookup(term);
  const senses = preview?.senses ?? [];
  const mine = preview?.mine ?? [];
  const loading = preview === undefined || (senses.length === 0 && lookup === 'searching');
  const shown = preview?.term ?? term;

  const manual = (
    <Link
      to={quickAddHref(shown)}
      onClick={onNavigate}
      className="inline-flex min-h-11 items-center gap-1.5 self-center text-[0.9375rem] font-medium text-accent-text underline-offset-4 hover:underline"
      data-testid="add-word-manual"
    >
      <Icon name="pencil" size={16} />
      {t('addSheet.word.edit')}
    </Link>
  );

  if (saved) {
    const nothing = saved.added === 0;
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-[16px] bg-surface-sunken px-4 py-3"
        data-testid="add-word-saved"
      >
        <p className="flex items-center gap-2 font-medium text-fg">
          <Icon
            name={nothing ? 'info' : 'check'}
            size={18}
            className={nothing ? 'text-fg-muted' : 'text-success-text'}
          />
          {nothing
            ? t('quick.nothingNew', { term: saved.term })
            : t('quick.saved', { term: saved.term })}
        </p>
        <Button variant="secondary" onClick={onAgain} className="self-start">
          {t('addSheet.word.another')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="add-word-result">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 pl-1">
        <span lang="en" className="font-serif text-2xl font-semibold text-fg">
          {shown}
        </span>
        {preview?.ipa && (
          <span lang="en" className="font-serif text-sm text-fg-muted">
            /{preview.ipa.replace(/^\/|\/$/g, '')}/
          </span>
        )}
        {preview?.cefr && <Badge tone="outline">{preview.cefr}</Badge>}
      </div>
      {mine.length > 0 && <MineMeanings mine={mine} />}
      {loading ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          {lookup === 'searching' && (
            <p role="status" className="sr-only">
              {t('quick.searching')}
            </p>
          )}
          <Skeleton className="h-14 w-full rounded-[14px]" />
        </div>
      ) : senses.length > 0 ? (
        <SenseChoices senses={senses} picked={picked} onToggle={toggle} />
      ) : mine.length > 0 ? null : (
        <p
          role={lookup === 'failed' ? 'alert' : 'status'}
          className={cn(
            'rounded-[14px] bg-surface-sunken px-4 py-3 text-[0.9375rem]',
            lookup === 'failed' ? 'text-danger-text' : 'text-fg-muted',
          )}
        >
          {t(
            lookup === 'offline'
              ? 'addSheet.word.offline'
              : lookup === 'signin'
                ? 'addSheet.word.signIn'
                : lookup === 'failed'
                  ? 'quick.failed'
                  : 'addSheet.word.notFound',
          )}
        </p>
      )}
      {addError && (
        <p role="alert" className="text-sm text-danger-text">
          {addError}
        </p>
      )}
      {senses.length > 0 && (
        <Button
          size="lg"
          fullWidth
          leadingIcon="plus"
          loading={saving}
          disabled={loading || !picked.size}
          onClick={() => void add()}
          data-testid="add-word-save"
        >
          {t('quick.add')}
        </Button>
      )}
      {!loading && manual}
    </div>
  );
}
