// POST /functions/v1/account-delete — contract shared by the edge function and the web app
// (docs/decisions/0035-account-deletion.md).
import { z } from 'zod';

/**
 * The body must carry this exact phrase. The access token already proves who is asking; the
 * phrase makes sure only the deletion screen (after the typed confirmation) can trigger it,
 * never a stray or replayed request to the wrong endpoint.
 */
export const ACCOUNT_DELETE_CONFIRM = 'delete-my-account-and-data';

export const accountDeleteRequest = z.object({
  confirm: z.literal(ACCOUNT_DELETE_CONFIRM),
});
export type AccountDeleteRequest = z.infer<typeof accountDeleteRequest>;

export const accountDeleteResponse = z.object({
  deleted: z.literal(true),
  /** 'deleted' now, or 'already_gone' when an earlier call had removed the account. */
  account: z.enum(['deleted', 'already_gone']),
  /** Rows removed per table (tables without rows are left out). */
  rows: z.record(z.string(), z.number().int().nonnegative()),
  /** Files removed from Storage under the user's own prefix. */
  files: z.number().int().nonnegative(),
});
export type AccountDeleteResponse = z.infer<typeof accountDeleteResponse>;
