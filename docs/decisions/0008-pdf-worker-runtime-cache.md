# 0008 — The pdf.js worker is cached on first use, not precached

## Context

The service worker precaches the whole build so the app opens offline after one visit. The
pdf.js worker (`pdf.worker.min-*.mjs`, 1.26 MB, ~370 KB gzip) is by far the largest file and is
only needed when the user imports a PDF. Precaching it means every install and every app update
downloads it, also for users who never import a PDF (most sessions are reviews on a phone).

## Decision

- The worker is excluded from the precache (`globIgnores: ['**/pdf.worker*.mjs']`;
  `maximumFileSizeToCacheInBytes` lowered to 2 MB so no other large file slips in unnoticed).
- A runtime rule caches it with `CacheFirst` (cache `engapp-pdf-worker`, 2 entries) the first time
  a PDF is read. The file name is content-hashed, so a cached copy is never stale; the 2-entry
  limit drops old versions after updates.
- The pdf.js library itself (`pdf-*.js`, 430 KB) stays a lazy chunk loaded only by the PDF
  import panel; it is precached (small enough, and it keeps the import panel itself offline).

## Consequences

- First install/update is ~1.26 MB lighter.
- Reading a PDF needs the network the first time; after that it works offline (the AI step needs
  the network anyway; the job then waits in the queue). Offline before the first PDF, the worker
  cannot load: `extractPdfText` listens for the worker's `error` event (pdf.js itself would wait
  forever) and the panel says "PDF okuyucu indirilemedi. İlk PDF için internet bağlantısı
  gerekir…". Covered by `tests/e2e/import-pdf.spec.ts` ("pdf.js worker cache").
