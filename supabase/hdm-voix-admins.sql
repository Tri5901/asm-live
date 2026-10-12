-- Homme du match : après la fin du vote, les admins voient aussi le nombre de voix de chaque joueur (élus et non élus)
-- (Tristan, 12/10). Les responsables voient toujours les joueurs qui ont eu des voix sans le nombre, les autres seulement l'élu.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.hdm_resultats(uuid)'::regprocedure);
  if position('select c.joueur, null::int, c.n = m.mx from c, m' in d) = 0 then raise exception 'hdm_resultats : texte inattendu'; end if;
  d := replace(d, 'select c.joueur, null::int, c.n = m.mx from c, m', 'select c.joueur, case when v_role = ''admin'' then c.n end, c.n = m.mx from c, m');
  execute d;
end $$;
select position('case when v_role = ''admin'' then c.n end' in pg_get_functiondef('public.hdm_resultats(uuid)'::regprocedure)) > 0 as voix_admins;
