-- Statistiques du site (page admin). Mesure d'audience anonyme : chaque appareil a un identifiant tiré au hasard
-- (gardé sur le téléphone), une ligne par appareil et par jour (heure de Paris) ; le compte n'est noté que s'il est connecté.
-- Aucune adresse IP ni autre donnée.
create table if not exists public.visites (
  jour date not null,
  visiteur text not null,
  user_id uuid references public.profiles(id) on delete set null,
  ouvertures int not null default 0,
  pages int not null default 0,
  detail jsonb not null default '{}',
  primary key (jour, visiteur)
);
alter table public.visites enable row level security;
revoke all on public.visites from anon, authenticated;

-- appelé par l'appli à l'ouverture (p_ouverture) et à chaque page ; p_page = type de page (accueil, match, classements…)
create or replace function public.noter_visite(p_visiteur text, p_page text, p_ouverture boolean)
returns void language plpgsql security definer set search_path = public as $$
declare j date := (now() at time zone 'Europe/Paris')::date; pg text := left(coalesce(nullif(p_page, ''), 'accueil'), 20);
begin
  if p_visiteur !~ '^[a-z0-9-]{8,40}$' or pg !~ '^[a-z]+$' then return; end if;
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

-- chiffres pour la page admin, sur p_jours jours (aujourd'hui compris)
create or replace function public.stats_site(p_jours int default 30) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare d0 date := (now() at time zone 'Europe/Paris')::date - (least(greatest(p_jours, 7), 365) - 1); fin date := (now() at time zone 'Europe/Paris')::date;
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  return jsonb_build_object(
    'jours', (select jsonb_agg(jsonb_build_object(
        'jour', g.d,
        'visiteurs', (select count(*) from visites v where v.jour = g.d),
        'comptes', (select count(distinct v.user_id) from visites v where v.jour = g.d and v.user_id is not null),
        'ouvertures', (select coalesce(sum(v.ouvertures), 0) from visites v where v.jour = g.d),
        'pages', (select coalesce(sum(v.pages), 0) from visites v where v.jour = g.d),
        'inscriptions', (select count(*) from profiles p where (p.created_at at time zone 'Europe/Paris')::date = g.d)
      ) order by g.d) from (select x::date as d from generate_series(d0::timestamp, fin::timestamp, interval '1 day') x) g),
    'visiteurs_periode', (select count(distinct visiteur) from visites where jour >= d0),
    'comptes_periode', (select count(distinct user_id) from visites where jour >= d0 and user_id is not null),
    'debut_mesure', (select min(jour) from visites),
    'pages_vues', (select coalesce(jsonb_object_agg(k, n), '{}') from (
        select e.key as k, sum(e.value::int) as n from visites v, jsonb_each_text(v.detail) e where v.jour >= d0 group by e.key) t),
    'comptes_total', (select count(*) from profiles where role not in ('supprime')),
    'notifs_appareils', (select count(*) from push_subscriptions),
    'notifs_comptes', (select count(distinct coalesce(user_id, admin_id)) from push_subscriptions where coalesce(user_id, admin_id) is not null)
  );
end $$;
revoke all on function public.stats_site(int) from public, anon;
grant execute on function public.stats_site(int) to authenticated;
select 'ok' as stats_site;
