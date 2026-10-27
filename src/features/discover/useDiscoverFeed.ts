// What Keşfet can show today, read on the device (v0.5.1, ADR 0057). Builds one feed entry
// per thing there is (domain/discoverFeed.ts orders them); each entry carries its card's data.
// Network: the word bank and the graded library catalogue are pulled when the page opens
// (public data, both throttled); everything else is local.
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, lastUnfinishedText, listTexts } from '@/data';
import { kickGradedCatalogPull, scoreLibrary, type GradedPullOutcome } from '@/data/library';
import { dayConfig } from '@/data/settings';
import { storyInputs, todayStory } from '@/data/story';
import { dayKeyOf } from '@/domain/day';
import {
  dailyPick,
  dailyPicksWhere,
  type FeedEntry,
  feedEntry,
  type FeedFilter,
} from '@/domain/discoverFeed';
import { suggestTexts, type ScoredGradedText } from '@/domain/library';
import type { FalseFriendNote } from '@/domain/pairNotes';
import { MIN_STORY_TARGETS } from '@/domain/story';
import { deckWordStatus } from '@/domain/suggestedDecks';
import type { ReaderText } from '@/domain/texts';
import type { WordBankEntry } from '@/domain/wordBank';
import { useAuth } from '@/features/auth/session';
import { type DeckCard, useDeckView } from '@/features/decks/deckView';
import {
  type BankData,
  type Download,
  useBankData,
  useFalseFriends,
  useWordBankDownload,
} from '@/features/decks/suggested';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { useNow } from '@/features/settings/useNow';

/** "Kelimelerimle metin oluştur" needs this many of the user's words to pick from. */
export const CREATE_TEXT_MIN_WORDS = 3;
const SUGGESTIONS = 3;
const NEW_TEXTS = 3;
const MY_TEXTS = 3;
const WORDS_AT_LEVEL = 5;

/** A card of the feed: the ordering fields plus its own data. */
export type FeedItem =
  | (FeedEntry & { kind: 'continue'; text: ReaderText })
  | (FeedEntry & { kind: 'story' })
  | (FeedEntry & { kind: 'textSuggestions'; texts: ScoredGradedText[]; difficulty: string })
  | (FeedEntry & { kind: 'createText' })
  | (FeedEntry & { kind: 'newTexts'; texts: ScoredGradedText[] })
  | (FeedEntry & { kind: 'myTexts'; texts: ReaderText[]; total: number })
  | (FeedEntry & { kind: 'featuredDeck'; deck: DeckCard })
  | (FeedEntry & { kind: 'forYouDecks'; decks: (DeckCard & { upLevel: boolean })[] })
  | (FeedEntry & { kind: 'deckShelf'; levels: DeckCard[]; levelPos: DeckCard[] })
  | (FeedEntry & { kind: 'wordOfDay'; entry: WordBankEntry })
  | (FeedEntry & { kind: 'falseFriendOfDay'; note: FalseFriendNote; pairs: number })
  | (FeedEntry & { kind: 'wordsAtLevel'; entries: WordBankEntry[] });

export interface DiscoverData {
  /** undefined until the first local reads are in. */
  items: FeedItem[] | undefined;
  day: string;
  bank: BankData | undefined;
  falseFriends: FalseFriendNote[] | null;
  download: Download;
  library: GradedPullOutcome | 'running';
  /** Something could not be pulled and is still missing (offline, failed, no server). */
  missing: boolean;
  retry: () => void;
}

const isStuck = (s: string) => s === 'offline' || s === 'failed' || s === 'no_backend';

