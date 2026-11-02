import type { ReactNode } from 'react';
import { PageFrame } from '@/ui';

/**
 * Frame of the settings index and its sub-pages (design 4.16): the shared PageFrame at
 * reading width with a back link, the page's single h1 and an optional lead sentence.
 */
export function SettingsFrame({
  title,
  description,
  back,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  back: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <PageFrame width="reading" title={title} description={description} back={back}>
      {children}
    </PageFrame>
  );
}
