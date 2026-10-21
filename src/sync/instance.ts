import { getUserId } from '@/lib/supabase';
import { SyncEngine, supabaseTransport } from './engine';
import { createTabRunner } from './lock';

/** The app's sync engine: Supabase transport, one runner per browser profile. */
export const engine: SyncEngine = new SyncEngine({
  transport: supabaseTransport,
  getSessionUserId: () => getUserId(),
  runner: createTabRunner('engapp-sync', () => void engine.sync()),
});
