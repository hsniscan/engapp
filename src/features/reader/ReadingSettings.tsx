// Reading settings (v0.5 İP1): the difficulty of recommended and generated texts (Rahat /
// Dengeli / Zorlayıcı, Hasan's bands) and whether the reader colours words. Shown in Ayarlar →
// Çalışma and in the reader's "Aa" sheet; both write the same settings row.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readingDifficultyOf } from '@/data';
import { DIFFICULTY_BANDS, READING_DIFFICULTIES, type ReadingDifficulty } from '@/domain/texts';
import { SettingsRow, SettingsSection } from '@/features/settings/SettingsLayout';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { SegmentedControl, Skeleton, Switch } from '@/ui';

const pct = (x: number) => Math.round(x * 100);

export function DifficultyPicker() {
  const { t } = useTranslation();
  const { settings, update } = useAppSettings();
  const [pending, setPending] = useState<ReadingDifficulty | null>(null);
  if (!settings) return <Skeleton className="h-11" />;
  const value = pending ?? readingDifficultyOf(settings);
  const band = DIFFICULTY_BANDS[value];
  return (
    <div className="flex flex-col gap-2">
      <SegmentedControl<ReadingDifficulty>
        legend={t('reader.difficulty.label')}
        value={value}
        onValueChange={(v) => {
          setPending(v);
          void update({ reading_difficulty: v }).finally(() => setPending(null));
        }}
        options={READING_DIFFICULTIES.map((d) => ({
          value: d,
          label: t(`reader.difficulty.${d}`),
        }))}
      />
      <p className="text-sm text-fg-muted" aria-live="polite">
        {t('reader.difficulty.hint', { min: pct(band.min), max: pct(band.max) })}
      </p>
    </div>
  );
}

export function HighlightSwitch() {
  const { t } = useTranslation();
  const { settings, update } = useAppSettings();
  return (
    <Switch
      label={t('reader.highlight.label')}
      description={t('reader.highlight.hint')}
      checked={settings?.reader_highlight !== false}
      disabled={!settings}
      onCheckedChange={(on) => void update({ reader_highlight: on })}
    />
  );
}

/** Ayarlar → Çalışma → Okuma. */
export function ReadingSettingsSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection id="okuma" title={t('reader.settings.title')}>
      <SettingsRow stack>
        <DifficultyPicker />
      </SettingsRow>
      <SettingsRow>
        <HighlightSwitch />
      </SettingsRow>
    </SettingsSection>
  );
}
