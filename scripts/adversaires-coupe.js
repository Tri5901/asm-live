// Fiche « L'adversaire » des matchs de coupe (matches.adv_infos), utilisée par la tâche programmée « Matchs ASM ».
// En coupe, l'adversaire vient d'une autre poule (souvent d'un autre niveau) : on relève sur la FFF sa saison
// (championnat et coupes, avec le niveau des équipes qu'il a jouées en coupe) et son classement.
//   node scripts/adversaires-coupe.js liste <horaires.json>
//        → « COUPE <id du match> <page Saison FFF de l'adversaire> <page Classement> (équipe · compétition · adversaire) »
//          pour nos matchs de coupe à venir dans les 3 semaines (pages des équipes relevées dans horaires.json)
//   node scripts/adversaires-coupe.js envoyer <adversaires.json> [niveaux.json]
//        adversaires.json : { "<id du match>": { "saison": [lignes de la page Saison], "classement": [lignes du classement] } }
//          ligne de saison : [date, compétition, code et nom du recevant, code et nom du visiteur, pages des deux équipes,
//                             page du match, buts du recevant, buts du visiteur] (buts vides si pas joué)
//          ligne de classement : [rang, équipe, pts, joués, gagnés, nuls, perdus, buts pour, buts contre]
//        → « A_CHERCHER <page> » pour chaque équipe jouée en coupe dont le niveau est inconnu : relever son championnat
//          (même JavaScript que l'étape 3 bis des horaires), l'ajouter à niveaux.json et relancer.
//          Les fiches sont envoyées à chaque passage (clé secrète de classements.key, jamais affichée).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL_, H, estNous, MOIS, parisToUTC, compSite, niveauDe, titre } = require('./verif-horaires.js');

const FFF = 'https://epreuves.fff.fr';
// coupe FFF (pas un championnat, ni un match Loisirs ou amical, qui ne sont pas sur la FFF)
const coupe = c => !/ · J\d+$/.test(c || '') && !/loisirs|amical/i.test(c || '');
const norm = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
const base = u => String(u || '').replace(/^https:\/\/epreuves\.fff\.fr/, '').replace(/\/(equipe|saison|classement|resultat-calendrier)$/, '');
// « BAULE POULIGUEN US » → « Baule Pouliguen US »
const SIGLES = /^(Us|As|Fc|Sc|Af|Es|Ja|Ac|Cs|So|Vf|Sa|Rc|Gf|Js|Ufce|Usc|Asc|Scna|Rcasg|Aepr|Gj|Ea|Ss|Ol|Om)$/;
const joli = s => titre(String(s).replace(/\s+/g, ' ').trim()).split(' ').map(w => SIGLES.test(w) ? w.toUpperCase() : w).join(' ');
const quand = s => { const m = String(s).toUpperCase().match(/(\d{1,2})\s+([A-ZÉÛ]+)\.?\s+(\d{4})\s*-\s*(\d{1,2})H(\d{2})/); return m && MOIS[m[2]] ? parisToUTC(+m[3], MOIS[m[2]], +m[1], +m[4], +m[5]) : null; };
const json = async u => { const r = await fetch(URL_ + '/rest/v1/' + u, { headers: H }); if (!r.ok) throw new Error(await r.text()); return r.json(); };

async function liste(fich) {
  const data = JSON.parse(fs.readFileSync(fich, 'utf8'));
  const tous = await json('matches?select=id,equipe,competition,kickoff,status,club_side,home_name,away_name&status=eq.prevu');
  const visibles = new Set((await json('equipes?select=id&actif=eq.true')).map(e => e.id));   // catégories masquées : rien
  const now = Date.now();
  const aVenir = tous.filter(m => visibles.has(m.equipe) && coupe(m.competition) && new Date(m.kickoff) > now && new Date(m.kickoff) - now < 21 * 864e5);
  if (!aVenir.length) return console.log('AUCUN match de coupe dans les 3 semaines');
  for (const m of aVenir) {
    const row = (data[String(m.equipe)] || []).find(r => r.length >= 8 && compSite(r[1]) === m.competition);
    const adv = m.club_side === 'H' ? m.away_name : m.home_name;
    if (!row) { console.log(`SANS-PAGE ${m.id} (${m.competition} · ${adv})`); continue; }
    const u = base(estNous(row[2]) ? row[7] : row[6]);
    console.log(`COUPE ${m.id} ${FFF}${u}/saison ${FFF}${u}/classement (équipe ${m.equipe} · ${m.competition} · ${adv})`);
  }
}

