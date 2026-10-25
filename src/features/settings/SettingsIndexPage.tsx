// /settings: the index of settings sub-pages, grouped as on the "Ayarlar" board, with a search
// over every page's title, current state and keywords. Old deep links (/settings#veri) are
// sent on to the sub-page that now holds that group.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router';
import { Icon } from '@/ui';
import { version } from '../../../package.json';
import { SettingsFrame } from './SettingsFrame';
import { GlyphTile } from './SettingsGlyph';
import {
  legacyTarget,
  PAGE_GLYPH,
  SETTINGS_GROUPS,
  SETTINGS_PAGES,
  settingsHref,
  type SettingsPageId,
} from './settingsPages';
import { useSettingsSummaries } from './useSettingsSummaries';

const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '');

export function SettingsIndexPage() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const summaries = useSettingsSummaries();
  const [query, setQuery] = useState('');

  const legacy = hash ? legacyTarget(decodeURIComponent(hash.slice(1))) : null;
  if (legacy) return <Navigate to={legacy} replace />;

  const q = fold(query.trim());
  const matches = q
    ? SETTINGS_PAGES.filter((p) =>
        fold(
          [
            t(`settings.pages.${p}.title`),
            summaries[p] ?? '',
            t(`settings.pages.${p}.keywords`),
          ].join(' '),
        ).includes(q),
      )
    : [];

  return (
    <SettingsFrame
      title={t('settings.title')}
      back={{ to: '/profile', label: t('settings.index.back') }}
    >
      <div role="search" className="relative">
        <label htmlFor="settings-search" className="sr-only">
          {t('settings.index.search')}
        </label>
        <Icon
          name="search"
          size={18}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-subtle"
        />
        <input
          id="settings-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('settings.index.search')}
          autoComplete="off"
          className="h-11 w-full rounded-control border border-border bg-surface-sunken pr-3.5 pl-10 text-[0.9375rem] text-fg placeholder:text-fg-muted"
        />
      </div>

      {q ? (
        <section aria-label={t('settings.index.results')} aria-live="polite" className="mt-4">
          {matches.length ? (
            <RowList pages={matches} summaries={summaries} label={t('settings.index.results')} />
          ) : (
            <p className="px-1.5 py-4 text-[0.9375rem] text-fg-muted">
              {t('settings.index.noResults', { query: query.trim() })}
            </p>
          )}
        </section>
      ) : (
        <div className="mt-2 flex flex-col">
          {SETTINGS_GROUPS.map((g) => (
            <div key={g.key} className="mt-4 flex flex-col gap-2">
              {g.titled && g.key !== 'app' && (
                <h2
                  id={`settings-group-${g.key}`}
                  className="px-1.5 text-[0.8125rem] font-semibold text-fg-muted"
                >
                  {t(`settings.index.groups.${g.key}`)}
                </h2>
              )}
              <RowList
                pages={g.pages}
                summaries={summaries}
                labelledBy={g.titled ? `settings-group-${g.key}` : undefined}
                label={g.titled ? undefined : t('settings.pages.hakkinda.title')}
              />
            </div>
          ))}
          <Link
            to={settingsHref('gelismis')}
            className="mt-4 flex min-h-[3.25rem] items-center gap-3 rounded-card px-3.5 text-fg hover:bg-hover"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[0.9375rem] font-medium">
                {t('settings.pages.gelismis.title')}
              </span>
              <span className="text-sm text-fg-muted">{summaries.gelismis}</span>
            </span>
            <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
          </Link>
          <p className="mt-5 text-center text-xs text-fg-muted">
            {t('settings.index.version', { version })}
          </p>
        </div>
      )}
    </SettingsFrame>
  );
}

function RowList({
  pages,
  summaries,
  label,
  labelledBy,
}: {
  pages: SettingsPageId[];
  summaries: Partial<Record<SettingsPageId, string>>;
  label?: string;
  labelledBy?: string;
}) {
  const { t } = useTranslation();
  return (
    <ul
      aria-label={label}
      aria-labelledby={labelledBy}
      className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface"
    >
      {pages.map((p) => (
        <li key={p}>
          <Link
            to={settingsHref(p)}
            className="flex min-h-[3.75rem] items-center gap-3.5 px-3.5 py-2.5 text-fg hover:bg-surface-hover focus-visible:outline-offset-[-2px]"
          >
            <GlyphTile name={PAGE_GLYPH[p].name} tone={PAGE_GLYPH[p].tone} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[0.9375rem] font-semibold">
                {t(`settings.pages.${p}.title`)}
              </span>
              {summaries[p] && (
                <span className="truncate text-[0.8125rem] text-fg-muted">{summaries[p]}</span>
              )}
            </span>
            <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
