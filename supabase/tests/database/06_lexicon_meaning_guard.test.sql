-- lexicon_upsert() does not insert a second sense with the same meaning
-- (20261021001000_lexicon_meaning_guard.sql): same pos and an overlapping Turkish meaning
-- returns the existing sense, whatever the English gloss says.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select is(public.lexicon_meaning_alts('davetiye, davet'), array['davet', 'davetiye'], 'alternatives are split');
select is(public.lexicon_meaning_alts(' Nehir  kıyısı; sahil / kıyı. '), array['kıyı', 'nehir kıyısı', 'sahil'],
  'normalised like meaningAlternatives()');
select is(public.lexicon_meaning_alts(''), '{}'::text[], 'empty meaning has no alternatives');

set local role service_role;

create temporary table up1 as
select public.lexicon_upsert('[
  {"lemma":"pgtapinvitation","lemma_norm":"pgtapinvitation","term_type":"word","pos":"noun","gloss_en":"a polite request to attend an event","gloss_key":"attend event polite request","meaning_tr":"davetiye, davet","ipa":null,"model":"test"}
]'::jsonb) as res;
select is((select (res -> 0 ->> 'sense_created')::boolean from up1), true, 'first sense is created');

-- The reported duplicate: another wording, "davet".
create temporary table up2 as
select public.lexicon_upsert('[
  {"lemma":"pgtapinvitation","lemma_norm":"pgtapinvitation","term_type":"word","pos":"noun","gloss_en":"a polite request to go somewhere or do something","gloss_key":"do go polite request somewhere","meaning_tr":"davet","ipa":null,"model":"test"}
]'::jsonb) as res;
select is((select res -> 0 ->> 'sense_id' from up2), (select res -> 0 ->> 'sense_id' from up1),
  'an overlapping Turkish meaning returns the existing sense');
select is((select (res -> 0 ->> 'sense_created')::boolean from up2), false, 'and creates nothing');

-- Different meaning, or a different part of speech: a new sense.
create temporary table up3 as
select public.lexicon_upsert('[
  {"lemma":"pgtapinvitation","lemma_norm":"pgtapinvitation","term_type":"word","pos":"noun","gloss_en":"something that encourages a bad action","gloss_key":"action bad encourage","meaning_tr":"teşvik","ipa":null,"model":"test"},
  {"lemma":"pgtapinvitation","lemma_norm":"pgtapinvitation","term_type":"word","pos":"adjective","gloss_en":"for invited guests only","gloss_key":"guest invited only","meaning_tr":"davet","ipa":null,"model":"test"}
]'::jsonb) as res;
select is((select (res -> 0 ->> 'sense_created')::boolean from up3), true, 'a different meaning is a new sense');
select is((select (res -> 1 ->> 'sense_created')::boolean from up3), true, 'another part of speech is a new sense');

-- Within one call: the second item sees the first.
create temporary table up4 as
select public.lexicon_upsert('[
  {"lemma":"pgtapbank2","lemma_norm":"pgtapbank2","term_type":"word","pos":"noun","gloss_en":"the land beside a river","gloss_key":"beside land river","meaning_tr":"kıyı","ipa":null,"model":"test"},
  {"lemma":"pgtapbank2","lemma_norm":"pgtapbank2","term_type":"word","pos":"noun","gloss_en":"the edge of a lake or sea","gloss_key":"edge lake sea","meaning_tr":"kıyı, sahil","ipa":null,"model":"test"},
  {"lemma":"pgtapbank2","lemma_norm":"pgtapbank2","term_type":"word","pos":"noun","gloss_en":"an organisation that keeps money","gloss_key":"keep money organisation","meaning_tr":"banka","ipa":null,"model":"test"}
]'::jsonb) as res;
select is((select res -> 1 ->> 'sense_id' from up4), (select res -> 0 ->> 'sense_id' from up4),
  'a duplicate later in the same call reuses the earlier item');
select is((select (res -> 2 ->> 'sense_created')::boolean from up4), true, '"banka" is not "kıyı"');

-- The same gloss_key still wins over a meaning match.
select is((public.lexicon_upsert('[
  {"lemma":"pgtapbank2","lemma_norm":"pgtapbank2","term_type":"word","pos":"noun","gloss_en":"Land beside rivers.","gloss_key":"beside land river","meaning_tr":"nehir kenarı","ipa":null,"model":"test"}
]'::jsonb) -> 0 ->> 'sense_id'), (select res -> 0 ->> 'sense_id' from up4), 'same gloss_key returns that row');

select is((select count(*)::int from public.lexicon_senses s join public.lexicon_terms t on t.id = s.term_id
  where t.lemma_norm in ('pgtapinvitation', 'pgtapbank2')), 5, 'exactly five senses stored');

select * from finish();
rollback;
