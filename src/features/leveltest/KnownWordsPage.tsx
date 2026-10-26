// Ayarlar → Seviye → Bildiğim kelimeler: the known words, with search, add and remove (undo).
import { useLiveQuery } from 'dexie-react-hooks';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { listKnownTerms, logError, markKnown, unmarkKnown } from '@/data';
import { normalizeTerm } from '@/domain/normalize';
import type { KnownTerm } from '@/domain/types';
import { Badge, Button, EmptyState, Icon, Page, Skeleton, Surface, TextField, toast } from '@/ui';

export function KnownWordsPage() {
  const { t } = useTranslation();
  const words = useLiveQuery(() => listKnownTerms(), []);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');

  const shown = useMemo(() => {
    const q = normalizeTerm(query);
    const list = [...(words ?? [])].sort((a, b) => a.term_norm.localeCompare(b.term_norm, 'en'));
    return q ? list.filter((k) => k.term_norm.includes(q)) : list;
  }, [words, query]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const term = draft.trim();
    if (!normalizeTerm(term)) return;
    markKnown(term, 'manual')
      .then((k) => {
        setDraft('');
        toast({ title: t('knownWords.added', { term: k.term_norm }), tone: 'success' });
      })
      .catch((err: unknown) => {
        void logError(err, 'knownWords.add');
        toast({ title: t('knownWords.failed'), tone: 'danger' });
      });
  };

  const remove = (k: KnownTerm) => {
    unmarkKnown(k.term_norm)
      .then(() =>
        toast({
          title: t('knownWords.removed', { term: k.term_norm }),
          action: {
            label: t('knownWords.undo'),
            onClick: () =>
              void markKnown(k.term_norm, k.source === 'auto' ? 'manual' : k.source).catch(
                (err: unknown) => void logError(err, 'knownWords.undo'),
              ),
          },
        }),
      )
      .catch((err: unknown) => {
        void logError(err, 'knownWords.remove');
        toast({ title: t('knownWords.failed'), tone: 'danger' });
      });
  };

  return (
    <Page title={t('knownWords.title')} description={t('knownWords.description')}>
      <div className="flex flex-col gap-5">
        <Link
          to="/settings/seviye"
          className="-mt-2 inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-accent-text underline-offset-4 hover:underline"
        >
          <Icon name="chevron-left" size={16} />
          {t('knownWords.back')}
        </Link>

        <form onSubmit={add} className="flex items-end gap-2">
          <TextField
            label={t('knownWords.addLabel')}
            placeholder={t('knownWords.addPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            lang="en"
            fieldClassName="flex-1"
          />
          <Button type="submit" variant="secondary" disabled={!draft.trim()}>
            {t('knownWords.add')}
          </Button>
        </form>

        {!words ? (
          <Surface>
            <Skeleton lines={4} />
          </Surface>
        ) : words.length === 0 ? (
          <EmptyState icon="check" title={t('knownWords.empty')} />
        ) : (
          <>
            <div className="flex items-end justify-between gap-3">
              <TextField
                label={t('knownWords.search')}
                hideLabel
                placeholder={t('knownWords.search')}
                leadingIcon="search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                fieldClassName="flex-1"
              />
              <span className="tabular shrink-0 pb-3 text-sm text-fg-muted">
                {t('knownWords.count', { count: words.length })}
              </span>
            </div>
            {shown.length === 0 ? (
              <p className="text-[0.9375rem] text-fg-muted">{t('knownWords.noMatch')}</p>
            ) : (
              <ul
                className="divide-y divide-border rounded-card border border-border bg-surface"
                data-testid="known-words"
              >
                {shown.map((k) => (
                  <li key={k.id} className="flex min-h-13 items-center gap-3 py-1 pr-2 pl-4">
                    <span
                      lang="en"
                      className="min-w-0 flex-1 truncate font-serif text-lg font-semibold text-fg"
                    >
                      {k.term_norm}
                    </span>
                    {k.cefr_at_mark && (
                      <span className="tabular text-sm text-fg-muted">{k.cefr_at_mark}</span>
                    )}
                    <Badge>{t(`knownWords.source.${k.source}`)}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('knownWords.removeLabel', { term: k.term_norm })}
                      onClick={() => remove(k)}
                    >
                      {t('knownWords.remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Page>
  );
}
