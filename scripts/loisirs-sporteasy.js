// Matchs des Loisirs (pas sur la FFF) repris du calendrier SportEasy de l'équipe « AS Mésanger Loisirs ».
//   node scripts/loisirs-sporteasy.js                 → lit le lien du calendrier (C:\Users\Utilisateur\.asm-live\loisirs-ics.url)
//   node scripts/loisirs-sporteasy.js <fichier|lien>  → lit ce calendrier (.ics, webcal:// ou https://)
//   … essai                                          → affiche les matchs trouvés, n'envoie rien
// Envoi : fonction loisirs_sync (supabase/loisirs.sql), avec la clé des classements. Seuls les matchs à venir partent :
// le calendrier ne donne pas les scores (ils restent sur SportEasy), un match passé serait resté « à venir ».
// Les entraînements et autres événements sont ignorés ; un match déjà commencé n'est plus modifié ; rien n'est supprimé.
const fs = require('fs'), path = require('path'), os = require('os');
const DIR = path.join(os.homedir(), '.asm-live');
const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const NOUS = 'AS Mésanger Loisirs';

// lignes « pliées » (RFC 5545 : une ligne qui commence par un espace continue la précédente), puis les VEVENT
function lireIcs(txt){
  const lignes = txt.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const evs = []; let e = null;
  for (const l of lignes){
    if (l === 'BEGIN:VEVENT'){ e = {}; continue; }
    if (l === 'END:VEVENT'){ if (e) evs.push(e); e = null; continue; }
    if (!e) continue;
    const i = l.indexOf(':'); if (i < 0) continue;
    const [nom, ...params] = l.slice(0, i).split(';');
    const val = l.slice(i + 1).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
    e[nom.toUpperCase()] = { val, params: Object.fromEntries(params.map(p => p.split('='))) };
  }
  return evs;
}
// DTSTART : « 20261106T213000Z » (UTC), « 20261106T213000 » avec TZID (heure de Paris), ou un jour entier
function dateIcs(p){
  if (!p) return null;
  const m = p.val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, a, mo, j, h = '12', mi = '00', s = '00', z] = m;
  if (z) return new Date(`${a}-${mo}-${j}T${h}:${mi}:${s}Z`);
  // heure locale de Paris : on cherche le décalage du jour (heure d'été / d'hiver)
  const brut = new Date(`${a}-${mo}-${j}T${h}:${mi}:${s}Z`);
  const paris = new Date(brut.toLocaleString('en-US', { timeZone: 'Europe/Paris' })), utc = new Date(brut.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(brut.getTime() - (paris - utc));
}
// intitulés SportEasy : « Domicile / Extérieur - Compétition » (« HerblAnetz / AS Mésanger Loisirs - Loisirs ASM - Saison
// 2026/2027 », « AS Mésanger Loisirs / Seniors AS Mésanger D - Match amical ») ; un nom d'équipe peut lui-même contenir
// « / » (« Oudon / Couffé ») : on se repère sur notre nom. Sans « / » (« AS Mésanger Loisirs - Entraînement », tournoi,
// repas…) : pas un match.
function versMatch(e){
  const titre = (e.SUMMARY || {}).val || '';
  if ((e.STATUS || {}).val === 'CANCELLED') return { ignore: 'annulé', titre };
  const i = titre.indexOf(' - ');
  const equipes = (i < 0 ? titre : titre.slice(0, i)).trim(), quoi = i < 0 ? '' : titre.slice(i + 3);
  let club_side, adversaire;
  if (equipes.startsWith(NOUS + ' / ')){ club_side = 'H'; adversaire = equipes.slice(NOUS.length + 3); }
  else if (equipes.endsWith(' / ' + NOUS)){ club_side = 'A'; adversaire = equipes.slice(0, -(NOUS.length + 3)); }
  else return { ignore: 'pas un match', titre };
  adversaire = adversaire.replace(/\s+/g, ' ').trim();
  const lieu = ((e.LOCATION || {}).val || '').trim();
  const competition = /amical/i.test(quoi) ? 'Match amical' : /coupe/i.test(quoi) ? 'Coupe loisirs' : 'Championnat loisirs';
  return { uid: (e.UID || {}).val, kickoff: dateIcs(e.DTSTART), club_side, adversaire, competition, lieu: lieu.split(',')[0].trim(), adresse: lieu, titre };
}

// tous les matchs du calendrier SportEasy (passés compris), lus avec le lien privé : utilisé par loisirs-resultats.js
async function matchsIcs(){
  const src = fs.readFileSync(path.join(DIR, 'loisirs-ics.url'), 'utf8').trim();
  const txt = await (await fetch(src.replace(/^webcal:/i, 'https:'))).text();
  if (!/BEGIN:VCALENDAR/.test(txt)) throw new Error('le calendrier SportEasy ne répond pas');
  return lireIcs(txt).map(versMatch).filter(m => !m.ignore && m.uid && m.kickoff);
}
module.exports = { NOUS, SUPABASE_URL, SUPABASE_KEY, matchsIcs };

if (require.main === module) (async () => {
  const args = process.argv.slice(2), essai = args.includes('essai');
  // catégorie Loisirs masquée sur le site : rien à faire
  const [eq] = await (await fetch(SUPABASE_URL + '/rest/v1/equipes?select=actif&categorie=eq.Loisirs', { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } })).json();
  if (eq && !eq.actif) return console.log('RIEN catégorie Loisirs masquée sur le site');
  let src = args.find(a => a !== 'essai');
  if (!src){
    const f = path.join(DIR, 'loisirs-ics.url');
    if (!fs.existsSync(f)){ console.error('Lien du calendrier SportEasy absent : le mettre dans ' + f); process.exit(1); }
    src = fs.readFileSync(f, 'utf8').trim();
  }
  const txt = /^(webcal|https?):/i.test(src) ? await (await fetch(src.replace(/^webcal:/i, 'https:'))).text() : fs.readFileSync(src, 'utf8');
  if (!/BEGIN:VCALENDAR/.test(txt)){ console.error('Ce n\'est pas un calendrier .ics'); process.exit(1); }
  const tous = lireIcs(txt).map(versMatch);
  const depuis = Date.now() - 3 * 3600e3;
  const matchs = tous.filter(m => !m.ignore && m.uid && m.kickoff && m.kickoff.getTime() > depuis);
  const passes = tous.filter(m => !m.ignore && m.kickoff && m.kickoff.getTime() <= depuis).length;
  const ignores = tous.filter(m => m.ignore);
  const fmt = d => d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  console.log(`${matchs.length} match(s) à venir, ${passes} déjà joué(s) (pas envoyés : pas de score dans le calendrier), ${ignores.length} autre(s) événement(s) ignoré(s)`);
  matchs.sort((a, b) => a.kickoff - b.kickoff).forEach(m => console.log(`  ${fmt(m.kickoff)}  ${m.club_side === 'H' ? 'dom.' : 'ext.'}  ${m.adversaire}  · ${m.competition}${m.lieu ? ' · ' + m.lieu : ''}`));
  ignores.forEach(m => console.log(`  ignoré (${m.ignore}) : ${m.titre}`));
  if (essai) return;
  const cle = fs.readFileSync(path.join(DIR, 'classements.key'), 'utf8').trim();
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/loisirs_sync', {
    method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: cle, p_data: matchs.map(({ titre, ...m }) => ({ ...m, kickoff: m.kickoff.toISOString() })) })
  });
  console.log('envoi → ' + r.status + ' ' + await r.text());
})();
