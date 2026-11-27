-- "Uygundu" (20261128000100_text_feedback_ok.sql, ADR 0085): user_texts.feedback accepts
-- 'ok' next to 'easy' and 'hard'; any other value is still rejected.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email, aud, role) values
  ('85858585-8585-4585-8585-858585858501', 'fb@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"85858585-8585-4585-8585-858585858501","role":"authenticated"}';
set local request.jwt.claim.sub to '85858585-8585-4585-8585-858585858501';
set local role authenticated;

create function pg_temp.push_text(p_hlc text, p_feedback text)
returns jsonb language sql as $$
  select public.sync_push(jsonb_build_array(jsonb_build_object('table', 'user_texts', 'op', 'upsert',
    'payload', jsonb_build_object(
      'id', '0193a000-0000-7000-8000-000000000085', 'user_id', '85858585-8585-4585-8585-858585858501',
      'kind', 'paste', 'title', 'A walk', 'body', 'I went for a walk in the park.',
      'source_url', null, 'graded_id', null, 'progress_offset', 0, 'read_ms', 0,
      'finished_at', 1761000000000, 'feedback', p_feedback,
      'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', p_hlc))))
$$;

select is(pg_temp.push_text('001761000000000:00001:deva', 'ok') -> 'acked',
  '["0193a000-0000-7000-8000-000000000085"]'::jsonb, '"ok" is accepted');
select is((select feedback from public.user_texts), 'ok', '"ok" is stored');
select is(pg_temp.push_text('001761000000000:00002:deva', 'easy') -> 'acked',
  '["0193a000-0000-7000-8000-000000000085"]'::jsonb, '"easy" is still accepted');
select is(jsonb_array_length(pg_temp.push_text('001761000000000:00003:deva', 'meh') -> 'rejected'),
  1, 'an unknown answer is rejected');

select * from finish();
rollback;
