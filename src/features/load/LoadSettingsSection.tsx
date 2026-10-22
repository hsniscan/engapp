// Ayarlar → Tekrar yükü: daily capacity in minutes, catch-up mode, vacation (decision 0021).
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endVacation, getLoadStatus, logError, setVacation } from '@/data';
import { CAPACITY_MIN_LIMITS, capacityMinutes, cardsForMinutes } from '@/domain/capacity';
import { diffDays } from '@/domain/day';
import { MAX_VACATION_DAYS } from '@/domain/vacation';
import { formatDayLong } from '@/features/stats/format';
import { SettingsRow, SettingsSection } from '@/features/settings/SettingsLayout';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { usePausedLiveQuery } from '@/features/settings/usePausedLiveQuery';
import { Button, Skeleton, Slider, Switch, TextField, toast } from '@/ui';

export function LoadSettingsSection() {
  const { t } = useTranslation();
  const { settings, update } = useAppSettings();
  const status = usePausedLiveQuery(() => getLoadStatus(), []);
  const [minutes, setMinutes] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!settings || !status) {
    return (
      <SettingsSection
        id="yuk"
        title={t('settings.sections.yuk')}
        description={t('load.settingsDescription')}
      >
        <div className="p-5">
          <Skeleton lines={4} />
        </div>
      </SettingsSection>
    );
  }
  const value = minutes ?? capacityMinutes(settings);
  const setCapacity = (v: number) => {
    setMinutes(v);
    clearTimeout(timer.current);
    // One write after the last change (one outbox row).
    timer.current = setTimeout(
      () => void update({ daily_capacity_min: v }).then(() => setMinutes(null)),
      400,
    );
  };
  const sec = Math.round(status.secPerCard);

  return (
    <SettingsSection
      id="yuk"
      title={t('settings.sections.yuk')}
      description={t('load.settingsDescription')}
    >
      <SettingsRow stack>
        <Slider
          label={t('load.capacity')}
          value={value}
          min={CAPACITY_MIN_LIMITS.min}
          max={120}
          step={5}
          onValueChange={setCapacity}
          format={(v) => t('load.capacityValue', { min: v })}
        />
        <p className="-mt-1 text-sm text-fg-muted" aria-live="polite">
          {t('load.capacityHint', { cards: cardsForMinutes(value, status.secPerCard), sec })}
        </p>
      </SettingsRow>
      <SettingsRow className="py-2">
        <Switch
          className="w-full"
          label={t('load.catchupAuto')}
          description={t('load.catchupAutoHint')}
          checked={settings.catchup_auto !== false}
          onCheckedChange={(v) => void update({ catchup_auto: v })}
        />
      </SettingsRow>
      <SettingsRow stack>
        <VacationEditor
          today={status.day}
          vacation={status.vacation}
          onVacation={status.onVacation}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

function VacationEditor({
  today,
  vacation,
  onVacation,
}: {
  today: string;
  vacation: { start: string; end: string } | null;
  onVacation: boolean;
}) {
  const { t } = useTranslation();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const current = vacation && vacation.end >= today ? vacation : null;

  const save = () => {
    if (!start || !end) return setError(t('load.vacationMissing'));
    if (end < start) return setError(t('load.vacationInvalid'));
    if (end < today) return setError(t('load.vacationPast'));
    if (diffDays(start, end) >= MAX_VACATION_DAYS) return setError(t('load.vacationTooLong'));
    setError(null);
    setVacation({ start, end })
      .then(() => {
        setStart('');
        setEnd('');
        toast({ title: t('load.vacationSaved') });
      })
      .catch((e: unknown) => {
        void logError(e, 'load.setVacation');
        toast({ title: t('settings.saveFailed'), tone: 'danger' });
      });
  };
  const finish = () => {
    endVacation()
      .then(() =>
        toast({ title: onVacation ? t('load.vacationEnded') : t('load.vacationCancelled') }),
      )
      .catch((e: unknown) => void logError(e, 'load.endVacation'));
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[0.9375rem] font-medium text-fg">
        {t('load.vacationTitle')}
      </legend>
      <p className="text-sm text-fg-muted">{t('load.vacationHint')}</p>
      {current && (
        <div className="flex flex-col gap-2 rounded-md bg-surface-sunken p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-fg" data-testid="vacation-current">
            {t('load.vacationCurrent', {
              start: formatDayLong(current.start),
              end: formatDayLong(current.end),
            })}
          </p>
          <Button variant="secondary" size="sm" onClick={finish}>
            {onVacation ? t('load.vacationFinish') : t('load.vacationCancel')}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        <TextField
          type="date"
          label={t('load.vacationStart')}
          value={start}
          min={today}
          onChange={(e) => setStart(e.target.value)}
        />
        <TextField
          type="date"
          label={t('load.vacationEnd')}
          value={end}
          min={start || today}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}
      <Button variant="secondary" className="self-start" onClick={save}>
        {t('load.vacationSave')}
      </Button>
    </fieldset>
  );
}
