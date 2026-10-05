-- Homme du match : une fois le vote terminé, plus personne ne voit le nombre de voix (Tristan, 05/10).
--  - pendant le vote : les admins voient les voix ;
--  - après la fin : admins et responsables voient les joueurs qui ont eu des voix (du plus voté au moins voté), sans le nombre ;
--    les autres ne voient que le(s) élu(s).
-- La colonne voix vaut toujours null après la fin ; « elu » indique le ou les gagnants.
drop function if exists public.hdm_resultats(uuid);
create or replace function public.hdm_resultats(p_match uuid) returns table(joueur text, voix int, elu boolean)
language plpgsql security definer set search_path = public stable as $$
declare v_role text; v_fin boolean;
begin
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
    select c.joueur, null::int, c.n = m.mx from c, m
     where v_role in ('admin', 'delegue') or c.n = m.mx
     order by c.n desc, c.joueur;
end $$;
grant execute on function public.hdm_resultats(uuid) to anon, authenticated;

-- gagnants des votes terminés (classement de la saison) : jamais le nombre de voix
create or replace function public.hdm_gagnants() returns table(match_id uuid, kickoff timestamptz, equipe int, joueur text, voix int)
language sql security definer set search_path = public stable as $$
  with v as (select v.match_id, v.joueur, count(*)::int as voix from votes_hdm v group by 1, 2),
       mx as (select match_id, max(voix) as voix from v group by 1)
  select v.match_id, m.kickoff, m.equipe, v.joueur, null::int
    from v join mx on mx.match_id = v.match_id and mx.voix = v.voix
    join matches m on m.id = v.match_id
   where now() > m.kickoff + interval '24 hours';
$$;
grant execute on function public.hdm_gagnants() to anon, authenticated;
select 'ok' as hdm_sans_voix;
