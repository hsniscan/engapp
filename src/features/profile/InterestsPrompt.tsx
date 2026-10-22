// The one-time interests question on the home dashboard. It shows until the user answers it
// (saves a choice or presses "Şimdi değil"); the answer is a synced setting, so other devices
// do not ask again. Nothing blocks: the dashboard works the same around it.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSettings } from '@/data';
import type { TopicKey } from '@/domain/topics';
import { Button, cn, Surface, toast } from '@/ui';
import { saveFirstInterests, skipInterests } from './actions';
import { TopicChips } from './TopicChips';

export function InterestsPrompt({ className }: { className?: string }) {
  const asked = useLiveQuery(async () => (await getSettings()).interests != null, []);
  // Stays hidden while loading and once answered.
  if (asked !== false) return null;
  return <PromptCard className={className} />;
}

function PromptCard({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<ReadonlySet<TopicKey>>(new Set());
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const ok = await saveFirstInterests([...picked]);
    setBusy(false);
    if (ok)
      toast({ title: t('profile.saved'), description: t('profile.savedHint'), tone: 'success' });
  };

  return (
    <Surface
      as="section"
      aria-labelledby="interests-prompt-title"
      padding="none"
      className={cn('p-5 sm:p-6', className)}
    >
      <h2 id="interests-prompt-title" className="font-serif text-lg font-semibold text-fg">
        {t('profile.promptTitle')}
      </h2>
      <p className="mt-1 mb-4 text-[0.9375rem] text-fg-muted">{t('profile.promptBody')}</p>
      <TopicChips
        labelledBy="interests-prompt-title"
        compact
        selected={picked}
        onToggle={(topic, on) =>
          setPicked((s) => {
            const n = new Set(s);
            if (on) n.add(topic);
            else n.delete(topic);
            return n;
          })
        }
      />
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => void skipInterests()} disabled={busy}>
          {t('profile.promptLater')}
        </Button>
        <Button onClick={() => void save()} disabled={picked.size === 0} loading={busy}>
          {picked.size > 0
            ? t('profile.promptSaveCount', { count: picked.size })
            : t('profile.promptSave')}
        </Button>
      </div>
    </Surface>
  );
}
