// The hand-written false-friend list, parsed at runtime. Loaded with import() so the table
// (about 17 KB) stays out of the main bundle and is fetched the first time a card back or a
// word detail needs it.
import md from '../../../data/reference/false-friends.en-tr.md?raw';
import { indexFalseFriends, parseFalseFriendTable } from '@/domain/pairNotes';

const parsed = parseFalseFriendTable(md);

export const FALSE_FRIENDS = parsed.notes;
export const FALSE_FRIEND_ERRORS = parsed.errors;
export const FALSE_FRIEND_INDEX = indexFalseFriends(parsed.notes);