export function useDiscoverFeed(filter: FeedFilter): DiscoverData {
  const { settings } = useAppSettings();
  const auth = useAuth();
  const now = useNow();
  const day = settings ? dayKeyOf(now, dayConfig(settings)) : '';

  // ---- word bank (decks, words)
  const { download, retry: retryBank } = useWordBankDownload();
  const bank = useBankData();
  const falseFriends = useFalseFriends();
  // The deck view walks the whole bank: only "Hepsi" shows decks in the feed.
  const deckView = useDeckView(filter === 'hepsi' ? bank : undefined);

  // ---- graded library (only "Hepsi" lists library texts in the feed; Okuma shows the list)
  const [library, setLibrary] = useState<GradedPullOutcome | 'running'>('running');
  useEffect(() => {
    let live = true;
    void kickGradedCatalogPull().then((r) => live && setLibrary(r));
    return () => {
      live = false;
    };
  }, []);
  const lib = useLiveQuery(
    () => (filter === 'hepsi' ? scoreLibrary() : Promise.resolve(null)),
    [filter, library],
  );
  const catalogCount = useLiveQuery(() => db.graded_catalog.count(), [library]);

  // ---- the user's reading and words
  const last = useLiveQuery(() => lastUnfinishedText(), []);
  const texts = useLiveQuery(() => listTexts(), []);
  const wordCount = useLiveQuery(
    () => db.notes.filter((n) => n.deleted_at === null).count(),
    [],
  );
  const storyAllowed = auth.status === 'guest' || auth.status === 'signed_in';
  const story = useLiveQuery(
    async () => {
      if (!storyAllowed) return false;
      if (await todayStory()) return true;
      return (await storyInputs()).targets.length >= MIN_STORY_TARGETS;
    },
    [storyAllowed],
  );

  const retry = useCallback(() => {
    retryBank();
    setLibrary('running');
    void kickGradedCatalogPull({ force: true }).then(setLibrary);
  }, [retryBank]);

  // Word-bank words at the user's level, in a fixed order (the daily pick walks it).
  const levelWords = useMemo(() => {
    if (!bank) return [];
    return bank.entries
      .filter((e) => e.cefr === bank.level && e.senses.length > 0)
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [bank]);

  const items = useMemo((): FeedItem[] | undefined => {
    if (!day || last === undefined || texts === undefined || wordCount === undefined || story === undefined)
      return undefined;
    const out: FeedItem[] = [];

    // Okuma
    if (last) out.push({ ...feedEntry('continue'), text: last });
    if (story) out.push({ ...feedEntry('story') });
    if (wordCount >= CREATE_TEXT_MIN_WORDS) out.push({ ...feedEntry('createText') });
    if (lib && lib.texts.length > 0) {
      const sugg = suggestTexts(lib.texts, lib.difficulty, SUGGESTIONS, lib.finished);
      if (sugg.length > 0)
        out.push({ ...feedEntry('textSuggestions'), texts: sugg, difficulty: lib.difficulty });
      const shown = new Set(sugg.map((s) => s.entry.id));
      const fresh = [...lib.texts]
        .filter((s) => !shown.has(s.entry.id) && !lib.finished.has(s.entry.id) && s.fit !== 1)
        .sort((a, b) => b.entry.server_seq - a.entry.server_seq)
        .slice(0, NEW_TEXTS);
      if (fresh.length > 0) out.push({ ...feedEntry('newTexts'), texts: fresh });
    }
    if (texts.length > 0)
      out.push({ ...feedEntry('myTexts'), texts: texts.slice(0, MY_TEXTS), total: texts.length });

    // Desteler
    if (deckView) {
      if (deckView.featured) out.push({ ...feedEntry('featuredDeck'), deck: deckView.featured });
      if (deckView.forYou.length > 0) out.push({ ...feedEntry('forYouDecks'), decks: deckView.forYou });
      out.push({ ...feedEntry('deckShelf'), levels: deckView.levels, levelPos: deckView.levelPos });
    }

    // Kelimeler
    if (bank && levelWords.length > 0) {
      const open = dailyPicksWhere(
        levelWords,
        day,
        'word',
        (e) => deckWordStatus(e, bank.idx) === 'new',
        1 + WORDS_AT_LEVEL,
      );
      if (open[0]) out.push({ ...feedEntry('wordOfDay'), entry: open[0] });
      if (open.length > 1) out.push({ ...feedEntry('wordsAtLevel'), entries: open.slice(1) });
    }
    const ff = falseFriends ? dailyPick(falseFriends, day, 'false-friend') : undefined;
    if (ff && falseFriends) out.push({ ...feedEntry('falseFriendOfDay'), note: ff, pairs: falseFriends.length });

    return out;
  }, [day, last, texts, wordCount, story, lib, deckView, bank, levelWords, falseFriends]);

  const bankMissing = !!bank && bank.entries.length === 0 && isStuck(download);
  const libraryStatus = typeof library === 'string' ? library : library.status;
  const libraryMissing = catalogCount === 0 && isStuck(libraryStatus);

  return {
    items,
    day,
    bank,
    falseFriends,
    download,
    library,
    missing: bankMissing || libraryMissing,
    retry,
  };
}
