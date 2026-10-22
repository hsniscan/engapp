import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Settings, ThemePref } from '@/domain/types';
import { Button, SegmentedControl, Select, Skeleton, Slider, Switch } from '@/ui';
import { FsrsOptimizerRow, RetentionHelper } from '@/features/fsrs/FsrsSettings';
import { SettingsRow, SettingsSection } from './SettingsLayout';
import { setTheme } from './themeSync';
import { useAppSettings } from './useAppSettings';
import type { SettingsPatch } from '@/data';
import { speakEnglish } from '@/features/review/useSpeech';

/** Local value while dragging; saved 400 ms after the last change (one write, one outbox row). */
function useDebouncedSetting<K extends keyof SettingsPatch & keyof Settings>(
  settings: Settings | undefined,
  key: K,
  update: (p: SettingsPatch) => Promise<void>,
): [Settings[K] | undefined, (v: Settings[K]) => void] {
  const [local, setLocal] = useState<Settings[K] | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const set = (v: Settings[K]) => {
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void update({ [key]: v } as SettingsPatch).then(() => setLocal(undefined));
    }, 400);
  };
  return [local ?? settings?.[key], set];
}

const pad = (n: number) => String(n).padStart(2, '0');

export function StudySection() {
  const { t } = useTranslation();
  const { settings, update } = useAppSettings();
  const [limit, setLimit] = useDebouncedSetting(settings, 'daily_new_limit', update);
  const [retention, setRetention] = useDebouncedSetting(settings, 'request_retention', update);
  const pct = Math.round((retention ?? 0.9) * 100);
  const retentionNote =
    pct < 85
      ? t('settings.study.retentionLow')
      : pct > 92
        ? t('settings.study.retentionHigh')
        : t('settings.study.retentionMid');

  return (
    <SettingsSection
      id="calisma"
      title={t('settings.sections.calisma')}
      description={t('settings.study.description')}
    >
      {!settings ? (
        <div className="p-5">
          <Skeleton lines={4} />
        </div>
      ) : (
        <>
          <SettingsRow stack>
            <Slider
              label={t('settings.study.dailyNew')}
              value={limit ?? 10}
              min={0}
              max={Math.max(50, limit ?? 0)}
              step={1}
              onValueChange={setLimit}
              format={(v) =>
                v === 0 ? t('settings.study.noNew') : t('settings.study.cardsPerDay', { count: v })
              }
            />
            <p className="-mt-1 text-sm text-fg-muted">{t('settings.study.dailyNewHint')}</p>
          </SettingsRow>
          <SettingsRow stack>
            <Slider
              label={t('settings.study.retention')}
              value={pct}
              min={80}
              max={95}
              step={1}
              onValueChange={(v) => setRetention(v / 100)}
              format={(v) => `%${v}`}
            />
            <div className="-mt-1 flex flex-col gap-1 text-sm text-fg-muted" aria-live="polite">
              <p>{t('settings.study.retentionExplain', { pct })}</p>
              <p className="text-fg">{retentionNote}</p>
            </div>
          </SettingsRow>
          <RetentionHelper settings={settings} />
          <FsrsOptimizerRow />
          <SettingsRow
            label={t('settings.study.dayStart')}
            description={t('settings.study.dayStartHint')}
          >
            <Select
              label={t('settings.study.dayStart')}
              hideLabel
              className="sm:w-36"
              value={String(settings.day_start_hour)}
              onValueChange={(v) => void update({ day_start_hour: Number(v) })}
              options={Array.from({ length: 24 }, (_, h) => ({
                value: String(h),
                label: `${pad(h)}:00`,
              }))}
            />
          </SettingsRow>
          <SettingsRow className="py-2">
            <Switch
              className="w-full"
              label={t('settings.study.showEasy')}
              description={t('settings.study.showEasyHint')}
              checked={settings.show_easy_candidates === true}
              onCheckedChange={(v) => void update({ show_easy_candidates: v })}
            />
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
}

export function AppearanceSection() {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const [pref, setPref] = useState<ThemePref | null>(null);
  const value = pref ?? settings?.theme ?? 'system';
  return (
    <SettingsSection id="gorunum" title={t('settings.sections.gorunum')}>
      <SettingsRow stack>
        <SegmentedControl<ThemePref>
          legend={t('theme.label')}
          value={value}
          onValueChange={(v) => {
            setPref(v);
            void setTheme(v).then(() => setPref(null));
          }}
          options={[
            { value: 'system', label: t('theme.system'), icon: 'monitor' },
            { value: 'light', label: t('theme.light'), icon: 'sun' },
            { value: 'dark', label: t('theme.dark'), icon: 'moon' },
          ]}
        />
        <p className="-mt-1 text-sm text-fg-muted">{t('settings.appearance.hint')}</p>
      </SettingsRow>
    </SettingsSection>
  );
}

const SAMPLE = 'Hello! This is how new words will sound.';

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === lang) ??
    voices.find((v) => v.lang.replace('_', '-') === lang) ??
    null
  );
}

export function VoiceSection() {
  const { t } = useTranslation();
  const { settings, update } = useAppSettings();
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [speaking, setSpeaking] = useState(false);
  const [voiceMissing, setVoiceMissing] = useState(false);
  const voice = settings?.voice ?? 'en-US';

  useEffect(() => {
    if (!supported) return;
    const check = () =>
      setVoiceMissing(window.speechSynthesis.getVoices().length > 0 && !pickVoice(voice));
    check();
    window.speechSynthesis.addEventListener?.('voiceschanged', check);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', check);
  }, [voice, supported]);

  const test = () => {
    setSpeaking(true);
    if (!speakEnglish(SAMPLE, voice, { rate: 0.95, onDone: () => setSpeaking(false) })) {
      setSpeaking(false);
    }
  };

  return (
    <SettingsSection id="ses" title={t('settings.sections.ses')}>
      <SettingsRow stack>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <SegmentedControl<'en-US' | 'en-GB'>
            legend={t('settings.voice.accent')}
            className="flex-1"
            value={voice}
            onValueChange={(v) => void update({ voice: v })}
            options={[
              { value: 'en-US', label: t('settings.voice.us') },
              { value: 'en-GB', label: t('settings.voice.gb') },
            ]}
          />
          <Button
            variant="secondary"
            leadingIcon="speaker"
            onClick={test}
            disabled={!supported}
            aria-pressed={speaking}
            className="sm:mb-px"
          >
            {t('settings.voice.test')}
          </Button>
        </div>
        <p className="-mt-1 text-sm text-fg-muted">
          {!supported
            ? t('settings.voice.unsupported')
            : voiceMissing
              ? t('settings.voice.missing')
              : t('settings.voice.hint')}
        </p>
      </SettingsRow>
    </SettingsSection>
  );
}
