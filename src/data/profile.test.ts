// Interest profile on the local database: settings lists, source topics, sync merge, backup.
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { encodeHlc } from '../domain/hlc';
import type { Settings, Source } from '../domain/types';
import { resetDb } from '../test/db';
import { createSource } from './actions';
import { db, EngDb } from './db';
import { applyRemoteRows, exportBackup, restoreBackup } from './maintenance';
import {
  dismissInterestPrompt,
  getOrderedContexts,
  getTopicProfile,
  saveInterests,
  setInterest,
  setSourceTopics,
  setTopicMuted,
} from './profile';
import { getSettings, updateSettings } from './settings';

const T = Date.UTC(2026, 9, 21, 9);
const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - DAY);
});

const outboxFor = async (table: string) =>
  (await db.outbox.toArray()).filter((r) => r.table === table);

describe('interests', () => {
  it('starts unasked; "Şimdi değil" answers it with nothing picked and syncs', async () => {
    expect((await getTopicProfile(T)).asked).toBe(false);
    const before = (await outboxFor('settings')).length;
    await dismissInterestPrompt(T);
    const p = await getTopicProfile(T);
    expect(p).toMatchObject({ asked: true, interests: [], ranked: [] });
    const queued = await outboxFor('settings');
    expect(queued.length).toBe(before + 1);
    expect(queued.at(-1)!.payload).toMatchObject({ interests: [], muted_topics: [] });
  });

  it('saves a first choice and ranks it', async () => {
    await saveInterests(['travel', 'technology'], T);
    const p = await getTopicProfile(T);
    expect(p.asked).toBe(true);
    expect(p.ranked).toEqual(['technology', 'travel']);
    expect((await getSettings(T)).interests).toEqual(['travel', 'technology']);
  });

  it('picking a turned-off topic turns it on; turning a topic off unpicks it', async () => {
    await setInterest('sports', true, T);
    await setTopicMuted('sports', true, T + 1);
    let s = await getSettings(T);
    expect(s).toMatchObject({ interests: [], muted_topics: ['sports'] });
    await setInterest('sports', true, T + 2);
    s = await getSettings(T);
    expect(s).toMatchObject({ interests: ['sports'], muted_topics: [] });
    await setTopicMuted('law', true, T + 3);
    await setTopicMuted('law', false, T + 4);
    expect((await getSettings(T)).muted_topics).toEqual([]);
  });

  it('keeps topic keys a newer version wrote', async () => {
    await updateSettings({ interests: ['future_topic'], muted_topics: ['other_future'] }, T);
    await setInterest('food', true, T + 1);
    await saveInterests(['law'], T + 2);
    await setTopicMuted('law', true, T + 3);
    expect(await getSettings(T)).toMatchObject({
      interests: ['future_topic'],
      muted_topics: ['other_future', 'law'],
    });
  });

  it('does not change other settings', async () => {
    await updateSettings({ daily_new_limit: 17, level: 'B2' }, T);
    await setInterest('science', true, T + 1);
    expect(await getSettings(T)).toMatchObject({
      daily_new_limit: 17,
      level: 'B2',
      interests: ['science'],
    });
  });
});

describe('source topics', () => {
  it('stores clean topics once and feeds the profile', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push((await createSource({ kind: 'text', title: `t${i}` }, T)).id);
    for (const id of ids) await setSourceTopics(id, ['Technology', 'astrology'], T);
    const before = (await outboxFor('sources')).length;
    await setSourceTopics(ids[0]!, ['technology'], T); // unchanged: no write
    expect((await outboxFor('sources')).length).toBe(before);

    expect((await db.sources.get(ids[0]!))!.topics).toEqual(['technology']);
    expect(await db.sources.where('topics').equals('technology').count()).toBe(3);
    const p = await getTopicProfile(T);
    expect(p.weights[0]).toMatchObject({ topic: 'technology', texts: 3, weight: 3 });
    // Plan acceptance: three technology texts → the "technology" tab opens first.
    expect(
      (await getOrderedContexts(['daily', 'conversation', 'work', 'formal', 'technology'], T))[0],
    ).toBe('technology');
  });

  it('a deleted text no longer counts', async () => {
    const s = await createSource({ kind: 'pdf', title: 'x' }, T);
    await setSourceTopics(s.id, ['law'], T);
    await db.sources.update(s.id, { deleted_at: T });
    expect((await getTopicProfile(T)).ranked).toEqual([]);
  });
});

