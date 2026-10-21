/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// Light canvas token (`themeColor.light` in src/ui/tokens, `--canvas` in tokens.css). Kept as a
// literal because the config is type-checked under nodenext, which cannot follow src/ imports.
const themeColor = { light: '#f5f2ec' } as const;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt', // never reload on our own: src/app/pwa.ts shows "Yeni sürüm hazır — yenile"
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon-180.png'],
      manifest: {
        id: '/',
        name: 'Engapp',
        short_name: 'Engapp',
        description: 'İngilizce kelimeleri aralıklı tekrarla öğren. Çevrimdışı çalışır.',
        lang: 'tr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: themeColor.light,
        theme_color: themeColor.light,
        categories: ['education'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the whole build (app shell, route chunks, fonts, icons): works offline after one visit.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // Not the pdf.js worker (1.26 MB, only for PDF import): it is cached on first use
        // below (docs/decisions/0008-pdf-worker-runtime-cache.md).
        globIgnores: ['**/pdf.worker*.mjs'],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        // Server endpoints are never answered with the app shell.
        navigateFallbackDenylist: [
          /^\/functions\//,
          /^\/rest\//,
          /^\/auth\/v1\//,
          /^\/storage\//,
          /^\/realtime\//,
        ],
        // Supabase (data, auth, edge functions incl. ai-extract / ai-enrich) is never cached.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.endsWith('.supabase.co') ||
              url.hostname.endsWith('.supabase.in') ||
              url.pathname.startsWith('/functions/v1/'),
            handler: 'NetworkOnly',
          },
          {
            // Hashed file name: CacheFirst is safe; after the first PDF import it works offline.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/assets\/pdf\.worker[^/]*\.mjs$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'engapp-pdf-worker',
              expiration: { maxEntries: 2 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
    {
      // Vendor chunks: stable, cacheable files (an app update re-downloads only app code),
      // each well under 500 KB. Feature routes are lazy chunks (src/app/router.tsx).
      name: 'engapp-chunks',
      config: () => ({
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: 'react',
                    priority: 30,
                    test: /node_modules[\\/](react|react-dom|scheduler|react-router|i18next|react-i18next)[\\/]/,
                  },
                  {
                    name: 'db',
                    priority: 20,
                    test: /node_modules[\\/](dexie|dexie-react-hooks|zod|ts-fsrs)[\\/]/,
                  },
                ],
              },
            },
          },
        },
      }),
    },
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'supabase/functions/_shared/**/*.test.ts',
      'supabase/tests/**/*.test.ts',
    ],
  },
});
