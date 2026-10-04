// Vérification de tous les matchs (championnat et coupes), utilisé par la tâche programmée « Matchs ASM » (lundi et mercredi).
//   node scripts/verif-horaires.js pages                     → pages « Résultats / calendrier » FFF de chaque équipe (« numéro adresse »)
//   node scripts/verif-horaires.js comparer <json>           → affiche les différences entre la FFF et le site
//   node scripts/verif-horaires.js corriger <json> [niveaux|-] [lieux] → idem, puis met le site comme sur la FFF :
//        horaires changés, matchs nouveaux sur la FFF (ex. tour de coupe tiré), logos d'adversaires manquants,
//        niveau des adversaires en coupe, stade et adresse des matchs à l'extérieur (bouton Waze).
//        Un niveau introuvable est signalé par une ligne « A_CHERCHER <adresse> » : on relève le championnat sur
//        cette page FFF et on relance avec le fichier niveaux { "<adresse>": "<texte relevé>" }.
//        Un lieu à relever est signalé par « A_LIEU <adresse du match> » : on relève le lieu sur la page du match
//        et on relance avec le fichier lieux { "<adresse du match>": ["STADE …", "RUE …", "44150 VILLE"] } (« - » si pas de fichier niveaux).
// Format du JSON : { "1": [["DIM 07 FÉV 2027 - 15H00", "Régional 3 - Senior Journée 12", "516995", "MESANGER AS", "502138", "THOUARE US", "/competition/club/…/equipe/…", "/competition/club/…/equipe/…", "/competition/match/…"], ...], ... }
//   (date, compétition, code club et nom du recevant, code club et nom du visiteur, pages FFF des deux équipes, page du match ;
//    l'ancien format [date, "A - B", compétition] est encore accepté)
// La clé secrète est lue dans C:\Users\Utilisateur\.asm-live\classements.key (jamais dans le dépôt).
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = 'https://xzzttulqlydcespgkpnx.supabase.co';
const KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const CLUB = '516995';
const LOGO = code => 'https://cdn-transverse.azureedge.net/phlogos/BC' + code + '.jpg';
const MOIS = { JAN: 1, FEV: 2, 'FÉV': 2, MAR: 3, AVR: 4, MAI: 5, JUN: 6, JUIN: 6, JUI: 7, JUIL: 7, AOU: 8, 'AOÛ': 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12, 'DÉC': 12 };

// heure de Paris → instant UTC (gère l'heure d'été)
function parisToUTC(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = n => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' }).formatToParts(new Date(n)).find(x => x.type === 'timeZoneName').value; const m = p.match(/GMT([+-]\d+)?/); return (m && m[1] ? +m[1] : 0) * 3600000; };
  return new Date(guess - off(guess - off(guess)));
}
const fmt = t => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const tour = n => (+n === 1 ? '1er' : n + 'e') + ' tour';

// nom de la compétition comme sur le site, à partir du libellé FFF
function compSite(comp, champ) {
  const c = String(comp || '');
  const j = c.match(/Journ[ée]e\s+(\d+)/i);
  const t = c.match(/(\d+)\s*(?:er|ème|e)\s*tour|tour\s*(\d+)/i);
  const n = t && (t[1] || t[2]);
  if (/coupe de france/i.test(c)) return n && 'Coupe de France · ' + tour(n);
  if (/pays de la loire/i.test(c)) return n && 'Coupe des Pays de la Loire · ' + tour(n);
  if (/challenge du district/i.test(c)) return n && 'Challenge du District · ' + tour(n);
  if (/coupe du district/i.test(c)) return n && 'Coupe du District · ' + tour(n);
  if (j && champ) return champ + ' · J' + j[1];
  return null;
}
function niveauDe(t) {
  const c = String(t || '').replace(/ajouter au favoris/i, '').trim();
  let m;
  if ((m = c.match(/D[ée]partemental\s+(\d+)/i))) return 'District ' + m[1];
  if ((m = c.match(/R[ée]gional\s+(\d+)/i))) return 'Régional ' + m[1];
  if ((m = c.match(/National\s+(\d+)/i))) return 'National ' + m[1];
  return c.split(/\s+/).slice(0, 3).join(' ') || null;
}
const titre = s => String(s || '').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

