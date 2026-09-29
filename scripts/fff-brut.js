// Relevé brut des pages FFF « Le match » → format de scripts/import-fff.js, avec les noms complets de nos joueurs.
//   node scripts/fff-brut.js data/coupes-2026-fff-brut.json convocation.csv > data/coupes-2026-fff.json
// Noms complets : convocation Seniors (Google Sheets de asmfootball.fr, colonnes « n°, NOM Prénom » par équipe)
// + noms complets déjà connus (data/*-fff.json).
const fs = require('fs');
const [brutFile, csvFile] = process.argv.slice(2);
const brut = JSON.parse(fs.readFileSync(brutFile, 'utf8'));

const norm = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[-']/g, ' ').replace(/\s+/g, ' ').trim();
// joueurs connus : { prenom, nom, full (PRÉNOM NOM), equipes:Set }
const known = [];
const add = (prenom, nom, eq) => {
  const full = (prenom + ' ' + nom).toUpperCase();
  let k = known.find(x => norm(x.full) === norm(full));
  if (!k){ k = { prenom, nom, full, equipes: new Set() }; known.push(k); }
  if (eq) k.equipes.add(eq);
};
// convocation : ligne d'en-tête « Equipe A, Equipe B… », puis « n°, NOM Prénom » par équipe
const rows = fs.readFileSync(csvFile, 'utf8').split('\n').map(l => l.split(','));
rows.forEach(r => { for (let c = 1, eq = 1; c + 1 < r.length; c += 2, eq++){ const v = (r[c + 1] || '').trim().replace(/\s+/g, ' '); if (/^\d+$/.test((r[c] || '').trim()) && v){
  const w = v.split(' '); const k = w.findIndex(x => /[a-zà-ÿ]/.test(x)); add(w.slice(k).join(' '), w.slice(0, k).join(' '), eq); } } });
// noms donnés à la main / lus sur la tablette : data/joueurs-connus.json ([« NOM Prénom », équipe])
if (fs.existsSync('data/joueurs-connus.json')) JSON.parse(fs.readFileSync('data/joueurs-connus.json', 'utf8')).joueurs.forEach(([v, eq]) => { const w = v.split(' '); const k = w.findIndex(x => /[a-zà-ÿ]/.test(x)); add(w.slice(k).join(' '), w.slice(0, k).join(' '), eq); });
// noms complets déjà relevés (J2 corrigée, Coupe de France) : « PRÉNOM NOM » en majuscules
const fullFromFFF = (name, eq) => { if (/ [A-Z]\.$/.test(name) || name === 'ANONYME') return; const w = name.split(' '); add(w[0], w.slice(1).join(' '), eq); };
fs.readdirSync('data').filter(f => /-fff\.json$/.test(f) && !/brut/.test(f)).forEach(f => {
  JSON.parse(fs.readFileSync('data/' + f, 'utf8')).matches.forEach(m => m.rosters[m.club_side].forEach(p => fullFromFFF(p.name, m.equipe)));
});

const TEAM = { 'MESANGER AS': 1, 'MESANGER AS 2': 2, 'MESANGER AS 3': 3, 'MESANGER AS 4': 4, 'MESANGER AS 5': 5 };
const CLUB_NAME = ['AS Mésanger', 'AS Mésanger B', 'AS Mésanger C', 'AS Mésanger D', 'AS Mésanger E'];
const OPP = { 'ORVAULT RC': 'RC Orvault', 'TILLIERES ARC': 'ARC Tillières', 'BAULE POULIGUEN US': 'US La Baule-Le Pouliguen', 'ST GEREON REVEIL': 'Réveil St Géréon',
  'ST VINCENT LUSTVI 3': 'St Vincent Lustvi 3', 'PETIT AUVERNE SP': 'SP Petit-Auverne', 'NANTES ST FELIX CCS 2': 'CCS Nantes St Félix 2', 'NORT SUR ERDRE AC 4': 'AC Nort-sur-Erdre 4' };
const MOIS = { JAN: '01', 'FÉV': '02', FEV: '02', MAR: '03', AVR: '04', MAI: '05', JUIN: '06', JUIL: '07', 'AOÛ': '08', AOU: '08', SEP: '09', OCT: '10', NOV: '11', 'DÉC': '12', DEC: '12' };
const compLabel = c => {
  const tour = (c.match(/(\d+)(?:er|ème|e)\s+tour|TOUR\s+(\d+)/i) || []).slice(1).find(Boolean);
  const t = tour ? (tour === '1' ? '1er tour' : tour + 'e tour') : '';
  const name = /coupe de france/i.test(c) ? 'Coupe de France' : /pays de la loire/i.test(c) ? 'Coupe des Pays de la Loire' : /district/i.test(c) ? 'Coupe du District' : c.split(' - ')[0];
  return t ? name + ' · ' + t : name;
};

const doutes = [];
const out = brut.map(b => {
  const side = TEAM[b.home] ? 'H' : 'A', eq = TEAM[b.home] || TEAM[b.away], opp = side === 'H' ? b.away : b.home;
  const [, d, mo, y, hh, mm] = b.date.match(/(\d{1,2}) (\S+) (\d{4}) - (\d{2})H(\d{2})/);
  const mois = MOIS[mo.toUpperCase()] || MOIS[mo.toUpperCase().slice(0, 3)];
  const ros = t => b.rosters[t].map(s => { const [n, name, r] = s.split('|'); return { n, name, sub: r === 'R' }; });
  const rosters = { H: ros('H'), A: ros('A') };
  // nos joueurs : nom complet
  const ren = {};
  rosters[side].forEach(p => {
    const m = p.name.match(/^(.+?)\s+([A-Z])\.$/);
    if (!m){ // nom complet : forme de la convocation (accents, traits d'union)
      const k = known.find(k => norm(k.full) === norm(p.name));
      if (k && k.full !== p.name){ ren[p.name] = k.full; p.name = k.full; }
      return;
    }
    let c = known.filter(k => norm(k.prenom) === norm(m[1]) && norm(k.nom).startsWith(m[2]));
    if (c.length > 1 && c.some(k => k.equipes.has(eq))) c = c.filter(k => k.equipes.has(eq));
    if (c.length === 1){ ren[p.name] = c[0].full; p.name = c[0].full; }
    else doutes.push(`${CLUB_NAME[eq - 1]} ${b.date.slice(4, 14)} n°${p.n} ${p.name} : ${c.length ? c.map(k => k.full).join(' / ') : 'introuvable'}`);
  });
  const events = b.events.map(e => {
    const x = { min: e.min, kind: e.kind, t: e.t };
    ['who', 'in', 'out'].forEach(k => { if (e[k]) x[k] = e.t === side && ren[e[k]] ? ren[e[k]] : e[k].replace(/\bJOSEPH BONIFACE\b/, 'JOSEPH-BONIFACE'); });
    // buteur absent de sa propre équipe = but contre son camp : but compté, sans buteur
    if (x.kind === 'but' && !rosters[x.t].some(p => p.name === x.who)){ x.who = null; x.csc = true; }
    return x;
  });
  return { equipe: eq, competition: compLabel(b.comp), kickoff: `${y}-${mois}-${d.padStart(2, '0')}T${hh}:${mm}:00+02:00`, club_side: side,
    home_name: side === 'H' ? CLUB_NAME[eq - 1] : (OPP[opp] || opp), away_name: side === 'A' ? CLUB_NAME[eq - 1] : (OPP[opp] || opp),
    opp_code: +b.clubs[side === 'H' ? 1 : 0], score: [+b.sh, +b.sa], fff: b.fff, events, rosters };
});
if (doutes.length) console.error('À vérifier :\n' + doutes.join('\n'));
process.stdout.write(JSON.stringify({ _source: 'epreuves.fff.fr (pages « Le match »), relevé du 29/09/2026 ; noms complets : convocation Seniors du 27/09/2026 + relevés précédents', matches: out }, null, 1));
