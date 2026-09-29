// Prévient les admins (notification) quand un compte vient d'être créé.
// Appelé par le téléphone du nouveau compte juste après l'inscription ; la base n'accepte qu'un seul envoi
// par compte, dans les 15 minutes qui suivent sa création (fonction signup_notify_targets).
const webpush = require('web-push');

const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const VAPID_PUBLIC = 'BHA2nAZhD5cIT_AR11aLFpXaH9RZyg32nn5W088Es3meXzr0aBAfM6gCCW1lgR7ZTOoKIofXqjZml7s8Prmyh80';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(400).json({ error: 'requête invalide' });
  if (!process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'clé VAPID manquante' });

  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/signup_notify_targets', {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!r.ok) return res.status(r.status === 401 ? 401 : 403).json({ error: 'refusé' });
  const targets = await r.json();
  if (!Array.isArray(targets) || !targets.length) return res.json({ sent: 0 });

  webpush.setVapidDetails('https://asm-live.vercel.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  const { nom, email } = targets[0];
  const payload = JSON.stringify({
    title: '👤 Nouveau compte à valider',
    body: `${nom}${nom !== email ? ' (' + email + ')' : ''} attend ta validation.`,
    url: '/#/admin',
    tag: 'compte-' + email
  });
  let sent = 0;
  await Promise.all(targets.map(async s => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }); sent++; }
    catch (e) { /* téléphone désabonné : ignoré */ }
  }));
  res.json({ sent });
};
