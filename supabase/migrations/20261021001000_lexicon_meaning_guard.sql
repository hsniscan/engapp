-- Engapp: semantic duplicate guard for new lexicon senses.
--
-- Reported: "invitation" got two noun senses, "a polite request to attend an event"
-- (davetiye, davet) and "a polite request to go somewhere or do something" (davet). The
-- glosses share too few words for the gloss_key / near-duplicate check, so a second sense
-- was inserted. The edge functions now also treat a sense with the same part of speech
-- and an overlapping Turkish meaning (a shared alternative: "davet" ~ "davetiye, davet")
-- as the existing sense (isSameMeaningTr in supabase/functions/_shared/text.ts).
--
-- That check runs on the senses the request read before it called the model, so two
-- concurrent requests (three chunks of one import are in flight at a time) can both
-- decide to insert. lexicon_upsert() therefore repeats it at insert time: it takes the
-- lexicon lock first (the same advisory lock the stamp trigger takes, so lexicon writers
-- are serialised; they are rare) and every statement then sees the senses committed by
-- the writer before it. Existing rows are not touched: merging shared senses that users'
-- notes point to is left to a later, reviewed step.

-- Alternatives of a Turkish meaning: "davetiye, davet" -> {davetiye, davet}.
-- Same as meaningAlternatives() in supabase/functions/_shared/text.ts.
create or replace function public.lexicon_meaning_alts(p_meaning text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(distinct a), '{}'::text[])
  from (
    select pg_catalog.btrim(pg_catalog.regexp_replace(x, '\s+', ' ', 'g'), ' .') as a
    from pg_catalog.regexp_split_to_table(pg_catalog.lower(normalize(coalesce(p_meaning, ''), NFC)), '[,;/]') as x
  ) t
  where a <> ''
$$;

revoke all on function public.lexicon_meaning_alts(text) from public, anon;
grant execute on function public.lexicon_meaning_alts(text) to authenticated, service_role;

-- p_items: [{lemma, lemma_norm, term_type, pos, gloss_en, gloss_key, meaning_tr, ipa, model}]
-- Returns, in input order: [{term_id, sense_id, term_created, sense_created}].
-- Idempotent and race-safe: a concurrent writer's row wins and its id is returned. A new
-- sense whose term already has a sense with the same pos and an overlapping Turkish
-- meaning is not inserted; the existing (oldest) one is returned instead.
create or replace function public.lexicon_upsert(p_items jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  v_term_id uuid;
  v_sense_id uuid;
  v_term_created boolean;
  v_sense_created boolean;
  out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'p_items must be an array of at most 200 items' using errcode = '22023';
  end if;

  -- Serialise lexicon writers before reading (tg_stamp_lexicon_row takes the same lock).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('engapp.lexicon', 0));

  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.lexicon_terms (lemma, lemma_norm, term_type)
    values (item ->> 'lemma', item ->> 'lemma_norm', item ->> 'term_type')
    on conflict (lemma_norm) do nothing
    returning id into v_term_id;
    v_term_created := v_term_id is not null;
    if v_term_id is null then
      select id into strict v_term_id from public.lexicon_terms where lemma_norm = item ->> 'lemma_norm';
    end if;

    v_sense_id := null;
    v_sense_created := false;
    if item ? 'gloss_key' and item ->> 'gloss_key' is not null then
      -- The same gloss_key: that row.
      select id into v_sense_id from public.lexicon_senses
      where term_id = v_term_id and pos = item ->> 'pos' and gloss_key = item ->> 'gloss_key';
      -- Else the same meaning, worded differently in English: the oldest such row.
      if v_sense_id is null then
        select s.id into v_sense_id from public.lexicon_senses s
        where s.term_id = v_term_id
          and s.pos = item ->> 'pos'
          and public.lexicon_meaning_alts(s.meaning_tr) && public.lexicon_meaning_alts(item ->> 'meaning_tr')
        order by s.created_at, s.id
        limit 1;
      end if;
      if v_sense_id is null then
        insert into public.lexicon_senses (term_id, pos, gloss_en, gloss_key, meaning_tr, ipa, created_by_model)
        values (
          v_term_id, item ->> 'pos', item ->> 'gloss_en', item ->> 'gloss_key',
          item ->> 'meaning_tr', nullif(item ->> 'ipa', ''), item ->> 'model'
        )
        on conflict (term_id, pos, gloss_key) do nothing
        returning id into v_sense_id;
        v_sense_created := v_sense_id is not null;
        if v_sense_id is null then
          select id into strict v_sense_id from public.lexicon_senses
          where term_id = v_term_id and pos = item ->> 'pos' and gloss_key = item ->> 'gloss_key';
        end if;
      end if;
    end if;

    out := out || jsonb_build_array(jsonb_build_object(
      'term_id', v_term_id,
      'sense_id', v_sense_id,
      'term_created', v_term_created,
      'sense_created', v_sense_created
    ));
  end loop;
  return out;
end;
$$;

revoke all on function public.lexicon_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.lexicon_upsert(jsonb) to service_role;
