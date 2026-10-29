-- Admin › Catégories : interrupteur « Stats du club » (Tristan, 29/10). Une catégorie coupée ne compte plus dans
-- « Tout le club » de la page Stats ; ses stats restent visibles en choisissant la catégorie.
alter table public.equipes add column if not exists stats_club boolean not null default true;

-- même fonction qu'avant, avec un 4e réglage (facultatif : l'ancienne appli l'appelle encore avec trois)
drop function if exists public.admin_categorie(text, boolean, boolean);
create or replace function public.admin_categorie(p_categorie text, p_visible boolean, p_anonyme boolean, p_stats boolean default null) returns int
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  update equipes set actif = coalesce(p_visible, actif), anonyme = coalesce(p_anonyme, anonyme), stats_club = coalesce(p_stats, stats_club)
   where categorie = p_categorie;
  get diagnostics k = row_count;
  if p_anonyme then
    update matches set compo_cachee = true where not compo_cachee and equipe in (select id from equipes where categorie = p_categorie);
  elsif p_anonyme is false then
    update matches set compo_cachee = false where compo_cachee and equipe in (select id from equipes where categorie = p_categorie);
  end if;
  return k;
end $$;
revoke all on function public.admin_categorie(text, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_categorie(text, boolean, boolean, boolean) to authenticated;
select categorie, bool_and(stats_club) as stats_club from public.equipes group by categorie, cat_ordre order by cat_ordre;
