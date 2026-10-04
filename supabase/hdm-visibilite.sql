-- Homme du match, qui voit quoi :
--  - pendant le vote : les admins voient les voix ; personne d'autre ;
--  - après la fin (coup d'envoi + 24 h) : admins et responsables voient tous les joueurs votés et leurs voix ;
--    les autres ne voient que le(s) gagnant(s), sans le nombre de voix (voix = null).
create or replace function public.hdm_resultats(p_match uuid) returns table(joueur text, voix int)
language plpgsql security definer set search_path = public stable as $$
declare v_role text; v_fin boolean;
begin
  select role into v_role from profiles where id = auth.uid();
  select now() > kickoff + interval '24 hours' into v_fin from matches where id = p_match;
  if v_fin is null then return; end if;
  if v_role = 'admin' or (v_fin and v_role = 'delegue') then
    return query select v.joueur, count(*)::int from votes_hdm v where v.match_id = p_match group by v.joueur order by 2 desc, 1;
  elsif v_fin then
    return query with c as (select v.joueur, count(*)::int as n from votes_hdm v where v.match_id = p_match group by v.joueur)
      select c.joueur, null::int from c where c.n = (select max(n) from c) order by 1;
  end if;
end $$;
grant execute on function public.hdm_resultats(uuid) to anon, authenticated;

-- gagnants des votes terminés (classement de la saison) : le nombre de voix seulement pour admins et responsables
create or replace function public.hdm_gagnants() returns table(match_id uuid, kickoff timestamptz, equipe int, joueur text, voix int)
language sql security definer set search_path = public stable as $$
  with v as (select v.match_id, v.joueur, count(*)::int as voix from votes_hdm v group by 1, 2),
       mx as (select match_id, max(voix) as voix from v group by 1)
  select v.match_id, m.kickoff, m.equipe, v.joueur,
         case when exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'delegue')) then v.voix end
    from v join mx on mx.match_id = v.match_id and mx.voix = v.voix
    join matches m on m.id = v.match_id
   where now() > m.kickoff + interval '24 hours';
$$;
grant execute on function public.hdm_gagnants() to anon, authenticated;
select 'ok' as hdm_visibilite;
