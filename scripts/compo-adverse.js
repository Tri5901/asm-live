// Compos de l'équipe adverse relevées sur la feuille de match FFF (tâche programmée du mardi).
//   node scripts/compo-adverse.js liste                 → matchs terminés des 9 derniers jours dont la compo adverse n'a pas de noms
//                                                         (« id adresse-FFF (équipe – adversaire) »)
//   node scripts/compo-adverse.js envoyer <id> <json>   → enregistre la compo adverse : [{"n":"7","name":"Hugo Martin","sub":false}, ...]
// La base ne remplit que la compo adverse, et seulement si elle est vide ou sans noms : une compo saisie n'est jamais écrasée.
// Clé lue dans C:\Users\Utilisateur\.asm-live\classements.key (jamais affichée).
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = 'https://xzzttulqlydcespgkpnx.supabase.co';
const KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function liste() {
  const depuis = new Date(Date.now() - 9 * 864e5).toISOString();
  const r = await fetch(URL_ + `/rest/v1/matches?select=id,equipe,club_side,home_name,away_name,rosters,fff_match&status=eq.termine&kickoff=gte.${depuis}&fff_match=not.is.null&order=kickoff`, { headers: H });
  const ms = await r.json();
  const a_faire = ms.filter(m => { const adv = m.club_side === 'A' ? 'H' : 'A'; return !((m.rosters || {})[adv] || []).some(p => (p.name || '').trim()); });
  if (!a_faire.length) return console.log('RIEN toutes les compos adverses sont déjà remplies');
  a_faire.forEach(m => console.log(`${m.id} https://epreuves.fff.fr${m.fff_match}   (${m.home_name} – ${m.away_name}, adversaire : ${m.club_side === 'A' ? m.home_name : m.away_name})`));
}

async function envoyer(id, file) {
  const joueurs = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(joueurs) || !joueurs.length) throw new Error('liste de joueurs vide');
  const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
  const r = await fetch(URL_ + '/rest/v1/rpc/compo_adverse_fff', { method: 'POST', headers: H, body: JSON.stringify({ p_secret: secret, p_match: id, p_joueurs: joueurs }) });
  const t = await r.text();
  if (!r.ok) throw new Error('refus : ' + t);
  console.log(t === '1' ? `ENREGISTRE ${joueurs.length} joueurs adverses` : 'RIEN (compo adverse déjà remplie)');
}

const [cmd, a, b] = process.argv.slice(2);
(cmd === 'liste' ? liste() : cmd === 'envoyer' ? envoyer(a, b) : Promise.reject(new Error('usage : liste | envoyer <id> <json>')))
  .catch(e => { console.error('ERREUR ' + e.message); process.exit(1); });
