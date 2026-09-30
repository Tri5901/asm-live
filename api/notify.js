// Envoi des notifications de but (Web Push).
// Appelé par le téléphone du délégué juste après l'enregistrement d'un but.
// La vérification "c'est bien un délégué" et le "une seule fois par but" sont faits en base (fonction push_targets).
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
  const eventId = req.body && req.body.event_id;
  if (!token || !/^[0-9a-f-]{36}$/i.test(String(eventId || ''))) return res.status(400).json({ error: 'requête invalide' });
  if (!process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'clé VAPID manquante' });

  // Destinataires (refusé si l'appelant n'est pas délégué ; vide si le but a déjà été notifié)
  const t = await rest('/rest/v1/rpc/push_targets', token, { method: 'POST', body: JSON.stringify({ p_event: eventId }) });
  if (!t.ok) return res.status(t.status === 401 ? 401 : 403).json({ error: 'refusé' });
  const targets = t.body || [];
  if (!targets.length) return res.json({ sent: 0 });

  // Contenu : score à jour, minute, buteur
  const ev = (await rest(`/rest/v1/events?id=eq.${eventId}&select=*`)).body?.[0];
  if (!ev) return res.json({ sent: 0 });
  const m = (await rest(`/rest/v1/matches?id=eq.${ev.match_id}&select=*`)).body?.[0];
  const goals = (await rest(`/rest/v1/events?match_id=eq.${ev.match_id}&k=eq.goal&select=t`)).body || [];
  const sc = s => goals.filter(g => g.t === s).length;
  const name = s => (s === 'H' ? m.home_name : m.away_name);
  const player = ev.n ? ((m.rosters?.[ev.t] || []).find(p => p.n === String(ev.n))?.name || '') : '';
  const clubGoal = ev.t === m.club_side;
  const payload = JSON.stringify({
    title: clubGoal ? `⚽ BUT pour ${name(ev.t)} !` : `But de ${name(ev.t)}`,
    body: `${name('H')} ${sc('H')} – ${sc('A')} ${name('A')} · ${ev.min}` + (ev.n === 'CSC' ? ' · contre son camp' : ev.n ? ` · n°${ev.n}${player ? ' ' + player : ''}` : ''),
    url: `/#/match/${m.id}`,
    tag: `but-${ev.id}`,
    team: m.equipe || 1
  });

  webpush.setVapidDetails('https://asm-live.vercel.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  let sent = 0;
  await Promise.all(targets.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 600, urgency: 'high' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await rest('/rest/v1/rpc/push_forget', token, { method: 'POST', body: JSON.stringify({ p_endpoint: s.endpoint }) });
    }
  }));
  res.json({ sent });
};
