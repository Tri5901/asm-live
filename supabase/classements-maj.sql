-- Mise à jour des classements : demande par un admin (bouton), enregistrement par la tâche programmée (clé secrète)
create table if not exists public.classements_maj (
  id int primary key default 1 check (id = 1),
  demande_at timestamptz, demande_par text, fait_at timestamptz
);
insert into public.classements_maj (id) values (1) on conflict do nothing;
alter table public.classements_maj enable row level security;
drop policy if exists "maj lecture" on public.classements_maj;
create policy "maj lecture" on public.classements_maj for select to anon, authenticated using (true);
grant select on public.classements_maj to anon, authenticated;

create table if not exists public.app_secrets (name text primary key, hash text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets values ('classements', '26d3df74d8a3ee237ec75c5dc4280c99f4790434c276f58dbd30dfaa8db95fb5')
  on conflict (name) do update set hash = excluded.hash;

create or replace function public.demander_maj_classements() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  update classements_maj set demande_at = now(),
    demande_par = (select coalesce(nullif(nom,''), email) from profiles where id = auth.uid()) where id = 1;
end $$;

create or replace function public.enregistrer_classements(p_secret text, p_data jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare k text; v jsonb; n int := 0;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  for k, v in select * from jsonb_each(p_data) loop
    if k::int not between 1 and 5 or jsonb_typeof(v->'lignes') <> 'array' or jsonb_array_length(v->'lignes') < 2 then continue; end if;
    insert into classements (equipe, competition, lignes, source, updated_at)
    values (k::int, coalesce(v->>'competition', ''), v->'lignes', v->>'source', now())
    on conflict (equipe) do update set competition = coalesce(nullif(excluded.competition, ''), classements.competition),
      lignes = excluded.lignes, source = coalesce(excluded.source, classements.source), updated_at = now();
    n := n + 1;
  end loop;
  update classements_maj set fait_at = now() where id = 1;
  return n;
end $$;
revoke all on function public.demander_maj_classements() from public;
revoke all on function public.enregistrer_classements(text, jsonb) from public;
grant execute on function public.demander_maj_classements() to authenticated;
grant execute on function public.enregistrer_classements(text, jsonb) to anon, authenticated;
select 'ok' as maj;
