// UI wrappers around the profile writes: log and toast on failure, offer undo on "Kapat".
import { dismissInterestPrompt, logError, saveInterests, setInterest, setTopicMuted } from '@/data';
import type { TopicKey } from '@/domain/topics';
import i18n from '@/i18n';
import { toast } from '@/ui';

async function guarded(fn: () => Promise<unknown>, context: string): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    void logError(e, context);
    toast({ title: i18n.t('settings.saveFailed'), tone: 'danger' });
    return false;
  }
}

export function pickTopic(topic: TopicKey, on: boolean): Promise<boolean> {
  return guarded(() => setInterest(topic, on), 'profile.pick');
}

export async function muteTopic(
  topic: TopicKey,
  muted: boolean,
  wasSelected = false,
): Promise<boolean> {
  const ok = await guarded(() => setTopicMuted(topic, muted), 'profile.mute');
  if (ok && muted) {
    toast({
      title: i18n.t('profile.mutedToast', { topic: i18n.t(`topics.${topic}`) }),
      action: {
        label: i18n.t('common.undo'),
        altText: i18n.t('profile.unmuteLabel', { topic: i18n.t(`topics.${topic}`) }),
        onClick: () =>
          void guarded(async () => {
            await setTopicMuted(topic, false);
            if (wasSelected) await setInterest(topic, true);
          }, 'profile.unmute'),
      },
    });
  }
  return ok;
}

export function saveFirstInterests(topics: readonly TopicKey[]): Promise<boolean> {
  return guarded(() => saveInterests(topics), 'profile.saveFirst');
}

export function skipInterests(): Promise<boolean> {
  return guarded(() => dismissInterestPrompt(), 'profile.skip');
}
