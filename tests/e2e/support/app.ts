import { test as base, expect, type Page } from '@playwright/test';
import { FakeBackend } from './backend.ts';

export { expect };

interface Fixtures {
  /** Fake Supabase, installed on the context (guests never call it, but nothing leaks out). */
  backend: FakeBackend;
}

export const test = base.extend<Fixtures>({
  backend: async ({ context }, provide) => {
    const backend = new FakeBackend();
    await backend.install(context);
    await provide(backend);
  },
});

export interface Word {
  term: string;
  meaning: string;
  sentence?: string;
}

/** Adds a note through the "Elle" form on /add and waits for the confirmation toast. */
export async function addWord(page: Page, w: Word): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith('/add')) await page.goto('/add');
  const term = page.getByLabel('İngilizce kelime ya da kalıp');
  await term.fill(w.term);
  await page.getByLabel('Türkçe anlamı').first().fill(w.meaning);
  if (w.sentence) await page.getByLabel('Örnek cümle').first().fill(w.sentence);
  // Enter submits, as a keyboard user does (a click would land on the previous toast).
  await page.getByLabel('Türkçe anlamı').first().press('Enter');
  await expect(page.getByText(`“${w.term}” eklendi`, { exact: true })).toBeVisible();
  await expect(term).toHaveValue('');
}

export const WORDS: Word[] = [
  {
    term: 'reluctant',
    meaning: 'isteksiz',
    sentence: 'The committee was reluctant to approve the budget.',
  },
  {
    term: 'give up',
    meaning: 'vazgeçmek',
    sentence: 'After years of trying, she finally gave up smoking.',
  },
  { term: 'thrive', meaning: 'gelişmek' },
];

/** Answers every card of the open review session with the keyboard (Space, then `rating`). */
export async function reviewAll(page: Page, rating: '1' | '2' | '3' | '4' = '3'): Promise<number> {
  let n = 0;
  const summary = page.getByRole('heading', { name: 'Oturum tamamlandı' });
  for (; n < 200; n++) {
    const showAnswer = page.getByRole('button', { name: 'Cevabı göster', disabled: false });
    await expect(showAnswer.or(summary)).toBeVisible();
    if (await summary.isVisible()) break;
    await page.locator('body').press('Space');
    await expect(page.getByRole('group', { name: 'Ne kadar iyi hatırladın?' })).toBeVisible();
    await page.locator('body').press(rating);
  }
  return n;
}

/** Rows of the given Dexie tables, sorted by primary key (raw IndexedDB, no app code needed). */
export async function dumpTables(page: Page, tables: string[]): Promise<Record<string, unknown[]>> {
  return page.evaluate(async (names) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('engapp');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const out: Record<string, unknown[]> = {};
    for (const name of names) {
      const tx = db.transaction(name, 'readonly');
      const req = tx.objectStore(name).getAll();
      out[name] = await new Promise<unknown[]>((res) => (req.onsuccess = () => res(req.result)));
    }
    db.close();
    return out;
  }, tables);
}
