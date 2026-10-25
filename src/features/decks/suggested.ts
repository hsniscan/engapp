// Names and data hooks of the suggested decks (Keşfet, SuggestedDeckPage, the bank tab).
// The words come from the device's word bank copy (decision 0038), downloaded the first time
// one of these screens opens and refreshed at most every 15 minutes; after that, offline.
import { useLiveQuery } from 'dexie-react-hooks';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { getSettings, listWordBank } from '@/data';
import { getOwnedIndex } from '@/data/deckHub';
import type { FalseFriendNote } from '@/domain/pairNotes';
import {
  type OwnedIndex,
  parseSuggestedKey,
  type SuggestedSpec,
  suggestedKey,
  TOP_SIZES,
  CONTENT_POS,
} from '@/domain/suggestedDecks';
import { CEFR } from '@/domain/level';
import type { CefrLevel } from '@/domain/types';
import type { WordBankEntry } from '@/domain/wordBank';
import { fetchWordBank, type WordBankFetchOutcome } from '@/features/wordbank/fetcher';

export type Download = 'running' | WordBankFetchOutcome['status'];

/** The deck's name; also the tag (and smart deck) it gets in Destelerim. */
export function specTitle(t: TFunction, spec: SuggestedSpec): string {
  switch (spec.kind) {
    case 'top':
      return t('deckHub.deckName.top', { size: spec.size });
    case 'level':
      return t('deckHub.deckName.level', { level: spec.level });
    case 'pos':
      return t(`deckHub.deckName.pos.${spec.pos}`);
    case 'levelPos':
      return t(`deckHub.deckName.levelPos.${spec.pos}`, { level: spec.level });
    case 'falseFriends':
      return t('deckHub.deckName.falseFriends');
  }
}

export function specBody(t: TFunction, spec: SuggestedSpec): string {
  switch (spec.kind) {
    case 'top':
      return t('deckHub.deckBody.top', { size: spec.size });
    case 'level':
      return t('deckHub.deckBody.level', { level: spec.level });
    case 'pos':
      return t('deckHub.deckBody.pos', { pos: t(`deckHub.posPlural.${spec.pos}`) });
    case 'levelPos':
      return t('deckHub.deckBody.levelPos', {
        level: spec.level,
        pos: t(`deckHub.posPlural.${spec.pos}`),
      });
    case 'falseFriends':
      return t('deckHub.deckBody.falseFriends');
  }
}

export const specHref = (spec: SuggestedSpec) => `/decks/suggested/${suggestedKey(spec)}`;

/** Every suggested deck there is (to recognise a deck in Destelerim that came from one). */
export function allSpecs(): SuggestedSpec[] {
  return [
    ...TOP_SIZES.map((size): SuggestedSpec => ({ kind: 'top', size })),
    ...CEFR.map((level): SuggestedSpec => ({ kind: 'level', level })),
    ...CONTENT_POS.map((pos): SuggestedSpec => ({ kind: 'pos', pos })),
    ...CEFR.flatMap((level) => CONTENT_POS.map((pos): SuggestedSpec => ({ kind: 'levelPos', level, pos }))),
    { kind: 'falseFriends' },
  ];
}

/** Title (lower-cased, Turkish rules) → spec. */
export function titleIndex(t: TFunction): Map<string, SuggestedSpec> {
  return new Map(allSpecs().map((s) => [specTitle(t, s).toLocaleLowerCase('tr'), s]));
}

export { parseSuggestedKey };

/** Starts (or refreshes) the word bank download once per mount; `retry` forces a new run. */
export function useWordBankDownload(): { download: Download; retry: () => void } {
  const [download, setDownload] = useState<Download>('running');
  const run = useCallback(
    (force: boolean) => fetchWordBank(undefined, { force }).then((r) => setDownload(r.status)),
    [],
  );
  useEffect(() => {
    void run(false);
  }, [run]);
  const retry = useCallback(() => {
    setDownload('running');
    void run(true);
  }, [run]);
  return { download, retry };
}

export interface BankData {
  entries: WordBankEntry[];
  idx: OwnedIndex;
  level: CefrLevel;
}

/** The bank rows, what the user has and their level; undefined while loading. */
export function useBankData(): BankData | undefined {
  const entries = useLiveQuery(() => listWordBank(), []);
  const idx = useLiveQuery(() => getOwnedIndex(), []);
  const level = useLiveQuery(async () => (await getSettings()).level, []);
  if (!entries || !idx || level === undefined) return undefined;
  return { entries, idx, level: level ?? 'B1' };
}

/** The false-friend table (loaded on demand, ~17 KB); null until it is there. */
export function useFalseFriends(): FalseFriendNote[] | null {
  const [notes, setNotes] = useState<FalseFriendNote[] | null>(null);
  useEffect(() => {
    let live = true;
    void import('@/features/family/falseFriendsData')
      .then((m) => live && setNotes(m.FALSE_FRIENDS))
      .catch(() => live && setNotes([]));
    return () => {
      live = false;
    };
  }, []);
  return notes;
}

export const falseFriendLemmas = (notes: readonly FalseFriendNote[] | null): ReadonlySet<string> =>
  new Set((notes ?? []).map((n) => n.term_norm));
