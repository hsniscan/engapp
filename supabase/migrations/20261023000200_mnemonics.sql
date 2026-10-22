-- Engapp v0.3 İP2: Turkish mnemonics and extract-v5 false friends
-- (docs/decisions/0020-mnemonics.md).
--
-- lexicon_pair_notes (shared, 20261022000200_word_family.sql) now receives AI rows:
--   kind 'mnemonic_suggestion'  written by ai-mnemonic (prompt mnemonic-v1), one row per
--                               suggestion {type: sound|story|image, text_tr, why}, plus one
--                               marker {type: 'none'} (content_key '-none-') when the model
--                               found no good association, so the next request is free too;
--   kind 'false_friend'         written by ai-extract (prompt extract-v5) for a new sense,
--                               in the shape of the hand-written list.
-- Both are written only by the service role through lexicon_pair_notes_insert and never
-- contain user text: the request names a lexicon sense id and the model reads dictionary
-- data. What a user picks, edits, writes or rejects lives in their own user_content
-- (kind 'mnemonic') and content_feedback (target_kind 'mnemonic') rows, synced like any
-- other row of those tables (already registered, no sync change).

-- ---------------------------------------------------------------------------
-- shape of a mnemonic suggestion
-- ---------------------------------------------------------------------------

alter table public.lexicon_pair_notes add constraint lexicon_pair_notes_mnemonic_check check (
  kind <> 'mnemonic_suggestion' or (
    sense_id is not null
    and (
      content ->> 'type' = 'none'
      or (
        content ->> 'type' in ('sound', 'story', 'image')
        and jsonb_typeof(content -> 'text_tr') = 'string'
        and char_length(content ->> 'text_tr') between 1 and 300
        and (
          content -> 'why' is null
          or jsonb_typeof(content -> 'why') = 'null'
          or (jsonb_typeof(content -> 'why') = 'string' and char_length(content ->> 'why') <= 300)
        )
      )
    )
  )
);

-- Lookup by sense (ai-mnemonic, ai-extract); the unique key starts with lang_pair and kind.
create index lexicon_pair_notes_sense on public.lexicon_pair_notes (sense_id, kind)
  where sense_id is not null;

-- ---------------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------------

-- Row shape of the functions and the client (updated_at in epoch ms). model and
-- prompt_version stay on the server.
create or replace function public.lexicon_pair_note_json(n public.lexicon_pair_notes)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', n.id,
    'term_norm', n.term_norm,
    'sense_id', n.sense_id,
    'lang_pair', n.lang_pair,
    'kind', n.kind,
    'content_key', n.content_key,
    'content', n.content,
    'curated', n.curated,
    'status', n.status,
    'updated_at', (extract(epoch from n.updated_at) * 1000)::bigint
  )
$$;

revoke all on function public.lexicon_pair_note_json(public.lexicon_pair_notes) from public, anon;
grant execute on function public.lexicon_pair_note_json(public.lexicon_pair_notes) to authenticated, service_role;

-- Active notes of one kind on these senses (at most 200 ids), oldest first. ai-mnemonic and
-- ai-extract look here before they call the model; readable by signed-in users like the table.
create or replace function public.lexicon_pair_notes_find(p_sense_ids uuid[], p_kind text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.lexicon_pair_note_json(n) order by n.created_at, n.id), '[]'::jsonb)
  from public.lexicon_pair_notes n
  where n.sense_id = any (p_sense_ids[1:200])
    and n.kind = p_kind
    and n.lang_pair = 'en-tr'
    and n.status = 'active'
$$;

revoke all on function public.lexicon_pair_notes_find(uuid[], text) from public, anon;
grant execute on function public.lexicon_pair_notes_find(uuid[], text) to authenticated, service_role;

-- Service role only. p_items: [{term_norm, sense_id, lang_pair, kind, content_key, content,
-- model, prompt_version}], at most 64. AI rows only (curated = false; the hand-written list is
-- loaded by scripts/build-morphology/load-sql.ts). A note with the same (pair, kind, term,
-- sense, content key) is skipped. Returns the inserted rows, in input order.
create or replace function public.lexicon_pair_notes_insert(p_items jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  v_row public.lexicon_pair_notes;
  out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 64 then
    raise exception 'p_items must be an array of at most 64 items' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.lexicon_pair_notes
      (term_norm, sense_id, lang_pair, kind, content_key, content, curated, model, prompt_version)
    values (
      item ->> 'term_norm',
      (item ->> 'sense_id')::uuid,
      coalesce(item ->> 'lang_pair', 'en-tr'),
      item ->> 'kind',
      item ->> 'content_key',
      coalesce(item -> 'content', '{}'::jsonb),
      false,
      item ->> 'model',
      item ->> 'prompt_version'
    )
    on conflict (lang_pair, kind, term_norm, (coalesce(sense_id, '00000000-0000-0000-0000-000000000000'::uuid)), content_key)
      do nothing
    returning * into v_row;
    if found then
      out := out || jsonb_build_array(public.lexicon_pair_note_json(v_row));
    end if;
  end loop;
  return out;
end;
$$;

revoke all on function public.lexicon_pair_notes_insert(jsonb) from public, anon, authenticated;
grant execute on function public.lexicon_pair_notes_insert(jsonb) to service_role;

comment on function public.lexicon_pair_notes_insert(jsonb) is
  'AI pair notes (mnemonic suggestions, extract-v5 false friends). Service role only; never user text.';
