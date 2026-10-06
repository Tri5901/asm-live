-- Officiels (délégués et arbitres bénévoles) des matchs seniors.
-- Règles (validées par Tristan) : à domicile il faut toujours un délégué ; sans officiel désigné, le club qui reçoit
-- fournit le central et chaque club une touche ; central officiel → une touche ; trio officiel → rien (sauf délégué).
-- Groupe arbitres (« GrpArbitre ») : ce sont les coordinateurs qui y mettent des comptes existants (tout rôle) et choisissent
-- leurs postes possibles ; seuls les membres du groupe ont accès au sondage des dispos (personne ne s'ajoute lui-même).
-- Coordinateurs : admins et responsables (is_staff()).

-- membre du groupe arbitres = au moins un poste possible ; + numéro de licence (pour la feuille de match)
alter table public.profiles add column if not exists officiel_roles text[] not null default '{}';
alter table public.profiles add column if not exists licence text;

-- désignation FFF vue sur MyFFF : aucun / central / trio (null = valeur par défaut selon la compétition)
alter table public.matches add column if not exists officiels text check (officiels in ('aucun', 'central', 'trio'));

-- dispos du week-end (samedi du week-end), choix facultatifs { match_id: [postes] }
create table if not exists public.officiels_dispo (
  user_id uuid not null references public.profiles(id) on delete cascade,
  samedi date not null,
  sam text check (sam in ('oui', 'non')),
  dim text check (dim in ('oui', 'non')),
  prefs jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, samedi)
);
alter table public.officiels_dispo enable row level security;
revoke all on public.officiels_dispo from anon, authenticated;

-- désignations du club : un poste par match
create table if not exists public.officiels_affect (
  match_id uuid not null references public.matches(id) on delete cascade,
  poste text not null check (poste in ('delegue', 'central', 'touche')),
  user_id uuid references public.profiles(id) on delete set null,
  statut text not null default 'propose' check (statut in ('propose', 'confirme', 'refuse')),
  notif_at timestamptz,
  rappel_at timestamptz,
  par uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (match_id, poste)
);
alter table public.officiels_affect enable row level security;
revoke all on public.officiels_affect from anon, authenticated;

-- relances déjà faites (une par week-end)
create table if not exists public.officiels_relances (samedi date primary key, at timestamptz not null default now());
alter table public.officiels_relances enable row level security;
revoke all on public.officiels_relances from anon, authenticated;

-- postes à fournir pour un match
create or replace function public.officiels_besoins(p_side text, p_desig text) returns text[]
language sql immutable as $$
  select array_remove(array[
    case when p_side = 'H' then 'delegue' end,
    case when p_desig = 'aucun' and p_side = 'H' then 'central' end,
    case when p_desig in ('aucun', 'central') then 'touche' end
  ], null);
$$;
create or replace function public.officiels_desig(m public.matches) returns text
language sql stable as $$
  select coalesce(m.officiels, case when m.competition ~* '(Régional|Pays de la Loire)' then 'trio' else 'aucun' end);
$$;

-- Tout ce qu'il faut pour l'écran d'un week-end (samedi donné) :
--  - coordinateurs : matchs, postes, désignations, dispos et bénévoles (rôles, licence, nb de fois cette saison, équipe où il joue) ;
--  - les autres : matchs, postes, désignations (noms), leurs propres dispos.
create or replace function public.officiels_semaine(p_samedi date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_staff boolean := public.is_staff(); v_moi uuid := auth.uid(); v_saison date;
begin
  if v_moi is null or not (v_staff or exists (select 1 from profiles where id = v_moi and role not in ('pending', 'supprime') and cardinality(officiel_roles) > 0)) then
    raise exception 'réservé au groupe arbitres';
  end if;
  v_saison := make_date(extract(year from p_samedi)::int - case when extract(month from p_samedi) < 8 then 1 else 0 end, 8, 1);
  return jsonb_build_object(
    'staff', v_staff,
    'moi', (select jsonb_build_object('id', p.id, 'nom', p.nom, 'roles', p.officiel_roles, 'licence', p.licence, 'joueur', p.joueur) from profiles p where p.id = v_moi),
    'matchs', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'kickoff', m.kickoff, 'equipe', m.equipe, 'club_side', m.club_side, 'home_name', m.home_name, 'away_name', m.away_name,
        'competition', m.competition, 'lieu', m.lieu, 'adresse', m.adresse, 'rdv', m.rdv, 'officiels', public.officiels_desig(m), 'officiels_saisi', m.officiels is not null,
        'joueurs', (select coalesce(jsonb_agg(x->>'name'), '[]') from jsonb_array_elements(coalesce(m.rosters -> m.club_side, '[]')) x where x->>'name' is not null),
        'postes', (select coalesce(jsonb_agg(jsonb_build_object('poste', a.poste, 'user_id', a.user_id, 'nom', pr.nom, 'statut', a.statut, 'notif', a.notif_at is not null)), '[]')
                     from officiels_affect a left join profiles pr on pr.id = a.user_id where a.match_id = m.id)
      ) order by m.kickoff), '[]')
      from matches m join equipes e on e.id = m.equipe
      where e.categorie = 'Seniors' and m.status = 'prevu'
        and (m.kickoff at time zone 'Europe/Paris')::date between p_samedi - 1 and p_samedi + 1),
    'dispos', (select coalesce(jsonb_agg(jsonb_build_object('user_id', d.user_id, 'sam', d.sam, 'dim', d.dim, 'prefs', d.prefs)), '[]')
                 from officiels_dispo d where d.samedi = p_samedi and (v_staff or d.user_id = v_moi)),
    'benevoles', case when v_staff then (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nom', p.nom, 'roles', p.officiel_roles, 'licence', p.licence, 'joueur', p.joueur,
        'saison', (select count(*) from officiels_affect a join matches mm on mm.id = a.match_id
                    where a.user_id = p.id and a.statut <> 'refuse' and mm.kickoff >= v_saison)
      ) order by p.nom), '[]') from profiles p where cardinality(p.officiel_roles) > 0 and p.role not in ('pending', 'supprime')) end
  );
