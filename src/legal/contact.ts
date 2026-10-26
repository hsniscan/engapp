// Contact address of the data controller, set at build time (VITE_CONTACT_EMAIL in
// .env.production or the Cloudflare Pages / Android build environment). Null until the
// owner sets it; until then the pages point to the public feedback page (never a placeholder:
// Google Play reviews these pages).

const EMAIL = /^[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[^\s@<>()[\]",;:]+$/;

export function contactEmail(env: Partial<ImportMetaEnv> = import.meta.env): string | null {
  const v = env.VITE_CONTACT_EMAIL?.trim();
  return v && EMAIL.test(v) ? v : null;
}

/** Where people can write while no contact e-mail is set: the public issue tracker. */
export const CONTACT_FALLBACK_URL = 'https://github.com/hsniscan/engapp/issues';
