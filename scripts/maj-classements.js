// Mise à jour des classements, utilisé par la tâche programmée « Classements ASM ».
//   node scripts/maj-classements.js check          → affiche A_FAIRE (dimanche de 17 h à 22 h, pas encore fait cette heure-ci) ou RIEN
//   node scripts/maj-classements.js pages          → liste des pages de classement FFF à relever (« numéro adresse », lue dans la base)
//   node scripts/maj-classements.js poules         → liste des pages « Résultats / calendrier » des poules (« numéro adresse »)
//   node scripts/maj-classements.js envoyer <json>  → enregistre les classements relevés (fichier JSON)
// Format du JSON : { "1": { "lignes": [[rang, nom, pts, J, G, N, P, bp, bc, diff, codeClub], ...],
//                          "resultats": [[idMatch, 'DIM 20 SEP 2026 - 15H00', codeDom, nomDom, butsDom, butsExt, codeExt, nomExt], ...] }, ... }
// « resultats » est facultatif ; les matchs déjà enregistrés sont gardés (fusion par idMatch).
// La clé secrète est lue dans C:\Users\Utilisateur\.asm-live\classements.key (jamais dans le dépôt).
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = 'https://xzzttulqlydcespgkpnx.supabase.co';
const KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function check() {
  const r = await fetch(URL_ + '/rest/v1/classements_maj?select=*', { headers: H });
  const [m] = await r.json();
  const fait = m.fait_at ? new Date(m.fait_at) : new Date(0);
  const demande = m.demande_at ? new Date(m.demande_at) : null;
  const now = new Date();
  const debutHeure = new Date(now); debutHeure.setMinutes(0, 0, 0);
  const dimanche = now.getDay() === 0 && now.getHours() >= 17 && now.getHours() <= 22 && fait < debutHeure;
  // la tâche programmée tourne le dimanche toutes les heures de 17 h à 22 h ; les autres demandes sont faites à la main
  if (dimanche) console.log('A_FAIRE mise à jour du dimanche' + (demande && demande > fait ? ' (demande en attente de ' + (m.demande_par || '?') + ')' : ''));
  else console.log('RIEN dernière mise à jour ' + fait.toLocaleString('fr-FR'));
}

async function pages() {
  const r = await fetch(URL_ + '/rest/v1/equipes?select=id,nom,fff_classement&actif=eq.true&fff_classement=not.is.null&order=cat_ordre,ordre', { headers: H });
  (await r.json()).forEach(e => console.log(e.id + ' ' + e.fff_classement + '   (' + e.nom + ')'));
}

const MOIS = { JAN: 1, FEV: 2, 'FÉV': 2, MAR: 3, AVR: 4, MAI: 5, JUN: 6, JUIN: 6, JUI: 7, JUIL: 7, AOU: 8, 'AOÛ': 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12, 'DÉC': 12 };
// 'DIM 20 SEP 2026 - 15H00' → '2026-09-20T15:00'
function dateFFF(t) {
  const m = String(t).toUpperCase().match(/(\d{1,2})\s+([A-ZÉÛ]+)\.?\s+(\d{4})(?:\s*-\s*(\d{1,2})H(\d{2}))?/);
  if (!m || !MOIS[m[2]]) return null;
  const p = n => String(n).padStart(2, '0');
  return m[3] + '-' + p(MOIS[m[2]]) + '-' + p(m[1]) + 'T' + p(m[4] || 0) + ':' + p(m[5] || 0);
}
function normResultats(list) {
  return (list || []).map(x => [String(x[0] || ''), dateFFF(x[1]), x[2] ? String(x[2]) : null, String(x[3] || ''),
    x[4] === null || x[4] === '' ? null : Number(x[4]), x[5] === null || x[5] === '' ? null : Number(x[5]), x[6] ? String(x[6]) : null, String(x[7] || '')])
    .filter(x => /^\d+$/.test(x[0]) && x[1] && Number.isInteger(x[4]) && Number.isInteger(x[5]));
}

async function poules() {
  const r = await fetch(URL_ + '/rest/v1/equipes?select=id,nom,fff_poule&actif=eq.true&fff_poule=not.is.null&order=cat_ordre,ordre', { headers: H });
  (await r.json()).forEach(e => console.log(e.id + ' ' + e.fff_poule + '   (' + e.nom + ')'));
}

async function envoyer(file) {
  const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [e, v] of Object.entries(data)) {
    if (!Array.isArray(v.lignes) || v.lignes.length < 2) throw new Error('équipe ' + e + ' : classement vide');
    if (!v.lignes.some(l => l[10] === '516995')) throw new Error('équipe ' + e + ' : AS Mésanger absente du classement');
    if (v.resultats) v.resultats = normResultats(v.resultats);
  }
  const r = await fetch(URL_ + '/rest/v1/rpc/enregistrer_classements', { method: 'POST', headers: H, body: JSON.stringify({ p_secret: secret, p_data: data }) });
  const out = await r.text();
  if (!r.ok) throw new Error('refus : ' + out);
  console.log('OK ' + out + ' classement(s) enregistré(s)');
}

const [cmd, arg] = process.argv.slice(2);
if (require.main === module) (cmd === 'check' ? check() : cmd === 'pages' ? pages() : cmd === 'poules' ? poules() : cmd === 'envoyer' ? envoyer(arg) : Promise.reject(new Error('usage : check | pages | poules | envoyer <fichier.json>')))
  .catch(e => { console.error('ERREUR ' + e.message); process.exit(1); });

module.exports = { normResultats, dateFFF };
