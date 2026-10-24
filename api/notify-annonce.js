// Annonce ponctuelle aux abonnés d'un match (ex. « le match commence dans 2 h »), envoyée depuis le PC
// (scripts/annonce.js) avec la clé des classements ; « essai: true » compte les téléphones sans rien envoyer.
const webpush = require('web-push');

const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const VAPID_PUBLIC = 'BHA2nAZhD5cIT_AR11aLFpXaH9RZyg32nn5W088Es3meXzr0aBAfM6gCCW1lgR7ZTOoKIofXqjZml7s8Prmyh80';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const b = req.body || {};
  const ok = s => typeof s === 'string' && s.trim() && s.length <= 300;
  if (!ok(b.cle) || !/^[0-9a-f-]{36}$/.test(b.match_id || '') || !ok(b.titre) || !ok(b.texte)) return res.status(400).json({ error: 'requête invalide' });
  if (!process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'clé VAPID manquante' });

  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/annonce_targets', {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: b.cle, p_match: b.match_id })
  });
  if (!r.ok) return res.status(403).json({ error: 'refusé' });
  const targets = await r.json();
  if (!Array.isArray(targets)) return res.status(500).json({ error: 'réponse inattendue' });
  if (b.essai) return res.json({ cibles: targets.length });

  webpush.setVapidDetails('https://asm-live.vercel.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({ title: b.titre.trim(), body: b.texte.trim(), url: '/#/match/' + b.match_id, tag: 'annonce-' + b.match_id });
  let sent = 0;
  await Promise.all(targets.map(async s => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' }); sent++; }
    catch (e) { /* téléphone désabonné : ignoré */ }
  }));
  res.json({ cibles: targets.length, sent });
};
