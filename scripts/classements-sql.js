// Génère le SQL de mise à jour des classements à partir de data/classements.json
// Lignes : [rang, équipe, pts, joués, gagnés, nuls, perdus, buts pour, buts contre, diff, code club FFF]
const d = require('../data/classements.json');
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const vals = Object.entries(d.equipes).map(([e, c]) =>
  `(${e}, ${q(c.competition)}, ${q(JSON.stringify(c.lignes))}::jsonb, ${q(c.source)}, ${q(d.date + 'T12:00:00+02:00')})`);
console.log(`insert into public.classements (equipe, competition, lignes, source, updated_at) values ${vals.join(', ')} on conflict (equipe) do update set competition = excluded.competition, lignes = excluded.lignes, source = excluded.source, updated_at = excluded.updated_at; select equipe, jsonb_array_length(lignes) as equipes from public.classements order by equipe;`);
