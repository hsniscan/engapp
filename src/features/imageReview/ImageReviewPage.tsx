// "Görsel onayı" (v0.4 İP4, docs/decisions/0032-image-review.md): the admin goes through new
// pictures one by one. Swipe right = approve, left = reject (then a reason), down = redraw;
// the same with buttons at the bottom (one-handed on a phone) and with → ← ↓ on a keyboard.
// The queue is optimistic: the next picture shows at once, the decision is sent in the
// background, and the last one is held back until the next decision so "Geri al" can take it
// back. Admin-only on the server too (every function checks public.app_admins).
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { decideReview, fetchReviewQueue, type ReviewQueueRow } from '@/ai/image';
import { logError } from '@/data';
import {
  addReviewItems,
  decideReviewItem,
  emptyReviewQueue,
  flushReviewDecision,
  needsRefill,
  requeueReviewItem,
  reviewFetchLimit,
  undoReviewDecision,
  type ReviewDecision,
  type ReviewDecisionKind,
  type ReviewItem,
  type ReviewQueueState,
} from '@/domain/imageReview';
import { IMAGE_REJECT_REASONS, type ImageRejectReason } from '@/domain/images';
import { useAuth } from '@/features/auth/session';
import { posLabel } from '@/features/cards/labels';
import { CardPicture } from '@/features/images/CardPicture';
import { preloadPicture } from '@/features/images/picture';
import { useIsAdmin } from '@/features/images/useIsAdmin';
import { useOnline } from '@/features/import/shared';
import { Button, cn, Icon, Kbd, Spinner, toast } from '@/ui';

export interface ReviewApi {
  fetch: (limit: number) => Promise<ReviewQueueRow[]>;
  decide: (imageId: string, decision: ReviewDecisionKind, reason: ImageRejectReason | null) => Promise<void>;
}

const defaultApi: ReviewApi = {
  fetch: (limit) => fetchReviewQueue(limit),
  decide: (id, decision, reason) => decideReview(id, decision, reason),
};

const toItem = (r: ReviewQueueRow): ReviewItem => ({
  id: r.image.id,
  lemma: r.lemma,
  pos: r.pos,
  gloss_tr: r.gloss_tr,
  svg: r.image.svg,
  alt_tr: r.image.alt_tr,
});

/** Distance (px) a swipe must travel to count. */
const SWIPE = 90;

export function ImageReviewRoute() {
  return <ImageReviewPage />;
}

export function ImageReviewPage({ api = defaultApi, ask }: { api?: ReviewApi; ask?: () => Promise<boolean> }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const online = useOnline();
  const admin = useIsAdmin(ask);

  let body: ReactNode;
  if (auth.status !== 'signed_in') body = <Notice text={t('imageReview.signIn')} />;
  else if (admin === undefined) body = online ? <Notice text={t('imageReview.loading')} busy /> : <Notice text={t('imageReview.offline')} />;
  else if (!admin) body = <Notice text={t('imageReview.notAdmin')} />;
  else body = <Reviewer api={api} online={online} />;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pt-3 pb-4 sm:px-6" data-testid="image-review">
      <header className="flex items-center gap-2">
        <Link
          to="/settings#gelismis"
          aria-label={t('common.back')}
          className="-ml-2 inline-flex size-11 items-center justify-center rounded-control text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Icon name="arrow-left" />
        </Link>
        <h1 className="font-serif text-2xl font-semibold text-fg">{t('imageReview.title')}</h1>
      </header>
      {body}
    </div>
  );
}

function Notice({ text, busy }: { text: string; busy?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      {busy && <Spinner />}
      <p className="max-w-sm text-[0.9375rem] text-fg-muted">{text}</p>
    </div>
  );
}

