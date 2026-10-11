-- Vue terrain (option du responsable score) : place de départ, dispositif et changements de poste de nos joueurs.
-- { on: bool, f: '4-4-2', d: [11 numéros], p: [{ s: minute, a: numéro, b: numéro }] }
-- Modifiable comme le reste du match (politique « matches modification » : can_manage).
alter table public.matches add column if not exists terrain jsonb;
select 'ok' as terrain;
