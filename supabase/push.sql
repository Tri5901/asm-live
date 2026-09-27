-- Notifications de buts (Web Push)
-- Les abonnements ne sont lisibles par personne directement : tout passe par des fonctions contrôlées.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  equipes int[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

alter table public.events add column if not exists notified_at timestamptz;

-- Un visiteur (même sans compte) s'abonne aux buts de certaines équipes. Liste vide = désabonnement.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_equipes int[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'abonnement invalide';
  end if;
  if p_equipes is null or cardinality(p_equipes) = 0 then
    delete from push_subscriptions where endpoint = p_endpoint; return;
  end if;
  if exists (select 1 from unnest(p_equipes) e where e not between 1 and 5) then raise exception 'équipe invalide'; end if;
  insert into push_subscriptions(endpoint, p256dh, auth, equipes) values (p_endpoint, p_p256dh, p_auth, p_equipes)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, equipes = excluded.equipes, updated_at = now();
end $$;

-- Pour le serveur d'envoi : réservé aux délégués. Marque le but comme notifié (une seule fois) et renvoie les destinataires.
create or replace function public.push_targets(p_event uuid)
returns table(endpoint text, p256dh text, auth text) language plpgsql security definer set search_path = public as $$
declare v_match uuid;
begin
  if not public.is_staff() then raise exception 'réservé aux délégués'; end if;
  update events set notified_at = now() where id = p_event and k = 'goal' and notified_at is null returning match_id into v_match;
  if v_match is null then return; end if;
  return query select s.endpoint, s.p256dh, s.auth from push_subscriptions s
    join matches m on m.id = v_match where m.equipe = any(s.equipes);
end $$;

-- Nettoyage des abonnements expirés (téléphone désinstallé, autorisation retirée)
create or replace function public.push_forget(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'réservé aux délégués'; end if;
  delete from push_subscriptions where endpoint = p_endpoint;
end $$;

revoke all on function public.push_subscribe(text,text,text,int[]) from public;
revoke all on function public.push_targets(uuid) from public;
revoke all on function public.push_forget(text) from public;
grant execute on function public.push_subscribe(text,text,text,int[]) to anon, authenticated;
grant execute on function public.push_targets(uuid) to authenticated;
grant execute on function public.push_forget(text) to authenticated;
select 'ok' as notifications;
