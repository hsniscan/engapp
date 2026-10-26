/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Light canvas token (`themeColor.light` in src/ui/tokens, `--canvas` in tokens.css). Kept as a
// literal because the config is type-checked under nodenext, which cannot follow src/ imports.
const themeColor = { light: '#f5f2ec' } as const;

/**
 * "Fotoğraftan metin" on the web (docs/decisions/0045-ocr.md): tesseract.js loads its worker,
 * its wasm core and the English model by URL. They are served from our own origin under
 * `/ocr/<tesseract.js version>/` (fixed names: tesseract picks the core file by name), never
 * from a CDN. Copied from node_modules at build time and served the same way in dev. The
 * Android app does not package them (`!<dir>ocr` in android/app/build.gradle; it uses ML Kit).
 */
function ocrAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const tessDir = dirname(require.resolve('tesseract.js/package.json'));
  const tessVersion = (
    JSON.parse(readFileSync(join(tessDir, 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  const coreDir = dirname(
    createRequire(join(tessDir, 'package.json')).resolve('tesseract.js-core/package.json'),
  );
  const dataDir = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
  const base = `ocr/${tessVersion}/`;
  const files: Record<string, string> = {
    [`${base}worker.min.js`]: join(tessDir, 'dist/worker.min.js'),
    // LSTM-only cores (no legacy engine); the worker picks one by the browser's SIMD support.
    [`${base}tesseract-core-lstm.wasm.js`]: join(coreDir, 'tesseract-core-lstm.wasm.js'),
    [`${base}tesseract-core-simd-lstm.wasm.js`]: join(coreDir, 'tesseract-core-simd-lstm.wasm.js'),
    [`${base}tesseract-core-relaxedsimd-lstm.wasm.js`]: join(
      coreDir,
      'tesseract-core-relaxedsimd-lstm.wasm.js',
    ),
    // English only, the integerised "best" LSTM model (tessdata_best_int, Apache-2.0), 2.9 MB.
    [`${base}eng.traineddata.gz`]: join(dataDir, '4.0.0_best_int/eng.traineddata.gz'),
  };
  return {
    name: 'engapp-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
        const src = files[path];
        if (!src) return next();
        res.setHeader(
          'Content-Type',
          path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
        );
        res.end(readFileSync(src));
      });
    },
    generateBundle() {
      for (const [fileName, src] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(src) });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ocrAssets(),
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
        // "Paylaş → Engapp" for the installed web app (Android Chrome): /share?title&text&url,
        // the same page the Android app opens (docs/decisions/0034-share-target.md).
        share_target: {
          action: '/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
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
        // below (docs/decisions/0008-pdf-worker-runtime-cache.md). The word-level file (.tsv) is
        // not matched either and is cached on first use as well (0012).
        // Nor the OCR engine (/ocr/, ~7 MB, web photo flow only, decision 0045): cached on first use.
        globIgnores: ['**/pdf.worker*.mjs', 'ocr/**'],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Web Push: `push` and `notificationclick` handlers (public/push-sw.js, decision 0024).
        importScripts: ['/push-sw.js'],
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
          {
            // SQLite (sql.js) wasm for the Anki import (~650 KB): not precached (globPatterns has
            // no .wasm), cached on the first Anki import, then offline (decision 0019).
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/assets\/sql-wasm[^/]*\.wasm$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'engapp-anki-reader',
              expiration: { maxEntries: 2 },
            },
          },
          {
            // tesseract.js worker, core and English model (decision 0045): versioned path, so
            // CacheFirst is safe; after the first photo the web OCR works offline.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/ocr/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'engapp-ocr',
              expiration: { maxEntries: 8 },
            },
          },
          {
            // Word-level file (data/levels/client-levels.tsv, ~160 KB compressed): fetched when a
            // screen first shows levels, then offline (docs/decisions/0012-word-levels.md).
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/assets\/client-levels-[^/]*\.tsv$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'engapp-levels',
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
      'scripts/**/*.test.ts',
    ],
  },
});
