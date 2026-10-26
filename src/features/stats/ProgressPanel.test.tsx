import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, answerCard, db, updateSettings } from '@/data';
import { setLevelDataForTests } from '@/data/levelData';
import { parseClientLevels } from '@/domain/level';
import { Rating, type RatingValue } from '@/domain/types';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { ProgressPanel } from './ProgressPanel';

const DAY = 86_400_000;
const MIN = 60_000;

beforeEach(async () => {
  await resetDb();
  setLevelDataForTests(parseClientLevels(''));
});

async function seed(now: number) {
  await updateSettings({ timezone: 'Europe/Istanbul' }, now - 60 * DAY);
  const r = await addNoteWithSenses(
    { term: 'apple', senses: [{ meaning_tr: 'elma', pos: 'noun' }] },
    now - 40 * DAY,
  );
  const cards = await db.cards.where('note_id').equals(r.note.id).toArray();
  const rec = cards.find((c) => c.card_type === 'recognition')!;
  const prod = cards.find((c) => c.card_type === 'production')!;
  const answer = (id: string, rating: RatingValue, at: number) =>
    answerCard({ card_id: id, rating, duration_ms: 3000 }, at);
  await answer(rec.id, Rating.Easy, now - 30 * DAY);
  await answer(prod.id, Rating.Easy, now - 30 * DAY + MIN);
  for (const d of [25, 20, 15]) await answer(rec.id, Rating.Good, now - d * DAY);
  for (const [d, ok] of [
    [25, false],
    [20, false],
    [15, true],
  ] as const) {
    await answer(prod.id, ok ? Rating.Good : Rating.Again, now - d * DAY);
    if (!ok) await answer(prod.id, Rating.Good, now - d * DAY + 10 * MIN);
  }
  // pear reaches Öğrenildi (ADR 0041): recalled 15 days after its first day proves ramp 3.
  const p = await addNoteWithSenses({ term: 'pear', senses: [{ meaning_tr: 'armut', pos: 'noun' }] }, now - 41 * DAY);
  const pear = (await db.cards.where('note_id').equals(p.note.id).toArray()).find((c) => c.card_type === 'recognition')!;
  await answer(pear.id, Rating.Good, now - 40 * DAY);
  await answer(pear.id, Rating.Good, now - 40 * DAY + 12 * MIN);
  await answer(pear.id, Rating.Good, now - 25 * DAY);
}

describe('progress panel', () => {
  it('shows the empty state without counted answers', async () => {
    renderRoute(<ProgressPanel />);
    expect(await screen.findByText(/Henüz sayılacak tekrar yok/)).toBeInTheDocument();
  });

  it('shows both directions, the gap practice link and "veri az" groups', async () => {
    await seed(Date.now());
    renderRoute(<ProgressPanel />);
    const gap = await screen.findByRole('region', { name: 'Tanıma ve üretme' });
    expect(within(gap).getByText('İngilizceden Türkçeye')).toBeInTheDocument();
    expect(within(gap).getByText(/iki yönde de en az 20 cevap/)).toBeInTheDocument();
    const link = within(gap).getByRole('link', {
      name: 'Farkın en büyük olduğu 1 kelimeyle pratik yap',
    });
    expect(link.getAttribute('href')).toMatch(/^\/practice\?source=list&size=10&notes=/);
    expect(within(gap).getByText('apple')).toHaveAttribute('lang', 'en');

    const groups = screen.getByRole('region', { name: 'Kategorilere göre tutma oranı' });
    expect(
      within(groups).getByRole('listitem', { name: 'Kelime: veri az, 7 cevap.' }),
    ).toBeInTheDocument();
    expect(within(groups).getByText(/En zayıf noktanı göstermek için/)).toBeInTheDocument();

    const series = screen.getByRole('region', { name: 'Son 12 hafta' });
    expect(
      within(series).getByRole('img', { name: /öğrenilen kelime sayısı/ }),
    ).toBeInTheDocument();
    // The same "learned now" number as Genel and Profil (word stages).
    expect(within(series).getByText(/^Şu an öğrenilmiş: \d+ kelime$/)).toBeInTheDocument();
  });
});
