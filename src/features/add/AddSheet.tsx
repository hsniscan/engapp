// "Ekle": the sheet behind the (+) of the tab bar (v0.5.1, decision 0056; v0.5.2 "Çam" layout,
// ADR 0068). Three groups, top to bottom:
//
//   Kelime ekle                  a word, looked up at once (the user's card → Kelime Bankası →
//                                the lexicon → yapay zekâ when signed in); "Elle düzenle" opens
//                                the full form
//   Metin ekle                   a 2-column grid (3 from 400 px) of tiles whose labels wrap,
//                                never cut: Yapıştır · PDF · Bağlantı · Fotoğraf · Altyazı each
//                                save the text and open the reader (extraction is the second
//                                choice); Metin oluştur writes a text around the user's words
//   İçe aktar                    Anki, CSV, a backup file
//
// Ready-made decks and the word bank live in Keşfet and Kelimelerim, not here.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { db } from '@/data';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LIMITS } from '@/domain/limits';
import { MineMeanings, SenseChoices } from '@/features/quick/QuickSheet';
import { useTermLookup } from '@/features/quick/useTermLookup';
import { SignInNeeded } from './SignInNeeded';
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  Eyebrow,
  Icon,
  IconTile,
  ListGroup,
  Sheet,
  Skeleton,
  Term,
  TextField,
  type IconName,
} from '@/ui';
import { Notice } from './ui';
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
  // "Metin oluştur" is a tile of the text group since v0.5.2.
  useEffect(() => {
    if (!open || !section) return;
    const id = window.setTimeout(() => {
      if (section === 'word') inputRef.current?.focus();
      else
        groups.current[section === 'compose' ? 'text' : section]?.scrollIntoView?.({
          block: 'start',
          behavior: 'smooth',
        });
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
    {
      to: '/metin-olustur',
      icon: 'pen',
      label: t('addSheet.text.compose'),
      testId: 'add-way-compose',
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
      icon: 'list',
      label: t('addSheet.import.csv'),
      body: t('addSheet.import.csvBody'),
      testId: 'add-way-csv',
    },
    {
      to: '/settings/veri',
      icon: 'database',
      label: t('addSheet.import.backup'),
      body: t('addSheet.import.backupBody'),
      testId: 'add-way-backup',
    },
  ];

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t('addSheet.title')}
    >
      <div className="flex flex-col gap-8" data-testid="add-sheet">
        <Group id="add-sheet-word" title={t('addSheet.word.title')} sectionRef={groupRef('word')}>
          <WordAdd inputRef={inputRef} onNavigate={close} />
        </Group>

        <Group id="add-sheet-text" title={t('addSheet.text.title')} sectionRef={groupRef('text')}>
          <ul className="grid grid-cols-2 gap-2 min-[25rem]:grid-cols-3">
            {textWays.map((w) => (
              <li key={w.testId} className="flex min-w-0">
                <Card
                  as={Link}
                  to={w.to}
                  onClick={close}
                  interactive
                  inset
                  padding="sm"
                  data-testid={w.testId}
                  className="flex min-h-24 w-full flex-col items-start gap-2 text-fg"
                >
                  <IconTile icon={w.icon} />
                  <span className="text-ui font-medium break-words hyphens-auto">{w.label}</span>
                </Card>
              </li>
            ))}
          </ul>
          <p className="px-1 text-meta text-fg-muted">{t('addSheet.text.body')}</p>
          <JobsLink onNavigate={close} />
        </Group>

        <Group
          id="add-sheet-import"
          title={t('addSheet.import.title')}
          sectionRef={groupRef('import')}
        >
          <ListGroup>
            {importWays.map((w) => (
              <Link
                key={w.testId}
                to={w.to}
                onClick={close}
                data-testid={w.testId}
                className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition-colors duration-(--duration-micro) hover:bg-hover focus-visible:outline-offset-[-2px]"
              >
                <IconTile icon={w.icon} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-3">
                  <span className="text-ui font-medium text-fg">{w.label}</span>
                  <span className="text-meta text-fg-muted">{w.body}</span>
                </span>
                <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
              </Link>
            ))}
          </ListGroup>
        </Group>
      </div>
    </Sheet>
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
      className="flex scroll-mt-4 flex-col gap-3"
    >
      <Eyebrow as="h3" className="px-1">
        <span id={id}>{title}</span>
      </Eyebrow>
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
      <form onSubmit={submit} className="flex items-start gap-2">
        <TextField
          ref={inputRef}
          label={t('addSheet.word.field')}
          hideLabel
          hint={query ? undefined : t('addSheet.word.label')}
          type="text"
          lang="en"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            if (query) setQuery('');
          }}
          placeholder={t('addSheet.word.field')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={LIMITS.term}
          data-testid="add-word-input"
          fieldClassName="min-w-0 flex-1"
          className="font-serif text-lead"
        />
        <Button type="submit" variant={query ? 'secondary' : 'primary'} className="shrink-0">
          {t('addSheet.word.submit')}
        </Button>
      </form>
      {query ? (
        <WordResult key={query} term={query} onNavigate={onNavigate} onAgain={again} />
      ) : (
        <Link
          to="/add"
          onClick={onNavigate}
          className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'self-start' })}
          data-testid="add-way-word"
        >
          <Icon name="pencil" size={16} />
          {t('addSheet.word.manual')}
        </Link>
      )}
    </div>
  );
}

