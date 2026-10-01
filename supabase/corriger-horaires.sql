-- Correction automatique des horaires (tâche programmée « Horaires ASM » du lundi), protégée par la même clé que les classements.
-- p_data = [{"id": "<uuid du match>", "kickoff": "2027-02-07T14:00:00.000Z"}, ...] ; seuls les matchs « prévus » sont modifiés.
create or replace function public.corriger_horaires(p_secret text, p_data jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare x jsonb; n int := 0; k int;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  for x in select * from jsonb_array_elements(p_data) loop
    update matches set kickoff = (x->>'kickoff')::timestamptz
      where id = (x->>'id')::uuid and status = 'prevu' and kickoff is distinct from (x->>'kickoff')::timestamptz;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
revoke all on function public.corriger_horaires(text, jsonb) from public;
grant execute on function public.corriger_horaires(text, jsonb) to anon, authenticated;
select 'ok' as corriger_horaires;
