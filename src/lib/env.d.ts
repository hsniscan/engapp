/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** https://<project-ref>.supabase.co — missing => guest-only mode */
  readonly VITE_SUPABASE_URL?: string;
  /** publishable key (sb_publishable_...) */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** legacy name, accepted as a fallback for the publishable / anon key */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Contact e-mail shown in the privacy policy and on /hesap-sil (set at build time). */
  readonly VITE_CONTACT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
