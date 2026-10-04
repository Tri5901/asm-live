// Ajoute UN remplacement de l'équipe adverse pas saisi pendant le match (relevé sur la feuille de match FFF).
//   node scripts/remplacement-fff.js <id du match> <n° sortant> <n° entrant> <minute, ex. 63' ou 45+2'> <période 1|2>
// La base n'ajoute qu'un remplacement adverse sur un match terminé, et rien s'il est déjà noté (même sortant, même entrant).
// Le reste de la chronologie n'est jamais modifié. Clé lue dans C:\Users\Utilisateur\.asm-live\classements.key.
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = 'https://xzzttulqlydcespgkpnx.supabase.co';
const KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const [match, sortant, entrant, min, p] = process.argv.slice(2);
if (!match || !sortant || !entrant || !min || !['1', '2'].includes(p)) { console.error('usage : remplacement-fff.js <match> <n° sortant> <n° entrant> <minute> <1|2>'); process.exit(1); }
const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
fetch(URL_ + '/rest/v1/rpc/ajout_remplacement_adverse', {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_secret: secret, p_match: match, p_out: sortant, p_in: entrant, p_min: min, p_p: +p })
}).then(async r => {
  const t = await r.text();
  if (!r.ok) { console.error('ERREUR ' + t); process.exit(1); }
  console.log(t === '1' ? `AJOUTE remplacement adverse ${min} (sort n°${sortant}, entre n°${entrant})` : 'RIEN (déjà noté ou match non terminé)');
});
