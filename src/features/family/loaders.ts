// Lazy, cached loaders for the family reference data. Each loads once per page; a failed
// load is forgotten so the next use tries again (offline → online).
import { loadRefFile } from '@/data';
import { indexMorphology, type MorphologyFile, type MorphologyIndex } from '@/domain/morphology';
import type { FalseFriendNote } from '@/domain/pairNotes';
import { MORPHOLOGY_ASSET } from './morphologyAsset';

let morphology: Promise<MorphologyIndex> | null = null;
let falseFriends: Promise<Map<string, FalseFriendNote[]>> | null = null;

export function loadMorphology(): Promise<MorphologyIndex> {
  morphology ??= loadRefFile<MorphologyFile>('morphology', MORPHOLOGY_ASSET)
    .then(indexMorphology)
    .catch((e: unknown) => {
      morphology = null;
      throw e;
    });
  return morphology;
}

export function loadFalseFriends(): Promise<Map<string, FalseFriendNote[]>> {
  falseFriends ??= import('./falseFriendsData')
    .then((m) => m.FALSE_FRIEND_INDEX)
    .catch((e: unknown) => {
      falseFriends = null;
      throw e;
    });
  return falseFriends;
}

/** Tests: forget the loaded data. */
export function resetFamilyLoaders(): void {
  morphology = null;
  falseFriends = null;
}
