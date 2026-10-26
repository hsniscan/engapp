import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Icon, Page, Tabs } from '@/ui';
import { addTabPanels, type AddTabId } from './addTabs';
import { ManualAddForm } from './ManualAddForm';

const TABS: AddTabId[] = ['manual', 'paste', 'pdf'];
const isTab = (v: string | null): v is AddTabId => !!v && (TABS as string[]).includes(v);

/** Permanent note on the import tabs: free-tier AI may be read by reviewers (plan, "Gizlilik uyarısı"). */
export function PrivacyNote() {
  const { t } = useTranslation();
  return (
    <p className="mb-5 flex items-start gap-2 rounded-control bg-warn-soft px-3 py-2.5 text-sm text-warn-text">
      <Icon name="alert" size={18} className="mt-px shrink-0" />
      <span>
        <strong className="font-semibold">{t('cards.import.privacy')}</strong>{' '}
        {t('cards.import.privacyWhy')}
      </span>
    </p>
  );
}

/** Way into the word bank (decision 0038), above the tabs. */
function WordBankEntry() {
  const { t } = useTranslation();
  return (
    <aside className="mb-6 flex flex-col gap-1 rounded-card border border-border bg-surface px-4 py-3">
      <p className="font-medium text-fg">{t('wordBank.entryTitle')}</p>
      <p className="text-sm text-fg-muted">{t('wordBank.entryBody')}</p>
      <Link
        to="/decks?tab=bank"
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.9375rem] font-medium text-accent-text underline-offset-4 hover:underline"
      >
        <Icon name="layers" size={18} />
        {t('wordBank.entryLink')}
      </Link>
    </aside>
  );
}

/** Way into the Anki import (v0.3 İP1), under every tab. */
function AnkiEntry() {
  const { t } = useTranslation();
  return (
    <aside className="mt-8 flex flex-col gap-1 border-t border-border pt-5">
      <p className="font-medium text-fg">{t('anki.entry.title')}</p>
      <p className="text-sm text-fg-muted">{t('anki.entry.body')}</p>
      <Link
        to="/import/anki"
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.9375rem] font-medium text-accent-text underline-offset-4 hover:underline"
      >
        <Icon name="layers" size={18} />
        {t('anki.entry.link')}
      </Link>
    </aside>
  );
}

/** /add — three tabs. The tab is kept in the URL (?tab=paste) so links and reloads land on it. */
export function AddPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: AddTabId = isTab(tabParam) ? tabParam : 'manual';
  const Paste = addTabPanels.paste;
  const Pdf = addTabPanels.pdf;
  return (
    <Page title={t('add.title')} description={t('cards.add.pageHint')}>
      <WordBankEntry />
      <Tabs
        label={t('add.title')}
        value={tab}
        onValueChange={(v) =>
          setParams(
            (p) => {
              if (v === 'manual') p.delete('tab');
              else p.set('tab', v);
              return p;
            },
            { replace: true },
          )
        }
        items={[
          { value: 'manual', label: t('cards.tabs.manual'), content: <ManualAddForm /> },
          {
            value: 'paste',
            label: t('cards.tabs.paste'),
            content: (
              <>
                <PrivacyNote />
                <Paste />
              </>
            ),
          },
          {
            value: 'pdf',
            label: t('cards.tabs.pdf'),
            content: (
              <>
                <PrivacyNote />
                <Pdf />
              </>
            ),
          },
        ]}
      />
      <AnkiEntry />
    </Page>
  );
}
