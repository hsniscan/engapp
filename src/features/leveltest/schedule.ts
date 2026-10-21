// The weekly level update (domain/levelUpdate.ts) runs on the device: shortly after start-up
// and then hourly, never during a review. runWeeklyLevelUpdate() itself does the work at most
// once per local week; the other calls return at once.
import { logError, runWeeklyLevelUpdate } from '@/data';
import { requestSync } from '@/sync';

const HOUR = 60 * 60_000;

export function scheduleWeeklyLevelUpdate(isBusy: () => boolean, delayMs = 20_000): void {
  const attempt = () => {
    if (isBusy()) {
      setTimeout(attempt, 60_000);
      return;
    }
    runWeeklyLevelUpdate()
      .then((outcome) => {
        if (outcome?.status === 'changed') requestSync(0);
      })
      .catch((e: unknown) => void logError(e, 'level.weekly'))
      .finally(() => setTimeout(attempt, HOUR));
  };
  // After the start-up sync, so the decision sees what other devices recorded.
  setTimeout(attempt, delayMs);
}
