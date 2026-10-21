// The committed morphology data file (public/data/morphology-<sha>.json), for tests. Read
// through Vite so its name can change with every build.
import type { MorphologyFile } from '@/domain/morphology';
import { MORPHOLOGY_ASSET } from '@/features/family/morphologyAsset';

const files = import.meta.glob<MorphologyFile>('/public/data/morphology-*.json', { eager: true, import: 'default' });

export const morphologyFile: MorphologyFile = (() => {
  const file = files[`/public${MORPHOLOGY_ASSET.url}`];
  if (!file) throw new Error(`${MORPHOLOGY_ASSET.url} is missing: run scripts/build-morphology/index.ts`);
  return file;
})();
