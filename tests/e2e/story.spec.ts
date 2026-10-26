// "Bugünün hikâyesi" (v0.5 İP8, decision 0050) at phone width: Bugün offers the story, the
// mocked ai-story writes it from the words it is sent, the reader shows the words in bold and
// the three questions, and Bugün opens the same story again without a second request. Only
// the allowed fields leave the device (the privacy snapshot of the request's keys).
import type { Page } from '@playwright/test';
import { buildBackup } from '../../src/domain/backup.ts';
import { applyRating, createScheduler, emptyFsrs } from '../../src/domain/fsrs.ts';
import { encodeHlc } from '../../src/domain/hlc.ts';
import type { Card, Note, ReviewLog, Sense } from '../../src/domain/types.ts';
import { FakeBackend, SUPABASE_URL } from './support/backend.ts';
import { expect, test } from './support/app.ts';
import { buildSeedBackup } from './support/seed.ts';

const WORDS = ['decide', 'journey', 'borrow', 'nervous', 'recipe', 'improve'];

/** Six words answered "İyi" once an hour ago: in their learning steps, due again now. */
async function storyBackup(now: number) {
  const scheduler = createScheduler({ request_retention: 0.9, fsrs_params: null });
  const created = now - 2 * 3_600_000;
  const t = now - 3_600_000;
  const hlc = (ms: number) => encodeHlc({ ms, counter: 0, node: 'seed' });
  const base = (id: string, ms = created) => ({ id, user_id: null, created_at: ms, updated_at: ms, deleted_at: null, hlc: hlc(ms) });
  const notes: Note[] = [];
  const senses: Sense[] = [];
  const cards: Card[] = [];
  const logs: ReviewLog[] = [];
  WORDS.forEach((w, i) => {
    notes.push({ ...base(`n-${w}`), term: w, term_norm: w, term_type: 'word', lexicon_term_id: null, ipa: null, tags: [], possible_duplicate: false, level_override: null });
    senses.push({ ...base(`s-${w}`), note_id: `n-${w}`, sense_no: 1, lexicon_sense_id: null, pos: null, gloss_en: null, meaning_tr: 'anlam', meaning_tr_override: null, source_sentence: null, source_sentence_tr: null, span: null, source_id: null });
    const f = applyRating(scheduler, { id: `c-${w}`, ...emptyFsrs(created) }, 3, t + i);
    cards.push({ ...base(`c-${w}`), ...f, updated_at: t + i, hlc: hlc(t + i), note_id: `n-${w}`, sense_id: null, card_type: 'recognition', suspended: false, unlocked: true });
    logs.push({ id: `log-${w}`, user_id: null, card_id: `c-${w}`, rating: 3, reviewed_at: t + i, duration_ms: 4000, device_id: 'seed', undo_of: null, shown_sense_id: null, created_at: t + i, hlc: hlc(t + i) });
  });
  const settings = (await buildSeedBackup(3, now)).tables.settings[0]!;
  return buildBackup({ notes, senses, cards, review_logs: logs, sources: [], settings: [settings] }, { exported_at: now, device_id: 'seed' });
}

async function restoreFile(page: Page, file: unknown) {
  const buffer = Buffer.from(JSON.stringify(file));
  await page.goto('/settings/veri');
  await expect(page.getByText('Henüz yedek alınmadı')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Geri yükle' }).click();
  await (await chooser).setFiles({ name: 'story.json', mimeType: 'application/json', buffer });
  await page.getByRole('dialog', { name: 'Yedeği geri yükle' }).getByRole('button', { name: 'Üzerine yaz' }).click();
  await expect(page.getByText('Geri yükleme tamamlandı', { exact: true })).toBeVisible({ timeout: 60_000 });
}

test.use({ viewport: { width: 360, height: 780 } });

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** A story-v1 answer built from the request's own target words (no live model). */
function storyFor(targets: string[]) {
  const sentences = targets.map((w, i) => `On day ${i + 1} the girl said the word ${w} to her friend in the park.`);
  const filler =
    'The weather was calm and the trees were green. They walked slowly and talked about school, food and family. Then they went home for dinner and slept well.';
  return {
    prompt_version: 'story-v1',
    model: 'claude-haiku-test',
    story: {
      title: 'A Week in the Park',
      paragraphs: [sentences.slice(0, 3).join(' ') + ' ' + filler, sentences.slice(3).join(' ') + ' ' + filler],
      used_lemmas: targets,
      questions: [
        { q: 'Where did the girl go?', options: ['To the park', 'To the sea', 'To a shop'], answer: 0 },
        { q: 'Who did she talk to?', options: ['Her teacher', 'Her friend', 'Her dog'], answer: 1 },
        { q: 'What did they do at the end?', options: ['They swam', 'They ran', 'They went home'], answer: 2 },
      ],
      glosses: targets.map((w) => ({ lemma: w, gloss_tr: 'anlamı' })),
    },
    usage: { used: 1, limit: 1 },
  };
}

test('Bugün → "Bugünün hikâyesi": written once, read with bold words and three questions', async ({
  context,
  page,
  backend,
}) => {
  void backend; // the fake Supabase (auth, sync) behind the signed-in session
  await FakeBackend.signIn(context);
  const calls: Record<string, unknown>[] = [];
  await context.route(`${SUPABASE_URL}/functions/v1/ai-story`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    const body = route.request().postDataJSON() as { target_lemmas: string[] };
    calls.push(body);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(storyFor(body.target_lemmas)),
    });
  });

  await restoreFile(page, await storyBackup(Date.now()));
  await page.goto('/');
  const row = page.getByTestId('today-story');
  await expect(row).toBeVisible({ timeout: 20_000 });
  await noSideScroll(page);
  await row.getByTestId('today-story-make').click();
  await expect(page).toHaveURL(/\/oku\/[0-9a-f-]+$/, { timeout: 20_000 });
  const url = page.url();

  // What left the device: the target words, level, difficulty and topics (plus, at most once,
  // an avoid list for the regeneration). Nothing else.
  expect(calls.length).toBeGreaterThanOrEqual(1);
  expect(calls.length).toBeLessThanOrEqual(2);
  for (const c of calls) {
    expect(Object.keys(c).filter((k) => k !== 'avoid').sort()).toEqual([
      'difficulty',
      'interests',
      'level',
      'target_lemmas',
    ]);
  }
  expect([...(calls[0]!.target_lemmas as string[])].sort()).toEqual([...WORDS].sort());

  await expect(page.getByRole('heading', { name: 'A Week in the Park' })).toBeVisible();
  await expect(page.locator('[data-target]').first()).toBeVisible();
  const questions = page.getByTestId('story-question');
  await expect(questions).toHaveCount(3);
  await questions.nth(1).getByRole('button', { name: 'Her friend' }).click();
  await expect(questions.nth(1).getByRole('status')).toHaveText('Doğru.');
  await noSideScroll(page);

  // Bugün again: the same story, no new request.
  const asked = calls.length;
  await page.goto('/');
  await expect(page.getByTestId('today-reading').getByRole('link', { name: /A Week in the Park/ })).toHaveAttribute(
    'href',
    new URL(url).pathname,
  );
  expect(calls.length).toBe(asked);
});
