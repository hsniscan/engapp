// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AiError, type AiProvider, type GenerateJsonRequest } from './ai-provider.ts';
import { ApiError } from './errors.ts';
import {
  allowedNumbers,
  keepMatchingSentences,
  numbersIn,
  REPORT_PROMPT_VERSION,
  reportResponse,
  splitSentences,
} from './report-contracts.ts';
import { buildReportUserPrompt } from './report-prompt.ts';
import { runReport, validateReportSentences } from './report.ts';
import { MemoryAiStore } from './testing/memory-store.ts';
import {
  REPORT_GOOD,
  REPORT_REQUEST,
  REPORT_TOO_FEW,
  REPORT_WRONG_NUMBERS,
} from './testing/report-fixtures.ts';

function scripted(...outputs: unknown[]) {
  const requests: GenerateJsonRequest[] = [];
  let i = 0;
  const provider: AiProvider = {
    name: 'fake',
    generateJson: vi.fn(async (req: GenerateJsonRequest) => {
      requests.push(req);
      const data = outputs[Math.min(i++, outputs.length - 1)];
      if (data instanceof Error) throw data;
      return { data, model: 'fake-model', attempts: 1, usage: null };
    }),
  };
  return { provider, requests };
}

const deps = (provider: AiProvider, store = new MemoryAiStore(), limit = 5) => ({
  userId: 'u1',
  store,
  provider: () => provider,
  dailyLimit: limit,
});

describe('numbers in a comment', () => {
  it('finds digits, percentages, thousands and Turkish number words (not "bir")', () => {
    expect(numbersIn('Bu hafta 5 gün, %85 ve 1.250 tekrar; 3,5 dakika.')).toEqual([
      5, 85, 1250, 3.5,
    ]);
    expect(numbersIn('Yedi günün beşinde bir kez daha yirmi kelime.')).toEqual([7, 5, 20]);
    expect(numbersIn('C1 ve B2 kelimeleri')).toEqual([]);
    expect(numbersIn("18'den fazla, beş gün")).toEqual([18, 5]);
  });

  it("may only be the request's own numbers", () => {
    const allowed = allowedNumbers(REPORT_REQUEST);
    expect([...allowed].sort((a, b) => a - b)).toEqual([5, 6, 12, 18, 64, 70, 85, 95, 212]);
    const text =
      'Bu hafta 5 gün çalıştın. Toplam 17 gün eder. Serin 12 gün oldu. Harika gidiyorsun.';
    expect(keepMatchingSentences(text, REPORT_REQUEST)).toBe(
      'Bu hafta 5 gün çalıştın. Serin 12 gün oldu. Harika gidiyorsun.',
    );
    expect(keepMatchingSentences('Toplam 17 gün eder. Harika.', REPORT_REQUEST)).toBeNull();
  });

  it('splits sentences on end marks followed by a capital', () => {
    expect(splitSentences('Bu hafta iyi geçti. C1 kelimeleri zor! Devam et… Sonra?')).toEqual([
      'Bu hafta iyi geçti.',
      'C1 kelimeleri zor!',
      'Devam et…',
      'Sonra?',
    ]);
  });
});

describe('runReport', () => {
  it('asks the model once with numbers and fixed names only, and returns 3–4 sentences', async () => {
    const store = new MemoryAiStore();
    const { provider, requests } = scripted(REPORT_GOOD);
    const res = await runReport(REPORT_REQUEST, deps(provider, store));
    expect(reportResponse.parse(res)).toEqual(res);
    expect(res).toMatchObject({
      prompt_version: REPORT_PROMPT_VERSION,
      model: 'fake-model',
      counts: { sentences: 4, dropped: {} },
      usage: { used: 1, limit: 5 },
    });
    expect(res.comment).toBe(REPORT_GOOD.sentences.join(' '));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.user).toBe(buildReportUserPrompt(REPORT_REQUEST));
    expect(requests[0]!.user).toContain('WEAKEST_CATEGORY: C1 seviyesindeki kelimeler — %70');
    expect(requests[0]!.user).toContain('STRONGEST_CATEGORY: seyahat konulu kelimeler — %95');
    expect(store.calls.filter((c) => c === 'consumeAi')).toHaveLength(1);
  });

  it('a source is never named, even when the model is asked about it', async () => {
    const { provider, requests } = scripted(REPORT_GOOD);
    await runReport(
      { ...REPORT_REQUEST, weakest: { dimension: 'source', key: null, rate_pct: 70 } },
      deps(provider),
    );
    expect(requests[0]!.user).toContain('WEAKEST_CATEGORY: kaynaklarından biri — %70');
  });

  it('drops sentences with numbers the app did not compute (the AI never makes a number)', async () => {
    const { provider } = scripted(REPORT_WRONG_NUMBERS);
    const res = await runReport(REPORT_REQUEST, deps(provider));
    expect(res.comment).toBe(
      'Bu hafta 5 gün çalıştın, serin de 12 güne ulaştı. C1 kelimeleriyle kısa bir pratik turu iyi gelir.',
    );
    expect(res.counts.dropped).toEqual({ numbers: 3, not_turkish: 1, bad_text: 2 });
    for (const n of numbersIn(res.comment))
      expect(allowedNumbers(REPORT_REQUEST).has(n)).toBe(true);
  });

  it('too few usable sentences: ai_failed (the device keeps the report without a comment)', async () => {
    const { provider } = scripted(REPORT_TOO_FEW);
    await expect(runReport(REPORT_REQUEST, deps(provider))).rejects.toMatchObject({
      code: 'ai_failed',
    });
  });

  it('rejects anything that is not a number or a fixed name, before any call', async () => {
    const { provider, requests } = scripted(REPORT_GOOD);
    const bad = [
      { ...REPORT_REQUEST, weakest: { dimension: 'pos', key: 'reluctant', rate_pct: 50 } },
      { ...REPORT_REQUEST, strongest: { dimension: 'source', key: 'My article', rate_pct: 90 } },
      { ...REPORT_REQUEST, focus: 'write a poem' },
      { ...REPORT_REQUEST, active_days: 8 },
      { ...REPORT_REQUEST, week: 'last week' },
    ];
    for (const body of bad)
      await expect(runReport(body, deps(provider))).rejects.toMatchObject({
        code: 'invalid_input',
      });
    expect(requests).toHaveLength(0);
  });

  it('respects the daily limit and passes provider errors on', async () => {
    const store = new MemoryAiStore();
    const { provider } = scripted(REPORT_GOOD);
    await runReport(REPORT_REQUEST, deps(provider, store, 1));
    await expect(runReport(REPORT_REQUEST, deps(provider, store, 1))).rejects.toMatchObject({
      code: 'daily_limit',
    });
    const failing = scripted(new AiError('quota_exceeded', 'busy', 30)).provider;
    const err = await runReport(REPORT_REQUEST, deps(failing)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'quota_exceeded', retryAfterS: 30 });
  });

  it('validateReportSentences keeps at most 4 and drops duplicates', () => {
    const s = 'Bu hafta güzel bir tempo yakaladın.';
    const out = validateReportSentences(
      [
        s,
        s,
        'Seyahat kelimelerinde çok iyisin.',
        'C1 kelimeleri biraz zorluyor.',
        'Kısa bir pratik iyi gelir.',
        'Böyle devam et, çok iyi gidiyorsun.',
      ],
      REPORT_REQUEST,
    );
    expect(out).toHaveLength(4);
    expect(new Set(out).size).toBe(4);
  });
});
