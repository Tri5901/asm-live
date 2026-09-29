-- Notification aux admins quand un compte est créé
alter table public.push_subscriptions add column if not exists admin_id uuid references public.profiles(id) on delete cascade;
alter table public.profiles add column if not exists signup_notified boolean not null default false;
update public.profiles set signup_notified = true where signup_notified = false;

drop function if exists public.push_subscribe(text,text,text,int[]);
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
  if exists (select 1 from unnest(p_equipes) e where e not between 1 and 5) then raise exception 'équipe invalide'; end if;
  insert into push_subscriptions(endpoint, p256dh, auth, equipes, admin_id) values (p_endpoint, p_p256dh, p_auth, p_equipes, v_admin)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, equipes = excluded.equipes, admin_id = excluded.admin_id, updated_at = now();
end $$;

drop function if exists public.push_status(text);
create or replace function public.push_status(p_endpoint text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('equipes', equipes, 'admin', admin_id is not null) from push_subscriptions where endpoint = p_endpoint;
$$;

-- Appelée une seule fois par le nouveau compte (dans les 15 min) : renvoie les téléphones des admins à prévenir
create or replace function public.signup_notify_targets()
returns table(endpoint text, p256dh text, auth text, nom text, email text)
language plpgsql security definer set search_path = public as $$
declare v_nom text; v_email text;
begin
  update profiles set signup_notified = true
   where id = auth.uid() and signup_notified = false and created_at > now() - interval '15 minutes'
   returning coalesce(nullif(profiles.nom, ''), profiles.email), profiles.email into v_nom, v_email;
  if v_email is null then return; end if;
  return query select s.endpoint, s.p256dh, s.auth, v_nom, v_email from push_subscriptions s
    join profiles p on p.id = s.admin_id where p.role = 'admin';
end $$;

revoke all on function public.push_subscribe(text,text,text,int[],boolean) from public;
revoke all on function public.push_status(text) from public;
revoke all on function public.signup_notify_targets() from public;
grant execute on function public.push_subscribe(text,text,text,int[],boolean) to anon, authenticated;
grant execute on function public.push_status(text) to anon, authenticated;
grant execute on function public.signup_notify_targets() to authenticated;
select 'ok' as notif_comptes;