async function pages() {
  const r = await fetch(URL_ + '/rest/v1/equipes?select=id,nom,fff_classement&actif=eq.true&fff_classement=not.is.null&order=cat_ordre,ordre', { headers: H });
  (await r.json()).forEach(e => console.log(e.id + ' ' + e.fff_classement.replace(/\/classement$/, '/resultat-calendrier') + '   (' + e.nom + ')'));
}

// « STADE CHARLES ARDOUX 2 » → « Stade Charles Ardoux 2 » ; adresse sur une ligne
const lieuDe = l => {
  const t = (Array.isArray(l) ? l : String(l || '').split('\n')).map(x => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean);
  // petits mots en minuscules sauf en début de ligne : « Route D Avessac » → « Route d'Avessac »
  // (pas après le code postal : « 44850 Le Cellier »)
  const petits = x => x.replace(/([^\s\d]) (D|L) (?=\p{L})/gu, (m, c, w) => c + ' ' + w.toLowerCase() + "'")
    .replace(/([^\s\d]) (De|Des|Du|La|Le|Les|Et|Sur|Sous|En|Aux?)(?= )/g, (m, c, w) => c + ' ' + w.toLowerCase());
  const joli = x => petits(petits(titre(x)).replace(/ L'(\p{L})/gu, (m, c) => " l'" + c.toUpperCase()));   // deux passes : « De La Haie »
  return t.length >= 2 ? { lieu: joli(t[0]), adresse: t.slice(1).map(joli).join(', ') } : null;
};
const pageMatch = u => String(u || '').replace(/^https:\/\/epreuves\.fff\.fr/, '').replace(/\/match$/, '');

async function ecarts(file, fichNiv, fichLieux) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const niv = fichNiv && fichNiv !== '-' ? JSON.parse(fs.readFileSync(fichNiv, 'utf8')) : {};
  const lieux = {};
  if (fichLieux) Object.entries(JSON.parse(fs.readFileSync(fichLieux, 'utf8'))).forEach(([u, l]) => { lieux[pageMatch(u)] = lieuDe(l); });
  // équipes des poules de nos équipes (classements) : leur niveau est celui de notre équipe dans cette poule
  const cls = await (await fetch(URL_ + '/rest/v1/classements?select=equipe,lignes', { headers: H })).json();
  const r = await fetch(URL_ + '/rest/v1/matches?select=id,equipe,competition,kickoff,status,club_side,home_name,away_name,opp_logo,opp_niveau,lieu,adresse,fff_match', { headers: H });
  const tous = await r.json();
  const champDe = eq => ((tous.find(x => x.equipe === eq && / · J\d+$/.test(x.competition)) || {}).competition || '').replace(/ · J\d+$/, '') || null;
  // nom des adversaires déjà connus sur le site, par code club FFF (sans le numéro d'équipe réserve)
  const nomClub = {};
  tous.forEach(m => { const c = (m.opp_logo || '').match(/BC(\d+)\./); if (c) nomClub[c[1]] ||= (m.club_side === 'H' ? m.away_name : m.home_name).replace(/\s+\d+$/, ''); });
  const out = [];
  const maintenant = Date.now();
  for (const [eq, list] of Object.entries(data)) {
    const duSite = tous.filter(x => String(x.equipe) === String(eq));
    const champ = (duSite.find(x => / · J\d+$/.test(x.competition)) || {}).competition?.replace(/ · J\d+$/, '');
    const nous = (duSite.find(x => x.club_side) || {});
    const nomNous = nous.club_side === 'H' ? nous.home_name : nous.away_name;
    for (const row of list) {
      let quand, comp, cDom, nDom, cExt, nExt, uDom, uExt, uMatch;
      if (row.length >= 6) [quand, comp, cDom, nDom, cExt, nExt, uDom, uExt, uMatch] = row;
      else { [quand, , comp] = row; [nDom, nExt] = String(row[1]).split(' - '); }
      if (/EXEMPT/i.test(nDom + ' ' + nExt)) continue;
      const appComp = compSite(comp, champ);
      const m = String(quand).toUpperCase().match(/(\d{1,2})\s+([A-ZÉÛ]+)\.?\s+(\d{4})\s*-\s*(\d{1,2})H(\d{2})/);
      if (!appComp || !m || !MOIS[m[2]]) continue;                     // compétition inconnue ou pas d'heure
      const fff = parisToUTC(+m[3], MOIS[m[2]], +m[1], +m[4], +m[5]);
      const site = duSite.find(x => x.competition === appComp);
      const domNous = cDom ? cDom === CLUB : /MESANGER/i.test(nDom);
      const cAdv = domNous ? cExt : cDom, nAdv = domNous ? nExt : nDom, uAdv = domNous ? uExt : uDom;
      // niveau de l'adversaire (coupes seulement)
      const coupe = !/ · J\d+$/.test(appComp);
      const nivAdv = () => {
        const p = cls.find(c => (c.lignes || []).some(l => l[10] === cAdv && String(l[1]).toUpperCase() === String(nAdv).toUpperCase()));
        if (p) return champDe(p.equipe);
        // la page relevée peut se terminer par /equipe : on compare sans ce suffixe
        const base = u => String(u).replace(/^https:\/\/epreuves\.fff\.fr/, '').replace(/\/(equipe|resultat-calendrier)$/, '');
        const u = uAdv && Object.keys(niv).find(k => base(k) === base(uAdv));
        return u ? niveauDe(niv[u]) : null;
      };
      if (!site) {
        if (fff.getTime() < maintenant || !cAdv) continue;               // déjà passé, ou adversaire inconnu : rien à ajouter
        const num = (String(nAdv).match(/\s(\d+)$/) || [])[1];
        const adv = nomClub[cAdv] ? nomClub[cAdv] + (num ? ' ' + num : '') : titre(nAdv);
        const n = coupe ? nivAdv() : null;
        if (coupe && !n && uAdv) out.push({ type: 'chercher', url: 'https://epreuves.fff.fr' + uAdv });
        out.push({ type: 'ajout', eq, comp: appComp, kickoff: fff.toISOString(), club_side: domNous ? 'H' : 'A',
          home_name: domNous ? nomNous : adv, away_name: domNous ? adv : nomNous, opp_logo: LOGO(cAdv), opp_niveau: n });
        continue;
      }
      // page du match sur la FFF (pour relever ensuite la compo adverse sur la feuille de match), même pour un match joué
      if (uMatch && site.fff_match !== pageMatch(uMatch)) out.push({ type: 'fff', id: site.id, fff_match: pageMatch(uMatch) });
      if (site.status !== 'prevu') continue;                               // match commencé ou terminé : on n'y touche pas
      if (new Date(site.kickoff).getTime() !== fff.getTime())
        out.push({ type: 'horaire', id: site.id, eq, comp: appComp, site: site.kickoff, kickoff: fff.toISOString(), equipes: site.home_name + ' – ' + site.away_name });
      if (coupe && !site.opp_niveau) {
        const n = nivAdv();
        if (n) out.push({ type: 'niveau', id: site.id, eq, comp: appComp, opp_niveau: n, equipes: site.home_name + ' – ' + site.away_name });
        else if (uAdv) out.push({ type: 'chercher', url: 'https://epreuves.fff.fr' + uAdv });
      }
      // lieu des matchs à l'extérieur : relevé dans les 3 semaines, revérifié dans les 4 derniers jours (terrain changé)
      const dans = new Date(site.kickoff).getTime() - maintenant;
      if (!domNous && uMatch && dans < 21 * 86400000 && (!site.adresse || dans < 4 * 86400000)) {
        const l = lieux[pageMatch(uMatch)];
        if (!l) out.push({ type: 'chercher_lieu', url: 'https://epreuves.fff.fr' + pageMatch(uMatch) });
        else if (l.lieu !== site.lieu || l.adresse !== site.adresse)
          out.push({ type: 'lieu', id: site.id, eq, comp: appComp, lieu: l.lieu, adresse: l.adresse, equipes: site.home_name + ' – ' + site.away_name });
      }
      if (!site.opp_logo && cAdv)
        out.push({ type: 'logo', id: site.id, eq, comp: appComp, opp_logo: LOGO(cAdv), equipes: site.home_name + ' – ' + site.away_name });
    }
  }
  return out;
}

async function comparer(file, corriger, fichNiv, fichLieux) {
  const tout = await ecarts(file, fichNiv, fichLieux);
  const chercher = [...new Set(tout.filter(x => x.type === 'chercher').map(x => x.url))];
  const chercherLieu = [...new Set(tout.filter(x => x.type === 'chercher_lieu').map(x => x.url))];
  const out = tout.filter(x => x.type !== 'chercher' && x.type !== 'chercher_lieu');
  const liens = out.filter(x => x.type === 'fff').length;
  out.filter(x => x.type !== 'fff').forEach(x => console.log(
    x.type === 'horaire' ? `HORAIRE équipe ${x.eq} ${x.comp} ${x.equipes} : site ${fmt(x.site)} → FFF ${fmt(x.kickoff)}`
    : x.type === 'ajout' ? `NOUVEAU équipe ${x.eq} ${x.comp} ${x.home_name} – ${x.away_name} (${fmt(x.kickoff)})${x.opp_niveau ? ', adversaire en ' + x.opp_niveau : ''}`
    : x.type === 'niveau' ? `NIVEAU équipe ${x.eq} ${x.comp} ${x.equipes} : adversaire en ${x.opp_niveau}`
    : x.type === 'lieu' ? `LIEU équipe ${x.eq} ${x.comp} ${x.equipes} : ${x.lieu}, ${x.adresse}`
    : `LOGO équipe ${x.eq} ${x.comp} ${x.equipes} : logo de l’adversaire ajouté`));
  chercher.forEach(u => console.log('A_CHERCHER ' + u));
  chercherLieu.forEach(u => console.log('A_LIEU ' + u));
  if (liens) console.log('LIENS ' + liens + ' page(s) de match FFF enregistrée(s) (pour les compos adverses)');
  if (out.length === liens && !chercher.length && !chercherLieu.length) console.log('OK tout est à jour');
  if (corriger && out.length) {
    const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
    const p_data = out.map(x => x.type === 'ajout'
      ? { type: 'ajout', equipe: +x.eq, competition: x.comp, kickoff: x.kickoff, club_side: x.club_side, home_name: x.home_name, away_name: x.away_name, opp_logo: x.opp_logo, opp_niveau: x.opp_niveau }
      : x.type === 'horaire' ? { type: 'horaire', id: x.id, kickoff: x.kickoff }
      : x.type === 'niveau' ? { type: 'niveau', id: x.id, opp_niveau: x.opp_niveau }
      : x.type === 'lieu' ? { type: 'lieu', id: x.id, lieu: x.lieu, adresse: x.adresse }
      : x.type === 'fff' ? { type: 'fff', id: x.id, fff_match: x.fff_match } : { type: 'logo', id: x.id, opp_logo: x.opp_logo });
    const r = await fetch(URL_ + '/rest/v1/rpc/maj_matchs', { method: 'POST', headers: H, body: JSON.stringify({ p_secret: secret, p_data }) });
    const t = await r.text();
    if (!r.ok) throw new Error('refus : ' + t);
    console.log('CORRIGE ' + t + ' modification(s) faite(s) sur le site');
  }
}

const [cmd, arg, arg2, arg3] = process.argv.slice(2);
(cmd === 'pages' ? pages() : cmd === 'comparer' ? comparer(arg, false, arg2, arg3) : cmd === 'corriger' ? comparer(arg, true, arg2, arg3) : Promise.reject(new Error('usage : pages | comparer <json> [niveaux|-] [lieux] | corriger <json> [niveaux|-] [lieux]')))
  .catch(e => { console.error('ERREUR ' + e.message); process.exit(1); });
