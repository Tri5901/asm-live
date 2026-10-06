-- Désignations FFF relevées automatiquement (tâches des horaires : lundi, mercredi, vendredi) sur la page du match
-- (section « OFFICIELS ») : arbitre centre seul → 'central' ; centre + deux assistants → 'trio'.
-- Les postes du club devenus inutiles : supprimés, ou passés en 'retire' si la personne avait été prévenue ;
-- le minuteur (officiels_auto_targets) lui envoie alors « Plus besoin de toi » puis supprime la ligne.

alter table public.officiels_affect drop constraint if exists officiels_affect_statut_check;
alter table public.officiels_affect add constraint officiels_affect_statut_check check (statut in ('propose', 'confirme', 'refuse', 'retire'));
alter table public.matches add column if not exists officiels_fff_at timestamptz;

-- p_data = [{"match_id": "...", "officiels": "central" | "trio"}, ...] ; renvoie le nombre de matchs modifiés
create or replace function public.officiels_fff(p_secret text, p_data jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare x jsonb; m record; v_besoins text[]; n int := 0;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_data, '[]')) loop
    if (x->>'officiels') not in ('central', 'trio') then continue; end if;
    select * into m from matches where id = (x->>'match_id')::uuid and status = 'prevu';
    if m is null then continue; end if;
    update matches set officiels_fff_at = now() where id = m.id;
    if m.officiels is not distinct from (x->>'officiels') then continue; end if;
    update matches set officiels = x->>'officiels' where id = m.id;
    v_besoins := public.officiels_besoins(m.club_side, x->>'officiels');
    update officiels_affect set statut = 'retire', updated_at = now()
     where match_id = m.id and not (poste = any(v_besoins)) and notif_at is not null and statut in ('propose', 'confirme');
    delete from officiels_affect where match_id = m.id and not (poste = any(v_besoins)) and statut <> 'retire';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.officiels_fff(text, jsonb) from public;
grant execute on function public.officiels_fff(text, jsonb) to anon, authenticated;

-- l'écran ne montre pas les postes retirés (en attente du message « Plus besoin de toi »)
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
        'officiels_fff', m.officiels_fff_at is not null,
        'joueurs', (select coalesce(jsonb_agg(x->>'name'), '[]') from jsonb_array_elements(coalesce(m.rosters -> m.club_side, '[]')) x where x->>'name' is not null),
        'postes', (select coalesce(jsonb_agg(jsonb_build_object('poste', a.poste, 'user_id', a.user_id, 'nom', pr.nom, 'statut', a.statut, 'notif', a.notif_at is not null)), '[]')
                     from officiels_affect a left join profiles pr on pr.id = a.user_id where a.match_id = m.id and a.statut <> 'retire')
      ) order by m.kickoff), '[]')
      from matches m join equipes e on e.id = m.equipe
      where e.categorie = 'Seniors' and m.status = 'prevu'
        and (m.kickoff at time zone 'Europe/Paris')::date between p_samedi - 1 and p_samedi + 1),
    'dispos', (select coalesce(jsonb_agg(jsonb_build_object('user_id', d.user_id, 'sam', d.sam, 'dim', d.dim, 'prefs', d.prefs)), '[]')
                 from officiels_dispo d where d.samedi = p_samedi and (v_staff or d.user_id = v_moi)),
    'benevoles', case when v_staff then (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nom', p.nom, 'roles', p.officiel_roles, 'licence', p.licence, 'joueur', p.joueur,
        'saison', (select count(*) from officiels_affect a join matches mm on mm.id = a.match_id
                    where a.user_id = p.id and a.statut not in ('refuse', 'retire') and mm.kickoff >= v_saison)
      ) order by p.nom), '[]') from profiles p where cardinality(p.officiel_roles) > 0 and p.role not in ('pending', 'supprime')) end
  );
end $$;
revoke all on function public.officiels_semaine(date) from public, anon;
grant execute on function public.officiels_semaine(date) to authenticated;

-- minuteur : en plus de la relance du jeudi et du rappel de la veille, « Plus besoin de toi » pour les postes retirés par la FFF
create or replace function public.officiels_auto_targets(p_cle text)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_now timestamp := now() at time zone 'Europe/Paris'; v_sam date;
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  -- postes retirés (désignation FFF arrivée après coup)
  return query with a as (
      delete from officiels_affect a using matches m where m.id = a.match_id and a.statut = 'retire'
      returning a.user_id, a.poste, m.kickoff, m.club_side, m.home_name, m.away_name, m.equipe)
    select distinct on (s.endpoint, a.poste) s.endpoint, s.p256dh, s.auth, 'ℹ️ Plus besoin de toi'::text,
      ((select court from equipes where id = a.equipe) || ' ' || case when a.club_side = 'H' then 'contre ' || a.away_name else 'à ' || a.home_name end
        || ' (' || to_char(a.kickoff at time zone 'Europe/Paris', 'DD/MM "à" HH24"h"MI') || ') : la FFF a désigné des officiels. Merci quand même !')::text,
      '/#/officiels'::text
    from a join push_subscriptions s on coalesce(s.user_id, s.admin_id) = a.user_id;
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
          from matches m where m.id = a.match_id and a.rappel_at is null and a.statut in ('propose', 'confirme') and a.user_id is not null
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
select 'ok' as officiels_fff;
