// Real ArticleStore: article_consume() from migration 20261101000200_article_usage.sql
// (service role). The only thing fetch-article writes is this counter.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArticleStore } from './article.ts';

export class SupabaseArticleStore implements ArticleStore {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async consume(userId: string, limit: number) {
    const r = await this.db.rpc('article_consume', { p_user: userId, p_limit: limit });
    if (r.error) throw new Error(`article_consume: ${r.error.message}`);
    return r.data as { allowed: boolean; used: number; limit: number };
  }
}
