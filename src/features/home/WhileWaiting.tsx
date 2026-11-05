// "Beklerken" on Bugün (v0.5.3 A6, ADR 0072): when only learning steps are waiting ("10 kart
// 11 dk sonra"), the most motivated moment of the day is not a waiting room. Under the Today
// card: +5 new words now, a short text to read, and (reminders off) a ping when the cards are
// ready on Android, or the reminder setting on the web.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { addExtraNew, logError, type MoreStudyOverview } from '@/data';
import { extraNewMode } from '@/features/extra/links';
import { useReminderState } from '@/features/notify/nativeReminder';
import { pingWhenDue, type NativeDeps } from '@/features/notify/reminderOffer';
import { isNativeApp } from '@/native/platform';
import { parseNotify } from '@/domain/notify';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { ListGroup, ListRow, SectionHeader, toast } from '@/ui';

export const READ_HREF = '/kesfet?f=okuma';
export const NOTIFY_SETTINGS_HREF = '/settings/bildirim';

export function WhileWaiting({
  more,
  nextDue,
  minutes,
  native = isNativeApp(),
  nativeDeps,
}: {
  more: MoreStudyOverview | null;
  /** When the waiting steps fall due (null: unknown). */
  nextDue: number | null;
  /** "11 dk" until then, for the copy. */
  minutes: number | null;
  native?: boolean;
  nativeDeps?: () => Promise<NativeDeps>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reminder = useReminderState();
  const { settings } = useAppSettings();
  const webOn = !!parseNotify(settings?.notify)?.enabled;
  const [busy, setBusy] = useState<'new' | 'ping' | null>(null);
  const [pinged, setPinged] = useState(false);
  const mode = more ? extraNewMode(more) : null;
  const newWaiting = mode && more ? more.newWaitingByMode[mode] : 0;
  const extra = Math.min(5, newWaiting);

  const addNew = async () => {
    if (!mode) return;
    setBusy('new');
    try {
      await addExtraNew(extra, mode);
      await navigate(`/study?mode=${mode}`);
    } catch (e) {
      void logError(e, 'home.waitingNew');
      toast({ title: t('more.addFailed'), tone: 'danger' });
      setBusy(null);
    }
  };

  const ping = async () => {
    if (nextDue === null) return;
    setBusy('ping');
    try {
      const ok = await pingWhenDue(
        nextDue,
        { title: t('waiting.pingTitle'), body: t('waiting.pingBody') },
        nativeDeps,
      );
      if (ok) {
        setPinged(true);
        toast({ title: t('waiting.pingSet'), tone: 'success' });
      } else toast({ title: t('reminderOffer.denied'), tone: 'danger' });
    } catch (e) {
      void logError(e, 'home.waitingPing');
      toast({ title: t('reminderOffer.failed'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="while-waiting-title" data-testid="while-waiting">
      <SectionHeader
        id="while-waiting-title"
        title={t('waiting.title')}
        description={minutes !== null ? t('waiting.body', { count: minutes }) : undefined}
      />
      <ListGroup>
        {extra > 0 && (
          <ListRow
            onClick={() => {
              if (!busy) void addNew();
            }}
            leadingIcon="plus"
            leadingTone="accent"
            title={t('waiting.newTitle', { count: extra })}
            description={t('waiting.newBody')}
          />
        )}
        <ListRow
          to={READ_HREF}
          leadingIcon="book"
          title={t('waiting.readTitle')}
          description={t('waiting.readBody')}
        />
        {native && !reminder.enabled && nextDue !== null && !pinged && (
          <ListRow
            onClick={() => {
              if (!busy) void ping();
            }}
            leadingIcon="bell"
            title={t('waiting.pingAction', { count: minutes ?? 0 })}
            description={t('waiting.pingHint')}
          />
        )}
        {!native && settings && !webOn && (
          <ListRow
            to={NOTIFY_SETTINGS_HREF}
            leadingIcon="bell"
            title={t('waiting.reminderTitle')}
            description={t('waiting.reminderBody')}
          />
        )}
      </ListGroup>
    </section>
  );
}
