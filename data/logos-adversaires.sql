-- Logos des adversaires (source : FFF, logos officiels des clubs) + noms des réserves des Seniors E
update public.matches set home_name = 'Riaillé UFCE Donneau 2' where equipe = 5 and home_name = 'Riaillé UFCE Donneau';
update public.matches set away_name = 'Les Coteaux de la Roche 2' where equipe = 5 and away_name = 'Les Coteaux de la Roche';
update public.matches m set opp_logo = 'https://cdn-transverse.azureedge.net/phlogos/BC' || l.code || '.jpg'
from (values
  ('FC Ste Cécile',563759),('FC St Sébastien',582222),('FC Boupère',582186),('Laigné Loigné',519910),('Les Sorinières',513122),
  ('FC Sèvremont',552171),('Ancenis RCASG',500268),('FC du Craonnais',502153),('FC St Julien Divatte',561182),('FC Château-Gontier',528431),
  ('Riaillé UFCE',547054),('ES Plessé',518734),('SCNA Derval',552653),('LoireAuxence Varades',541371),('FC Petit-Mars',515463),
  ('FC Héric',517367),('St Vincent Lustvi',549082),('FC Vallons Le Pin',560845),('Erbray Jeunes',520446),('Réveil St Géréon',520217),
  ('Nantes La Mellinet',500041),('St Mars du Désert',513964),('FC Le Cellier Mauves',581259),('FC Vair Herblanetz',552795),
  ('Les Coteaux de la Roche',548228),('Mouzeil Teillé Ligné',547590),('Métallo SC Nantes',509427),('FC Oudon Couffé',581315),
  ('Freigné Espoirs',551971),('LoireAuxence BCM',581906),('FC Les Touches',516436),('ES Joué-sur-Erdre',514662)
) as l(prefix, code)
where (case when m.club_side = 'H' then m.away_name else m.home_name end) like l.prefix || '%';
select equipe, count(*) filter (where opp_logo is not null) as avec_logo, count(*) as total from public.matches group by equipe order by equipe;
