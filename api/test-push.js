// Notification d'essai envoyée au seul téléphone qui la demande (il fournit son propre abonnement).
const webpush = require('web-push');
const VAPID_PUBLIC = 'BHA2nAZhD5cIT_AR11aLFpXaH9RZyg32nn5W088Es3meXzr0aBAfM6gCCW1lgR7ZTOoKIofXqjZml7s8Prmyh80';
// Seuls les services de notification des navigateurs sont acceptés
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const sub = req.body && req.body.subscription;
  let host = '';
  try { host = new URL(sub.endpoint).hostname; } catch (e) {}
  if (!sub || !sub.keys || !sub.keys.p256dh || !sub.keys.auth || !PUSH_HOSTS.test(host)) return res.status(400).json({ error: 'abonnement invalide' });
  if (!process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'clé VAPID manquante' });
  webpush.setVapidDetails('https://asm-live.vercel.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  try {
    await webpush.sendNotification(sub, JSON.stringify({
      title: '✅ Notifications activées',
      body: 'Tu recevras ici chaque but des équipes choisies.',
      url: '/', tag: 'essai'
    }), { TTL: 60, urgency: 'high' });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: 'envoi refusé par le service de notification', status: e.statusCode || null });
  }
};
