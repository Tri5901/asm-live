// Contenu et envoi d'une notification de but ou de carton (partagé par api/notify.js et le minuteur api/alerte-score.js).
// Fichier en « _ » : Vercel n'en fait pas une adresse publique.
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

// targets : abonnements déjà choisis (et l'événement marqué « notifié ») par la base ; oublier(endpoint) : téléphone désabonné
async function envoyerEvenement(eventId, targets, oublier){
  // Contenu : score à jour, minute, buteur
  const ev = (await rest(`/rest/v1/events?id=eq.${eventId}&select=*`)).body?.[0];
  if (!ev) return 0;
  const m = (await rest(`/rest/v1/matches?id=eq.${ev.match_id}&select=*`)).body?.[0];
  const goals = (await rest(`/rest/v1/events?match_id=eq.${ev.match_id}&k=eq.goal&select=t`)).body || [];
  const sc = s => goals.filter(g => g.t === s).length;
  const name = s => (s === 'H' ? m.home_name : m.away_name);
  const player = ev.n ? ((m.rosters?.[ev.t] || []).find(p => p.n === String(ev.n))?.name || '') : '';
  const clubGoal = ev.t === (m.club_side || 'H');
  const nous = name(m.club_side || 'H');
  // le score d'abord, à part des noms d'équipe (« Mauves 2 0 – 1 Mésanger B » se lisait mal)
  // les notifs n'ont pas de gras : chiffres « gras » Unicode (𝟬-𝟵) pour les buts de Mésanger
  const gras = n => String(n).replace(/[0-9]/g, c => String.fromCodePoint(0x1D7EC + +c));
  const cs = m.club_side || 'H', pts = t => t === cs ? gras(sc(t)) : String(sc(t));
  const score = `Score ${pts('H')}-${pts('A')} · ${name('H')} contre ${name('A')} · ${ev.min}`;
  const qui = ev.n === 'CSC' ? ' · contre son camp' : ev.n && clubGoal ? ` · n°${ev.n}${player ? ' ' + player : ''}` : '';
  // carton : une phrase claire, le joueur dès le titre (« 🟨 Carton jaune pour Valentin Gicqueau »)
  const CARTON = { yellow: ['🟨', 'Carton jaune', 'prend un carton jaune'], white: ['⬜', 'Carton blanc', 'prend un carton blanc'], red: ['🟥', 'Carton rouge', 'est exclu (carton rouge)'] };
  const carton = CARTON[ev.k];
  const qui2 = player || (ev.n ? `Le n°${ev.n}` : '');
  const scoreSeul = `Score ${pts('H')}-${pts('A')} · ${name('H')} contre ${name('A')}`;
  // but de Mésanger ou but encaissé : ça doit se voir dès le titre
  const payload = JSON.stringify(carton ? {
    title: `${carton[0]} ${carton[1]} pour ${player || name(ev.t)}`,
    body: (qui2 ? `${qui2}${player && ev.n ? ` (n°${ev.n})` : ''} ${ev.t === (m.club_side || 'H') ? '' : `(${name(ev.t)}) `}${carton[2]}` : `${name(ev.t)} : ${carton[1].toLowerCase()}`)
      + ` à la ${ev.min}.\n${scoreSeul}`,
    url: `/#/match/${m.id}`,
    tag: `carton-${ev.id}`,
    team: m.equipe || 1
  } : {
    title: clubGoal ? `⚽ BUT DE MÉSANGER ! (${nous})` : `❌ But encaissé par ${nous}`,
    body: (clubGoal ? '' : `${name(ev.t)} marque · `) + score + qui,
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
      if ((e.statusCode === 404 || e.statusCode === 410) && oublier) await oublier(s.endpoint);
    }
  }));
  return sent;
}
module.exports = { envoyerEvenement, rest };
