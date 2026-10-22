// Capacitor (Android app), docs/decisions/0033-android-capacitor.md.
// The web build (`pnpm build` → dist/) is bundled into the APK/AAB by `npx cap sync android`;
// there is deliberately no `server.url`: the app never loads code from the network.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.hsniscan.engapp',
  appName: 'Engapp',
  webDir: 'dist',
  android: {
    // Served as https://localhost (the default): a secure context, so Cache Storage, IndexedDB
    // and crypto.subtle behave as on the web. The edge functions accept this origin
    // (supabase/functions/_shared/http.ts).
    allowMixedContent: false,
    captureInput: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      // Edge-to-edge with env(safe-area-inset-*) (index.html has viewport-fit=cover; the CSS
      // already pads with it). On WebView < 140 Capacitor pads the WebView instead.
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
      style: 'DEFAULT',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_engapp',
      iconColor: '#2a5a8c',
    },
  },
};

export default config;
