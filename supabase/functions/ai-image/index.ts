// POST /functions/v1/ai-image — draw one picture now. Contract: aiImageRequest /
// aiImageResponse in _shared/image-contract.ts; design: docs/decisions/0030-image-pipeline.md.
import { claudeCall, createAnthropic } from '../_shared/image-claude.ts';
import { imageDailyLimit, runAiImage } from '../_shared/image-instant.ts';
import { imageModels, monthlyCapUsd } from '../_shared/image-models.ts';
import type { ClaudeCall } from '../_shared/image-pipeline.ts';
import { SupabaseImageStore } from '../_shared/image-store.ts';
import { createHandler, parseOrigins } from '../_shared/http.ts';
import { log } from '../_shared/setup.ts';
import {
  createAdminClient,
  createAuthenticator,
  loadServerConfig,
} from '../_shared/supabase-store.ts';

const env = (k: string) => Deno.env.get(k);
const cfg = loadServerConfig(env);
const store = new SupabaseImageStore(createAdminClient(cfg));
const logger = log('ai-image');
const models = imageModels(env);
const capUsd = monthlyCapUsd(env);
const dailyLimit = imageDailyLimit(env);
let claude: ClaudeCall | null = null;

Deno.serve(
  createHandler({
    cors: { allowedOrigins: parseOrigins(env('ALLOWED_ORIGINS')) },
    authenticate: createAuthenticator(cfg),
    log: logger,
    run: (body, userId) =>
      runAiImage(body, {
        userId,
        store,
        // Created on first use: a missing ANTHROPIC_API_KEY fails the request, not the boot.
        claude: () => (claude ??= claudeCall(createAnthropic(env, { timeoutMs: 110_000 }))),
        models,
        capUsd,
        dailyLimit,
        log: logger,
      }),
  }),
);
