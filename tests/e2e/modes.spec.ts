// v0.5 İP9 (ADR 0051): Dikte and the remembered answer modes of Üretim and Boşluk doldurma.
import type { Page } from '@playwright/test';
import { expect, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';

type Row = Record<string, unknown>;

/** Run `fn` on the app's IndexedDB (raw, like the other specs). */
async function withDb<T>(page: Page, fn: string, arg: unknown = null): Promise<T> {
  return page.evaluate(
    async ({ fn, arg }) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('engapp');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      type All = (store: IDBObjectStore) => Promise<Record<string, unknown>[]>;
      const all: All = (store) =>
        new Promise((res) => (store.getAll().onsuccess = (e) => res((e.target as IDBRequest).result)));
      const run = new Function('db', 'all', 'arg', `return (async () => { ${fn} })();`) as (
        db: IDBDatabase,
        all: All,
        arg: unknown,
      ) => Promise<unknown>;
      try {
        return (await run(db, all, arg)) as never;
      } finally {
        db.close();
      }
    },
    { fn, arg },
  ) as Promise<T>;
}

/**
 * Give one studied word (recognition card in Review, Pekişiyor or higher) a shared example
 * sentence, as the example queue would. Returns the word and its recognition card.
 */
async function giveSharedSentence(page: Page): Promise<{ term: string; senseId: string; rec: Row }> {
  return withDb(
    page,
    `
    const tx = db.transaction(['cards', 'notes', 'senses', 'lexicon_examples'], 'readwrite');
    const cards = await all(tx.objectStore('cards'));
    const notes = await all(tx.objectStore('notes'));
    const senses = await all(tx.objectStore('senses'));
    const rec = cards.find((c) => c.card_type === 'recognition' && c.state === 2 && c.ramp_step >= 1 && c.deleted_at === null
      && notes.find((n) => n.id === c.note_id && n.term_type === 'word' && /^[a-z]{5,}$/.test(n.term)));
    const note = notes.find((n) => n.id === rec.note_id);
    const sense = senses.find((s) => s.note_id === note.id && s.deleted_at === null);
    tx.objectStore('senses').put({ ...sense, lexicon_sense_id: 'lx-e2e' });
    const text = 'Everyone agreed that the ' + note.term + ' plan was fine.';
    const start = text.indexOf(note.term);
    tx.objectStore('lexicon_examples').put({
      id: 'ex-e2e', sense_id: 'lx-e2e', context: 'daily', level_band: 'B1', text_en: text,
      span: [start, start + note.term.length], translations: { tr: 'Herkes planın iyi olduğunda anlaştı.' },
      status: 'active', updated_at: 1,
    });
    await new Promise((r) => (tx.oncomplete = r));
    return { term: note.term, senseId: sense.id, rec };
  `,
  );
}

test('Dikte: a shared sentence with the blank, replay buttons, a kind check, stage unchanged', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await restoreSeed(page, 60);
  const { term, senseId, rec } = await giveSharedSentence(page);

  // The Çalış picker makes the dictation card (and lists Dikte as a fourth type).
  await page.goto('/study');
  await expect(page.getByTestId('study-mode-dictation')).toHaveAttribute('href', '/study?mode=dictation');
  await expect
    .poll(() =>
      withDb<number>(
        page,
        `const tx = db.transaction('cards'); return (await all(tx.objectStore('cards'))).filter((c) => c.card_type === 'dictation' && c.sense_id === arg).length;`,
        senseId,
      ),
    )
    .toBe(1);
  // It opened with the word (Pekişiyor); make it the one card of the session.
  const opened = await withDb<boolean>(
    page,
    `const tx = db.transaction('cards'); return (await all(tx.objectStore('cards'))).find((c) => c.card_type === 'dictation').unlocked;`,
  );
  expect(opened).toBe(true);

  await page.goto('/study?mode=dictation');
  await expect(page.locator('[data-card-type="dictation"]')).toBeVisible();
  await expect(page.getByTestId('dictation-sentence')).toContainText('Everyone agreed that the');
  await expect(page.getByTestId('dictation-sentence')).not.toContainText(term);
  await expect(page.getByRole('button', { name: 'Tekrar dinle' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yavaş dinle' })).toBeVisible();
  const input = page.getByTestId('answer-input');
  await expect(input).toHaveAttribute('autocapitalize', 'off');
  await expect(input).toHaveAttribute('autocorrect', 'off');

  // One letter left out of a word of five letters or more: "neredeyse", Zor suggested.
  await input.fill(term.slice(0, 2) + term.slice(3));
  await input.press('Enter');
  await expect(page.locator('[data-verdict="close"]')).toBeVisible();
  await expect(page.getByText(/Önerimiz:/)).toContainText('Zor');
  await page.locator('body').press('2');

  // The dictation answer moved its own card only: the word's recognition card is as it was.
  const after = await withDb<Row>(
    page,
    `const tx = db.transaction('cards'); return (await all(tx.objectStore('cards'))).find((c) => c.id === arg);`,
    rec.id,
  );
  expect(after).toEqual(rec);
  const dictation = await withDb<Row>(
    page,
    `const tx = db.transaction('cards'); return (await all(tx.objectStore('cards'))).find((c) => c.card_type === 'dictation');`,
  );
  expect(dictation.reps).toBe(1);
});

test('typed answers: Üretim can be answered without typing, Boşluk doldurma remembers typing', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await restoreSeed(page, 150);
  await withDb(
    page,
    `
    const tx = db.transaction('cards', 'readwrite');
    const store = tx.objectStore('cards');
    const cards = await all(store);
    for (const type of ['production', 'cloze']) {
      for (const c of cards.filter((x) => x.card_type === type && x.deleted_at === null && x.state === 2).slice(0, 2))
        store.put({ ...c, due: Date.now() - 60000, unlocked: true, suspended: false });
    }
    await new Promise((r) => (tx.oncomplete = r));
  `,
  );

  // Üretim: typed by default (the board); "aklımdan" shows the answer without a check.
  await page.goto('/study?mode=production');
  await expect(page.getByTestId('answer-input')).toBeVisible();
  await page.getByTestId('answer-mode-toggle').click();
  await expect(page.getByTestId('answer-input')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cevabı göster' }).click();
  await expect(page.getByTestId('right-answer')).toBeVisible();
  await expect(page.getByText(/Önerimiz:/)).toHaveCount(0);
  await page.locator('body').press('3');
  // Remembered on this device.
  await page.goto('/study?mode=production');
  await expect(page.getByRole('button', { name: 'Cevabı göster' })).toBeVisible();
  await page.getByTestId('answer-mode-toggle').click();
  await expect(page.getByTestId('answer-input')).toBeVisible();

  // Boşluk doldurma: choices by default; "Yazarak cevapla" is remembered.
  await page.goto('/study?mode=cloze');
  await expect(page.getByRole('group', { name: 'Seçenekler' })).toBeVisible();
  await page.getByRole('button', { name: 'Yazarak cevapla' }).click();
  await expect(page.getByTestId('answer-input')).toBeVisible();
  await page.goto('/study?mode=cloze');
  await expect(page.getByTestId('answer-input')).toBeVisible();
  await page.getByTestId('answer-input').fill('zzzz');
  await page.getByTestId('answer-input').press('Enter');
  await expect(page.locator('[data-verdict="wrong"]')).toBeVisible();
});
