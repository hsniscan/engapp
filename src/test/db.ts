import { db } from '../data/db';

/** Empty every table (faster than deleting the database between tests). */
export async function resetDb(): Promise<void> {
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
}
