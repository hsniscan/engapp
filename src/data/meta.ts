import { uuidv7 } from '../domain/ids';
import { db } from './db';

export const META = {
  deviceId: 'device_id',
  userId: 'user_id',
  hlc: 'hlc',
  schemaVersion: 'schema_version',
  syncCursor: 'sync_cursor',
  lexiconCursor: 'lexicon_cursor',
  /** The server answered sync_pull_v3, so it stores practice_logs (see sync/engine.ts). */
  serverPractice: 'server_practice_logs',
  /** Tables added after the registry (LATE_SYNC_TABLES) that the server confirmed it stores. */
  serverTables: 'server_tables',
} as const;

/** Meta key of a day's extra new-card allowance ("+5 yeni kart"). Device-local, never synced. */
export const EXTRA_NEW_PREFIX = 'extra_new:';
export const extraNewKey = (day: string): string => `${EXTRA_NEW_PREFIX}${day}`;

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Stable id of this browser profile, created on first use. */
export async function getDeviceId(): Promise<string> {
  return db.transaction('rw', db.meta, async () => {
    const existing = await getMeta<string>(META.deviceId);
    if (existing) return existing;
    const id = uuidv7();
    await setMeta(META.deviceId, id);
    return id;
  });
}

/** Signed-in user id stamped on new rows; null in guest mode. */
export async function getCurrentUserId(): Promise<string | null> {
  return (await getMeta<string | null>(META.userId)) ?? null;
}
