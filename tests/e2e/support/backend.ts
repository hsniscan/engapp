/**
 * In-process fake of the Supabase backend for Playwright (no network in CI or here).
 *
 *  - Auth: a signed-in session is injected into localStorage under supabase-js' storage key
 *    (`signIn()`); /auth/v1/* answers for that user. Google OAuth itself is not exercised.
 *  - Sync: /rest/v1/rpc/sync_push|sync_pull|sync_pull_v3|lexicon_pull|lexicon_get keep rows in
 *    memory with a server sequence, last-writer-wins on `hlc` and append-only review_logs and
 *    practice_logs (the contract of docs/sync-strategy.md, simplified to one user). sync_pull_v2
 *    is not mocked: the client falls back from v3 to sync_pull exactly as against an old
 *    backend.
 *  - AI: /functions/v1/ai-extract runs the REAL server pipeline (`runExtract` from
 *    supabase/functions/_shared/extract.ts: chunk cache, lexicon pre-match, validation, lexicon
 *    insert-or-get) on the in-memory store, with a scripted "model" that answers from the
 *    fake corpus in src/features/import/testing/fakeSpecs.ts. So the client sees exactly what
 *    the deployed function would send, and the test can count model calls.
 *
 * Service workers are blocked in these tests (playwright.config.ts): routes then see every
 * request the page makes. The PWA test enables the worker and needs no backend.
 */
import type { BrowserContext, Route } from '@playwright/test';
import { runExtract } from '../../../supabase/functions/_shared/extract.ts';
import { runEnrich } from '../../../supabase/functions/_shared/enrich.ts';
import { ApiError } from '../../../supabase/functions/_shared/errors.ts';
import { runThemes, THEMES_SYSTEM_PROMPT } from '../../../supabase/functions/_shared/themes.ts';
import type { AiProvider } from '../../../supabase/functions/_shared/ai-provider.ts';
import { MemoryAiStore } from '../../../supabase/functions/_shared/testing/memory-store.ts';
import { FAKE_SPECS } from '../../../src/features/import/testing/fakeSpecs.ts';

export const SUPABASE_URL = 'https://bikcjlomrjaxymifxogi.supabase.co';
const STORAGE_KEY = 'sb-bikcjlomrjaxymifxogi-auth-token';

export const TEST_USER = {
  id: '0199f0a0-0000-7000-8000-00000000e2e1',
  email: 'hasan@example.com',
  name: 'Hasan Test',
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': '*',
};

type Row = Record<string, unknown> & { id: string };
interface Stored {
  table: string;
  seq: number;
  row: Row;
}

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

