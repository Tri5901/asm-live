// Matchs des Loisirs (pas sur la FFF) repris du calendrier SportEasy de l'équipe « AS Mésanger Loisirs ».
//   node scripts/loisirs-sporteasy.js                 → lit le lien du calendrier (C:\Users\Utilisateur\.asm-live\loisirs-ics.url)
//   node scripts/loisirs-sporteasy.js <fichier|lien>  → lit ce calendrier (.ics, webcal:// ou https://)
//   … essai                                          → affiche les matchs trouvés, n'envoie rien
// Envoi : fonction loisirs_sync (supabase/loisirs.sql), avec la clé des classements. Les entraînements et autres
// événements sont ignorés ; un match déjà commencé n'est plus modifié ; rien n'est supprimé.
const fs = require('fs'), path = require('path'), os = require('os');
const DIR = path.join(os.homedir(), '.asm-live');
const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';

// noms sous lesquels l'équipe peut apparaître dans un intitulé d'événement
const NOUS = /\b(?:as\s*)?m[ée]sanger(?:\s+loisirs?)?\b|\basm(?:\s+loisirs?)?\b|\bloisirs?\s+asm\b/i;
// morceau d'intitulé qui nomme la compétition ou la saison (« Saison 2026/2027 ») : jamais pris pour l'adversaire
const COMPET = /saison|championnat|journ[ée]e|poule|\b\d{4}\s*[\/-]\s*\d{4}\b/i;
const PAS_MATCH =/entra[iî]nement|training|r[ée]union|assembl[ée]e|soir[ée]e|repas|f[êe]te|tournoi de p[ée]tanque|non sportif/i;

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
// « AS Mésanger Loisirs - FC Ligné », « Match : Ligné vs ASM Loisirs », « Loisirs ASM / Riaillé (ext.) »…
function versMatch(e){
  const titre = (e.SUMMARY || {}).val || '', desc = (e.DESCRIPTION || {}).val || '', cat = (e.CATEGORIES || {}).val || '';
  const tout = `${titre}\n${desc}\n${cat}`;
  if ((e.STATUS || {}).val === 'CANCELLED') return { ignore: 'annulé', titre };
  if (PAS_MATCH.test(titre) || PAS_MATCH.test(cat)) return { ignore: 'pas un match', titre };
  const net = titre.replace(/^\s*(?:match|rencontre|championnat|coupe|amical)\s*[:\-–]\s*/i, '').trim();
  const parts = net.split(/\s+(?:vs\.?|contre|[-–\/])\s+/i).map(s => s.trim()).filter(Boolean).filter(p => !COMPET.test(p) || NOUS.test(p));
  // intitulé réduit à notre nom (« Loisirs ASM - Saison 2026/2027 ») : adversaire pas encore connu
  if (parts.length === 1 && NOUS.test(parts[0])) parts.push('');
  let club_side = null, adversaire = '';
  if (parts.length >= 2){
    const iNous = parts.findIndex(p => NOUS.test(p));
    if (iNous === 0){ club_side = /ext[ée]rieur|\(ext\.?\)/i.test(tout) ? 'A' : 'H'; adversaire = parts.slice(1).filter(Boolean).join(' - '); }
    else if (iNous > 0){ club_side = 'A'; adversaire = parts.slice(0, iNous).join(' - '); }
  }
  if (!club_side){
    // pas de « nous » dans le titre : SportEasy met souvent l'adversaire seul, et domicile / extérieur à part
    if (!/match|rencontre|vs|contre|domicile|ext[ée]rieur/i.test(tout)) return { ignore: 'pas un match', titre };
    adversaire = (parts.length ? parts[parts.length - 1] : net).replace(/\((?:dom\.?|ext\.?|domicile|ext[ée]rieur)\)/ig, '').trim();
    club_side = /ext[ée]rieur|\(ext\.?\)|\bext\b/i.test(tout) ? 'A' : 'H';
  }
  adversaire = adversaire.replace(/\((?:dom\.?|ext\.?|domicile|ext[ée]rieur)\)/ig, '').replace(/\s+/g, ' ').trim();
  if (!adversaire || /^(?:adversaire\s+)?(?:[àa]\s+d[ée]terminer|tbd|inconnu)$/i.test(adversaire)) adversaire = '';
  const lieu = ((e.LOCATION || {}).val || '').trim();
  const competition = /amical/i.test(tout) ? 'Match amical' : /coupe/i.test(tout) ? 'Coupe loisirs' : 'Championnat loisirs';
  return { uid: (e.UID || {}).val, kickoff: dateIcs(e.DTSTART), club_side, adversaire, competition, lieu: lieu.split(',')[0].trim(), adresse: lieu, titre };
}

(async () => {
  const args = process.argv.slice(2), essai = args.includes('essai');
  let src = args.find(a => a !== 'essai');
  if (!src){
    const f = path.join(DIR, 'loisirs-ics.url');
    if (!fs.existsSync(f)){ console.error('Lien du calendrier SportEasy absent : le mettre dans ' + f); process.exit(1); }
    src = fs.readFileSync(f, 'utf8').trim();
  }
  const txt = /^(webcal|https?):/i.test(src) ? await (await fetch(src.replace(/^webcal:/i, 'https:'))).text() : fs.readFileSync(src, 'utf8');
  if (!/BEGIN:VCALENDAR/.test(txt)){ console.error('Ce n\'est pas un calendrier .ics'); process.exit(1); }
  const tous = lireIcs(txt).map(versMatch);
  const matchs = tous.filter(m => !m.ignore && m.uid && m.kickoff);
  const ignores = tous.filter(m => m.ignore);
  const fmt = d => d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  console.log(`${matchs.length} match(s), ${ignores.length} autre(s) événement(s) ignoré(s)`);
  matchs.sort((a, b) => a.kickoff - b.kickoff).forEach(m => console.log(`  ${fmt(m.kickoff)}  ${m.club_side === 'H' ? 'dom.' : 'ext.'}  ${m.adversaire || '(adversaire à déterminer)'}  · ${m.competition}${m.lieu ? ' · ' + m.lieu : ''}`));
  ignores.forEach(m => console.log(`  ignoré (${m.ignore}) : ${m.titre}`));
  if (essai) return;
  const cle = fs.readFileSync(path.join(DIR, 'classements.key'), 'utf8').trim();
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/loisirs_sync', {
    method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: cle, p_data: matchs.map(({ titre, ...m }) => ({ ...m, kickoff: m.kickoff.toISOString() })) })
  });
  console.log('envoi → ' + r.status + ' ' + await r.text());
})();
