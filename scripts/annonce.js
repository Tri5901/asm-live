// Annonce ponctuelle aux abonnés d'un match, envoyée à l'heure dite (Paris).
//   node scripts/annonce.js <id du match> "<HH:MM>" "<titre>" "<texte>" [essai]
// « essai » : compte les téléphones visés sans rien envoyer. Clé lue dans C:\Users\Utilisateur\.asm-live\classements.key.
const fs = require('fs'), path = require('path'), os = require('os');
const [id, heure, titre, texte, essai] = process.argv.slice(2);
if (!id || !/^\d{1,2}:\d{2}$/.test(heure || '') || !titre || !texte) { console.error('usage : annonce.js <match> <HH:MM> <titre> <texte> [essai]'); process.exit(1); }
const cle = fs.readFileSync(path.join(os.homedir(), '.asm-live', 'classements.key'), 'utf8').trim();
const envoyer = async () => {
  const r = await fetch('https://asm-live.vercel.app/api/notify-annonce', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cle, match_id: id, titre, texte, essai: essai === 'essai' }) });
  console.log(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }) + ' → ' + r.status + ' ' + await r.text());
};
if (essai === 'essai') envoyer();
else {
  // attente jusqu'à l'heure de Paris demandée (aujourd'hui) : l'horloge est relue toutes les 10 s,
  // un seul long minuteur prendrait du retard si le PC se met en veille
  const [h, m] = heure.split(':').map(Number);
  const hhmm = () => new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
  const minutes = () => { const [ph, pm] = hhmm(); return ph * 60 + pm; };
  const cible = h * 60 + m;
  // au réveil d'une veille, plus de 20 min de retard : l'annonce n'a plus de sens, on n'envoie rien
  const tenter = () => {
    if (minutes() < cible) return false;
    if (minutes() > cible + 20) console.log('trop tard (' + hhmm().join(':') + ') : annonce non envoyée');
    else envoyer();
    return true;
  };
  console.log('envoi prévu à ' + heure);
  if (!tenter()) { const t = setInterval(() => { if (tenter()) clearInterval(t); }, 10000); }
}
