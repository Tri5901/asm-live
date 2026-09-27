# AS Mésanger – Feuille de match (PWA)

Étape 1 : application installable, fonctionne sans réseau au bord du terrain.

## Contenu
- `index.html` : l'application
- `manifest.webmanifest` : nom, couleurs et icônes pour l'installation
- `sw.js` : service worker (mise en cache pour le hors-ligne)
- `icons/` : logo et icônes du club

## Mise en ligne (GitHub Pages)
1. Crée un dépôt, par exemple `asm-match`, et pousse le contenu de ce dossier à la racine.
2. Settings → Pages → Source : branche `main`, dossier `/ (root)`.
3. L'appli est en ligne sur `https://<ton-compte>.github.io/asm-match/`.

Netlify ou Vercel marchent aussi : glisse le dossier, aucun build n'est nécessaire.

## Mettre à jour
À chaque modification, change `VERSION` dans `sw.js` (asm-v1 → asm-v2…).
Sans ça, les téléphones gardent l'ancienne version en cache.

## Tester en local
`python3 -m http.server 8080` puis http://localhost:8080
(le service worker exige HTTPS, sauf sur localhost)
