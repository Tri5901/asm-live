// Notifications des tirs au but : « 🎯 Tirs au but ! » au début de la séance, puis le vainqueur à la fin du match.
// Appelé par le téléphone du responsable score ; la base vérifie qu'il gère le match et n'accepte qu'un envoi de chaque.
const webpush = require('web-push');

const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const VAPID_PUBLIC = 'BHA2nAZhD5cIT_AR11aLFpXaH9RZyg32nn5W088Es3meXzr0aBAfM6gCCW1lgR7ZTOoKIofXqjZml7s8Prmyh80';

async function rest(path, token, init = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...init,
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + (token || SUPABASE_KEY), 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const matchId = req.body && req.body.match, type = req.body && req.body.type;
  if (!token || !/^[0-9a-f-]{36}$/i.test(String(matchId || '')) || !['debut', 'fin'].includes(type)) return res.status(400).json({ error: 'requête invalide' });
  if (!process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'clé VAPID manquante' });

  const t = await rest('/rest/v1/rpc/tab_targets', token, { method: 'POST', body: JSON.stringify({ p_match: matchId, p_type: type }) });
  if (!t.ok) return res.status(t.status === 401 ? 401 : 403).json({ error: 'refusé' });
  const targets = t.body || [];
  if (!targets.length) return res.json({ sent: 0 });

  const m = (await rest(`/rest/v1/matches?id=eq.${matchId}&select=*`)).body?.[0];
  if (!m || !m.tab) return res.json({ sent: 0 });
  const goals = (await rest(`/rest/v1/events?match_id=eq.${matchId}&k=eq.goal&select=t`)).body || [];
  const sc = s => goals.filter(g => g.t === s).length;
  const name = s => (s === 'H' ? m.home_name : m.away_name);
  const cs = m.club_side || 'H', nous = name(cs);
  // bilan de la séance (mêmes règles que l'appli)
  const n = { H: 0, A: 0 }, b = { H: 0, A: 0 };
  (m.tab.tirs || []).forEach(x => { n[x.t]++; if (x.ok) b[x.t]++; });
  let g = null;
  if (n.H <= 5 && n.A <= 5){ if (b.H > b.A + (5 - n.A)) g = 'H'; else if (b.A > b.H + (5 - n.H)) g = 'A'; }
  else if (n.H === n.A && b.H !== b.A) g = b.H > b.A ? 'H' : 'A';
  const gras = v => String(v).replace(/[0-9]/g, c => String.fromCodePoint(0x1D7EC + +c));
  const pts = (o, s) => s === cs ? gras(o[s]) : String(o[s]);
  const matchTxt = `${name('H')} contre ${name('A')}`;

  let payload;
  if (type === 'debut') payload = { title: `🎯 Tirs au but ! (${nous})`, body: `Score ${pts({ H: sc('H'), A: sc('A') }, 'H')}-${pts({ H: sc('H'), A: sc('A') }, 'A')} · ${matchTxt} · séance de tirs au but` };
  else {
    if (!g) return res.json({ sent: 0 });
    payload = { title: g === cs ? `🏆 Qualifiés aux tirs au but ! (${nous})` : `❌ Éliminés aux tirs au but (${nous})`,
      body: `Tirs au but ${pts(b, 'H')}-${pts(b, 'A')} · ${matchTxt} (${sc('H')}-${sc('A')})` };
  }
  payload = JSON.stringify({ ...payload, url: `/#/match/${m.id}`, tag: `tab-${type}-${m.id}`, team: m.equipe || 1 });

  webpush.setVapidDetails('https://asm-live.vercel.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  let sent = 0;
  await Promise.all(targets.map(async s => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 600, urgency: 'high' }); sent++; }
    catch (e) { /* téléphone désabonné : ignoré */ }
  }));
  res.json({ sent });
};
