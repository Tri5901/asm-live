// Écusson d'un club adverse (CDN des logos de la FFF) relayé par l'appli, pour pouvoir le dessiner
// dans l'image « Résumé » du match (le CDN n'autorise pas cet usage depuis un autre site).
// Seuls les logos « BC<numéro>.jpg » de ce CDN sont acceptés.
module.exports = async (req, res) => {
  const id = String((req.query && req.query.id) || '');
  if (!/^\d{3,9}$/.test(id)) return res.status(400).end();
  const r = await fetch('https://cdn-transverse.azureedge.net/phlogos/BC' + id + '.jpg');
  if (!r.ok) return res.status(404).end();
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 500000) return res.status(413).end();
  res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000');
  res.status(200).send(buf);
};
