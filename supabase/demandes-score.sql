-- Demandes pour être « responsable score » d'un match qui n'en a pas encore.
-- Un membre (joueur, dirigeant, responsable, admin) envoie une demande ; un responsable de l'équipe ou un admin l'accepte ou la refuse.
create table if not exists public.demandes_score (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  nom text not null,
  statut text not null default 'attente' check (statut in ('attente', 'acceptee', 'refusee', 'annulee')),
  created_at timestamptz not null default now(),
  decide_par uuid references public.profiles(id) on delete set null,
  decide_at timestamptz,
  notifie_at timestamptz,
  notifie_decision_at timestamptz
);
create unique index if not exists demandes_score_une_en_attente on public.demandes_score(match_id, user_id) where statut = 'attente';
alter table public.demandes_score enable row level security;
drop policy if exists "demandes lecture" on public.demandes_score;
create policy "demandes lecture" on public.demandes_score for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from matches m where m.id = match_id and public.is_team_manager(m.equipe)));
revoke all on public.demandes_score from anon, authenticated;
grant select on public.demandes_score to authenticated;

-- Notifications : chaque abonnement retient le compte connecté (pour prévenir une personne précise)
alter table public.push_subscriptions add column if not exists user_id uuid references public.profiles(id) on delete cascade;
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_equipes int[], p_admin boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := case when p_admin and public.is_admin() then auth.uid() else null end;
begin
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'abonnement invalide';
  end if;
  p_equipes := coalesce(p_equipes, '{}');
  if cardinality(p_equipes) = 0 and v_admin is null then
    delete from push_subscriptions where endpoint = p_endpoint; return;
  end if;
  if exists (select 1 from unnest(p_equipes) e where not exists (select 1 from equipes q where q.id = e)) then raise exception 'équipe invalide'; end if;
  insert into push_subscriptions(endpoint, p256dh, auth, equipes, admin_id, user_id) values (p_endpoint, p_p256dh, p_auth, p_equipes, v_admin, auth.uid())
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, equipes = excluded.equipes, admin_id = excluded.admin_id,
    user_id = excluded.user_id, updated_at = now();
end $$;

-- Envoyer une demande
create or replace function public.demander_score(p_match uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_nom text; v_id uuid;
begin
  select nom into v_nom from profiles where id = auth.uid() and role in ('joueur', 'dirigeant', 'delegue', 'admin');
  if not found then raise exception 'réservé aux membres du club'; end if;
  if not exists (select 1 from matches where id = p_match and status <> 'termine' and delegue_id is null) then
    raise exception 'ce match a déjà un responsable score';
  end if;
  select id into v_id from demandes_score where match_id = p_match and user_id = auth.uid() and statut = 'attente';
  if v_id is not null then return v_id; end if;
  insert into demandes_score(match_id, user_id, nom) values (p_match, auth.uid(), coalesce(nullif(v_nom, ''), 'Sans nom')) returning id into v_id;
  return v_id;
end $$;

-- Retirer sa demande
create or replace function public.annuler_demande_score(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update demandes_score set statut = 'annulee' where id = p_id and user_id = auth.uid() and statut = 'attente';
end $$;

-- Accepter ou refuser (responsable de l'équipe ou admin)
create or replace function public.decider_score(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d demandes_score; v_eq int;
begin
  select * into d from demandes_score where id = p_id;
  if not found or d.statut <> 'attente' then raise exception 'demande introuvable ou déjà traitée'; end if;
  select equipe into v_eq from matches where id = d.match_id;
  if not public.is_team_manager(v_eq) then raise exception 'réservé au responsable de l''équipe ou à un admin'; end if;
  if p_ok then
    update matches set delegue_id = d.user_id, delegue_nom = d.nom where id = d.match_id and delegue_id is null and status <> 'termine';
    if not found then raise exception 'ce match a déjà un responsable score'; end if;
    update demandes_score set statut = 'acceptee', decide_par = auth.uid(), decide_at = now() where id = p_id;
    -- les autres demandes pour ce match sont refusées
    update demandes_score set statut = 'refusee', decide_par = auth.uid(), decide_at = now() where match_id = d.match_id and statut = 'attente';
  else
    update demandes_score set statut = 'refusee', decide_par = auth.uid(), decide_at = now() where id = p_id;
  end if;
end $$;

-- Destinataires de la notification liée à une demande (un seul envoi par étape) :
--   appelée par le demandeur juste après sa demande → responsables de l'équipe et admins ;
--   appelée par celui qui décide → les téléphones du demandeur (et des autres demandeurs refusés d'office).
create or replace function public.demande_notify_targets(p_id uuid)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text)
language plpgsql security definer set search_path = public as $$
declare d demandes_score; m matches; v_match text;
begin
  select * into d from demandes_score where id = p_id;
  if not found then return; end if;
  select * into m from matches where id = d.match_id;
  v_match := m.home_name || ' – ' || m.away_name || ' (' || to_char(m.kickoff at time zone 'Europe/Paris', 'DD/MM HH24"h"MI') || ')';
  if d.user_id = auth.uid() and d.statut = 'attente' and d.notifie_at is null then
    update demandes_score set notifie_at = now() where id = p_id;
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth,
        '🙋 Demande de responsable score'::text, d.nom || ' veut être responsable score de ' || v_match, '/#/match/' || m.id::text
      from push_subscriptions s join profiles p on p.id = coalesce(s.user_id, s.admin_id)
      where p.id <> d.user_id and (p.role = 'admin' or (p.role = 'delegue' and m.equipe = any(p.equipes)));
  elsif d.statut in ('acceptee', 'refusee') and d.decide_par = auth.uid() and d.notifie_decision_at is null then
    update demandes_score set notifie_decision_at = now() where match_id = d.match_id and decide_par = auth.uid() and notifie_decision_at is null and statut in ('acceptee', 'refusee');
    return query select s.endpoint, s.p256dh, s.auth,
        case when x.statut = 'acceptee' then '✅ Tu es responsable score' else '❌ Demande refusée' end,
        case when x.statut = 'acceptee' then 'C''est toi qui saisis ' || v_match else 'Ta demande pour ' || v_match || ' n''a pas été retenue' end,
        '/#/match/' || m.id::text
      from demandes_score x join push_subscriptions s on coalesce(s.user_id, s.admin_id) = x.user_id
      where x.match_id = d.match_id and x.decide_par = auth.uid() and x.decide_at >= d.decide_at - interval '5 seconds' and x.statut in ('acceptee', 'refusee');
  end if;
end $$;

revoke all on function public.demander_score(uuid) from public, anon;
revoke all on function public.annuler_demande_score(uuid) from public, anon;
revoke all on function public.decider_score(uuid, boolean) from public, anon;
revoke all on function public.demande_notify_targets(uuid) from public, anon;
grant execute on function public.demander_score(uuid) to authenticated;
grant execute on function public.annuler_demande_score(uuid) to authenticated;
grant execute on function public.decider_score(uuid, boolean) to authenticated;
grant execute on function public.demande_notify_targets(uuid) to authenticated;
select 'ok' as demandes_score;
