// Client of the graded reading library (v0.5 İP5, decision 0047): public.graded_texts read
// through PostgREST with the public key (RLS: texts that were ever approved; guests too).
// The catalogue comes in pages after the device's cursor (server_seq); a text's sentences are
// asked for once, when it is first opened. Nothing about the user is sent.
import {
  GRADED_BODY_COLUMNS,
  GRADED_CATALOG_COLUMNS,
} from '../../supabase/functions/_shared/graded-contract';
import { backendConfig, requireSupabase } from '@/lib/supabase';

/** What data/library.ts needs from the network (tests pass fakes). */
export interface GradedRemote {
  /** Rows with server_seq > after, oldest first, at most `limit` (unvalidated). */
  catalogPage(after: number, limit: number): Promise<unknown[]>;
  /** One text's body, or null when the server has no visible row (unvalidated). */
  body(id: string): Promise<unknown | null>;
}

export const supabaseGradedRemote: GradedRemote | null = backendConfig
  ? {
      async catalogPage(after, limit) {
        const { data, error } = await (await requireSupabase())
          .from('graded_texts')
          .select(GRADED_CATALOG_COLUMNS)
          .gt('server_seq', after)
          .order('server_seq', { ascending: true })
          .limit(limit);
        if (error) throw new Error(`graded_texts: ${error.message}`);
        return (data ?? []) as unknown[];
      },
      async body(id) {
        const { data, error } = await (await requireSupabase())
          .from('graded_texts')
          .select(GRADED_BODY_COLUMNS)
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error(`graded_texts: ${error.message}`);
        return (data ?? null) as unknown;
      },
    }
  : null;
