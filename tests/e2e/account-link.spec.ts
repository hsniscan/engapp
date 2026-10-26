import { addWord, expect, test, WORDS } from './support/app.ts';
import { FakeBackend } from './support/backend.ts';

// Production incident: Google sign-in worked but the sync RPCs were not deployed yet, and the
// "Hesap bağlanamadı" dialog had no way out. The user must always be able to continue as guest.
test('sign-in succeeds but the sync backend fails → "Misafir olarak devam et" signs out, app works as guest', async ({
  page,
  context,
  backend,
}) => {
  for (const fn of ['sync_pull', 'sync_pull_v3', 'sync_push', 'lexicon_pull'])
    backend.brokenRpcs.add(fn);
  await FakeBackend.signIn(context);
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'Hesap bağlanamadı' });
  await expect(dialog).toBeVisible();
  // Retrying keeps failing (the backend is still missing) and the dialog stays answerable.
  await dialog.getByRole('button', { name: 'Tekrar dene' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Misafir olarak devam et' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: /Eşitleme durumu: Misafir modu/ })).toBeVisible();

  // Fully usable as a guest, and it stays signed out after a reload.
  await addWord(page, WORDS[0]!);
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Eşitleme durumu: Misafir modu/ })).toBeVisible();
  await page.goto('/library');
  await expect(page.getByRole('list', { name: 'Notlar' }).getByRole('listitem')).toHaveCount(1);
});

test('second-device question can also be left with "Misafir olarak devam et" (nothing changes)', async ({
  page,
  context,
  backend,
}) => {
  // The account already has data …
  backend.rows.set('notes:x', {
    table: 'notes',
    seq: 1,
    row: { id: 'x' } as never,
  });
  // … and so has this device (added as a guest first).
  await page.goto('/add');
  await addWord(page, WORDS[2]!);
  await FakeBackend.signIn(context);
  await page.reload();

  const dialog = page.getByRole('dialog', { name: 'Bu hesapta zaten kartların var' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Misafir olarak devam et' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: /Eşitleme durumu: Misafir modu/ })).toBeVisible();
  expect(backend.count('sync_push')).toBe(0);
  await page.goto('/library');
  await expect(
    page.getByRole('list', { name: 'Notlar' }).getByText('thrive', { exact: true }),
  ).toBeVisible();
});
