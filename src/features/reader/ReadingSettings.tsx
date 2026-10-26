// Reading settings (v0.5 İP1): the difficulty of recommended and generated texts (Rahat /
// Dengeli / Zorlayıcı, Hasan's bands), whether the reader colours words and whether every
// tapped word asks for a guess first ("Hep tahmin ettir", v0.5.1). Shown in Ayarlar →
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

/**
 * "Hep tahmin ettir" (v0.5.1, decision 0054): off by default, so a word the user has a card for
 * shows its meaning at once; on, every tapped word asks for a guess first.
 */
export function AlwaysGuessSwitch() {
  const { t } = useTranslation();
  const { settings, update } = useAppSettings();
  return (
    <Switch
      label={t('reader.alwaysGuess.label')}
      description={t('reader.alwaysGuess.hint')}
      checked={settings?.reader_always_guess === true}
      disabled={!settings}
      onCheckedChange={(on) => void update({ reader_always_guess: on })}
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
      <SettingsRow>
        <AlwaysGuessSwitch />
      </SettingsRow>
    </SettingsSection>
  );
}
