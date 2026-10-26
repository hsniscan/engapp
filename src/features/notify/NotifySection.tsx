// Settings → Bildirim (v0.3 İP8): the daily reminder. The switch is per device (this browser's
// subscription) and the setting is per account (settings.notify, synced); the rule itself is
// the server's (domain/notify.ts).
import { useEffect, useMemo, useState } from 'react';
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
import { IosInstallSteps } from '@/features/settings/IosInstallGuide';
import { useInstallState } from '@/features/settings/platform';
import { SettingsRow, SettingsSection } from '@/features/settings/SettingsLayout';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { Link } from 'react-router';
import { Button, buttonClasses, SegmentedControl, Select, Skeleton, Switch, toast } from '@/ui';
import { isNativeApp } from '@/native/platform';
import { NativeNotifySection } from './NativeNotifySection';
import {
  browserPushEnv,
  disablePush,
  enablePush,
  isAndroid,
  isSubscribedHere,
  permission,
  pushSupport,
  sendTestNotification,
  type PushEnv,
} from './push';

const pad = (h: number) => String(h).padStart(2, '0');

export function NotifySection(props: { env?: PushEnv } = {}) {
  // The Android app plans its reminder on the phone; no Web Push there (decision 0033).
  if (isNativeApp()) return <NativeNotifySection />;
  return <WebNotifySection {...props} />;
}

