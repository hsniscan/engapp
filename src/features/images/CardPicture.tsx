// One picture as an <img> (v0.4 İP3). The SVG goes through the sanitizer and the theme swap
// into a `data:` URL; it never enters the DOM as markup, so nothing in it can run. The theme
// hook re-renders it when the user switches between light and dark.
import { useTranslation } from 'react-i18next';
import type { Id } from '@/domain/types';
import { Badge, cn, useTheme } from '@/ui';
import { pictureSrc } from './picture';

export interface PictureLike {
  id: Id;
  svg: string;
  /** Turkish alt text (lexicon_images.alt_tr). */
  alt: string;
  /** Not yet looked at by a person. */
  isNew?: boolean;
}

export function CardPicture({
  image,
  className,
  showNew = true,
  decorative = false,
}: {
  image: PictureLike;
  /** Size classes (the picture is square). */
  className?: string;
  /** Show the "Yeni" badge for a picture still waiting for review. */
  showNew?: boolean;
  /** The picture repeats what text next to it says (e.g. a variant chooser): empty alt. */
  decorative?: boolean;
}) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const src = pictureSrc(image, resolved);
  if (!src) return null;
  return (
    <span className={cn('relative inline-flex shrink-0', className)} data-testid="card-picture" data-picture-id={image.id}>
      <img
        src={src}
        alt={decorative ? '' : image.alt}
        width={256}
        height={256}
        draggable={false}
        className="size-full select-none"
      />
      {showNew && image.isNew && (
        <Badge tone="accent" className="absolute -right-1 -bottom-1 h-5 px-1.5 shadow-sm">
          <span aria-hidden="true">{t('images.newBadge')}</span>
          <span className="sr-only">{t('images.newBadgeLabel')}</span>
        </Badge>
      )}
    </span>
  );
}
