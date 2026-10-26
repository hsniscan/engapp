// POST /functions/v1/account-delete — deletes the caller's account and every piece of their
// data (Google Play account-deletion requirement). Contract: _shared/account-delete-contract.ts;
// design: docs/decisions/0035-account-deletion.md.
import { runAccountDelete } from '../_shared/account-delete.ts';
import { SupabaseAccountDeleteStore } from '../_shared/account-delete-store.ts';
import { createHandler, parseOrigins } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import {
  createAdminClient,
  createAuthenticator,
  loadServerConfig,
} from '../_shared/supabase-store.ts';

const env = (k: string) => Deno.env.get(k);
const cfg = loadServerConfig(env);
const store = new SupabaseAccountDeleteStore(createAdminClient(cfg));
const logger = log('account-delete');

Deno.serve(
  createHandler({
    cors: { allowedOrigins: parseOrigins(env('ALLOWED_ORIGINS')) },
    // The user id comes only from the verified access token, never from the body.
    authenticate: createAuthenticator(cfg),
    log: logger,
    run: (body, userId) => runAccountDelete(body, { userId, store, log: logger }),
  }),
);
