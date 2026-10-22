import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { WordLevel } from '@/domain/level';
import { Dialog } from '@/ui';
import { LevelBadge, LevelButton } from './LevelBadge';
import { useCorrectionLine } from './levelText';

/** Where a level comes from, in a sentence or two, with the Turkish-learner correction. */
export function LevelExplanation({ level }: { level: WordLevel }) {
  const { t } = useTranslation();
  const auto = level.auto;
  const correction = useCorrectionLine(level.source === 'user' ? null : level);
  const autoCorrection = useCorrectionLine(level.source === 'user' ? auto : null);
  return (
    <div className="flex flex-col gap-2 text-[0.9375rem] text-fg-muted" data-testid="level-explanation">
      <p>
        <span className="font-medium text-fg">{t(`wordLevel.source.${level.source}`)}</span>
        {' · '}
        {t(`wordLevel.sourceHint.${level.source}`)}
      </p>
      {correction && <p className="text-fg">{correction}</p>}
      {level.source === 'user' && (
        <p>
          {auto
            ? t('wordLevel.autoWas', {
                level: auto.cefr,
                source: t(`wordLevel.source.${auto.source}`),
              })
            : t('wordLevel.autoUnknown')}
          {autoCorrection && <> {autoCorrection}</>}
        </p>
      )}
    </div>
  );
}

/** Card back: the badge opens a small dialog that explains the level. */
export function LevelDialogButton({ level, term }: { level: WordLevel; term: string }) {
  const { t } = useTranslation();
  return (
    <Dialog
      variant="dialog"
      title={
        <span className="flex items-center gap-2">
          <span lang="en">{term}</span>
          <LevelBadge level={level} className="translate-y-px" />
        </span>
      }
      trigger={<LevelButton level={level} />}
    >
      <div className="flex flex-col gap-4 pt-1">
        <LevelExplanation level={level} />
        <p className="text-sm text-fg-muted">
          {t('wordLevel.changeHint')}{' '}
          <Link to="/settings/kaynaklar" className="font-medium text-accent-text underline-offset-4 hover:underline">
            {t('wordLevel.sourcesLink')}
          </Link>
        </p>
      </div>
    </Dialog>
  );
}
