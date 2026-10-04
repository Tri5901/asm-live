-- Carton blanc (exclusion temporaire) : nouvelle sorte d'action « white »
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%yellow%' loop
    execute format('alter table public.events drop constraint %I', c);
  end loop;
end $$;
alter table public.events add constraint events_k_check check (k in ('goal','sub','yellow','white','red'));
select 'ok' as carton_blanc;
