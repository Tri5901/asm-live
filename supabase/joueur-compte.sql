-- Lien entre un compte et un joueur des compos (nom tel qu'écrit dans les compos) : « Mes stats », buts mis en avant.
-- La personne lie son propre compte (« C'est moi ») ; un admin peut lier ou corriger n'importe quel compte.
alter table public.profiles add column if not exists joueur text;

create or replace function public.lier_joueur(p_user uuid, p_nom text) returns text
language plpgsql security definer set search_path = public as $$
declare v text := nullif(left(regexp_replace(trim(coalesce(p_nom, '')), '\s+', ' ', 'g'), 60), '');
begin
  if auth.uid() is null or (p_user is distinct from auth.uid() and not public.is_admin()) then raise exception 'non autorisé'; end if;
  update profiles set joueur = v where id = p_user;
  return v;
end $$;
revoke all on function public.lier_joueur(uuid, text) from public, anon;
grant execute on function public.lier_joueur(uuid, text) to authenticated;
select 'ok' as joueur_compte;