function Reviewer({ api, online }: { api: ReviewApi; online: boolean }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion() ?? false;
  const [state, setStateRaw] = useState<ReviewQueueState>(emptyReviewQueue);
  const stateRef = useRef(state);
  const setState = useCallback((next: ReviewQueueState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [said, setSaid] = useState('');
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const loadingRef = useRef(false);

  const send = useCallback(
    (d: ReviewDecision | null) => {
      if (!d) return;
      api.decide(d.item.id, d.decision, d.reason).catch((e: unknown) => {
        void logError(e, 'imageReview.decide');
        setState(requeueReviewItem(stateRef.current, d.item));
        toast({ title: t('imageReview.failed'), tone: 'danger' });
      });
    },
    [api, setState, t],
  );

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadFailed(false);
    try {
      const limit = reviewFetchLimit(stateRef.current);
      const rows = await api.fetch(limit);
      setState(addReviewItems(stateRef.current, rows.map(toItem), rows.length >= limit));
    } catch (e) {
      void logError(e, 'imageReview.load');
      setLoadFailed(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [api, setState]);

  // First page, and refills while the queue runs low.
  useEffect(() => {
    if (online && !loadFailed && needsRefill(state)) void load();
  }, [state, online, loadFailed, load]);

  // The next pictures are decoded ahead.
  useEffect(() => {
    for (const item of state.items.slice(1, 4)) preloadPicture({ id: item.id, svg: item.svg });
  }, [state.items]);

  // Leaving the screen (or closing the tab) sends the decision that was held back for undo.
  useEffect(() => {
    const flush = () => {
      const { state: next, send: d } = flushReviewDecision(stateRef.current);
      if (d) {
        stateRef.current = next;
        send(d);
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [send]);

  const current = state.items[0] ?? null;

  const decide = useCallback(
    (decision: ReviewDecisionKind, reason: ImageRejectReason | null = null) => {
      const item = stateRef.current.items[0];
      if (!item) return;
      const res = decideReviewItem(stateRef.current, decision, reason);
      setState(res.state);
      setRejecting(false);
      setSaid(t(`imageReview.done.${decision}`, { lemma: item.lemma }));
      send(res.send);
    },
    [send, setState, t],
  );

  const undo = useCallback(() => {
    const res = undoReviewDecision(stateRef.current);
    if (!res.undone) return;
    setState(res.state);
    setRejecting(false);
    setSaid(t('imageReview.undone', { lemma: res.undone.item.lemma }));
  }, [setState, t]);

  // Keyboard: → approve, ← reject (then 1–4), ↓ redraw, Z undo, Esc closes the reasons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.altKey || e.metaKey) return;
      const key = e.key;
      if ((key === 'z' || key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (e.ctrlKey) return;
      if (rejecting) {
        const n = Number(key);
        if (n >= 1 && n <= IMAGE_REJECT_REASONS.length) {
          e.preventDefault();
          decide('reject', IMAGE_REJECT_REASONS[n - 1]!);
        } else if (key === 'Escape') {
          e.preventDefault();
          setRejecting(false);
        }
        return;
      }
      if (!stateRef.current.items[0]) return;
      if (key === 'ArrowRight') {
        e.preventDefault();
        decide('approve');
      } else if (key === 'ArrowLeft') {
        e.preventDefault();
        setRejecting(true);
      } else if (key === 'ArrowDown') {
        e.preventDefault();
        decide('redraw');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, rejecting, undo]);

  // Swipes on the card.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (rejecting || !current || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setOffset({ x: 0, y: 0 });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setOffset({ x: e.clientX - d.x, y: e.clientY - d.y });
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const x = e.clientX - d.x;
    const y = e.clientY - d.y;
    setOffset(null);
    if (cancelled) return;
    if (Math.abs(x) >= SWIPE && Math.abs(x) > Math.abs(y)) {
      if (x > 0) decide('approve');
      else setRejecting(true);
    } else if (y >= SWIPE && y > Math.abs(x)) decide('redraw');
  };

  const leftLabel =
    state.more && state.items.length > 0
      ? t('imageReview.leftMore', { count: state.items.length })
      : t('imageReview.left', { count: state.items.length });

  const hint = offset ? swipeHint(offset) : null;

  return (
    <div className="flex flex-1 flex-col gap-3 pt-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm text-fg-muted">{t('imageReview.intro')}</p>
        <p className="tabular text-sm font-medium text-fg" data-testid="review-left">
          {current || !loading ? leftLabel : ''}
        </p>
      </div>
      <p className="hidden text-xs text-fg-subtle sm:block">{t('imageReview.shortcuts')}</p>

      <div className="relative flex flex-1 flex-col items-center justify-center">
        {!online && !current ? (
          <Notice text={t('imageReview.offline')} />
        ) : loadFailed && !current ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-[0.9375rem] text-fg-muted">{t('imageReview.loadFailed')}</p>
            <Button variant="secondary" leadingIcon="refresh" onClick={() => setLoadFailed(false)}>
              {t('imageReview.retry')}
            </Button>
          </div>
        ) : !current ? (
          loading ? (
            <Notice text={t('imageReview.loading')} busy />
          ) : (
            <Notice text={t('imageReview.empty')} />
          )
        ) : (
          <div
            key={current.id}
            role="group"
            aria-roledescription="kart"
            aria-label={t('imageReview.cardLabel', {
              lemma: current.lemma,
              pos: current.pos ? posLabel(t, current.pos) : '—',
              gloss: current.gloss_tr,
            })}
            data-testid="review-card"
            data-image-id={current.id}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => onPointerEnd(e)}
            onPointerCancel={(e) => onPointerEnd(e, true)}
            style={{
              transform: offset
                ? `translate(${offset.x}px, ${Math.max(0, offset.y)}px)${reduce ? '' : ` rotate(${offset.x / 24}deg)`}`
                : undefined,
              transition: offset || reduce ? 'none' : 'transform var(--duration-micro, 150ms) ease-out',
            }}
            className="relative flex w-full max-w-sm touch-none flex-col items-center gap-3 rounded-card border border-border bg-surface-raised px-5 pt-5 pb-6 shadow-md select-none"
          >
            {hint && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-3 rounded-full px-3 py-1 text-sm font-semibold',
                  hint === 'approve' && 'right-3 bg-success-soft text-success-text',
                  hint === 'reject' && 'left-3 bg-danger-soft text-danger-text',
                  hint === 'redraw' && 'left-1/2 -translate-x-1/2 bg-warn-soft text-warn-text',
                )}
              >
                {t(`imageReview.${hint}`)}
              </span>
            )}
            <div className="flex flex-col items-center gap-0.5 text-center">
              <p lang="en" className="font-serif text-3xl font-semibold text-fg">
                {current.lemma}
              </p>
              <p className="text-[0.9375rem] text-fg-muted">
                {current.pos && <span className="italic">{posLabel(t, current.pos)} · </span>}
                <span lang="tr" className="font-medium text-fg">
                  {current.gloss_tr}
                </span>
              </p>
            </div>
            <CardPicture
              image={{ id: current.id, svg: current.svg, alt: current.alt_tr }}
              showNew={false}
              className="aspect-square w-full max-w-[16rem]"
            />
            <p lang="tr" className="text-center text-sm text-fg-muted">
              {current.alt_tr}
            </p>
          </div>
        )}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>

      {rejecting && current && (
        <fieldset className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3" data-testid="reject-reasons">
          <legend className="px-1 text-sm font-medium text-fg">{t('imageReview.whyReject')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {IMAGE_REJECT_REASONS.map((r, i) => (
              <Button key={r} variant="secondary" className="h-auto min-h-12 py-2 whitespace-normal" onClick={() => decide('reject', r)}>
                <span className="hidden sm:inline">
                  <Kbd>{i + 1}</Kbd>
                </span>
                {t(`images.reasons.${r}`)}
              </Button>
            ))}
          </div>
          <Button variant="ghost" className="self-start" onClick={() => setRejecting(false)}>
            {t('imageReview.cancel')}
          </Button>
        </fieldset>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" leadingIcon="undo" disabled={!state.pending} onClick={undo}>
          {t('imageReview.undo')}
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('imageReview.title')}>
        <Button
          variant="secondary"
          size="lg"
          className="flex-col gap-0.5 px-2"
          disabled={!current}
          aria-pressed={rejecting}
          onClick={() => setRejecting((r) => !r)}
        >
          <Icon name="arrow-left" />
          {t('imageReview.reject')}
        </Button>
        <Button variant="secondary" size="lg" className="flex-col gap-0.5 px-2" disabled={!current} onClick={() => decide('redraw')}>
          <Icon name="chevron-down" />
          {t('imageReview.redraw')}
        </Button>
        <Button size="lg" className="flex-col gap-0.5 px-2" disabled={!current} onClick={() => decide('approve')}>
          <Icon name="arrow-right" />
          {t('imageReview.approve')}
        </Button>
      </div>
    </div>
  );
}

function swipeHint({ x, y }: { x: number; y: number }): ReviewDecisionKind | null {
  if (Math.abs(x) >= 30 && Math.abs(x) > Math.abs(y)) return x > 0 ? 'approve' : 'reject';
  if (y >= 30 && y > Math.abs(x)) return 'redraw';
  return null;
}
