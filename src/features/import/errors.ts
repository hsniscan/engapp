import type { ImportErrorCode } from '@/data';
import i18n from '@/i18n';

const KNOWN: ImportErrorCode[] = [
  'daily_limit',
  'quota_exceeded',
  'ai_failed',
  'not_signed_in',
  'not_configured',
  'invalid_input',
  'bad_response',
  'unreachable',
  'unknown',
];

/** Friendly Turkish message for a job error code. */
export function importErrorMessage(code: ImportErrorCode | 'offline' | null | undefined): string {
  if (code === 'offline') return i18n.t('importer.errors.offline');
  const c = code && KNOWN.includes(code) ? code : 'unknown';
  return i18n.t(`importer.errors.${c}`);
}
