-- Feuille de match FFF déjà traitée (compo et remplacements adverses) : la tâche du dimanche ne rouvre pas la page.
alter table public.matches add column if not exists fff_feuille_at timestamptz;
create or replace function public.marquer_feuille_fff(p_secret text, p_match uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare k int;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  update matches set fff_feuille_at = now() where id = p_match and status = 'termine';
  get diagnostics k = row_count;
  return k;
end $$;
revoke all on function public.marquer_feuille_fff(text, uuid) from public;
grant execute on function public.marquer_feuille_fff(text, uuid) to anon, authenticated;
-- les matchs du 4 octobre sont déjà traités
update public.matches set fff_feuille_at = now() where status = 'termine' and kickoff >= '2026-10-03' and kickoff < '2026-10-05' and fff_match is not null;
select count(*) as deja_traites from public.matches where fff_feuille_at is not null;