describe('sync merge', () => {
  const remoteHlc = (ms: number) => encodeHlc({ ms, counter: 0, node: 'remote00' });

  it('a pulled settings row without the lists (older client) keeps the local ones', async () => {
    await saveInterests(['travel'], T);
    const local = (await db.settings.get('settings'))!;
    const { interests: _i, muted_topics: _m, ...older } = local;
    const res = await applyRemoteRows(
      { settings: [{ ...older, theme: 'dark', hlc: remoteHlc(T + DAY) }] },
      T + DAY,
    );
    expect(res.applied).toBe(1);
    expect(await db.settings.get('settings')).toMatchObject({
      theme: 'dark',
      interests: ['travel'],
      muted_topics: [],
    });
  });

  it('a pulled empty list wins (it means "none", not "unknown")', async () => {
    await saveInterests(['travel'], T);
    const local = (await db.settings.get('settings'))!;
    await applyRemoteRows(
      { settings: [{ ...local, interests: [], hlc: remoteHlc(T + DAY) }] },
      T + DAY,
    );
    expect((await db.settings.get('settings'))!.interests).toEqual([]);
  });

  it('a pulled source keeps its topics, and a null one keeps the local topics', async () => {
    const s = await createSource({ kind: 'text', title: 'a' }, T);
    await setSourceTopics(s.id, ['food'], T);
    const local = (await db.sources.get(s.id))!;
    await applyRemoteRows(
      { sources: [{ ...local, title: 'b', topics: null, hlc: remoteHlc(T + DAY) }] },
      T + DAY,
    );
    expect(await db.sources.get(s.id)).toMatchObject({ title: 'b', topics: ['food'] });
    const fresh: Source = {
      ...local,
      id: '01999999-0000-7000-8000-0000000000aa',
      topics: ['law'],
      hlc: remoteHlc(T + DAY),
    };
    await applyRemoteRows({ sources: [fresh] }, T + DAY);
    expect((await db.sources.get(fresh.id))!.topics).toEqual(['law']);
  });
});

describe('backup', () => {
  it('round-trips the lists and the source topics', async () => {
    await saveInterests(['film'], T);
    await setTopicMuted('law', true, T);
    const s = await createSource({ kind: 'text', title: 'a' }, T);
    await setSourceTopics(s.id, ['film'], T);
    const backup = JSON.parse(JSON.stringify(await exportBackup(T)));
    await resetDb();
    await restoreBackup(backup, 'merge', T + 1);
    const settings: Settings = (await db.settings.get('settings'))!;
    expect(settings).toMatchObject({ interests: ['film'], muted_topics: ['law'] });
    expect((await db.sources.get(s.id))!.topics).toEqual(['film']);
  });
});

describe('Dexie v7', () => {
  it('upgrades a version 3 database, keeps sources and indexes their topics', async () => {
    const name = 'upgrade-v7-test';
    const old = new Dexie(name);
    old.version(3).stores({ sources: 'id, created_at', settings: 'id' });
    await old.open();
    await old.table('sources').add({ id: 's1', created_at: 1, title: 'old' });
    await old.table('settings').add({ id: 'settings', theme: 'dark' });
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(d.table('sources').schema.indexes.find((i) => i.name === 'topics')?.multi).toBe(true);
    expect(await d.sources.get('s1')).toMatchObject({ title: 'old' });
    expect((await d.sources.get('s1'))!.topics).toBeUndefined();
    expect(await d.settings.get('settings')).toMatchObject({ theme: 'dark' });
    await d.sources.put({ ...(await d.sources.get('s1'))!, topics: ['law', 'politics'] });
    expect(await d.sources.where('topics').equals('politics').count()).toBe(1);
    d.close();
    await d.delete();
  });
});
