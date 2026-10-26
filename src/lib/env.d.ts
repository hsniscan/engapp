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
  /** Google OAuth *web* client id (…apps.googleusercontent.com): native sign-in in the Android app */
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
  /**
   * Public base URL of the audio bucket on Cloudflare R2 (https://pub-….r2.dev or a custom
   * domain; decision 0053). Missing => the audio comes from Supabase Storage only.
   */
  readonly VITE_AUDIO_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
