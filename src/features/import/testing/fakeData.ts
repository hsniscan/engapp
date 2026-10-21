// Realistic fake AI output for tests and dev QA (no network). Not imported by app code
// except the dev-only /dev/import page. The data itself lives in fakeSpecs.ts (pure).
import { createImportJob, recordChunkResult, type ChunkResult } from '@/data';
import { hashChunk } from '@/domain/chunking';
import type { CefrLevel } from '@/domain/types';
import { FAKE_SPECS as SPECS, fakeExtractResponse } from './fakeSpecs';

export { FAKE_SPECS, fakeCandidate, fakeExtractResponse, fakeText, type Spec } from './fakeSpecs';

/** Seed a ready job with `n` candidates (dev QA and UI tests), 20 per chunk. Returns the job id. */
export async function seedReadyJob(
  n = 40,
  level: CefrLevel = 'B1',
  title = 'The Guardian — şehirler ve iklim',
): Promise<string> {
  const chunks: string[] = [];
  for (let i = 0; i < n; i += 20) {
    chunks.push(
      SPECS.slice(i, Math.min(n, i + 20))
        .map((s) => s.sentence)
        .join(' '),
    );
  }
  const job = await createImportJob({ kind: 'text', title, chunks, level });
  for (const [i, text] of chunks.entries()) {
    const res = fakeExtractResponse(text);
    const result: ChunkResult = {
      prompt_version: res.prompt_version,
      level,
      candidates: res.candidates.map((c) => ({ ...c, lexicon: { ...c.lexicon } })),
    };
    await recordChunkResult(job.id, i, await hashChunk(text), result, {
      fromLocalCache: false,
      lexiconHits: res.candidates.filter((c) => c.lexicon_hit).length,
    });
  }
  return job.id;
}