async function envoyer(fich, fichNiv) {
  const data = JSON.parse(fs.readFileSync(fich, 'utf8'));
  const niv = fichNiv && fichNiv !== '-' && fs.existsSync(fichNiv) ? JSON.parse(fs.readFileSync(fichNiv, 'utf8')) : {};
  const tous = await json('matches?select=id,equipe,competition,kickoff,club_side,home_name,away_name,opp_logo');
  const cls = await json('classements?select=equipe,lignes');
  // noms déjà utilisés sur le site, par code club FFF (sans le numéro d'équipe réserve)
  const nomClub = {};
  tous.forEach(m => { const c = (m.opp_logo || '').match(/BC(\d+)\./); if (c) nomClub[c[1]] ||= (m.club_side === 'H' ? m.away_name : m.home_name).replace(/\s+\d+$/, ''); });
  const nomDe = (code, nom) => { const num = (String(nom).match(/\s(\d+)$/) || [])[1]; return nomClub[code] ? nomClub[code] + (num ? ' ' + num : '') : joli(nom); };
  const champDe = eq => ((tous.find(x => x.equipe === eq && / · J\d+$/.test(x.competition)) || {}).competition || '').replace(/ · J\d+$/, '').replace(/ · Phase \d+$/, '') || null;
  const chercher = new Set(), envois = [];
  const auj = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  for (const [id, d] of Object.entries(data)) {
    const m = tous.find(x => x.id === id);
    if (!m) { console.log('INCONNU ' + id); continue; }
    const cAdv = ((m.opp_logo || '').match(/BC(\d+)\./) || [])[1];
    const vus = new Set();
    const lignes = (d.saison || []).filter(r => r.length >= 11 && cAdv && (r[2] === cAdv || r[4] === cAdv) && !estNous(r[2]) && !estNous(r[4]))
      .filter(r => { const k = norm(r[0]) + '|' + r[2] + '|' + r[4]; if (vus.has(k)) return false; vus.add(k); return true; });
    // son championnat : « Régional 1 Intersport - Senior Journée 3 » → « Régional 1 »
    const lc = lignes.find(r => /journ[ée]e/i.test(r[1]) && !/amica/i.test(r[1]));
    const champ = lc ? niveauDe(lc[1].split(' - ')[0]) : null;
    const C = (d.classement || []).filter(r => r.length >= 9);
    const nomAdv = norm((lignes[0] || [])[lignes[0] && lignes[0][2] === cAdv ? 3 : 5]);
    const ligneCls = C.find(r => norm(r[1]) === nomAdv);
    const rangDe = nom => { const r = C.find(x => norm(x[1]) === norm(nom)); return r ? +r[0] : null; };
    const matchs = [], futurs = [];
    for (const r of lignes) {
      const t = quand(r[0]), comp = compSite(r[1], champ);
      if (!t || !comp) continue;                                   // amicaux, date illisible
      const dom = r[2] === cAdv, code = dom ? r[4] : r[2], nom = dom ? r[5] : r[3], page = dom ? r[7] : r[6];
      const joue = /^\d+$/.test(String(r[9]).trim()) && /^\d+$/.test(String(r[10]).trim());
      if (!joue) { futurs.push([t.toISOString(), comp, dom ? 1 : 0, nomDe(code, nom), code, rangDe(nom)]); continue; }
      // niveau de l'équipe jouée en coupe : poule d'une de nos équipes, même poule que l'adversaire, ou relevé sur sa page FFF
      let n = null;
      if (coupe(comp)) {
        const p = cls.find(c => (c.lignes || []).some(l => l[10] === code && norm(l[1]) === norm(nom)));
        if (p) n = champDe(p.equipe);
        else if (rangDe(nom)) n = champ;
        else { const k = page && Object.keys(niv).find(x => base(x) === base(page)); if (k) n = niveauDe(niv[k]); else if (page) chercher.add(FFF + base(page)); }
      }
      matchs.push([t.toISOString(), comp, dom ? 1 : 0, nomDe(code, nom), code, +(dom ? r[9] : r[10]), +(dom ? r[10] : r[9]), n]);
    }
    matchs.sort((a, b) => b[0].localeCompare(a[0]));
    futurs.sort((a, b) => a[0].localeCompare(b[0]));
    const prochain = futurs.find(f => new Date(f[0]) > Date.now() && new Date(f[0]) < new Date(m.kickoff)) || null;
    // notre forme relevée sur la FFF (équipe dont l'appli n'a pas les matchs, ex. U18 en Gambardella) :
    // d.nous = { code: "<n° de club FFF de notre équipe>", saison: [lignes de sa page Saison] } → 5 derniers résultats officiels
    let forme_nous = null;
    if (d.nous && Array.isArray(d.nous.saison)) {
      forme_nous = d.nous.saison.filter(r => /^\d+$/.test(String(r[9]).trim()) && /^\d+$/.test(String(r[10]).trim()) && compSite(r[1], 'x') && quand(r[0]))
        .map(r => { const dom = r[2] === d.nous.code, p = +(dom ? r[9] : r[10]), c = +(dom ? r[10] : r[9]); return [quand(r[0]).toISOString(), p > c ? 'V' : p < c ? 'D' : 'N']; })
        .sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5).map(x => x[1]);
    }
    const adv_infos = { maj: auj, champ,
      cls: ligneCls ? [+ligneCls[0], +ligneCls[2], +ligneCls[3], +ligneCls[4], +ligneCls[5], +ligneCls[6], +ligneCls[7], +ligneCls[8], C.length] : null,
      matchs: matchs.slice(0, 6), prochain, ...(forme_nous && forme_nous.length ? { forme_nous } : {}) };
    const advNom = m.club_side === 'H' ? m.away_name : m.home_name;
    const bilan = matchs.map(x => x[5] > x[6] ? 'V' : x[5] < x[6] ? 'D' : 'N').slice(0, 5).join('');
    console.log(`FICHE ${advNom} (${m.competition}) : ${champ || '?'}${ligneCls ? ', ' + ligneCls[0] + 'e' : ''}, forme ${bilan || '-'}, ${matchs.length} match(s) officiel(s)`);
    envois.push({ type: 'adv', id, adv_infos });
  }
  chercher.forEach(u => console.log('A_CHERCHER ' + u));
  if (!envois.length) return;
  if (process.env.ESSAI) return console.log(JSON.stringify(envois, null, 1));   // essai : rien n'est envoyé
  const secret = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
  const r = await fetch(URL_ + '/rest/v1/rpc/maj_matchs', { method: 'POST', headers: H, body: JSON.stringify({ p_secret: secret, p_data: envois }) });
  const t = await r.text();
  if (!r.ok) throw new Error('refus : ' + t);
  console.log('ENVOYE ' + t + ' fiche(s) mise(s) à jour sur le site');
}

const [cmd, a1, a2] = process.argv.slice(2);
(cmd === 'liste' ? liste(a1) : cmd === 'envoyer' ? envoyer(a1, a2) : Promise.reject(new Error('usage : liste <horaires.json> | envoyer <adversaires.json> [niveaux.json]')))
  .catch(e => { console.error('ERREUR ' + e.message); process.exit(1); });
