// Prévient les admins (notification) quand un compte demande à changer de nom.
// Appelé par le téléphone du demandeur juste après sa demande ; la base n'accepte qu'un seul envoi
// par demande (fonction nom_notify_targets, supabase/nom-validation.sql).
const webpush = require('web-push');

const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const VAPID_PUBLIC = 'BHA2nAZhD5cIT_AR11aLFpXaH9RZyg32nn5W088Es3meXzr0aBAfM6gCCW1lgR7ZTOoKIofXqjZml7s8Prmyh80';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const id = req.body && req.body.id;
  if (!token || !/^[0-9a-f-]{36}$/i.test(String(id || ''))) return res.status(400).json({ error: 'requête invalide' });
  if (!process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'clé VAPID manquante' });

  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/nom_notify_targets', {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id })
  });
  if (!r.ok) return res.status(r.status === 401 ? 401 : 403).json({ error: 'refusé' });
  const targets = await r.json();
  if (!Array.isArray(targets) || !targets.length) return res.json({ sent: 0 });

  webpush.setVapidDetails('https://asm-live.vercel.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  const { nom_avant, nom_apres } = targets[0];
  const payload = JSON.stringify({
    title: '✏️ Changement de nom à valider',
    body: `${nom_avant || 'Un compte'} demande à s’appeler ${nom_apres}. À accepter ou refuser dans Accès.`,
    url: '/#/admin',
    tag: 'nom-' + id
  });
  let sent = 0;
  await Promise.all(targets.map(async s => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }); sent++; }
    catch (e) { /* téléphone désabonné : ignoré */ }
  }));
  res.json({ sent });
};
