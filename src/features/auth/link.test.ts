import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  answerCard,
  cardImageOf,
  chooseImage,
  createSource,
  db,
  ensureSettings,
  ensureWeeklyReport,
  finalizeReportDraft,
  getCurrentUserId,
  getStreakSummary,
  META,
  recordReaderEncounters,
  saveText,
  reconcileImageCards,
  setGoals,
  setImageHidden,
  setImageVerdict,
  setMeta,
  storeImage,
  updateSettings,
} from '@/data';
import { IMAGE_CHOICE_KIND, IMAGE_REASON_KIND, IMAGE_TARGET } from '@/domain/images';
import { SAMPLE_PICTURES } from '@/test/imageSamples';
import { SyncEngine } from '@/sync/engine';
import { FakeServer, loadDevice, saveDevice } from '@/sync/testing/fakeServer';
import { CardState, Rating } from '@/domain/types';
import { resetDb } from '@/test/db';
import { configureLink, getLinkState, linkAccount, resetLinkForTesting, resolveLink } from './link';

const T = Date.UTC(2026, 9, 21, 9);
const USER = 'user-1';
const OTHER = 'user-other';
let server: FakeServer;

function engine() {
  return new SyncEngine({
    transport: server,
    getSessionUserId: async () => USER,
    isOnline: () => true,
    now: () => T + 60_000,
  });
}

/** Device 1 of the account already synced "cope" and a review. */
async function accountWithData() {
  await resetDb();
  configureLink({ transport: server, engine: engine() });
  await updateSettings({ daily_new_limit: 25 }, T);
  const a = await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T);
  const rec = (await db.cards.where('note_id').equals(a.note.id).toArray()).find(
    (c) => c.card_type === 'recognition',
  )!;
  await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 2000 }, T);
  await linkAccount(USER);
  expect(getLinkState()).toMatchObject({ phase: 'done' });
  expect(server.rowsOf('notes')).toHaveLength(1);
}

const WEEK_MS = 7 * 86_400_000;

/**
 * v0.3 İP7: a weekly report (stored and queued for the push), next week's report still waiting
 * for its comment, and goals. T is a Wednesday: T + 5 days is the next Monday.
 */
async function addReportsAndGoals() {
  const monday = T + 5 * 86_400_000;
  const first = await ensureWeeklyReport(monday);
  expect(first.status).toBe('created');
  await finalizeReportDraft(first.week, null, monday);
  expect((await ensureWeeklyReport(monday + WEEK_MS)).status).toBe('created');
  await setGoals({ week_active_days: 6, week_minutes: 120 }, monday);
  expect(await db.weekly_reports.count()).toBe(1);
  expect(await db.report_drafts.count()).toBe(1);
}

/** Reports and goals of another account are never on this device or the server (decision 0009). */
async function expectNoReportsOrGoals() {
  expect(await db.weekly_reports.count()).toBe(0);
  expect(await db.report_drafts.count()).toBe(0);
  expect((await db.settings.get('settings'))!.goals ?? null).toBeNull();
  expect(server.rowsOf('weekly_reports')).toHaveLength(0);
  expect(JSON.stringify(server.rowsOf('settings'))).not.toContain('"week_active_days":6');
}

/** A guest device with its own data. */
async function guestDevice() {
  await resetDb();
  await ensureSettings(T);
  await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'üstesinden gelmek' }] }, T + 1);
  await addNoteWithSenses({ term: 'thrive', senses: [{ meaning_tr: 'gelişmek' }] }, T + 2);
}

/**
 * A device used by ANOTHER account: its own settings, notes, a source, studied cards,
 * an import job and a chunk cache row. Returns the ids of its rows.
 */
