// Contact address of the data controller, set at build time (VITE_CONTACT_EMAIL in
// .env.production or the Cloudflare Pages / Android build environment). Null until the
// owner sets it; the pages then show a visible placeholder.

const EMAIL = /^[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[^\s@<>()[\]",;:]+$/;

export function contactEmail(env: Partial<ImportMetaEnv> = import.meta.env): string | null {
  const v = env.VITE_CONTACT_EMAIL?.trim();
  return v && EMAIL.test(v) ? v : null;
}
