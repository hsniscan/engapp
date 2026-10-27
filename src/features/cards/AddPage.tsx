// /add (v0.5.1, decision 0056): the two pages behind the (+) sheet that need room.
//
//   /add, /add?term=…          "Kelime ekle": the full form (the sheet's "Elle düzenle")
//   /add?tab=paste | tab=pdf   "Metin ekle": paste or PDF, then the capture's two ways on
//
// The tab is kept in the URL so links and reloads land on it; old links (?tab=manual) still work.
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Icon, Page, Tabs, type IconName } from '@/ui';
import { addTabPanels } from './addTabs';
import { ManualAddForm } from './ManualAddForm';

type TextTab = 'paste' | 'pdf';
const isTextTab = (v: string | null): v is TextTab => v === 'paste' || v === 'pdf';

const OTHER_WAYS: { to: string; icon: IconName; key: 'link' | 'photo' | 'subtitle' }[] = [
  { to: '/makale', icon: 'link', key: 'link' },
  { to: '/fotograf', icon: 'camera', key: 'photo' },
  { to: '/altyazi', icon: 'captions', key: 'subtitle' },
];

/** The other text sources, one tap away (each ends on the same two choices). */
function OtherWays() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('add.otherWays')} className="mt-8 flex flex-col gap-2">
      <p className="text-sm text-fg-muted">{t('add.otherWays')}</p>
      <ul className="flex flex-wrap gap-2">
        {OTHER_WAYS.map((w) => (
          <li key={w.key}>
            <Link
              to={w.to}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[0.9375rem] font-medium text-fg transition-colors duration-(--duration-micro) hover:border-border-strong"
            >
              <Icon name={w.icon} size={18} className="text-fg-muted" />
              {t(`addSheet.text.${w.key}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AddPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');

  if (!isTextTab(tabParam)) {
    return (
      <Page title={t('add.wordTitle')} description={t('add.wordLead')}>
        <ManualAddForm />
      </Page>
    );
  }

  const Paste = addTabPanels.paste;
  const Pdf = addTabPanels.pdf;
  return (
    <Page title={t('add.textTitle')} description={t('add.textLead')}>
      <Tabs
        label={t('add.textTitle')}
        value={tabParam}
        onValueChange={(v) =>
          setParams(
            (p) => {
              p.set('tab', v);
              return p;
            },
            { replace: true },
          )
        }
        items={[
          { value: 'paste', label: t('addSheet.text.paste'), content: <Paste /> },
          { value: 'pdf', label: t('addSheet.text.pdf'), content: <Pdf /> },
        ]}
      />
      <OtherWays />
    </Page>
  );
}
