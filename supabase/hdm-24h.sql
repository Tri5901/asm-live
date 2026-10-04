-- Homme du match : vote ouvert 24 h après le coup d'envoi (au lieu de 30 h) ; les voix restent secrètes
-- jusqu'à la fin du vote (hdm_resultats ne renvoie rien avant).
create or replace function public.voter_hdm(p_match uuid, p_joueur text) returns void
language plpgsql security definer set search_path = public as $$
declare m record; v_ok boolean;
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and role not in ('supprime', 'pending')) then
    raise exception 'compte requis';
  end if;
  select * into m from matches where id = p_match;
  if m is null or m.status <> 'termine' or now() > m.kickoff + interval '24 hours' then raise exception 'vote fermé'; end if;
  select exists (select 1 from jsonb_array_elements(coalesce(m.rosters -> coalesce(m.club_side, 'H'), '[]'::jsonb)) p
                  where p->>'name' = p_joueur) into v_ok;
  if not v_ok then raise exception 'joueur inconnu'; end if;
  insert into votes_hdm (match_id, user_id, joueur) values (p_match, auth.uid(), p_joueur)
    on conflict (match_id, user_id) do update set joueur = excluded.joueur, at = now();
end $$;
revoke all on function public.voter_hdm(uuid, text) from public, anon;
grant execute on function public.voter_hdm(uuid, text) to authenticated;

create or replace function public.hdm_resultats(p_match uuid) returns table(joueur text, voix int)
language sql security definer set search_path = public stable as $$
  select v.joueur, count(*)::int from votes_hdm v join matches m on m.id = v.match_id
   where v.match_id = p_match and now() > m.kickoff + interval '24 hours'
   group by v.joueur order by 2 desc, 1;
$$;
grant execute on function public.hdm_resultats(uuid) to anon, authenticated;

create or replace function public.hdm_gagnants() returns table(match_id uuid, kickoff timestamptz, equipe int, joueur text, voix int)
language sql security definer set search_path = public stable as $$
  with v as (select v.match_id, v.joueur, count(*)::int as voix from votes_hdm v group by 1, 2),
       mx as (select match_id, max(voix) as voix from v group by 1)
  select v.match_id, m.kickoff, m.equipe, v.joueur, v.voix
    from v join mx on mx.match_id = v.match_id and mx.voix = v.voix
    join matches m on m.id = v.match_id
   where now() > m.kickoff + interval '24 hours';
$$;
grant execute on function public.hdm_gagnants() to anon, authenticated;
select 'ok' as hdm_24h;
