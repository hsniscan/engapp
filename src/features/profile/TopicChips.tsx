import { useTranslation } from 'react-i18next';
import { TOPIC_KEYS, type TopicKey } from '@/domain/topics';
import { cn, Icon } from '@/ui';

/** The topic list as toggle buttons. A turned-off topic is marked; picking it turns it on. */
export function TopicChips({
  selected,
  muted,
  onToggle,
  labelledBy,
  compact,
}: {
  selected: ReadonlySet<TopicKey>;
  muted?: ReadonlySet<TopicKey>;
  onToggle: (topic: TopicKey, on: boolean) => void;
  labelledBy?: string;
  /** Smaller chips (36 px with a 44 px hit area) for the home card. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ul role="list" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {TOPIC_KEYS.map((topic) => {
        const on = selected.has(topic);
        const off = !on && muted?.has(topic);
        return (
          <li key={topic}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(topic, !on)}
              className={cn(
                'relative inline-flex items-center gap-1.5 rounded-full border',
                compact
                  ? "min-h-9 px-3 text-sm after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']"
                  : 'min-h-11 px-4 text-[0.9375rem]',
                'transition-[background-color,border-color,color] duration-(--duration-micro) ease-standard',
                on
                  ? 'border-accent bg-accent-soft font-medium text-accent-text'
                  : 'border-border bg-surface text-fg hover:border-border-strong hover:bg-surface-hover',
                off && 'border-dashed text-fg-muted',
              )}
            >
              {on && <Icon name="check" size={compact ? 14 : 16} strokeWidth={2} />}
              {t(`topics.${topic}`)}
              {off && <span className="text-sm text-fg-subtle">· {t('profile.mutedShort')}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
