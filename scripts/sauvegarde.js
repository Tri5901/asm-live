// Sauvegarde de la base sur ce PC (l'offre gratuite de Supabase n'en garde pas) : tout le contenu utile, compressé,
// dans C:\Users\Utilisateur\.asm-live\sauvegardes\asm-AAAA-MM-JJ.json.gz ; les 12 plus récentes sont gardées.
//   node scripts/sauvegarde.js
// Clé lue dans C:\Users\Utilisateur\.asm-live\classements.key (jamais affichée).
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const URL_ = 'https://xzzttulqlydcespgkpnx.supabase.co';
const KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const DOSSIER = path.join(os.homedir(), '.asm-live', 'sauvegardes');

(async () => {
  const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
  const r = await fetch(URL_ + '/rest/v1/rpc/export_sauvegarde', {
    method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: secret })
  });
  const t = await r.text();
  if (!r.ok) throw new Error('refus : ' + t.slice(0, 200));
  const data = JSON.parse(t);
  fs.mkdirSync(DOSSIER, { recursive: true });
  const nom = 'asm-' + new Date().toISOString().slice(0, 10) + '.json.gz';
  fs.writeFileSync(path.join(DOSSIER, nom), zlib.gzipSync(t));
  const anciens = fs.readdirSync(DOSSIER).filter(f => /^asm-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort().reverse().slice(12);
  anciens.forEach(f => fs.unlinkSync(path.join(DOSSIER, f)));
  const n = k => (data[k] || []).length;
  console.log(`OK ${nom} : ${n('matches')} matchs, ${n('events')} actions, ${n('profiles')} comptes, ${n('classements')} classements, ${n('historique')} lignes d'historique`
    + (anciens.length ? ` (${anciens.length} ancienne(s) supprimée(s))` : ''));
})().catch(e => { console.error('ERREUR ' + e.message); process.exit(1); });
