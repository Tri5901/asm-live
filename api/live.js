// Live vidéo des tirs au but (LiveKit Cloud). Une « salle » par match : match-<id>.
//  - regarder : n'importe qui (même sans compte), seulement si un live est en cours → jeton lecture seule ;
//  - filmer   : un compte connecté, pendant les tirs au but, une seule personne à la fois (vérifié en base : live_demarrer) ;
//  - couper   : celui qui filme, ou le responsable score / responsable d'équipe / admin (live_arreter) → la salle est fermée.
// Clés dans les variables d'environnement Vercel (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET), jamais envoyées au téléphone.
const crypto = require('crypto');

const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';

const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jeton(claims, dureeS){
  const now = Math.floor(Date.now() / 1000);
  const corps = { iss: process.env.LIVEKIT_API_KEY, nbf: now - 10, exp: now + dureeS, ...claims };
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64u(JSON.stringify(corps));
  const sig = crypto.createHmac('sha256', process.env.LIVEKIT_API_SECRET).update(h + '.' + p).digest();
  return h + '.' + p + '.' + b64u(sig);
}
async function rpc(nom, args, token){
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + nom, { method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + (token || SUPABASE_KEY), 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return res.status(500).json({ error: 'live non configuré' });
  const matchId = req.body && req.body.match, action = req.body && req.body.action;
  if (!/^[0-9a-f-]{36}$/i.test(String(matchId || '')) || !['regarder', 'filmer', 'couper'].includes(action)) return res.status(400).json({ error: 'requête invalide' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const salle = 'match-' + matchId;

  if (action === 'regarder'){
    const r = await fetch(`${SUPABASE_URL}/rest/v1/matches?id=eq.${matchId}&select=live_at`, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } });
    const m = (await r.json().catch(() => []))[0];
    if (!m || !m.live_at || Date.now() - new Date(m.live_at).getTime() > 60000) return res.status(404).json({ error: 'pas de live en cours' });
    const id = 'spectateur-' + crypto.randomBytes(6).toString('hex');
    return res.json({ url: LIVEKIT_URL, token: jeton({ sub: id, video: { room: salle, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false } }, 4 * 3600) });
  }

  if (!token) return res.status(401).json({ error: 'il faut un compte' });
  if (action === 'filmer'){
    const d = await rpc('live_demarrer', { p_match: matchId }, token);
    if (!d.ok) return res.status(409).json({ error: (d.body && d.body.message) || 'refusé' });
    const u = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token } }).then(r => r.json()).catch(() => null);
    if (!u || !u.id) return res.status(401).json({ error: 'il faut un compte' });
    return res.json({ url: LIVEKIT_URL, token: jeton({ sub: 'filmeur-' + u.id, video: { room: salle, roomJoin: true, canPublish: true, canSubscribe: false, canPublishData: false } }, 3 * 3600) });
  }

  // couper : vérifié en base, puis la salle est fermée chez LiveKit (tout le monde est déconnecté)
  const c = await rpc('live_arreter', { p_match: matchId }, token);
  if (!c.ok || c.body !== true) return res.status(403).json({ error: 'refusé' });
  const admin = jeton({ video: { roomCreate: true, roomAdmin: true, room: salle } }, 120);
  await fetch(LIVEKIT_URL.replace(/^wss/, 'https') + '/twirp/livekit.RoomService/DeleteRoom', { method: 'POST',
    headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ room: salle }) }).catch(() => {});
  res.json({ ok: true });
};
