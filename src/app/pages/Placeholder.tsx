import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, Page, type IconName } from '@/ui';

export function Placeholder({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Page title={title}>
      {children ?? <EmptyState icon={icon} title={title} description={t('placeholder.body')} />}
    </Page>
  );
}
