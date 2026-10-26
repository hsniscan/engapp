// Settings → Bildirim in the Android app: the phone plans its own reminder (local notification),
// no Web Push UI. Works for guests too. docs/decisions/0033-android-capacitor.md
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logError } from '@/data';
import { saveNotify } from '@/data/notify';
import {
  DEFAULT_NOTIFY_HOUR,
  FIRST_NOTIFY_HOUR,
  LAST_NOTIFY_HOUR,
  parseNotify,
  type NotifyMode,
} from '@/domain/notify';
import { useAuth } from '@/features/auth/session';
import { SettingsRow, SettingsSection } from '@/features/settings/SettingsLayout';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { SegmentedControl, Select, Skeleton, Switch, toast } from '@/ui';
import {
  disableReminder,
  enableReminder,
  setAnswerCards,
  upcoming,
  useReminderState,
  type NotifierPort,
  type WebPushCleaner,
} from './nativeReminder';

const pad = (h: number) => String(h).padStart(2, '0');

export interface NativeNotifyDeps {
  port: NotifierPort;
  cleanWebPush: WebPushCleaner;
}

async function loadDeps(): Promise<NativeNotifyDeps> {
  const m = await import('@/native/reminders');
  return { port: m.capacitorNotifier, cleanWebPush: m.removeAccountWebPush };
}

export function NativeNotifySection({
  deps = loadDeps,
  now = Date.now,
}: { deps?: () => Promise<NativeNotifyDeps>; now?: () => number } = {}) {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const { settings } = useAppSettings();
  const state = useReminderState();
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const userId = auth.status === 'signed_in' ? (auth.user?.id ?? null) : null;
  const pref = parseNotify(settings?.notify);

  const save = async (change: Parameters<typeof saveNotify>[0]) => {
    try {
      await saveNotify(change);
    } catch (e) {
      void logError(e, 'nativeNotify.save');
      toast({ title: t('settings.saveFailed'), tone: 'danger' });
    }
  };

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const d = await deps();
      if (!next) {
        await disableReminder({ port: d.port });
        toast({ title: t('native.reminders.disabled'), tone: 'neutral' });
        return;
      }
      const r = await enableReminder({ port: d.port, userId, cleanWebPush: d.cleanWebPush });
      if (!r.ok) {
        setDenied(r.reason === 'denied');
        toast({
          title: t(r.reason === 'denied' ? 'native.reminders.denied' : 'native.reminders.failed'),
          tone: 'danger',
        });
        return;
      }
      setDenied(false);
      toast({
        title: t('native.reminders.enabled'),
        description: r.webFailed
          ? t('native.reminders.webRemoveFailed')
          : r.webRemoved
            ? t('native.reminders.webRemoved', { count: r.webRemoved })
            : undefined,
        tone: 'success',
        duration: r.webRemoved || r.webFailed ? 8000 : undefined,
      });
    } catch (e) {
      void logError(e, 'nativeNotify.toggle');
      toast({ title: t('native.reminders.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const toggleAnswers = async (next: boolean) => {
    setBusy(true);
    try {
      await setAnswerCards(next, { port: (await deps()).port });
    } catch (e) {
      void logError(e, 'nativeNotify.answers');
      toast({ title: t('settings.saveFailed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const hourLabel = (h: number) => t('settings.notify.hourLabel', { hour: pad(h) });
  const hours = [];
  for (let h = FIRST_NOTIFY_HOUR; h <= LAST_NOTIFY_HOUR; h++)
    hours.push({ value: String(h), label: hourLabel(h) });
  const mode: NotifyMode = pref?.mode ?? 'auto';
  const hour = pref?.hour ?? DEFAULT_NOTIFY_HOUR;
  const nextAt = upcoming(state, now());
  const when = nextAt
    ? new Intl.DateTimeFormat(i18n.language, {
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(nextAt))
    : null;

  return (
    <SettingsSection
      id="bildirim"
      title={t('settings.sections.bildirim')}
      description={t('native.reminders.description')}
    >
      {!settings ? (
        <div className="p-5">
          <Skeleton lines={2} />
        </div>
      ) : (
        <>
          <SettingsRow stack>
            <Switch
              className="w-full"
              label={t('native.reminders.daily')}
              description={t('settings.notify.dailyHint')}
              checked={state.enabled}
              disabled={busy}
              onCheckedChange={(v) => void toggle(v)}
            />
            <p className="text-sm text-fg-muted">{t('native.reminders.perDevice')}</p>
            {denied && !state.enabled && (
              <p className="text-sm text-fg">{t('native.reminders.denied')}</p>
            )}
          </SettingsRow>
          {state.enabled && (
            <SettingsRow stack>
              <SegmentedControl<NotifyMode>
                legend={t('settings.notify.when')}
                options={[
                  { value: 'auto', label: t('settings.notify.auto') },
                  { value: 'fixed', label: t('settings.notify.fixed') },
                ]}
                value={mode}
                onValueChange={(m) => void save({ mode: m })}
              />
              {mode === 'auto' ? (
                <p className="text-sm text-fg-muted">
                  {t('settings.notify.autoHint', { time: hourLabel(hour) })}
                </p>
              ) : (
                <Select
                  label={t('settings.notify.hour')}
                  options={hours}
                  value={String(hour)}
                  onValueChange={(v) => void save({ mode: 'fixed', hour: Number(v) })}
                />
              )}
              <p className="text-sm text-fg-muted" aria-live="polite">
                {when ? t('native.reminders.next', { when }) : t('native.reminders.nextNone')}
              </p>
            </SettingsRow>
          )}
          {state.enabled && (
            <SettingsRow stack>
              <Switch
                className="w-full"
                label={t('widget.answers.toggle')}
                description={t('widget.answers.hint')}
                checked={state.answerCards}
                disabled={busy}
                onCheckedChange={(v) => void toggleAnswers(v)}
              />
            </SettingsRow>
          )}
          <WidgetExplainer />
        </>
      )}
    </SettingsSection>
  );
}

/** Android only: the home-screen widgets exist, what they show and how to add one. */
function WidgetExplainer() {
  const { t } = useTranslation();
  return (
    <SettingsRow stack>
      <div
        className="flex flex-col gap-2 rounded-control bg-surface-sunken px-4 py-3"
        data-testid="widget-explainer"
      >
        <p className="font-medium text-fg">{t('widget.explain.title')}</p>
        <p className="text-sm text-fg-muted">{t('widget.explain.body')}</p>
        <p className="text-sm text-fg">{t('widget.explain.how')}</p>
      </div>
    </SettingsRow>
  );
}
