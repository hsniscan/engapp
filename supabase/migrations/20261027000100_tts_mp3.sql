-- Engapp: pre-generated pronunciation audio (docs/decisions/0042-pregenerated-tts.md).
-- The `tts` bucket now also holds MP3 files (Kokoro-82M, made by scripts/tts-pregen.ts in
-- GitHub Actions) next to the on-demand WAV files of the tts function. Only the bucket's
-- allowed types change; it stays public-read and service-role-write, with no policies.
-- Guarded like 20261024000100_tts.sql: the local test stack runs without the Storage service.

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets is missing: the tts bucket is not changed';
    return;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('tts', 'tts', true, 4194304, array['audio/wav', 'audio/mpeg'])
      on conflict (id) do update
        set public = true,
            allowed_mime_types = excluded.allowed_mime_types
    $q$;
  else
    raise notice 'storage.buckets has no allowed_mime_types column: nothing to change';
  end if;
exception
  -- Never block a deploy over the bucket: tts-pregen also widens the types (updateBucket).
  when insufficient_privilege then
    raise warning 'no privilege to change the tts bucket here: run tts-pregen to update it';
end;
$$;
