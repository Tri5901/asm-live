-- Rôle « supporter » : mêmes droits qu'un joueur (membre du club), seulement pour les distinguer dans Accès.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending','joueur','supporter','dirigeant','delegue','admin','supprime'));

-- partout où « joueur » est accepté (is_member, list_delegues, demander_score), « supporter » l'est aussi
do $$
declare d text; f text;
begin
  foreach f in array array['is_member', 'list_delegues', 'demander_score'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f;
    if d is null or position('''supporter''' in d) > 0 then continue; end if;
    execute replace(d, '''joueur'',', '''joueur'', ''supporter'',');
  end loop;
end $$;

select string_agg(p.proname, ', ') as fonctions_avec_supporter from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc like '%''supporter''%';
