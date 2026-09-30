// Mise à jour des classements, utilisé par la tâche programmée « Classements ASM ».
//   node scripts/maj-classements.js check          → affiche A_FAIRE (lundi, pas encore fait cette heure-ci) ou RIEN
//   node scripts/maj-classements.js pages          → liste des pages de classement FFF à relever (« numéro adresse », lue dans la base)
//   node scripts/maj-classements.js envoyer <json>  → enregistre les classements relevés (fichier JSON)
// Format du JSON : { "1": { "lignes": [[rang, nom, pts, J, G, N, P, bp, bc, diff, codeClub], ...] }, "2": {...}, ... }
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
  const lundi = now.getDay() === 1 && fait < debutHeure;
  // la tâche programmée ne tourne que le lundi (8 h, 12 h, 20 h) ; les autres demandes sont faites à la main
  if (lundi) console.log('A_FAIRE mise à jour du lundi' + (demande && demande > fait ? ' (demande en attente de ' + (m.demande_par || '?') + ')' : ''));
  else console.log('RIEN dernière mise à jour ' + fait.toLocaleString('fr-FR'));
}

async function pages() {
  const r = await fetch(URL_ + '/rest/v1/equipes?select=id,nom,fff_classement&actif=eq.true&fff_classement=not.is.null&order=cat_ordre,ordre', { headers: H });
  (await r.json()).forEach(e => console.log(e.id + ' ' + e.fff_classement + '   (' + e.nom + ')'));
}

async function envoyer(file) {
  const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [e, v] of Object.entries(data)) {
    if (!Array.isArray(v.lignes) || v.lignes.length < 2) throw new Error('équipe ' + e + ' : classement vide');
    if (!v.lignes.some(l => l[10] === '516995')) throw new Error('équipe ' + e + ' : AS Mésanger absente du classement');
  }
  const r = await fetch(URL_ + '/rest/v1/rpc/enregistrer_classements', { method: 'POST', headers: H, body: JSON.stringify({ p_secret: secret, p_data: data }) });
  const out = await r.text();
  if (!r.ok) throw new Error('refus : ' + out);
  console.log('OK ' + out + ' classement(s) enregistré(s)');
}

const [cmd, arg] = process.argv.slice(2);
(cmd === 'check' ? check() : cmd === 'pages' ? pages() : cmd === 'envoyer' ? envoyer(arg) : Promise.reject(new Error('usage : check | pages | envoyer <fichier.json>')))
  .catch(e => { console.error('ERREUR ' + e.message); process.exit(1); });
