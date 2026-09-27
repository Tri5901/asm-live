-- État de l'abonnement d'un téléphone (il ne connaît que son propre "endpoint")
create or replace function public.push_status(p_endpoint text) returns int[]
language sql stable security definer set search_path = public as $$
  select equipes from push_subscriptions where endpoint = p_endpoint;
$$;
revoke all on function public.push_status(text) from public;
grant execute on function public.push_status(text) to anon, authenticated;
select 'ok' as push_status;
