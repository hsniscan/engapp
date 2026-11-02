// The label of a text's kind (v0.5.2, B6): a picked text is "Kelimelerimle metin", only today's
// daily story is "Bugünün hikâyesi", an earlier one is "Hikâye · 20 Eki".
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { dayConfig } from '@/data/settings';
import { dayKeyOf } from '@/domain/day';
import type { ReaderText } from '@/domain/texts';
import { useAppSettings } from '@/features/settings/useAppSettings';

export function useTextKindLabel(): (text: Pick<ReaderText, 'kind' | 'story'>) => string {
  const { t, i18n } = useTranslation();
  const { settings } = useAppSettings();
  return useCallback(
    (text) => {
      if (text.kind !== 'story') return t(`reader.kind.${text.kind}`);
      const story = text.story;
      if (story?.source === 'picked') return t('reader.kind.picked');
      const today = settings ? dayKeyOf(Date.now(), dayConfig(settings)) : null;
      if (!story?.day || story.day === today) return t('reader.kind.story');
      const date = new Date(`${story.day}T12:00:00Z`).toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      });
      return t('reader.kind.pastStory', { date });
    },
    [t, i18n.language, settings],
  );
}
