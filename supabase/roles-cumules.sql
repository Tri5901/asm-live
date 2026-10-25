-- Rôles cumulables (Tristan, 25/10) : un compte peut être à la fois admin, responsable, dirigeant, joueur, supporter
-- (ex. responsable + joueur, responsable U18 B + admin). Responsable d'une catégorie entière (ex. tous les Seniors).
-- La colonne historique « role » reste remplie (rôle principal) : tout le SQL existant qui la lit continue de marcher.
-- « equipes » contient toujours toutes les équipes gérées, celles des catégories comprises : les notifications
-- des responsables (demandes, rappels, fin de match) suivent sans rien changer.
alter table public.profiles add column if not exists roles text[] not null default '{}';
alter table public.profiles add column if not exists categories text[] not null default '{}';
alter table public.profiles add column if not exists mdp_a_changer boolean not null default false;

-- rôle principal (colonne « role ») d'après la liste des rôles
create or replace function public.role_principal(p_roles text[]) returns text
language sql immutable as $$
  select case when 'admin' = any(p_roles) then 'admin' when 'responsable' = any(p_roles) then 'delegue'
              when 'dirigeant' = any(p_roles) then 'dirigeant' when 'joueur' = any(p_roles) then 'joueur'
              when 'supporter' = any(p_roles) then 'supporter' end;
$$;
-- rôle historique → nom dans la liste des rôles
create or replace function public.role_vers_liste(p_role text) returns text
language sql immutable as $$
  select case p_role when 'delegue' then 'responsable' when 'admin' then 'admin' when 'dirigeant' then 'dirigeant'
                     when 'joueur' then 'joueur' when 'supporter' then 'supporter' end;
$$;
-- équipes des catégories gérées
create or replace function public.equipes_des_categories(p_categories text[]) returns int[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id order by id), '{}') from equipes where categorie = any(p_categories);
$$;

-- Synchro (passe après les autres déclencheurs « avant » de profiles, d'où le nom en zz) :
--  - rôles ou catégories changés : seulement par un admin (sinon remis comme avant) ; « role » suit le rôle principal ;
--  - ancien code qui change seulement « role » (ex. supporter reconnu joueur) : le rôle principal est remplacé dans la liste ;
--  - « equipes » complétées avec les équipes des catégories gérées.
create or replace function public.profiles_zz_roles() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_avant text;
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_admin() then
    new.roles := old.roles; new.categories := old.categories;
    -- seul son propre drapeau « mot de passe à changer » peut être remis à faux (mdp_change_fait)
    if new.mdp_a_changer and not old.mdp_a_changer then new.mdp_a_changer := false; end if;
  end if;
  -- compte supprimé : on n'y touche plus ; compte en attente : il le reste tant qu'aucun rôle ne lui est donné
  if new.role = 'supprime' or (new.role = 'pending' and cardinality(new.roles) = 0) then return new; end if;
  if tg_op = 'INSERT' then
    if cardinality(new.roles) = 0 then
      new.roles := array_remove(array[public.role_vers_liste(new.role),
                                      case when new.joueur is not null and new.role <> 'joueur' then 'joueur' end], null);
    end if;
  elsif new.roles is distinct from old.roles then
    null;
  elsif new.role is distinct from old.role then
    v_avant := public.role_principal(old.roles);
    new.roles := array_remove(array_remove(old.roles, v_avant), public.role_vers_liste(new.role)) || array[public.role_vers_liste(new.role)];
    new.roles := array_remove(new.roles, null);
  end if;
  if new.joueur is not null and (tg_op = 'INSERT' or old.joueur is null) and not 'joueur' = any(new.roles) then
    new.roles := new.roles || array['joueur'];
  end if;
  new.role := coalesce(public.role_principal(new.roles), new.role);
  -- responsabilités : seulement pour un admin ou un responsable
  if new.role not in ('admin', 'delegue') then new.categories := '{}'; end if;
  if cardinality(new.categories) > 0 then
    new.equipes := array(select distinct x from unnest(new.equipes || public.equipes_des_categories(new.categories)) x order by x);
  end if;
  return new;
end $$;
drop trigger if exists profiles_zz_roles on public.profiles;
create trigger profiles_zz_roles before insert or update on public.profiles
  for each row execute function public.profiles_zz_roles();

-- nouvelle équipe dans une catégorie : ses responsables de catégorie la gèrent aussitôt
create or replace function public.equipes_responsables_categorie() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles p set equipes = array(select distinct x from unnest(p.equipes || array[new.id]) x order by x)
   where new.categorie = any(p.categories) and not new.id = any(p.equipes);
  return new;
end $$;
drop trigger if exists equipes_responsables_categorie on public.equipes;
create trigger equipes_responsables_categorie after insert or update of categorie on public.equipes
  for each row execute function public.equipes_responsables_categorie();

-- remplissage depuis l'ancien rôle unique (+ joueur si un joueur est relié)
update public.profiles set roles = array_remove(array[public.role_vers_liste(role),
                                                       case when joueur is not null and role <> 'joueur' then 'joueur' end], null)
 where cardinality(roles) = 0 and role not in ('supprime', 'pending');

-- responsable d'équipe : équipes cochées ou équipes de ses catégories
create or replace function public.is_team_manager(p_equipe int) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('delegue', 'admin')
    and (p_equipe = any(p.equipes) or exists (select 1 from equipes e where e.id = p_equipe and e.categorie = any(p.categories))));
$$;

