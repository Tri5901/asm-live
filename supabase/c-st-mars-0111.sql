-- Senior C, St Mars du Désert JA 2 – Mésanger C du 01/11 (match b8979c4c) : chronologie remise d'après la feuille FFF
-- (Tristan, 02/11 : « certaines rentrées sont en double »). Mésanger = A, St Mars = H.
-- Supprimées (doublons) — pour les remettre, ré-insérer ces lignes :
--   a7d5c5da-2e6e-485b-9d69-b8f562387c9a  A sub    43'  p1  sort 11 entre 11  (2e saisie du 11→11)
--   f38f1f5e-9518-4991-9316-abbd3b8ad551  H yellow 46'  p2  n 2               (= carton FFF 45' Enzo H. n°3)
--   47f765bf-d61f-41fa-a93f-f275eb85fef4  H sub    63'  p2  sort 12 entre —   (= FFF 65' Romain R. n°12 pour Tom C. n°9)
--   5ef2e1f4-023b-49ef-96fd-8efd16034ff6  H sub    66'  p2  sort 2 entre 13   (= FFF 68' Fabian E. n°13 pour Mael D. n°7)
-- Corrigées : f1c4a8a1 A sub 42' 11→11 → 38' Thylian D. (14) pour Allan D. (11) ;
--             7e842787 A sub 64' 3→— → 60' Florian G. (12) pour Corentin R. (8) ;
--             72b86c84 H but 70' sans buteur → Grégoire F. (6).
-- Ajouté : carton jaune 75' Thomas B. (9) pour Mésanger (sur la feuille, pas dans l'appli).
do $$
declare v uuid := 'b8979c4c-0156-4bde-9715-2baece05077b'; nb int; res text := '';
begin
  delete from events where match_id = v and id in ('a7d5c5da-2e6e-485b-9d69-b8f562387c9a', 'f38f1f5e-9518-4991-9316-abbd3b8ad551',
    '47f765bf-d61f-41fa-a93f-f275eb85fef4', '5ef2e1f4-023b-49ef-96fd-8efd16034ff6');
  get diagnostics nb = row_count; res := res || nb || ' supprimées';
  update events set in_n = '14', out_n = '11', min = '38''', sort = 38, p = 1 where match_id = v and id = 'f1c4a8a1-5e28-463b-960c-012b5d908e39';
  get diagnostics nb = row_count; res := res || ', ' || nb;
  update events set in_n = '12', out_n = '8', min = '60''', sort = 60, p = 2 where match_id = v and id = '7e842787-0747-400a-b776-69e2adf3fffd';
  get diagnostics nb = row_count; res := res || '+' || nb;
  update events set n = '6' where match_id = v and id = '72b86c84-b0b0-44c1-93f1-cbe38eed74e9' and n is null;
  get diagnostics nb = row_count; res := res || '+' || nb || ' corrigées';
  insert into events (id, match_id, t, k, n, min, sort, p, created_by)
  select gen_random_uuid(), v, 'A', 'yellow', '9', '75''', 75, 2, (select id from profiles where proprietaire limit 1)
  where not exists (select 1 from events where match_id = v and t = 'A' and k = 'yellow' and n = '9');
  get diagnostics nb = row_count; res := res || ', ' || nb || ' ajoutée';
  raise notice 'FAIT %', res;
end $$;
