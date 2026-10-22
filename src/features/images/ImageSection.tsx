// "Görsel" in the word detail sheet and in the leech sheet's "Görselle çalış" (v0.4 İP3, ADR
// 0031): per sense, the picture cards show, the other pictures to pick from, "Yeniden üret" /
// "Görsel üret" (ai-image), "Görseli gizle" and "Bu görsel anlamı anlatıyor mu? Evet / Hayır".
// What the user picks, hides or answers stays in the user's account (user_content,
// content_feedback). For an app admin, an answer about a picture still waiting for review is
// also the review decision (plan İP4: "kendi kartında karttan evet/hayır onay yerine geçer").
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { decideReview } from '@/ai/image';
import {
  chooseImage,
  getSenseImages,
  logError,
  setImageHidden,
  setImageVerdict,
  undoImageReject,
  type CachedImage,
} from '@/data';
import { IMAGE_REJECT_REASONS, type ImageRejectReason } from '@/domain/images';
import type { Id, Sense } from '@/domain/types';
import { useAuth } from '@/features/auth/session';
import { useOnline } from '@/features/import/shared';
import { Button, cn, Icon, toast } from '@/ui';
import { IMAGE_DAILY_LIMIT } from '../../../supabase/functions/_shared/image-contract';
import { CardPicture } from './CardPicture';
import { drawImage, type ImageRequestDeps, type ImageRequestError } from './request';
import { useIsAdmin } from './useIsAdmin';

export interface ImageSectionProps {
  /** The note's live senses (or, in the leech sheet, the card's senses). */
  senses: Sense[];
  /** The sense to start on. */
  initialSenseId?: Id | null;
  headingId?: string;
  /** Without the section heading (inside the leech sheet's path, which has its own title). */
  bare?: boolean;
  /** Tests only. */
  requestDeps?: ImageRequestDeps;
  /** Tests only: the admin check and the review decision. */
  admin?: { ask: () => Promise<boolean>; decide: typeof decideReview };
}

export function ImageSection({ senses, initialSenseId, headingId, bare, requestDeps, admin }: ImageSectionProps) {
  const { t } = useTranslation();
  const id = useId();
  const hId = headingId ?? `${id}-h`;
  const [senseId, setSenseId] = useState<Id | null>(initialSenseId ?? senses[0]?.id ?? null);
  const sense = senses.find((s) => s.id === senseId) ?? senses[0] ?? null;
  if (!sense) return null;
  return (
    <section
      aria-labelledby={bare ? undefined : hId}
      aria-label={bare ? t('images.section.title') : undefined}
      className="flex flex-col gap-2"
      data-testid="image-section"
    >
      {!bare && (
        <>
          <h3 id={hId} className="font-serif text-lg font-semibold text-fg">
            {t('images.section.title')}
          </h3>
          <p className="-mt-1 text-sm text-fg-muted">{t('images.section.intro')}</p>
        </>
      )}
      {senses.length > 1 && (
        <div role="group" aria-label={t('images.section.senseLabel')} className="flex flex-wrap gap-1.5">
          {senses.map((s, i) => {
            const on = s.id === sense.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => setSenseId(s.id)}
                className={cn(
                  'inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-(--duration-micro)',
                  on
                    ? 'border-accent bg-accent-soft text-accent-text'
                    : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                <span className="tabular font-serif font-semibold">{i + 1}.</span>
                <span className="truncate">{s.meaning_tr_override ?? s.meaning_tr}</span>
              </button>
            );
          })}
        </div>
      )}
      <SenseImages key={sense.id} senseId={sense.id} requestDeps={requestDeps} admin={admin} />
    </section>
  );
}

function errorText(t: TFunction, e: ImageRequestError): string {
  return t(`images.errors.${e}`, { limit: IMAGE_DAILY_LIMIT });
}

type Note = { kind: 'info' | 'warn'; text: string } | null;

