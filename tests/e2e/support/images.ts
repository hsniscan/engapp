/**
 * v0.4 picture fixtures for the e2e tests: the six style-B sample pictures as lexicon_images
 * rows, and a small backup whose senses point at those lexicon senses (so the app fetches and
 * shows them). No AI call anywhere.
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { buildBackup } from '../../../src/domain/backup.ts';
import { emptyFsrs } from '../../../src/domain/fsrs.ts';
import { encodeHlc } from '../../../src/domain/hlc.ts';
import type { Card, Note, Sense } from '../../../src/domain/types.ts';
import { SAMPLE_PICTURES } from '../../../src/test/imageSamples.ts';
import type { LexiconImageRow } from '../../../supabase/functions/_shared/image-contract.ts';
import { buildSeedBackup } from './seed.ts';

export type SampleName = keyof typeof SAMPLE_PICTURES;
export const SAMPLE_NAMES = Object.keys(SAMPLE_PICTURES) as SampleName[];

const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');
/** Lexicon sense id of sample `i` (a UUID, as the contract wants). */
export const lexSenseId = (i: number) => `0199f0a0-0000-7000-8000-${hex(0xa000 + i, 12)}`;
/** lexicon_images id of sample `i`, variant `v`. */
export const imageId = (i: number, v = 0) => `0199f0a0-0000-7000-8000-${hex(0xb00000 + i * 16 + v, 12)}`;

export const ALT: Record<SampleName, string> = {
  apple: 'Kırmızı bir elma',
  bridge: 'Nehrin üstünde taş bir köprü',
  climb: 'Dağa tırmanan biri',
  angry: 'Kaşları çatık, kızgın bir yüz',
  between: 'İki kutunun arasında bir top',
  umbrella: 'Yağmurda açık mavi bir şemsiye',
};

/** Term shown on the card for each sample ("to climb" → the note is "climb"). */
export const term = (name: SampleName) => SAMPLE_PICTURES[name].lemma.replace(/^to /, '');

export function pictureRow(name: SampleName, p: Partial<LexiconImageRow> = {}): LexiconImageRow {
  const i = SAMPLE_NAMES.indexOf(name);
  return {
    id: imageId(i, p.variant ?? 0),
    sense_id: lexSenseId(i),
    variant: 0,
    svg: SAMPLE_PICTURES[name].svg,
    alt_tr: ALT[name],
    status: 'approved',
    created_at: '2026-10-20T01:30:00Z',
    ...p,
  };
}

/** One note per sample (recognition card new; production and cloze locked behind it). */
export async function pictureBackup(names: readonly SampleName[] = SAMPLE_NAMES, now = Date.now()) {
  const created = now - 86_400_000;
  const hlc = (t: number) => encodeHlc({ ms: t, counter: 0, node: 'seed' });
  const base = (id: string) => ({ id, user_id: null, created_at: created, updated_at: created, deleted_at: null, hlc: hlc(created) });
  const notes: Note[] = [];
  const senses: Sense[] = [];
  const cards: Card[] = [];
  for (const name of names) {
    const i = SAMPLE_NAMES.indexOf(name);
    const s = SAMPLE_PICTURES[name];
    const t = term(name);
    const sentence = `People often talk about the word ${t} at school.`;
    const at = sentence.indexOf(t);
    notes.push({ ...base(`n-${name}`), term: t, term_norm: t, term_type: 'word', lexicon_term_id: null, ipa: null, tags: [], possible_duplicate: false, level_override: null });
    senses.push({
      ...base(`s-${name}`),
      note_id: `n-${name}`,
      sense_no: 1,
      lexicon_sense_id: lexSenseId(i),
      pos: s.pos,
      gloss_en: null,
      meaning_tr: s.gloss_tr,
      meaning_tr_override: null,
      source_sentence: sentence,
      source_sentence_tr: null,
      span: [at, at + t.length],
      source_id: null,
    });
    for (const type of ['recognition', 'production', 'cloze'] as const)
      cards.push({
        ...base(`c-${name}-${type[0]}`),
        note_id: `n-${name}`,
        sense_id: type === 'recognition' ? null : `s-${name}`,
        card_type: type,
        suspended: false,
        unlocked: type === 'recognition',
        ...emptyFsrs(created),
      });
  }
  const settings = { ...(await buildSeedBackup(3, now)).tables.settings[0]!, daily_new_limit: 20 };
  return buildBackup(
    { notes, senses, cards, review_logs: [], sources: [], settings: [settings] },
    { exported_at: now, device_id: 'seed' },
  );
}

/** Restore a backup file through Ayarlar → Veri → Geri yükle. */
export async function restoreFile(page: Page, file: unknown, name = 'pictures.json') {
  const buffer = Buffer.from(JSON.stringify(file));
  await page.goto('/settings#veri');
  await expect(page.getByRole('button', { name: 'Geri yükle' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Geri yükle' }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer });
  await page.getByRole('dialog', { name: 'Yedeği geri yükle' }).getByRole('button', { name: 'Üzerine yaz' }).click();
  await expect(page.getByText('Geri yükleme tamamlandı', { exact: true })).toBeVisible({ timeout: 60_000 });
}

/** Ids in the local picture cache (raw IndexedDB). */
export function cachedImageIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('engapp');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('images', 'readonly');
    const req = tx.objectStore('images').getAllKeys();
    const keys = await new Promise<IDBValidKey[]>((res) => (req.onsuccess = () => res(req.result)));
    db.close();
    return keys.map(String).sort();
  });
}
