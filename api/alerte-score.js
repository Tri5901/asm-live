// Notifications déclenchées par le minuteur de la base (pg_cron), avec une clé :
//  - « pas encore de responsable score » 1 h avant le match (toutes les 10 min) ;
//  - « coup d'envoi » ~30 s après le lancement d'un match (toutes les 30 s, seulement s'il y en a un) ;
//  - rappel ~15 min avant le match si notre compo n'est pas saisie ou s'il manque des numéros (responsables de l'équipe) ;
//  - rappel « Mi-temps ? » / « Match terminé ? » si le chrono dépasse 55 min en 1re ou 105 min en 2e mi-temps.
// La base choisit les matchs et les destinataires (une seule notification de chaque sorte par match).
const webpush = require('web-push');

const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
const VAPID_PUBLIC = 'BHA2nAZhD5cIT_AR11aLFpXaH9RZyg32nn5W088Es3meXzr0aBAfM6gCCW1lgR7ZTOoKIofXqjZml7s8Prmyh80';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const cle = req.body && req.body.cle;
  if (!cle || typeof cle !== 'string' || cle.length > 200) return res.status(400).json({ error: 'requête invalide' });
  if (!process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'clé VAPID manquante' });

  const appel = nom => fetch(SUPABASE_URL + '/rest/v1/rpc/' + nom, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_cle: cle })
  });
  const [r1, r2, r3, r4] = await Promise.all([appel('alerte_score_targets'), appel('debut_targets'), appel('compo_targets'), appel('chrono_targets')]);
  if (!r1.ok || !r2.ok) return res.status(403).json({ error: 'refusé' });
  const targets = [...await r1.json(), ...await r2.json(), ...(r3.ok ? await r3.json() : []), ...(r4.ok ? await r4.json() : [])];
  if (!Array.isArray(targets) || !targets.length) return res.json({ sent: 0 });

  webpush.setVapidDetails('https://asm-live.vercel.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  let sent = 0;
  await Promise.all(targets.map(async s => {
    const payload = JSON.stringify({ title: s.titre, body: s.texte, url: s.url, tag: 'alerte-score-' + s.url });
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 }); sent++; }
    catch (e) { /* téléphone désabonné : ignoré */ }
  }));
  res.json({ sent });
};
