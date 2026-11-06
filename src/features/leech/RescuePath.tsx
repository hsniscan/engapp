// "Önerilen yol" on the back of a card the learner keeps forgetting (v0.5.3 B5, ADR 0071):
// from 3 lapses, ONE recommended way to look at the word again, chosen by rule from what exists
// on this device (domain/leech.ts pickRescuePath): the false-friend warning, a mnemonic (the
// user's own or a suggestion, "Bunu kullan"), or the word family. Nothing shows when none of
// them exists; the "Başka yoldan bak" sheet stays one tap away in the menu.
import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { chooseMnemonic, getFoundFalseFriends, logError, type CardView } from '@/data';
import { isStruggling, pickRescuePath } from '@/domain/leech';
import { familyOf } from '@/domain/morphology';
import { normalizeTerm } from '@/domain/normalize';
import { falseFriendOfRow, falseFriendsFor, mergeFalseFriends, type FalseFriendNote } from '@/domain/pairNotes';
import { useFalseFriendIndex, useMorphology, useUserWords } from '@/features/family/hooks';
import { useMnemonicView } from '@/features/mnemonics';
import { Button, Card, Eyebrow, Icon, toast } from '@/ui';

export function RescuePath({ view }: { view: CardView }) {
  const type = view.note.term_type;
  if (!isStruggling(view.card.lapses) || type === 'contrast' || type === 'affix') return null;
  const sense = view.sense ?? view.senses[0] ?? null;
  return <RescueBody view={view} senseId={sense?.id ?? null} />;
}

function RescueBody({ view, senseId }: { view: CardView; senseId: string | null }) {
  const { t } = useTranslation();
  const term = view.note.term;
  const norm = normalizeTerm(view.note.term_norm || term);
  const ffIndex = useFalseFriendIndex();
  const found = useLiveQuery(() => getFoundFalseFriends(norm), [norm]);
  const mnemonic = useMnemonicView(senseId ?? '');
  const morphology = useMorphology();
  const words = useUserWords();
  // Wait for the device's own rows; the bundled lists (false friends, word families) join when
  // they have loaded, and are simply absent when they cannot be loaded (offline first start).
  if (found === undefined || (senseId && mnemonic === undefined) || words === undefined) return null;

  const falseFriends: FalseFriendNote[] = mergeFalseFriends(
    ffIndex ? falseFriendsFor(term, ffIndex) : [],
    found.map((r) => falseFriendOfRow(r, term)).filter((n): n is FalseFriendNote => n !== null),
  );
  const chosen = senseId && mnemonic ? mnemonic.chosen : null;
  const suggestion = senseId && mnemonic && !chosen ? (mnemonic.suggestions[0] ?? null) : null;
  const family = morphology ? familyOf(morphology, term, words.terms) : null;
  const others = family ? family.members.filter((m) => !m.self) : [];
  const path = pickRescuePath({
    falseFriend: falseFriends.length > 0,
    mnemonic: !!chosen || !!suggestion,
    family: others.length > 0,
  });
  if (!path) return null;

  let body: ReactNode;
  if (path === 'false_friend') {
    const ff = falseFriends[0]!.content;
    body = (
      <p>
        {t('leech.rescue.falseFriend', { term, tr: ff.tr_word })}{' '}
        <span lang="en" className="font-serif font-semibold">
          {term}
        </span>{' '}
        = {ff.en_meaning_tr} ·{' '}
        <span lang="tr" className="font-serif font-semibold">
          {ff.tr_word}
        </span>{' '}
        = {ff.tr_meaning_tr}
      </p>
    );
  } else if (path === 'mnemonic') {
    body = chosen ? (
      <p>
        {t('leech.rescue.mnemonicChosen')} <span lang="tr" className="font-medium">{chosen.text}</span>
      </p>
    ) : (
      <div className="flex flex-col gap-2">
        <p>
          {t('leech.rescue.mnemonicSuggestion')} <span lang="tr" className="font-medium">{suggestion!.text}</span>
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          data-testid="rescue-use-mnemonic"
          onClick={(e) => {
            e.stopPropagation();
            void chooseMnemonic(senseId!, suggestion!.id).then(
              () => toast({ title: t('leech.rescue.mnemonicSaved'), tone: 'neutral' }),
              (err: unknown) => void logError(err, 'RescuePath.choose'),
            );
          }}
        >
          {t('leech.rescue.useMnemonic')}
        </Button>
      </div>
    );
  } else {
    body = (
      <p>
        {t('leech.rescue.family')}{' '}
        <span lang="en" className="font-serif">
          {others
            .slice(0, 6)
            .map((m) => m.lemma)
            .join(' · ')}
        </span>
      </p>
    );
  }

  return (
    <Card
      as="section"
      aria-label={t('leech.rescue.label')}
      data-testid="rescue-path"
      data-path={path}
      className="flex flex-col gap-1.5 border-warn/40 bg-warn-soft"
    >
      <Eyebrow className="flex items-center gap-1.5 text-warn-text">
        <Icon name="bulb" size={16} />
        {t('leech.rescue.label')}
      </Eyebrow>
      <p className="text-meta text-fg-muted">{t('leech.rescue.lead', { count: view.card.lapses })}</p>
      <div className="text-ui text-fg">{body}</div>
    </Card>
  );
}
