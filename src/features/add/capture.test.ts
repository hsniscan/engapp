// Every capture saves its text first; extraction links the job to it (decision 0056).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getImportJob } from '@/data';
import { deleteText } from '@/data/texts';
import { resetDb } from '@/test/db';
import { captureTitle, extractCapture, resetCaptureMemo, saveCapture } from './capture';

vi.mock('@/features/import/queue', () => ({ kickImportQueue: vi.fn() }));

const BODY = 'The committee postponed the decision.\n\nNobody was surprised by the delay.';

beforeEach(async () => {
  await resetDb();
  resetCaptureMemo();
});

describe('saveCapture', () => {
  it('saves once per text; again after the text was deleted', async () => {
    const input = { kind: 'paste' as const, title: '', body: BODY };
    const a = await saveCapture(input);
    expect(await saveCapture(input)).toBe(a);
    expect(await db.texts.count()).toBe(1);
    expect((await db.texts.get(a))!.title).toBe('The committee postponed the decision.');
    await deleteText(a);
    const b = await saveCapture(input);
    expect(b).not.toBe(a);
  });
});

describe('extractCapture', () => {
  it('saves the text, then queues one job linked to it', async () => {
    const input = {
      kind: 'pdf' as const,
      title: 'Rapor',
      body: BODY,
      sourceUrl: 'r.pdf',
      pageCount: 2,
    };
    const jobId = await extractCapture(input);
    const job = (await getImportJob(jobId))!;
    const text = (await db.texts.get(job.text_id!))!;
    expect(text).toMatchObject({ kind: 'pdf', title: 'Rapor', body: BODY, source_url: 'r.pdf' });
    expect(job).toMatchObject({ kind: 'pdf', title: 'Rapor' });
    expect(await db.sources.get(job.source_id)).toMatchObject({
      file_name: 'r.pdf',
      page_count: 2,
    });
    // A second tap opens the same job; "Okuyucuda aç" after it opens the same text.
    expect(await extractCapture(input)).toBe(jobId);
    expect(await saveCapture(input)).toBe(job.text_id);
    expect(await db.import_jobs.count()).toBe(1);
    expect(await db.texts.count()).toBe(1);
  });
});

describe('captureTitle', () => {
  it('first line, cut on a word', () => {
    expect(captureTitle('  \nShort line\nmore')).toBe('Short line');
    expect(captureTitle('one two three four five six', 12)).toBe('one two…');
    // The first sentence, when short, without its full stop.
    expect(
      captureTitle('Every morning I walk my dog in the park. One day I found a small bird.'),
    ).toBe('Every morning I walk my dog in the park');
    expect(captureTitle('Hi. It was a long and quiet morning by the sea')).toBe(
      'Hi. It was a long and quiet morning by the sea',
    );
  });
});
