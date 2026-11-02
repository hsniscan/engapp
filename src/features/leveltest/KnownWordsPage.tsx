// Ayarlar → Seviye → Bildiğim kelimeler: the known words, with search, add and remove (undo).
import { useLiveQuery } from 'dexie-react-hooks';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { listKnownTerms, logError, markKnown, unmarkKnown } from '@/data';
import { normalizeTerm } from '@/domain/normalize';
import type { KnownTerm } from '@/domain/types';
import { Button, EmptyState, ListGroup, ListRow, PageFrame, Skeleton, TextField, toast } from '@/ui';

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
        toast.undo({
          title: t('knownWords.removed', { term: k.term_norm }),
          undoLabel: t('ui.undo'),
          onUndo: () =>
            void markKnown(k.term_norm, k.source === 'auto' ? 'manual' : k.source).catch(
              (err: unknown) => void logError(err, 'knownWords.undo'),
            ),
        }),
      )
      .catch((err: unknown) => {
        void logError(err, 'knownWords.remove');
        toast({ title: t('knownWords.failed'), tone: 'danger' });
      });
  };


  return (
    <PageFrame
      width="reading"
      back={{ to: '/settings/seviye', label: t('knownWords.back') }}
      title={t('knownWords.title')}
      description={t('knownWords.description')}
    >
      <div className="flex flex-col gap-6">
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
          <div aria-busy="true">
            <Skeleton lines={4} />
          </div>
        ) : words.length === 0 ? (
          <EmptyState tone="placeholder" compact icon="check" title={t('knownWords.empty')} />
        ) : (
          <section aria-label={t('knownWords.title')} className="flex flex-col gap-3">
            <TextField
              label={t('knownWords.search')}
              hideLabel
              placeholder={t('knownWords.search')}
              leadingIcon="search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {shown.length === 0 ? (
              <EmptyState
                tone="placeholder"
                compact
                icon="search"
                title={t('knownWords.noMatch')}
              />
            ) : (
              <ListGroup
                label={t('knownWords.count', { count: words.length })}
                data-testid="known-words"
              >
                {shown.map((k) => (
                  <ListRow
                    key={k.id}
                    term
                    title={k.term_norm}
                    description={[k.cefr_at_mark, t(`knownWords.source.${k.source}`)]
                      .filter(Boolean)
                      .join(' · ')}
                    trailing={
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('knownWords.removeLabel', { term: k.term_norm })}
                        onClick={() => remove(k)}
                        className="-mr-2"
                      >
                        {t('knownWords.remove')}
                      </Button>
                    }
                  />
                ))}
              </ListGroup>
            )}
          </section>
        )}
      </div>
    </PageFrame>
  );
}
