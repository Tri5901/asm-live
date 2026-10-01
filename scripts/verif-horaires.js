// Vérification des horaires des matchs de championnat, utilisé par la tâche programmée « Horaires ASM » (le lundi).
//   node scripts/verif-horaires.js pages                     → pages « Résultats / calendrier » FFF de chaque équipe (« numéro adresse »)
//   node scripts/verif-horaires.js comparer <json>           → affiche les écarts entre la FFF et le site
//   node scripts/verif-horaires.js corriger <json>           → idem, puis met les horaires du site comme sur la FFF
// Format du JSON : { "1": [["DIM 07 FÉV 2027 - 15H00", "MESANGER AS - THOUARE US", "Régional 3 - Senior Journée 12"], ...], "2": [...] }
// La clé secrète est lue dans C:\Users\Utilisateur\.asm-live\classements.key (jamais dans le dépôt).
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = 'https://xzzttulqlydcespgkpnx.supabase.co';
const KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const MOIS = { JAN: 1, FEV: 2, 'FÉV': 2, MAR: 3, AVR: 4, MAI: 5, JUN: 6, JUIN: 6, JUI: 7, JUIL: 7, AOU: 8, 'AOÛ': 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12, 'DÉC': 12 };

// heure de Paris → instant UTC (gère l'heure d'été)
function parisToUTC(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = n => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' }).formatToParts(new Date(n)).find(x => x.type === 'timeZoneName').value; const m = p.match(/GMT([+-]\d+)?/); return (m && m[1] ? +m[1] : 0) * 3600000; };
  return new Date(guess - off(guess - off(guess)));
}
const fmt = t => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function pages() {
  const r = await fetch(URL_ + '/rest/v1/equipes?select=id,nom,fff_classement&actif=eq.true&fff_classement=not.is.null&order=cat_ordre,ordre', { headers: H });
  (await r.json()).forEach(e => console.log(e.id + ' ' + e.fff_classement.replace(/\/classement$/, '/resultat-calendrier') + '   (' + e.nom + ')'));
}

async function ecarts(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = await fetch(URL_ + '/rest/v1/matches?select=id,equipe,competition,kickoff,home_name,away_name&status=eq.prevu', { headers: H });
  const prevus = await r.json();
  const out = [];
  for (const [eq, list] of Object.entries(data)) {
    for (const [quand, equipes, comp] of list) {
      const j = String(comp || '').match(/Journ[ée]e\s+(\d+)/i);
      if (!j || /coupe/i.test(comp)) continue;                       // championnat seulement
      const m = String(quand).toUpperCase().match(/(\d{1,2})\s+([A-ZÉÛ]+)\.?\s+(\d{4})\s*-\s*(\d{1,2})H(\d{2})/);
      if (!m || !MOIS[m[2]] || /EXEMPT/i.test(equipes)) continue;     // pas d'heure (exempt) : rien à comparer
      const fff = parisToUTC(+m[3], MOIS[m[2]], +m[1], +m[4], +m[5]);
      const site = prevus.find(x => String(x.equipe) === String(eq) && new RegExp('· J' + j[1] + '$').test(x.competition));
      if (!site) { out.push({ eq, j: j[1], manque: true, fff: fff.toISOString(), equipes }); continue; }
      if (new Date(site.kickoff).getTime() !== fff.getTime()) out.push({ id: site.id, eq, j: j[1], site: site.kickoff, fff: fff.toISOString(), equipes: site.home_name + ' – ' + site.away_name });
    }
  }
  return out;
}

async function comparer(file, corriger) {
  const out = await ecarts(file);
  const diff = out.filter(x => !x.manque), manque = out.filter(x => x.manque);
  diff.forEach(x => console.log(`ECART équipe ${x.eq} J${x.j} ${x.equipes} : site ${fmt(x.site)} → FFF ${fmt(x.fff)}`));
  manque.forEach(x => console.log(`ABSENT équipe ${x.eq} J${x.j} ${x.equipes} (${fmt(x.fff)}) : pas sur le site, à ajouter à la main`));
  if (!diff.length) console.log('OK aucun écart d’horaire');
  if (corriger && diff.length) {
    const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
    const r = await fetch(URL_ + '/rest/v1/rpc/corriger_horaires', { method: 'POST', headers: H, body: JSON.stringify({ p_secret: secret, p_data: diff.map(x => ({ id: x.id, kickoff: x.fff })) }) });
    const t = await r.text();
    if (!r.ok) throw new Error('refus : ' + t);
    console.log('CORRIGE ' + t + ' horaire(s) mis comme sur la FFF');
  }
}

const [cmd, arg] = process.argv.slice(2);
(cmd === 'pages' ? pages() : cmd === 'comparer' ? comparer(arg, false) : cmd === 'corriger' ? comparer(arg, true) : Promise.reject(new Error('usage : pages | comparer <json> | corriger <json>')))
  .catch(e => { console.error('ERREUR ' + e.message); process.exit(1); });
