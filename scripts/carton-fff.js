// Ajoute UN carton (jaune par défaut, ou blanc / rouge) de l'équipe adverse oublié pendant la saisie (relevé sur la feuille de match FFF).
//   node scripts/carton-fff.js <id du match> <numéro ou -> <minute, ex. 63' ou 45+2'> <période 1|2> [yellow|white|red]
// La base n'ajoute qu'un carton jaune adverse sur un match terminé, et rien si un jaune adverse existe déjà à cette minute.
// Le reste de la chronologie n'est jamais modifié. Clé lue dans C:\Users\Utilisateur\.asm-live\classements.key.
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = 'https://xzzttulqlydcespgkpnx.supabase.co';
const KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const [match, n, min, p, k = 'yellow'] = process.argv.slice(2);
if (!match || !min || !['1', '2'].includes(p)) { console.error("usage : carton-fff.js <match> <numéro|-> <minute> <1|2>"); process.exit(1); }
const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
fetch(URL_ + '/rest/v1/rpc/ajout_carton_adverse', {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_secret: secret, p_match: match, p_n: n === '-' ? null : n, p_min: min, p_p: +p, p_k: k })
}).then(async r => {
  const t = await r.text();
  if (!r.ok) { console.error('ERREUR ' + t); process.exit(1); }
  console.log(t === '1' ? 'AJOUTE carton ' + k + ' adverse ' + min : 'RIEN (déjà présent ou match non terminé)');
});
