-- Un nouveau compte est « supporter » d'office (à valider par un admin, qui choisit son rôle dans Accès).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_premier boolean := not exists (select 1 from public.profiles where role = 'admin');
begin
  insert into public.profiles(id, email, nom, role, a_confirmer)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nom', ''),
          case when v_premier then 'admin' else 'supporter' end, not v_premier);
  return new;
end $$;
select 'ok' as supporter_defaut;
