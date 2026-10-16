-- Fiche « L'adversaire » des matchs de coupe : sa saison relevée sur la FFF (classement dans son championnat, derniers
-- matchs de championnat et de coupe avec le niveau des équipes jouées en coupe, son match juste avant le nôtre).
-- Remplie par la tâche des horaires avec scripts/adversaires-coupe.js (type 'adv' de maj_matchs), lue par la page du match.
alter table public.matches add column if not exists adv_infos jsonb;

-- ajoute le type « adv » à maj_matchs sans réécrire le reste de la fonction
do $$
declare d text;
begin
  d := pg_get_functiondef('public.maj_matchs'::regproc);
  if position('''adv''' in d) > 0 then return; end if;
  d := replace(d, $r$elsif x->>'type' = 'lieu' then$r$,
    $r$elsif x->>'type' = 'adv' then
      update matches set adv_infos = x->'adv_infos'
       where id = (x->>'id')::uuid and jsonb_typeof(x->'adv_infos') = 'object' and length((x->'adv_infos')::text) < 8000
         and adv_infos is distinct from x->'adv_infos';
      get diagnostics k = row_count;
    elsif x->>'type' = 'lieu' then$r$);
  execute d;
end $$;
select position('''adv''' in pg_get_functiondef('public.maj_matchs'::regproc)) > 0 as adv_ok;
