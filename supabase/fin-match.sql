-- Fin de match sans le responsable score :
--  - après la 96e minute (2 × mi-temps + 6) de la 2e période, n'importe quel compte peut arrêter le chrono ;
--    son nom est affiché dans la chronologie (« Chrono arrêté par … ») ;
--  - 2 h 15 après le coup d'envoi, un match encore en direct est clôturé automatiquement (minuteur), et le
--    responsable score (+ responsables de l'équipe) est prévenu ; il peut le rouvrir depuis « Gérer ».
-- Minuteurs : alerte-score toutes les 10 min et debut-match chaque minute le samedi et le dimanche,
-- alerte-score une fois par heure en semaine (vote homme du match du lundi, matchs en semaine).
alter table public.matches add column if not exists fin_par uuid;
alter table public.matches add column if not exists fin_par_nom text;
alter table public.matches add column if not exists fin_auto boolean not null default false;
alter table public.matches add column if not exists fin_min text;

-- match rouvert (ou fin normale par le responsable) : on oublie qui l'avait arrêté
create or replace function public.fin_match_trg() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from 'termine' then
    new.fin_par := null; new.fin_par_nom := null; new.fin_auto := false; new.fin_min := null;
  end if;
  return new;
end $$;
drop trigger if exists matches_fin on public.matches;
create trigger matches_fin before update of status on public.matches for each row execute function public.fin_match_trg();

create or replace function public.arreter_chrono(p_match uuid) returns text
language plpgsql security definer set search_path = public as $$
declare m matches; v_nom text; v_ms numeric; v_min numeric; v_lim int; v_label text;
begin
  select nom into v_nom from profiles where id = auth.uid() and role not in ('supprime');
  if not found then raise exception 'il faut un compte'; end if;
  select * into m from matches where id = p_match for update;
  if not found or m.status <> 'direct' or m.period <> 2 then raise exception 'match pas en 2e mi-temps'; end if;
  v_ms := coalesce(m.acc, 0) + case when m.running then extract(epoch from now()) * 1000 - coalesce(m.started_at, 0) else 0 end;
  v_min := v_ms / 60000.0 + coalesce(m.half, 45);       -- minute affichée
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

-- minuteur : clôture 2 h 15 après le coup d'envoi + notification au responsable score / responsables de l'équipe
create or replace function public.cloture_auto_targets(p_cle text)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text)
language plpgsql security definer set search_path = public, extensions as $$
declare m record;
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  for m in update matches x set status = 'termine', running = false,
               acc = round(coalesce(x.acc, 0) + case when x.running then extract(epoch from now()) * 1000 - coalesce(x.started_at, 0) else 0 end),
               fin_auto = true, fin_par = null, fin_par_nom = null, fin_min = null
            where x.status = 'direct' and x.kickoff < now() - interval '2 hours 15 minutes'
            returning x.id, x.equipe, x.home_name, x.away_name, x.delegue_id loop
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth,
        ('🏁 Match clôturé · ' || m.home_name || ' – ' || m.away_name)::text,
        'Il était encore en direct 2 h 15 après le coup d’envoi. S’il n’est pas fini, rouvre-le depuis « Gérer ».'::text,
        ('/#/gerer/' || m.id::text)::text
      from push_subscriptions s join profiles p on p.id = coalesce(s.user_id, s.admin_id)
      where p.id = m.delegue_id or (p.role = 'delegue' and m.equipe = any(p.equipes))
         or (p.role = 'admin' and not exists (select 1 from profiles d where d.role = 'delegue' and m.equipe = any(d.equipes)));
  end loop;
end $$;
revoke all on function public.cloture_auto_targets(text) from public;
grant execute on function public.cloture_auto_targets(text) to anon, authenticated;

-- minuteurs (la commande et sa clé restent celles du job existant, jamais affichées)
select cron.alter_job(jobid, schedule := '* * * * 0,6') from cron.job where jobname = 'debut-match';
select cron.alter_job(jobid, schedule := '*/10 * * * 0,6') from cron.job where jobname = 'alerte-score';
select cron.unschedule('alerte-score-semaine') where exists (select 1 from cron.job where jobname = 'alerte-score-semaine');
select cron.schedule('alerte-score-semaine', '0 * * * 1-5', (select command from cron.job where jobname = 'alerte-score'));
select 'ok' as fin_match;