function WebNotifySection({ env: envProp }: { env?: PushEnv } = {}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const { settings } = useAppSettings();
  const { installed } = useInstallState();
  const env = useMemo(() => envProp ?? browserPushEnv(), [envProp]);
  const support = pushSupport(env);
  const userId = auth.status === 'signed_in' ? (auth.user?.id ?? null) : null;
  const [perm, setPerm] = useState(() => permission(env));
  // Subscribed on this device for this user (null: still checking).
  const [hereFor, setHereFor] = useState<{ user: string; value: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const checkable = !!userId && support === 'supported';
  const here = !checkable ? false : hereFor?.user === userId ? hereFor.value : null;
  const setHere = (value: boolean) => userId && setHereFor({ user: userId, value });

  useEffect(() => {
    if (!checkable || !userId) return;
    let live = true;
    void isSubscribedHere(userId, env).then((value) => {
      if (live) setHereFor({ user: userId, value });
    });
    return () => {
      live = false;
    };
  }, [checkable, userId, env]);

  const pref = parseNotify(settings?.notify);
  const on = !!pref?.enabled && here === true;

  const save = async (change: Parameters<typeof saveNotify>[0]) => {
    try {
      await saveNotify(change);
      return true;
    } catch (e) {
      void logError(e, 'notify.save');
      toast({ title: t('settings.saveFailed'), tone: 'danger' });
      return false;
    }
  };

  const toggle = async (next: boolean) => {
    if (!userId) return;
    setBusy(true);
    try {
      if (next) {
        const r = await enablePush(userId, env);
        setPerm(permission(env));
        if (r !== 'ok') {
          toast({ title: t(`settings.notify.errors.${r}`), tone: 'danger' });
          return;
        }
        setHere(true);
        if (await save({ enabled: true }))
          toast({ title: t('settings.notify.enabled'), tone: 'success' });
      } else {
        await disablePush(env);
        setHere(false);
        if (await save({ enabled: false }))
          toast({ title: t('settings.notify.disabled'), tone: 'neutral' });
      }
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    const r = await sendTestNotification(env);
    setTesting(false);
    if (r === 'sent') toast({ title: t('settings.notify.testSent'), tone: 'success' });
    else if (r === 'gone' || r === 'not_subscribed') {
      setHere(false);
      toast({ title: t('settings.notify.testGone'), tone: 'danger' });
    } else toast({ title: t('settings.notify.testFailed'), tone: 'danger' });
  };

  const hourLabel = (h: number) => t('settings.notify.hourLabel', { hour: pad(h) });
  const hours = [];
  for (let h = FIRST_NOTIFY_HOUR; h <= LAST_NOTIFY_HOUR; h++)
    hours.push({ value: String(h), label: hourLabel(h) });

  let body;
  if (!settings || auth.status === 'loading') {
    body = (
      <div className="p-5">
        <Skeleton lines={2} />
      </div>
    );
  } else if (auth.status === 'unavailable' || support === 'no_backend') {
    body = (
      <SettingsRow
        label={t('settings.notify.daily')}
        description={t('settings.notify.unavailable')}
      />
    );
  } else if (!userId) {
    body = (
      <SettingsRow label={t('settings.notify.daily')} description={t('settings.notify.guest')}>
        <Link to="/auth" className={buttonClasses({ variant: 'secondary', className: 'shrink-0' })}>
          {t('settings.notify.signIn')}
        </Link>
      </SettingsRow>
    );
  } else if (support === 'ios_needs_install') {
    body = (
      <SettingsRow
        stack
        label={t('settings.notify.iosTitle')}
        description={t('settings.notify.iosWhy')}
      >
        <IosInstallSteps />
      </SettingsRow>
    );
  } else if (support === 'unsupported') {
    body = (
      <SettingsRow
        label={t('settings.notify.daily')}
        description={t('settings.notify.unsupported')}
      />
    );
  } else {
    body = (
      <>
        <SettingsRow stack>
          <Switch
            className="w-full"
            label={t('settings.notify.daily')}
            description={t('settings.notify.dailyHint')}
            checked={on}
            disabled={busy || here === null || (perm === 'denied' && !on)}
            onCheckedChange={(v) => void toggle(v)}
          />
          {perm === 'denied' && !on && (
            <p className="text-sm text-fg">{t('settings.notify.denied')}</p>
          )}
          {pref?.enabled && here === false && perm !== 'denied' && (
            <p className="text-sm text-fg-muted">{t('settings.notify.otherDevice')}</p>
          )}
          {isAndroid(env) && !installed && !env.standalone && (
            <p className="text-sm text-fg-muted">
              {t('settings.notify.androidInstall')}{' '}
              <Link
                to="/settings/hakkinda#uygulama"
                className="font-medium text-accent-text underline"
              >
                {t('settings.notify.androidInstallLink')}
              </Link>
            </p>
          )}
        </SettingsRow>
        {on && pref && (
          <>
            <SettingsRow stack>
              <SegmentedControl<NotifyMode>
                legend={t('settings.notify.when')}
                options={[
                  { value: 'auto', label: t('settings.notify.auto') },
                  { value: 'fixed', label: t('settings.notify.fixed') },
                ]}
                value={pref.mode}
                onValueChange={(mode) => void save({ mode })}
              />
              {pref.mode === 'auto' ? (
                <p className="text-sm text-fg-muted" aria-live="polite">
                  {t('settings.notify.autoHint', {
                    time: hourLabel(pref.hour ?? DEFAULT_NOTIFY_HOUR),
                  })}
                </p>
              ) : (
                <Select
                  label={t('settings.notify.hour')}
                  options={hours}
                  value={String(pref.hour ?? DEFAULT_NOTIFY_HOUR)}
                  onValueChange={(v) => void save({ mode: 'fixed', hour: Number(v) })}
                />
              )}
            </SettingsRow>
            <SettingsRow
              label={t('settings.notify.test')}
              description={t('settings.notify.testHint')}
            >
              <Button
                variant="secondary"
                loading={testing}
                onClick={() => void test()}
                className="shrink-0"
              >
                {t('settings.notify.test')}
              </Button>
            </SettingsRow>
          </>
        )}
      </>
    );
  }

  return (
    <SettingsSection
      id="bildirim"
      title={t('settings.sections.bildirim')}
      description={t('settings.notify.description')}
    >
      {body}
    </SettingsSection>
  );
}
