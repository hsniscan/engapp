import { useTranslation } from 'react-i18next';
import { cn } from '../cn';
import { E_PATH, TICK_PATH, glyphTransform } from './mark';

export interface LogoProps {
  /** Mark size in px. */
  size?: number;
  /** Show the "Engapp" wordmark next to the mark. */
  wordmark?: boolean;
  className?: string;
}

/** Theme-aware mark (+ optional wordmark). Decorative unless used alone as a link label. */
export function Logo({ size = 28, wordmark = true, className }: LogoProps) {
  const { t } = useTranslation();
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="shrink-0">
        <rect width="512" height="512" rx="112" fill="var(--fg)" />
        <g transform={glyphTransform()}>
          <path fill="var(--logo-tick)" transform="translate(0 -40)" d={TICK_PATH} />
          <path fill="var(--canvas)" transform="translate(176 0)" d={E_PATH} />
        </g>
      </svg>
      {wordmark ? (
        <span className="font-serif text-[1.3125rem] leading-none font-semibold tracking-[-0.01em] text-fg">
          {t('app.name')}
        </span>
      ) : (
        <span className="sr-only">{t('app.name')}</span>
      )}
    </span>
  );
}
