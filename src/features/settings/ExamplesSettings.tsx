// Settings → "Örnek cümleler" (v0.2 İP5): contexts prepared in the background, whether the
// Turkish translation shows without a tap, and the one-time "prepare all my cards".
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getExamplePrepStatus, logError, startExampleBackfill } from '@/data';
import { EXAMPLE_CONTEXT_KEYS, selectedContexts } from '@/domain/examples';
import { kickExampleQueue } from '@/features/examples/queue';
import { Button, cn, Icon, Skeleton, Switch, toast } from '@/ui';
import {
  MAX_EXAMPLE_CONTEXTS,
  MIN_SELECTED_CONTEXTS,
} from '../../../supabase/functions/_shared/examples-contracts';
import { SettingsRow, SettingsSection } from './SettingsLayout';
import { useAppSettings, useUserId } from './useAppSettings';

export function ExamplesSettingsSection() {
  const { t } = useTranslation();
  const { settings, update } = useAppSettings();
  const userId = useUserId();
  const status = useLiveQuery(() => getExamplePrepStatus(), []);
  const [starting, setStarting] = useState(false);
  const saved = settings ? selectedContexts(settings) : [];
  // The choice shows at once; quick taps build on it, not on the not-yet-saved row.
  const [draft, setDraft] = useState<string[] | null>(null);
  const savedKey = saved.join(',');
  if (draft && draft.join(',') === savedKey) setDraft(null); // saved: follow the row again
  const chosen = draft ?? saved;

  const toggle = (key: string) => {
    const on = chosen.includes(key);
    if (on && chosen.length <= MIN_SELECTED_CONTEXTS) return;
    if (!on && chosen.length >= MAX_EXAMPLE_CONTEXTS) return;
    const next = on ? chosen.filter((c) => c !== key) : [...chosen, key];
    setDraft(next);
    void update({ example_contexts: next });
  };

  const prepareAll = async () => {
    setStarting(true);
    try {
      await startExampleBackfill();
      kickExampleQueue();
      toast({ title: t('settings.examples.prepareStarted'), tone: 'success' });
    } catch (e) {
      void logError(e, 'examples.backfill');
      toast({ title: t('settings.saveFailed'), tone: 'danger' });
    } finally {
      setStarting(false);
    }
  };

  return (
    <SettingsSection
      id="ornekler"
      title={t('settings.sections.ornekler')}
      description={t('settings.examples.description')}
    >
      {!settings ? (
        <div className="p-5">
          <Skeleton lines={3} />
        </div>
      ) : (
        <>
          <SettingsRow stack label={t('settings.examples.contexts')} description={t('settings.examples.contextsHint')}>
            <div role="group" aria-label={t('settings.examples.contexts')} className="flex flex-wrap gap-2">
              {EXAMPLE_CONTEXT_KEYS.map((key) => {
                const on = chosen.includes(key);
                const locked = on ? chosen.length <= MIN_SELECTED_CONTEXTS : chosen.length >= MAX_EXAMPLE_CONTEXTS;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    aria-disabled={locked || undefined}
                    title={locked ? t('settings.examples.contextsLimit', { min: MIN_SELECTED_CONTEXTS, max: MAX_EXAMPLE_CONTEXTS }) : undefined}
                    onClick={() => toggle(key)}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors duration-(--duration-micro)',
                      on
                        ? 'border-accent bg-accent-soft text-accent-text'
                        : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                      locked && !on && 'opacity-55 hover:border-border hover:text-fg-muted',
                    )}
                  >
                    {on && <Icon name="check" size={16} />}
                    {t(`examples.contexts.${key}`)}
                  </button>
                );
              })}
            </div>
          </SettingsRow>
          <SettingsRow>
            <Switch
              className="w-full"
              label={t('settings.examples.showTr')}
              description={t('settings.examples.showTrHint')}
              checked={settings.example_tr_visible === true}
              onCheckedChange={(v) => void update({ example_tr_visible: v })}
            />
          </SettingsRow>
          <SettingsRow
            label={t('settings.examples.prepareAll')}
            description={
              <>
                {t('settings.examples.prepareAllHint')}
                {userId === null && <span className="mt-1 block">{t('settings.examples.guest')}</span>}
                {userId && status && status.senses > 0 && (
                  <span className="tabular mt-1 block text-fg" aria-live="polite">
                    {t('settings.examples.status', { ready: status.ready, total: status.senses })}
                    {status.queued > 0 && ` · ${t('settings.examples.statusQueued', { count: status.queued })}`}
                  </span>
                )}
              </>
            }
          >
            <Button
              variant="secondary"
              leadingIcon="refresh"
              loading={starting}
              disabled={!userId || (status?.backfill === true && status.queued > 0)}
              onClick={() => void prepareAll()}
              className="shrink-0"
            >
              {t('settings.examples.prepareAll')}
            </Button>
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
}
