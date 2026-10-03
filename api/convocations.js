// Convocations du week-end → compos des matchs (sans numéros). Appelé le samedi par le minuteur de la base (pg_cron),
// avec une clé. Lit la feuille Google publiée sur asmfootball.fr/convocations/seniors, retrouve le match de chaque
// équipe à la date indiquée et envoie les noms à la base, qui ne remplit que les compos encore vides.
const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const FEUILLE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTRVvGcXBPj8hUXVcxWVH-9fnv0juykXnyFc79hu2C_J_dmNnZ209hxm1eqDdwjMsHfonsRB3dYjImv/pub?gid=1926192979&single=true&output=csv';
const H = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' };

// CSV simple (champs entre guillemets possibles)
function csv(t) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.map(r => r.map(x => x.replace(/\s+/g, ' ').trim()));
}
const cle = n => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const cap = w => w.toLowerCase().replace(/(^|[-' ])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
// « BENARD Romain » → « Romain Benard » (mots en majuscules = nom de famille)
const prenomNom = s => {
  const mots = s.split(' ').filter(Boolean);
  const nom = mots.filter(w => w === w.toUpperCase() && /\p{L}/u.test(w)), pre = mots.filter(w => !(w === w.toUpperCase() && /\p{L}/u.test(w)));
  return (pre.length && nom.length ? cap(pre.join(' ')) + ' ' + cap(nom.join(' ')) : cap(s)).trim();
};
const jourParis = iso => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const k = req.body && req.body.cle;
  if (!k || typeof k !== 'string' || k.length > 200) return res.status(400).json({ error: 'requête invalide' });

  const t = await (await fetch(FEUILLE)).text();
  const rows = csv(t);
  const tete = rows.find(r => r.some(c => /^Equipe\s+\S+/i.test(c)));
  if (!tete) return res.json({ compos: 0, info: 'feuille illisible' });
  const dateRow = rows.find(r => /^Date/i.test(r[0] || '')) || [];
  const cols = tete.map((c, i) => [i, (c.match(/^Equipe\s+(\S+)/i) || [])[1]]).filter(x => x[1]);

  const [equipes, matchs, connus] = await Promise.all([
    fetch(SUPABASE_URL + '/rest/v1/equipes?select=id,court,categorie', { headers: H }).then(r => r.json()),
    fetch(SUPABASE_URL + '/rest/v1/matches?select=id,equipe,kickoff,status,club_side&status=eq.prevu', { headers: H }).then(r => r.json()),
    fetch(SUPABASE_URL + '/rest/v1/matches?select=club_side,rosters&rosters=not.is.null', { headers: H }).then(r => r.json())
  ]);
  // orthographe déjà utilisée dans l'appli pour chaque joueur
  const vus = new Map();
  connus.forEach(m => ((m.rosters || {})[m.club_side] || []).forEach(p => {
    if (!p.name) return; const c = cle(p.name), e = vus.get(c) || {}; e[p.name] = (e[p.name] || 0) + 1; vus.set(c, e);
  }));
  const nomConnu = s => { const e = vus.get(cle(s)); return e ? Object.entries(e).sort((a, b) => b[1] - a[1])[0][0] : prenomNom(s); };

  const data = [], detail = [];
  for (const [c, court] of cols) {
    const eq = equipes.find(e => e.court === court && e.categorie === 'Seniors');
    const date = dateRow[c];
    if (!eq || !/^\d{2}\/\d{2}\/\d{4}$/.test(date || '')) continue;
    // le vendredi soir, la feuille peut encore montrer la convocation de la semaine passée :
    // on ne prend qu'un match à venir (dans les 3 jours) dont la date est exactement celle de la convocation
    const maintenant = Date.now();
    const m = matchs.find(x => x.equipe === eq.id && jourParis(x.kickoff) === date
      && new Date(x.kickoff).getTime() > maintenant && new Date(x.kickoff).getTime() < maintenant + 3 * 86400000);
    if (!m) { detail.push(court + ' : pas de match à venir le ' + date + ' (convocation ancienne ou autre date)'); continue; }
    const joueurs = rows.filter(r => /^\d+$/.test(r[c] || '') && (r[c + 1] || '').length > 1).map(r => nomConnu(r[c + 1]));
    if (joueurs.length) { data.push({ match_id: m.id, joueurs }); detail.push(court + ' : ' + joueurs.length + ' joueurs'); }
  }
  if (!data.length) return res.json({ compos: 0, detail });
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/convocations_compos', { method: 'POST', headers: H, body: JSON.stringify({ p_cle: k, p_data: data }) });
  if (!r.ok) return res.status(403).json({ error: 'refusé' });
  res.json({ compos: await r.json(), detail });
};
