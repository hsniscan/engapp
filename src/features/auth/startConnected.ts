// Startup of the connected features: auth session, account linking, sync engine triggers
// the AI import queue and the example sentence preparation. Idempotent; call once from main.tsx (it is also called by the
// sync indicator as a safety net).
import { kickAnkiEnrich, startAnkiEnrichQueue } from '@/features/anki/enrichQueue';
import { kickExampleQueue, startExampleQueue } from '@/features/examples/queue';
import { kickImportQueue, startImportQueue } from '@/features/import/queue';
import { kickImageFetch, startImageFetch } from '@/features/images/fetcher';
import { startGradedCatalog } from '@/features/library/fetcher';
import { startPushFeatures } from '@/features/notify/start';
import { kickReports } from '@/features/report/queue';
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
      // The report waits for the account link (its data may be replaced or adopted).
      void linkAccount(user.id).finally(() => kickReports());
      kickImportQueue();
      kickExampleQueue();
      kickAnkiEnrich();
      kickImageFetch();
    } else {
      void engine.isActive();
    }
  });
  startPushFeatures(); // before startAuth: it listens for the restored session
  startAuth();
  startSyncEngine();
  startImportQueue();
  startExampleQueue();
  startAnkiEnrichQueue();
  startImageFetch();
  startGradedCatalog();
}
