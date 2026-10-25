// Prévient les admins (notification) de ce qu'un compte vient de faire. Une seule fonction pour deux cas
// (l'offre Vercel gratuite limite le nombre de fonctions) :
//  - sans corps : compte qui vient d'être créé ; appelé par le téléphone du nouveau compte juste après l'inscription,
//    la base n'accepte qu'un seul envoi par compte, dans les 15 minutes qui suivent sa création (signup_notify_targets) ;
//  - { type: 'nom', id } : demande de changement de nom ; appelé par le téléphone du demandeur juste après sa demande,
//    la base n'accepte qu'un seul envoi par demande (nom_notify_targets, supabase/nom-validation.sql).
const webpush = require('web-push');

const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const VAPID_PUBLIC = 'BHA2nAZhD5cIT_AR11aLFpXaH9RZyg32nn5W088Es3meXzr0aBAfM6gCCW1lgR7ZTOoKIofXqjZml7s8Prmyh80';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const b = req.body || {}, nom = b.type === 'nom';
  if (!token || (nom && !/^[0-9a-f-]{36}$/i.test(String(b.id || '')))) return res.status(400).json({ error: 'requête invalide' });
  if (!process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'clé VAPID manquante' });

  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + (nom ? 'nom_notify_targets' : 'signup_notify_targets'), {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: nom ? JSON.stringify({ p_id: b.id }) : '{}'
  });
  if (!r.ok) return res.status(r.status === 401 ? 401 : 403).json({ error: 'refusé' });
  const targets = await r.json();
  if (!Array.isArray(targets) || !targets.length) return res.json({ sent: 0 });

  webpush.setVapidDetails('https://asm-live.vercel.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  let payload;
  if (nom){
    const { nom_avant, nom_apres } = targets[0];
    payload = JSON.stringify({
      title: '✏️ Changement de nom à valider',
      body: `${nom_avant || 'Un compte'} demande à s’appeler ${nom_apres}. À accepter ou refuser dans Accès.`,
      url: '/#/admin',
      tag: 'nom-' + b.id
    });
  } else {
    const { nom: n, email } = targets[0];
    payload = JSON.stringify({
      title: '👤 Nouveau compte',
      body: `${n}${n !== email ? ' (' + email + ')' : ''} s’est inscrit : il est supporter. Valide-le en choisissant son rôle dans Accès.`,
      url: '/#/admin',
      tag: 'compte-' + email
    });
  }
  let sent = 0;
  await Promise.all(targets.map(async s => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }); sent++; }
    catch (e) { /* téléphone désabonné : ignoré */ }
  }));
  res.json({ sent });
};
