import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { contactEmail } from '@/legal/contact';
import { privacyEn } from '@/legal/privacy.en';
import { privacyTr } from '@/legal/privacy.tr';
import type { LegalDocument } from '@/legal/types';
import { LegalText } from './LegalText';
import { PublicLayout } from './PublicLayout';

const DOCS: Record<'tr' | 'en', LegalDocument> = { tr: privacyTr, en: privacyEn };

function formatDate(iso: string, lang: 'tr' | 'en'): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(Date.UTC(y, m - 1, d));
}

/** /gizlilik (Turkish, binding) and /privacy (English, for Play reviewers). Public. */
export function PrivacyPage({ lang }: { lang: 'tr' | 'en' }) {
  const { i18n } = useTranslation();
  const t = i18n.getFixedT(lang);
  const doc = DOCS[lang];
  const email = contactEmail();
  const missing = t('legal.contactMissing');

  useEffect(() => {
    const prev = document.title;
    document.title = `${doc.title} · Engapp`;
    return () => {
      document.title = prev;
    };
  }, [doc.title]);

  return (
    <PublicLayout t={t} lang={lang}>
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="font-serif text-3xl leading-tight font-semibold tracking-[-0.01em] text-fg md:text-4xl">
            {doc.title}
          </h1>
          <p className="text-sm text-fg-muted">
            {t('legal.updated', { date: formatDate(doc.updated, lang) })}
          </p>
          {doc.intro.map((p) => (
            <p key={p} className="text-[1.0625rem] leading-relaxed text-fg">
              <LegalText text={p} email={email} missingEmail={missing} />
            </p>
          ))}
        </header>

        <nav aria-label={t('legal.contents')} className="rounded-card border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-2 text-sm font-medium text-fg-muted">{t('legal.contents')}</h2>
          <ol className="grid gap-1 text-[0.9375rem] sm:grid-cols-2">
            {doc.sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-accent-text hover:underline">
                  {i + 1}. {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {doc.sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-6">
            <h2
              id={`${s.id}-h`}
              className="mb-3 font-serif text-2xl leading-snug font-semibold text-fg"
            >
              {i + 1}. {s.heading}
            </h2>
            <div className="flex flex-col gap-3 text-base leading-relaxed text-fg">
              {s.blocks.map((b, j) =>
                'p' in b ? (
                  <p key={j}>
                    <LegalText text={b.p} email={email} missingEmail={missing} />
                  </p>
                ) : (
                  <ul key={j} className="flex list-disc flex-col gap-1.5 pl-5 marker:text-fg-subtle">
                    {b.ul.map((item) => (
                      <li key={item}>
                        <LegalText text={item} email={email} missingEmail={missing} />
                      </li>
                    ))}
                  </ul>
                ),
              )}
            </div>
          </section>
        ))}
      </article>
    </PublicLayout>
  );
}
