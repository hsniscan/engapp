import { useState } from 'react';
import { cn } from '@/ui';

/** Google profile photo with an initial as fallback (also when offline). */
export function Avatar({
  src,
  name,
  size = 44,
  className,
}: {
  src: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name.trim()[0] ?? '?').toLocaleUpperCase('tr');
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft font-serif font-semibold text-accent-text',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
