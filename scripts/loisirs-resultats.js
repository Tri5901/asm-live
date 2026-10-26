// Scores et classement des Loisirs, relevés sur SportEasy (pages privées de l'équipe, ouvertes dans le navigateur intégré
// avec le compte de Tristan) : le calendrier .ics ne donne pas les scores.
//   node scripts/loisirs-resultats.js <fichier.json> [essai | json]   (essai : affiche sans rien envoyer ; json : écrit ce qui serait envoyé)
// Format du JSON (relevé par la vérification du lundi / mercredi / vendredi, étape « Loisirs ») :
//   { "calendrier": [{ "date": "09/10/2026", "heure": "21:30", "type": "Loisirs ASM - …", "home": "SCOL", "away": "AS Mésanger Loisirs", "bH": 5, "bA": 0 }, ...],
//     "resultats":  [{ "j": 4, "date": "09/10/2026", "heure": "21:30", "home": "SCOL", "away": "AS Mésanger Loisirs", "bH": 5, "bA": 0 }, ...],   (tout le championnat)
//     "classement": [[rang, nom, pts, J, G, N, P, bp, bc, diff], ...] }
// Nos matchs joués : score enregistré s'il n'a pas été saisi en direct (un match saisi dans l'appli n'est jamais touché) ;
// un match passé absent du site (avant le branchement du calendrier) est ajouté, terminé, avec son score.
// Classement et résultats du championnat : remplacés à chaque relevé (« d'après SportEasy » dans l'appli).
// Envoi : fonction loisirs_resultats (supabase/loisirs-resultats.sql), avec la clé des classements (jamais affichée).
const fs = require('fs'), path = require('path'), os = require('os');
const { NOUS, SUPABASE_URL, SUPABASE_KEY, matchsIcs } = require('./loisirs-sporteasy.js');
const H = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' };
const CLUB = '516995';
// « Oudon / Couffé » = « Oudon/Couffé », sans accents ni majuscules
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim().toLowerCase();
const estNous = s => norm(s) === norm(NOUS);
const iso = (date, heure) => { const [j, m, a] = String(date).split('/'); return `${a}-${m}-${j}T${heure || '00:00'}`; };
const LOGO = c => 'https://cdn-transverse.azureedge.net/phlogos/BC' + c + '.jpg';

(async () => {
  const [fich, mode] = process.argv.slice(2), essai = mode === 'essai';
  if (!fich) throw new Error('usage : loisirs-resultats.js <fichier.json> [essai]');
  const d = JSON.parse(fs.readFileSync(fich, 'utf8'));
  // codes club FFF des adversaires (logos), repris des matchs Loisirs déjà sur le site ; nos équipes = le club
  const deja = await (await fetch(SUPABASE_URL + '/rest/v1/matches?select=home_name,away_name,club_side,opp_logo&equipe=eq.8', { headers: H })).json();
  const codes = {};
  deja.forEach(m => { const c = (m.opp_logo || '').match(/BC(\d+)\./); if (c) codes[norm(m.club_side === 'H' ? m.away_name : m.home_name)] = c[1]; });
  const codeDe = nom => estNous(nom) || /mesanger/.test(norm(nom)) ? CLUB : (codes[norm(nom)] || '');

  // nos matchs : retrouvés dans le calendrier .ics par la date et l'heure de Paris (identifiant SportEasy = ext_id)
  const ics = await matchsIcs();
  const cle = k => new Date(k).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  const parCle = {}; ics.forEach(m => { parCle[cle(m.kickoff)] = m; });
  const matchs = [], perdus = [];
  for (const x of d.calendrier || []) {
    if (!(estNous(x.home) || estNous(x.away)) || !Number.isInteger(x.bH) || !Number.isInteger(x.bA)) continue;
    const m = parCle[x.date + ' ' + x.heure];
    if (!m) { perdus.push(`${x.date} ${x.home} – ${x.away}`); continue; }
    const code = codeDe(m.adversaire);
    matchs.push({ uid: m.uid, kickoff: m.kickoff.toISOString(), club_side: m.club_side, adversaire: m.adversaire, competition: m.competition,
      lieu: m.lieu, adresse: m.adresse, opp_logo: code ? LOGO(code) : null, bH: x.bH, bA: x.bA });
  }
  const lignes = (d.classement || []).filter(l => Array.isArray(l) && l.length >= 10).map(l => [...l.slice(0, 10).map((v, i) => i === 1 ? String(v) : +v), codeDe(l[1])]);
  if (lignes.length && !lignes.some(l => l[10] === CLUB)) throw new Error('AS Mésanger Loisirs absente du classement');
  const resultats = (d.resultats || []).filter(x => Number.isInteger(x.bH) && Number.isInteger(x.bA))
    .map(x => ['se-' + x.j + '-' + norm(x.home) + '-' + norm(x.away), iso(x.date, x.heure), codeDe(x.home), x.home, x.bH, x.bA, codeDe(x.away), x.away]);

  matchs.forEach(m => console.log(`  ${cle(m.kickoff)}  ${m.club_side === 'H' ? NOUS + ' ' + m.bH + '-' + m.bA + ' ' + m.adversaire : m.adversaire + ' ' + m.bH + '-' + m.bA + ' ' + NOUS}`));
  perdus.forEach(p => console.log('  INTROUVABLE dans le calendrier .ics : ' + p));
  const nous = lignes.find(l => l[10] === CLUB && estNous(l[1]));
  console.log(`${matchs.length} match(s) joué(s), classement ${lignes.length} équipes${nous ? ' (Loisirs ' + nous[0] + 'e, ' + nous[2] + ' pts)' : ''}, ${resultats.length} résultat(s) du championnat`);
  const sansLogo = lignes.filter(l => !l[10]).map(l => l[1]);
  if (sansLogo.length) console.log('  sans logo : ' + sansLogo.join(', '));
  if (essai) return;
  if (mode === 'json') return fs.writeFileSync(fich.replace(/\.json$/, '') + '-envoi.json', JSON.stringify({ matchs, classement: lignes.length ? { lignes, resultats } : null }));
  const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/loisirs_resultats', { method: 'POST', headers: H,
    body: JSON.stringify({ p_secret: secret, p_data: { matchs, classement: lignes.length ? { lignes, resultats } : null } }) });
  const t = await r.text();
  if (!r.ok) throw new Error('refus : ' + t);
  console.log('envoi → ' + r.status + ' ' + t);
})().catch(e => { console.error('ERREUR ' + e.message); process.exit(1); });
