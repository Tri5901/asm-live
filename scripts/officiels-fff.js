// Officiels désignés par la FFF (section « OFFICIELS » de la page du match) → désignation dans l'appli.
//   node scripts/officiels-fff.js liste            → matchs seniors à venir des 10 prochains jours, avec leur page FFF
//                                                    (« id adresse-FFF (match) [désignation actuelle] »)
//   node scripts/officiels-fff.js envoyer <json>   → enregistre : [{"match_id":"...","officiels":"central"}, ...]
// Règle : arbitre centre seul → "central" ; arbitre centre + 2 assistants → "trio". Pas de section OFFICIELS → ne rien envoyer.
// La base retire les postes du club devenus inutiles (et prévient les personnes concernées via le minuteur).
// Clé lue dans C:\Users\Utilisateur\.asm-live\classements.key (jamais affichée).
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = 'https://xzzttulqlydcespgkpnx.supabase.co';
const KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function liste() {
  const d0 = new Date().toISOString(), d1 = new Date(Date.now() + 10 * 864e5).toISOString();
  const r = await fetch(URL_ + `/rest/v1/matches?select=id,kickoff,equipe,home_name,away_name,competition,fff_match,officiels&status=eq.prevu&equipe=in.(1,2,3,4,5)&kickoff=gte.${d0}&kickoff=lt.${d1}&order=kickoff`, { headers: H });
  const ms = await r.json();
  if (!ms.length) return console.log('RIEN pas de match seniors dans les 10 prochains jours');
  ms.forEach(m => console.log(m.fff_match
    ? `${m.id} https://epreuves.fff.fr${m.fff_match}   (${m.home_name} – ${m.away_name}, ${m.competition}) [${m.officiels || 'par défaut'}]`
    : `${m.id} SANS-PAGE-FFF   (${m.home_name} – ${m.away_name}, ${m.competition}) : pas d'adresse FFF connue, ignorer`));
}

async function envoyer(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data) || !data.length) return console.log('RIEN liste vide');
  if (data.some(x => !['central', 'trio'].includes(x.officiels))) throw new Error('officiels doit valoir "central" ou "trio"');
  const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
  const r = await fetch(URL_ + '/rest/v1/rpc/officiels_fff', { method: 'POST', headers: H, body: JSON.stringify({ p_secret: secret, p_data: data }) });
  const t = await r.text();
  if (!r.ok) throw new Error('refus : ' + t);
  console.log(`ENREGISTRE ${t} match(s) modifié(s) sur ${data.length}`);
}

const [cmd, a] = process.argv.slice(2);
(cmd === 'liste' ? liste() : cmd === 'envoyer' ? envoyer(a) : Promise.reject(new Error('commande : liste | envoyer <json>')))
  .catch(e => { console.error('ERREUR ' + e.message); process.exit(1); });
