import { useEffect, useState } from 'react';
import { levelDataNow, loadLevelData, logError } from '@/data';
import type { LevelData } from '@/domain/level';

/**
 * The client level file; loads it on first use (one fetch per app session, then the service
 * worker's cache). null while loading or when it cannot be loaded (offline before the first
 * load): levels stored with lexicon senses still show.
 */
export function useLevelData(): LevelData | null {
  const [data, setData] = useState<LevelData | null>(levelDataNow);
  useEffect(() => {
    if (data) return;
    let live = true;
    loadLevelData()
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e: unknown) => void logError(e, 'levels.load'));
    return () => {
      live = false;
    };
  }, [data]);
  return data;
}
