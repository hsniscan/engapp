// Addresses of Keşfet (v0.5.1, ADR 0057).
import type { FeedFilter } from '@/domain/discoverFeed';

/** "Kelimelerimle metin oluştur": the (+) sheet's text-from-my-words flow. */
export const CREATE_TEXT_HREF = '/metin-olustur';

/** Keşfet with a filter chip chosen ("Hepsi" is the plain address). */
export const filterHref = (f: FeedFilter) => (f === 'hepsi' ? '/kesfet' : `/kesfet?f=${f}`);
