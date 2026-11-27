-- Engapp: a middle answer for "Bu metin sana nasıldı?" (decision 0085).
--
-- After "Bitirdim" the reader offered only "Çok zor" and "Çok kolay", so a text that was about
-- right had no answer. The client now also writes 'ok' ("Uygundu"), which does not move
-- settings.reading_offset. The column check must accept it, or the sync push of such a row is
-- refused. Old values stay valid; nothing is rewritten.

alter table public.user_texts drop constraint if exists user_texts_feedback_check;
alter table public.user_texts
  add constraint user_texts_feedback_check
  check (feedback is null or feedback in ('easy', 'ok', 'hard'));