-- Fiche d'une personne pour les admins (page Accès)
create or replace function public.admin_profil(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  select jsonb_build_object(
    'id', p.id, 'nom', p.nom, 'email', p.email, 'role', p.role, 'roles', p.roles, 'equipes', p.equipes, 'categories', p.categories,
    'joueur', p.joueur, 'a_confirmer', p.a_confirmer, 'mdp_a_changer', p.mdp_a_changer, 'proprietaire', p.proprietaire,
    'inscrit_le', coalesce(u.created_at, p.created_at), 'derniere_connexion', u.last_sign_in_at, 'email_confirme', u.email_confirmed_at is not null,
    'cgu_version', p.cgu_version, 'cgu_at', p.cgu_at,
    'rs_total', (select count(*) from matches m where m.delegue_id = p.id),
    'rs_termines', (select count(*) from matches m where m.delegue_id = p.id and m.status = 'termine'),
    'rs_dernier', (select max(m.kickoff) from matches m where m.delegue_id = p.id and m.status <> 'prevu'),
    'rs_matchs', (select coalesce(jsonb_agg(x order by x->>'kickoff' desc), '[]') from (
        select jsonb_build_object('id', m.id, 'kickoff', m.kickoff, 'equipe', m.equipe, 'home_name', m.home_name, 'away_name', m.away_name, 'status', m.status) x
          from matches m where m.delegue_id = p.id order by m.kickoff desc limit 12) t),
    'demandes', (select jsonb_build_object('attente', count(*) filter (where statut = 'attente'), 'acceptee', count(*) filter (where statut = 'acceptee'),
                                           'refusee', count(*) filter (where statut = 'refusee')) from demandes_score d where d.user_id = p.id),
    'matchs_crees', (select count(*) from matches m where m.created_by = p.id),
    'compos_saisies', (select count(*) from matches m where m.rosters_by = p.id),
    'actions_saisies', (select count(*) from events e where e.created_by = p.id),
    'notifs', (select jsonb_build_object('appareils', count(*), 'equipes', coalesce((select array_agg(distinct q) from push_subscriptions s2, unnest(s2.equipes) q
                                           where s2.user_id = p.id or s2.admin_id = p.id), '{}')) from push_subscriptions s where s.user_id = p.id or s.admin_id = p.id))
    into r
    from profiles p left join auth.users u on u.id = p.id
   where p.id = p_id and p.role <> 'supprime';
  return r;
end $$;
revoke all on function public.admin_profil(uuid) from public, anon;
grant execute on function public.admin_profil(uuid) to authenticated;

-- Rôles cumulés et responsabilités d'un compte (admins)
create or replace function public.admin_roles(p_id uuid, p_roles text[], p_equipes int[], p_categories text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_roles text[]; v_cats text[];
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  v_roles := array(select distinct r from unnest(coalesce(p_roles, '{}')) r where r in ('admin', 'responsable', 'dirigeant', 'joueur', 'supporter'));
  if cardinality(v_roles) = 0 then raise exception 'au moins un rôle'; end if;
  if p_id = auth.uid() and not 'admin' = any(v_roles) then raise exception 'tu ne peux pas retirer ton propre rôle admin'; end if;
  if not 'admin' = any(v_roles) and exists (select 1 from profiles where id = p_id and role = 'admin')
     and not exists (select 1 from profiles where role = 'admin' and id <> p_id) then
    raise exception 'dernier admin';
  end if;
  v_cats := case when 'admin' = any(v_roles) or 'responsable' = any(v_roles)
                 then array(select distinct c from unnest(coalesce(p_categories, '{}')) c where exists (select 1 from equipes e where e.categorie = c)) else '{}' end;
  update profiles set roles = v_roles, categories = v_cats,
         equipes = case when 'admin' = any(v_roles) or 'responsable' = any(v_roles)
                        then array(select distinct x from unnest(coalesce(p_equipes, '{}') || public.equipes_des_categories(v_cats)) x
                                    where exists (select 1 from equipes e where e.id = x) order by x)
                        else '{}' end
   where id = p_id and role <> 'supprime';
  if not found then raise exception 'compte introuvable'; end if;
  return (select jsonb_build_object('role', role, 'roles', roles, 'equipes', equipes, 'categories', categories) from profiles where id = p_id);
end $$;
revoke all on function public.admin_roles(uuid, text[], int[], text[]) from public, anon;
grant execute on function public.admin_roles(uuid, text[], int[], text[]) to authenticated;

-- Mot de passe oublié : l'admin le remet à l'adresse e-mail (en minuscules) ; la personne doit le changer
-- à sa prochaine connexion (écran obligatoire dans l'appli)
create or replace function public.admin_reset_mdp(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  update auth.users set encrypted_password = extensions.crypt(lower(email), extensions.gen_salt('bf', 10)), updated_at = now()
   where id = p_id and coalesce(email, '') <> '';
  if not found then raise exception 'compte sans adresse e-mail'; end if;
  update profiles set mdp_a_changer = true where id = p_id;
  return true;
end $$;
revoke all on function public.admin_reset_mdp(uuid) from public, anon;
grant execute on function public.admin_reset_mdp(uuid) to authenticated;

-- La personne a choisi son nouveau mot de passe
create or replace function public.mdp_change_fait() returns boolean
language sql security definer set search_path = public as $$
  update profiles set mdp_a_changer = false where id = auth.uid() and mdp_a_changer returning true;
$$;
revoke all on function public.mdp_change_fait() from public, anon;
grant execute on function public.mdp_change_fait() to authenticated;

select count(*) filter (where cardinality(roles) > 0) as comptes_avec_roles, count(*) filter (where cardinality(roles) > 1) as roles_cumules from public.profiles;
