// Notifications « officiels » (délégués et arbitres bénévoles), envoyées depuis l'appli avec le jeton de la personne :
// désignations à prévenir, refus (→ coordinateurs), urgence (officiel absent), relance des dispos, postes retirés.
// La base vérifie les droits et choisit les destinataires (fonction officiels_push_targets).
const webpush = require('web-push');

const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const VAPID_PUBLIC = 'BHA2nAZhD5cIT_AR11aLFpXaH9RZyg32nn5W088Es3meXzr0aBAfM6gCCW1lgR7ZTOoKIofXqjZml7s8Prmyh80';
const TYPES = ['designe', 'refus', 'urgence', 'relance', 'retire'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const b = req.body || {};
  const users = Array.isArray(b.users) ? b.users.filter(u => /^[0-9a-f-]{36}$/i.test(String(u))).slice(0, 30) : null;
  if (!token || !/^[0-9a-f-]{36}$/i.test(String(b.match_id || '')) || !TYPES.includes(b.type)) return res.status(400).json({ error: 'requête invalide' });
  if (!process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'clé VAPID manquante' });

  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/officiels_push_targets', {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_match: b.match_id, p_type: b.type, p_users: users })
  });
  if (!r.ok) return res.status(r.status === 401 ? 401 : 403).json({ error: 'refusé' });
  const targets = await r.json();
  if (!Array.isArray(targets) || !targets.length) return res.json({ sent: 0 });

  webpush.setVapidDetails('https://asm-live.vercel.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  let sent = 0;
  await Promise.all(targets.map(async s => {
    const payload = JSON.stringify({ title: s.titre, body: s.texte, url: s.url, tag: 'officiels-' + b.type + '-' + b.match_id });
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: b.type === 'urgence' ? 'high' : 'normal' }); sent++; }
    catch (e) { /* téléphone désabonné : ignoré */ }
  }));
  res.json({ sent });
};
