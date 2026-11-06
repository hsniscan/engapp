// Bugün's reminder offer (v0.5.3 A4, ADR 0072): one note in the single note slot, after the
// first finished session. Asked once per device; the setting stays in Profil → Ayarlar.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { db, logError } from '@/data';
import { FIRST_NOTIFY_HOUR, LAST_NOTIFY_HOUR, parseNotify } from '@/domain/notify';
import { useAuth } from '@/features/auth/session';
import { HomeNote } from '@/features/home/HomeNote';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { backendConfig } from '@/lib/supabase';
import { isNativeApp } from '@/native/platform';
import { Button, buttonClasses, Select, toast } from '@/ui';
import { useReminderState } from './nativeReminder';
import {
  answerOffer,
  offerKind,
  suggestedHour,
  turnOnReminder,
  useOfferAnswer,
  webPushSupported,
  type NativeDeps,
} from './reminderOffer';

const pad = (h: number) => String(h).padStart(2, '0');

export function ReminderOffer({
  sessionOver,
  native = isNativeApp(),
  nativeDeps,
}: {
  sessionOver: boolean;
  native?: boolean;
  nativeDeps?: () => Promise<NativeDeps>;
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const { settings } = useAppSettings();
  const answered = useOfferAnswer();
  const nativeState = useReminderState();
  const answers = useLiveQuery(() => db.review_logs.limit(1).count(), []);
  const [now] = useState(() => Date.now());
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (!settings || answers === undefined) return null;
  const signedIn = auth.status === 'signed_in';
  const kind = offerKind({
    answered,
    answers,
    sessionOver,
    native,
    nativeEnabled: nativeState.enabled,
    webSupported: !native && webPushSupported(),
    signedIn,
    accountEnabled: !!parseNotify(settings.notify)?.enabled,
    backend: !!backendConfig && auth.status !== 'unavailable',
  });
  if (!kind) return null;
  const hour = chosen ?? suggestedHour(now, settings.timezone);
  const hours = [];
  for (let h = FIRST_NOTIFY_HOUR; h <= LAST_NOTIFY_HOUR; h++)
    hours.push({ value: String(h), label: t('settings.notify.hourLabel', { hour: pad(h) }) });

  const no = () => {
    answerOffer('no');
    toast({ title: t('reminderOffer.declined'), tone: 'neutral' });
  };

  const yes = async () => {
    if (kind === 'webGuest') return;
    setBusy(true);
    try {
      const r = await turnOnReminder(kind, hour, {
        userId: signedIn ? (auth.user?.id ?? null) : null,
        native: nativeDeps,
      });
      if (r.ok) {
        answerOffer('yes');
        toast({ title: t('reminderOffer.done', { hour: pad(hour) }), tone: 'success' });
      } else {
        toast({
          title: r.reason === 'denied' ? t('reminderOffer.denied') : t('reminderOffer.failed'),
          tone: 'danger',
        });
      }
    } catch (e) {
      void logError(e, 'reminderOffer.yes');
      toast({ title: t('reminderOffer.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <HomeNote
      titleId="reminder-offer-title"
      icon="bell"
      data-testid="reminder-offer"
      title={t('reminderOffer.title')}
      actions={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={no}>
            {t('reminderOffer.no')}
          </Button>
          {kind === 'webGuest' ? (
            <Link
              to="/auth"
              onClick={() => answerOffer('yes')}
              className={buttonClasses({ variant: 'tonal', size: 'sm' })}
            >
              {t('reminderOffer.signIn')}
            </Link>
          ) : (
            <Button variant="tonal" size="sm" loading={busy} onClick={() => void yes()}>
              {t('reminderOffer.yes', { hour: pad(hour) })}
            </Button>
          )}
        </>
      }
    >
      <p>{kind === 'webGuest' ? t('reminderOffer.guestBody') : t('reminderOffer.body')}</p>
      {kind !== 'webGuest' && (
        <div className="mt-2 max-w-48">
          <Select
            label={t('reminderOffer.time')}
            options={hours}
            value={String(hour)}
            onValueChange={(v) => setChosen(Number(v))}
          />
        </div>
      )}
    </HomeNote>
  );
}
