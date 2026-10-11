-- Tirs au but (matchs de coupe à égalité après le temps réglementaire), saisis par le responsable score.
-- matches.tab = { premier: 'H' | 'A', tirs: [{ t: 'H' | 'A', ok: bool, n: numéro du tireur }] }
-- Notifications : « 🎯 Tirs au but ! » au début, puis le vainqueur ; une seule de chaque par match.
alter table public.matches add column if not exists tab jsonb;
alter table public.matches add column if not exists tab_debut_notif_at timestamptz;
alter table public.matches add column if not exists tab_fin_notif_at timestamptz;

create or replace function public.tab_targets(p_match uuid, p_type text)
returns table(endpoint text, p256dh text, auth text) language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.can_manage(p_match) then raise exception 'réservé à ceux qui gèrent le match'; end if;
  if p_type = 'debut' then
    update matches set tab_debut_notif_at = now() where id = p_match and tab is not null and tab_debut_notif_at is null returning id into v;
  elsif p_type = 'fin' then
    update matches set tab_fin_notif_at = now() where id = p_match and tab is not null and status = 'termine' and tab_fin_notif_at is null returning id into v;
  end if;
  if v is null then return; end if;
  return query select s.endpoint, s.p256dh, s.auth from push_subscriptions s
    join matches m on m.id = v where m.equipe = any(s.equipes);
end $$;
revoke all on function public.tab_targets(uuid, text) from public, anon;
grant execute on function public.tab_targets(uuid, text) to authenticated;

-- pendant les tirs au but, personne d'autre ne peut « arrêter le chrono » (fonction de fin-match.sql)
create or replace function public.arreter_chrono(p_match uuid) returns text
language plpgsql security definer set search_path = public as $$
declare m matches; v_nom text; v_ms numeric; v_min numeric; v_lim int; v_label text;
begin
  select nom into v_nom from profiles where id = auth.uid() and role not in ('supprime');
  if not found then raise exception 'il faut un compte'; end if;
  select * into m from matches where id = p_match for update;
  if not found or m.status <> 'direct' or m.period <> 2 then raise exception 'match pas en 2e mi-temps'; end if;
  if m.tab is not null then raise exception 'tirs au but en cours'; end if;
  v_ms := coalesce(m.acc, 0) + case when m.running then extract(epoch from now()) * 1000 - coalesce(m.started_at, 0) else 0 end;
  v_min := v_ms / 60000.0 + coalesce(m.half, 45);
  v_lim := 2 * coalesce(m.half, 45) + 6;
  if v_min < v_lim then raise exception 'trop tôt'; end if;
  v_label := (2 * coalesce(m.half, 45)) || '+' || (floor(v_min)::int + 1 - 2 * coalesce(m.half, 45)) || '''';
  update matches set status = 'termine', running = false, acc = round(v_ms), fin_par = auth.uid(),
         fin_par_nom = coalesce(nullif(v_nom, ''), 'Sans nom'), fin_auto = false, fin_min = v_label
   where id = p_match;
  return v_label;
end $$;
revoke all on function public.arreter_chrono(uuid) from public, anon;
grant execute on function public.arreter_chrono(uuid) to authenticated;
select 'ok' as tirs_au_but;
