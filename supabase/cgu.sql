-- Acceptation des conditions d'utilisation à la création du compte (version + date), transmise par l'inscription.
alter table public.profiles add column if not exists cgu_version text;
alter table public.profiles add column if not exists cgu_at timestamptz;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_premier boolean := not exists (select 1 from public.profiles where role = 'admin');
        v_cgu text := nullif(left(coalesce(new.raw_user_meta_data->>'cgu', ''), 20), '');
begin
  insert into public.profiles(id, email, nom, role, a_confirmer, cgu_version, cgu_at)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nom', ''),
          case when v_premier then 'admin' else 'supporter' end, not v_premier,
          v_cgu, case when v_cgu is not null then now() end);
  return new;
end $$;
select 'ok' as cgu;
