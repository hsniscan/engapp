// Is the signed-in user an app admin (public.app_admins via is_app_admin())? Asked once per
// user and page load; only decides whether the app shows the review entry and the admin
// shortcuts. Every admin function checks it again on the server.
import { useEffect, useState } from 'react';
import { isAppAdmin } from '@/ai/image';
import { useAuth } from '@/features/auth/session';
import { useOnline } from '@/features/import/shared';

const answers = new Map<string, Promise<boolean>>();

/** Tests only. */
export function resetAdminCache(): void {
  answers.clear();
}

export function checkAdmin(userId: string, ask: () => Promise<boolean> = () => isAppAdmin()): Promise<boolean> {
  let p = answers.get(userId);
  if (!p) {
    p = ask().catch(() => {
      answers.delete(userId); // a failed check (offline) is asked again later
      return false;
    });
    answers.set(userId, p);
  }
  return p;
}

/** true / false, or undefined while unknown (signed out, offline before the first answer). */
export function useIsAdmin(ask?: () => Promise<boolean>): boolean | undefined {
  const auth = useAuth();
  const online = useOnline();
  const userId = auth.status === 'signed_in' ? (auth.user?.id ?? null) : null;
  const [result, setResult] = useState<{ userId: string; admin: boolean } | null>(null);
  useEffect(() => {
    if (!userId || !online) return;
    let alive = true;
    void checkAdmin(userId, ask).then((admin) => {
      if (alive) setResult({ userId, admin });
    });
    return () => {
      alive = false;
    };
  }, [userId, online, ask]);
  if (!userId) return false;
  return result?.userId === userId ? result.admin : undefined;
}
