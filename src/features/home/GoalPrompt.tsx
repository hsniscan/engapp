// No daily goal yet: one quiet card with three presets (10 / 15 / 20 dk) instead of empty rings
// (docs/design.md §4.1, item 7). Goals otherwise live in İlerleme and Ayarlar → Çalışma.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logError, updateGoals } from '@/data';
import { Card, Chip, ChipRow, IconTile, toast } from '@/ui';

/** Daily minutes offered in one tap when no goal is set. */
const DAY_GOAL_PRESETS = [10, 15, 20] as const;

export function GoalPrompt() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<number | null>(null);
  const set = async (minutes: number) => {
    setBusy(minutes);
    try {
      await updateGoals({ day_minutes: minutes });
    } catch (e) {
      void logError(e, 'home.dayGoal');
      toast({ title: t('today.goalSetFailed'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card
      as="section"
      aria-labelledby="goal-prompt-title"
      data-testid="home-goals"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-3">
        <IconTile icon="target" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="goal-prompt-title" className="text-ui font-semibold text-fg">
            {t('today.goalSetDay')}
          </h2>
          <p className="text-meta text-fg-muted">{t('today.goalSetBody')}</p>
        </div>
      </div>
      <div data-testid="goal-presets">
        <ChipRow label={t('today.goalSetDay')} bleed={false}>
          {DAY_GOAL_PRESETS.map((n) => (
            <Chip key={n} disabled={busy !== null} onClick={() => void set(n)}>
              {t('today.goalPreset', { count: n })}
            </Chip>
          ))}
        </ChipRow>
      </div>
    </Card>
  );
}
