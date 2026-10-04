-- Homme du match : vote des comptes (un vote par compte et par match, modifiable), ouvert après le match jusqu'à
-- 30 h après le coup d'envoi. On vote pour un joueur de notre compo qui a joué. Résultats visibles par tous.
create table if not exists public.votes_hdm (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joueur text not null,
  at timestamptz not null default now(),
  primary key (match_id, user_id)
);
alter table public.votes_hdm enable row level security;
drop policy if exists "votes hdm les miens" on public.votes_hdm;
create policy "votes hdm les miens" on public.votes_hdm for select to authenticated using (user_id = auth.uid());
revoke all on public.votes_hdm from anon, authenticated;
grant select on public.votes_hdm to authenticated;

create or replace function public.voter_hdm(p_match uuid, p_joueur text) returns void
language plpgsql security definer set search_path = public as $$
declare m record; v_ok boolean;
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and role not in ('supprime', 'pending')) then
    raise exception 'compte requis';
  end if;
  select * into m from matches where id = p_match;
  if m is null or m.status <> 'termine' or now() > m.kickoff + interval '30 hours' then raise exception 'vote fermé'; end if;
  select exists (select 1 from jsonb_array_elements(coalesce(m.rosters -> coalesce(m.club_side, 'H'), '[]'::jsonb)) p
                  where p->>'name' = p_joueur) into v_ok;
  if not v_ok then raise exception 'joueur inconnu'; end if;
  insert into votes_hdm (match_id, user_id, joueur) values (p_match, auth.uid(), p_joueur)
    on conflict (match_id, user_id) do update set joueur = excluded.joueur, at = now();
end $$;
revoke all on function public.voter_hdm(uuid, text) from public, anon;
grant execute on function public.voter_hdm(uuid, text) to authenticated;

-- voix par joueur pour un match (public, sans savoir qui a voté)
create or replace function public.hdm_resultats(p_match uuid) returns table(joueur text, voix int)
language sql security definer set search_path = public stable as $$
  select joueur, count(*)::int from votes_hdm where match_id = p_match group by joueur order by 2 desc, 1;
$$;
grant execute on function public.hdm_resultats(uuid) to anon, authenticated;

-- gagnants des votes terminés (pour le classement de la saison) ; à égalité, tous les joueurs à égalité
create or replace function public.hdm_gagnants() returns table(match_id uuid, kickoff timestamptz, equipe int, joueur text, voix int)
language sql security definer set search_path = public stable as $$
  with v as (select v.match_id, v.joueur, count(*)::int as voix from votes_hdm v group by 1, 2),
       mx as (select match_id, max(voix) as voix from v group by 1)
  select v.match_id, m.kickoff, m.equipe, v.joueur, v.voix
    from v join mx on mx.match_id = v.match_id and mx.voix = v.voix
    join matches m on m.id = v.match_id
   where now() > m.kickoff + interval '30 hours';
$$;
grant execute on function public.hdm_gagnants() to anon, authenticated;

-- Sauvegarde de la base (tâche programmée du PC, clé des classements) : tout le contenu utile en un JSON
create or replace function public.export_sauvegarde(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  return jsonb_build_object(
    'date', now(),
    'equipes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from equipes x),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from profiles x),
    'matches', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from matches x),
    'events', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from events x),
    'compos_privees', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from compos_privees x),
    'classements', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from classements x),
    'demandes_score', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from demandes_score x),
    'votes_hdm', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from votes_hdm x),
    'historique', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from historique x)
  );
end $$;
revoke all on function public.export_sauvegarde(text) from public;
grant execute on function public.export_sauvegarde(text) to anon, authenticated;
select 'ok' as homme_du_match;
