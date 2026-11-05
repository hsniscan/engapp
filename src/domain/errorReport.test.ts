import { describe, expect, it } from 'vitest';
import { fingerprint, scrub, scrubContext, scrubStack, toReportRows } from './errorReport';

describe('error report scrubbing (decision 0076)', () => {
  it('removes URLs, e-mail addresses, quoted text, ids and long numbers', () => {
    const s = scrub(
      'Failed "my private sentence" for ali@example.com at https://site.example/a?q=secret ' +
        "with 'hello there' id 0197a5b2-1c3d-7e4f-8a9b-0c1d2e3f4a5b and 1234567 but 42 ok “x” «y»",
    );
    expect(s).not.toMatch(/private|ali@|site\.example|secret|hello there|0197a5b2|1234567/);
    expect(s).toContain('<email>');
    expect(s).toContain('<url>');
    expect(s).toContain('<id>');
    expect(s).toContain('<n>');
    expect(s).toContain('42 ok');
  });

  it('keeps the script file and line:column of a stack frame, not the origin', () => {
    const stack = [
      'TypeError: x is undefined',
      '    at answerCard (https://engapp-65y.pages.dev/assets/index-AbC123.js:12:34567)',
      '    at async run (https://engapp-65y.pages.dev/assets/db-XyZ.js?v=1:3:9)',
      'foo@https://engapp-65y.pages.dev/assets/react-1.js:1:2',
      '    at a (x.js:1:1)',
      '    at b (x.js:1:1)',
    ].join('\n');
    const out = scrubStack(stack)!;
    expect(out).toContain('at answerCard (index-AbC123.js:12:34567)');
    expect(out).toContain('db-XyZ.js:3:9');
    expect(out).not.toContain('pages.dev');
    expect(out.split(' | ')).toHaveLength(4);
    expect(scrubStack(null)).toBeNull();
  });

  it('keeps the code label of the context and drops row ids', () => {
    expect(scrubContext('sync.push rejected notes/0197a5b2c3d4')).toBe('sync.push rejected notes/<id>');
    expect(scrubContext(null)).toBeNull();
    expect(scrubContext('x'.repeat(500))!.length).toBe(120);
  });

  it('gives one bug one fingerprint, whatever its numbers', () => {
    expect(fingerprint('3 invalid rows', 'sync.examples')).toBe(fingerprint('17 invalid rows', 'sync.examples'));
    expect(fingerprint('3 invalid rows', 'sync.examples')).not.toBe(fingerprint('3 invalid rows', 'sync.pull'));
    expect(fingerprint('a', null)).toMatch(/^[0-9a-z]{1,16}$/);
  });

  it('builds one capped row per fingerprint', () => {
    const rows = toReportRows(
      [
        { id: 1, at: Date.UTC(2026, 10, 6), message: 'Boom 1', stack: null, context: 'sync.run' },
        { id: 2, at: Date.UTC(2026, 10, 6), message: 'Boom 2', stack: null, context: 'sync.run' },
        { id: 3, at: Date.UTC(2026, 10, 6), message: 'x'.repeat(1000), stack: null, context: null },
        { id: 4, at: Date.UTC(2026, 10, 6), message: '   ', stack: null, context: null },
      ],
      '0.5.3',
      'pwa',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ message: 'Boom 1', context: 'sync.run', app_version: '0.5.3', platform: 'pwa' });
    expect(rows[0]!.occurred_at).toBe('2026-11-06T00:00:00.000Z');
    expect(rows[1]!.message).toHaveLength(300);
    expect(toReportRows([{ at: 0, message: 'a', stack: null, context: null }], 'bad version!', 'web')[0]!.app_version).toBeNull();
  });
});
