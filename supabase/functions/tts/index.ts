// POST /functions/v1/tts — pronunciation audio. Contract: _shared/tts-contract.ts;
// design: docs/decisions/0028-server-tts.md.
import { createTtsFromEnv, type SpeechSynth } from '../_shared/gemini-tts.ts';
import { createHandler, parseOrigins } from '../_shared/http.ts';
import { log } from '../_shared/setup.ts';
import { runTts, ttsDailyLimit } from '../_shared/tts.ts';
import { SupabaseTtsStore } from '../_shared/tts-store.ts';
import {
  createAdminClient,
  createAuthenticator,
  loadServerConfig,
} from '../_shared/supabase-store.ts';

const env = (k: string) => Deno.env.get(k);
const cfg = loadServerConfig(env);
const store = new SupabaseTtsStore(createAdminClient(cfg), cfg.url);
const logger = log('tts');
const dailyLimit = ttsDailyLimit(env);
let synth: SpeechSynth | null = null;

Deno.serve(
  createHandler({
    cors: { allowedOrigins: parseOrigins(env('ALLOWED_ORIGINS')) },
    authenticate: createAuthenticator(cfg),
    log: logger,
    run: (body, userId) =>
      runTts(body, {
        userId,
        store,
        synth: () => (synth ??= createTtsFromEnv(env)),
        dailyLimit,
        log: logger,
      }),
  }),
);
