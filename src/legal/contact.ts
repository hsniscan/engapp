// Contact address of the data controller, set at build time (VITE_CONTACT_EMAIL in
// .env.production or the Cloudflare Pages / Android build environment). Null until the
// owner sets it; until then the pages show the in-app ways to see, export and delete one's
// data and link the account deletion page (never a placeholder and never a made-up address:
// Google Play reviews these pages).

const EMAIL = /^[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[^\s@<>()[\]",;:]+$/;

export function contactEmail(env: Partial<ImportMetaEnv> = import.meta.env): string | null {
  const v = env.VITE_CONTACT_EMAIL?.trim();
  return v && EMAIL.test(v) ? v : null;
}

/** Where {{email}} points while no contact e-mail is set: the account deletion page. */
export const CONTACT_FALLBACK_URL = '/hesap-sil';

const WITH_EMAIL = '[[email]] ';
const WITHOUT_EMAIL = '[[noemail]] ';

/**
 * The legal texts mark a block or list item that only fits one case with a prefix:
 * `[[email]] ` (shown only when a contact e-mail is set) or `[[noemail]] ` (shown only when
 * none is). Returns whether `text` is shown, and the text without its prefix.
 */
export function contactVariant(text: string, hasEmail: boolean): string | null {
  if (text.startsWith(WITH_EMAIL)) return hasEmail ? text.slice(WITH_EMAIL.length) : null;
  if (text.startsWith(WITHOUT_EMAIL)) return hasEmail ? null : text.slice(WITHOUT_EMAIL.length);
  return text;
}

/** `texts` with the variants that fit, prefixes removed (see contactVariant). */
export function contactVariants(texts: readonly string[], hasEmail: boolean): string[] {
  return texts.flatMap((t) => {
    const v = contactVariant(t, hasEmail);
    return v === null ? [] : [v];
  });
}
