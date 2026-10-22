// Supabase-backed AccountDeleteStore (service-role client). See account-delete.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountDeleteStore } from './account-delete.ts';

const PAGE = 1000;

/** Minimal slice of the Storage API used here (so tests can fake it). */
export interface StorageApi {
  listBuckets(): Promise<{ data: { id: string }[] | null; error: { message: string } | null }>;
  from(bucket: string): {
    list(
      prefix: string,
      opts: { limit: number; offset: number },
    ): Promise<{
      data: { name: string; id: string | null }[] | null;
      error: { message: string } | null;
    }>;
    remove(paths: string[]): Promise<{ error: { message: string } | null }>;
  };
}

/** Every object path under `prefix` (folders are walked; their entries have id null). */
async function listAll(api: StorageApi, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await api.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`storage list ${bucket}: ${error.message}`);
    const page = data ?? [];
    for (const e of page) {
      const path = `${prefix}/${e.name}`;
      if (e.id === null) out.push(...(await listAll(api, bucket, path)));
      else out.push(path);
    }
    if (page.length < PAGE) return out;
  }
}

/** Removes every object under "<userId>/" in every bucket. Returns the number removed. */
export async function removeUserFiles(api: StorageApi, userId: string): Promise<number> {
  const { data: buckets, error } = await api.listBuckets();
  if (error) throw new Error(`storage buckets: ${error.message}`);
  let removed = 0;
  for (const b of buckets ?? []) {
    const paths = await listAll(api, b.id, userId);
    for (let i = 0; i < paths.length; i += PAGE) {
      const chunk = paths.slice(i, i + PAGE);
      const res = await api.from(b.id).remove(chunk);
      if (res.error) throw new Error(`storage remove ${b.id}: ${res.error.message}`);
      removed += chunk.length;
    }
  }
  return removed;
}

export class SupabaseAccountDeleteStore implements AccountDeleteStore {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  removeUserFiles(userId: string): Promise<number> {
    return removeUserFiles(this.db.storage as unknown as StorageApi, userId);
  }

  async deleteUserRows(userId: string): Promise<Record<string, number>> {
    const { data, error } = await this.db.rpc('delete_user_data', { p_user: userId });
    if (error) throw new Error(`delete_user_data: ${error.message}`);
    return (data ?? {}) as Record<string, number>;
  }

  async deleteAuthUser(userId: string): Promise<'deleted' | 'not_found'> {
    // Hard delete (shouldSoftDelete false): the row, identities and sessions are removed.
    const { error } = await this.db.auth.admin.deleteUser(userId, false);
    if (!error) return 'deleted';
    const e = error as { status?: number; code?: string; message: string };
    if (e.status === 404 || e.code === 'user_not_found') return 'not_found';
    throw new Error(`auth delete: ${e.message}`);
  }
}
