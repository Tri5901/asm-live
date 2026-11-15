-- Notification « convocations sorties » personnalisée (Tristan, 15/11) : pour un téléphone abonné avec son compte connecté,
-- l'API dit en plus s'il joue (et avec quelle équipe), s'il est dirigeant, arbitre, à la touche ou à la police de terrain.
-- La base renvoie donc aussi les téléphones liés à un compte (même s'ils ne suivent pas l'équipe), avec le nom du compte et
-- le joueur lié ; « suivi » dit si le téléphone suit l'équipe. L'API ne garde un téléphone qui ne suit pas l'équipe que si la
-- personne a un rôle dans ce match.
drop function if exists public.convoc_targets(text, uuid[]);
create function public.convoc_targets(p_cle text, p_matches uuid[])
returns table(endpoint text, p256dh text, auth text, match_id uuid, suivi boolean, nom text, joueur text)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  return query with marques as (
      update matches x set convoc_notif_at = now()
       where x.id = any(p_matches) and x.convoc_notif_at is null and x.status = 'prevu'
         and x.kickoff between now() and now() + interval '4 days'
      returning x.id, x.equipe)
    select s.endpoint, s.p256dh, s.auth, mq.id, mq.equipe = any(s.equipes), p.nom, p.joueur
      from marques mq cross join push_subscriptions s
      left join profiles p on p.id = coalesce(s.user_id, s.admin_id)
     where mq.equipe = any(s.equipes) or p.id is not null;
end $$;
revoke all on function public.convoc_targets(text, uuid[]) from public;
grant execute on function public.convoc_targets(text, uuid[]) to anon, authenticated;
select 'ok' as convoc_personnelle;
