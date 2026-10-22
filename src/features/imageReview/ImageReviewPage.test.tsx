// "Görsel onayı" (v0.4 İP4): admin gating, swipe / buttons / keyboard, reasons, undo held
// back until the next decision, and refills of the optimistic queue. The RPCs are fakes.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewQueueRow } from '@/ai/image';
import { setAuthStateForTesting } from '@/features/auth/session';
import { clearPictureCache } from '@/features/images/picture';
import { resetAdminCache } from '@/features/images/useIsAdmin';
import { SAMPLE_PICTURES } from '@/test/imageSamples';
import { renderRoute } from '@/test/ui';
import { Toaster } from '@/ui';
import { ImageReviewPage, type ReviewApi } from './ImageReviewPage';

const sanitizeSvg = vi.hoisted(() => vi.fn((svg: string) => ({ ok: true as const, svg })));
vi.mock('../../../supabase/functions/_shared/svg-sanitize', () => ({ sanitizeSvg }));

const NAMES = Object.keys(SAMPLE_PICTURES) as (keyof typeof SAMPLE_PICTURES)[];
const imgId = (n: number) => `0199f0a0-0000-7000-8000-0000000c${String(n).padStart(4, '0')}`;

function row(n: number): ReviewQueueRow {
  const s = SAMPLE_PICTURES[NAMES[n % NAMES.length]!];
  return {
    image: {
      id: imgId(n),
      sense_id: '0199f0a0-0000-7000-8000-00000000a001',
      variant: 0,
      svg: s.svg,
      alt_tr: `${s.gloss_tr} resmi ${n}`,
      status: 'review',
      created_at: '2026-10-25T01:30:00Z',
    },
    lemma: `${s.lemma}${n}`,
    pos: s.pos,
    gloss_tr: s.gloss_tr,
  };
}

/** A fake server: rows stay until a decision arrives; answers oldest first. */
function fakeApi(count: number) {
  let rows = Array.from({ length: count }, (_, i) => row(i));
  const decisions: [string, string, string | null][] = [];
  const api: ReviewApi = {
    fetch: vi.fn(async (limit: number) => rows.slice(0, limit)),
    decide: vi.fn(async (id: string, decision: string, reason: string | null) => {
      decisions.push([id, decision, reason]);
      rows = rows.filter((r) => r.image.id !== id);
    }),
  };
  return { api, decisions };
}

const yes = async () => true;
const no = async () => false;

const signIn = () => setAuthStateForTesting({ status: 'signed_in', user: { id: 'admin-1', email: null, name: null, avatarUrl: null } });

beforeEach(() => {
  resetAdminCache();
  clearPictureCache();
  signIn();
});
afterEach(() => setAuthStateForTesting({ status: 'guest', user: null }));

const render = (api: ReviewApi, ask = yes) =>
  renderRoute(
    <>
      <ImageReviewPage api={api} ask={ask} />
      <Toaster />
    </>,
  );

const card = () => screen.getByTestId('review-card');
/** Which row (by its number) is on screen. */
const shownRow = () => Number(card().getAttribute('data-image-id')!.slice(-4));

