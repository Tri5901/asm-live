// Notifications des demandes « responsable score » : appelé par le téléphone du demandeur juste après sa demande
// (→ responsables de l'équipe et admins), puis par celui qui accepte ou refuse (→ le demandeur).
// La base choisit les destinataires et n'accepte qu'un envoi par étape (fonction demande_notify_targets).
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

  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/demande_notify_targets', {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id })
  });
  if (!r.ok) return res.status(r.status === 401 ? 401 : 403).json({ error: 'refusé' });
  const targets = await r.json();
  if (!Array.isArray(targets) || !targets.length) return res.json({ sent: 0 });

  webpush.setVapidDetails('https://asm-live.vercel.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  let sent = 0;
  await Promise.all(targets.map(async s => {
    const payload = JSON.stringify({ title: s.titre, body: s.texte, url: s.url, tag: 'demande-score-' + id });
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }); sent++; }
    catch (e) { /* téléphone désabonné : ignoré */ }
  }));
  res.json({ sent });
};
