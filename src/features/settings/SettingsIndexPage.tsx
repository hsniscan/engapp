// /settings (design 4.16): the index of settings sub-pages in labelled ListGroups, with a
// search over every page's title, current state and keywords. Old deep links (/settings#veri)
// are sent on to the sub-page that now holds that group.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';
import { ListGroup, ListRow, TextField } from '@/ui';
import { version } from '../../../package.json';
import { SettingsFrame } from './SettingsFrame';
import {
  legacyTarget,
  PAGE_ICON,
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
      <div role="search">
        <TextField
          id="settings-search"
          type="search"
          label={t('settings.index.search')}
          hideLabel
          leadingIcon="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('settings.index.search')}
          autoComplete="off"
        />
      </div>

      {q ? (
        <section aria-label={t('settings.index.results')} aria-live="polite" className="mt-6">
          {matches.length ? (
            <Rows pages={matches} summaries={summaries} label={t('settings.index.results')} />
          ) : (
            <p className="px-1 py-4 text-ui text-fg-muted">
              {t('settings.index.noResults', { query: query.trim() })}
            </p>
          )}
        </section>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {SETTINGS_GROUPS.map((g) => (
            <Rows
              key={g.key}
              pages={g.pages}
              summaries={summaries}
              label={t(`settings.index.groups.${g.key}`)}
              showLabel
            />
          ))}
          <p className="text-center text-caption text-fg-muted">
            {t('settings.index.version', { version })}
          </p>
        </div>
      )}
    </SettingsFrame>
  );
}

function Rows({
  pages,
  summaries,
  label,
  showLabel,
}: {
  pages: SettingsPageId[];
  summaries: Partial<Record<SettingsPageId, string>>;
  label: string;
  showLabel?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ListGroup label={showLabel ? label : undefined} aria-label={label}>
      {pages.map((p) => (
        <ListRow
          key={p}
          to={settingsHref(p)}
          leadingIcon={PAGE_ICON[p]}
          title={t(`settings.pages.${p}.title`)}
          description={summaries[p]}
        />
      ))}
    </ListGroup>
  );
}
