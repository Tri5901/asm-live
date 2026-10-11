-- Type de terrain (« Surface » du bloc « Détail de l'installation » de la page du match sur la FFF : pelouse naturelle,
-- synthétique…), relevé par la tâche des horaires et envoyé par scripts/verif-horaires.js (type 'surface' de maj_matchs).
alter table public.matches add column if not exists surface text;

-- ajoute le type « surface » à maj_matchs sans réécrire le reste de la fonction
do $$
declare d text;
begin
  d := pg_get_functiondef('public.maj_matchs'::regproc);
  if position('''surface''' in d) > 0 then return; end if;
  d := replace(d, $r$elsif x->>'type' = 'lieu' then$r$,
    $r$elsif x->>'type' = 'surface' then
      update matches set surface = left(x->>'surface', 60)
       where id = (x->>'id')::uuid and status = 'prevu' and coalesce(x->>'surface', '') <> '' and surface is distinct from left(x->>'surface', 60);
      get diagnostics k = row_count;
    elsif x->>'type' = 'lieu' then$r$);
  execute d;
end $$;
select position('''surface''' in pg_get_functiondef('public.maj_matchs'::regproc)) > 0 as surface_ok;
