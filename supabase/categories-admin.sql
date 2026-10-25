-- Catégories du club (Tristan, 25/10) : toutes les équipes du site asmfootball.fr, une page Admin « Catégories »
-- pour montrer ou cacher chaque catégorie sur tout le site, et l'option « Anonymiser » : aucun nom de joueur public
-- (compos privées en permanence, pas d'homme du match), seuls les résultats de l'équipe restent visibles.
-- La visibilité reprend la colonne existante equipes.actif.
alter table public.equipes add column if not exists anonyme boolean not null default false;

-- l'équipe U18 de la Gambardella devient « U18 A » (visibilité et anonymat inchangés)
update public.equipes set nom = 'U18 A', court = 'A' where id = 7 and nom = 'U18';

-- Loisirs : même ligne que supabase/loisirs.sql, mais cachée tant que leurs matchs SportEasy ne sont pas importés
insert into public.equipes (id, categorie, cat_ordre, ordre, nom, court, nom_club, fff_classement, actif, fff_poule, mi_temps, joueurs, exceptionnelle, niveau, anonyme)
values (8, 'Loisirs', 4, 1, 'Loisirs', 'L', 'AS Mésanger Loisirs', null, false, null, 45, 11, false, 'Loisirs', false)
on conflict (id) do nothing;

-- les autres équipes du site : cachées au départ, anonymisées (jeunes)
insert into public.equipes (id, categorie, cat_ordre, ordre, nom, court, nom_club, fff_classement, actif, fff_poule, mi_temps, joueurs, exceptionnelle, niveau, anonyme)
values
  (9,  'U18',   3,  2, 'U18 B',   'B',    'GJ Mésanger St Géréon 2', null, false, null, 45, 11, false, null, true),
  (10, 'U17',   5,  1, 'U17 A',   'A',    'AS Mésanger U17',         null, false, null, 45, 11, false, null, true),
  (11, 'U15',   6,  1, 'U15 A',   'A',    'AS Mésanger U15 A',       null, false, null, 40, 11, false, null, true),
  (12, 'U15',   6,  2, 'U15 B',   'B',    'AS Mésanger U15 B',       null, false, null, 40, 11, false, null, true),
  (13, 'U15',   6,  3, 'U15 C',   'C',    'AS Mésanger U15 C',       null, false, null, 40, 11, false, null, true),
  (14, 'U15 F', 7,  1, 'U15 F',   'U15F', 'AS Mésanger U15 F',       null, false, null, 40, 11, false, null, true),
  (15, 'U13',   8,  1, 'U13 A',   'A',    'AS Mésanger U13 A',       null, false, null, 30, 8,  false, null, true),
  (16, 'U13',   8,  2, 'U13 B',   'B',    'AS Mésanger U13 B',       null, false, null, 30, 8,  false, null, true),
  (17, 'U13',   8,  3, 'U13 C',   'C',    'AS Mésanger U13 C',       null, false, null, 30, 8,  false, null, true),
  (18, 'U13',   8,  4, 'U13 D',   'D',    'AS Mésanger U13 D',       null, false, null, 30, 8,  false, null, true),
  (19, 'U13 F', 9,  1, 'U13 F A', 'A',    'AS Mésanger U13 F A',     null, false, null, 30, 8,  false, null, true),
  (20, 'U13 F', 9,  2, 'U13 F B', 'B',    'AS Mésanger U13 F B',     null, false, null, 30, 8,  false, null, true),
  (21, 'U11',   10, 1, 'U11',     'U11',  'AS Mésanger U11',         null, false, null, 25, 8,  false, null, true),
  (22, 'U9',    11, 1, 'U9',      'U9',   'AS Mésanger U9',          null, false, null, 15, 5,  false, null, true),
  (23, 'U7',    12, 1, 'U7',      'U7',   'AS Mésanger U7',          null, false, null, 10, 4,  false, null, true)
on conflict (id) do nothing;

-- Compo privée en permanence pour une équipe anonyme (même mécanisme que la compo cachée : compos_privees,
-- lisible seulement par ceux qui gèrent le match) ; jamais rendue publique au coup d'envoi.
create or replace function public.compo_cachee_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb; vt jsonb; v_anon boolean;
begin
  if tg_op = 'UPDATE' and new.compo_cachee is distinct from old.compo_cachee
     and auth.uid() is not null and not public.is_team_manager(new.equipe) then
    raise exception 'réservé au responsable de l''équipe';
  end if;
  select coalesce(anonyme, false) into v_anon from equipes where id = new.equipe;
  -- coup d'envoi (ou résultat entré directement) : la compo cachée devient publique, sauf catégorie anonyme
  if tg_op = 'UPDATE' and new.compo_cachee and old.status = 'prevu' and new.status is distinct from 'prevu' and not coalesce(v_anon, false) then
    new.compo_cachee := false;
  end if;
  if tg_op = 'UPDATE' and coalesce(v_anon, false) then new.compo_cachee := true; end if;
  if new.compo_cachee and tg_op = 'UPDATE' then
    -- compo reçue alors qu'elle est cachée : on la range à l'abri
    if coalesce(jsonb_array_length(new.rosters->'H'), 0) + coalesce(jsonb_array_length(new.rosters->'A'), 0) > 0 then
      insert into compos_privees(match_id, rosters) values (new.id, new.rosters)
        on conflict (match_id) do update set rosters = excluded.rosters;
      new.rosters := '{"H":[],"A":[]}'::jsonb;
    end if;
    -- vue terrain : seul « on » reste public
    if new.terrain ? 'd' or new.terrain ? 'p' then
      insert into compos_privees(match_id, terrain) values (new.id, new.terrain)
        on conflict (match_id) do update set terrain = excluded.terrain;
      new.terrain := jsonb_build_object('on', coalesce((new.terrain->>'on')::boolean, false));
    end if;
    new.compo_cachee_saisie := exists (select 1 from compos_privees p where p.match_id = new.id
      and coalesce(jsonb_array_length(p.rosters->'H'), 0) + coalesce(jsonb_array_length(p.rosters->'A'), 0) > 0);
  elsif tg_op = 'UPDATE' and old.compo_cachee then
    -- on la rend publique, avec la vue terrain (activée ou non : le « on » public fait foi)
    select rosters, terrain into v, vt from compos_privees where match_id = new.id;
    if v is not null and coalesce(jsonb_array_length(new.rosters->'H'), 0) + coalesce(jsonb_array_length(new.rosters->'A'), 0) = 0 then
      new.rosters := v;
    end if;
    if vt is not null and not coalesce(new.terrain ? 'd', false) then
      new.terrain := vt || jsonb_build_object('on', coalesce((new.terrain->>'on')::boolean, (vt->>'on')::boolean, false));
    end if;
    delete from compos_privees where match_id = new.id;
    new.compo_cachee_saisie := false;
  end if;
  return new;
end $$;

-- match créé pour une équipe anonyme (avec ou sans compo) : caché tout de suite (la mise à jour passe par le déclencheur ci-dessus)
create or replace function public.anonyme_ajout_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.compo_cachee and exists (select 1 from equipes where id = new.equipe and anonyme) then
    update matches set compo_cachee = true where id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists matches_zz_anonyme_ajout on public.matches;
create trigger matches_zz_anonyme_ajout after insert on public.matches for each row execute function public.anonyme_ajout_trg();

-- Page Admin « Catégories » : montrer / cacher, anonymiser toutes les équipes d'une catégorie (null = inchangé).
-- Anonymiser range aussitôt les compos des matchs existants ; ne plus anonymiser les rend toutes publiques
-- (retour à l'état d'avant : une compo cachée exprès par un responsable avant l'anonymisation redevient visible elle aussi).
create or replace function public.admin_categorie(p_categorie text, p_visible boolean, p_anonyme boolean) returns int
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  update equipes set actif = coalesce(p_visible, actif), anonyme = coalesce(p_anonyme, anonyme) where categorie = p_categorie;
  get diagnostics k = row_count;
  if p_anonyme then
    update matches set compo_cachee = true where not compo_cachee and equipe in (select id from equipes where categorie = p_categorie);
  elsif p_anonyme is false then
    update matches set compo_cachee = false where compo_cachee and equipe in (select id from equipes where categorie = p_categorie);
  end if;
  return k;
end $$;
revoke all on function public.admin_categorie(text, boolean, boolean) from public, anon;
grant execute on function public.admin_categorie(text, boolean, boolean) to authenticated;

-- Homme du match : pas de vote pour une équipe anonyme, et aucun élu affiché
create or replace function public.voter_hdm(p_match uuid, p_joueur text) returns void
language plpgsql security definer set search_path = public as $$
declare m record; v_ok boolean;
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and role not in ('supprime', 'pending')) then
    raise exception 'compte requis';
  end if;
  select * into m from matches where id = p_match;
  if m is null or m.status <> 'termine' or now() > m.kickoff + interval '24 hours' then raise exception 'vote fermé'; end if;
  if exists (select 1 from equipes where id = m.equipe and anonyme) then raise exception 'pas de vote pour cette équipe'; end if;
  select exists (select 1 from jsonb_array_elements(coalesce(m.rosters -> coalesce(m.club_side, 'H'), '[]'::jsonb)) p
                  where p->>'name' = p_joueur) into v_ok;
  if not v_ok then raise exception 'joueur inconnu'; end if;
  insert into votes_hdm (match_id, user_id, joueur) values (p_match, auth.uid(), p_joueur)
    on conflict (match_id, user_id) do update set joueur = excluded.joueur, at = now();
end $$;

create or replace function public.hdm_gagnants() returns table(match_id uuid, kickoff timestamptz, equipe integer, joueur text, voix integer)
language sql stable security definer set search_path = public as $$
  with v as (select v.match_id, v.joueur, count(*)::int as voix from votes_hdm v group by 1, 2),
       mx as (select match_id, max(voix) as voix from v group by 1)
  select v.match_id, m.kickoff, m.equipe, v.joueur, null::int
    from v join mx on mx.match_id = v.match_id and mx.voix = v.voix
    join matches m on m.id = v.match_id
    join equipes e on e.id = m.equipe and not e.anonyme
   where now() > m.kickoff + interval '24 hours';
$$;

create or replace function public.hdm_resultats(p_match uuid) returns table(joueur text, voix integer, elu boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_fin boolean;
begin
  -- équipe anonyme : rien pour le public (ceux qui gèrent le match gardent l'accès)
  if exists (select 1 from matches x join equipes e on e.id = x.equipe where x.id = p_match and e.anonyme) and not public.can_manage(p_match) then
    return;
  end if;
  select role into v_role from profiles where id = auth.uid();
  select now() > kickoff + interval '24 hours' into v_fin from matches where id = p_match;
  if v_fin is null then return; end if;
  if not v_fin then
    if v_role = 'admin' then
      return query select v.joueur, count(*)::int, false from votes_hdm v where v.match_id = p_match group by v.joueur order by 2 desc, 1;
    end if;
    return;
  end if;
  return query
    with c as (select v.joueur, count(*)::int as n from votes_hdm v where v.match_id = p_match group by v.joueur),
         m as (select max(n) as mx from c)
    select c.joueur, case when v_role = 'admin' then c.n end, c.n = m.mx from c, m
     where v_role in ('admin', 'delegue') or c.n = m.mx
     order by c.n desc, c.joueur;
end $$;

select count(*) filter (where actif) as visibles, count(*) filter (where not actif) as cachees, count(*) filter (where anonyme) as anonymes from public.equipes;