async function otherAccountDevice() {
  await resetDb();
  await db.transaction('rw', db.meta, () => setMeta(META.userId, OTHER));
  await updateSettings({ daily_new_limit: 3, level: 'C1' }, T);
  const src = await createSource({ kind: 'text', title: 'Article' }, T);
  const cope = await addNoteWithSenses(
    {
      term: 'cope',
      tags: ['work'],
      senses: [
        { meaning_tr: 'başa çıkmak' }, // the account has this meaning too
        {
          meaning_tr: 'üstesinden gelmek',
          meaning_tr_override: 'idare etmek',
          source_sentence: 'I can cope with it.',
          source_sentence_tr: 'Bununla başa çıkabilirim.',
          span: [6, 10],
          source_id: src.id,
        },
      ],
    },
    T + 1,
  );
  const thrive = await addNoteWithSenses(
    { term: 'thrive', tags: ['bio'], senses: [{ meaning_tr: 'gelişmek' }] },
    T + 2,
  );
  // Study everything, so that the other account has history, Review cards and unlocked siblings.
  for (let day = 0; day < 3; day++) {
    for (const c of await db.cards.toArray()) {
      if (c.unlocked)
        await answerCard(
          { card_id: c.id, rating: Rating.Easy, duration_ms: 3000 },
          T + 10 + day * 86_400_000,
        );
    }
  }
  await db.import_jobs.put({
    id: 'job-1',
    source_id: src.id,
    status: 'done',
    chunk_total: 1,
    chunk_done: 1,
    cache_hits: 0,
    error: null,
    created_at: T,
    updated_at: T,
  });
  await db.chunk_cache.put({ chunk_hash: 'h1', result: { terms: [] }, created_at: T });
  return {
    noteIds: [cope.note.id, thrive.note.id],
    senseIds: (await db.senses.toArray()).map((s) => s.id),
    cardIds: (await db.cards.toArray()).map((c) => c.id),
    sourceId: src.id,
  };
}

beforeEach(async () => {
  server = new FakeServer(USER);
  resetLinkForTesting();
  await resetDb();
});

