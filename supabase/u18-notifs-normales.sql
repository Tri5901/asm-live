-- U18 A : notifications normales (Tristan, 25/10). Ce n'est plus une équipe « exceptionnelle » (match de Gambardella
-- envoyé à tous ceux qui suivent au moins une équipe) : seuls ceux qui la choisissent dans la cloche la reçoivent.
-- L'équipe 7 avait été ajoutée d'office à tous les abonnements (déclencheur push_equipes_exceptionnelles) : on la retire.
update public.equipes set exceptionnelle = false where id = 7;
update public.push_subscriptions set equipes = array_remove(equipes, 7) where 7 = any(equipes);
select (select count(*) from public.push_subscriptions where 7 = any(equipes)) as abonnes_u18a,
       (select count(*) from public.equipes where exceptionnelle) as equipes_exceptionnelles;
