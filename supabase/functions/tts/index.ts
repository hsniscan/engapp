// POST /functions/v1/tts — pronunciation audio. Contract: _shared/tts-contract.ts;
// design: docs/decisions/0028-server-tts.md.
import { createTtsFromEnv, type SpeechSynth } from '../_shared/gemini-tts.ts';
import { createHandler, parseOrigins } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import { R2Client, r2ConfigFromEnv } from '../_shared/r2.ts';
import { parseAudioBaseUrl } from '../_shared/tts-contract.ts';
import { runTts, ttsDailyLimit, type TtsStore } from '../_shared/tts.ts';
import { withR2Audio } from '../_shared/tts-r2.ts';
import { SupabaseTtsStore } from '../_shared/tts-store.ts';
import {
  createAdminClient,
  createAuthenticator,
  loadServerConfig,
} from '../_shared/supabase-store.ts';

const env = (k: string) => Deno.env.get(k);
const cfg = loadServerConfig(env);
const logger = log('tts');
// Audio on Cloudflare R2 when its four credentials and the public AUDIO_BASE_URL are set
// (decision 0053); otherwise Supabase Storage only, exactly as before.
const supabaseStore = new SupabaseTtsStore(createAdminClient(cfg), cfg.url);
const r2 = r2ConfigFromEnv(env);
const audioBase = parseAudioBaseUrl(env('AUDIO_BASE_URL'));
if (r2 && !audioBase) logger('tts r2 off', { reason: 'AUDIO_BASE_URL is not set' });
const store: TtsStore =
  r2 && audioBase ? withR2Audio(supabaseStore, new R2Client(r2), audioBase, logger) : supabaseStore;
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