describe('account linking', () => {
  it('first sign-in with an empty account: guest data is adopted and pushed', async () => {
    await guestDevice();
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'done', duplicates: 0 });
    expect(await getCurrentUserId()).toBe(USER);
    expect(await db.outbox.count()).toBe(0);
    expect(server.rowsOf('notes')).toHaveLength(2);
    expect((await db.notes.toArray()).every((n) => n.user_id === USER)).toBe(true);
  });

  it('same account again: just syncs, no question', async () => {
    await accountWithData();
    resetLinkForTesting();
    await linkAccount(USER);
    expect(getLinkState()).toEqual({ phase: 'idle' });
  });

  it('second device with only default settings takes the account as it is (account settings win)', async () => {
    await accountWithData();
    await resetDb();
    await ensureSettings(T + 5);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    expect((await db.settings.get('settings'))!.daily_new_limit).toBe(25);
    expect(await db.notes.count()).toBe(1);
  });

  it('second device with data asks; "birleştir" keeps both and flags the duplicate term', async () => {
    await accountWithData();
    await guestDevice();
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'choose', otherAccount: false });
    await resolveLink('merge');
    expect(getLinkState()).toMatchObject({ phase: 'done', duplicates: 2 });
    const cope = await db.notes.where('term_norm').equals('cope').toArray();
    expect(cope).toHaveLength(2);
    expect(cope.every((n) => n.possible_duplicate)).toBe(true);
    expect(await db.notes.where('term_norm').equals('thrive').count()).toBe(1);
    expect(await db.review_logs.count()).toBe(1);
    expect((await db.settings.get('settings'))!.daily_new_limit).toBe(25); // account settings kept
    expect(server.rowsOf('notes')).toHaveLength(3);
  });

  it('"yerel veriyi at" replaces this device with the account', async () => {
    await accountWithData();
    await guestDevice();
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    await resolveLink('discard_local');
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    const notes = await db.notes.toArray();
    expect(notes.map((n) => n.term)).toEqual(['cope']);
    expect(server.rowsOf('notes')).toHaveLength(1);
    expect(await db.review_logs.count()).toBe(1);
  });

  it('"hesaptakini at" tombstones the account rows and uploads this device', async () => {
    await accountWithData();
    const accountNoteId = server.rowsOf('notes')[0]!.id;
    await guestDevice();
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    await resolveLink('discard_account');
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    const live = server.rowsOf('notes').filter((n) => n.deleted_at == null);
    expect(live.map((n) => n.term).sort()).toEqual(['cope', 'thrive']);
    expect(server.rowsOf('notes').find((n) => n.id === accountNoteId)!.deleted_at).not.toBeNull();
    // Another device pulling now sees only this device's notes.
    const local = await saveDevice();
    await resetDb();
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(
      (await db.notes.filter((n) => n.deleted_at === null).toArray()).map((n) => n.term).sort(),
    ).toEqual(['cope', 'thrive']);
    await loadDevice(local);
  });

  it('"birleştir" with guest data keeps the guest review history (same person)', async () => {
    await accountWithData();
    await guestDevice();
    const thrive = (await db.cards.toArray()).find((c) => c.card_type === 'recognition')!;
    await answerCard({ card_id: thrive.id, rating: Rating.Good, duration_ms: 1000 }, T + 3);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'choose', otherAccount: false });
    await resolveLink('merge');
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    expect(await db.review_logs.count()).toBe(2);
    expect(server.rowsOf('review_logs')).toHaveLength(2);
    expect((await db.cards.get(thrive.id))!.reps).toBe(1);
  });

  it("another account's data: only copying the cards or starting with the account is allowed", async () => {
    const other = await otherAccountDevice();
    const img = await saveDevice();
    await accountWithData();
    await loadDevice(img);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'choose', otherAccount: true });
    for (const choice of ['merge', 'discard_account'] as const) {
      await resolveLink(choice);
      expect(getLinkState()).toMatchObject({ phase: 'error' });
    }
    // Nothing happened: the device still holds the other account's rows, the server is untouched.
    expect(await getCurrentUserId()).toBe(OTHER);
    expect((await db.notes.toArray()).map((n) => n.id).sort()).toEqual([...other.noteIds].sort());
    expect(server.rowsOf('notes')).toHaveLength(1);
    expect(server.rowsOf('review_logs')).toHaveLength(1);
  });

  it('"kartları kopyala" copies notes and senses as new cards without any study history', async () => {
    const other = await otherAccountDevice();
    await addReportsAndGoals();
    const otherLogs = await db.review_logs.count();
    expect(otherLogs).toBeGreaterThan(3);
    const img = await saveDevice();
    await accountWithData();
    const accountNote = server.rowsOf('notes')[0]!;
    const accountLog = server.rowsOf('review_logs')[0]!;
    await loadDevice(img);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'choose', otherAccount: true });
    await resolveLink('copy_cards');
    expect(getLinkState()).toMatchObject({ phase: 'done', duplicates: 0, copied: 2 });
    expect(await getCurrentUserId()).toBe(USER);

    // No review log of the other account, here or on the server: only the account's own.
    expect((await db.review_logs.toArray()).map((l) => l.id)).toEqual([accountLog.id]);
    expect(server.rowsOf('review_logs').map((l) => l.id)).toEqual([accountLog.id]);

    // The account's settings, not the other account's.
    const settings = (await db.settings.get('settings'))!;
    expect(settings.daily_new_limit).toBe(25);
    expect(settings.level).not.toBe('C1');

    // All rows belong to this account and none reuses an id of the other account.
    const notes = (await db.notes.toArray()).filter((n) => n.deleted_at === null);
    const senses = (await db.senses.toArray()).filter((s) => s.deleted_at === null);
    const cards = (await db.cards.toArray()).filter((c) => c.deleted_at === null);
    for (const r of [...notes, ...senses, ...cards]) expect(r.user_id).toBe(USER);
    const oldIds = new Set([...other.noteIds, ...other.senseIds, ...other.cardIds, other.sourceId]);
    for (const r of [...notes, ...senses, ...cards, ...(await db.sources.toArray())]) {
      expect(oldIds.has(r.id)).toBe(false);
    }

    // "cope" already existed: the account's note keeps its history and gets the missing
    // meaning; the shared meaning is not added twice. "thrive" is a new note.
    expect(notes.map((n) => n.term).sort()).toEqual(['cope', 'thrive']);
    const cope = notes.find((n) => n.term === 'cope')!;
    expect(cope.id).toBe(accountNote.id);
    expect(cope.tags).toEqual(['work']);
    expect(cope.possible_duplicate).toBe(false);
    const copeSenses = senses
      .filter((s) => s.note_id === cope.id)
      .sort((a, b) => a.sense_no - b.sense_no);
    expect(copeSenses.map((s) => s.meaning_tr)).toEqual(['başa çıkmak', 'üstesinden gelmek']);
    const copied = copeSenses[1]!;
    expect(copied).toMatchObject({
      meaning_tr_override: 'idare etmek',
      source_sentence: 'I can cope with it.',
      source_sentence_tr: 'Bununla başa çıkabilirim.',
      span: [6, 10],
    });
    const source = (await db.sources.toArray())[0]!;
    expect(copied.source_id).toBe(source.id);
    expect(source).toMatchObject({ title: 'Article', user_id: USER });

    // Copied cards are New; production/cloze stay locked until recognition reaches Review.
    const copiedCards = cards.filter((c) => c.note_id !== cope.id || c.sense_id === copied.id);
    expect(copiedCards.map((c) => c.card_type).sort()).toEqual([
      'cloze',
      'production',
      'production',
      'recognition',
    ]);
    for (const c of copiedCards) {
      expect(c).toMatchObject({ state: CardState.New, reps: 0, lapses: 0 });
      expect(c.unlocked).toBe(c.card_type === 'recognition');
    }
    // The account's own recognition card keeps its review.
    const accountRec = cards.find((c) => c.note_id === cope.id && c.card_type === 'recognition')!;
    expect(accountRec.reps).toBe(1);

    // Stats show only the account's own day; import jobs are gone, the chunk cache stays.
    expect((await db.daily_activity.toArray()).map((d) => d.reviews)).toEqual([1]);
    expect((await getStreakSummary(T + 60_000)).totalActiveDays).toBe(1);
    expect(await db.import_jobs.count()).toBe(0);
    expect(await db.chunk_cache.count()).toBe(1);

    // Pushed: the server has the copies under this account.
    expect(await db.outbox.count()).toBe(0);
    expect(server.rowsOf('notes')).toHaveLength(2);
    expect(server.rowsOf('senses')).toHaveLength(3);
    expect(server.rowsOf('cards').filter((c) => c.deleted_at == null)).toHaveLength(cards.length);

    // v0.3 İP7: the other account's weekly reports, waiting report and goals stay behind.
    await expectNoReportsOrGoals();
  });

  it("v0.4: another account's picture choice, hide flag and verdicts are never copied", async () => {
    const LEX = '0199f0a0-0000-7000-8000-00000000a001';
    const LEX2 = '0199f0a0-0000-7000-8000-00000000a002';
    const pic = (id: string, sense_id: string, variant: number) => ({
      id,
      sense_id,
      variant,
      svg: SAMPLE_PICTURES.apple.svg,
      alt_tr: 'Kırmızı bir elma',
      status: 'approved' as const,
      created_at: '2026-10-25T01:30:00Z',
      fetched_at: T,
    });
    const P0 = '0199f0a0-0000-7000-8000-0000000b0000';
    const P1 = '0199f0a0-0000-7000-8000-0000000b0001';
    const P2 = '0199f0a0-0000-7000-8000-0000000b0002';
    // The other account: "apple" with a picked second variant and a "Hayır" for the first;
    // "bridge" with its picture hidden.
    await resetDb();
    await db.transaction('rw', db.meta, () => setMeta(META.userId, OTHER));
    const apple = await addNoteWithSenses({ term: 'apple', senses: [{ meaning_tr: 'elma', lexicon_sense_id: LEX }] }, T);
    const bridge = await addNoteWithSenses({ term: 'bridge', senses: [{ meaning_tr: 'köprü', lexicon_sense_id: LEX2 }] }, T);
    for (const p of [pic(P0, LEX, 0), pic(P1, LEX, 1), pic(P2, LEX2, 0)]) await storeImage(p);
    const appleSense = (await db.senses.where('note_id').equals(apple.note.id).toArray())[0]!;
    const bridgeSense = (await db.senses.where('note_id').equals(bridge.note.id).toArray())[0]!;
    await chooseImage(appleSense.id, P1, T);
    await setImageVerdict(appleSense.id, P0, 'reject', 'wrong_meaning', T);
    await setImageVerdict(appleSense.id, P1, 'like', null, T);
    await setImageHidden(bridgeSense.id, true, T);
    expect(await db.user_content.count()).toBe(3);
    expect(await db.content_feedback.count()).toBe(2);
    const img = await saveDevice();

    await accountWithData();
    await loadDevice(img);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'choose', otherAccount: true });
    await resolveLink('copy_cards');
    expect(getLinkState()).toMatchObject({ phase: 'done' });

    // The words come along; none of the other account's picture rows, here or on the server.
    const kinds = (rows: { kind?: unknown }[]) => rows.map((r) => r.kind);
    expect(kinds(await db.user_content.toArray())).not.toContain(IMAGE_CHOICE_KIND);
    expect(kinds(await db.user_content.toArray())).not.toContain(IMAGE_REASON_KIND);
    expect((await db.content_feedback.toArray()).filter((f) => f.target_kind === IMAGE_TARGET)).toEqual([]);
    for (const r of server.rowsOf('user_content')) expect([IMAGE_CHOICE_KIND, IMAGE_REASON_KIND]).not.toContain(r.kind);
    expect(server.rowsOf('content_feedback').filter((f) => f.target_kind === IMAGE_TARGET)).toEqual([]);

    // The shared picture cache stays; the copied words show the default picture, not hidden.
    expect(await db.images.count()).toBe(3);
    const senses = (await db.senses.toArray()).filter((s) => s.deleted_at === null);
    const copiedApple = senses.find((s) => s.lexicon_sense_id === LEX)!;
    const copiedBridge = senses.find((s) => s.lexicon_sense_id === LEX2)!;
    expect(copiedApple.id).not.toBe(appleSense.id);
    expect((await cardImageOf(copiedApple))?.id).toBe(P0);
    expect((await cardImageOf(copiedBridge))?.id).toBe(P2);
  });

  it('v0.4 İP8: picture cards are not copied with their history; the copy gets a new one, New and locked', async () => {
    const LEX = '0199f0a0-0000-7000-8000-00000000a001';
    await resetDb();
    await db.transaction('rw', db.meta, () => setMeta(META.userId, OTHER));
    await addNoteWithSenses({ term: 'apple', senses: [{ meaning_tr: 'elma', lexicon_sense_id: LEX }] }, T);
    await storeImage({
      id: '0199f0a0-0000-7000-8000-0000000b0000',
      sense_id: LEX,
      variant: 0,
      svg: SAMPLE_PICTURES.apple.svg,
      alt_tr: 'Kırmızı bir elma',
      status: 'approved',
      created_at: '2026-10-25T01:30:00Z',
      fetched_at: T,
    });
    await reconcileImageCards({}, T);
    const rec = (await db.cards.toArray()).find((c) => c.card_type === 'recognition')!;
    await answerCard({ card_id: rec.id, rating: Rating.Easy, duration_ms: 1000 }, T);
    const old = (await db.cards.toArray()).find((c) => c.card_type === 'image')!;
    await answerCard({ card_id: old.id, rating: Rating.Good, duration_ms: 1000 }, T + 1000);
    const img = await saveDevice();

    await accountWithData();
    await loadDevice(img);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    await resolveLink('copy_cards');
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    await reconcileImageCards({}, T + 2000);

    const pictureCards = (await db.cards.toArray()).filter((c) => c.card_type === 'image' && c.deleted_at === null);
    expect(pictureCards).toHaveLength(1);
    expect(pictureCards[0]).toMatchObject({ state: CardState.New, reps: 0, unlocked: false, user_id: USER });
    expect(pictureCards[0]!.id).not.toBe(old.id);
    const logs = await db.review_logs.toArray();
    expect(logs.filter((l) => l.card_id === old.id || l.card_id === pictureCards[0]!.id)).toEqual([]);
  });

  it('"bu hesabın verisiyle başla" keeps only the account on this device', async () => {
    await otherAccountDevice();
    await addReportsAndGoals();
    const img = await saveDevice();
    await accountWithData();
    await loadDevice(img);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    await resolveLink('discard_local');
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    expect((await db.notes.toArray()).map((n) => n.term)).toEqual(['cope']);
    expect(await db.review_logs.count()).toBe(1);
    expect((await db.settings.get('settings'))!.daily_new_limit).toBe(25);
    expect(server.rowsOf('notes')).toHaveLength(1);
    await expectNoReportsOrGoals();
  });

  it("another account's leftover settings are not carried into an account", async () => {
    await resetDb();
    await db.transaction('rw', db.meta, () => setMeta(META.userId, OTHER));
    // v0.3 İP8: the other account's reminder setting stays behind as well.
    await updateSettings({ daily_new_limit: 3, notify: { enabled: true, mode: 'fixed', hour: 9 } }, T);
    // v0.3 İP7: and so do its goals.
    await setGoals({ week_active_days: 6 }, T);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER); // nothing local but settings: no question
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    expect(await getCurrentUserId()).toBe(USER);
    expect((await db.settings.get('settings'))!.daily_new_limit).toBe(10);
    expect((await db.settings.get('settings'))!.notify ?? null).toBeNull();
    expect(JSON.stringify(server.rowsOf('settings'))).not.toContain('"notify":{"enabled":true');
    expect((await db.settings.get('settings'))!.goals ?? null).toBeNull();
    expect(JSON.stringify(server.rowsOf('settings'))).not.toContain('week_active_days');
  });

  it('a guest’s weekly reports and goals go with the guest data to the account', async () => {
    await guestDevice();
    const rec = (await db.cards.toArray()).find((c) => c.card_type === 'recognition')!;
    await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 2000 }, T);
    await addReportsAndGoals();
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    expect(server.rowsOf('weekly_reports').map((r) => r.user_id)).toEqual([USER]);
    expect((await db.settings.get('settings'))!.goals).toEqual({ week_active_days: 6, week_minutes: 120 });
    // The waiting report stays on the device and gets its comment later.
    expect(await db.report_drafts.count()).toBe(1);
  });

  it('v0.5: a guest’s texts and encounters go with the guest data to the account', async () => {
    await guestDevice();
    const textId = await saveText({ kind: 'paste', title: 'Walk', body: 'I cope with it.' }, T + 3);
    const note = (await db.notes.toArray())[0]!;
    expect(await recordReaderEncounters(textId, 'open-1', [note.id], T + 4)).toBe(1);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    expect(server.rowsOf('texts').map((r) => [r.id, r.user_id])).toEqual([[textId, USER]]);
    expect(server.rowsOf('encounters').map((r) => [r.note_id, r.user_id, r.n])).toEqual([[note.id, USER, 1]]);
  });

  it("v0.5: another account's texts and encounters are never copied with its cards", async () => {
    await otherAccountDevice();
    const textId = await saveText({ kind: 'paste', title: 'Private', body: 'My diary: I cope.' }, T + 5);
    await recordReaderEncounters(textId, 'open-1', (await db.notes.toArray()).map((n) => n.id), T + 6);
    expect(await db.encounters.count()).toBeGreaterThan(0);
    const img = await saveDevice();
    await accountWithData();
    await loadDevice(img);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    await resolveLink('copy_cards');
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    expect(await db.texts.count()).toBe(0);
    expect(server.rowsOf('texts')).toHaveLength(0);
    expect(JSON.stringify(server.rowsOf('encounters'))).not.toContain('reader');
    expect((await db.encounters.toArray()).every((r) => r.source === 'review' && r.user_id === USER)).toBe(true);
  });

  it("another account's data is never copied silently into an empty account", async () => {
    await guestDevice();
    await db.transaction('rw', db.meta, () =>
      db.meta.put({ key: 'user_id', value: 'someone-else' }),
    );
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER); // the server account is empty
    expect(getLinkState()).toMatchObject({ phase: 'choose', otherAccount: true });
    expect(server.rowsOf('notes')).toHaveLength(0);
  });

  it('a failed check (offline) shows an error that can be retried', async () => {
    await guestDevice();
    server.faults.offline = true;
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'error' });
    expect(await getCurrentUserId()).toBeNull(); // nothing changed locally
  });
});
