import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '@/test/db';
import { uuidv7 } from '@/domain/ids';
import { CardState, Rating } from '@/domain/types';
import { WIDGET_STATE_KEY, parseWidgetState } from '@/domain/widget';

// The Android side, faked: the queue the notification buttons fill, the widget redraw, and the
// SharedPreferences store behind @capacitor/preferences.
const native = vi.hoisted(() => ({
  queue: [] as unknown[],
  acked: [] as string[][],
  refreshed: 0,
  prefs: new Map<string, string>(),
}));

vi.mock('@/app/router', () => ({ router: { navigate: vi.fn() } }));
vi.mock('@/sync', () => ({
  engine: { getSnapshot: () => ({ running: false }), subscribe: () => () => {} },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: async () => {} })) },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: native.prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) =>
      void native.prefs.set(key, value),
  },
}));
vi.mock('@capacitor/core', () => ({
  registerPlugin: (name: string) =>
    name === 'ReminderAnswers'
      ? {
          readQueue: async () => ({ items: [...native.queue] }),
          ack: async ({ ids }: { ids: string[] }) => {
            native.acked.push(ids);
            native.queue = native.queue.filter((x) => !ids.includes((x as { id: string }).id));
          },
        }
      : {
          refresh: async () => void native.refreshed++,
          addListener: async () => ({ remove: async () => {} }),
        },
}));

const { replayAnswerQueue, refreshWidgets, isAppRoute } = await import('./widget');
const { addNoteWithSenses, answerCard } = await import('@/data/actions');
const { db } = await import('@/data/db');
const { updateSettings } = await import('@/data/settings');

const T = Date.UTC(2026, 9, 21, 9);
const DAY = 86_400_000;

async function reviewCard(term: string, meaning: string) {
  const r = await addNoteWithSenses({ term, senses: [{ meaning_tr: meaning }] }, T - 5 * DAY);
  const card = (await db.cards.where('note_id').equals(r.note.id).toArray()).find(
    (c) => c.card_type === 'recognition',
  )!;
  await answerCard({ card_id: card.id, rating: Rating.Easy, duration_ms: 1000 }, T - 4 * DAY);
  await db.cards.update(card.id, { due: T - DAY });
  expect((await db.cards.get(card.id))?.state).toBe(CardState.Review);
  return card;
}

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - 10 * DAY);
  native.queue = [];
  native.acked = [];
  native.refreshed = 0;
  native.prefs.clear();
});

describe('notification answer queue', () => {
  it('applies each answer once and clears it, bad items too', async () => {
    const card = await reviewCard('resilient', 'dayanıklı');
    const id = uuidv7(T);
    native.queue = [
      { id, card_id: card.id, rating: 'Good', at: T },
      { id: 'broken', card_id: card.id, rating: 'Good', at: T },
    ];
    expect(await replayAnswerQueue(() => T + 60_000)).toBe(1);
    expect(native.acked).toEqual([['broken', id]]);
    expect(native.queue).toEqual([]);
    const log = await db.review_logs.get(id);
    expect(log).toMatchObject({ card_id: card.id, rating: Rating.Good, reviewed_at: T });

    // The app was killed before the queue was cleared: the item comes back and changes nothing.
    native.queue = [{ id, card_id: card.id, rating: 'Good', at: T }];
    const logs = await db.review_logs.count();
    expect(await replayAnswerQueue(() => T + 120_000)).toBe(0);
    expect(await db.review_logs.count()).toBe(logs);
    expect(native.queue).toEqual([]);
  });

  it('does nothing for an empty queue', async () => {
    expect(await replayAnswerQueue()).toBe(0);
    expect(native.acked).toEqual([]);
  });
});

describe('widget state', () => {
  it('writes widget_state to the preferences and redraws the widgets', async () => {
    const card = await reviewCard('resilient', 'dayanıklı');
    await refreshWidgets();
    const s = parseWidgetState(native.prefs.get(WIDGET_STATE_KEY));
    expect(s?.word?.note_id).toBe(card.note_id);
    expect(s?.word?.en).toBe('resilient');
    expect(native.refreshed).toBe(1);
  });

  it('opens only in-app routes', () => {
    expect(isAppRoute('/study?mode=word')).toBe(true);
    expect(isAppRoute('//evil.example')).toBe(false);
    expect(isAppRoute('https://x')).toBe(false);
    expect(isAppRoute(null)).toBe(false);
  });
});
