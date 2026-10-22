import { describe, expect, it } from 'vitest';
import { REPORT_REQUEST } from '../../supabase/functions/_shared/testing/report-fixtures';
import { requestReportComment } from './report';

const config = { url: 'https://ref.supabase.co', key: 'sb_publishable_test' };
const token = async () => 'jwt';

function answering(comment: string, seen: { body?: unknown; url?: string } = {}) {
  return (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.body = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        prompt_version: 'report-v1',
        model: 'm',
        comment,
        counts: { sentences: 3, dropped: {} },
        usage: { used: 1, limit: 200 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

describe('requestReportComment', () => {
  it('sends only the summary and checks the numbers again', async () => {
    const seen: { body?: unknown; url?: string } = {};
    const res = await requestReportComment(REPORT_REQUEST, {
      config,
      getAccessToken: token,
      fetch: answering(
        'Bu hafta 5 gün çalıştın. Toplam 99 tekrar eder. C1 kelimeleri biraz zorluyor. Kısa bir pratik iyi gelir.',
        seen,
      ),
    });
    expect(seen.url).toBe('https://ref.supabase.co/functions/v1/ai-report');
    expect(seen.body).toEqual(REPORT_REQUEST);
    // the sentence with a number the app did not compute is dropped on the device as well
    expect(res.comment).toBe(
      'Bu hafta 5 gün çalıştın. C1 kelimeleri biraz zorluyor. Kısa bir pratik iyi gelir.',
    );
  });

  it('a comment that is mostly wrong numbers is refused', async () => {
    await expect(
      requestReportComment(REPORT_REQUEST, {
        config,
        getAccessToken: token,
        fetch: answering('Toplam 99 tekrar. Ortalama 42 dakika. İyi gidiyorsun.'),
      }),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('guests get not_signed_in without a request', async () => {
    await expect(
      requestReportComment(REPORT_REQUEST, { config, getAccessToken: async () => null }),
    ).rejects.toMatchObject({ code: 'not_signed_in' });
  });
});
