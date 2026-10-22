import { describe, expect, it } from 'vitest';
import { fillLateColumns } from './syncMerge';

describe('fillLateColumns (same HLC: take columns an older version dropped)', () => {
  it('takes a level the server has over the local unset value', () => {
    const local = { id: 'n1', hlc: 'h', tags: ['a'], level_override: null };
    const out = fillLateColumns('notes', { ...local, level_override: 'C1' }, local);
    expect(out).toEqual({ ...local, level_override: 'C1' });
  });

  it('never lets an unset server value overwrite a local one (backend without the column)', () => {
    const local = { id: 'n1', hlc: 'h', level_override: 'B2' };
    expect(fillLateColumns('notes', { ...local, level_override: null }, local)).toBe(local);
    const settings = {
      id: 'settings',
      level_source: 'test',
      level_locked: true,
      level_updated_at: 5,
      interests: ['tech'],
    };
    const bare = {
      id: 'settings',
      level_source: 'default',
      level_locked: false,
      level_updated_at: null,
      interests: null,
    };
    expect(fillLateColumns('settings', bare, settings)).toBe(settings);
  });

  it('restores the level test source, lock and interests of settings', () => {
    const local = {
      id: 'settings',
      level: 'C1',
      level_source: 'manual',
      level_locked: false,
      level_updated_at: null,
    };
    const remote = {
      ...local,
      level_source: 'test',
      level_locked: true,
      level_updated_at: 1761000000000,
      interests: [],
      show_easy_candidates: true,
    };
    expect(fillLateColumns('settings', remote, local)).toEqual(remote);
  });

  it('returns the local row itself when there is nothing to take, and ignores other tables', () => {
    const local = { id: 's1', topics: ['science'] };
    expect(fillLateColumns('sources', { id: 's1', topics: ['science'] }, local)).toBe(local);
    const card = { id: 'c1', due: 1 };
    expect(fillLateColumns('cards', { id: 'c1', due: 2 }, card)).toBe(card);
  });
});
