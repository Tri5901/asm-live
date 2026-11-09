-- Senior C, Mésanger C – Nantes La Mellinet 3 du 08/11 (match dc5454eb) : accord de Tristan le 09/11, d'après la feuille FFF.
-- Mésanger = H, Nantes = A. Score 0-2 dans l'appli, 0-3 sur la feuille.
-- Ajouté : but 89' Vyns D. (n°3) pour Nantes, marqué « déjà notifié » pour ne déclencher aucune notification.
-- Supprimé : carton rouge 78' côté Nantes, sans numéro, absent de la feuille (6cb812bd, A red 78' p2, saisi le 08/11 à 13:11 UTC).
do $$
declare v uuid := 'dc5454eb-1590-4538-9c86-e5c7ba3d34ee'; nb int; res text := '';
begin
  delete from events where match_id = v and t = 'A' and k = 'red' and sort = 78 and n is null and id::text like '6cb812bd%';
  get diagnostics nb = row_count; res := nb || ' rouge retire';
  insert into events (id, match_id, t, k, n, min, sort, p, created_by, notified_at)
  select gen_random_uuid(), v, 'A', 'goal', '3', '89''', 89, 2, (select id from profiles where proprietaire limit 1), now()
  where not exists (select 1 from events where match_id = v and t = 'A' and k = 'goal' and sort >= 85);
  get diagnostics nb = row_count; res := res || ', ' || nb || ' but ajoute';
  raise notice 'FAIT %', res;
end $$;
