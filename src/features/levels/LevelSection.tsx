import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { logError, setLevelOverride, type NoteDetail } from '@/data';
import { CEFR } from '@/domain/level';
import type { CefrLevel } from '@/domain/types';
import { Select, Surface, toast } from '@/ui';
import { LevelBadge } from './LevelBadge';
import { LevelExplanation } from './LevelDetails';
import { useNoteLevel } from './useWordLevel';

const AUTO = 'auto';

/**
 * "Seviye" in the note detail sheet: the level with where it comes from, and the user's own
 * level (applied at once, like suspending: it is not part of the sheet's draft).
 */
export function LevelSection({ detail }: { detail: NoteDetail }) {
  const { t } = useTranslation();
  const id = useId();
  const level = useNoteLevel(detail);
  const { note } = detail;
  const auto = level?.auto ?? null;
  return (
    <section aria-labelledby={`${id}-level`} className="flex flex-col gap-3" data-testid="level-section">
      <h3 id={`${id}-level`} className="flex items-center gap-2 font-serif text-lg font-semibold text-fg">
        {t('wordLevel.section')}
        {level && <LevelBadge level={level} />}
      </h3>
      <Surface tone="flat" padding="sm" className="flex flex-col gap-4 px-4">
        {level ? (
          <LevelExplanation level={level} />
        ) : (
          <p className="text-[0.9375rem] text-fg-muted">{t('wordLevel.unknown')}</p>
        )}
        <Select
          label={t('wordLevel.override')}
          hint={t('wordLevel.overrideHint')}
          value={note.level_override ?? AUTO}
          onValueChange={(v) => {
            const next = v === AUTO ? null : (v as CefrLevel);
            setLevelOverride(note.id, next).catch((e: unknown) => {
              void logError(e, 'NoteDetail.level');
              toast({ title: t('wordLevel.overrideFailed'), tone: 'danger' });
            });
          }}
          options={[
            {
              value: AUTO,
              label: auto
                ? t('wordLevel.overrideAuto', { level: auto.cefr })
                : t('wordLevel.overrideAutoUnknown'),
            },
            ...CEFR.map((l) => ({ value: l, label: `${l} · ${t(`settings.levels.${l}`)}` })),
          ]}
        />
      </Surface>
    </section>
  );
}