/** "2 kelime çıkarma sürüyor" → every extraction job in one place (B2). */
function JobsLink({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation();
  const open = useLiveQuery(
    () => db.import_jobs.where('status').anyOf('queued', 'processing', 'ready', 'failed').count(),
    [],
  );
  if (!open) return null;
  return (
    <Link
      to="/import"
      onClick={onNavigate}
      data-testid="add-jobs-link"
      className={buttonClasses({ variant: 'tonal', size: 'sm', className: 'self-start' })}
    >
      <Icon name="sync-pending" size={16} />
      {t('importer.jobs.link', { count: open })}
    </Link>
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
      className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'self-center' })}
      data-testid="add-word-manual"
    >
      <Icon name="pencil" size={16} />
      {/* Nothing found: there is nothing to edit, so it stays "Elle ekle" (B4). */}
      {senses.length === 0 && mine.length === 0
        ? t('addSheet.word.manual')
        : t('addSheet.word.edit')}
    </Link>
  );

  if (saved) {
    const nothing = saved.added === 0;
    return (
      <Card
        tone="sunken"
        inset
        role="status"
        className="flex flex-col items-start gap-3"
        data-testid="add-word-saved"
      >
        <p className="flex items-center gap-2 text-ui font-medium text-fg">
          <Icon
            name={nothing ? 'info' : 'check'}
            size={18}
            className={nothing ? 'text-fg-muted' : 'text-success-text'}
          />
          {nothing
            ? t('quick.nothingNew', { term: saved.term })
            : t('quick.saved', { term: saved.term })}
        </p>
        <Button variant="secondary" onClick={onAgain}>
          {t('addSheet.word.another')}
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="add-word-result">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-1">
        <Term size="title">{shown}</Term>
        {preview?.ipa && (
          <span lang="en" className="font-serif text-meta text-fg-muted">
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
          <Skeleton className="h-14 w-full rounded-inner" />
        </div>
      ) : senses.length > 0 ? (
        <SenseChoices senses={senses} picked={picked} onToggle={toggle} />
      ) : mine.length > 0 ? null : lookup === 'signin' ? (
        // A guest gets the Google button right here, not only a sentence (B4).
        <SignInNeeded title={t('addSheet.word.signIn')} testId="add-word-signin" />
      ) : (
        <Notice tone={lookup === 'failed' ? 'danger' : 'muted'}>
          {t(
            lookup === 'offline'
              ? 'addSheet.word.offline'
              : lookup === 'failed'
                ? 'quick.failed'
                : 'addSheet.word.notFound',
          )}
        </Notice>
      )}
      {addError && (
        <p role="alert" className="text-meta text-danger-text">
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