describe('Görsel onayı', () => {
  it('needs sign-in and the admin role', async () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    const { api } = fakeApi(3);
    const view = render(api);
    expect(screen.getByText('Bu sayfa için Google ile giriş yapmalısın.')).toBeInTheDocument();
    view.unmount();
    signIn();
    render(api, no);
    expect(await screen.findByText('Bu sayfa yalnızca yöneticiler için.')).toBeInTheDocument();
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('shows lemma, part of speech, Turkish meaning and the picture; buttons decide', async () => {
    const user = userEvent.setup();
    const { api, decisions } = fakeApi(3);
    render(api);
    await screen.findByTestId('review-card');
    expect(card()).toHaveAttribute('data-image-id', imgId(0));
    expect(within(card()).getByText('apple0')).toBeInTheDocument();
    expect(within(card()).getByText('elma')).toBeInTheDocument();
    expect(within(card()).getByRole('img', { name: 'elma resmi 0' })).toBeInTheDocument();
    expect(screen.getByTestId('review-left')).toHaveTextContent('3 görsel kaldı');

    await user.click(screen.getByRole('button', { name: 'Onayla' }));
    expect(card()).toHaveAttribute('data-image-id', imgId(1));
    expect(screen.getByTestId('review-left')).toHaveTextContent('2 görsel kaldı');
    // Held back for "Geri al" until the next decision.
    expect(decisions).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Yeniden çiz' }));
    await waitFor(() => expect(decisions).toEqual([[imgId(0), 'approve', null]]));

    await user.click(screen.getByRole('button', { name: 'Reddet' }));
    const reasons = screen.getByRole('group', { name: 'Neden reddediyorsun?' });
    await user.click(within(reasons).getByRole('button', { name: /Çizim kötü görünüyor/ }));
    await waitFor(() => expect(decisions).toEqual([[imgId(0), 'approve', null], [imgId(1), 'redraw', null]]));
    expect(await screen.findByText('Bekleyen görsel yok. Hepsini gözden geçirdin.')).toBeInTheDocument();
  });

  it('"Geri al" brings the last picture back and nothing is sent for it', async () => {
    const user = userEvent.setup();
    const { api, decisions } = fakeApi(3);
    render(api);
    await screen.findByTestId('review-card');
    expect(screen.getByRole('button', { name: 'Geri al' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Onayla' }));
    await user.click(screen.getByRole('button', { name: 'Geri al' }));
    expect(card()).toHaveAttribute('data-image-id', imgId(0));
    expect(screen.getByRole('status')).toHaveTextContent('Son karar geri alındı: apple0');
    await user.click(screen.getByRole('button', { name: 'Yeniden çiz' }));
    await user.click(screen.getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(decisions).toEqual([[imgId(0), 'redraw', null]]));
  });

  it('keyboard: → approves, ← asks why (1–4), ↓ redraws, Z undoes', async () => {
    const user = userEvent.setup();
    const { api, decisions } = fakeApi(5);
    render(api);
    await screen.findByTestId('review-card');
    await user.keyboard('{ArrowRight}');
    expect(shownRow()).toBe(1);
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('reject-reasons')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('reject-reasons')).not.toBeInTheDocument();
    await user.keyboard('{ArrowLeft}1');
    expect(shownRow()).toBe(2);
    await user.keyboard('z');
    expect(shownRow()).toBe(1);
    await user.keyboard('{ArrowDown}{ArrowRight}');
    await waitFor(() =>
      expect(decisions).toEqual([
        [imgId(0), 'approve', null],
        [imgId(1), 'redraw', null],
      ]),
    );
  });

  it('swipes: right approves, left asks why, down redraws; a short drag does nothing', async () => {
    const { api, decisions } = fakeApi(5);
    render(api);
    await screen.findByTestId('review-card');
    const swipe = (dx: number, dy: number) => {
      const el = card();
      fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 100 + dx / 2, clientY: 100 + dy / 2 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
    };
    act(() => swipe(30, 0));
    expect(shownRow()).toBe(0);
    act(() => swipe(160, 10));
    expect(shownRow()).toBe(1);
    act(() => swipe(0, 150));
    expect(shownRow()).toBe(2);
    act(() => swipe(-160, 0));
    fireEvent.click(within(screen.getByTestId('reject-reasons')).getByRole('button', { name: /Başka bir anlamı gösteriyor/ }));
    expect(shownRow()).toBe(3);
    await waitFor(() =>
      expect(decisions).toEqual([
        [imgId(0), 'approve', null],
        [imgId(1), 'redraw', null],
      ]),
    );
  });

  it('refills the queue of 20 without showing a picture twice, and sends the last decision on leaving', async () => {
    const user = userEvent.setup();
    const { api, decisions } = fakeApi(26);
    const view = render(api);
    await screen.findByTestId('review-card');
    expect(api.fetch).toHaveBeenLastCalledWith(20);
    expect(screen.getByTestId('review-left')).toHaveTextContent('20+ görsel kaldı');
    const seen: string[] = [];
    for (let i = 0; i < 16; i++) {
      seen.push(card().getAttribute('data-image-id')!);
      await user.keyboard('{ArrowRight}');
    }
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('review-left')).toHaveTextContent('10 görsel kaldı'));
    while (screen.queryByTestId('review-card')) {
      seen.push(card().getAttribute('data-image-id')!);
      await user.keyboard('{ArrowRight}');
    }
    expect(new Set(seen).size).toBe(26);
    expect(seen).toHaveLength(26);
    view.unmount();
    await waitFor(() => expect(decisions).toHaveLength(26));
  });

  it('a decision the server refuses comes back at the end of the queue', async () => {
    const user = userEvent.setup();
    const { api } = fakeApi(3);
    vi.mocked(api.decide).mockRejectedValueOnce(new Error('rpc'));
    render(api);
    await screen.findByTestId('review-card');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(await screen.findByText('Karar kaydedilemedi; görsel yeniden sıraya kondu.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('review-left')).toHaveTextContent('2 görsel kaldı'));
    await user.keyboard('{ArrowRight}');
    expect(card()).toHaveAttribute('data-image-id', imgId(0));
  });
});
