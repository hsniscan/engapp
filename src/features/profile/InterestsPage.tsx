// Profil → İlgi alanların (/settings/ilgi-alanlari): pick interests, see how much each topic
// weighs and why, turn topics off. Rendered inside the settings sub-page frame.
import { useTranslation } from 'react-i18next';
import type { TopicWeight } from '@/domain/profile';
import type { TopicKey } from '@/domain/topics';
import { Button, Icon, ProgressBar, Skeleton, Surface } from '@/ui';
import { pickTopic, muteTopic } from './actions';
import { formatWeight, topicReason } from './reasons';
import { TopicChips } from './TopicChips';
import { useTopicProfile } from './useTopicProfile';

export function InterestsBody() {
  const profile = useTopicProfile();

  return (
    <>
      {!profile ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <Surface key={i} padding="lg">
              <Skeleton lines={4} />
            </Surface>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <InterestsSection weights={profile.weights} />
          <WeightsSection weights={profile.weights} />
          <MutedSection weights={profile.weights} />
          <RuleNote />
        </div>
      )}
    </>
  );
}

function SectionHead({ id, title, body }: { id: string; title: string; body?: string }) {
  return (
    <div className="mb-4 flex flex-col gap-1">
      <h2 id={id} className="font-serif text-xl font-semibold text-fg">
        {title}
      </h2>
      {body && <p className="text-[0.9375rem] text-fg-muted">{body}</p>}
    </div>
  );
}

function InterestsSection({ weights }: { weights: TopicWeight[] }) {
  const { t } = useTranslation();
  const selected = new Set(weights.filter((w) => w.selected).map((w) => w.topic));
  const muted = new Set(weights.filter((w) => w.muted).map((w) => w.topic));
  return (
    <Surface as="section" aria-labelledby="profile-pick" padding="none" className="p-5 sm:p-6">
      <SectionHead id="profile-pick" title={t('profile.pickTitle')} body={t('profile.pickBody')} />
      <TopicChips
        labelledBy="profile-pick"
        selected={selected}
        muted={muted}
        onToggle={(topic, on) => void pickTopic(topic, on)}
      />
    </Surface>
  );
}

function WeightsSection({ weights }: { weights: TopicWeight[] }) {
  const { t, i18n } = useTranslation();
  const shown = weights.filter((w) => w.weight > 0);
  const max = Math.max(...shown.map((w) => w.weight), 1);
  return (
    <Surface as="section" aria-labelledby="profile-weights" padding="none" className="p-5 sm:p-6">
      <SectionHead
        id="profile-weights"
        title={t('profile.weightsTitle')}
        body={shown.length ? t('profile.weightsBody') : undefined}
      />
      {shown.length === 0 ? (
        <p className="text-[0.9375rem] text-fg-muted">{t('profile.weightsEmpty')}</p>
      ) : (
        <ul className="-my-3 divide-y divide-border">
          {shown.map((w) => {
            const name = t(`topics.${w.topic}`);
            const value = formatWeight(w.weight, i18n.language);
            return (
              <li key={w.topic} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-fg">{name}</span>
                    <span aria-hidden="true" className="tabular text-sm text-fg-muted">
                      {value}
                    </span>
                  </div>
                  <ProgressBar
                    size="md"
                    className="mt-2"
                    value={w.weight}
                    max={max}
                    label={name}
                    valueText={t('profile.weightValue', { value })}
                  />
                  <p className="mt-1.5 text-sm text-fg-muted">{topicReason(t, w)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-mr-2 text-fg-muted"
                  aria-label={t('profile.muteLabel', { topic: name })}
                  onClick={() => void muteTopic(w.topic, true, w.selected)}
                >
                  {t('profile.mute')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}

function MutedSection({ weights }: { weights: TopicWeight[] }) {
  const { t } = useTranslation();
  const muted: TopicKey[] = weights.filter((w) => w.muted).map((w) => w.topic);
  if (muted.length === 0) return null;
  return (
    <Surface as="section" aria-labelledby="profile-muted" padding="none" className="p-5 sm:p-6">
      <SectionHead
        id="profile-muted"
        title={t('profile.mutedTitle')}
        body={t('profile.mutedBody')}
      />
      <ul className="-my-1 divide-y divide-border">
        {muted.map((topic) => {
          const name = t(`topics.${topic}`);
          return (
            <li key={topic} className="flex min-h-12 items-center justify-between gap-3 py-1">
              <span className="text-fg-muted">{name}</span>
              <Button
                variant="secondary"
                size="sm"
                aria-label={t('profile.unmuteLabel', { topic: name })}
                onClick={() => void muteTopic(topic, false)}
              >
                {t('profile.unmute')}
              </Button>
            </li>
          );
        })}
      </ul>
    </Surface>
  );
}

function RuleNote() {
  const { t } = useTranslation();
  return (
    <details className="group rounded-card px-1 text-sm text-fg-muted">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-medium text-fg [&::-webkit-details-marker]:hidden">
        <Icon
          name="chevron-right"
          size={16}
          className="transition-transform duration-(--duration-micro) group-open:rotate-90 motion-reduce:transition-none"
        />
        {t('profile.ruleTitle')}
      </summary>
      <div className="mt-1 flex flex-col gap-2 pl-5.5">
        <p>{t('profile.rule')}</p>
        <p>{t('profile.ruleUse')}</p>
      </div>
    </details>
  );
}
