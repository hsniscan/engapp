import type { ReactNode } from 'react';
import { PageFrame } from './PageFrame';

export interface PageProps {
  title: ReactNode;
  hideTitle?: boolean;
  description?: ReactNode;
  actions?: ReactNode;
  width?: 'reading' | 'wide';
  children?: ReactNode;
  className?: string;
}

/**
 * @deprecated v0.5.2: use `PageFrame` (same props, plus eyebrow/back; default width 'wide').
 * Adapter kept so existing screens build; `className` now goes on the frame.
 */
export function Page({ width = 'reading', className, ...rest }: PageProps) {
  return <PageFrame width={width} frameClassName={className} {...rest} />;
}
