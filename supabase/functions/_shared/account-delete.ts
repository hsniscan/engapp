// Account deletion (v0.4 İP7, docs/decisions/0035-account-deletion.md). Environment-neutral:
// the Deno entrypoint passes a Supabase-backed store, tests pass a fake.
//
// Order, each step idempotent so a retry after any failure finishes the job:
//   1. files under "<user id>/" in every Storage bucket (none exist today: the only bucket,
//      `tts`, holds shared dictionary audio named by a hash, never per user);
//   2. every row in every user-scoped table, in one transaction (delete_user_data());
//   3. the auth user itself (Admin API), which also ends every session and refresh token.
// The shared lexicon is never touched: it holds no user text and no user id.
import {
  accountDeleteRequest,
  type AccountDeleteResponse,
} from './account-delete-contract.ts';
import { ApiError } from './errors.ts';

export interface AccountDeleteStore {
  /** Removes every Storage object under "<userId>/" in every bucket; returns how many. */
  removeUserFiles(userId: string): Promise<number>;
  /** delete_user_data(userId): rows removed per table. */
  deleteUserRows(userId: string): Promise<Record<string, number>>;
  /** Deletes the auth user; 'not_found' when it no longer exists. */
  deleteAuthUser(userId: string): Promise<'deleted' | 'not_found'>;
}

export interface AccountDeleteDeps {
  userId: string;
  store: AccountDeleteStore;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runAccountDelete(
  body: unknown,
  deps: AccountDeleteDeps,
): Promise<AccountDeleteResponse> {
  const parsed = accountDeleteRequest.safeParse(body);
  if (!parsed.success) throw new ApiError('invalid_input', 'Confirmation phrase missing');
  // The id comes only from the verified token (AGENTS.md rule 5); still, never build a
  // Storage prefix from anything that is not a plain UUID.
  if (!UUID.test(deps.userId)) throw new ApiError('unauthorized', 'Invalid session');

  const files = await deps.store.removeUserFiles(deps.userId);
  const rows = await deps.store.deleteUserRows(deps.userId);
  const auth = await deps.store.deleteAuthUser(deps.userId);
  const account = auth === 'deleted' ? 'deleted' : 'already_gone';
  // Counts only: no id, no e-mail in the log.
  deps.log?.('account deleted', {
    account,
    files,
    tables: Object.keys(rows).length,
    rows: Object.values(rows).reduce((a, b) => a + b, 0),
  });
  return { deleted: true, account, rows, files };
}
