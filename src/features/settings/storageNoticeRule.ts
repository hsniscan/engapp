// Pure rule of Profil's storage notice (v0.5.3 A5, ADR 0072).
export const STORAGE_NOTICE_HIDE_MS = 30 * 86_400_000;

export function shouldShowStorageNotice(input: {
  guest: boolean;
  native: boolean;
  persisted: boolean | null;
  hiddenAt: number | null;
  now: number;
}): boolean {
  if (!input.guest) return false;
  if (input.hiddenAt !== null && input.now - input.hiddenAt < STORAGE_NOTICE_HIDE_MS) return false;
  return input.native || input.persisted === false;
}
