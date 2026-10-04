-- Statistiques du site sans les admins : dès qu'un admin connecté visite, son appareil (identifiant aléatoire) est exclu,
-- ses visites déjà notées (même sans être connecté) sont retirées, et plus rien n'est compté pour cet appareil.
create table if not exists public.visiteurs_exclus (visiteur text primary key, at timestamptz not null default now());
alter table public.visiteurs_exclus enable row level security;
revoke all on public.visiteurs_exclus from anon, authenticated;

create or replace function public.noter_visite(p_visiteur text, p_page text, p_ouverture boolean)
returns void language plpgsql security definer set search_path = public as $$
declare j date := (now() at time zone 'Europe/Paris')::date; pg text := left(coalesce(nullif(p_page, ''), 'accueil'), 20);
begin
  if p_visiteur !~ '^[a-z0-9-]{8,40}$' or pg !~ '^[a-z]+$' then return; end if;
  if public.is_admin() then
    insert into visiteurs_exclus (visiteur) values (p_visiteur) on conflict do nothing;
    delete from visites where visiteur = p_visiteur;
    return;
  end if;
  if exists (select 1 from visiteurs_exclus where visiteur = p_visiteur) then return; end if;
  insert into visites (jour, visiteur, user_id, ouvertures, pages, detail)
    values (j, p_visiteur, auth.uid(), case when p_ouverture then 1 else 0 end, 1, jsonb_build_object(pg, 1))
  on conflict (jour, visiteur) do update set
    user_id = coalesce(auth.uid(), visites.user_id),
    ouvertures = visites.ouvertures + case when p_ouverture then 1 else 0 end,
    pages = visites.pages + 1,
    detail = visites.detail || jsonb_build_object(pg, coalesce((visites.detail ->> pg)::int, 0) + 1)
  where visites.pages < 2000;
end $$;
revoke all on function public.noter_visite(text, text, boolean) from public;
grant execute on function public.noter_visite(text, text, boolean) to anon, authenticated;

-- nettoyage : appareils déjà vus avec un compte admin
insert into visiteurs_exclus (visiteur)
  select distinct v.visiteur from visites v join profiles p on p.id = v.user_id where p.role = 'admin'
  on conflict do nothing;
delete from visites where visiteur in (select visiteur from visiteurs_exclus);
select 'ok' as stats_sans_admins, (select count(*) from visiteurs_exclus) as appareils_exclus, (select count(*) from visites) as visites_restantes;
