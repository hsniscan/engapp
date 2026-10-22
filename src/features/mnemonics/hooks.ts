import { useLiveQuery } from 'dexie-react-hooks';
import { getCardMnemonic, getMnemonicView, type SenseMnemonicView } from '@/data';
import type { Id } from '@/domain/types';

/**
 * The chosen mnemonic of a sense of the user (live): a string, null when there is none, and
 * undefined while loading. For the card back and, later, a hint on the card front.
 */
export function useMnemonic(senseId: Id | null | undefined): string | null | undefined {
  return useLiveQuery(() => getCardMnemonic(senseId ?? null), [senseId ?? null]);
}

/** Everything the "Anımsatıcı" section shows for one sense (live; undefined while loading). */
export function useMnemonicView(senseId: Id): SenseMnemonicView | null | undefined {
  return useLiveQuery(() => getMnemonicView(senseId), [senseId]);
}