export function fakeSession() {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 365 * 24 * 3600;
  const access_token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: TEST_USER.id,
    role: 'authenticated',
    aud: 'authenticated',
    email: TEST_USER.email,
    exp,
    iat: now,
    is_anonymous: false,
  })}.e2e-signature`;
  const user = {
    id: TEST_USER.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: TEST_USER.email,
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: {
      full_name: TEST_USER.name,
      avatar_url: 'https://lh3.googleusercontent.com/a/e2e-avatar',
    },
    identities: [],
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    is_anonymous: false,
  };
  return {
    access_token,
    refresh_token: 'e2e-refresh-token',
    token_type: 'bearer',
    expires_in: exp - now,
    expires_at: exp,
    user,
  };
}

/** Scripted model: answers with every corpus sentence that occurs in the chunk. */
function fakeModel(counter: { calls: number }): AiProvider {
  return {
    name: 'fake',
    async generateJson(req) {
      counter.calls++;
      const text = req.user.slice(req.user.indexOf('<<<') + 3, req.user.lastIndexOf('>>>'));
      const known = new Map<string, string>(); // "lemma|gloss" -> ref
      for (const line of req.user.split('\n')) {
        const m = /^(s\d+) \| (.+?) \| (.+?) \| (.+)$/.exec(line);
        if (m) known.set(`${m[2]!.toLowerCase()}|${m[4]!.toLowerCase()}`, m[1]!);
      }
      const candidates = FAKE_SPECS.filter((s) => text.includes(s.sentence)).map((s) => {
        const ref = known.get(`${s.term.toLowerCase()}|${s.gloss.toLowerCase()}`) ?? null;
        return {
          term: s.term,
          surface: s.surface,
          term_type: s.type,
          source_sentence: s.sentence,
          confidence: s.conf ?? 0.95,
          known_sense: ref,
          pos: ref ? null : s.pos,
          gloss_en: ref ? null : s.gloss,
          meaning_tr: ref ? null : s.tr,
          ipa: ref ? null : s.ipa,
        };
      });
      return {
        data: { candidates },
        model: 'fake-model',
        attempts: 1,
        usage: { input_tokens: 1000, output_tokens: 300, thinking_tokens: 0 },
      };
    },
  };
}

/** public.sync_tables as after migration 20261022000400_decks.sql. */
const SYNC_TABLES = ['notes', 'senses', 'cards', 'review_logs', 'sources', 'settings', 'practice_logs', 'decks'];

/**
 * Scripted ai-themes model: puts each "<ref> | <term> | …" line into the first theme whose
 * keyword list contains the term (THEME_KEYWORDS); other words are left out.
 */
export const THEME_KEYWORDS: Record<string, string[]> = {
  'Para ve bankacılık': ['loan', 'interest', 'mortgage', 'savings', 'debt'],
  Duygular: ['anxious', 'grateful', 'furious', 'relieved', 'jealous'],
  Yolculuk: ['ticket', 'luggage', 'boarding', 'departure'],
};

function fakeThemesModel(counter: { calls: number }): AiProvider {
  return {
    name: 'fake',
    async generateJson(req) {
      counter.calls++;
      if (req.system !== THEMES_SYSTEM_PROMPT) throw new Error('unexpected prompt');
      const groups = Object.entries(THEME_KEYWORDS).map(([name_tr, words]) => ({
        name_tr,
        refs: req.user
          .split('\n')
          .map((l) => /^(w\d+) \| (.+?) \| /.exec(l))
          .filter((m): m is RegExpExecArray => !!m && words.includes(m[2]!))
          .map((m) => m[1]!),
      }));
      return { data: { groups }, model: 'fake-model', attempts: 1, usage: null };
    },
  };
}

export interface BackendOptions {
  /** Artificial latency of ai-extract (ms). */
  extractDelayMs?: number;
}

export class FakeBackend {
  readonly rows = new Map<string, Stored>(); // `${table}:${id}`
  private seq = 0;
  readonly store = new MemoryAiStore();
  readonly model = { calls: 0 };
  /** Every RPC / function call, in order: { name, body }. */
  readonly calls: { name: string; body: unknown; at: number }[] = [];
  /** When true every backend request fails like a dropped connection. */
  offline = false;
  /** RPC names that answer like a backend that is not deployed (PostgREST 404). */
  readonly brokenRpcs = new Set<string>();
  private readonly opts: BackendOptions;
  constructor(opts: BackendOptions = {}) {
    this.opts = opts;
  }

  count(name: string): number {
    return this.calls.filter((c) => c.name === name).length;
  }

  /** review_logs ids the server has received through sync_push. */
  pushedIds(table: string): string[] {
    return [...this.rows.values()].filter((r) => r.table === table).map((r) => r.row.id);
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route(`${SUPABASE_URL}/**`, (route) => this.handle(route));
    // Google avatars: a 1x1 png, never the network.
    await context.route('https://lh3.googleusercontent.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPhfDwAEhgHUq7wJ0wAAAABJRU5ErkJggg==',
          'base64',
        ),
      }),
    );
  }

  /** Puts a signed-in session where supabase-js looks for it (before any page script runs). */
  static async signIn(context: BrowserContext): Promise<void> {
    await context.addInitScript(
      ([key, value]) => {
        // Once per browser profile: a later sign-out must survive reloads.
        if (localStorage.getItem('e2e.signedIn')) return;
        localStorage.setItem('e2e.signedIn', '1');
        localStorage.setItem(key, value);
      },
      [STORAGE_KEY, JSON.stringify(fakeSession())] as const,
    );
  }

  private json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers: { ...CORS, ...headers },
      body: JSON.stringify(body),
    });
  }

  private async handle(route: Route): Promise<void> {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (this.offline) return route.abort('internetdisconnected');
    const path = new URL(req.url()).pathname;
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData();
    }
    const name = path.replace(/^\/(rest\/v1\/rpc|functions\/v1|auth\/v1)\//, '');
    this.calls.push({ name, body, at: Date.now() });

    if (path.startsWith('/auth/v1/')) {
      if (name === 'user') return this.json(route, 200, fakeSession().user);
      if (name.startsWith('token')) return this.json(route, 200, fakeSession());
      if (name.startsWith('logout')) return route.fulfill({ status: 204, headers: CORS });
      return this.json(route, 404, { msg: 'not found' });
    }
    if (path.startsWith('/rest/v1/rpc/'))
      return this.rpc(route, name, body as Record<string, unknown>);
    if (path === '/rest/v1/sync_tables') return this.json(route, 200, SYNC_TABLES.map((n) => ({ name: n })));
    if (path === '/functions/v1/ai-themes') return this.themes(route, body);
    if (path === '/functions/v1/ai-extract' || path === '/functions/v1/ai-enrich') {
      if (this.opts.extractDelayMs)
        await new Promise((r) => setTimeout(r, this.opts.extractDelayMs));
      const deps = {
        userId: TEST_USER.id,
        store: this.store,
        provider: () => fakeModel(this.model),
        dailyLimit: 200,
      };
      try {
        const res =
          name === 'ai-extract' ? await runExtract(body, deps) : await runEnrich(body, deps);
        return this.json(route, 200, res);
      } catch (e) {
        if (e instanceof ApiError) {
          return this.json(route, e.status, {
            error: { code: e.code, message: e.message, retry_after_s: e.retryAfterS },
          });
        }
        return this.json(route, 500, { error: { code: 'internal', message: String(e) } });
      }
    }
    return this.json(route, 404, { message: `unmocked ${path}` });
  }

  /** ai-themes through the REAL runThemes, with a scripted model that groups by keyword. */
  private async themes(route: Route, body: unknown) {
    const deps = {
      userId: TEST_USER.id,
      store: this.store,
      provider: () => fakeThemesModel(this.model),
      dailyLimit: 200,
    };
    try {
      return this.json(route, 200, await runThemes(body, deps));
    } catch (e) {
      if (e instanceof ApiError)
        return this.json(route, e.status, { error: { code: e.code, message: e.message } });
      return this.json(route, 500, { error: { code: 'internal', message: String(e) } });
    }
  }

  private rpc(route: Route, fn: string, args: Record<string, unknown>) {
    if (this.brokenRpcs.has(fn)) {
      return this.json(route, 404, {
        code: 'PGRST202',
        details: null,
        hint: null,
        message: `Could not find the function public.${fn} in the schema cache`,
      });
    }
    switch (fn) {
      case 'sync_push': {
        const batch = (args.p_batch ?? []) as { table: string; op: string; payload: Row }[];
        const acked: string[] = [];
        const stale: string[] = [];
        for (const item of batch) {
          const key = `${item.table}:${item.payload.id}`;
          const cur = this.rows.get(key);
          const row: Row = { ...item.payload, user_id: TEST_USER.id };
          acked.push(item.payload.id);
          if (item.table === 'review_logs' || item.table === 'practice_logs') {
            if (!cur) this.rows.set(key, { table: item.table, seq: ++this.seq, row });
            continue;
          }
          const newer = !cur || String(row.hlc ?? '') > String(cur.row.hlc ?? '');
          if (newer) this.rows.set(key, { table: item.table, seq: ++this.seq, row });
          else stale.push(item.payload.id);
        }
        return this.json(route, 200, { acked, stale, rejected: [] });
      }
      case 'sync_pull':
      case 'sync_pull_v3': {
        const since = Number(args.p_since ?? 0);
        const limit = Number(args.p_limit ?? 500);
        const all = [...this.rows.values()]
          .filter((r) => r.seq > since)
          .sort((a, b) => a.seq - b.seq);
        const page = all.slice(0, limit);
        return this.json(route, 200, {
          rows: page.map((r) => ({ table: r.table, seq: r.seq, row: r.row })),
          next_seq: page.length ? page[page.length - 1]!.seq : since,
          has_more: all.length > limit,
          full_resync: false,
        });
      }
      case 'lexicon_pull':
        return this.json(route, 200, {
          rows: [],
          next_seq: Number(args.p_since ?? 0),
          has_more: false,
        });
      case 'lexicon_get':
        return this.store
          .getEntries((args.p_ids ?? []) as string[])
          .then((rows) => this.json(route, 200, rows));
      default:
        return this.json(route, 404, { code: 'PGRST202', message: `unknown rpc ${fn}` });
    }
  }
}
