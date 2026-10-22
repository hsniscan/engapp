import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiClientError } from '@/ai/client';
import { addNoteWithSenses, cardImageOf, db } from '@/data';
import { resetDb } from '@/test/db';
import { SAMPLE_PICTURES } from '@/test/imageSamples';
import { drawImage, type ImageRequestDeps } from './request';

const T = Date.UTC(2026, 9, 25, 9);
const LEX = '0199f0a0-0000-7000-8000-00000000a001';
const IMG = '0199f0a0-0000-7000-8000-0000000b0007';
const pass = (svg: string) => ({ ok: true as const, svg });

function deps(p: Partial<ImageRequestDeps> = {}): ImageRequestDeps {
  return {
    request: vi.fn(async () => ({
      ok: true as const,
      image: {
        id: IMG,
        sense_id: LEX,
        variant: 3,
        svg: SAMPLE_PICTURES.umbrella.svg,
        alt_tr: 'Mavi bir şemsiye',
        status: 'review' as const,
        created_at: '2026-10-25T09:00:00Z',
      },
    })),
    isOnline: () => true,
    isSignedIn: async () => true,
    now: () => T,
    sanitize: pass,
    ...p,
  };
}

let senseId = '';
beforeEach(async () => {
  await resetDb();
  const res = await addNoteWithSenses({ term: 'umbrella', senses: [{ meaning_tr: 'şemsiye', lexicon_sense_id: LEX }] }, T);
  senseId = (await db.senses.where('note_id').equals(res.note.id).toArray())[0]!.id;
});

describe('drawImage', () => {
  it('stores the new picture and makes it the choice of this sense', async () => {
    const d = deps();
    expect(await drawImage({ senseId, lexiconSenseId: LEX }, d)).toEqual({ ok: true, imageId: IMG });
    expect(d.request).toHaveBeenCalledWith(LEX);
    const sense = (await db.senses.get(senseId))!;
    expect(await cardImageOf(sense)).toMatchObject({ id: IMG, isNew: true, alt: 'Mavi bir şemsiye' });
  });

  it('answers the four refusals of the server as they are', async () => {
    for (const reason of ['daily_limit', 'budget', 'not_visual', 'failed'] as const) {
      const d = deps({ request: async () => ({ ok: false as const, reason }) });
      expect(await drawImage({ senseId, lexiconSenseId: LEX }, d)).toEqual({ ok: false, error: reason });
    }
    expect(await db.images.count()).toBe(0);
  });

  it('knows before asking: no lexicon sense, signed out, offline', async () => {
    const d = deps();
    expect(await drawImage({ senseId, lexiconSenseId: null }, d)).toEqual({ ok: false, error: 'no_lexicon' });
    expect(await drawImage({ senseId, lexiconSenseId: LEX }, { ...d, isSignedIn: async () => false })).toEqual({ ok: false, error: 'signed_out' });
    expect(await drawImage({ senseId, lexiconSenseId: LEX }, { ...d, isOnline: () => false })).toEqual({ ok: false, error: 'offline' });
    expect(d.request).not.toHaveBeenCalled();
  });

  it('maps client errors and refuses a picture the sanitizer rejects', async () => {
    const limit = deps({ request: async () => Promise.reject(new AiClientError('daily_limit', 'x', 429)) });
    expect(await drawImage({ senseId, lexiconSenseId: LEX }, limit)).toEqual({ ok: false, error: 'daily_limit' });
    const down = deps({ request: async () => Promise.reject(new AiClientError('offline', 'x')) });
    expect(await drawImage({ senseId, lexiconSenseId: LEX }, down)).toEqual({ ok: false, error: 'offline' });
    const unsafe = deps({ sanitize: () => ({ ok: false, reason: 'href' }) });
    expect(await drawImage({ senseId, lexiconSenseId: LEX }, unsafe)).toEqual({ ok: false, error: 'failed' });
    expect(await db.images.count()).toBe(0);
  });
});
