-- Un nouveau compte est directement « joueur » (il peut demander à être responsable score tout de suite) ;
-- les admins le confirment ensuite (ou changent son rôle, ou suppriment le compte) : profiles.a_confirmer.
alter table public.profiles add column if not exists a_confirmer boolean not null default false;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_premier boolean := not exists (select 1 from public.profiles where role = 'admin');
begin
  insert into public.profiles(id, email, nom, role, a_confirmer)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nom', ''),
          case when v_premier then 'admin' else 'joueur' end, not v_premier);
  return new;
end $$;

-- un compte ne peut pas retirer lui-même le marqueur « à confirmer » : seuls les admins (via la page Accès)
create or replace function public.profiles_a_confirmer_garde() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.a_confirmer is distinct from old.a_confirmer and auth.uid() is not null and not public.is_admin() then
    new.a_confirmer := old.a_confirmer;
  end if;
  return new;
end $$;
drop trigger if exists profiles_a_confirmer_garde on public.profiles;
create trigger profiles_a_confirmer_garde before update on public.profiles for each row execute function public.profiles_a_confirmer_garde();

select count(*) filter (where role = 'pending') as en_attente_ancien, count(*) filter (where a_confirmer) as a_confirmer from public.profiles;
