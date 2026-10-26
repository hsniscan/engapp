// /functions/v1/push-send — Web Push reminders (v0.3 İP8). Routes and rules:
// supabase/functions/_shared/push-send.ts and docs/decisions/0024-web-push.md.
import { parseOrigins } from '../_shared/http.ts';
import { createPushHandler, vapidFromEnv } from '../_shared/push-send.ts';
import { log } from '../_shared/log.ts';
import {
  createAdminClient,
  createAuthenticator,
  loadServerConfig,
} from '../_shared/supabase-store.ts';
import { SupabasePushStore } from '../_shared/supabase-push-store.ts';

const env = (k: string) => Deno.env.get(k);
const cfg = loadServerConfig(env);

Deno.serve(
  createPushHandler({
    cors: { allowedOrigins: parseOrigins(env('ALLOWED_ORIGINS')) },
    store: new SupabasePushStore(createAdminClient(cfg)),
    vapid: vapidFromEnv(env),
    authenticate: createAuthenticator(cfg),
    log: log('push-send'),
  }),
);
