import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { getText, saveText } from './texts';
import { MAX_TEXT_CHARS, readerPath } from '../domain/texts';

afterEach(async () => {
  await db.texts.clear();
});

describe('saveText', () => {
  it('stores a new text with an empty reading state and returns its id', async () => {
    const id = await saveText({ kind: 'paste', title: '  A walk  ', body: 'I went for a walk.' }, 1_000);
    const row = await getText(id);
    expect(row).toMatchObject({
      kind: 'paste',
      title: 'A walk',
      body: 'I went for a walk.',
      source_url: null,
      graded_id: null,
      progress_offset: 0,
      read_ms: 0,
      finished_at: null,
      deleted_at: null,
      created_at: 1_000,
    });
    expect(readerPath(id)).toBe(`/oku/${id}`);
  });

  it('cuts a text longer than the reader accepts', async () => {
    const id = await saveText({ kind: 'article', title: 't', body: 'a'.repeat(MAX_TEXT_CHARS + 10), source_url: 'https://example.com/a' });
    expect((await getText(id))?.body.length).toBe(MAX_TEXT_CHARS);
  });
});
