// Opening a library text from anywhere (Bugün's "Bugünün okuması", Keşfet's feed, a deck's
// "Bu kelimelerin geçtiği metinler"; v0.5.1, decision 0054).
//
// Two ways, both make (or reuse) the user's reading row and its offline copy first:
//   - a link: `<Link to={readerPath(gradedId)}>`: the reader sees a library id, opens it and
//     replaces the address with the reading row's (ReaderPage LibraryRedirect);
//   - code: `navigate(await openReadingSuggestion(gradedId))`.
// The library's data code is loaded on demand, so neither pulls it into the start-up bundle.
import { readerPath } from '@/domain/texts';

/** The reader address of a library text, after its reading row is made; null when unknown. */
export async function openReadingSuggestion(gradedId: string): Promise<string | null> {
  const { openGradedById } = await import('@/data/library');
  const id = await openGradedById(gradedId);
  return id ? readerPath(id) : null;
}

/** A link to a library text (same as readerPath: the reader opens a library id itself). */
export const gradedReaderPath = (gradedId: string): string => readerPath(gradedId);
