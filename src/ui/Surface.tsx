import type { ComponentPropsWithRef, ElementType } from 'react';
import { Card } from './Card';

export interface SurfaceProps extends ComponentPropsWithRef<'div'> {
  tone?: 'flat' | 'raised' | 'sunken';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  as?: ElementType;
}

/** @deprecated v0.5.2: use `Card` (tone default | raised | sunken). Kept as an adapter. */
export function Surface({ tone = 'flat', ...rest }: SurfaceProps) {
  return <Card tone={tone === 'flat' ? 'default' : tone} {...rest} />;
}
