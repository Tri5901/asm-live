-- Responsable score automatique : à partir d'1 h avant le coup d'envoi (et pendant le match), s'il n'y a toujours pas de
-- responsable score, le premier membre qui le demande le devient tout de suite (sans attendre qu'on accepte).
-- Une demande déjà en attente est acceptée de la même façon si son auteur la renouvelle dans ce créneau.
-- Les admins et les responsables de l'équipe sont prévenus par une notification (demande_notify_targets).

alter table public.demandes_score add column if not exists auto boolean not null default false;

create or replace function public.demander_score(p_match uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_nom text; v_id uuid; m matches;
begin
  select nom into v_nom from profiles where id = auth.uid() and role in ('joueur', 'supporter', 'dirigeant', 'delegue', 'admin');
  if not found then raise exception 'réservé aux membres du club'; end if;
  select * into m from matches where id = p_match and status <> 'termine' and delegue_id is null;
  if not found then raise exception 'ce match a déjà un responsable score'; end if;
  v_nom := coalesce(nullif(v_nom, ''), 'Sans nom');
  select id into v_id from demandes_score where match_id = p_match and user_id = auth.uid() and statut = 'attente';
  -- moins d'1 h avant le coup d'envoi, ou match commencé : responsable score tout de suite
  if m.status <> 'prevu' or now() >= m.kickoff - interval '1 hour' then
    update matches set delegue_id = auth.uid(), delegue_nom = v_nom where id = p_match and delegue_id is null and status <> 'termine';
    if not found then raise exception 'ce match a déjà un responsable score'; end if;
    if v_id is null then
      insert into demandes_score(match_id, user_id, nom, statut, auto, decide_at) values (p_match, auth.uid(), v_nom, 'acceptee', true, now()) returning id into v_id;
    else
      update demandes_score set statut = 'acceptee', auto = true, decide_at = now(), notifie_at = null where id = v_id;
    end if;
    update demandes_score set statut = 'refusee', decide_at = now() where match_id = p_match and statut = 'attente';
    return v_id;
  end if;
  if v_id is not null then return v_id; end if;
  insert into demandes_score(match_id, user_id, nom) values (p_match, auth.uid(), v_nom) returning id into v_id;
  return v_id;
end $$;

create or replace function public.demande_notify_targets(p_id uuid)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text)
language plpgsql security definer set search_path = public as $$
declare d demandes_score; m matches; v_match text;
begin
  select * into d from demandes_score where id = p_id;
  if not found then return; end if;
  select * into m from matches where id = d.match_id;
  v_match := m.home_name || ' – ' || m.away_name || ' (' || to_char(m.kickoff at time zone 'Europe/Paris', 'DD/MM HH24"h"MI') || ')';
  if d.user_id = auth.uid() and d.auto and d.statut = 'acceptee' and d.notifie_at is null then
    -- devenu responsable score automatiquement → admins et responsables de l'équipe
    update demandes_score set notifie_at = now() where id = p_id;
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth,
        '⚡ Responsable score automatique'::text,
        d.nom || ' est devenu responsable score de ' || v_match || ' (personne à moins d''1 h du match)', '/#/match/' || m.id::text
      from push_subscriptions s join profiles p on p.id = coalesce(s.user_id, s.admin_id)
      where p.id <> d.user_id and (p.role = 'admin' or (p.role = 'delegue' and m.equipe = any(p.equipes)));
  elsif d.user_id = auth.uid() and d.statut = 'attente' and d.notifie_at is null then
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
revoke all on function public.demande_notify_targets(uuid) from public, anon;
grant execute on function public.demander_score(uuid) to authenticated;
grant execute on function public.demande_notify_targets(uuid) to authenticated;
select 'ok' as score_auto;
