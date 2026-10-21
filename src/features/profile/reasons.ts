import type { TFunction } from 'i18next';
import type { TopicWeight } from '@/domain/profile';

/** "Sen seçtin · 3 metin yükledin · 2 örnek cümleyi beğendin": why a topic weighs what it does. */
export function topicReason(t: TFunction, w: TopicWeight): string {
  const parts: string[] = [];
  if (w.selected) parts.push(t('profile.reasonSelected'));
  if (w.texts > 0) parts.push(t('profile.reasonTexts', { count: w.texts }));
  if (w.likes > 0) parts.push(t('profile.reasonLikes', { count: w.likes }));
  if (w.skips > 0) parts.push(t('profile.reasonSkips', { count: w.skips }));
  return parts.join(' · ');
}

/** "1,8": at most one decimal, in the UI language. */
export function formatWeight(weight: number, lang: string): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(weight);
}
