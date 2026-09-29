// Transforme les matchs relevés sur epreuves.fff.fr (data/*.json) en matchs + actions de l'appli.
//   node scripts/import-fff.js data/j2-2026-fff.json sql     → SQL à exécuter dans Supabase
//   node scripts/import-fff.js data/j2-2026-fff.json apercu  → _fake.js pour l'aperçu local (rien n'est écrit en base)
const fs = require('fs');
const crypto = require('crypto');
const [file, mode] = process.argv.slice(2);
const src = JSON.parse(fs.readFileSync(file, 'utf8'));

const fmtNom = t => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (x, a, b) => a + b.toUpperCase());
const logo = c => 'https://cdn-transverse.azureedge.net/phlogos/BC' + c + '.jpg';

const out = src.matches.map(M => {
  const id = crypto.randomUUID();
  const rosters = { H: M.rosters.H.map(p => ({ n: p.n, name: fmtNom(p.name), sub: p.sub })), A: M.rosters.A.map(p => ({ n: p.n, name: fmtNom(p.name), sub: p.sub })) };
  const num = (t, name) => { const p = M.rosters[t].find(x => x.name === name); if (!p) throw new Error(`${M.competition} : ${name} absent de la compo ${t}`); return p.n; };
  const events = M.events.map((e, i) => {
    // minute inconnue (min null) : but connu mais pas sa minute
    const min = e.min == null ? '' : e.add ? `${e.min}+${e.add}'` : `${e.min}'`;
    const base = { id: crypto.randomUUID(), match_id: id, t: e.t, n: null, out_n: null, in_n: null, min, sort: e.min == null ? 0 : e.min + (e.add || 0) + i / 100, p: e.min > 45 ? 2 : 1 };
    if (e.kind === 'but') return { ...base, k: 'goal', n: e.csc ? 'CSC' : e.who ? num(e.t, e.who) : null }; // CSC = contre son camp adverse
    if (e.kind === 'changement') return { ...base, k: 'sub', out_n: num(e.t, e.out), in_n: num(e.t, e.in) };
    if (e.kind === 'avertissement') return { ...base, k: 'yellow', n: num(e.t, e.who) };
    return { ...base, k: 'red', n: num(e.t, e.who) };
  });
  // buts absents de la feuille (buteurs non saisis) : on complète pour garder le bon score
  ['H', 'A'].forEach((t, j) => {
    const have = events.filter(e => e.k === 'goal' && e.t === t).length;
    for (let g = have; g < M.score[j]; g++) events.push({ id: crypto.randomUUID(), match_id: id, t, k: 'goal', n: null, out_n: null, in_n: null, min: '', sort: 0, p: 1 });
    if (have > M.score[j]) throw new Error(`${M.competition} : plus de buts listés que le score`);
  });
  const match = { id, kickoff: M.kickoff, competition: M.competition, equipe: M.equipe, club_side: M.club_side, home_name: M.home_name, away_name: M.away_name,
    opp_logo: logo(M.opp_code), status: 'termine', period: 2, running: false, started_at: 0, acc: 45 * 60000, half: 45, rosters };
  return { match, events };
});

const q = v => v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
if (mode === 'sql'){
  let s = `-- Généré par scripts/import-fff.js depuis ${file} (${src._source})\n-- Ne pas exécuter deux fois.\n`;
  s += 'insert into public.matches (id, kickoff, competition, equipe, club_side, home_name, away_name, opp_logo, status, period, running, acc, rosters) values\n'
    + out.map(({ match: m }) => `(${[m.id, m.kickoff, m.competition, m.equipe, m.club_side, m.home_name, m.away_name, m.opp_logo, m.status, m.period, m.running, m.acc].map(q).join(', ')}, ${q(JSON.stringify(m.rosters))}::jsonb)`).join(',\n') + ';\n';
  s += 'insert into public.events (id, match_id, t, k, n, out_n, in_n, min, sort, p) values\n'
    + out.flatMap(o => o.events).map(e => `(${[e.id, e.match_id, e.t, e.k, e.n, e.out_n, e.in_n, e.min, e.sort, e.p].map(q).join(', ')})`).join(',\n') + ';\n';
  s += `select m.competition, m.home_name, m.away_name,
  (select count(*) from public.events e where e.match_id = m.id and e.k = 'goal' and e.t = 'H') || ' – ' ||
  (select count(*) from public.events e where e.match_id = m.id and e.k = 'goal' and e.t = 'A') as score,
  (select count(*) from public.events e where e.match_id = m.id) as actions
from public.matches m where m.id in (${out.map(o => q(o.match.id)).join(', ')}) order by m.equipe;\n`;
  process.stdout.write(s);
} else {
  process.stdout.write(`// APERÇU LOCAL UNIQUEMENT (généré) : ajoute ces matchs aux réponses de la base, sans rien écrire.
(() => {
  const rows = ${JSON.stringify(out.map(o => ({ delegue_id: null, delegue_nom: null, compo_cachee: false, ...o.match })))};
  const EV = ${JSON.stringify(out.flatMap(o => o.events))};
  const of = fetch;
  const json = d => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = async (url, opt) => {
    const u = String(url instanceof Request ? url.url : url);
    const res = await of(url, opt);
    if (!/\\/rest\\/v1\\/(matches|events)\\?/.test(u) || (opt && opt.method && opt.method !== 'GET')) return res;
    let data; try { data = await res.clone().json(); } catch (e) { return res; }
    const p = new URL(u).searchParams, one = !Array.isArray(data);
    if (u.includes('/matches?')){
      const id = (p.get('id') || '').replace('eq.', '');
      if (id){ const r = rows.filter(x => x.id === id); return r.length ? json(one ? r[0] : r) : res; }
      if (one) return res;
      const eq = (p.get('equipe') || '').replace('eq.', '');
      let add = rows.filter(r => !eq || String(r.equipe) === eq);
      if (p.get('status') === 'eq.prevu' || p.get('competition')) add = [];
      return json([...data, ...add]);
    }
    if (one) return res;
    const mid = (p.get('match_id') || '').replace('eq.', '');
    const add = mid ? EV.filter(e => e.match_id === mid) : p.get('k') === 'eq.goal' ? EV.filter(e => e.k === 'goal') : !p.get('k') ? EV : [];
    return json([...data, ...add]);
  };
})();
`);
}