end $$;
revoke all on function public.officiels_semaine(date) from public, anon;
grant execute on function public.officiels_semaine(date) to authenticated;

-- mettre quelqu'un dans le groupe arbitres, changer ses postes, ou l'en retirer (p_roles vide) : coordinateurs seulement
create or replace function public.officiels_set_roles(p_user uuid, p_roles text[], p_licence text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'refusé'; end if;
  if exists (select 1 from unnest(p_roles) r where r not in ('delegue', 'central', 'touche')) then raise exception 'rôle inconnu'; end if;
  update profiles set officiel_roles = coalesce(p_roles, '{}'), licence = nullif(left(trim(coalesce(p_licence, '')), 20), '') where id = p_user;
end $$;
revoke all on function public.officiels_set_roles(uuid, text[], text) from public, anon;
grant execute on function public.officiels_set_roles(uuid, text[], text) to authenticated;

-- comptes que l'on peut ajouter au groupe (coordinateurs)
create or replace function public.officiels_comptes() returns table(id uuid, nom text, role text, roles text[], licence text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'refusé'; end if;
  return query select p.id, p.nom, p.role, p.officiel_roles, p.licence from profiles p
    where p.role not in ('pending', 'supprime') and coalesce(p.nom, '') <> '' order by p.nom;
end $$;
revoke all on function public.officiels_comptes() from public, anon;
grant execute on function public.officiels_comptes() to authenticated;

-- mes dispos du week-end
create or replace function public.officiels_set_dispo(p_samedi date, p_sam text, p_dim text, p_prefs jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and cardinality(officiel_roles) > 0) then raise exception 'refusé'; end if;
  insert into officiels_dispo (user_id, samedi, sam, dim, prefs, updated_at)
    values (auth.uid(), p_samedi, nullif(p_sam, ''), nullif(p_dim, ''), coalesce(p_prefs, '{}'), now())
  on conflict (user_id, samedi) do update set sam = excluded.sam, dim = excluded.dim, prefs = excluded.prefs, updated_at = now();
end $$;
revoke all on function public.officiels_set_dispo(date, text, text, jsonb) from public, anon;
grant execute on function public.officiels_set_dispo(date, text, text, jsonb) to authenticated;

-- désignation FFF d'un match (coordinateurs) ; les postes devenus inutiles sont retirés
create or replace function public.officiels_set_designation(p_match uuid, p_desig text) returns text[]
language plpgsql security definer set search_path = public as $$
declare m record; v_besoins text[]; v_retires text[];
begin
  if not public.is_staff() then raise exception 'refusé'; end if;
  update matches set officiels = p_desig where id = p_match returning * into m;
  v_besoins := public.officiels_besoins(m.club_side, p_desig);
  -- personnes qui étaient désignées sur un poste supprimé (pour les prévenir)
  select coalesce(array_agg(a.user_id::text), '{}') into v_retires from officiels_affect a
   where a.match_id = p_match and not (a.poste = any(v_besoins)) and a.statut <> 'refuse' and a.notif_at is not null and a.user_id is not null;
  delete from officiels_affect where match_id = p_match and not (poste = any(v_besoins));
  return v_retires;
end $$;
revoke all on function public.officiels_set_designation(uuid, text) from public, anon;
grant execute on function public.officiels_set_designation(uuid, text) to authenticated;

-- désigner quelqu'un sur un poste (null = vider) (coordinateurs)
create or replace function public.officiels_affecter(p_match uuid, p_poste text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'refusé'; end if;
  if p_user is null then delete from officiels_affect where match_id = p_match and poste = p_poste; return; end if;
  insert into officiels_affect (match_id, poste, user_id, statut, par, updated_at) values (p_match, p_poste, p_user, 'propose', auth.uid(), now())
  on conflict (match_id, poste) do update set user_id = excluded.user_id, statut = 'propose', notif_at = null, rappel_at = null, par = auth.uid(), updated_at = now()
    where officiels_affect.user_id is distinct from excluded.user_id or officiels_affect.statut = 'refuse';
end $$;
revoke all on function public.officiels_affecter(uuid, text, uuid) from public, anon;
grant execute on function public.officiels_affecter(uuid, text, uuid) to authenticated;

-- la personne désignée confirme ou refuse
create or replace function public.officiels_repondre(p_match uuid, p_poste text, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update officiels_affect set statut = case when p_ok then 'confirme' else 'refuse' end, updated_at = now()
   where match_id = p_match and poste = p_poste and user_id = auth.uid();
  if not found then raise exception 'refusé'; end if;
end $$;
revoke all on function public.officiels_repondre(uuid, text, boolean) from public, anon;
grant execute on function public.officiels_repondre(uuid, text, boolean) to authenticated;

-- Destinataires des notifications déclenchées depuis l'appli (/api/notify-officiels) :
--  'designe' : les désignés pas encore prévenus d'un match (appelé par un coordinateur) → notif_at posé ;
--  'refus'   : les coordinateurs de l'équipe (et admins) quand quelqu'un refuse (appelé par la personne) ;
--  'urgence' : les bénévoles libres capables quand l'officiel ne vient pas (appelé par un coordinateur) ;
--  'relance' : les bénévoles sans réponse pour le week-end du match (appelé par un coordinateur) ;
--  'retire'  : p_users (plus besoin d'eux) (appelé par un coordinateur).
create or replace function public.officiels_push_targets(p_match uuid, p_type text, p_users uuid[] default null)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text)
language plpgsql security definer set search_path = public as $$
declare m record; v_sam date; v_jour text; v_lib text;
begin
  select * into m from matches where id = p_match;
  if m is null then return; end if;
  v_sam := (m.kickoff at time zone 'Europe/Paris')::date + case when extract(dow from m.kickoff at time zone 'Europe/Paris') = 0 then -1 else 6 - extract(dow from m.kickoff at time zone 'Europe/Paris')::int end;
  v_jour := to_char(m.kickoff at time zone 'Europe/Paris', 'TMDay DD/MM "à" HH24"h"MI');
  v_lib := (select court from equipes where id = m.equipe) || ' ' || case when m.club_side = 'H' then 'contre ' || m.away_name else 'à ' || m.home_name end;
  if p_type = 'refus' then
    if not exists (select 1 from officiels_affect where match_id = p_match and user_id = auth.uid() and statut = 'refuse') then return; end if;
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth, '⚠️ Officiel à remplacer'::text,
        ((select nom from profiles where id = auth.uid()) || ' ne peut plus pour ' || v_lib || ' (' || v_jour || '). Touche pour trouver quelqu’un.')::text, '/#/officiels'::text
      from push_subscriptions s join profiles p on p.id = coalesce(s.user_id, s.admin_id)
      where p.role = 'admin' or (p.role = 'delegue' and m.equipe = any(p.equipes));
    return;
  end if;
  if not public.is_staff() then raise exception 'refusé'; end if;
  if p_type = 'designe' then
    return query with a as (update officiels_affect a set notif_at = now() where a.match_id = p_match and a.notif_at is null and a.statut = 'propose' and a.user_id is not null returning a.user_id, a.poste)
      select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth,
        ('📋 ' || case a.poste when 'delegue' then 'Délégué' when 'central' then 'Arbitre central' else 'Arbitre de touche' end || ' · ' || v_lib)::text,
        (v_jour || '. Touche pour confirmer ou dire si tu ne peux pas.')::text, '/#/officiels'::text
      from a join push_subscriptions s on coalesce(s.user_id, s.admin_id) = a.user_id;
  elsif p_type = 'retire' then
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth, 'ℹ️ Plus besoin de toi'::text,
        ('Pour ' || v_lib || ' (' || v_jour || ') : la FFF a désigné des officiels. Merci quand même !')::text, '/#/officiels'::text
      from push_subscriptions s where coalesce(s.user_id, s.admin_id) = any(coalesce(p_users, '{}'));
  elsif p_type = 'urgence' then
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth, '🚨 Arbitre absent : qui peut dépanner ?'::text,
        (v_lib || ' (' || v_jour || ') : l’officiel ne vient pas. Si tu peux, dis-le dans l’appli.')::text, '/#/officiels'::text
      from push_subscriptions s join profiles p on p.id = coalesce(s.user_id, s.admin_id)
      left join officiels_dispo d on d.user_id = p.id and d.samedi = v_sam
      where p.officiel_roles && array['central', 'touche'] and p.role not in ('pending', 'supprime')
        and coalesce(case when extract(dow from m.kickoff at time zone 'Europe/Paris') = 6 then d.sam else d.dim end, 'oui') <> 'non';
  elsif p_type = 'relance' then
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth, '🗳️ Tes dispos du week-end ?'::text,
        'Délégué, arbitre : dis-nous si tu es dispo ce week-end. Ça prend 10 secondes.'::text, '/#/officiels'::text
      from push_subscriptions s join profiles p on p.id = coalesce(s.user_id, s.admin_id)
      where cardinality(p.officiel_roles) > 0 and p.role not in ('pending', 'supprime')
        and not exists (select 1 from officiels_dispo d where d.user_id = p.id and d.samedi = v_sam and (d.sam is not null or d.dim is not null));
  end if;
end $$;
revoke all on function public.officiels_push_targets(uuid, text, uuid[]) from public, anon;
grant execute on function public.officiels_push_targets(uuid, text, uuid[]) to authenticated;

-- Automatique (minuteur /api/alerte-score, toutes les 10 min) :
--  - jeudi 19 h (Paris) : relance des bénévoles qui n'ont pas donné leurs dispos pour le week-end qui vient (une fois) ;
--  - la veille à 18 h : rappel aux désignés (proposés ou confirmés) du match du lendemain (une fois par poste).
create or replace function public.officiels_auto_targets(p_cle text)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_now timestamp := now() at time zone 'Europe/Paris'; v_sam date;
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  if extract(dow from v_now) = 4 and extract(hour from v_now) >= 19 then
    v_sam := v_now::date + 2;
    if exists (select 1 from matches m join equipes e on e.id = m.equipe where e.categorie = 'Seniors' and m.status = 'prevu'
                and (m.kickoff at time zone 'Europe/Paris')::date between v_sam - 1 and v_sam + 1)
       and not exists (select 1 from officiels_relances where samedi = v_sam) then
      insert into officiels_relances (samedi) values (v_sam);
      return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth, '🗳️ Tes dispos du week-end ?'::text,
          'Délégué, arbitre : dis-nous si tu es dispo ce week-end. Ça prend 10 secondes.'::text, '/#/officiels'::text
        from push_subscriptions s join profiles p on p.id = coalesce(s.user_id, s.admin_id)
        where cardinality(p.officiel_roles) > 0 and p.role not in ('pending', 'supprime')
          and not exists (select 1 from officiels_dispo d where d.user_id = p.id and d.samedi = v_sam and (d.sam is not null or d.dim is not null));
    end if;
  end if;
  if extract(hour from v_now) >= 18 then
    return query with a as (
        update officiels_affect a set rappel_at = now()
          from matches m where m.id = a.match_id and a.rappel_at is null and a.statut <> 'refuse' and a.user_id is not null
           and m.status = 'prevu' and (m.kickoff at time zone 'Europe/Paris')::date = v_now::date + 1
        returning a.user_id, a.poste, m.kickoff, m.club_side, m.home_name, m.away_name, m.lieu, m.equipe)
      select distinct on (s.endpoint, a.poste) s.endpoint, s.p256dh, s.auth,
        ('📅 Demain, tu es ' || case a.poste when 'delegue' then 'délégué' when 'central' then 'arbitre central' else 'arbitre de touche' end)::text,
        ((select court from equipes where id = a.equipe) || ' ' || case when a.club_side = 'H' then 'contre ' || a.away_name || ', à Mésanger' else 'à ' || a.home_name || coalesce(', ' || a.lieu, '') end
          || ', coup d’envoi ' || to_char(a.kickoff at time zone 'Europe/Paris', 'HH24"h"MI') || '.')::text,
        '/#/officiels'::text
      from a join push_subscriptions s on coalesce(s.user_id, s.admin_id) = a.user_id;
  end if;
end $$;
revoke all on function public.officiels_auto_targets(text) from public;
grant execute on function public.officiels_auto_targets(text) to anon, authenticated;
select 'ok' as officiels;
