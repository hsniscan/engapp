// "Görsel" in the word detail sheet and in the leech sheet's "Görselle çalış" (v0.4 İP3, ADR
// 0031): per sense, the picture the cards show and "Görseli gizle" / "Görseli göster". Pictures
// are drawn once in bulk by the nightly job (scripts/img-batch.ts) and only displayed here: the
// on-demand "Görsel üret", the variant picker and the Evet / Hayır question were removed in
// v0.5.2 (ADR 0061). Earlier picks, hides and "Hayır" answers stored in the user's account
// (user_content, content_feedback) are still honoured when choosing the picture.
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSenseImages, logError, setImageHidden } from '@/data';
import type { Id, Sense } from '@/domain/types';
import { useAuth } from '@/features/auth/session';
import { useOnline } from '@/lib/online';
import { Button, cn, toast } from '@/ui';
import { CardPicture } from './CardPicture';

export interface ImageSectionProps {
  /** The note's live senses (or, in the leech sheet, the card's senses). */
  senses: Sense[];
  /** The sense to start on. */
  initialSenseId?: Id | null;
  headingId?: string;
  /** Without the section heading (inside the leech sheet's path, which has its own title). */
  bare?: boolean;
}

export function ImageSection({ senses, initialSenseId, headingId, bare }: ImageSectionProps) {
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
          <h3 id={hId} className="text-ui font-semibold text-fg">
            {t('images.section.title')}
          </h3>
          <p className="-mt-1 text-meta text-fg-muted">{t('images.section.intro')}</p>
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
      <SenseImages key={sense.id} senseId={sense.id} />
    </section>
  );
}

function SenseImages({ senseId }: { senseId: Id }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const online = useOnline();
  const view = useLiveQuery(() => getSenseImages(senseId), [senseId]);

  if (view === undefined) return <p className="text-sm text-fg-muted">{t('images.section.loading')}</p>;
  if (view === null) return null;

  const signedIn = auth.status === 'signed_in';
  const shown = view.shown;
  const failed = (e: unknown, where: string) => {
    void logError(e, where);
    toast({ title: t('images.section.saveFailed'), tone: 'danger' });
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

  let status: string | null = null;
  if (!view.lexiconSenseId) status = t('images.section.noLexicon');
  else if (view.choice.hidden) status = t('images.section.hidden');
  else if (!shown)
    status = !signedIn ? t('images.section.noneGuest') : !online ? t('images.section.noneOffline') : t('images.section.none');

  return (
    <div className="flex flex-col gap-3">
      {shown && (
        <div className="flex flex-col items-center gap-3 rounded-control bg-surface-sunken px-3 py-4" data-testid="image-shown">
          <CardPicture image={{ id: shown.id, svg: shown.svg, alt: shown.alt_tr, isNew: shown.status === 'review' }} className="size-40" />
        </div>
      )}

      {status && <p className="text-sm text-fg-muted">{status}</p>}

      <div className={cn('flex flex-wrap gap-2', !view.choice.hidden && !shown && 'hidden')}>
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
    </div>
  );
}