function SenseImages({
  senseId,
  requestDeps,
  admin,
}: {
  senseId: Id;
  requestDeps?: ImageRequestDeps;
  admin?: ImageSectionProps['admin'];
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const online = useOnline();
  const isAdmin = useIsAdmin(admin?.ask) === true;
  const view = useLiveQuery(() => getSenseImages(senseId), [senseId]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  if (view === undefined) return <p className="text-sm text-fg-muted">{t('images.section.loading')}</p>;
  if (view === null) return null;

  const signedIn = auth.status === 'signed_in';
  const canDraw = !!view.lexiconSenseId && signedIn && online;
  const shown = view.shown;
  const failed = (e: unknown, where: string) => {
    void logError(e, where);
    toast({ title: t('images.section.saveFailed'), tone: 'danger' });
  };

  const draw = async () => {
    setBusy(true);
    setNote({ kind: 'info', text: t('images.section.generating') });
    const res = await drawImage({ senseId, lexiconSenseId: view.lexiconSenseId }, requestDeps);
    setBusy(false);
    setNote(res.ok ? { kind: 'info', text: t('images.section.generated') } : { kind: 'warn', text: errorText(t, res.error) });
  };

  const hide = (hidden: boolean) =>
    setImageHidden(senseId, hidden).then(
      () =>
        toast(
          hidden
            ? {
                title: t('images.section.hiddenToast'),
                action: { label: t('common.undo'), onClick: () => void setImageHidden(senseId, false).catch((e: unknown) => failed(e, 'images.unhide')) },
              }
            : { title: t('images.section.shownToast') },
        ),
      (e: unknown) => failed(e, 'images.hide'),
    );

  const choose = (img: CachedImage) =>
    chooseImage(senseId, img.id).then(
      () => toast({ title: t('images.section.chosenToast'), tone: 'success' }),
      (e: unknown) => failed(e, 'images.choose'),
    );

  // An admin's answer about a picture still in review is the review decision too.
  const reviewAlso = (img: CachedImage, decision: 'approve' | 'reject', reason: ImageRejectReason | null) => {
    if (!isAdmin || img.status !== 'review') return;
    void (admin?.decide ?? decideReview)(img.id, decision, reason).catch((e: unknown) => void logError(e, 'images.adminDecide'));
  };

  const answer = (img: CachedImage, verdict: 'like' | 'reject' | null, reason: ImageRejectReason | null = null) =>
    setImageVerdict(senseId, img.id, verdict, reason).then(
      ({ clearedChoice }) => {
        if (verdict === 'like') {
          reviewAlso(img, 'approve', null);
          toast({ title: t('images.section.thanks') });
        } else if (verdict === 'reject') {
          reviewAlso(img, 'reject', reason);
          toast({
            title: t('images.section.rejectedToast'),
            action: {
              label: t('common.undo'),
              onClick: () =>
                void undoImageReject(senseId, img.id, { restoreChoice: clearedChoice }).catch((e: unknown) => failed(e, 'images.undoReject')),
            },
          });
        }
      },
      (e: unknown) => failed(e, 'images.verdict'),
    );

  let status: string | null = null;
  if (!view.lexiconSenseId) status = t('images.section.noLexicon');
  else if (view.choice.hidden) status = t('images.section.hidden');
  else if (!shown)
    status = !signedIn ? t('images.section.noneGuest') : !online ? t('images.section.noneOffline') : t('images.section.none');

  const others = view.images.filter((i) => view.verdicts[i.id] !== 'reject' || view.choice.imageId === i.id);
  const showVariants = others.length > 1 || (others.length === 1 && (!shown || others[0]!.id !== shown.id));

  return (
    <div className="flex flex-col gap-3">
      {shown && (
        <div className="flex flex-col items-center gap-3 rounded-control bg-surface-sunken px-3 py-4 sm:flex-row sm:items-start" data-testid="image-shown">
          <CardPicture image={{ id: shown.id, svg: shown.svg, alt: shown.alt_tr, isNew: shown.status === 'review' }} className="size-40" />
          <div className="flex w-full min-w-0 flex-1 flex-col gap-2">
            {shown.status === 'review' && <p className="text-sm text-fg-muted">{t('images.section.newNote')}</p>}
            <Verdict image={shown} verdict={view.verdicts[shown.id] ?? null} reason={view.reasons[shown.id] ?? null} onAnswer={answer} />
          </div>
        </div>
      )}

      {status && <p className="text-sm text-fg-muted">{status}</p>}

      {showVariants && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-fg">{t('images.section.variantsLabel')}</p>
          <p className="-mt-1 text-sm text-fg-muted">{t('images.section.variantsHint')}</p>
          <ul className="flex flex-wrap gap-2">
            {others.map((img, i) => {
              const inUse = !view.choice.hidden && shown?.id === img.id;
              const label = t('images.section.variantLabel', { n: i + 1 });
              return (
                <li key={img.id}>
                  <button
                    type="button"
                    aria-pressed={inUse}
                    aria-label={`${label}: ${img.alt_tr}. ${inUse ? t('images.section.inUse') : t('images.section.useThis')}`}
                    title={inUse ? t('images.section.inUse') : t('images.section.useThis')}
                    onClick={() => !inUse && void choose(img)}
                    className={cn(
                      'relative flex size-20 items-center justify-center rounded-control border-2 bg-surface p-1 transition-colors duration-(--duration-micro)',
                      inUse ? 'border-accent' : 'border-border hover:border-border-strong',
                    )}
                    data-testid="image-variant"
                  >
                    <CardPicture image={{ id: img.id, svg: img.svg, alt: img.alt_tr, isNew: img.status === 'review' }} decorative className="size-full" />
                    {inUse && (
                      <span className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-accent text-accent-fg">
                        <Icon name="check" size={14} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {view.lexiconSenseId && (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon="refresh"
            loading={busy}
            disabled={!canDraw || busy}
            onClick={() => void draw()}
          >
            {view.images.length ? t('images.section.regenerate') : t('images.section.generate')}
          </Button>
        )}
        {view.choice.hidden ? (
          <Button size="sm" variant="ghost" leadingIcon="eye" onClick={() => void hide(false)}>
            {t('images.section.show')}
          </Button>
        ) : (
          shown && (
            <Button size="sm" variant="ghost" leadingIcon="eye-off" onClick={() => void hide(true)}>
              {t('images.section.hide')}
            </Button>
          )
        )}
      </div>
      <p role="status" className={cn('text-sm empty:hidden', note?.kind === 'warn' ? 'text-warn-text' : 'text-fg-muted')}>
        {note?.text ?? ''}
      </p>
    </div>
  );
}

/** "Bu görsel anlamı anlatıyor mu?" with Evet / Hayır, and the reasons after Hayır. */
function Verdict({
  image,
  verdict,
  reason,
  onAnswer,
}: {
  image: CachedImage;
  verdict: 'like' | 'reject' | null;
  reason: ImageRejectReason | null;
  onAnswer: (img: CachedImage, verdict: 'like' | 'reject' | null, reason?: ImageRejectReason | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const qId = useId();
  const [asking, setAsking] = useState<'question' | 'reasons' | null>(null);
  const mode = asking ?? (verdict ? 'answered' : 'question');

  if (mode === 'answered') {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm text-fg-muted">
          {verdict === 'like'
            ? t('images.section.answeredYes')
            : t('images.section.answeredNo', { reason: reason ? t(`images.reasons.${reason}`) : t('images.reasons.other') })}
        </p>
        <Button size="sm" variant="ghost" className="px-2" onClick={() => setAsking('question')}>
          {t('images.section.change')}
        </Button>
      </div>
    );
  }
  if (mode === 'reasons') {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-fg">{t('images.section.whyNo')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {IMAGE_REJECT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setAsking(null);
                void onAnswer(image, 'reject', r);
              }}
              className="inline-flex min-h-10 items-center rounded-full border border-border px-3.5 text-sm text-fg transition-colors duration-(--duration-micro) hover:border-border-strong hover:bg-hover"
            >
              {t(`images.reasons.${r}`)}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="self-start px-2" onClick={() => setAsking(verdict ? null : 'question')}>
          {t('common.cancel')}
        </Button>
      </fieldset>
    );
  }
  return (
    <div role="group" aria-labelledby={qId} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p id={qId} className="text-[0.9375rem] font-medium text-fg">
        {t('images.section.question')}
      </p>
      <span className="flex gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon="check"
          onClick={() => {
            setAsking(null);
            void onAnswer(image, 'like');
          }}
        >
          {t('images.section.yes')}
        </Button>
        <Button size="sm" variant="secondary" leadingIcon="x" onClick={() => setAsking('reasons')}>
          {t('images.section.no')}
        </Button>
      </span>
    </div>
  );
}
