-- Changement de nom validé par un admin (Tristan, 25/10) : une fois le prénom et le nom renseignés, un compte qui
-- veut s'appeler autrement envoie une demande ; un admin l'accepte (le nom change) ou la refuse.
-- Le premier nom (inscription, nom demandé à la connexion) reste direct ; les admins changent un nom directement.

-- « Prénom Nom » complet : au moins deux mots de deux lettres (même règle que nomOk dans l'appli)
create or replace function public.nom_complet(t text) returns boolean
language sql immutable as $$
  select (select count(*) from regexp_split_to_table(public.format_nom(t), ' ') w where length(w) >= 2) >= 2;
$$;

create table if not exists public.demandes_nom (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ancien text,
  nouveau text not null,
  statut text not null default 'attente' check (statut in ('attente', 'acceptee', 'refusee', 'annulee')),
  created_at timestamptz not null default now(),
  decide_by uuid references public.profiles(id) on delete set null,
  decide_at timestamptz,
  notifie_at timestamptz
);
-- une seule demande en attente par compte (une nouvelle demande remplace l'ancienne)
create unique index if not exists demandes_nom_une_attente on public.demandes_nom(user_id) where statut = 'attente';
alter table public.demandes_nom enable row level security;
drop policy if exists "demandes_nom lecture" on public.demandes_nom;
create policy "demandes_nom lecture" on public.demandes_nom for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
revoke all on public.demandes_nom from anon, authenticated;
grant select on public.demandes_nom to authenticated;   -- les écritures passent par les fonctions ci-dessous

-- Garde-fou : le nom d'un compte ne change que s'il était encore incomplet (premier nom), par un admin,
-- par une demande acceptée (decider_nom), ou depuis l'éditeur SQL (pas de compte connecté).
-- Passe après profiles_format_nom (ordre alphabétique) : on compare des noms déjà mis en forme.
create or replace function public.profiles_nom_validation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.nom is not distinct from old.nom then return new; end if;
  if auth.uid() is null
     or coalesce(current_setting('asm.nom_valide', true), '') = '1'
     or public.is_admin()
     or not public.nom_complet(old.nom) then
    return new;
  end if;
  raise exception 'changement de nom à faire valider par un administrateur';
end $$;
drop trigger if exists profiles_nom_validation on public.profiles;
create trigger profiles_nom_validation before update of nom on public.profiles
  for each row execute function public.profiles_nom_validation();

-- Demande de changement de nom (p_nom = « Prénom Nom ») ; renvoie l'id de la demande
create or replace function public.demander_nom(p_nom text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v text; v_ancien text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  v := public.format_nom(p_nom);
  if not public.nom_complet(v) then raise exception 'prénom et nom obligatoires'; end if;
  select nom into v_ancien from profiles where id = auth.uid() and role <> 'supprime';
  if not found then raise exception 'compte introuvable'; end if;
  if v = coalesce(v_ancien, '') then raise exception 'c''est déjà ton nom'; end if;
  update demandes_nom set statut = 'annulee', decide_at = now() where user_id = auth.uid() and statut = 'attente';
  insert into demandes_nom(user_id, ancien, nouveau) values (auth.uid(), v_ancien, v) returning id into v_id;
  return v_id;
end $$;

-- Le demandeur retire sa demande en attente
create or replace function public.annuler_demande_nom() returns int
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  update demandes_nom set statut = 'annulee', decide_at = now() where user_id = auth.uid() and statut = 'attente';
  get diagnostics k = row_count;
  return k;
end $$;

-- Un admin accepte (le nom du compte change) ou refuse
create or replace function public.decider_nom(p_id uuid, p_ok boolean) returns text
language plpgsql security definer set search_path = public as $$
declare d demandes_nom;
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  select * into d from demandes_nom where id = p_id and statut = 'attente' for update;
  if not found then raise exception 'demande déjà traitée'; end if;
  update demandes_nom set statut = case when p_ok then 'acceptee' else 'refusee' end, decide_by = auth.uid(), decide_at = now()
   where id = p_id;
  if p_ok then
    perform set_config('asm.nom_valide', '1', true);
    update profiles set nom = d.nouveau where id = d.user_id and role <> 'supprime';
    perform set_config('asm.nom_valide', '', true);
  end if;
  return case when p_ok then d.nouveau else d.ancien end;
end $$;

-- Notification aux admins (api/notify-nom.js, appelé par le téléphone du demandeur) : une seule fois par demande
create or replace function public.nom_notify_targets(p_id uuid)
returns table(endpoint text, p256dh text, auth text, nom_avant text, nom_apres text)
language plpgsql security definer set search_path = public as $$
declare v_a text; v_n text;
begin
  update demandes_nom d set notifie_at = now()
   where d.id = p_id and d.user_id = auth.uid() and d.statut = 'attente' and d.notifie_at is null
   returning d.ancien, d.nouveau into v_a, v_n;
  if v_n is null then return; end if;
  return query select s.endpoint, s.p256dh, s.auth, v_a, v_n from push_subscriptions s
    join profiles p on p.id = s.admin_id where p.role = 'admin';
end $$;

revoke all on function public.demander_nom(text) from public, anon;
revoke all on function public.annuler_demande_nom() from public, anon;
revoke all on function public.decider_nom(uuid, boolean) from public, anon;
revoke all on function public.nom_notify_targets(uuid) from public, anon;
grant execute on function public.demander_nom(text) to authenticated;
grant execute on function public.annuler_demande_nom() to authenticated;
grant execute on function public.decider_nom(uuid, boolean) to authenticated;
grant execute on function public.nom_notify_targets(uuid) to authenticated;
select 'ok' as nom_validation;
