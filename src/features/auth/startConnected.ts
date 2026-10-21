// Startup of the connected features: auth session, account linking, sync engine triggers
// and the AI import queue. Idempotent; call once from main.tsx (it is also called by the
// sync indicator as a safety net).
import { kickImportQueue, startImportQueue } from '@/features/import/queue';
import { isBackendConfigured } from '@/lib/supabase';
import { startSyncEngine } from '@/sync';
import { supabaseTransport } from '@/sync/engine';
import { engine } from '@/sync/instance';
import { configureLink, linkAccount } from './link';
import { onUserChange, startAuth } from './session';

let started = false;

export function startConnectedFeatures(): void {
  if (started) return;
  started = true;
  if (!isBackendConfigured()) return; // guest-only build: everything stays local
  configureLink({ transport: supabaseTransport, engine });
  onUserChange((user) => {
    if (user) {
      void linkAccount(user.id);
      kickImportQueue();
    } else {
      void engine.isActive();
    }
  });
  startAuth();
  startSyncEngine();
  startImportQueue();
}
