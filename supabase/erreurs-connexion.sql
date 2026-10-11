-- Suivi des erreurs sur la page de connexion / création de compte (pour comprendre un blocage signalé).
-- Rien de personnel : le type d'action, le message d'erreur et le navigateur. Lisible seulement depuis le SQL Editor.
create table if not exists public.erreurs_connexion (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null,
  message text,
  navigateur text
);
alter table public.erreurs_connexion enable row level security;
revoke all on public.erreurs_connexion from anon, authenticated;

create or replace function public.noter_erreur_connexion(p_action text, p_message text, p_navigateur text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- garde-fous : textes courts, 300 lignes par jour au plus
  if (select count(*) from erreurs_connexion where at > now() - interval '1 day') >= 300 then return; end if;
  insert into erreurs_connexion(action, message, navigateur)
    values (left(coalesce(p_action, '?'), 20), left(p_message, 300), left(p_navigateur, 200));
  delete from erreurs_connexion where at < now() - interval '60 days';
end $$;
revoke all on function public.noter_erreur_connexion(text, text, text) from public;
grant execute on function public.noter_erreur_connexion(text, text, text) to anon, authenticated;
select 'ok' as erreurs_connexion;
