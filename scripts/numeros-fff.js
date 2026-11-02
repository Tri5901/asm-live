// Numéros de NOS joueurs repris de la feuille de match FFF, quand la compo a été saisie sans tous les numéros.
//   node scripts/numeros-fff.js <id du match> <json>   → json = notre équipe sur la feuille : [{"n":"7","name":"Romain R.","sub":false}, ...]
// La base ne donne un numéro qu'aux joueurs qui n'en ont pas (reconnus par prénom + initiale du nom) et corrige
// titulaire / remplaçant quand le numéro est le même ; rien d'autre n'est modifié. Clé lue dans C:\Users\Utilisateur\.asm-live\classements.key.
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = 'https://xzzttulqlydcespgkpnx.supabase.co';
const KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const [match, file] = process.argv.slice(2);
if (!match || !file) { console.error('usage : numeros-fff.js <match> <json>'); process.exit(1); }
const joueurs = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(joueurs) || !joueurs.length) { console.error('liste de joueurs vide'); process.exit(1); }
const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
fetch(URL_ + '/rest/v1/rpc/numeros_fff', {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_secret: secret, p_match: match, p_joueurs: joueurs })
}).then(async r => {
  const t = await r.text();
  if (!r.ok) { console.error('ERREUR ' + t); process.exit(1); }
  console.log(+t > 0 ? `CORRIGE ${t} joueur(s) de notre compo (numéro ou titulaire/remplaçant)` : 'RIEN (numéros déjà complets, ou joueurs pas reconnus)');
});
