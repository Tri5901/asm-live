// AS Mésanger – Matchs en direct
// Vue publique (liste, direct, stats) + espace délégué (saisie du match, compositions, photo de la feuille).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC } from './config.js';

const CLUB = 'AS Mésanger';
// Équipes du club, rangées par catégorie (table « equipes » de la base ; liste de secours ci-dessous).
// Ajouter une catégorie = ajouter des lignes dans la base : tout le site s'adapte.
const EQUIPES_DEFAUT = ['A', 'B', 'C', 'D', 'E'].map((c, i) => ({ id: i + 1, categorie: 'Seniors', cat_ordre: 1, ordre: i + 1, nom: 'Seniors ' + c, court: c, nom_club: CLUB + ' ' + c }));
let EQUIPES = [], TEAMS = [], CATS = [];
function setEquipes(list){
  EQUIPES = (Array.isArray(list) && list.length ? list : EQUIPES_DEFAUT).filter(e => e.actif !== false)
    .sort((a, b) => a.cat_ordre - b.cat_ordre || a.ordre - b.ordre);
  TEAMS = EQUIPES.map(e => e.id);
  CATS = [...new Set(EQUIPES.map(e => e.categorie))];
}
const teamOf = n => EQUIPES.find(e => e.id === (n || 1)) || { id: n, categorie: '?', nom: 'Équipe ' + n, court: String(n), nom_club: CLUB };
const teamLetter = n => teamOf(n).court;
const teamLabel = n => teamOf(n).nom;
const clubTeamName = n => teamOf(n).nom_club;
const catOf = n => teamOf(n).categorie;
const catTeams = c => EQUIPES.filter(e => e.categorie === c).map(e => e.id);
// nom court dans sa catégorie : « U18 A » → « A », « Seniors B » → « B », « Loisirs » → « Loisirs »
const shortIn = n => { const t = teamOf(n); return t.nom.startsWith(t.categorie + ' ') ? t.nom.slice(t.categorie.length + 1) : t.nom === t.categorie ? t.nom : t.court; };
const teamRank = n => { const i = TEAMS.indexOf(n || 1); return i < 0 ? 999 : i; };
// « Seniors A, B, C · U18 » : liste d'équipes lisible, regroupée par catégorie
function teamsText(ids){
  return CATS.map(c => { const l = catTeams(c).filter(n => ids.includes(n)); if (!l.length) return '';
    return l.length === 1 ? teamLabel(l[0]) : c + ' ' + l.map(teamLetter).join(', '); }).filter(Boolean).join(' · ');
}
// Filtre catégorie + équipe (accueil, classements, stats) : f = { cat, team } ; all = propose « tout le club » / « toute la catégorie »
function teamFilterHTML(f, all = true, extra = () => ''){
  const cat = f.cat || (all ? '' : CATS[0]);
  const cats = (all ? [['', 'Tout le club']] : []).concat(CATS.map(c => [c, c]));
  const teams = cat ? catTeams(cat) : [];
  return `<div class="tfilter">${cats.length > 1 || !all ? `<div class="chipbar catbar" role="group" aria-label="Catégorie">${cats.map(([v, l]) => `<button type="button" data-fcat="${esc(v)}" class="${cat===v?'on':''}" aria-pressed="${cat===v}">${esc(l)}</button>`).join('')}</div>` : ''}
    ${teams.length > 1 || (!all && teams.length) ? `<div class="chipbar teambar" role="group" aria-label="Équipe">${(all ? [0] : []).concat(teams).map(n => `<button type="button" data-fteam="${n}" class="${(f.team||0)===n?'on':''}" aria-pressed="${(f.team||0)===n}">${n ? esc(shortIn(n)) + extra(n) : 'Toutes'}</button>`).join('')}</div>` : ''}</div>`;
}
function bindTeamFilter(root, f, all, onChange){
  root.querySelectorAll('[data-fcat]').forEach(b => b.onclick = () => { f.cat = b.dataset.fcat; f.team = all ? 0 : (catTeams(f.cat)[0] || 0); onChange(); });
  root.querySelectorAll('[data-fteam]').forEach(b => b.onclick = () => { f.team = +b.dataset.fteam; if (f.team) f.cat = catOf(f.team); onChange(); });
}
const inFilter = (f, eq) => f.team ? (eq || 1) === f.team : f.cat ? catOf(eq) === f.cat : true;
// Logo de chaque équipe : celui du club, ou celui de l'adversaire s'il est connu
const logoOf = (m, t) => t === (m.club_side || 'H') ? 'icons/notif-192.png' : (m.opp_logo || '');
const logoImg = (m, t, cls) => { const src = logoOf(m, t); return src ? `<img class="${cls}${t === (m.club_side || 'H') ? ' own' : ''}" src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''; };
const sb = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const $ = id => document.getElementById(id);
const view = $('view');
const LABEL = {goal:'But', sub:'Remplacement', yellow:'Carton jaune', white:'Carton blanc', red:'Carton rouge'};
const HALF = 45; // durée d'une mi-temps : toujours 45 min, non modifiable

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } };
setEquipes(lsGet('asm-equipes', null));
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x' ? r : (r&3|8)).toString(16); }));

let tt;
function toast(msg){ const el=$('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(tt); tt=setTimeout(()=>el.classList.remove('show'),1800); }

// ---------- Feuille (bottom sheet) ----------
// tall : feuille en plein écran calée sur la partie visible (au-dessus du clavier du téléphone)
const vvFit = () => { const v = window.visualViewport, r = document.documentElement.style; if (!v) return; r.setProperty('--vvh', v.height + 'px'); r.setProperty('--vvt', v.offsetTop + 'px'); };
if (window.visualViewport){ visualViewport.addEventListener('resize', vvFit); visualViewport.addEventListener('scroll', vvFit); }
function openSheet(html, mode){ $('shBody').innerHTML = html; document.body.classList.toggle('tall', mode === 'tall'); vvFit(); document.body.classList.add('open'); }
function closeSheet(){ document.body.classList.remove('open', 'tall'); }
$('scrim').onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
function askConfirm(title, text, okLabel, cb){
  openSheet(`<h3 id="shTitle">${esc(title)}</h3><p>${esc(text)}</p>
    <div class="foot" style="margin-top:14px"><button class="fbtn primary" id="cfOk">${esc(okLabel)}</button><button class="fbtn" id="cfNo">Annuler</button></div>`);
  $('cfOk').onclick = () => { closeSheet(); cb(); };
  $('cfNo').onclick = closeSheet;
}

// ---------- Match : calculs communs ----------
const clubSide = m => m.club_side || 'H';
const teamName = (m, t) => (t==='H' ? (m.home_name||'Domicile') : (m.away_name||'Extérieur'));
const oppSide = m => clubSide(m)==='H' ? 'A' : 'H';
const goals = (evs, t) => evs.filter(e=>e.k==='goal' && e.t===t).length;
const rosterOf = (m, t) => ((m.rosters||{})[t]||[]);
const nameOf = (m, t, n) => { const p = rosterOf(m,t).find(p=>p.n===String(n)); return p ? p.name : ''; };
const who = (m, t, n, none) => n === 'CSC' ? 'Contre son camp (CSC)' : n ? `n°${n}${nameOf(m,t,n) ? ' ' + nameOf(m,t,n) : ''}` : none;
const rosterSorted = (m, t) => [...rosterOf(m,t)].sort((a,b)=>(+a.n || 999)-(+b.n || 999)); // sans numéro : à la fin
// plus de 11 titulaires (ex. compo importée de la convocation, tous titulaires) : les plus grands numéros passent remplaçants.
// Seulement si tous les titulaires ont un numéro, sinon on ne peut pas savoir qui est sur le banc.
function onzeTitulaires(list){
  const tit = (list || []).filter(p => !p.sub);
  if (tit.length <= 11 || tit.some(p => !+p.n)) return { list, moved: [] };
  const moved = [...tit].sort((a, b) => +a.n - +b.n).slice(11);
  const r = list.map(p => moved.includes(p) ? { ...p, sub: true } : p);
  return { list: [...r.filter(p => !p.sub), ...r.filter(p => p.sub)], moved: moved.map(p => p.n) };
}

function elapsedMs(m){ return (+m.acc||0) + (m.running ? Date.now() - (+m.started_at||0) : 0); }
function currentMinute(m){
  const mm = Math.floor(elapsedMs(m)/60000) + 1;
  const offset = m.period === 2 ? m.half : 0;
  if (m.period === 0) return {label:"0'", sort:0};
  if (mm > m.half) return {label:`${offset+m.half}+${mm-m.half}'`, sort:offset+mm};
  return {label:`${offset+mm}'`, sort:offset+mm};
}
function clockText(m){
  const tot = Math.max(0, Math.floor(elapsedMs(m)/1000)) + (m.period===2 ? m.half*60 : 0);
  return `${String(Math.floor(tot/60)).padStart(2,'0')}:${String(tot%60).padStart(2,'0')}`;
}
// mi-temps : 2e période pas encore lancée (bouton « Mi-temps » : chrono arrêté, prêt à repartir de 45:00)
const isMiTemps = m => m.status==='direct' && m.period===2 && !m.running && !elapsedMs(m);
function periodText(m){
  if (m.status==='termine') return 'Match terminé';
  if (m.period===0) return 'Avant match';
  if (isMiTemps(m)) return 'Mi-temps';
  return (m.period===1 ? '1re mi-temps' : '2e mi-temps') + (m.running ? '' : (m.period===1 && elapsedMs(m) >= m.half*60000 ? ' · mi-temps' : ' · en pause'));
}
function resultOf(m, evs){
  const c = goals(evs, clubSide(m)), o = goals(evs, oppSide(m));
  return c > o ? 'V' : c < o ? 'D' : 'N';
}
function fmtDate(iso, withTime=true){
  const d = new Date(iso);
  const s = d.toLocaleDateString('fr-FR', {weekday:'short', day:'numeric', month:'short'});
  return withTime ? `${s} · ${d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}` : s;
}
function seasonOf(iso){ const d = new Date(iso); const y = d.getFullYear(); return d.getMonth() >= 6 ? `${y}-${y+1}` : `${y-1}-${y}`; }
function sortFromLabel(label, fallback){
  const m = String(label).match(/^(\d+)(?:\+(\d+))?/);
  return m ? (+m[1]) + (m[2] ? (+m[2])/100 : 0) : fallback;
}
function absOf(label){ const m = String(label).match(/^(\d+)(?:\+(\d+))?/); return m ? (+m[1]) + (m[2]?+m[2]:0) : 0; }
function labelOf(m, abs, p){ const lim = p===2 ? 2*m.half : m.half; return abs > lim ? `${lim}+${abs-lim}'` : `${Math.max(abs,0)}'`; }

// Chronologie (lecture seule ou modifiable)
function timelineHTML(m, evs, editable){
  // résultat repris de la FFF : les buts sans minute (buteur non saisi sur la feuille) sont résumés en tête
  if (!editable){
    const nomin = evs.filter(e => e.k === 'goal' && !e.min);
    if (nomin.length){
      const rest = evs.filter(e => !(e.k === 'goal' && !e.min));
      const lines = ['H', 'A'].map(t => {
        const g = nomin.filter(e => e.t === t); if (!g.length) return '';
        const named = g.filter(e => e.n).map(e => who(m, t, e.n, '')), anon = g.length - named.length;
        return `<div><b>${esc(teamName(m, t))}</b> : ${esc([...named, ...(anon ? [anon > 1 ? anon + ' buteurs non renseignés' : '1 buteur non renseigné'] : [])].join(', '))}</div>`;
      }).join('');
      return `<div class="empty" style="text-align:left">Buts sans minute (feuille de match FFF incomplète)${lines}</div>` + (rest.length ? timelineHTML(m, rest, false) : '');
    }
  }
  if (!evs.length) return `<div class="empty">${editable ? 'Lance le chrono puis touche une action : la minute est notée toute seule.' : 'Aucune action pour le moment.'}</div>`;
  const list = [...evs].sort((a,b)=> b.sort - a.sort || String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const ICON = {goal:'<span class="evi goal">⚽</span>', yellow:'<span class="evi"><i class="kc y"></i></span>', white:'<span class="evi"><i class="kc w"></i></span>', red:'<span class="evi"><i class="kc r"></i></span>', sub:'<span class="evi sub">⇄</span>'};
  let lastP = null, html = '';
  for (const e of list){
    if (lastP !== null && e.p !== lastP) html += '<div class="period-mark">Mi-temps</div>';
    lastP = e.p;
    let detail = '';
    if (e.k==='goal') detail = who(m,e.t,e.n,'Buteur non précisé');
    if (e.k==='sub') detail = `Sort ${who(m,e.t,e.out_n,'?')} · Entre ${who(m,e.t,e.in_n,'?')}`;
    if (e.k==='yellow'||e.k==='white'||e.k==='red') detail = who(m,e.t,e.n,'Joueur non précisé');
    const by = isAdmin() && people ? `<div class="evby">Saisi par ${esc(personName(e.created_by))}${e.created_at ? ' à ' + hhmm(e.created_at) : ''}</div>` : '';
    const moi = estMoi(m, e);
    html += `<div class="ev ${editable ? 'edit' : 'ro'}${e.t===clubSide(m) ? ' club' : ''}${moi ? ' moi' : ''}" data-id="${esc(e.id)}"><div class="min">${esc(e.min)}</div>${ICON[e.k]}
      <div class="txt"><b>${LABEL[e.k]}</b> <span class="evteam">${esc(teamName(m,e.t))}</span>${moi ? '<span class="evmoi">⭐ C’est toi</span>' : ''}<div>${esc(detail)}</div>${by}</div>
      ${editable ? '<button class="del" aria-label="Supprimer">×</button>' : ''}</div>`;
  }
  return html;
}

// ---------- Joueur lié au compte ----------
// Le compte connecté peut être lié à un joueur des compos (« C'est moi ») : « Mes stats », ses actions mises en avant.
function monJoueur(){ return profile && profile.joueur ? playerKey(profile.joueur) : null; }
function estMoi(m, e){
  const k = monJoueur(); if (!k || e.t !== clubSide(m)) return false;
  return [e.n, e.in_n, e.out_n].some(n => n && n !== 'CSC' && nameOf(m, e.t, n) && playerKey(nameOf(m, e.t, n)) === k);
}
// matchs joués et actions (même copie que la page Stats)
async function chargerStats(){
  const [{ data: ms, error }, { data: evs, error: e2 }] = await Promise.all([
    sb.from('matches').select('id,kickoff,equipe,club_side,rosters,status,competition,home_name,away_name,opp_logo').neq('status','prevu'),
    sb.from('events').select('match_id,t,k,n,in_n,out_n,min,sort')
  ]);
  if (error || e2) throw (error || e2);
  const r = { ms, evs }; lsSet('asm-stats', r); return r;
}
// joueurs du club (noms écrits dans nos compos) avec leur nombre de matchs
function joueursClub(ms){
  const m = new Map();
  (ms || []).forEach(x => (((x.rosters || {})[x.club_side]) || []).forEach(p => {
    if (!p.name || !p.name.trim()) return;
    const k = playerKey(p.name), e = m.get(k) || { k, name: p.name, nb: 0 }; e.nb++; m.set(k, e);
  }));
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
// bilan d'un joueur sur la saison en cours : matchs joués, buts, cartons
function bilanJoueur(ms, evs, key){
  const saison = seasonOf(new Date().toISOString());
  let mj = 0, buts = 0, jaunes = 0, blancs = 0, rouges = 0; const eqs = {};
  (ms || []).filter(m => seasonOf(m.kickoff) === saison).forEach(m => {
    const c = m.club_side, p = (((m.rosters || {})[c]) || []).find(x => x.name && playerKey(x.name) === key);
    if (!p) return;
    const me = (evs || []).filter(e => e.match_id === m.id && e.t === c);
    if (!p.sub || me.some(e => e.k === 'sub' && e.in_n === p.n)){ mj++; eqs[m.equipe || 1] = (eqs[m.equipe || 1] || 0) + 1; }
    buts += me.filter(e => e.k === 'goal' && e.n === p.n).length;
    jaunes += me.filter(e => e.k === 'yellow' && e.n === p.n).length;
    blancs += me.filter(e => e.k === 'white' && e.n === p.n).length;
    rouges += me.filter(e => e.k === 'red' && e.n === p.n).length;
  });
  const eq = Object.entries(eqs).sort((a, b) => b[1] - a[1] || teamRank(+a[0]) - teamRank(+b[0]))[0];
  return { saison, mj, buts, jaunes, blancs, rouges, eq: eq ? +eq[0] : null, eqs };
}

// ---------- Session / profil ----------
let session = null;
let profile = lsGet('asm-profile', null);
const isStaff = () => !!profile && (profile.role==='delegue' || profile.role==='admin');
// Joueur : aucun droit, sauf sur les matchs où il est désigné délégué
const isMember = () => !!profile && ['joueur', 'supporter', 'dirigeant', 'delegue', 'admin'].includes(profile.role);
const isAdmin = () => !!profile && profile.role==='admin';
const myId = () => session && session.user ? session.user.id : null;
// Un match avec un délégué désigné ne peut être saisi que par lui (ou un admin)
// Responsable d'équipe : compte "delegue" avec les équipes cochées par un admin (profiles.equipes)
const myTeams = () => (profile && Array.isArray(profile.equipes)) ? profile.equipes : [];
const isTeamManager = eq => isAdmin() || (isStaff() && myTeams().includes(eq || 1));
const canCreate = () => isAdmin() || (isStaff() && myTeams().length > 0);
// Peut saisir un match : admin, responsable de l'équipe, ou délégué désigné sur ce match
const canManage = m => isTeamManager(m.equipe) || (isMember() && !!m.delegue_id && m.delegue_id === myId());
let delegues = null;
async function loadDelegues(){ if (!delegues){ const { data } = await sb.rpc('list_delegues'); delegues = data || []; } return delegues; }
// Choix du délégué : bouton qui ouvre une liste avec recherche (le club compte beaucoup de personnes)
const ROLE_TAG = { joueur: 'Joueur', dirigeant: 'Dirigeant', delegue: 'Responsable', admin: 'Admin' };
function delegueList(cur, curNom){
  const opts = [];
  if (canCreate()) (delegues||[]).forEach(d => opts.push({ id: d.id, nom: d.nom, tag: ROLE_TAG[d.role] || '' }));
  else if (myId()) opts.push({ id: myId(), nom: 'Moi', tag: '' });
  if (cur && !opts.some(o => o.id === cur)) opts.push({ id: cur, nom: curNom || 'Autre responsable score', tag: '' });
  return opts;
}
function delegPickHTML(id, cur, curNom, disabled){
  const o = delegueList(cur, curNom).find(x => x.id === cur);
  return `<button type="button" class="dpick" id="${id}" data-value="${esc(cur || '')}"${disabled ? ' disabled' : ''}><span>${esc(o ? o.nom : 'Non défini (par défaut : responsable d’équipe)')}</span>${disabled ? '' : '<i aria-hidden="true">🔍</i>'}</button>`;
}
const sansAccent = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// distance entre deux mots (lettres \u00e0 changer / ajouter / retirer) : sert \u00e0 reconna\u00eetre un nom mal lu sur une photo
function levenshtein(a, b){
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++){
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++){ const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
function bindDelegPick(btn, curNom, onPick){
  if (!btn || btn.disabled) return;
  btn.onclick = () => {
    const cur = btn.dataset.value || '';
    const all = [{ id: '', nom: 'Non défini (par défaut : responsable d’équipe)', tag: '' }, ...delegueList(cur, curNom).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))];
    openSheet(`<div class="dphead"><h3 id="shTitle">Responsable score du match</h3><button type="button" class="dpclose" id="dpNo">Annuler</button></div>
      <input id="dpQ" class="dpq" type="search" placeholder="Rechercher un nom…" autocomplete="off" enterkeyhint="search">
      <div class="alist dplist" id="dpList"></div>`, 'tall');
    const list = $('dpList'), q = $('dpQ');
    const draw = () => {
      const words = sansAccent(q.value).split(/\s+/).filter(Boolean);
      const f = all.filter(o => (!o.id && !words.length) || (o.id && words.every(w => sansAccent(o.nom + ' ' + o.tag).includes(w))));
      list.innerHTML = f.map(o => `<button type="button" class="arow dprow${o.id === cur ? ' on' : ''}" data-id="${esc(o.id)}"><div class="who"><b>${esc(o.nom)}</b>${o.tag ? `<small>${esc(o.tag)}</small>` : ''}</div>${o.id === cur ? '<span class="dpok">✓</span>' : ''}</button>`).join('')
        + (!f.length && words.length ? '<div class="empty">Personne ne correspond à cette recherche.</div>' : '');
      list.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
        const o = all.find(x => x.id === b.dataset.id);
        closeSheet();
        if (o.id === cur) return;
        btn.dataset.value = o.id; btn.querySelector('span').textContent = o.nom;
        onPick && onPick(o.id || null);
      });
    };
    q.oninput = draw; draw();
    $('dpNo').onclick = closeSheet;
    if (all.length <= 5) q.hidden = true;
  };
}
let people = null;
async function loadPeople(){
  if (!isAdmin()) return {};
  if (!people){ const { data } = await sb.from('profiles').select('id,nom,email,role'); people = {}; (data||[]).forEach(p => { people[p.id] = (p.nom || p.email || 'Sans nom') + (p.role === 'supprime' ? ' (compte supprimé)' : ''); }); }
  return people;
}
const personName = id => id ? ((people||{})[id] || 'compte supprimé') : 'import du calendrier';
const hhmm = iso => iso ? new Date(iso).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}) : '';
const delegueNom = id => !id ? null : id === myId() ? (profile && profile.nom) || 'Moi' : ((delegues||[]).find(d => d.id === id) || {}).nom || null;

// « jean-pierre LE GOFF » → « Jean-Pierre Le Goff » (même règle que la base)
const fmtNom = t => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (x, a, b) => a + b.toUpperCase());
const nomOk = n => fmtNom(n).split(' ').filter(w => w.length >= 2).length >= 2;
const splitNom = n => { const w = fmtNom(n).split(' ').filter(Boolean); return [w[0] || '', w.slice(1).join(' ')]; };
async function loadProfile(){
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session){ profile = null; lsSet('asm-profile', null); renderAcct(); return; }
  const { data: p, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (!error){ profile = p; lsSet('asm-profile', p); }
  renderAcct();
}
function renderAcct(){
  presTrack();
  renderOnline();
  const a = $('acct');
  if (session){
    const nom = (profile && profile.nom || '').trim();
    a.innerHTML = `<span class="avatar">${esc((nom || '?').charAt(0).toUpperCase())}</span>`;
    a.setAttribute('aria-label', 'Mon compte' + (nom ? ' (' + nom + ')' : ''));
    a.href = '#/compte'; a.classList.add('in');
  } else {
    a.textContent = 'Connexion'; a.removeAttribute('aria-label'); a.href = '#/connexion'; a.classList.remove('in');
  }
}

// ---------- File d'envoi (hors ligne) ----------
// Toutes les écritures du délégué passent par cette file : si le réseau coupe, elles partent au retour.
let outbox = lsGet('asm-outbox', []);
let flushing = false, syncListeners = new Set();
const saveOutbox = () => { lsSet('asm-outbox', outbox); syncListeners.forEach(f=>f()); };
const pendingFor = id => outbox.some(o => o.match === id);
function queue(op){
  const last = outbox[outbox.length-1];
  if (op.kind==='match' && last && last.kind==='match' && last.match===op.match){ Object.assign(last.fields, op.fields); }
  else outbox.push(op);
  saveOutbox(); flush();
}
const isNetErr = err => !navigator.onLine || /fetch|network|load failed|timeout/i.test(String(err && (err.message||err)));
async function flush(){
  if (flushing || !sb || !outbox.length) return;
  flushing = true;
  try{
    while (outbox.length){
      const op = outbox[0];
      let res;
      if (op.kind==='match') res = await sb.from('matches').update({...op.fields, updated_at:new Date().toISOString()}).eq('id', op.match).select('id');
      else if (op.kind==='ev') res = await sb.from('events').upsert(op.row);
      else if (op.kind==='evdel') res = await sb.from('events').delete().eq('id', op.id);
      else if (op.kind==='notify'){
        const { data } = await sb.auth.getSession();
        if (data.session){
          try{
            await fetch('api/notify', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + data.session.access_token}, body: JSON.stringify({event_id: op.id})});
          }catch(e){ break; } // réseau : on réessaiera
        }
      }
      if (res && res.error){
        if (isNetErr(res.error)) break;
        toast(/row-level security|42501/i.test(res.error.message + res.error.code) ? 'Refusé : seuls le responsable score, les responsables d’équipe et les admins peuvent modifier ce match' : 'Envoi refusé : ' + (res.error.message || 'erreur'));
      } else if (op.kind==='match' && res && Array.isArray(res.data) && !res.data.length){
        // la base a ignoré la modification : pas les droits sur ce match (ou match supprimé)
        toast('Refusé : seuls le responsable score, les responsables d’équipe et les admins peuvent modifier ce match');
      }
      outbox.shift(); saveOutbox();
    }
  }catch(e){ /* réseau : on réessaie plus tard */ }
  flushing = false;
  syncListeners.forEach(f=>f());
}
window.addEventListener('online', flush);
setInterval(flush, 15000);

// ---------- Routeur ----------
let cleanup = null;
async function route(){
  route.cur = (route.cur || 0) + 1;
  if (cleanup){ try{ cleanup(); }catch(e){} cleanup = null; }
  closeSheet();
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  const [page, arg] = parts;
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on',
    a.dataset.tab === (page === '' || page === 'match' ? 'matchs' : page)));
  $('tabs').hidden = page==='gerer' || page==='match';
  $('fab').hidden = !(canCreate() && page==='');
  presTrack();
  window.scrollTo(0,0);
  if (!sb){ view.innerHTML = `<div class="card"><h1>Configuration à terminer</h1><p class="sub">Le site n'est pas encore relié à sa base de données (fichier config.js).</p></div>`; return; }
  try{
    if (session && profile && profile.role !== 'supprime' && !nomOk(profile.nom) && page !== 'connexion') return nameView(true);
    if (page==='' ) return await homeView();
    if (page==='match') return await matchView(arg);
    if (page==='gerer') return await consoleView(arg, parts[2]==='compo');
    if (page==='nouveau') return await newMatchView();
    if (page==='stats') return await statsView(parts[1]==='joueur' ? decodeURIComponent(parts[2]||'') : null);
    if (page==='classements') return await classementsView();
    if (page==='connexion') return loginView();
    if (page==='compte') return accountView();
    if (page==='cgu') return cguView();
    if (page==='admin') return await adminView();
    location.hash = '#/';
  }catch(e){
    console.error(e);
    view.innerHTML = `<div class="empty">Impossible de charger la page${navigator.onLine ? '' : ' (pas de réseau)'}.<br><button class="link" onclick="location.reload()">Réessayer</button></div>`;
  }
}
window.addEventListener('hashchange', route);

// Canal temps réel. off.ok() indique s'il est vraiment connecté : sinon (plus de place sur l'offre
// gratuite, réseau coupé…) la page se rafraîchit d'elle-même à intervalle court.
function liveChannel(name, onChange, filters){
  const ch = sb.channel(name + '-' + Math.random().toString(36).slice(2));
  let ok = false;
  filters.forEach(f => ch.on('postgres_changes', {schema:'public', ...f}, onChange));
  ch.subscribe(st => { ok = st === 'SUBSCRIBED'; });
  const off = () => sb.removeChannel(ch);
  off.ok = () => ok && !rtAsleep;
  return off;
}
// Relève : toutes les 10 s si le temps réel n'est pas connecté, et une fois par minute dans tous les cas
function fallbackPoll(off, reload){
  let n = 0;
  return setInterval(() => { n++; if (document.visibilityState !== 'visible') return; if (!off.ok() || n % 6 === 0) reload(); }, 10000);
}
// Mise en veille : l'appli en arrière-plan depuis 30 s libère sa connexion temps réel (limite de 200 places)
let rtAsleep = false, rtSleepTimer = null;
document.addEventListener('visibilitychange', () => {
  if (!sb) return;
  if (document.visibilityState === 'hidden'){
    clearTimeout(rtSleepTimer);
    rtSleepTimer = setTimeout(() => { rtAsleep = true; sb.removeAllChannels(); presCh = null; presReady = false; presState = {}; }, 30000);
  } else {
    clearTimeout(rtSleepTimer);
    if (rtAsleep){
      rtAsleep = false;
      startPresence();
      if (!location.hash.startsWith('#/gerer')) route(); // la console se resynchronise seule (relève + retour au premier plan)
    }
  }
});
function debounce(fn, ms){ let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

// ---------- Accueil : liste des matchs ----------
async function homeView(){
  const cache = lsGet('asm-home', null);
  if (cache) drawHome(cache.matches, cache.goals); else view.innerHTML = '<div class="loading">Chargement…</div>';
  const load = async () => {
    const [{ data: matches, error }, { data: g }] = await Promise.all([
      sb.from('matches').select('id,kickoff,competition,equipe,opp_logo,delegue_id,delegue_nom,club_side,home_name,away_name,half,period,running,started_at,acc,status').order('kickoff', {ascending:false}).limit(1000),
      sb.from('events').select('match_id,t').eq('k','goal')
    ]);
    if (error) { if (!cache) throw error; return; }
    lsSet('asm-home', {matches, goals:g||[]});
    // responsables et admins : demandes « responsable score » à valider (la base ne montre que celles de leurs équipes)
    if (isStaff()){
      const { data: d } = await sb.from('demandes_score').select('id,match_id,nom').eq('statut', 'attente').neq('user_id', myId()).order('created_at');
      demAtt = d || [];
    } else demAtt = [];
    drawHome(matches, g||[]);
  };
  await load();
  prefetch();
  const reload = debounce(load, 400);
  const off = liveChannel('home', reload, [{event:'*', table:'matches'}, {event:'*', table:'events'}]);
  const tick = setInterval(() => document.querySelectorAll('[data-live]').forEach(el => {
    const m = JSON.parse(el.dataset.live); el.textContent = isMiTemps(m) ? 'Mi-temps' : m.status==='direct' && m.period ? 'Direct · ' + currentMinute(m).label : 'Direct';
  }), 5000);
  const vis = () => { if (document.visibilityState==='visible') reload(); };
  document.addEventListener('visibilitychange', vis);
  const poll = fallbackPoll(off, reload);
  cleanup = () => { off(); clearInterval(tick); clearInterval(poll); document.removeEventListener('visibilitychange', vis); };
}
// filtre de l'accueil (catégorie + équipe), mémorisé sur le téléphone
const homeF = lsGet('asm-filtre', null) || { cat: '', team: lsGet('asm-team', 0) || 0 };
if (homeF.team && !homeF.cat) homeF.cat = catOf(homeF.team);
let showAllNext = false, demAtt = [];
function drawHome(matches, goalRows){
  const byMatch = {};
  goalRows.forEach(g => { (byMatch[g.match_id] ||= []).push({k:'goal', t:g.t}); });
  const isMine = m => !!myId() && m.delegue_id === myId() && m.status !== 'termine';
  const card = m => {
    const evs = byMatch[m.id] || [];
    const me = isMine(m);
    const c = clubSide(m);
    let badge = '', mid;
    if (m.status==='prevu') mid = `<span class="mtime">${esc(hhmm(m.kickoff))}</span>`;
    else mid = `<span class="msc">${goals(evs,'H')}<i>–</i>${goals(evs,'A')}</span>`;
    if (m.status==='direct') badge = `<span class="badge live" data-live='${esc(JSON.stringify({status:m.status,period:m.period,half:m.half,running:m.running,started_at:m.started_at,acc:m.acc}))}'>${isMiTemps(m) ? 'Mi-temps' : 'Direct' + (m.period ? ' · ' + esc(currentMinute(m).label) : '')}</span>`;
    else if (m.status==='termine'){ const r = resultOf(m, evs); badge = `<span class="badge ${r==='V'?'w':r==='D'?'l':''}">${r==='V'?'Victoire':r==='D'?'Défaite':'Nul'}</span>`; }
    const side = t => `<div class="mside${c===t?' club':''}">${logoOf(m,t) ? logoImg(m,t,'mlg') : '<span class="mlg ph"></span>'}<span>${esc(teamName(m,t))}</span></div>`;
    return `<a class="mcard${m.status==='direct' ? ' live' : ''}${me ? ' mine' : ''}" href="#/match/${esc(m.id)}">
      <div class="mtop"><span class="tchip" title="${esc(teamLabel(m.equipe))}">${teamLetter(m.equipe)}</span><span class="mcomp">${CATS.length > 1 ? esc(catOf(m.equipe)) + (m.competition ? " · " : "") : ""}${esc(m.competition || (CATS.length > 1 ? "" : teamLabel(m.equipe)))}</span>${canManage(m) && !me ? `<span class="gerer" role="link" tabindex="0" data-href="#/gerer/${esc(m.id)}" aria-label="Gérer ce match">✎ Gérer</span>` : ''}${badge}</div>
      <div class="mrow">${side('H')}<div class="mmid">${mid}</div>${side('A')}</div>
      ${m.status === 'termine' ? '' /* match fini : plus de responsable score sur l'accueil (il reste sur la page du match) */
        : me ? `<div class="mdeleg" role="link" tabindex="0" data-href="#/gerer/${esc(m.id)}"><span><b>Tu es responsable score de ce match</b><small>C’est toi qui saisis le score et les remplacements.</small></span><span class="mdgo">Gérer ›</span></div>`
        : m.delegue_nom ? `<div class="mdel">Responsable score : ${esc(m.delegue_nom)}</div>`
        : demAtt.some(d => d.match_id === m.id) ? `<div class="mdem">🙋 Demande de ${esc(demAtt.filter(d => d.match_id === m.id).map(d => d.nom).join(', '))} à valider</div>` : ''}</a>`;
  };
  const byDay = list => { let h = '', last = ''; list.forEach(m => { const d = new Date(m.kickoff).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'}); if (d !== last){ h += `<div class="day">${esc(d)}</div>`; last = d; } h += card(m); }); return h; };
  const all = matches;
  // les matchs dont on est le délégué restent affichés, quel que soit le filtre d'équipe
  matches = matches.filter(m => inFilter(homeF, m.equipe) || isMine(m));
  // même heure : les dernières équipes d'abord, la A en dernier
  const byTeam = (a,b) => teamRank(b.equipe) - teamRank(a.equipe);
  const asc = (a,b) => a.kickoff.localeCompare(b.kickoff) || byTeam(a,b), desc = (a,b) => b.kickoff.localeCompare(a.kickoff) || byTeam(a,b);
  const live = matches.filter(m=>m.status==='direct').sort(asc);
  const next = matches.filter(m=>m.status==='prevu').sort(asc);
  // derniers matchs terminés : restent en haut (sous le direct). Ceux du week-end (vendredi → lundi) jusqu'au mardi 6 h,
  // les autres jusqu'au lendemain 6 h.
  const resteEnHaut = m => {
    const d = new Date(m.kickoff), dow = d.getDay(), fin = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 6);
    fin.setDate(fin.getDate() + ([5, 6, 0, 1].includes(dow) ? ((2 - dow + 7) % 7 || 7) : 1));
    return Date.now() < fin.getTime();
  };
  const doneAll = matches.filter(m=>m.status==='termine');
  // derniers résultats : le jour le plus récent d'abord, puis la A en haut et les autres équipes en dessous
  const jourDe = m => new Date(m.kickoff).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const doneToday = doneAll.filter(resteEnHaut).sort((a, b) => jourDe(b).localeCompare(jourDe(a)) || teamRank(a.equipe) - teamRank(b.equipe) || a.kickoff.localeCompare(b.kickoff));
  const done = doneAll.filter(m => !resteEnHaut(m)).sort(desc);
  // demandes à valider : une ligne par match (équipe, adversaire, date, qui demande)
  const demParMatch = {};
  demAtt.forEach(d => { (demParMatch[d.match_id] ||= []).push(d.nom); });
  const demHtml = Object.entries(demParMatch).map(([mid, noms]) => {
    const m = all.find(x => x.id === mid);
    const quoi = m ? `${esc(teamLetter(m.equipe))} · ${esc(teamName(m, oppSide(m)))} · ${esc(fmtDate(m.kickoff))}` : "Match";
    return `<a class="demitem" href="#/match/${esc(mid)}"><span><b>${quoi}</b><small>${esc(noms.join(', '))}</small></span><i>Voir ›</i></a>`;
  }).join('');
  let html = (demHtml ? `<div class="dembar"><div class="demtitle">🙋 Demande${demAtt.length > 1 ? 's' : ''} pour être responsable score à valider</div>${demHtml}</div>` : '')
    + teamFilterHTML(homeF, true);
  if (live.length) html += `<div class="sec">En direct</div>` + live.map(card).join('');
  if (doneToday.length) html += `<div class="sec">Derniers résultats</div>` + doneToday.map(card).join('');
  const NEXT_MAX = 6;
  if (next.length) html += `<div class="sec">À venir</div>` + byDay(showAllNext ? next : next.filter((m, i) => i < NEXT_MAX || isMine(m)))
    + (next.length > NEXT_MAX && !showAllNext ? `<button class="fbtn" id="moreNext" style="width:100%">Voir les ${next.length} matchs à venir</button>` : '');
  if (done.length) html += `<div class="sec">Résultats</div>` + byDay(done);
  if (!matches.length) html += `<div class="empty" style="margin-top:12px">Aucun match ${homeF.team ? 'des ' + esc(teamLabel(homeF.team)) + ' ' : homeF.cat ? 'en ' + esc(homeF.cat) + ' ' : ''}pour l'instant.${isStaff() ? '' : ' Reviens le jour du match pour le suivre en direct.'}</div>`;
  view.innerHTML = html;
  bindTeamFilter(view, homeF, true, () => { lsSet('asm-filtre', homeF); showAllNext = false; drawHome(all, goalRows); });
  view.querySelectorAll('.gerer, .mdeleg').forEach(g => {
    const go = e => { e.preventDefault(); e.stopPropagation(); location.hash = g.dataset.href; };
    g.onclick = go; g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') go(e); };
  });
  const more = $('moreNext'); if (more) more.onclick = () => { showAllNext = true; drawHome(all, goalRows); };
}

// ---------- Match : vue publique en direct ----------
async function fetchMatch(id){
  const [{ data: m, error }, { data: evs, error: e2 }] = await Promise.all([
    sb.from('matches').select('*').eq('id', id).maybeSingle(),
    sb.from('events').select('*').eq('match_id', id)
  ]);
  if (error || e2) throw (error || e2);
  if (m && m.compo_cachee && session){
    const { data: p } = await sb.from('compos_privees').select('rosters').eq('match_id', id).maybeSingle();
    if (p) m.rosters = p.rosters;
  }
  return { m, evs: evs || [] };
}
// Matchs de coupe : niveau des deux équipes (le nôtre = championnat de l'équipe, celui de l'adversaire est relevé sur la FFF)
const NIV_ORDRE = t => { const m = String(t || '').match(/(National|Régional|District)\s*(\d+)/i); if (!m) return null; return ({ national: 0, 'régional': 3, district: 6 })[m[1].toLowerCase()] + (+m[2]); };
// { H: 'District 2', A: 'District 3', d } (d > 0 : adversaire au-dessus) ou null hors coupe / niveau inconnu
function niveaux(m){
  if (!m.opp_niveau || !/coupe|challenge|troph/i.test(m.competition || '')) return null;
  const home = lsGet('asm-home', null);
  const champ = ((home && home.matches || []).find(x => x.equipe === m.equipe && / · J\d+$/.test(x.competition)) || {}).competition;
  const notre = champ ? champ.replace(/ · J\d+$/, '').replace(/ · .*$/, '') : '';
  const a = NIV_ORDRE(notre), b = NIV_ORDRE(m.opp_niveau);
  return { [clubSide(m)]: notre, [oppSide(m)]: m.opp_niveau, d: a != null && b != null ? a - b : null };
}
// sous le tableau d'affichage : l'écart de divisions (les niveaux sont sous le nom de chaque équipe)
function niveauHTML(m){
  const n = niveaux(m);
  if (!n || n.d == null) return '';
  const ecart = n.d === 0 ? 'Même niveau' : `Adversaire ${Math.abs(n.d)} division${Math.abs(n.d) > 1 ? 's' : ''} ${n.d > 0 ? 'au-dessus' : 'en dessous'}`;
  return `<div class="nivline"><span class="${n.d > 0 ? 'up' : n.d < 0 ? 'down' : ''}">${esc(ecart)}</span></div>`;
}
// matchs à l'extérieur : lieu discret, qui ouvre l'adresse puis Waze ou Google Maps
function lieuHTML(m){
  if (clubSide(m) !== 'A' || !m.adresse || m.status === 'termine') return '';
  const ville = m.adresse.split(', ').pop().replace(/^\d{5}\s*/, '');
  return `<button class="lieu" id="btnLieu">📍 ${esc(m.lieu || 'Lieu du match')}${ville ? ' · ' + esc(ville) : ''}</button>`;
}
function openLieu(m){
  const a = encodeURIComponent(m.adresse);
  const waze = 'https://waze.com/ul?q=' + a + '&navigate=yes';
  const gmaps = 'https://www.google.com/maps/dir/?api=1&destination=' + a;
  openSheet(`<h3 id="shTitle">Lieu du match</h3><p><b>${esc(m.lieu || '')}</b><br>${esc(m.adresse)}</p>
    <div class="foot lieufoot" style="margin-top:14px"><a class="fbtn primary" data-go href="${esc(waze)}" target="_blank" rel="noopener">Waze</a><a class="fbtn primary" data-go href="${esc(gmaps)}" target="_blank" rel="noopener">Google Maps</a><button class="fbtn" id="lieuCopy">Copier</button></div>`);
  document.querySelectorAll('#shBody [data-go]').forEach(b => b.onclick = () => closeSheet());
  // pour fermer : toucher en dehors de la fenêtre
  $('lieuCopy').onclick = async () => {
    try{ await navigator.clipboard.writeText(m.adresse); toast('Adresse copiée'); closeSheet(); }catch(e){ prompt('Adresse du match', m.adresse); }
  };
}
function boardHTML(m, evs, staff){
  const c = clubSide(m), niv = niveaux(m);
  const tniv = t => niv && niv[t] ? `<span class="tniv">${esc(niv[t])}</span>` : '';
  return `<section class="board" aria-label="Tableau d'affichage">
    <div class="bmeta"><span>${esc(teamLabel(m.equipe))} · ${esc(fmtDate(m.kickoff))}${m.competition ? ' · ' + esc(m.competition) : ''}</span>${m.status==='direct' ? '<span class="badge live">Direct</span>' : ''}</div>
    <div class="teams">
      <div class="team">${logoImg(m,'H','blg')}<span class="tname${c==='H'?' club':''}">${esc(teamName(m,'H'))}</span>${tniv('H')}</div>
      <div class="score" aria-live="polite"><span id="scH">${goals(evs,'H')}</span><span class="sep">–</span><span id="scA">${goals(evs,'A')}</span></div>
      <div class="team">${logoImg(m,'A','blg')}<span class="tname${c==='A'?' club':''}">${esc(teamName(m,'A'))}</span>${tniv('A')}</div>
    </div>
    <div class="clockrow">
      <div>${staff ? `<button class="clock" id="clock" aria-label="Régler le chrono">${clockText(m)}</button>` : `<div class="clock" id="clock">${m.status==='prevu' ? '--:--' : clockText(m)}</div>`}<div class="period" id="period">${esc(periodText(m))}</div></div>
      ${staff ? `<div class="clockbtns"><button class="cbtn ghost" id="btnPeriod"></button><button class="cbtn" id="btnClock"></button></div>` : ''}
    </div>
  </section>`;
}
// heure de rendez-vous au stade (feuille des convocations) : pour les personnes connectées, jusqu'au coup d'envoi
function rdvHTML(m){
  if (!myId() || !m.rdv || m.status !== 'prevu' || Date.now() >= new Date(m.kickoff).getTime()) return '';
  const h = new Date(m.rdv).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  return `<div class="rdv" id="rdvBox">🕐 RDV au stade à <b>${esc(h)}</b></div>`;
}
function lineupsHTML(m, evs = []){
  const k = monJoueur();
  // à côté de chaque joueur : ses buts, cartons, entrée et sortie (d'après la chronologie)
  const actions = (t, n) => {
    if (!n) return '';
    const e = evs.filter(e => e.t === t).sort((a, b) => (+a.sort || 0) - (+b.sort || 0));
    const C = { yellow: 'y', white: 'w', red: 'r' };
    // dans l'ordre du match
    const h = e.map(x => x.k === 'goal' && x.n === n ? `<span class="la" title="But ${esc(x.min)}">⚽<small>${esc(x.min)}</small></span>`
      : C[x.k] && x.n === n ? `<span class="la" title="${esc(LABEL[x.k])} ${esc(x.min)}"><i class="kc ${C[x.k]}"></i><small>${esc(x.min)}</small></span>`
      : x.k === 'sub' && x.in_n === n ? `<span class="la in" title="Entré à la ${esc(x.min)}">↑<small>${esc(x.min)}</small></span>`
      : x.k === 'sub' && x.out_n === n ? `<span class="la out" title="Sorti à la ${esc(x.min)}">↓<small>${esc(x.min)}</small></span>` : '').filter(Boolean);
    return h.length ? `<span class="lacts">${h.join('')}</span>` : '';
  };
  const side = t => {
    const li = p => `<li${k && p.name && t === clubSide(m) && playerKey(p.name) === k ? ' class="moi"' : ''}><b>${esc(p.n || "–")}</b><span>${esc(p.name)}</span>${actions(t, p.n)}</li>`;
    const list = rosterSorted(m,t);
    if (!list.length) return `<div><h3>${esc(teamName(m,t))}</h3><p class="nolu">Pas encore saisie</p></div>`;
    if (!list.some(p => p.name)) return `<div><h3>${esc(teamName(m,t))}</h3><p class="nolu">Numéros seulement, sans noms</p></div>`;
    const tit = list.filter(p=>!p.sub), rem = list.filter(p=>p.sub);
    return `<div><h3>${esc(teamName(m,t))}</h3>`
      + (tit.length ? `<div class="lusub">Titulaires</div><ol>${tit.map(li).join('')}</ol>` : '')
      + (rem.length ? `<div class="lusub">Remplaçants</div><ol class="bench">${rem.map(li).join('')}</ol>` : '')
      + '</div>';
  };
  const has = rosterOf(m,'H').length || rosterOf(m,'A').length;
  // compo cachée : le public sait seulement si elle a été saisie
  if (m.compo_cachee && !canManage(m)) return m.compo_cachee_saisie
    ? '<section class="log"><div class="loghead"><h2>Compositions</h2></div><div class="empty">🔒 Compo saisie, non accessible au public.</div></section>' : '';
  if (!has && !canManage(m)) return '';
  const vis = isTeamManager(m.equipe)
    ? `<button type="button" class="vistog${m.compo_cachee ? ' off' : ''}" id="compoVis" aria-pressed="${!m.compo_cachee}"><i></i>${m.compo_cachee ? 'Cachée au public' : 'Visible par tous'}</button>`
    : m.compo_cachee ? '<span class="vistog off static"><i></i>Cachée au public</span>' : '';
  return `<section class="log"><div class="loghead"><h2>Compositions</h2>${canManage(m) ? `<a class="link" href="#/gerer/${esc(m.id)}/compo">${has ? 'Modifier' : '📋 Saisir la compo'}</a>` : ''}</div>`
    + (vis ? `<div class="visrow">${vis}<small>${m.compo_cachee ? 'Seuls les responsables d’équipe, les admins et le responsable score du match la voient.' : 'Tout le monde peut la voir sur la page du match.'}</small></div>` : '')
    + (has && m.status !== 'prevu' && evs.some(e => e.k === 'sub') ? `<button type="button" class="link rempbtn" id="rempBtn">${lsGet('asm-voir-remp', false) ? 'Masquer les remplacements' : 'Afficher les remplacements'}</button>` : '')
    + (has ? `<div class="lineups${lsGet('asm-voir-remp', false) ? ' remp' : ''}">${side('H')}${side('A')}</div>` : '<div class="empty">Compo pas encore saisie.</div>')
    + '</section>';
}
// Historique des modifications d'un match (écrit par la base à chaque changement)
function histoTexte(h, m){
  const qui = (t, n) => n ? (n === 'CSC' ? 'CSC' : 'n°' + n + (nameOf(m, t, n) ? ' ' + nameOf(m, t, n) : '')) : '';
  const act = e => e ? `${LABEL[e.k] || e.k} ${teamName(m, e.t)} ${e.min || ''}${e.k === 'sub' ? ` (sort ${qui(e.t, e.out_n) || '?'}, entre ${qui(e.t, e.in_n) || '?'})` : e.n ? ' · ' + qui(e.t, e.n) : ''}` : '';
  if (h.quoi === 'action_ajout') return 'Ajout : ' + act(h.apres);
  if (h.quoi === 'action_suppression') return 'Suppression : ' + act(h.avant);
  if (h.quoi === 'action_modif'){
    // seulement la minute changée : « But A n°11 X : 45' → 45+1' » ; sinon avant → après
    const a = h.avant || {}, b = h.apres || {};
    if (a.min !== b.min && ['k', 't', 'n', 'in_n', 'out_n'].every(c => (a[c] || null) === (b[c] || null)))
      return 'Correction : ' + act({ ...b, min: '' }).replace(/\s+·/, ' ·').trim() + ' : ' + a.min + ' → ' + b.min;
    return 'Correction : ' + act(a) + ' → ' + act(b);
  }
  if (h.quoi === 'statut') return ({ 'prevu>direct': 'Coup d’envoi', 'direct>termine': 'Fin du match', 'termine>direct': 'Match rouvert', 'direct>prevu': 'Coup d’envoi annulé' })[h.avant + '>' + h.apres] || ('Statut : ' + h.avant + ' → ' + h.apres);
  if (h.quoi === 'periode') return h.apres === 2 ? 'Mi-temps / 2e mi-temps' : h.apres === 1 ? 'Début du match' : 'Période : ' + h.avant + ' → ' + h.apres;
  if (h.quoi === 'responsable') return 'Responsable score : ' + (h.avant || 'personne') + ' → ' + (h.apres || 'personne');
  if (h.quoi === 'horaire') return 'Horaire : ' + fmtDate(h.avant) + ' → ' + fmtDate(h.apres);
  if (h.quoi === 'compo'){
    const parts = [];
    ['H', 'A'].forEach(t => {
      const a = ((h.avant || {})[t]) || [], b = ((h.apres || {})[t]) || [];
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      const k = p => p.name ? playerKey(p.name) : 'n' + p.n;
      const A = new Map(a.map(p => [k(p), p])), B = new Map(b.map(p => [k(p), p]));
      const d = [];
      if (!a.length) d.push(b.length + ' joueurs saisis');
      else {
        b.filter(p => !A.has(k(p))).forEach(p => d.push('+ ' + (p.name || 'n°' + p.n)));
        a.filter(p => !B.has(k(p))).forEach(p => d.push('− ' + (p.name || 'n°' + p.n)));
        b.filter(p => A.has(k(p))).forEach(p => { const o = A.get(k(p));
          if ((o.n || '') !== (p.n || '')) d.push((p.name || '?') + ' : n°' + (o.n || '–') + ' → n°' + (p.n || '–'));
          if (!!o.sub !== !!p.sub) d.push((p.name || 'n°' + p.n) + (p.sub ? ' → remplaçant' : ' → titulaire')); });
      }
      if (d.length) parts.push(teamName(m, t) + ' : ' + d.join(', '));
    });
    return 'Compo ' + (parts.join(' · ') || 'modifiée') + (h.source ? ' — via ' + h.source : '');
  }
  return h.quoi;
}
async function histoCharger(m, box){
  box.innerHTML = '<div class="loading">Chargement…</div>';
  const { data, error } = await sb.from('historique').select('at,par_nom,quoi,avant,apres,source').eq('match_id', m.id).order('at', { ascending: false }).limit(300);
  if (error){ box.innerHTML = '<div class="empty">Pas de réseau pour l’instant.</div>'; return; }
  box.innerHTML = (data || []).length ? '<ul class="histo">' + data.map(h => `<li><span class="hat">${esc(new Date(h.at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</span><b>${esc(h.par_nom || 'Import automatique')}</b><span>${esc(histoTexte(h, m))}</span></li>`).join('') + '</ul>'
    : '<div class="empty">Aucune modification enregistrée (l’historique a démarré le 4 octobre au soir).</div>';
}
// Préchargement discret (une fois par ouverture de l'appli) : Classements et Stats s'affichent ensuite tout de suite
let prefetched = false;
function prefetch(){
  if (prefetched) return; prefetched = true;
  setTimeout(async () => {
    try{ const { data } = await sb.from('classements').select('*').order('equipe'); if (data) lsSet('asm-cls', data); }catch(e){}
    try{
      const [{ data: ms }, { data: evs }] = await Promise.all([
        sb.from('matches').select('id,kickoff,equipe,club_side,rosters,status,competition,home_name,away_name,opp_logo').neq('status','prevu'),
        sb.from('events').select('match_id,t,k,n,in_n,out_n,min,sort')
      ]);
      if (ms && evs) lsSet('asm-stats', { ms, evs });
    }catch(e){}
  }, 2500);
}
// dernière version vue de chaque match, gardée sur le téléphone (affichage immédiat si le réseau est lent)
const matchCache = {
  get: id => lsGet('asm-m-' + id, null),
  set: (id, r) => {
    lsSet('asm-m-' + id, r);
    const ids = lsGet('asm-m-ids', []).filter(x => x !== id); ids.unshift(id);
    ids.slice(30).forEach(x => { try{ localStorage.removeItem('asm-m-' + x); }catch(e){} });
    lsSet('asm-m-ids', ids.slice(0, 30));
  }
};
async function matchView(id){
  // toujours sur cette page ? (#/gerer/<id> contient aussi l'id : sans ce contrôle, la vue spectateur
  // qui finit de charger écrasait la page « Gérer » et son bouton Lancer)
  const tok = route.cur;
  const here = () => route.cur === tok && location.hash.replace(/^#\/?/, '').split('/')[1] === id && /^#\/?match\//.test(location.hash);
  const fresh = (async () => {
    if (isStaff()) await loadDelegues().catch(()=>{});
    if (isAdmin()) await loadPeople().catch(()=>{});
    const r = await fetchMatch(id);
    if (r.m) matchCache.set(id, r);
    return r;
  })();
  // pas encore ouvert sur ce téléphone : tableau d'affichage tout de suite avec les infos de l'accueil
  const fromHome = () => { const c = lsGet('asm-home', null), hm = c && (c.matches || []).find(x => x.id === id); return hm ? { m: { ...hm, _partiel: true }, evs: (c.goals || []).filter(g => g.match_id === id).map(g => ({ k: 'goal', t: g.t })) } : null; };
  const cached = matchCache.get(id) || fromHome();
  if (!cached) view.innerHTML = '<div class="loading">Chargement…</div>';
  let { m, evs } = cached || await fresh;
  if (!here()) return;
  if (!m){ view.innerHTML = '<div class="empty">Ce match n\'existe plus.</div>'; return; }
  // Demandes pour être responsable score (match sans responsable) : visibles par le demandeur et par les responsables de l'équipe
  let dem = [];
  const loadDem = async () => {
    if (!session || !isMember()) return;
    // demande faite avant de se connecter / créer son compte : on l'envoie maintenant
    const apres = lsGet('asm-apres-connexion', null);
    if (apres && apres.demande === id){
      lsSet('asm-apres-connexion', null);
      if (!m.delegue_id && m.status !== 'termine' && !isTeamManager(m.equipe)){
        const { data, error } = await sb.rpc('demander_score', { p_match: m.id });
        if (!error){ notifDem(data); toast('Demande envoyée aux responsables de l’équipe'); }
      }
    }
    const { data } = await sb.from('demandes_score').select('*').eq('match_id', id).order('created_at');
    dem = data || []; if (here()) draw();
  };
  const demHTML = () => {
    if (m.delegue_id || m.status === 'termine' || m._partiel) return '';
    // pas connecté : le bouton est là aussi, il mène à la création de compte (ou à la connexion)
    if (!session) return `<div class="demcard"><b>Pas encore de responsable score pour ce match</b><small>Tu es au match ? Propose de saisir le score : il faut juste un compte (10 secondes).</small>
      <button type="button" class="fbtn primary" id="demLogin" style="width:100%;margin-top:8px">🙋 Je veux être responsable score</button></div>`;
    if (!isMember()) return '';
    const att = dem.filter(d => d.statut === 'attente');
    if (isTeamManager(m.equipe)){
      if (!att.length) return '';
      return `<div class="demcard"><b>🙋 ${att.length > 1 ? att.length + ' demandes' : 'Demande'} pour être responsable score</b>${att.map(d => `<div class="demrow"><span>${esc(d.nom)}</span>
        <button type="button" class="pill ok" data-dok="${esc(d.id)}">Accepter</button><button type="button" class="pill" data-dno="${esc(d.id)}">Refuser</button></div>`).join('')}</div>`;
    }
    const mine = dem.filter(d => d.user_id === myId()).pop();
    if (mine && mine.statut === 'attente')
      return `<div class="demcard"><b>⏳ Ta demande pour être responsable score est en attente</b><small>Un responsable de l’équipe ou un admin va l’accepter ou la refuser.</small>
        <button type="button" class="link" data-dann="${esc(mine.id)}">Retirer ma demande</button></div>`;
    return `<div class="demcard"><b>Pas encore de responsable score pour ce match</b>${mine && mine.statut === 'refusee' ? '<small>Ta précédente demande a été refusée.</small>' : '<small>Tu peux proposer de saisir le score et les remplacements.</small>'}
      <button type="button" class="fbtn primary" id="demAsk" style="width:100%;margin-top:8px">🙋 Je veux être responsable score</button></div>`;
  };
  const notifDem = id2 => { if (session) fetch('api/notify-demande', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify({ id: id2 }) }).catch(() => {}); };
  const bindDem = () => {
    if ($('demLogin')) $('demLogin').onclick = () => {
      lsSet('asm-apres-connexion', { demande: m.id, titre: teamName(m, 'H') + ' – ' + teamName(m, 'A') });
      lsSet('asm-login-mode', 'up');
      location.hash = '#/connexion';
    };
    if ($('demAsk')) $('demAsk').onclick = async () => {
      $('demAsk').disabled = true;
      const { data, error } = await sb.rpc('demander_score', { p_match: m.id });
      if (error){ toast(isNetErr(error) ? 'Pas de réseau' : /déjà un responsable/.test(error.message) ? 'Ce match a déjà un responsable score' : 'Demande refusée'); loadDem(); return; }
      notifDem(data); toast('Demande envoyée aux responsables de l’équipe'); loadDem();
    };
    view.querySelectorAll('[data-dann]').forEach(b => b.onclick = async () => {
      await sb.rpc('annuler_demande_score', { p_id: b.dataset.dann }); toast('Demande retirée'); loadDem();
    });
    view.querySelectorAll('[data-dok], [data-dno]').forEach(b => b.onclick = async () => {
      const ok = !!b.dataset.dok, did = b.dataset.dok || b.dataset.dno, d = dem.find(x => x.id === did);
      b.disabled = true;
      const { error } = await sb.rpc('decider_score', { p_id: did, p_ok: ok });
      if (error){ toast(isNetErr(error) ? 'Pas de réseau' : /déjà un responsable/.test(error.message) ? 'Ce match a déjà un responsable score' : 'Action refusée'); loadDem(); return; }
      notifDem(did);
      toast(ok ? `${d ? d.nom : 'Le demandeur'} est responsable score` : 'Demande refusée');
      if (ok){ delegues = null; try{ const r = await fetchMatch(m.id); if (r.m){ m = r.m; evs = r.evs; matchCache.set(id, r); } }catch(e){} }
      loadDem();
    });
  };
  const draw = () => {
    view.innerHTML = `<a class="back" href="#/">← Tous les matchs</a>` + boardHTML(m, evs, false) + niveauHTML(m) + lieuHTML(m)
      + `<div class="mactions"><button class="pill" id="btnBell">🔔 Buts des ${esc(teamLabel(m.equipe))}</button><button class="pill" id="btnShareLive">↗ Partager</button></div>`
      + demHTML()
      + (canManage(m) ? `<a class="fbtn primary big" href="#/gerer/${esc(m.id)}">Gérer ce match</a>` : '')
      + (isStaff() || m.delegue_nom ? `<div class="field deleg"><span>Responsable score</span>${delegPickHTML('delSel', m.delegue_id, m.delegue_nom, !isTeamManager(m.equipe))}${canManage(m) && !isTeamManager(m.equipe) ? '<small>Seul le responsable de l’équipe (ou un admin) peut changer le responsable score.</small>' : isStaff() && !canManage(m) ? '<small>Seuls le responsable de l’équipe, le responsable score ou un admin peuvent modifier ce match.</small>' : ''}</div>` : '')
      + (isAdmin() && people ? `<div class="audit">Match créé par ${esc(personName(m.created_by))}${m.rosters_at ? ` · Compo saisie par ${esc(personName(m.rosters_by))} le ${esc(fmtDate(m.rosters_at))}` : ''}</div>` : '')
      + (m._partiel ? '<div class="loading">Chargement des détails…</div>' : (m.status==='prevu' ? rdvHTML(m) + lineupsHTML(m, evs) : '')
      + `<section class="log"><div class="loghead"><h2>Chronologie</h2></div><div id="events">${timelineHTML(m, evs, false)}</div></section>`
      + (m.status!=='prevu' ? lineupsHTML(m, evs) : '')
      + (isStaff() || canManage(m) ? '<details class="histobox" id="histoBox"><summary>🕓 Historique des modifications</summary><div id="histoList"></div></details>' : ''));
    $('btnShareLive').onclick = () => shareLink(m);
    if ($('rempBtn')) $('rempBtn').onclick = () => { const v = !lsGet('asm-voir-remp', false); lsSet('asm-voir-remp', v); view.querySelector('.lineups')?.classList.toggle('remp', v); $('rempBtn').textContent = v ? 'Masquer les remplacements' : 'Afficher les remplacements'; };
    if ($('histoBox')) $('histoBox').ontoggle = () => { if ($('histoBox').open) histoCharger(m, $('histoList')); };
    if ($('btnLieu')) $('btnLieu').onclick = () => openLieu(m);
    if ($('rdvBox')) { const ms = new Date(m.kickoff).getTime() - Date.now(); if (ms < 864e5) setTimeout(() => $('rdvBox')?.remove(), ms); }
    $('btnBell').onclick = () => openBell(m.equipe || 1);
    if ($('compoVis')) $('compoVis').onclick = async () => {
      const hide = !m.compo_cachee;
      $('compoVis').disabled = true;
      const { data: upd, error } = await sb.from('matches').update({ compo_cachee: hide }).eq('id', m.id).select('id');
      if (error || !upd || !upd.length){ toast(isNetErr(error) ? 'Pas de réseau' : 'Modification refusée'); draw(); return; }
      toast(hide ? 'Compo cachée au public' : 'Compo visible par tous');
      try{ const r = await fetchMatch(m.id); if (r.m){ m = r.m; evs = r.evs; } }catch(e){ m.compo_cachee = hide; }
      draw();
    };
    bindDelegPick($('delSel'), m.delegue_nom, async id => {
      const { data: upd, error } = await sb.from('matches').update({delegue_id: id, delegue_nom: delegueNom(id)}).eq('id', m.id).select('id');
      if (error || !upd || !upd.length){ toast(isNetErr(error) ? 'Pas de réseau' : 'Modification refusée'); draw(); return; }
      m.delegue_id = id; m.delegue_nom = delegueNom(id); toast(id ? 'Responsable score : ' + m.delegue_nom : 'Responsable score non défini : le responsable d’équipe gère le match'); draw();
    });
    bindDem();
    document.title = `${teamName(m,'H')} ${goals(evs,'H')}–${goals(evs,'A')} ${teamName(m,'A')} · AS Mésanger`;
  };
  draw();
  loadDem();
  if (cached) fresh.then(r => {
    if (!here()) return;
    if (!r.m){ view.innerHTML = '<div class="empty">Ce match n\'existe plus.</div>'; return; }
    m = r.m; evs = r.evs; draw();
  }).catch(() => { const l = m._partiel && here() && view.querySelector('.loading'); if (l) l.textContent = 'Pas de réseau pour l’instant : les détails s’afficheront dès qu’il revient.'; });
  const reload = debounce(async () => { try{ const r = await fetchMatch(id); if (r.m){ matchCache.set(id, r); if (!here()) return; m = r.m; evs = r.evs; draw(); loadDem(); } }catch(e){} }, 300);
  const off = liveChannel('match', reload, [
    {event:'*', table:'matches', filter:`id=eq.${id}`},
    {event:'*', table:'events', filter:`match_id=eq.${id}`},
    {event:'DELETE', table:'events'}
  ]);
  const tick = setInterval(() => {
    if (m.status==='prevu') return;
    const c = $('clock'), p = $('period');
    if (c) c.textContent = clockText(m); if (p) p.textContent = periodText(m);
  }, 1000);
  const poll = fallbackPoll(off, reload); // filet de sécurité si le temps réel décroche ou est complet
  const vis = () => { if (document.visibilityState==='visible') reload(); };
  document.addEventListener('visibilitychange', vis);
  cleanup = () => { off(); clearInterval(tick); clearInterval(poll); document.removeEventListener('visibilitychange', vis); document.title = 'AS Mésanger – Matchs en direct'; };
}
async function shareLink(m){
  const url = location.origin + location.pathname + '#/match/' + m.id;
  const title = `${teamName(m,'H')} – ${teamName(m,'A')} en direct`;
  if (navigator.share){ try{ await navigator.share({title, url}); return; }catch(e){ if (e && e.name==='AbortError') return; } }
  try{ await navigator.clipboard.writeText(url); toast('Lien copié'); }catch(e){ prompt('Lien du direct', url); }
}

// ---------- Nouveau match ----------
async function newMatchView(){
  if (!canCreate()){ location.hash = session ? '#/compte' : '#/connexion'; return; }
  await loadDelegues().catch(()=>{});
  const TEAMS_OK = TEAMS.filter(n => isTeamManager(n));
  const d = new Date(); d.setMinutes(Math.ceil(d.getMinutes()/15)*15, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  let side = 'H', equipe = TEAMS_OK.includes(homeF.team) ? homeF.team : (TEAMS_OK.find(n => catOf(n) === homeF.cat) || TEAMS_OK[0]);
  view.innerHTML = `<form class="card" id="nf">
    <h1>Nouveau match</h1><p class="sub">Deux mi-temps de 45 min.</p>
    <label class="field"><span>Adversaire</span><input id="nfOpp" required autocomplete="off" placeholder="Nom de l'équipe adverse"></label>
    <div class="field"><span>Équipe</span><div id="nfTeam">${CATS.map(c => { const l = catTeams(c).filter(n => TEAMS_OK.includes(n)); return l.length ? `<div class="segcat"><small>${esc(c)}</small><div class="seg">${l.map(n=>`<button type="button" data-e="${n}" class="${n===equipe?'on':''}" title="${esc(teamLabel(n))}">${esc(shortIn(n))}</button>`).join('')}</div></div>` : ''; }).join('')}</div></div>
    <div class="field"><span>Lieu</span><div class="seg" id="nfSide"><button type="button" data-s="H" class="on">Domicile</button><button type="button" data-s="A">Extérieur</button></div></div>
    <label class="field"><span>Date et heure du coup d'envoi</span><input id="nfDate" type="datetime-local" value="${local}" required></label>
    <label class="field"><span>Compétition</span><input id="nfComp" autocomplete="off" placeholder="Championnat, Coupe…" list="compList"><datalist id="compList"></datalist></label>
    <div class="field"><span>Responsable score</span>${delegPickHTML('nfDel', isAdmin() ? '' : myId())}<small>Si un responsable score est choisi, lui seul (avec les responsables d’équipe et les admins) pourra saisir le match.</small></div>
    <div id="nfMsg"></div>
    <div class="foot" style="margin-top:4px"><button class="fbtn primary" id="nfGo">Créer le match</button><a class="fbtn" href="#/">Annuler</a></div>
  </form>`;
  sb.from('matches').select('competition').neq('competition','').limit(200).then(({data}) => {
    const set = [...new Set((data||[]).map(r=>r.competition))];
    $('compList') && ($('compList').innerHTML = set.map(c=>`<option value="${esc(c)}">`).join(''));
  });
  $('nfTeam').querySelectorAll('button').forEach(b => b.onclick = () => {
    equipe = +b.dataset.e; $('nfTeam').querySelectorAll('button').forEach(x=>x.classList.toggle('on', x===b));
  });
  $('nfSide').querySelectorAll('button').forEach(b => b.onclick = () => {
    side = b.dataset.s; $('nfSide').querySelectorAll('button').forEach(x=>x.classList.toggle('on', x===b));
  });
  bindDelegPick($('nfDel'));
  $('nf').onsubmit = async ev => {
    ev.preventDefault();
    const opp = $('nfOpp').value.trim(); if (!opp) return;
    $('nfGo').disabled = true;
    const row = {
      id: uuid(), kickoff: new Date($('nfDate').value).toISOString(), competition: $('nfComp').value.trim(),
      equipe, delegue_id: $('nfDel').dataset.value || null, delegue_nom: delegueNom($('nfDel').dataset.value || null), club_side: side, home_name: side==='H' ? clubTeamName(equipe) : opp, away_name: side==='H' ? opp : clubTeamName(equipe), half: HALF
    };
    const { error } = await sb.from('matches').insert(row);
    if (error){ $('nfGo').disabled = false; $('nfMsg').innerHTML = `<div class="msg err">${esc(isNetErr(error) ? 'Pas de réseau : il faut être connecté pour créer le match.' : error.message)}</div>`; return; }
    location.hash = '#/gerer/' + row.id;
  };
}

// ---------- Console du délégué ----------
async function consoleView(id, openCompo){
  if (isAdmin()) await loadPeople().catch(()=>{});
  if (!isMember()){ location.hash = session ? '#/compte' : '#/connexion'; return; }
  view.innerHTML = '<div class="loading">Chargement…</div>';
  const CK = 'asm-console-' + id;
  let S = null;
  const cached = lsGet(CK, null);
  if (cached && pendingFor(id)) S = cached;
  else {
    try{ const r = await fetchMatch(id); if (r.m) S = {...r.m, events: r.evs}; }
    catch(e){ if (cached) S = cached; else throw e; }
  }
  if (!S){ view.innerHTML = '<div class="empty">Ce match n\'existe plus.</div>'; return; }
  if (!canManage(S)){
    view.innerHTML = `<div class="card"><h1>Tu ne gères pas ce match</h1><p class="sub">Ce match des ${esc(teamLabel(S.equipe))} peut être saisi par le responsable de l’équipe${S.delegue_nom ? `, par ${esc(S.delegue_nom)} (responsable score)` : ''} ou par un admin.</p><a class="fbtn" href="#/match/${esc(id)}" style="width:100%">Voir le direct</a></div>`;
    return;
  }
  S.rosters = S.rosters || {H:[],A:[]};
  const saveLocal = () => lsSet(CK, S);
  const patch = fields => { Object.assign(S, fields); saveLocal(); queue({kind:'match', match:id, fields}); };
  const evRow = e => ({id:e.id, match_id:id, t:e.t, k:e.k, n:e.n||null, out_n:e.out_n||null, in_n:e.in_n||null, min:e.min, sort:e.sort, p:e.p});
  const pushEv = e => { saveLocal(); queue({kind:'ev', match:id, row:evRow(e)}); };
  saveLocal();

  view.innerHTML = `
    <div id="boardBox"></div>
    <div class="cobar" id="coBar" hidden></div>
    <div class="syncrow"><span class="sync" id="sync">Envoyé</span><button class="link" id="btnShareLive" style="padding:0">Partager le direct</button></div>
    <section class="actions">
      ${['H','A'].map(t => `<div class="col ${t===clubSide(S)?'home':'away'}">
        <h2>${esc(teamName(S,t))}</h2>
        <button class="act goal" data-t="${t}" data-k="goal">But</button>
        <button class="act" data-t="${t}" data-k="sub"><span class="ic sub">⇄</span>Remplacement</button>
        <button class="act" data-t="${t}" data-k="yellow"><span class="ic y"></span>Carton jaune</button>
        <button class="act" data-t="${t}" data-k="white"><span class="ic w"></span>Carton blanc</button>
        <button class="act" data-t="${t}" data-k="red"><span class="ic r"></span>Carton rouge</button>
      </div>`).join('')}
    </section>
    <button class="fbtn" id="btnLineup" style="width:100%;margin-top:12px">Compositions des équipes</button>
    <section class="log">
      <div class="loghead"><h2>Chronologie</h2><button id="btnShift" style="color:var(--muted);font-size:14px;text-decoration:underline;padding:6px 0">Décaler les minutes</button></div>
      <p style="margin:0 0 6px;color:var(--muted);font-size:13px">Touche une action pour corriger sa minute. <span id="count"></span></p>
      <div id="events"></div>
    </section>
    <div class="foot">
      <button class="fbtn primary" id="btnRecap">Récapitulatif</button>
      <a class="fbtn" href="#/match/${esc(id)}">Vue spectateur</a>
    </div>
    <div class="foot" style="margin-top:10px">
      <button class="fbtn" id="btnInfo">Modifier les infos</button>
      ${isTeamManager(S.equipe) ? '<button class="fbtn danger" id="btnDelete">Supprimer le match</button>' : ''}
    </div>`;

  function renderClock(){
    const c = $('clock'); if (!c) return;
    c.textContent = clockText(S);
    $('period').textContent = periodText(S) + (S.status==='termine' ? '' : ' · toucher le chrono pour régler');
    const bc = $('btnClock'), bp = $('btnPeriod');
    bc.hidden = S.status==='termine';
    const mt = isMiTemps(S);
    bc.textContent = S.running ? 'Pause' : S.period===0 ? 'Lancer' : mt ? 'Lancer la 2e' : 'Reprendre';
    bp.hidden = S.period===0 || mt;
    bp.textContent = S.status==='termine' ? 'Rouvrir' : S.period===1 ? 'Mi-temps' : 'Fin du match';
    // « Pause » en petit, à côté du bouton principal « Mi-temps » / « Fin du match »
    bc.classList.toggle('ghost', !!S.running); bc.classList.toggle('small', !!S.running);
    bp.classList.toggle('ghost', !S.running && S.status!=='termine');
  }
  function render(){
    $('boardBox').innerHTML = boardHTML(S, S.events, true);
    $('count').textContent = S.events.length ? `${S.events.length} action${S.events.length>1?'s':''}` : '';
    const box = $('events');
    box.innerHTML = timelineHTML(S, S.events, true);
    box.querySelectorAll('.ev').forEach(row => {
      const e = S.events.find(x => x.id === row.dataset.id);
      row.onclick = ev => { if (!ev.target.closest('.del')) editEvent(e); };
      row.querySelector('.del').onclick = () => askConfirm('Supprimer cette action ?', `${LABEL[e.k]} · ${teamName(S,e.t)} · ${e.min}`, 'Supprimer', () => {
        S.events = S.events.filter(x=>x.id!==e.id); saveLocal(); queue({kind:'evdel', match:id, id:e.id}); render();
      });
    });
    bindClock(); renderClock();
  }
  function renderSync(){
    const el = $('sync'); if (!el) return;
    const n = outbox.filter(o=>o.match===id).length;
    el.className = 'sync' + (n ? (navigator.onLine ? ' wait' : ' off') : '');
    el.textContent = n ? `${n} envoi${n>1?'s':''} en attente${navigator.onLine ? '…' : ' (hors ligne)'}` : 'Envoyé · les spectateurs suivent en direct';
  }
  // 30 s pour annuler un coup d'envoi lancé par erreur : la notification « C'est parti » n'est envoyée qu'après
  let undoTimer = null;
  function annulerCoupEnvoi(){
    const fin = Date.now() + 30000;
    document.querySelector('.undobar')?.remove();
    const bar = document.createElement('div');
    bar.className = 'undobar';
    bar.innerHTML = '<span>Coup d’envoi lancé · notification dans <b id="undoN">30</b> s</span><button type="button" id="undoGo">Annuler</button>';
    document.body.appendChild(bar);
    const stop = () => { clearInterval(undoTimer); undoTimer = null; bar.remove(); };
    clearInterval(undoTimer);
    undoTimer = setInterval(() => { const s = Math.ceil((fin - Date.now()) / 1000); if (s <= 0 || !document.body.contains(bar)) return stop(); $('undoN').textContent = s; }, 250);
    $('undoGo').onclick = () => {
      stop();
      if (S.events.length) return toast('Des actions sont déjà notées : supprime-les d’abord');
      const adv = oppSide(S), r = rosterOf(S, adv);
      const auto = r.length === 14 && r.every((p, k) => p.n === String(k + 1) && !p.name);   // numéros mis au coup d'envoi
      patch({ status: 'prevu', period: 0, running: false, acc: 0, started_at: 0, ...(auto ? { rosters: { ...S.rosters, [adv]: [] }, compo_source: 'coup d’envoi annulé : numéros automatiques retirés' } : {}) }); render();
      toast('Coup d’envoi annulé · aucune notification envoyée');
    };
    const prev = cleanup;
    cleanup = () => { stop(); if (prev) prev(); };
  }
  function bindClock(){
    $('btnClock').onclick = () => {
      const f = {}, coupEnvoi = S.period===0 && S.status==='prevu';
      if (S.period===0){ f.period = 1; f.status = 'direct'; }
      // adversaire sans compo : numéros 1 à 14 (12 à 14 remplaçants) pour aider à la saisie
      const adv = oppSide(S);
      if (coupEnvoi && !rosterOf(S, adv).length)
        f.rosters = { ...(S.rosters || {}), [adv]: Array.from({length: 14}, (_, k) => ({ n: String(k + 1), name: '', sub: k >= 11 })) };
        f.compo_source = 'numéros automatiques au coup d’envoi';
      // plus de 11 titulaires au coup d'envoi : les plus grands numéros passent remplaçants
      if (coupEnvoi){
        const ro = { ...(f.rosters || S.rosters || {}) }, bancs = [];
        ['H', 'A'].forEach(t => { const r = onzeTitulaires(ro[t]); if (r.moved.length){ ro[t] = r.list; bancs.push(...r.moved.map(n => 'n°' + n)); } });
        if (bancs.length){ f.rosters = ro; f.compo_source = (f.compo_source ? f.compo_source + ' + ' : '') + 'plus de 11 titulaires corrigés au coup d’envoi'; setTimeout(() => toast(`Plus de 11 titulaires : ${bancs.join(', ')} mis remplaçant${bancs.length > 1 ? 's' : ''}`), 1500); }
      }
      if (S.running){ f.acc = (+S.acc) + Date.now() - (+S.started_at); f.running = false; }
      else { f.started_at = Date.now(); f.running = true; }
      patch(f); renderClock();
      if (coupEnvoi) annulerCoupEnvoi();
    };
    $('btnPeriod').onclick = () => {
      if (S.status==='termine') return askConfirm('Rouvrir le match', 'Le match repasse en direct pour corriger ou reprendre.', 'Rouvrir', () => { patch({status:'direct'}); render(); });
      if (S.period===1) return askConfirm('Mi-temps', 'Le chrono s\'arrête. À la reprise, touche « Lancer la 2e » : il repartira de ' + S.half + ':00.', 'C\'est la mi-temps', () => {
        patch({period:2, acc:0, running:false}); render();
      });
      askConfirm('Fin du match', 'Le chrono s\'arrête et le match passe dans les résultats. Tu pourras encore corriger les actions.', 'Terminer le match', () => {
        const f = {status:'termine', running:false};
        if (S.running) f.acc = (+S.acc) + Date.now() - (+S.started_at);
        patch(f); render(); toast('Match terminé');
      });
    };
    $('clock').onclick = () => {
      if (S.status==='termine') return;
      openSheet(`<h3 id="shTitle">Régler le chrono</h3><p>Pour rattraper un oubli ou un décalage. Le chrono continue de tourner.</p>
        <div class="display" id="adjDisp"></div>
        <div class="pad">
          <button class="key" data-m="-5">−5</button><button class="key" data-m="-1">−1</button><button class="key" data-m="1">+1</button>
          <button class="key" data-m="5">+5</button><button class="key" data-m="8">+8</button><button class="key" data-m="10">+10</button>
        </div>
        <button class="fbtn primary" id="adjOk" style="width:100%;margin-top:12px">Terminé</button>`);
      const upd = () => { $('adjDisp').textContent = clockText(S); };
      upd();
      $('shBody').querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
        const f = {};
        if (S.period===0){ f.period = 1; f.status = 'direct'; }
        let acc = (+S.acc) + (+b.dataset.m)*60000;
        if (S.running && acc + Date.now() - (+S.started_at) < 0) acc = -(Date.now() - (+S.started_at));
        if (!S.running) acc = Math.max(0, acc);
        f.acc = acc; patch(f); upd(); renderClock();
      });
      $('adjOk').onclick = closeSheet;
    };
  }
  const tick = setInterval(renderClock, 500);
  syncListeners.add(renderSync);
  window.addEventListener('online', renderSync); window.addEventListener('offline', renderSync);
  cleanup = () => { clearInterval(tick); syncListeners.delete(renderSync); window.removeEventListener('online', renderSync); window.removeEventListener('offline', renderSync); };

  // Saisie d'un numéro de joueur
  function askNumber(title, sub, minLabel, cb, t, choices, csc){
    let val = '', pending = null; // pending : joueur de la compo sans numéro, dont on tape le numéro
    const chips = (choices||[]).map(p=>`<button class="chip${p.bench?' bench':''}${p.n ? '' : ' nonum'}" data-c="${esc(p.n)}" data-nm="${esc(p.name)}"><b>${esc(p.n || '?')}</b><span>${esc(p.name)}</span></button>`).join('');
    openSheet(`
      <h3 id="shTitle">${esc(title)}</h3><p>${esc(sub)}${chips ? ' · touche un joueur ou tape son numéro' : ''}</p>
      ${chips ? `<div class="chips">${chips}</div>` : ''}
      <div class="display empty-n" id="disp">Numéro du joueur</div>
      <div class="pname" id="pname"></div>
      <div class="pad">
        ${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="key" data-n="${n}">${n}</button>`).join('')}
        <button class="key" data-n="back" aria-label="Effacer">⌫</button>
        <button class="key" data-n="0">0</button>
        <button class="key ok" data-n="ok">Valider</button>
      </div>
      ${csc ? '<button class="fbtn" id="cscBtn" style="width:100%;margin-top:8px">Contre son camp (CSC)</button>' : ''}
      <div class="minrow"><label for="minEdit">Minute</label><input id="minEdit" value="${esc(minLabel)}"></div>
      <button class="cancel" id="cancel">Annuler</button>`);
    const disp = $('disp');
    const done = v => { const m = $('minEdit').value.trim() || minLabel; closeSheet(); cb(v, m); };
    const upd = () => {
      disp.textContent = val || (pending ? 'Numéro de ' + pending : 'Numéro du joueur'); disp.classList.toggle('empty-n', !val);
      $('pname').textContent = pending ? pending : val ? nameOf(S,t,val) : '';
    };
    // joueur sans numéro : on tape son numéro, il est enregistré dans la compo puis l'action est notée
    const assign = () => {
      const n = String(+val);
      const r = rosterOf(S,t);
      if (r.some(p => p.n === n)){ toast(`Le n°${n} est déjà pris par ${nameOf(S,t,n)}`); return; }
      const i = r.findIndex(p => !p.n && p.name === pending);
      if (i < 0){ done(n); return; }
      const rosters = { ...(S.rosters || {}) }; rosters[t] = r.map((p, k) => k === i ? { ...p, n } : p);
      patch({ rosters, compo_source: 'numéro ajouté pendant le match' });
      done(n);
    };
    $('shBody').querySelectorAll('.chip').forEach(c => c.onclick = () => {
      if (c.dataset.c) return done(c.dataset.c);
      pending = c.dataset.nm; val = ''; upd(); toast('Tape le numéro de ' + pending + ' puis Valider');
    });
    $('shBody').querySelectorAll('.key').forEach(k => k.onclick = () => {
      const n = k.dataset.n;
      if (n==='back') val = val.slice(0,-1);
      else if (n==='ok') { if (pending && val) return assign(); done(val ? String(+val) : ''); return; }
      else if (val.length < 3) val += n;
      upd();
    });
    $('cancel').onclick = closeSheet;
    if ($('cscBtn')) $('cscBtn').onclick = () => done('CSC');
  }
  function onPitch(t){
    const set = new Set(rosterOf(S,t).filter(p=>!p.sub).map(p=>p.n));
    [...S.events].filter(e=>e.t===t).sort((a,b)=>a.sort-b.sort).forEach(e=>{
      if (e.k==='sub'){ if(e.out_n) set.delete(String(e.out_n)); if(e.in_n) set.add(String(e.in_n)); }
      if (e.k==='red' && e.n) set.delete(String(e.n));
    });
    return set;
  }
  const sentOff = t => new Set(S.events.filter(e=>e.t===t&&e.k==='red'&&e.n).map(e=>String(e.n)));
  // 10 s pour annuler une action notée par erreur ; la notification (buts, cartons) ne part qu'après
  const notifsEnAttente = new Map();
  const envoyerNotif = eid => {
    const t = notifsEnAttente.get(eid); if (t === undefined) return;
    clearTimeout(t); notifsEnAttente.delete(eid);
    if (S.events.some(x => x.id === eid)) queue({kind:'notify', match:id, id:eid});
  };
  let fermerAnnulation = null;
  function proposerAnnulation(e){
    if (fermerAnnulation) fermerAnnulation();
    document.querySelector('.undobar')?.remove();
    const fin = Date.now() + 10000;
    const bar = document.createElement('div');
    bar.className = 'undobar';
    bar.innerHTML = `<span>${esc(LABEL[e.k])} noté · ${esc(e.min)} — <b id="undoActN">10</b> s pour annuler</span><button type="button" id="undoActGo">Annuler</button>`;
    document.body.appendChild(bar);
    const tick = setInterval(() => { const r = Math.ceil((fin - Date.now()) / 1000); if (r <= 0 || !document.body.contains(bar)) return fermer(); const n = document.getElementById('undoActN'); if (n) n.textContent = r; }, 250);
    const fermer = () => { clearInterval(tick); bar.remove(); if (fermerAnnulation === fermer) fermerAnnulation = null; };
    fermerAnnulation = fermer;
    document.getElementById('undoActGo').onclick = () => {
      fermer();
      const t = notifsEnAttente.get(e.id); if (t !== undefined){ clearTimeout(t); notifsEnAttente.delete(e.id); }
      if (!S.events.some(x => x.id === e.id)) return;
      S.events = S.events.filter(x => x.id !== e.id); saveLocal(); queue({kind:'evdel', match:id, id:e.id}); render();
      toast(`${LABEL[e.k]} annulé${t !== undefined ? ' · aucune notification envoyée' : ''}`);
    };
  }
  function add(e){
    e.id = uuid(); e.p = S.period || 1; e.created_at = new Date().toISOString(); e.created_by = myId();
    e.sort = sortFromLabel(e.min, e.sort);
    if (S.status==='prevu') patch({status:'direct', period: S.period || 1});
    S.events.push(e); pushEv(e);
    if (['goal','yellow','white','red'].includes(e.k)) notifsEnAttente.set(e.id, setTimeout(() => envoyerNotif(e.id), 10000));   // buts et cartons
    render();
    proposerAnnulation(e);
  }
  view.querySelectorAll('.act').forEach(b => b.onclick = () => {
    const t = b.dataset.t, k = b.dataset.k, cm = currentMinute(S), tn = teamName(S,t);
    if (k === 'sub'){
      const pitch = onPitch(t), off = sentOff(t);
      const onField = rosterSorted(S,t).filter(p=>pitch.has(p.n));
      const bench = rosterSorted(S,t).filter(p=>!pitch.has(p.n) && !off.has(p.n)).map(p=>({...p, bench:true}));
      askNumber('Joueur qui sort', tn, cm.label, (out, min) => {
        // plus de 11 sur le terrain (compo mal réglée) : on propose aussi les autres joueurs, pour ne pas bloquer
        const entrants = pitch.size > 11 ? [...bench, ...onField.filter(p => p.n !== String(out)).map(p => ({...p, bench:true}))] : bench;
        askNumber('Joueur qui entre', `${tn} · remplace ${who(S,t,out,'?')}`, min, (inn, min2) => {
          add({t, k, out_n:out, in_n:inn, min:min2, sort:cm.sort});
        }, t, entrants);
      }, t, onField);
    } else {
      const pitch = onPitch(t);
      const list = rosterSorted(S,t).map(p => pitch.has(p.n) ? p : {...p, bench:true});
      askNumber(LABEL[k], tn, cm.label, (n, min) => add({t, k, n, min, sort:cm.sort}), t, k==='goal' ? list.filter(p=>!p.bench) : list, k==='goal');
    }
  });
  function stepper(title, text, initial, fmt, okLabel, onOk){
    let v = initial;
    openSheet(`<h3 id="shTitle">${esc(title)}</h3><p>${esc(text)}</p>
      <div class="display" id="stDisp"></div>
      <div class="pad">
        <button class="key" data-d="-5">−5</button><button class="key" data-d="-1">−1</button><button class="key" data-d="1">+1</button>
        <button class="key" data-d="5">+5</button><button class="key" data-d="8">+8</button><button class="key" data-d="10">+10</button>
      </div>
      <div class="foot" style="margin-top:10px"><button class="fbtn primary" id="stOk">${esc(okLabel)}</button><button class="fbtn" id="stNo">Annuler</button></div>`);
    const upd = () => { $('stDisp').textContent = fmt(v); };
    upd();
    $('shBody').querySelectorAll('[data-d]').forEach(b => b.onclick = () => { v += +b.dataset.d; if (initial > 0) v = Math.max(1, v); upd(); });
    $('stOk').onclick = () => { closeSheet(); onOk(v); };
    $('stNo').onclick = closeSheet;
  }
  function editEvent(e){
    stepper(`${LABEL[e.k]} · ${teamName(S,e.t)}`, 'Corrige la minute de cette action.', Math.max(1, absOf(e.min)), v => labelOf(S, v, e.p), 'Enregistrer', v => {
      e.min = labelOf(S, v, e.p); e.sort = sortFromLabel(e.min, e.sort); pushEv(e); render(); toast('Minute corrigée');
    });
  }
  $('btnShift').onclick = () => stepper('Décaler toutes les actions', 'Ajoute ou retire des minutes à toutes les actions déjà notées.', 0, d => (d>0?'+':'') + d + ' min', 'Appliquer', d => {
    if (!d) return;
    S.events.forEach(e => { e.min = labelOf(S, Math.max(1, absOf(e.min)+d), e.p); e.sort = sortFromLabel(e.min, e.sort); pushEv(e); });
    render(); toast('Minutes décalées');
  });

  // Compositions : éditeur ligne par ligne (+ photo de la feuille, + liste collée)
  function parse(txt){
    return txt.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
      const m = l.match(/^(\d{1,3})[\s.\-)]+(.*?)(\s+R)?$/i); if(!m) return null;
      return {n:String(+m[1]), name:m[2].trim(), sub:!!m[3]};
    }).filter(Boolean);
  }
  // Joueurs des compos précédentes de cette équipe : ajout en un toucher + saisie semi-automatique
  let pastPlayers = null;
  async function loadPastPlayers(){
    if (pastPlayers) return pastPlayers;
    pastPlayers = [];
    try{
      const { data } = await sb.from('matches').select('rosters,club_side,kickoff').eq('equipe', S.equipe || 1).neq('id', id).order('kickoff', {ascending:false}).limit(40);
      const map = new Map();
      (data||[]).forEach(r => (((r.rosters||{})[r.club_side])||[]).forEach(p => {
        const k = playerKey(p.name || ''); if (!k) return;
        const e = map.get(k) || {name:p.name, n:p.n, count:0}; e.count++; map.set(k, e);
      }));
      pastPlayers = [...map.values()].sort((a,b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));
    }catch(e){ /* hors ligne : pas de suggestions */ }
    return pastPlayers;
  }
  function openLineupEditor(){
    const order = [clubSide(S), oppSide(S)];
    let viaPhoto = false, viaColle = false;   // comment la compo a été entrée (historique)
    const grouped = t => { const l = rosterSorted(S,t).map(p=>({...p})); return [...l.filter(p=>!p.sub), ...l.filter(p=>p.sub)]; };
    const ed = {H: grouped('H'), A: grouped('A')};
    let cur = order[0], paste = false, errs = new Set(), msg = '';
    const counts = t => { const tit = ed[t].filter(p=>!p.sub).length; return {tit, rem: ed[t].length - tit}; };
    const nextNum = t => { const used = new Set(ed[t].map(p=>+p.n).filter(Boolean)); let n = 1; while (used.has(n)) n++; return String(n); };
    // sans numéro connu, la case reste vide (« n° à venir ») : la photo de la feuille la complétera
    const addPlayer = (t, p) => ed[t].push({
      n: !p.n ? '' : !ed[t].some(x => x.n === String(p.n)) ? String(p.n) : nextNum(t),
      name: p.name || '',
      sub: p.sub !== undefined ? p.sub : counts(t).tit >= 11
    });
    // Photo sur une compo déjà préparée : on reconnaît chaque joueur par son nom (même mal lu, ou « NOM Prénom »),
    // on complète son numéro et titulaire / remplaçant en gardant l'orthographe saisie ; les inconnus sont ajoutés
    const memeJoueur = (a, b) => {
      const mots = s => sansAccent(s).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
      const A = mots(a), B = mots(b);
      if (!A.length || !B.length) return false;
      const proche = (x, y) => x === y || (x.length >= 4 && y.length >= 4 && levenshtein(x, y) <= (Math.min(x.length, y.length) >= 7 ? 2 : 1));
      // chaque mot du nom le plus court doit correspondre à un mot de l'autre : mot proche (faute de lecture ou de frappe)
      // ou initiale (« Lucas G. », « LESEIGNEUR A. ») ; au moins un mot complet en commun.
      // « Thomas Besson » ≠ « Thomas Blandin » : Besson et Blandin ne sont ni proches ni des initiales.
      const [C, L] = A.length <= B.length ? [A, B] : [B, A];
      const pris = new Set();
      let complet = false;
      for (const x of C){
        let j = L.findIndex((y, k) => !pris.has(k) && x.length >= 2 && y.length >= 2 && proche(x, y));
        if (j >= 0) complet = true;
        else j = L.findIndex((y, k) => !pris.has(k) && (x.length === 1 || y.length === 1) && x[0] === y[0]);
        if (j < 0) return false;
        pris.add(j);
      }
      return complet;
    };
    // joueur déjà venu dont le nom ressemble (faute de frappe, « NOM Prénom », « Lucas G. »…) ; un seul candidat, sinon rien
    const connu = name => {
      if (!name || !pastPlayers) return null;
      const c = pastPlayers.filter(k => memeJoueur(k.name, name));
      return c.length === 1 ? c[0] : (c.find(k => playerKey(k.name) === playerKey(name)) || null);
    };
    // pour « Voulais-tu dire… ? » : seulement si le nom n'est pas déjà exactement celui d'un joueur connu
    const sosie = (name, i) => {
      if (!name || !pastPlayers || pastPlayers.some(k => playerKey(k.name) === playerKey(name))) return null;
      const k = connu(name);
      return k && !ed[cur].some((x, j) => j !== i && playerKey(x.name) === playerKey(k.name)) ? k : null;
    };
    function mergePhoto(t, lus){
      const deja = ed[t], vus = new Set();
      let num = 0, ajout = 0;
      const lien = lus.map(p => { const i = deja.findIndex((q, k) => !vus.has(k) && memeJoueur(q.name, p.name)); if (i >= 0) vus.add(i); return i; });
      // les numéros de la photo font foi : on libère ceux déjà pris par un autre joueur
      const pris = new Set(lus.map(p => String(p.n)));
      deja.forEach((q, k) => { if (!vus.has(k) && pris.has(String(q.n))) q.n = ''; });
      lus.forEach((p, j) => {
        const i = lien[j];
        if (i >= 0){ const q = deja[i]; if (q.n !== String(p.n)) num++; q.n = String(p.n); if (p.sub !== undefined) q.sub = p.sub; }
        else { addPlayer(t, p); ajout++; }
      });
      const absents = deja.filter((q, k) => k < deja.length - ajout && !vus.has(k)).map(q => q.name);
      deja.forEach(q => { q.absent = absents.includes(q.name); });
      return { num, ajout, absents };
    }
    const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

    function draw(focusLast){
      const c = counts(cur);
      const inList = new Set(ed[cur].map(p => playerKey(p.name)));
      const sugg = cur === clubSide(S) ? (pastPlayers || []).filter(p => !inList.has(playerKey(p.name))) : [];
      openSheet(`<h3 id="shTitle">Compositions</h3>
        <div class="seg luteams">${order.map(t => `<button type="button" data-t="${t}" class="${t===cur?'on':''}">${esc(teamName(S,t))} · ${ed[t].length}</button>`).join('')}</div>
        <div class="lubar"><span><b>${plural(c.tit, 'titulaire')}</b> · ${plural(c.rem, 'remplaçant')}</span>
          <span class="lutools"><button type="button" class="photo" id="luPhoto">📷 Photo</button><button type="button" class="photo" id="luPaste">${paste ? 'Fermer' : 'Coller'}</button></span></div>
        <input type="file" accept="image/*" id="luFile" hidden>
        <div class="ocrstat" id="luStat"></div>
        ${paste ? `<textarea id="luText" placeholder="10 DUPONT Lucas&#10;7 MARTIN Hugo&#10;14 BERNARD Léo R"></textarea>
          <button type="button" class="fbtn" id="luParse" style="width:100%;margin:6px 0 10px">Ajouter ces joueurs</button>` : ''}
        <div class="lurows">${ed[cur].map((p, i) => `<div class="lrow${p.sub ? ' sub' : ''}${errs.has(cur + i) ? ' err' : ''}${p.absent ? ' absent' : ''}" data-i="${i}"${p.absent ? ' title="Pas trouvé sur la photo"' : ''}>
            <input class="ln" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${esc(p.n)}" placeholder="n°" aria-label="Numéro">
            <input class="lname" value="${esc(p.name)}" placeholder="Nom Prénom" autocomplete="off" enterkeyhint="next" list="luNames" aria-label="Nom du joueur">
            <button type="button" class="ltog" aria-label="Titulaire ou remplaçant">${p.sub ? 'Remp.' : 'Titul.'}</button>
            <button type="button" class="ldel" aria-label="Retirer ce joueur">×</button></div>${(() => {
              const k = cur === clubSide(S) && sosie(p.name, i);
              return k ? `<button type="button" class="lsosie" data-i="${i}">Voulais-tu dire <b>${esc(k.name)}</b>${k.n ? ` (n°${esc(k.n)})` : ''} ?</button>` : '';
            })()}`).join('')
          || '<div class="empty">Aucun joueur. Ajoute-les un par un, ou utilise la photo de la feuille.</div>'}</div>
        <button type="button" class="fbtn" id="luAdd" style="width:100%">+ Ajouter un joueur</button>
        ${sugg.length ? `<div class="lusug-t">Joueurs déjà venus · touche pour ajouter</div>
          <div class="lusug">${sugg.slice(0, 30).map((p, j) => `<button type="button" data-j="${j}"><b>${esc(p.n)}</b> ${esc(p.name)}</button>`).join('')}</div>` : ''}
        <datalist id="luNames">${(cur === clubSide(S) ? pastPlayers || [] : []).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
        ${msg ? `<div class="msg err" style="margin-top:10px">${esc(msg)}</div>` : ''}
        <div class="foot" style="margin-top:12px"><button class="fbtn primary" id="luSave">Enregistrer</button><button class="fbtn" id="luCancel">Annuler</button></div>`);
      const body = $('shBody');
      body.querySelectorAll('.luteams button').forEach(b => b.onclick = () => { cur = b.dataset.t; paste = false; draw(); });
      body.querySelectorAll('.lrow').forEach(row => {
        const i = +row.dataset.i, p = ed[cur][i];
        const num = row.querySelector('.ln'), nm = row.querySelector('.lname');
        num.oninput = () => { num.value = num.value.replace(/\D/g, ''); p.n = num.value ? String(+num.value) : ''; };
        nm.oninput = () => {
          p.name = nm.value;
          // nom choisi dans la liste : reprend son numéro habituel si la case est vide ou libre
          const known = (pastPlayers || []).find(x => x.name === nm.value);
          if (known && !ed[cur].some((x, k) => k !== i && x.n === known.n)) { p.n = known.n; num.value = known.n; }
        };
        nm.onchange = () => { if (cur === clubSide(S) && sosie(p.name, i)) draw(); }; // nom proche d'un joueur connu : propose-le
        nm.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); addPlayer(cur, {}); draw(true); } };
        row.querySelector('.ltog').onclick = () => { p.sub = !p.sub; draw(); };
        row.querySelector('.ldel').onclick = () => { ed[cur].splice(i, 1); errs.clear(); draw(); };
      });
      body.querySelectorAll('.lsosie').forEach(b => b.onclick = () => {
        const i = +b.dataset.i, p = ed[cur][i], k = sosie(p.name, i);
        if (!k) return;
        p.name = k.name;
        if (k.n && !ed[cur].some((x, j) => j !== i && x.n === String(k.n))) p.n = String(k.n);
        draw();
      });
      $('luAdd').onclick = () => { addPlayer(cur, {}); draw(true); };
      body.querySelectorAll('.lusug button').forEach(b => b.onclick = () => { addPlayer(cur, sugg[+b.dataset.j]); draw(); });
      $('luPaste').onclick = () => { paste = !paste; draw(); if (paste) $('luText').focus(); };
      if (paste) $('luParse').onclick = () => { viaColle = true; parse($('luText').value).forEach(p => addPlayer(cur, p)); paste = false; draw(); };
      $('luPhoto').onclick = () => $('luFile').click();
      $('luFile').onchange = async ev => {
        const file = ev.target.files[0]; ev.target.value = '';
        if (file) viaPhoto = true;
        if (file) await readSheetPhoto(file, $('luStat'), teams => {
          // compo déjà préparée : fusion (numéros complétés) ; sinon on remplit avec ce qui est lu
          const remplir = (t, lus) => {
            // notre équipe : un nom lu qui ressemble à un joueur déjà venu prend son orthographe habituelle
            let rec = 0;
            if (t === clubSide(S)) lus = lus.map(p => { const k = connu(p.name); if (k && k.name !== p.name){ rec++; return { ...p, name: k.name }; } return p; });
            const recTxt = rec ? ` (${plural(rec, 'nom')} rattaché${rec > 1 ? 's' : ''} aux joueurs déjà venus)` : '';
            if (!ed[t].length){ lus.forEach(p => addPlayer(t, p)); return `${plural(lus.length, 'joueur')} lu${lus.length > 1 ? 's' : ''} pour ${teamName(S,t)}${recTxt}`; }
            const r = mergePhoto(t, lus);
            return `${teamName(S,t)} : ${plural(r.num, 'numéro')} complété${r.num > 1 ? 's' : ''}${recTxt}`
              + (r.ajout ? `, ${plural(r.ajout, 'joueur')} ajouté${r.ajout > 1 ? 's' : ''}` : '')
              + (r.absents.length ? `, ${plural(r.absents.length, 'joueur')} pas trouvé${r.absents.length > 1 ? 's' : ''} sur la photo (${r.absents.join(', ')})` : '');
          };
          // tablette FFF : équipe recevante à gauche, visiteuse à droite
          const txt = teams.length === 2 ? remplir('H', teams[0]) + ' · ' + remplir('A', teams[1]) : remplir(cur, teams[0]);
          draw(); $('luStat').textContent = txt + '. Vérifie les noms et les remplaçants.';
        });
      };
      $('luSave').onclick = save;
      $('luCancel').onclick = closeSheet;
      if (focusLast){ const l = body.querySelectorAll('.lname'); if (l.length) l[l.length - 1].focus(); }
    }

    function save(){
      errs = new Set(); msg = '';
      const out = {};
      for (const t of order){
        ed[t] = ed[t].filter(p => (p.name || '').trim() || p.n);
        const seen = {};
        ed[t].forEach((p, i) => {
          p.name = (p.name || '').trim();
          // le numéro peut rester vide (compo préparée avant le match), pas le nom
          if (!p.name){ errs.add(t + i); msg = msg || `${teamName(S,t)} : il manque un nom.`; }
          else if (!p.n) return;
          else if (seen[p.n] !== undefined){ errs.add(t + i); errs.add(t + seen[p.n]); msg = msg || `${teamName(S,t)} : le n°${p.n} est utilisé deux fois.`; }
          else seen[p.n] = i;
        });
        out[t] = [...ed[t].filter(p=>!p.sub), ...ed[t].filter(p=>p.sub)].map(p => ({n:p.n, name:p.name, sub:!!p.sub}));
      }
      if (errs.size){ cur = [...errs][0][0]; draw(); return; }
      const sansNum = order.reduce((s, t) => s + out[t].filter(p => !p.n).length, 0);
      const bancs = [];
      for (const t of order){ const r = onzeTitulaires(out[t]); out[t] = r.list; if (r.moved.length) bancs.push(...r.moved.map(n => 'n°' + n)); }
      patch({rosters: out, compo_source: [viaPhoto && 'photo de la feuille', viaColle && 'liste collée', 'saisie à la main'].filter(Boolean).join(' + ')}); closeSheet(); render();
      toast(bancs.length ? `Plus de 11 titulaires : ${bancs.join(', ')} mis remplaçant${bancs.length > 1 ? 's' : ''}`
        : sansNum ? `Compositions enregistrées · ${plural(sansNum, 'joueur')} sans numéro` : 'Compositions enregistrées');
    }

    draw();
    if (!pastPlayers) loadPastPlayers().then(() => { if (document.body.classList.contains('open') && $('luAdd')) draw(); });
  }
  $('btnLineup').onclick = openLineupEditor;

  // Récapitulatif (WhatsApp, feuille officielle)
  function recapText(){
    const ev = [...S.events].sort((a,b)=>a.sort-b.sort);
    const ICON = {goal:'⚽', sub:'🔄', yellow:'🟨', white:'⬜', red:'🟥'};
    const TITLE = {goal:'Buts', sub:'Remplacements', yellow:'Cartons jaunes', white:'Cartons blancs', red:'Cartons rouges'};
    const num = e => who(S, e.t, e.n, 'joueur non précisé');
    const sec = (k, fmt) => {
      const l = ev.filter(e=>e.k===k); if(!l.length) return '';
      return `\n*${ICON[k]} ${TITLE[k]}*\n` + l.map(e=>`${e.min} ${teamName(S,e.t)} – ${fmt(e)}`).join('\n') + '\n';
    };
    const d = new Date(S.kickoff).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
    return `🐦 *AS Mésanger – Feuille de match*\n${d}${S.competition ? ' · ' + S.competition : ''}\n\n*${teamName(S,'H')} ${goals(S.events,'H')} – ${goals(S.events,'A')} ${teamName(S,'A')}*\n`
      + sec('goal', num)
      + sec('sub', e=>`sort ${who(S,e.t,e.out_n,'?')}, entre ${who(S,e.t,e.in_n,'?')}`)
      + sec('yellow', num)
      + sec('white', num)
      + sec('red', num)
      + `\nEn direct : ${location.origin + location.pathname}#/match/${id}`;
  }
  $('btnRecap').onclick = () => {
    openSheet(`<h3 id="shTitle">Récapitulatif</h3><p>Envoie-le dans le groupe WhatsApp du club, ou copie-le pour la feuille officielle.</p>
      <textarea id="recap" readonly>${esc(recapText())}</textarea>
      <div class="foot" style="margin-top:10px"><button class="fbtn primary" id="share">Envoyer</button><button class="fbtn" id="copy">Copier</button><button class="fbtn" id="close">Fermer</button></div>`);
    $('share').onclick = async () => {
      const text = $('recap').value;
      if (navigator.share) { try { await navigator.share({text}); return; } catch(e){ if (e && e.name==='AbortError') return; } }
      $('copy').click();
    };
    $('close').onclick = closeSheet;
    $('copy').onclick = async () => {
      const ta = $('recap');
      try { await navigator.clipboard.writeText(ta.value); toast('Copié'); }
      catch(e){ ta.focus(); ta.select(); try{ document.execCommand('copy'); toast('Copié'); }catch(_){ toast('Sélectionne le texte pour le copier'); } }
    };
  };
  $('btnShareLive').onclick = () => shareLink(S);

  // Infos du match (la durée de mi-temps n'est volontairement pas modifiable)
  $('btnInfo').onclick = () => {
    const c = clubSide(S), opp = teamName(S, oppSide(S));
    const k = new Date(S.kickoff); const local = new Date(k.getTime() - k.getTimezoneOffset()*60000).toISOString().slice(0,16);
    openSheet(`<h3 id="shTitle">Infos du match</h3><p>Adversaire, date et compétition.</p>
      <label class="field"><span>Adversaire</span><input id="inOpp" value="${esc(opp)}"></label>
      <label class="field"><span>Date et heure</span><input id="inDate" type="datetime-local" value="${local}"></label>
      <label class="field"><span>Compétition</span><input id="inComp" value="${esc(S.competition||'')}"></label>
      <div class="foot" style="margin-top:4px"><button class="fbtn primary" id="inOk">Enregistrer</button><button class="fbtn" id="inNo">Annuler</button></div>`);
    $('inOk').onclick = () => {
      const o = $('inOpp').value.trim() || opp;
      const f = {competition: $('inComp').value.trim()};
      if ($('inDate').value) f.kickoff = new Date($('inDate').value).toISOString();
      if (c==='H') f.away_name = o; else f.home_name = o;
      patch(f); closeSheet(); route(); toast('Infos enregistrées');
    };
    $('inNo').onclick = closeSheet;
  };
  if ($('btnDelete')) $('btnDelete').onclick = () => askConfirm('Supprimer ce match ?', 'Le match, sa chronologie et ses compositions seront effacés pour tout le monde, et retirés des stats.', 'Supprimer définitivement', async () => {
    const { error } = await sb.from('matches').delete().eq('id', id);
    if (error){ toast(isNetErr(error) ? 'Pas de réseau : réessaie plus tard' : error.message); return; }
    outbox = outbox.filter(o => o.match !== id); saveOutbox();
    try{ localStorage.removeItem(CK); }catch(e){}
    toast('Match supprimé'); location.hash = '#/';
  });

  render(); renderSync();
  if (openCompo) $('btnLineup').click();

  // Synchro en direct : on voit ce que les autres saisissent sur ce match (autre téléphone, responsable d'équipe…).
  // Ce qui est encore dans la file d'envoi de ce téléphone garde la main jusqu'à son envoi.
  const etat = () => JSON.stringify([S.events.map(e => [e.id, e.min, e.n, e.out_n, e.in_n, e.p, e.t, e.k]).sort(), S.status, S.period, S.running, S.acc, S.started_at, S.rosters, S.delegue_id]);
  const syncRemote = debounce(async () => {
    if (!location.hash.startsWith('#/gerer/' + id)) return;
    let r; try{ r = await fetchMatch(id); }catch(e){ return; }
    if (!r.m || !location.hash.startsWith('#/gerer/' + id)) return;
    const ops = outbox.filter(o => o.match === id);
    const enAttente = new Set(ops.filter(o => o.kind === 'ev').map(o => o.row.id));
    const supprimes = new Set(ops.filter(o => o.kind === 'evdel').map(o => o.id));
    const serveur = new Set(r.evs.map(e => e.id));
    const avant = etat();
    if (!ops.some(o => o.kind === 'match')) Object.assign(S, r.m);
    S.events = [...r.evs.filter(e => !supprimes.has(e.id)), ...S.events.filter(e => enAttente.has(e.id) && !serveur.has(e.id))];
    S.rosters = S.rosters || {H:[],A:[]};
    if (etat() !== avant){ saveLocal(); render(); }
  }, 400);
  const offRt = liveChannel('gerer', syncRemote, [
    {event:'*', table:'matches', filter:`id=eq.${id}`},
    {event:'*', table:'events', filter:`match_id=eq.${id}`},
    {event:'DELETE', table:'events'}
  ]);
  const pollRt = fallbackPoll(offRt, syncRemote);
  const visRt = () => { if (document.visibilityState === 'visible') syncRemote(); };
  document.addEventListener('visibilitychange', visRt);
  // bandeau : quelqu'un d'autre a aussi la page « Gérer » de ce match ouverte
  const renderCo = () => {
    const bar = $('coBar'); if (!bar) return;
    const autres = Object.entries(presState).filter(([k]) => k !== presKey).map(([, a]) => a && a[0]).filter(p => p && p.gerer === id);
    const moi = autres.some(p => p.uid && p.uid === myId());
    const noms = [...new Set(autres.filter(p => !(p.uid && p.uid === myId())).map(p => p.nom || 'Quelqu’un'))];
    bar.hidden = !noms.length && !moi;
    const titre = noms.length ? `${noms.join(', ')} saisi${noms.length > 1 ? 'ssent' : 't'} aussi ce match` : 'Ce match est aussi ouvert sur ton autre appareil';
    if (!bar.hidden) bar.innerHTML = `<b>⚠️ ${esc(titre)}</b><small>Tout s’affiche ici en direct. Une seule personne doit noter les actions, sinon elles seront en double.</small>`;
  };
  presHooks.add(renderCo); renderCo();
  const prevCleanup = cleanup;
  cleanup = () => { [...notifsEnAttente.keys()].forEach(envoyerNotif); if (fermerAnnulation) fermerAnnulation(); offRt(); clearInterval(pollRt); document.removeEventListener('visibilitychange', visRt); presHooks.delete(renderCo); if (prevCleanup) prevCleanup(); };
}

// ---------- Lecture de la photo de la feuille de match (dans le téléphone, gratuit) ----------
function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('script')); document.head.appendChild(s); });
}
// Photo → image noir et blanc prête pour la lecture : tournée de rot degrés, mise à ~3000 px,
// seuil local (reflets, écran gris) puis effacement des traits du tableau qui gênent la lecture.
function prepImage(bmp, rot, size = 2400){
  const turn = rot === 90 || rot === 270;
  const scale = Math.min(2.5, size / Math.max(bmp.width, bmp.height));
  const w0 = Math.round(bmp.width * scale), h0 = Math.round(bmp.height * scale);
  const w = turn ? h0 : w0, h = turn ? w0 : h0;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2); ctx.rotate(rot * Math.PI / 180); ctx.drawImage(bmp, -w0 / 2, -h0 / 2, w0, h0);
  const img = ctx.getImageData(0, 0, w, h), d = img.data, g = new Uint8Array(w * h);
  for (let k = 0, p = 0; k < g.length; k++, p += 4) g[k] = d[p] * .299 + d[p + 1] * .587 + d[p + 2] * .114;
  let lo = 255, hi = 0; for (let k = 0; k < g.length; k++){ if (g[k] < lo) lo = g[k]; if (g[k] > hi) hi = g[k]; }
  const sp = Math.max(1, hi - lo); for (let k = 0; k < g.length; k++) g[k] = (g[k] - lo) * 255 / sp;
  const out = cleanGrid(g, w, h);
  for (let k = 0, p = 0; k < out.length; k++, p += 4){ d[p] = d[p + 1] = d[p + 2] = out[k]; d[p + 3] = 255; }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(img, 0, 0);
  return cv;
}
function cleanGrid(d, w, h){
  const W = w + 1, I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++){ let s = 0; for (let x = 0; x < w; x++){ s += d[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + s; } }
  const r = Math.max(8, Math.round(Math.min(w, h) / 40)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++){
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++){
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const m = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      out[y * w + x] = d[y * w + x] < m * .85 ? 0 : 255;
    }
  }
  const L = Math.round(Math.max(w, h) * .06), kill = new Uint8Array(w * h);
  for (let y = 0; y < h; y++){ let a = -1; for (let x = 0; x <= w; x++){ const k = x < w && out[y * w + x] === 0; if (k && a < 0) a = x; if (!k && a >= 0){ if (x - a >= L) for (let q = a; q < x; q++) kill[y * w + q] = 1; a = -1; } } }
  for (let x = 0; x < w; x++){ let a = -1; for (let y = 0; y <= h; y++){ const k = y < h && out[y * w + x] === 0; if (k && a < 0) a = y; if (!k && a >= 0){ if (y - a >= L * .6) for (let q = a; q < y; q++) kill[q * w + x] = 1; a = -1; } } }
  for (let k = 0; k < w * h; k++) if (kill[k]){ out[k] = 255; if (k % w) out[k - 1] = 255; if ((k + 1) % w) out[k + 1] = 255; if (k >= w) out[k - w] = 255; if (k + w < w * h) out[k + w] = 255; }
  return out;
}
function parseSheet(text){
  const out = [], seen = new Set();
  const re = /(?:^|[\s|[(])(\d{1,2})(?!\d)[\s.)\-–:|]+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’\- ]{1,40}[A-Za-zÀ-ÖØ-öø-ÿ])/g;
  for (const line of text.split('\n')){
    re.lastIndex = 0; let m;
    while ((m = re.exec(line))){
      const n = String(+m[1]);
      const name = m[2].replace(/\b(licen[cs]e|n°|date|capitaine|cap)\b.*$/i, '').replace(/\s+/g, ' ').trim();
      if (n==='0' || name.length < 3 || seen.has(n)) continue;
      seen.add(n); out.push({n, name});
    }
  }
  return out;
}
// Mots lus (avec leur position) → joueurs. Reconnaît la tablette FFF « Compositions » :
// équipe recevante à gauche, visiteuse à droite, « R » = remplaçant, « C » = capitaine.
function parseWords(words, width){
  words = (words || []).map(w => ({ t: w.text.trim(), x: w.bbox.x0, x1: w.bbox.x1, y: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0 })).filter(w => w.t);
  if (!words.length) return [];
  const hMed = words.map(w => w.h).sort((a, b) => a - b)[words.length >> 1] || 10;
  words.sort((a, b) => a.y - b.y);
  const rows = [];
  for (const w of words){
    const r = rows.find(r => Math.abs(r.y - w.y) < hMed * .6);
    if (r){ r.w.push(w); r.y = (r.y * (r.w.length - 1) + w.y) / r.w.length; } else rows.push({ y: w.y, w: [w] });
  }
  const isNum = t => /^\d{1,2}$/.test(t.replace(/[.)\]|:]/g, ''));
  const isName = t => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’\-]+$/.test(t);
  const HEAD = /^(maillot|nom|prénom|prenom|nom\/prénom|equipe|équipe|recevante|visiteuse|arbitre|central|compositions?|feuille|presse|licence|n°)$/i;
  const players = [];
  for (const r of rows.sort((a, b) => a.y - b.y)){
    r.w.sort((a, b) => a.x - b.x);
    let p = null, lastX = 0;
    for (const w of r.w){
      if (isNum(w.t)){ if (p) players.push(p); p = { n: String(+w.t.replace(/\D/g, '')), x: w.x, y: r.y, name: [], flags: '' }; lastX = w.x1; continue; }
      if (!p) continue;
      if (w.x - lastX > hMed * 6 && p.name.length) p.done = true; // grand blanc : fin du nom (le R / C peut suivre)
      lastX = w.x1;
      if (/^(R|C|CR|RC|E\/?DR|M)$/.test(w.t)){ p.flags += w.t; continue; }
      if (isName(w.t) && !HEAD.test(w.t) && !p.done) p.name.push(w.t);
    }
    if (p) players.push(p);
  }
  const ok = players.filter(p => p.n !== '0' && p.name.join(' ').length >= 3 && p.name.length <= 5);
  if (!ok.length) return [];
  // deux équipes côte à côte : deux groupes de numéros nettement séparés (gauche = recevante)
  const xs = ok.map(p => p.x).sort((a, b) => a - b);
  let best = null;
  for (let k = 3; k <= xs.length - 3; k++){
    const L = xs.slice(0, k), R = xs.slice(k), mL = L.reduce((a, b) => a + b) / L.length, mR = R.reduce((a, b) => a + b) / R.length;
    const v = L.reduce((a, x) => a + (x - mL) ** 2, 0) + R.reduce((a, x) => a + (x - mR) ** 2, 0);
    if (!best || v < best.v) best = { v, cut: (xs[k - 1] + xs[k]) / 2, d: mR - mL };
  }
  const two = best && best.d > width * .25;
  const teams = two ? [ok.filter(p => p.x < best.cut), ok.filter(p => p.x > best.cut)] : [ok];
  return teams.map(list => {
    const seen = new Set(), out = [];
    list.sort((a, b) => a.y - b.y).forEach(p => { if (!seen.has(p.n)){ seen.add(p.n); out.push(p); } });
    return out.map(p => ({ n: p.n, name: fmtNom(p.name.join(' ')), r: /R/.test(p.flags.replace(/DR/g, '')) }));
  });
}
// Fusionne plusieurs lectures de la même photo : pour chaque numéro, le nom lu le plus souvent / le plus propre
function mergeReads(reads){
  const nT = Math.max(...reads.map(r => r.length));
  reads = reads.filter(r => r.length === nT);
  return Array.from({ length: nT }, (_, t) => {
    const by = new Map();
    reads.forEach(r => r[t].forEach(p => { if (!by.has(p.n)) by.set(p.n, []); by.get(p.n).push(p); }));
    const out = [...by.entries()].sort((a, b) => +a[0] - +b[0]).map(([n, c]) => {
      const score = name => c.filter(p => p.name === name).length * 2 + (name.split(' ').length >= 2 ? 3 : 0) - (name.split(' ').some(w => w.length > 12) ? 2 : 0);
      const name = c.map(p => p.name).sort((a, b) => score(b) - score(a))[0];
      return { n, name, r: c.some(p => p.r), seen: c.length };
    }).filter(p => p.seen > 1 || reads.length === 1 || p.name.split(' ').length >= 2);
    const hasR = out.some(p => p.r);
    return out.map((p, k) => ({ n: p.n, name: p.name, sub: hasR ? p.r : k >= 11 }));
  });
}
let ocrWorker = null;
// Lit la photo ; onFound reçoit une liste par équipe : [recevante, visiteuse] ou [une seule équipe]
async function readSheetPhoto(file, stat, onFound){
  if (!navigator.onLine && !window.Tesseract){ stat.textContent = 'La lecture de photo a besoin du réseau la première fois.'; return; }
  try{
    stat.textContent = 'Préparation de la photo…';
    const [bmp] = await Promise.all([createImageBitmap(file), window.Tesseract ? null : loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js')]);
    if (!ocrWorker) ocrWorker = await window.Tesseract.createWorker('fra', 1, {
      logger: m => { if (m.status === 'recognizing text' && ocrWorker && ocrWorker.stat) ocrWorker.stat(m.progress); }
    });
    // photo prise de travers (tablette en paysage, téléphone en portrait) : on essaie les autres sens
    const read = async (rot, size, psm, label) => {
      ocrWorker.stat = p => { stat.textContent = label + Math.round(p * 100) + ' %'; };
      stat.textContent = label;
      await ocrWorker.setParameters({ tessedit_pageseg_mode: psm });
      const cv = prepImage(bmp, rot, size);
      const { data } = await ocrWorker.recognize(cv);
      let teams = parseWords(data.words, cv.width);
      const flat = parseSheet(data.text || '');
      if (flat.length > teams.reduce((x, t) => x + t.length, 0)) teams = [flat.map(p => ({ n: p.n, name: fmtNom(p.name), r: false }))];
      return teams;
    };
    const count = t => t.reduce((x, l) => x + l.length, 0);
    const good = t => t.flat().filter(p => p.name.split(' ').length >= 2).length; // noms en 2 mots = lecture dans le bon sens
    let rot = null, first = [];
    for (const r of [0, 90, 270]){
      const t = await read(r, 2400, '6', r ? 'Photo de travers, nouvel essai… ' : 'Lecture en cours… ');
      if (good(t) > good(first)){ first = t; rot = r; }
      if (good(first) >= 6) break;
    }
    let best = first.length ? mergeReads([first]) : [];
    if (good(first) >= 6){
      const second = await read(rot, 2400, '3', 'Vérification… ');
      best = mergeReads([first, second]);
    }
    const bestN = count(best);
    ocrWorker.stat = null;
    if (!bestN){ stat.textContent = 'Aucun joueur reconnu. Reprends la photo bien en face, en cadrant le tableau des compositions.'; return; }
    onFound(best);
  }catch(e){
    console.error(e);
    stat.textContent = 'La lecture a échoué. Tu peux taper les joueurs à la main.';
  }
}

// ---------- Classements (recopiés depuis la FFF) ----------
// Ligne : [rang, équipe, pts, joués, gagnés, nuls, perdus, buts pour, buts contre, diff, code club FFF]
const CLUB_FFF = '516995';
const clsF = { cat: '', team: 0 };
async function classementsView(){
  let rows = lsGet('asm-cls', null), maj = null, nous = lsGet('asm-cls-nous', []);
  const tok = route.cur, cachedFirst = !!rows;
  const fetchCls = async () => {
    const { data, error } = await sb.from('classements').select('*').order('equipe');
    if (error) throw error;
    rows = data; lsSet('asm-cls', data);
    // nos matchs de championnat terminés dans l'appli (15 derniers jours), pour les compter avant la FFF
    try{
      const depuis = new Date(Date.now() - 15 * 864e5).toISOString();
      const { data: ms } = await sb.from('matches').select('id,kickoff,competition,equipe,club_side,home_name,away_name,opp_logo')
        .eq('status', 'termine').gte('kickoff', depuis).like('competition', '% · J%');
      const ids = (ms || []).map(m => m.id);
      const { data: g } = ids.length ? await sb.from('events').select('match_id,t').eq('k', 'goal').in('match_id', ids) : { data: [] };
      nous = (ms || []).map(m => ({ ...m, bH: (g || []).filter(x => x.match_id === m.id && x.t === 'H').length, bA: (g || []).filter(x => x.match_id === m.id && x.t === 'A').length }));
      lsSet('asm-cls-nous', nous);
    }catch(e){}
    if (isAdmin()){ const r2 = await sb.from('classements_maj').select('*').maybeSingle(); maj = r2.data; }
  };
  // Classement provisoire : nos matchs terminés dans l'appli mais pas encore saisis sur la FFF sont ajoutés
  // (pour nous et pour l'adversaire), puis le classement est retrié.
  const jourISO = d => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const numEq = s => (String(s || '').trim().match(/\s(\d+)$/) || [])[1] || null;
  const provisoire = r => {
    const ajouts = [];
    const lignes = r.lignes.map(l => [...l]);
    const resultats = Array.isArray(r.resultats) ? [...r.resultats] : [];
    nous.filter(m => m.equipe === r.equipe).forEach(m => {
      const j = jourISO(m.kickoff);
      if (resultats.some(x => (x[2] === CLUB_FFF || x[6] === CLUB_FFF) && String(x[1]).slice(0, 10) === j)) return;   // déjà sur la FFF
      const code = ((m.opp_logo || '').match(/BC(\d+)\./) || [])[1];
      const advNom = m.club_side === 'H' ? m.away_name : m.home_name;
      const memeClub = lignes.filter(l => l[10] === code);
      const adv = memeClub.find(l => numEq(l[1]) === numEq(advNom)) || (memeClub.length === 1 ? memeClub[0] : null);
      const moi = lignes.find(l => l[10] === CLUB_FFF);
      if (!adv || !moi) return;
      const pour = m.club_side === 'H' ? m.bH : m.bA, contre = m.club_side === 'H' ? m.bA : m.bH;
      [[moi, pour, contre], [adv, contre, pour]].forEach(([l, p, c]) => {
        l[3]++; l[7] += p; l[8] += c; l[9] = l[7] - l[8];
        if (p > c){ l[2] += 3; l[4]++; } else if (p === c){ l[2] += 1; l[5]++; } else l[6]++;
      });
      const domMoi = m.club_side === 'H';
      const heure = new Date(m.kickoff).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
      resultats.push(['app-' + m.id, j + 'T' + heure, domMoi ? CLUB_FFF : adv[10], domMoi ? moi[1] : adv[1], m.bH, m.bA, domMoi ? adv[10] : CLUB_FFF, domMoi ? adv[1] : moi[1]]);
      ajouts.push(m);
    });
    if (!ajouts.length) return r;
    lignes.sort((a, b) => b[2] - a[2] || b[9] - a[9] || b[7] - a[7] || String(a[1]).localeCompare(String(b[1])));
    lignes.forEach((l, i) => { l[0] = i + 1; });
    return { ...r, lignes, resultats, provisoire: ajouts };
  };
  // avec une copie sur le téléphone : affichage immédiat, mise à jour quand le réseau répond
  if (!rows){ view.innerHTML = '<div class="loading">Chargement…</div>'; await fetchCls(); }
  const byTeam = {};
  const index = () => { Object.keys(byTeam).forEach(k => delete byTeam[k]); (rows || []).forEach(r => { byTeam[r.equipe] = provisoire(r); }); };
  index();
  let openClub = null;
  const rankOf = n => { const r = byTeam[n]; const l = r && r.lignes.find(x => x[10] === CLUB_FFF); return l ? l[0] : null; };
  const draw = () => {
    if (!clsF.team){ clsF.team = homeF.team || catTeams(homeF.cat || CATS[0])[0] || TEAMS[0]; clsF.cat = catOf(clsF.team); }
    const cur = clsF.team, r = byTeam[cur];
    const chips = teamFilterHTML(clsF, false, n => { const k = rankOf(n); return k ? ` · ${k}${k===1?'er':'e'}` : ''; });
    if (!r){ view.innerHTML = chips + `<div class="empty">${teamOf(cur).fff_classement === null ? 'Pas de championnat suivi pour les ' + esc(teamLabel(cur)) + '.' : 'Classement pas encore disponible pour les ' + esc(teamLabel(cur)) + '.'}</div>` + majHTML(); bind(); return; }
    const d = new Date(r.updated_at).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
    const hasRes = Array.isArray(r.resultats) && r.resultats.length > 0;
    view.innerHTML = chips + `
      <div class="clshead"><h2>${esc(teamLabel(cur))}</h2><span>${esc(r.competition)}</span></div>
      <div class="tblwrap"><table class="cls">
        <thead><tr><th>#</th><th>Équipe</th><th>Pts</th><th>J</th><th>G</th><th>N</th><th>P</th><th>Diff</th></tr></thead>
        <tbody>${r.lignes.map(l => `<tr class="${l[10]===CLUB_FFF ? 'me' : ''}${hasRes ? ' tap' : ''}${hasRes && l[10]===openClub ? ' open' : ''}"${hasRes ? ` data-club="${esc(l[10])}" tabindex="0" aria-expanded="${l[10]===openClub}"` : ''}>
          <td class="rk">${l[0]}</td>
          <td class="tm"><div class="tmi">${l[10] ? `<img src="https://cdn-transverse.azureedge.net/phlogos/BC${esc(l[10])}.jpg" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${esc(l[1])}</span></div></td>
          <td class="pts">${l[2]}</td><td>${l[3]}</td><td>${l[4]}</td><td>${l[5]}</td><td>${l[6]}</td><td>${l[9] > 0 ? '+' + l[9] : l[9]}</td></tr>${hasRes && l[10]===openClub ? `<tr class="clsdet"><td colspan="8">${histHTML(r, l)}</td></tr>` : ''}`).join('')}</tbody>
      </table></div>
      ${hasRes ? '<p class="note">Touche une équipe pour voir ses résultats.</p>' : ''}
      ${r.provisoire ? `<p class="note provis">Provisoire : comprend ${r.provisoire.length > 1 ? 'nos matchs' : 'notre match'} du ${esc(r.provisoire.map(m => new Date(m.kickoff).toLocaleDateString('fr-FR', {weekday:'short', day:'numeric', month:'short'}) + ' (' + m.bH + '–' + m.bA + ')').join(', '))}, pas encore saisi${r.provisoire.length > 1 ? 's' : ''} sur le site de la FFF.</p>` : ''}
      <p class="note">Mis à jour le ${esc(d)}, d’après le site de la FFF (classement sous réserve de procédures en cours). ${r.source ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">Voir le classement officiel ↗</a>` : ''}</p>` + majHTML();
    bind();
  };
  // Résultats d'une équipe de la poule : r.resultats = [[idFFF, 'AAAA-MM-JJTHH:MM', codeDom, nomDom, butsDom, butsExt, codeExt, nomExt], ...]
  const histHTML = (r, l) => {
    const club = l[10];
    const list = r.resultats.filter(x => (x[2] === club || x[6] === club) && x[4] != null && x[5] != null)
      .sort((a, b) => b[1].localeCompare(a[1]));
    if (!list.length) return '<div class="hist"><p class="hnone">Pas encore de résultat enregistré.</p></div>';
    const rows = list.map(x => {
      const dom = x[2] === club, pour = dom ? x[4] : x[5], contre = dom ? x[5] : x[4];
      const res = pour > contre ? 'V' : pour < contre ? 'D' : 'N';
      const adv = dom ? x[7] : x[3], advCode = dom ? x[6] : x[2];
      const dt = new Date(x[1]).toLocaleDateString('fr-FR', {day:'numeric', month:'short'});
      return { res, html: `<li><span class="hres ${res}">${res}</span><span class="hdt">${esc(dt)}</span>
        <span class="hadv">${advCode ? `<img src="https://cdn-transverse.azureedge.net/phlogos/BC${esc(advCode)}.jpg" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${dom ? 'contre' : 'à'} ${advCode === CLUB_FFF ? `<b>${esc(adv)}</b>` : esc(adv)}</span></span>
        <b class="hsc">${pour}–${contre}</b></li>` };
    });
    const n = k => rows.filter(x => x.res === k).length;
    return `<div class="hist"><div class="hsum"><span>Forme</span>${rows.slice(0, 5).map(x => `<i class="hres ${x.res}">${x.res}</i>`).join('')}
      <small>${n('V')} V · ${n('N')} N · ${n('D')} D</small></div><ul>${rows.map(x => x.html).join('')}</ul></div>`;
  };
  // Bouton admin : la mise à jour est faite par la tâche programmée du PC du club (la FFF bloque les accès automatiques)
  const majHTML = () => {
    if (!isAdmin()) return '';
    const enAttente = maj && maj.demande_at && (!maj.fait_at || new Date(maj.demande_at) > new Date(maj.fait_at));
    return `<div class="majbox">${enAttente
      ? `<b>Mise à jour demandée</b> par ${esc(maj.demande_par || '?')} à ${esc(hhmm(maj.demande_at))}. Elle sera faite dès que le propriétaire du site acceptera la demande.`
      : 'Les classements se mettent à jour automatiquement le lundi à 8 h, 12 h et 20 h.'}
      <button class="fbtn" id="majBtn" style="width:100%;margin-top:10px"${enAttente ? ' disabled' : ''}>${enAttente ? 'Mise à jour en attente…' : '↻ Mettre à jour les classements'}</button></div>`;
  };
  const bind = () => {
    bindTeamFilter(view, clsF, false, draw);
    view.querySelectorAll('tr.tap').forEach(tr => {
      const go = () => { openClub = openClub === tr.dataset.club ? null : tr.dataset.club; draw(); };
      tr.onclick = go;
      tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); } };
    });
    const mb = $('majBtn');
    if (mb) mb.onclick = async () => {
      mb.disabled = true;
      const { error } = await sb.rpc('demander_maj_classements');
      if (error){ mb.disabled = false; toast(isNetErr(error) ? 'Pas de réseau' : 'Demande refusée'); return; }
      // prévient le propriétaire du site par notification
      fetch('api/notify-maj', { method: 'POST', keepalive: true, headers: { Authorization: 'Bearer ' + session.access_token } }).catch(() => {});
      const r2 = await sb.from('classements_maj').select('*').maybeSingle(); maj = r2.data;
      toast('Demande envoyée'); draw();
    };
  };
  draw();
  if (cachedFirst) fetchCls().then(() => { if (route.cur === tok && location.hash.startsWith('#/classements')){ index(); draw(); } }).catch(() => {});
}

// ---------- Stats joueurs ----------
let statSort = {key:'goals', dir:-1}, statSeason = null, statComp = '', statMode = 'joueurs', statQ = '';
const statOuverts = new Set(); // buteurs par équipe : équipes dépliées (« Voir plus »)
const statF = { cat: '', team: 0 };
const isCup = m => /coupe|challenge|troph/i.test(m.competition || '');
function playerKey(name){
  return name.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z ]/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
}
async function statsView(playerArg){
  const load = chargerStats;
  // affichage immédiat avec la dernière copie, puis mise à jour quand le réseau répond
  const cached = lsGet('asm-stats', null);
  if (!cached) view.innerHTML = '<div class="loading">Chargement…</div>';
  const fresh = load();
  // (pas pendant une recherche, pour ne pas fermer le clavier)
  if (cached) fresh.then(() => { if (location.hash.startsWith('#/stats') && route.cur === statsView.tok && document.activeElement?.id !== 'statQ') statsView.redo(); }).catch(() => {});
  const { ms, evs } = cached || await fresh;
  if (!location.hash.startsWith('#/stats')) return;
  statsView.tok = route.cur;
  statsView.redo = () => { statsViewFrom(playerArg, lsGet('asm-stats', null)); };
  return statsViewFrom(playerArg, { ms, evs });
}
async function statsViewFrom(playerArg, { ms, evs }){
  const seasons = [...new Set(ms.map(m=>seasonOf(m.kickoff)))].sort().reverse();
  if (!statSeason || !seasons.includes(statSeason)) statSeason = seasons[0] || null;
  const draw = () => {
    const list = ms.filter(m => seasonOf(m.kickoff)===statSeason && inFilter(statF, m.equipe)
      && (!statComp || (statComp === 'coupe') === isCup(m)));
    const ids = new Set(list.map(m=>m.id));
    const byMatch = {}; evs.forEach(e => { if (ids.has(e.match_id)) (byMatch[e.match_id] ||= []).push(e); });
    const P = {}; let unknownGoals = 0, cscGoals = 0;
    const get = name => { const k = playerKey(name); return P[k] ||= {k, name, mj:0, tit:0, goals:0, y:0, w:0, r:0, eqs:{}}; };
    let W=0, D=0, L=0, gf=0, ga=0;
    for (const m of list){
      const c = m.club_side, me = byMatch[m.id] || [];
      const g1 = me.filter(e=>e.k==='goal'&&e.t===c).length, g2 = me.filter(e=>e.k==='goal'&&e.t!==c).length;
      gf += g1; ga += g2; if (g1>g2) W++; else if (g1<g2) L++; else D++;
      const roster = ((m.rosters||{})[c]) || [];
      const nm = n => { const p = roster.find(p=>p.n===String(n)); return p ? p.name : null; };
      const played = new Set();
      roster.filter(p=>!p.sub).forEach(p => { const s = get(p.name); s.tit++; played.add(playerKey(p.name)); });
      me.filter(e=>e.t===c && e.k==='sub' && e.in_n).forEach(e => { const x = nm(e.in_n); if (x){ get(x); played.add(playerKey(x)); } });
      played.forEach(k => { if (P[k]){ P[k].mj++; P[k].eqs[m.equipe || 1] = (P[k].eqs[m.equipe || 1] || 0) + 1; } });
      me.filter(e=>e.t===c && e.k!=='sub').forEach(e => {
        if (e.k==='goal' && e.n==='CSC'){ cscGoals++; return; }
        const x = e.n ? nm(e.n) : null;
        if (!x){ if (e.k==='goal') unknownGoals++; return; }
        const s = get(x); if (e.k==='goal') s.goals++; if (e.k==='yellow') s.y++; if (e.k==='white') s.w++; if (e.k==='red') s.r++;
      });
    }
    const rows = Object.values(P).sort((a,b) => {
      const k = statSort.key;
      if (k==='name') return statSort.dir * a.name.localeCompare(b.name, 'fr');
      return statSort.dir * (a[k]-b[k]) || b.goals-a.goals || b.mj-a.mj || a.name.localeCompare(b.name,'fr');
    });
    const COLS = [['name','Joueur'],['goals','Buts'],['mj','Matchs'],['tit','Titul.'],['y','🟨'],['w','⬜'],['r','🟥']];
    const cell = (v) => `<td class="${v?'':'zero'}">${v}</td>`;
    // classement des buteurs, équipe par équipe (un joueur compte pour chaque équipe où il a marqué)
    const boards = {};
    for (const m of list){
      const c = m.club_side, eq = m.equipe || 1, roster = ((m.rosters||{})[c]) || [], me = byMatch[m.id] || [];
      const B = boards[eq] ||= { players: {}, csc: 0, n: 0 }; B.n++;
      const played = new Set(roster.filter(p => !p.sub).map(p => p.n));
      me.forEach(e => { if (e.t===c && e.k==='sub' && e.in_n) played.add(e.in_n); });
      roster.forEach(p => { if (!played.has(p.n)) return; const k = playerKey(p.name); (B.players[k] ||= { k, name: p.name, goals: 0, mj: 0 }).mj++; });
      me.forEach(e => {
        if (e.t!==c || e.k!=='goal') return;
        if (e.n==='CSC'){ B.csc++; return; }
        const p = roster.find(x => x.n===String(e.n)); if (!p) return;
        const k = playerKey(p.name); (B.players[k] ||= { k, name: p.name, goals: 0, mj: 0 }).goals++;
      });
    }
    const boardHTML = eq => {
      const B = boards[eq]; if (!B) return '';
      const sc = Object.values(B.players).filter(p => p.goals).sort((a, b) => b.goals - a.goals || a.mj - b.mj || a.name.localeCompare(b.name, 'fr'));
      let rank = 0, prev = null;
      // les 3 premiers, le reste derrière « Voir plus »
      return `<section class="sboard${statOuverts.has(eq) ? ' open' : ''}" data-eq="${eq}"><div class="bhead"><span class="tchip">${teamLetter(eq)}</span><b>${esc(teamLabel(eq))}</b><span>${B.n} match${B.n>1?'s':''}</span></div>
        ${sc.length ? `<ol class="blist">${sc.map((p, i) => { if (p.goals !== prev){ rank = i + 1; prev = p.goals; }
          return `<li class="prow${i >= 3 ? ' bmore' : ''}" data-pk="${esc(p.k)}" data-nm="${esc(p.name)}" tabindex="0"><span class="brk${rank<=3?' top'+rank:''}">${rank}</span><span class="bname">${esc(p.name)}<small>${p.mj} match${p.mj>1?'s':''} · ${(p.goals/Math.max(1,p.mj)).toLocaleString('fr-FR',{maximumFractionDigits:2})} / match</small></span><b>${p.goals}</b></li>`; }).join('')}</ol>${sc.length > 3 ? `<button type="button" class="bvoir" data-voir="${eq}">${statOuverts.has(eq) ? 'Voir moins' : `Voir plus (${sc.length - 3})`}</button>` : ''}` : '<div class="empty">Aucun buteur.</div>'}
        ${B.csc ? `<p class="bcsc">+ ${B.csc} but${B.csc>1?'s':''} contre son camp adverse</p>` : ''}</section>`;
    };
    const modeBar = `<div class="seg statmode" role="group" aria-label="Affichage">${[['joueurs', 'Tous les joueurs'], ['buteurs', 'Buteurs par équipe']].map(([v, l]) => `<button type="button" data-mode="${v}" class="${statMode===v?'on':''}" aria-pressed="${statMode===v}">${l}</button>`).join('')}</div>`;
    view.innerHTML = modeBar + `
      <div class="seasons">${seasons.length > 1 ? `<label>Saison <select id="season">${seasons.map(s=>`<option${s===statSeason?' selected':''}>${s}</option>`).join('')}</select></label> ` : (statSeason ? `<b>Saison ${statSeason}</b> ` : '')}<label>Équipe <select id="steam"><option value="">Tout le club</option>${CATS.map(c => `<optgroup label="${esc(c)}">${catTeams(c).length > 1 ? `<option value="c:${esc(c)}"${!statF.team && statF.cat===c?' selected':''}>Toutes les équipes ${esc(c)}</option>` : ''}${catTeams(c).map(n=>`<option value="${n}"${statF.team===n?' selected':''}>${esc(teamLabel(n))}</option>`).join('')}</optgroup>`).join('')}</select></label></div>
      <div class="chipbar compbar" role="group" aria-label="Compétition">${[['', 'Tout'], ['championnat', 'Championnat'], ['coupe', 'Coupes']].map(([v, l]) => `<button data-comp="${v}" class="${statComp===v?'on':''}" aria-pressed="${statComp===v}">${l}</button>`).join('')}</div>
      <div class="kpis">
        <div class="kpi"><b>${list.length}</b><span>Matchs</span></div>
        <div class="kpi"><b>${W}-${D}-${L}</b><span>V-N-D</span></div>
        <div class="kpi"><b>${gf}</b><span>Buts marqués</span></div>
        <div class="kpi"><b>${ga}</b><span>Encaissés</span></div>
      </div>
      <input id="statQ" class="dpq statq" type="search" placeholder="🔍 Rechercher un joueur…" autocomplete="off" enterkeyhint="search" value="${esc(statQ)}" aria-label="Rechercher un joueur">
      <div class="empty" id="statNone" hidden>Aucun joueur ne correspond à cette recherche.</div>
      ${statMode === 'buteurs' ? (CATS.map(c => { const h = catTeams(c).map(boardHTML).join(''); return h ? `<div class="sec">${esc(c)}</div>` + h : ''; }).join('') || '<div class="empty">Aucun match avec ce filtre.</div>') : rows.length ? `<div class="tblwrap"><table class="stats"><thead><tr>${COLS.map(([k,l])=>`<th class="${statSort.key===k?'on':''}" aria-sort="${statSort.key===k?(statSort.dir<0?'descending':'ascending'):'none'}"><button data-k="${k}">${l}${statSort.key===k?(statSort.dir<0?' ▾':' ▴'):''}</button></th>`).join('')}</tr></thead>
        <tbody>${rows.map(p=>`<tr class="prow${p.k === monJoueur() ? ' moi' : ''}" data-pk="${esc(p.k)}" data-nm="${esc(p.name)}" tabindex="0"><td>${esc(p.name)}</td>${cell(p.goals)}${cell(p.mj)}${cell(p.tit)}${cell(p.y)}${cell(p.w)}${cell(p.r)}</tr>`).join('')}${cscGoals ? `<tr class="csc"><td>CSC <small>(contre son camp adverse)</small></td>${cell(cscGoals)}<td></td><td></td><td></td><td></td><td></td></tr>` : ''}</tbody></table></div>`
        : `<div class="empty">Les stats apparaîtront après le premier match dont la composition de l'${CLUB} a été saisie.</div>`}
      <p class="note">${statComp === 'coupe' ? 'Matchs de coupe uniquement. ' : statComp ? 'Matchs de championnat uniquement. ' : ''}Stats des joueurs de l'${CLUB}, calculées à partir des compositions et de la chronologie de chaque match.${unknownGoals ? ` ${unknownGoals} but${unknownGoals>1?'s':''} sans buteur identifié.` : ''}</p>`;
    view.querySelectorAll('th button').forEach(b => b.onclick = () => {
      const k = b.dataset.k; statSort = statSort.key===k ? {key:k, dir:-statSort.dir} : {key:k, dir: k==='name' ? 1 : -1}; draw();
    });
    const s = $('season'); if (s) s.onchange = () => { statSeason = s.value; draw(); };
    $('steam').onchange = e => { const v = e.target.value; statF.team = /^\d+$/.test(v) ? +v : 0; statF.cat = v.startsWith('c:') ? v.slice(2) : statF.team ? catOf(statF.team) : ''; draw(); };
    view.querySelectorAll('[data-comp]').forEach(b => b.onclick = () => { statComp = b.dataset.comp; draw(); });
    view.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { statMode = b.dataset.mode; draw(); });
    view.querySelectorAll('[data-voir]').forEach(b => b.onclick = () => {
      const eq = +b.dataset.voir, sec = b.closest('.sboard'), n = sec.querySelectorAll('.bmore').length;
      statOuverts.has(eq) ? statOuverts.delete(eq) : statOuverts.add(eq);
      sec.classList.toggle('open', statOuverts.has(eq)); b.textContent = statOuverts.has(eq) ? 'Voir moins' : `Voir plus (${n})`;
    });
    // recherche : on masque les lignes sans redessiner (le clavier reste ouvert)
    const sq = $('statQ');
    const filtre = () => {
      statQ = sq.value;
      const words = sansAccent(statQ).split(/\s+/).filter(Boolean);
      let vus = 0;
      view.querySelectorAll('.prow').forEach(r => { const ok = words.every(w => sansAccent(r.dataset.nm).includes(w)); r.hidden = !ok; if (ok) vus++; });
      view.querySelectorAll('tr.csc').forEach(r => r.hidden = words.length > 0);
      view.querySelectorAll('.sboard').forEach(b => b.hidden = words.length > 0 && !b.querySelector('.prow:not([hidden])'));
      view.classList.toggle('scherche', words.length > 0); // pendant une recherche, tous les joueurs trouvés sont visibles
      $('statNone').hidden = !(words.length && !vus);
    };
    if (sq){ sq.oninput = filtre; if (statQ) filtre(); }
    view.querySelectorAll('.prow').forEach(r => { const go = () => { location.hash = '#/stats/joueur/' + encodeURIComponent(r.dataset.pk); }; r.onclick = go; r.onkeydown = e => { if (e.key === 'Enter') go(); }; });
  };
  const byMatchAll = {}; evs.forEach(e => { (byMatchAll[e.match_id] ||= []).push(e); });
  if (playerArg) drawPlayer(playerArg); else draw();

  // ---------- Fiche d'un joueur ----------
  function drawPlayer(key){
    const minOf = e => Math.max(0, Math.floor(+e.sort || 0));
    const hist = [];
    for (const m of ms.filter(m => seasonOf(m.kickoff)===statSeason && (!statComp || (statComp === 'coupe') === isCup(m)))){
      const c = m.club_side, p = ((m.rosters||{})[c] || []).find(x => playerKey(x.name) === key);
      if (!p) continue;
      const all = byMatchAll[m.id] || [], me = all.filter(e => e.t === c);
      const red = me.find(e => e.k==='red' && e.n===p.n);
      // temps de jeu : toutes les entrées et sorties, dans l'ordre (un joueur peut sortir puis revenir) ; rouge = sortie définitive
      const mouv = me.filter(e => (e.k==='sub' && (e.in_n===p.n || e.out_n===p.n)) || e === red).sort((a, b) => (+a.sort || 0) - (+b.sort || 0));
      let on = !p.sub, depuis = 0, mins = 0, start = p.sub ? 90 : 0, entre = false;
      const parcours = [];
      mouv.forEach(e => {
        const t = Math.min(90, minOf(e));
        if (e.k==='sub' && e.in_n===p.n && !on){
          on = true; depuis = t;
          if (p.sub && !entre) start = t; else parcours.push(`revenu à la ${esc(e.min)}`);
          entre = true;
        } else if (on && (e === red || e.out_n===p.n)){
          on = false; mins += Math.max(0, t - depuis);
          if (e !== red) parcours.push(`sorti à la ${esc(e.min)}`);
        }
      });
      if (on) mins += Math.max(0, 90 - depuis);
      const played = !p.sub || entre;
      const gl = me.filter(e => e.k==='goal' && e.n===p.n);
      hist.push({ m, p, played, start, mins: played ? Math.max(1, mins) : 0, goals: gl, y: me.filter(e => e.k==='yellow' && e.n===p.n).length, w: me.filter(e => e.k==='white' && e.n===p.n).length, r: red ? 1 : 0,
        res: resultOf(m, all), gf: goals(all, c), ga: goals(all, c==='H'?'A':'H'), parcours });
    }
    hist.sort((a, b) => b.m.kickoff.localeCompare(a.m.kickoff));
    const name = (hist[0] && hist[0].p.name) || 'Joueur';
    const pl = hist.filter(h => h.played);
    const nb = pl.length, g = pl.reduce((a, h) => a + h.goals.length, 0), mins = pl.reduce((a, h) => a + h.mins, 0);
    const tit = pl.filter(h => !h.p.sub).length, ent = nb - tit;
    const y = pl.reduce((a, h) => a + h.y, 0), w = pl.reduce((a, h) => a + h.w, 0), r = pl.reduce((a, h) => a + h.r, 0);
    const W = pl.filter(h => h.res==='V').length, N = pl.filter(h => h.res==='N').length, L = pl.filter(h => h.res==='D').length;
    const multi = pl.filter(h => h.goals.length >= 2).length, scoring = pl.filter(h => h.goals.length).length;
    const best = pl.reduce((b, h) => !b || h.goals.length > b.goals.length ? h : b, null);
    const teams = teamsText([...new Set(pl.map(h => h.m.equipe || 1))]);
    const parEq = {}; pl.forEach(h => { const e = h.m.equipe || 1; parEq[e] = (parEq[e] || 0) + 1; });
    const eqTri = Object.entries(parEq).sort((a, b) => b[1] - a[1] || teamRank(+a[0]) - teamRank(+b[0]));
    const parNum = {}; pl.forEach(h => { if (h.p.n) parNum[h.p.n] = (parNum[h.p.n] || 0) + 1; });
    const numFav = Object.entries(parNum).sort((a, b) => b[1] - a[1] || +a[0] - +b[0])[0];
    const numFavOk = numFav && !['12', '13', '14'].includes(numFav[0]);
    const fr = (v, d=1) => v.toLocaleString('fr-FR', {maximumFractionDigits: d});
    const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
    const opp = m => teamName(m, m.club_side==='H' ? 'A' : 'H');
    view.innerHTML = `<a class="back" href="#/stats">← Stats joueurs</a>
      <div class="phero"><span class="pav big">${esc(name.trim().charAt(0).toUpperCase())}</span><div><h1>${esc(name)}</h1>
        <p class="sub">${nb ? `${nb} match${nb>1?'s':''} joué${nb>1?'s':''}${teams ? ' · ' + esc(teams) : ''}` : 'Aucun match joué'} · saison ${esc(statSeason||'')}</p></div></div>
      <div class="chipbar compbar" role="group" aria-label="Compétition">${[['', 'Tout'], ['championnat', 'Championnat'], ['coupe', 'Coupes']].map(([v, l]) => `<button data-comp="${v}" class="${statComp===v?'on':''}" aria-pressed="${statComp===v}">${l}</button>`).join('')}</div>
      <div class="kpis">${kpi(g, 'Buts')}${kpi(nb, 'Matchs joués')}${kpi(nb ? fr(g/nb, 2) : '–', 'Buts / match')}${kpi(g ? fr(mins/g, 0) + '′' : '–', '1 but toutes les')}</div>
      <div class="kpis">${kpi(fr(mins, 0) + '′', 'Temps de jeu')}${kpi(tit, 'Titulaire')}${kpi(ent, 'Entrées')}${kpi(`<span class="kcartes">${y}<i class="kc y"></i>${w}<i class="kc w"></i>${r}<i class="kc r"></i></span>`, 'Cartons')}</div>
      <div class="pfacts">
        ${numFavOk ? `<div><span>Numéro favori</span><b>n°${esc(numFav[0])} (${numFav[1]} match${numFav[1]>1?'s':''})</b></div>` : ''}
        ${eqTri.length ? `<div><span>Équipe principale</span><b>${esc(teamLabel(+eqTri[0][0]))} (${eqTri[0][1]} match${eqTri[0][1]>1?'s':''})</b></div>` : ''}
        ${eqTri.length > 1 ? `<div><span>Équipes jouées cette saison</span><b>${esc(eqTri.map(([e, n]) => teamLetter(+e) + ' : ' + n).join(' · '))}</b></div>` : ''}
        ${nb ? `<div><span>Bilan quand il joue</span><b>${W} V · ${N} N · ${L} D</b></div>` : ''}
        ${nb ? `<div><span>Temps de jeu moyen</span><b>${fr(mins/nb, 0)} min par match</b></div>` : ''}
        ${g ? `<div><span>Matchs avec au moins un but</span><b>${scoring} sur ${nb} (${fr(100*scoring/nb, 0)} %)</b></div>` : ''}
        ${multi ? `<div><span>Doublés ou mieux</span><b>${multi}</b></div>` : ''}
        ${best && best.goals.length ? `<div><span>Meilleur match</span><b>${best.goals.length} but${best.goals.length>1?'s':''} contre ${esc(opp(best.m))}</b></div>` : ''}
      </div>
      ${isStaff() ? `<button type="button" class="fbtn" id="pMerge" style="width:100%;margin-top:12px">Fusionner avec un autre joueur (doublon)…</button>` : ''}
      <div class="sec">Historique des matchs</div>${hist.length > nb ? `<p class="note" style="margin:0 0 6px">${hist.length} matchs sur la feuille, dont ${hist.length - nb} sur le banc sans entrer en jeu (pas comptés dans les matchs joués).</p>` : ""}
      ${hist.map(h => {
        const m = h.m, role = !h.played ? 'Sur le banc, pas entré' : h.p.sub ? `Entré à la ${h.start}e` : 'Titulaire';
        const detail = [role, h.played ? `${h.mins} min` : '', ...h.parcours].filter(Boolean).join(' · ');
        const but = h.goals.length ? `<span class="pgoals">${h.goals.map(e => '⚽' + (e.min ? ' ' + esc(e.min) : '')).join(' ')}</span>` : '';
        const cards = (h.y ? '<i class="kc y"></i>'.repeat(h.y) : '') + (h.w ? '<i class="kc w"></i>'.repeat(h.w) : '') + (h.r ? '<i class="kc r"></i>' : '');
        return `<a class="phist" href="#/match/${esc(m.id)}">
          <div class="phtop"><span class="tchip">${teamLetter(m.equipe)}</span><span class="mcomp">${esc(fmtDate(m.kickoff, false))} · ${esc(m.competition || '')}</span><span class="badge ${h.res==='V'?'w':h.res==='D'?'l':''}">${h.res==='V'?'V':h.res==='D'?'D':'N'} ${h.gf}–${h.ga}</span></div>
          <div class="phmid"><b>${m.club_side==='H' ? 'vs' : 'à'} ${esc(opp(m))}</b>${but}${cards}</div>
          <div class="phsub">n°${esc(h.p.n)} · ${detail}</div></a>`;
      }).join('') || '<div class="empty">Aucun match avec ce filtre.</div>'}
      <p class="note">Temps de jeu calculé sur 90 minutes à partir des remplacements et cartons rouges saisis (temps additionnel non compté).</p>`;
    view.querySelectorAll('[data-comp]').forEach(b => b.onclick = () => { statComp = b.dataset.comp; drawPlayer(key); });
    if ($('pMerge')) $('pMerge').onclick = () => fusionJoueur(key, name);
    document.title = name + ' · Stats · AS Mésanger';
  }
  // Doublon (faute de frappe, nom abrégé…) : tous les matchs de ce joueur passent sous le nom choisi
  function fusionJoueur(key, name){
    const noms = new Map(), variantes = new Set();
    ms.forEach(m => ['H', 'A'].forEach(s => (((m.rosters || {})[s]) || []).forEach(p => {
      if (!p.name || s !== m.club_side) return;
      const k = playerKey(p.name);
      if (k === key){ variantes.add(p.name); return; }
      const e = noms.get(k) || { k, name: p.name, nb: 0 }; e.nb++; noms.set(k, e);
    })));
    const all = [...noms.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    openSheet(`<div class="dphead"><h3 id="shTitle">Fusionner « ${esc(name)} »</h3><button type="button" class="dpclose" id="fjNo">Annuler</button></div>
      <p>Choisis le bon joueur : tous les matchs de « ${esc(name)} » passeront sous son nom.</p>
      <input id="fjQ" class="dpq" type="search" placeholder="Rechercher un nom…" autocomplete="off" enterkeyhint="search">
      <div class="alist dplist" id="fjList"></div>`, 'tall');
    const list = $('fjList'), q = $('fjQ');
    const drawList = () => {
      const words = sansAccent(q.value).split(/\s+/).filter(Boolean);
      const f = all.filter(o => words.every(w => sansAccent(o.name).includes(w)));
      list.innerHTML = f.map(o => `<button type="button" class="arow dprow" data-k="${esc(o.k)}"><div class="who"><b>${esc(o.name)}</b><small>${o.nb} match${o.nb > 1 ? 's' : ''}</small></div></button>`).join('')
        || '<div class="empty">Personne ne correspond à cette recherche.</div>';
      list.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
        const cible = noms.get(b.dataset.k);
        askConfirm(`Fusionner « ${name} » avec « ${cible.name} » ?`,
          `Dans toutes les compos, « ${[...variantes].join(' », « ')} » sera remplacé par « ${cible.name} ». Les stats des deux seront regroupées.`,
          'Fusionner', async () => {
            const { data, error } = await sb.rpc('fusionner_joueur', { p_anciens: [...variantes], p_nouveau: cible.name });
            if (error){ toast(isNetErr(error) ? 'Pas de réseau' : 'Fusion refusée'); return; }
            lsSet('asm-stats', null);
            toast(`Fusion faite (${data} match${data > 1 ? 's' : ''})`);
            location.hash = '#/stats/joueur/' + encodeURIComponent(cible.k);
          });
      });
    };
    q.oninput = drawList; drawList();
    $('fjNo').onclick = closeSheet;
  }
}

// ---------- Conditions générales d'utilisation ----------
const CGU_VERSION = '2026-10-04';
function cguHTML(){
  return `<h2>Conditions générales d’utilisation</h2>
  <p class="note">Version du 4 octobre 2026</p>
  <h3>1. L’appli</h3>
  <p>« AS Mésanger Live » (asm-live.vercel.app) est une appli indépendante pour suivre en direct les matchs des équipes de l’AS Mésanger : scores, buteurs, cartons, remplacements, compositions, classements et statistiques des joueurs. <b>Ce n’est pas l’appli officielle de l’AS Mésanger</b> : elle est réalisée et gérée bénévolement par des personnes proches du club, et elle n’engage pas le club. Elle est gratuite, sans garantie de disponibilité ni d’exactitude : les informations officielles restent celles de la FFF et du club.</p>
  <h3>2. Utilisation sans compte</h3>
  <p>Tout le monde peut suivre les matchs, les classements et les stats sans compte. Les notifications (buts, cartons, début de match) sont facultatives : tu les actives et les désactives toi-même depuis la cloche 🔔.</p>
  <h3>3. Compte</h3>
  <p>Un compte sert à participer : saisir le score d’un match (responsable score), gérer les matchs d’une équipe, voir ses propres stats. Tu crées ton compte avec ton prénom, ton nom et ton email, et tu choisis un mot de passe que tu gardes secret. Un nouveau compte est validé par un administrateur de l’appli, qui choisit son rôle (supporter, joueur, dirigeant, responsable d’équipe, admin). Les administrateurs de l’appli peuvent à tout moment modifier le rôle d’un compte ou le supprimer (par exemple en cas d’usage abusif, de compte en double ou inutilisé).</p>
  <h3>4. Bon usage</h3>
  <p>Tu t’engages à saisir des informations exactes (scores, buteurs, cartons, compositions), à ne pas noter d’actions en double avec une autre personne, et à respecter les joueurs, les adversaires et les arbitres. Chaque modification d’un match est enregistrée avec son auteur et son heure (historique visible par les responsables et les administrateurs de l’appli).</p>
  <h3>5. Données personnelles</h3>
  <p><b>Ce qui est enregistré :</b> pour un compte, ton prénom, ton nom, ton email, ton rôle, les équipes que tu gères, le joueur auquel tu as lié ton compte, la date d’acceptation de ces conditions et les saisies que tu fais sur les matchs. Pour tous les visiteurs : l’abonnement aux notifications si tu l’actives, et, pendant que l’appli est ouverte, la page consultée et le fait d’être connecté ou non (sans nom ni adresse, pour compter les personnes en ligne). Les noms des joueurs apparaissent dans les compositions, la chronologie et les stats des matchs ; les compos et résultats des adversaires viennent de la feuille de match publique de la FFF.</p>
  <p><b>Photos de feuille de match :</b> la lecture d’une photo de compo se fait sur ton téléphone ; la photo n’est pas envoyée ni conservée.</p>
  <p><b>À quoi elles servent :</b> uniquement au fonctionnement de l’appli (suivi des matchs, stats, notifications). Elles ne sont ni vendues, ni utilisées pour de la publicité.</p>
  <p><b>Où elles sont :</b> chez les hébergeurs de l’appli (Supabase pour la base de données, Vercel pour le site et l’envoi des notifications).</p>
  <p><b>Combien de temps :</b> tant que ton compte existe. Si ton compte est supprimé (par toi ou par un administrateur), ton accès et ton email sont effacés et tu ne peux plus te connecter ; ton prénom et ton nom restent dans l’historique des matchs et actions que tu as saisis (et dans les compos où tu as joué).</p>
  <p><b>Tes droits :</b> tu peux consulter, corriger ton nom (« Mon compte »), supprimer ton compte (« Mon compte » → « Supprimer mon compte ») ou demander à un administrateur de l’appli de corriger ou retirer ton nom d’une composition ou de l’historique. Tu peux aussi saisir la CNIL (cnil.fr).</p>
  <h3>6. Évolutions</h3>
  <p>Ces conditions peuvent évoluer ; la date de version ci-dessus change alors.</p>`;
}
function cguView(){
  view.innerHTML = `<a class="back" href="#/compte">← Retour</a><div class="card cgu">${cguHTML()}</div>`;
}

// ---------- Connexion / compte ----------
function loginView(){
  if (session){ location.hash = '#/compte'; return; }
  // venu du bouton « Je veux être responsable score » : création de compte proposée d'abord
  let mode = lsGet('asm-login-mode', null) === 'up' ? 'up' : 'in';
  lsSet('asm-login-mode', null);
  const apres = lsGet('asm-apres-connexion', null);
  const draw = (msg='') => {
    view.innerHTML = `<form class="card" id="lf">
      <h1>${mode==='in' ? 'Connexion' : 'Créer un compte'}</h1>
      <p class="sub">${apres && apres.demande ? `Pour être responsable score de <b>${esc(apres.titre || 'ce match')}</b>, ${mode==='in' ? 'connecte-toi' : 'crée ton compte (10 secondes)'} : ta demande partira toute seule.` : 'Réservé aux membres du club pour saisir les matchs. Pas besoin de compte pour suivre les matchs.'}</p>
      ${msg}
      ${mode==='up' ? `<div class="frow2"><label class="field"><span>Prénom</span><input id="lfPrenom" required minlength="2" autocomplete="given-name" autocapitalize="words"></label><label class="field"><span>Nom</span><input id="lfNom" required minlength="2" autocomplete="family-name" autocapitalize="words"></label></div>` : ''}
      <label class="field"><span>Email</span><input id="lfMail" type="email" required autocomplete="email"></label>
      <label class="field"><span>Mot de passe</span><input id="lfPw" type="password" required minlength="6" autocomplete="${mode==='in'?'current-password':'new-password'}">${mode==='up' ? '<small>6 caractères minimum.</small>' : ''}</label>
      ${mode==='up' ? '<label class="cgucase"><input type="checkbox" id="lfCgu" required><span>J’ai lu et j’accepte les <button type="button" class="link" id="lfCguVoir">conditions d’utilisation</button>, y compris l’utilisation de mes données.</span></label>' : ''}
      <div class="foot" style="margin-top:4px"><button class="fbtn primary" id="lfGo">${mode==='in' ? 'Se connecter' : 'Créer mon compte'}</button></div>
      <button type="button" class="link" id="lfSwitch">${mode==='in' ? 'Pas encore de compte ? Créer un compte' : 'Déjà un compte ? Se connecter'}</button>
    </form>`;
    $('lfSwitch').onclick = () => { mode = mode==='in' ? 'up' : 'in'; draw(); };
    if ($('lfCguVoir')) $('lfCguVoir').onclick = e => { e.preventDefault(); openSheet(`<div class="cgu">${cguHTML()}</div><button class="fbtn primary" id="cguOk" style="width:100%;margin-top:12px">J’ai compris</button>`, 'tall'); $('cguOk').onclick = () => { closeSheet(); if ($('lfCgu')) $('lfCgu').checked = true; }; };
    $('lf').onsubmit = async ev => {
      ev.preventDefault();
      $('lfGo').disabled = true;
      const email = $('lfMail').value.trim(), password = $('lfPw').value;
      let res;
      if (mode==='in') res = await sb.auth.signInWithPassword({email, password});
      else {
        if (!$('lfCgu').checked){ $('lfGo').disabled = false; toast('Coche la case des conditions d’utilisation'); return; }
        res = await sb.auth.signUp({email, password, options:{data:{nom: fmtNom($('lfPrenom').value) + ' ' + fmtNom($('lfNom').value), cgu: CGU_VERSION}}});
      }
      if (res.error){
        const m = /invalid login/i.test(res.error.message) ? 'Email ou mot de passe incorrect.' : /already registered/i.test(res.error.message) ? 'Un compte existe déjà avec cet email.' : res.error.message;
        return draw(`<div class="msg err">${esc(m)}</div>`);
      }
      if (!res.data.session){ mode = 'in'; return draw('<div class="msg">Compte créé. Confirme ton adresse avec le lien reçu par email, puis connecte-toi.' + (apres && apres.demande ? ' Ta demande pour être responsable score partira à ce moment-là.' : '') + '</div>'); }
      if (mode === 'up'){
        // prévient les admins (une seule fois par compte, contrôlé par la base)
        fetch('api/notify-signup', { method: 'POST', keepalive: true, headers: { Authorization: 'Bearer ' + res.data.session.access_token } }).catch(() => {});
      }
      await loadProfile();
      // retour sur le match : la demande « responsable score » y est envoyée automatiquement
      const ap = lsGet('asm-apres-connexion', null);
      location.hash = ap && ap.demande ? '#/match/' + ap.demande : isStaff() ? '#/' : '#/compte';
    };
  };
  draw();
}
function nameView(force){
  const [p0, n0] = splitNom(profile && profile.nom);
  view.innerHTML = `<form class="card" id="nmf">
    <h1>${force ? 'Ton prénom et ton nom' : 'Modifier mon nom'}</h1>
    <p class="sub">${force ? 'Pour que les responsables sachent qui saisit les matchs, indique ton prénom et ton nom.' : 'Il apparaît dans l’historique des matchs et dans la liste des responsables score.'}</p>
    <div class="frow2"><label class="field"><span>Prénom</span><input id="nmPrenom" required minlength="2" autocomplete="given-name" autocapitalize="words" value="${esc(p0)}"></label>
    <label class="field"><span>Nom</span><input id="nmNom" required minlength="2" autocomplete="family-name" autocapitalize="words" value="${esc(n0)}"></label></div>
    <p class="note" id="nmPrev"></p>
    <div class="foot" style="margin-top:4px"><button class="fbtn primary" id="nmGo">Enregistrer</button>${force ? '' : '<a class="fbtn" href="#/compte">Annuler</a>'}</div>
    ${force ? '<button type="button" class="link" id="nmOut" style="width:100%;margin-top:10px">Se déconnecter</button>' : ''}
  </form>`;
  const prev = () => { const t = (fmtNom($('nmPrenom').value) + ' ' + fmtNom($('nmNom').value)).trim(); $('nmPrev').textContent = t ? 'Affiché : ' + t : ''; };
  $('nmPrenom').oninput = $('nmNom').oninput = prev; prev();
  if ($('nmOut')) $('nmOut').onclick = async () => { await sb.auth.signOut(); session = null; profile = null; lsSet('asm-profile', null); renderAcct(); location.hash = '#/'; route(); };
  $('nmf').onsubmit = async ev => {
    ev.preventDefault();
    $('nmGo').disabled = true;
    const { data, error } = await sb.rpc('set_mon_nom', { p_prenom: $('nmPrenom').value, p_nom: $('nmNom').value });
    if (error){ $('nmGo').disabled = false; toast(isNetErr(error) ? 'Pas de réseau' : 'Prénom et nom obligatoires'); return; }
    profile = { ...profile, nom: data }; lsSet('asm-profile', profile); renderAcct(); people = null; delegues = null;
    toast('Nom enregistré : ' + data);
    if (force) route(); else location.hash = '#/compte';
  };
}
function accountView(){
  if (!session){ location.hash = '#/connexion'; return; }
  const ROLE = {pending:'En attente de validation', joueur:'Joueur', supporter:'Supporter', dirigeant:'Dirigeant', delegue:'Responsable d’équipe', admin:'Administrateur'};
  const role = profile ? profile.role : 'pending';
  view.innerHTML = `<div class="card">
    <h1>${esc(profile && profile.nom || 'Mon compte')}</h1>
    <p class="sub">${esc(session.user.email)} · ${ROLE[role]} · <button class="link" id="editNom" style="padding:0">Modifier mon nom</button></p>
    ${role==='pending' ? '<div class="msg">Ton compte doit être validé par un administrateur du club avant de pouvoir saisir les matchs.</div>' : ''}
    ${role==='joueur' || role==='supporter' || role==='dirigeant' ? '<div class="msg">Tu peux saisir uniquement les matchs où tu es responsable score (choisi par un responsable, ou en faisant la demande sur la page du match). Ils apparaissent sur l’accueil avec la pastille « ✎ Gérer ».</div>' : ''}
    ${role==='delegue' ? `<div class="msg">${myTeams().length ? 'Tu gères les matchs des ' + esc(teamsText(myTeams())) + '.' : 'Aucune équipe ne t’est encore confiée : tu peux saisir uniquement les matchs où tu es responsable score.'}</div>` : ''}
    <div class="foot" style="margin-top:4px">
      ${canCreate() ? '<a class="fbtn club" href="#/nouveau">+ Nouveau match</a>' : ''}
      ${isAdmin() ? '<a class="fbtn" href="#/admin">Gérer les accès</a>' : ''}
    </div>
    <div class="foot" style="margin-top:10px"><button class="fbtn" id="logout">Se déconnecter</button></div>
    <a class="link" href="#/cgu" style="display:block;text-align:center;margin-top:14px">Conditions d’utilisation</a>
    <button class="link danger-link" id="delMe" style="width:100%;margin-top:8px">Supprimer mon compte</button>
  </div>
  <div class="card monjoueur" id="monJoueur"><div class="loading">Chargement de tes stats…</div></div>`;
  monJoueurBloc();
  $('editNom').onclick = () => nameView(false);
  $('delMe').onclick = () => askConfirm('Supprimer ton compte ?',
    'Tu ne pourras plus te connecter. Les matchs et actions que tu as saisis restent dans l’historique, avec ton nom. Cette suppression est définitive.',
    'Supprimer mon compte', async () => {
      const { error } = await sb.rpc('supprimer_compte', { p_id: myId() });
      if (error){ toast(/dernier admin/.test(error.message) ? 'Impossible : tu es le dernier admin du club' : isNetErr(error) ? 'Pas de réseau' : 'Suppression refusée'); return; }
      try{ await sb.auth.signOut(); }catch(e){}
      session = null; profile = null; lsSet('asm-profile', null); renderAcct(); location.hash = '#/'; toast('Compte supprimé');
    });
  $('logout').onclick = async () => {
    if (outbox.length && !confirm('Des actions ne sont pas encore envoyées. Se déconnecter quand même ?')) return;
    await sb.auth.signOut(); session = null; profile = null; lsSet('asm-profile', null); renderAcct(); location.hash = '#/';
  };
}
// « Mon compte » : joueur lié (Mes stats) ou proposition de lien
async function monJoueurBloc(){
  const box = () => $('monJoueur');
  let data = lsGet('asm-stats', null);
  const dessine = () => {
    if (!box() || !data) return;
    const k = monJoueur(), tous = joueursClub(data.ms);
    if (k){
      const nom = (tous.find(j => j.k === k) || {}).name || profile.joueur;
      const b = bilanJoueur(data.ms, data.evs, k);
      box().innerHTML = `<h2>⚽ Mes stats</h2><p class="sub">Tu es <b>${esc(nom)}</b> dans les compos · saison ${esc(b.saison)}${b.eq ? ' · surtout en <b>' + esc(teamLabel(b.eq)) + '</b>' : ''}</p>
        <div class="kpis"><div class="kpi"><b>${b.mj}</b><span>Matchs</span></div><div class="kpi"><b>${b.buts}</b><span>Buts</span></div>
        <div class="kpi"><b><span class="kcartes">${b.jaunes}<i class="kc y"></i>${b.blancs}<i class="kc w"></i>${b.rouges}<i class="kc r"></i></span></b><span>Cartons</span></div></div>
        <a class="fbtn" href="#/stats/joueur/${encodeURIComponent(k)}" style="width:100%;margin-top:10px">Voir ma fiche complète</a>
        <button type="button" class="link" id="mjNon" style="width:100%;margin-top:8px">Ce n’est pas moi</button>`;
      $('mjNon').onclick = () => askConfirm('Retirer le lien ?', 'Tes stats ne seront plus affichées dans ton compte. Tu pourras choisir à nouveau ton nom.', 'Retirer', () => lier(null));
      return;
    }
    // pas encore lié : joueurs dont le nom ressemble à celui du compte, sinon recherche dans la liste
    const moiNom = playerKey(profile && profile.nom || '');
    const proches = tous.filter(j => j.k === moiNom || (typeof memeJoueur === 'function' && memeJoueur(j.name, profile.nom || '')));
    box().innerHTML = `<h2>⚽ Mes stats</h2>
      ${proches.length ? `<p class="sub">C’est toi dans les compos ?</p>${proches.map(j => `<div class="arow"><div class="who"><b>${esc(j.name)}</b><small>${j.nb} match${j.nb > 1 ? 's' : ''}</small></div><button type="button" class="amod ok" data-moi="${esc(j.name)}">C’est moi</button></div>`).join('')}`
        : '<p class="sub">Choisis ton nom tel qu’il est écrit dans les compos pour voir tes stats.</p>'}
      <input id="mjQ" class="dpq" type="search" placeholder="🔍 Chercher mon nom dans les compos…" autocomplete="off" style="margin-top:10px">
      <div class="alist" id="mjList"></div>`;
    const q = $('mjQ'), list = $('mjList');
    const filtre = () => {
      const w = sansAccent(q.value).split(/\s+/).filter(Boolean);
      list.innerHTML = w.length ? (tous.filter(j => w.every(x => sansAccent(j.name).includes(x))).slice(0, 8)
        .map(j => `<div class="arow"><div class="who"><b>${esc(j.name)}</b><small>${j.nb} match${j.nb > 1 ? 's' : ''}</small></div><button type="button" class="amod" data-moi="${esc(j.name)}">C’est moi</button></div>`).join('')
        || '<div class="empty">Aucun joueur à ce nom dans les compos.</div>') : '';
      box().querySelectorAll('[data-moi]').forEach(b => b.onclick = () => lier(b.dataset.moi));
    };
    q.oninput = filtre; filtre();
  };
  const lier = async nom => {
    const { error } = await sb.rpc('lier_joueur', { p_user: myId(), p_nom: nom });
    if (error){ toast(isNetErr(error) ? 'Pas de réseau' : 'Modification refusée'); return; }
    profile = { ...profile, joueur: nom }; lsSet('asm-profile', profile);
    toast(nom ? 'C’est noté : tu es ' + nom : 'Lien retiré'); dessine();
  };
  dessine();
  try{ data = await chargerStats(); if (location.hash.startsWith('#/compte')) dessine(); }
  catch(e){ if (!data && box()) box().innerHTML = '<div class="empty">Pas de réseau pour l’instant.</div>'; }
}
async function adminView(){
  if (!isAdmin()){ location.hash = '#/compte'; return; }
  if (!view.querySelector('.acc')) view.innerHTML = '<div class="loading">Chargement…</div>';
  let { data, error } = await sb.from('profiles').select('*').order('created_at');
  if (error) throw error;
  const deleted = data.filter(p => p.role === 'supprime' && !p.efface).sort((a, b) => String(b.deleted_at||'').localeCompare(String(a.deleted_at||'')));
  const supprimes = deleted.length;
  data = data.filter(p => p.role !== 'supprime');
  const ROLES = [['joueur', 'Joueur'], ['supporter', 'Supporter'], ['dirigeant', 'Dirigeant'], ['delegue', 'Responsable'], ['admin', 'Admin']];
  const GROUPS = [['pending', 'En attente de validation'], ['admin', 'Admins'], ['delegue', 'Responsables'], ['dirigeant', 'Dirigeants'], ['joueur', 'Joueurs'], ['supporter', 'Supporters']];
  const nameOf = p => p.nom || p.email || 'Sans nom';
  const initial = p => esc(nameOf(p).trim().charAt(0).toUpperCase());
  const teamsOf = p => p.role === 'delegue' ? (p.equipes || []) : [];
  const summary = p => p.role === 'admin' ? 'Admin · toutes les équipes'
    : p.role === 'delegue' ? 'Responsable · ' + (teamsOf(p).length ? teamsText(teamsOf(p)) : 'aucune équipe')
    : p.role === 'joueur' ? 'Joueur' : p.role === 'supporter' ? 'Supporter' : p.role === 'dirigeant' ? 'Dirigeant' : 'En attente';

  const row = p => `<div class="arow" data-uid="${esc(p.id)}">
      <span class="pav">${initial(p)}</span>
      <div class="who"><b>${esc(nameOf(p))}${p.id === session.user.id ? ' <small>(toi)</small>' : ''}</b><small>${esc(p.email || '')}${p.a_confirmer && p.created_at ? ' · inscrit le ' + esc(new Date(p.created_at).toLocaleDateString('fr-FR')) : ''}</small>
        <span class="rbadge r-${p.role}">${esc(summary(p))}</span>${p.joueur ? `<span class="ajoueur">⚽ ${esc(p.joueur)}</span>` : ''}<span class="onstate"></span></div>
      ${p.a_confirmer ? `<button type="button" class="amod ok" data-edit="${esc(p.id)}">Valider</button>`
        : `<button type="button" class="amod" data-edit="${esc(p.id)}">Modifier</button>`}
    </div>`;
  // nouveaux comptes (joueurs d'office) : à confirmer, ou rôle à changer, ou compte à supprimer
  const nouveaux = data.filter(p => p.a_confirmer).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const pendingN = data.filter(p => p.role === 'pending').length;
  view.innerHTML = `<div class="acc">
    <div class="acctop"><h1>Accès</h1><a class="link" href="#/compte">← Mon compte</a></div>
    <div class="acctotal"><b>${data.length}</b><span>compte${data.length>1?'s':''} créé${data.length>1?'s':''}<small>${[['admin','admin'],['delegue','responsable'],['dirigeant','dirigeant'],['joueur','joueur'],['supporter','supporter'],['pending','en attente']].map(([r,l])=>{const n=data.filter(p=>p.role===r).length; return n ? n+' '+l+(n>1&&r!=='pending'?'s':'') : '';}).filter(Boolean).join(' · ')}</small></span></div>
    <p class="accon" id="accOnline"></p>
    <p class="note" style="margin-top:4px">Un <b>responsable</b> crée et saisit les matchs de ses équipes. Un <b>joueur</b>, un <b>supporter</b> ou un <b>dirigeant</b> ne peut saisir que les matchs où il est responsable score. Un <b>admin</b> gère tout.</p>
    ${nouveaux.length ? `<div class="sec secwarn">Nouveaux comptes à confirmer · ${nouveaux.length}</div>
      <p class="note" style="margin:0 0 6px">Ils sont <b>supporters</b> dès leur inscription (ils peuvent demander à être responsable score). <b>Valider</b> ouvre le choix du rôle (joueur, supporter, dirigeant, responsable, admin), puis <b>Valider le compte</b>. On peut aussi y supprimer le compte.</p>
      <div class="alist">${nouveaux.map(row).join('')}</div>` : ''}
    ${GROUPS.map(([r, t]) => {
      // responsables : dernières équipes d'abord, la A en dernier (comme l'accueil), sans équipe à la fin ; les autres par nom
      const rangEq = p => { const i = teamsOf(p).map(n => EQUIPES.findIndex(e => e.id === n)).filter(x => x >= 0); return i.length ? -Math.max(...i) : 999; };
      const l = data.filter(p => p.role === r && !p.a_confirmer)
        .sort((a, b) => (r === 'delegue' ? rangEq(a) - rangEq(b) : 0) || nameOf(a).localeCompare(nameOf(b), 'fr'));
      return l.length ? `<div class="sec${r === 'pending' ? ' secwarn' : ''}">${t} · ${l.length}</div><div class="alist">${l.map(row).join('')}</div>` : '';
    }).join('')}
    ${supprimes ? `<div class="sec">Comptes supprimés · ${supprimes}</div>
      <p class="note" style="margin:0 0 6px">Leur nom reste dans l’historique des matchs. Si la personne a recréé un compte, <b>rattache-le</b> : tout son historique passe sur le nouveau compte. Sinon tu peux l’<b>effacer</b> définitivement.</p>
      <div class="alist">${deleted.map(p => `<div class="arow gone"><span class="pav">${initial(p)}</span><div class="who"><b>${esc(nameOf(p))}</b><small>${p.deleted_at ? 'Supprimé le ' + esc(new Date(p.deleted_at).toLocaleDateString('fr-FR')) : 'Compte supprimé'}</small></div><div class="gonebtns"><button type="button" class="amod" data-link="${esc(p.id)}">Rattacher</button><button type="button" class="amod danger" data-wipe="${esc(p.id)}">Effacer</button></div></div>`).join('')}</div>` : ''}
  </div>`;

  view.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editPerson(data.find(p => p.id === b.dataset.edit)));
  view.querySelectorAll('[data-link]').forEach(b => b.onclick = () => linkAccount(deleted.find(p => p.id === b.dataset.link)));
  view.querySelectorAll('[data-wipe]').forEach(b => b.onclick = () => {
    const old = deleted.find(p => p.id === b.dataset.wipe);
    askConfirm(`Effacer définitivement « ${nameOf(old)} » ?`,
      'Le compte disparaît de la page Accès. Les matchs, compos et actions qu’il avait saisis restent dans l’historique, avec son prénom et son nom. Impossible de le rattacher ensuite. C’est irréversible.',
      'Effacer définitivement', async () => {
        const { error } = await sb.rpc('effacer_compte', { p_id: old.id });
        if (error){ toast(isNetErr(error) ? 'Pas de réseau' : 'Effacement refusé'); return; }
        people = null; toast(`« ${nameOf(old)} » effacé définitivement`); adminView();
      });
  });
  renderAdminOnline();

  // Rattacher un compte supprimé à un compte existant
  function linkAccount(old){
    const cands = data.slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'fr'));
    openSheet(`<h3 id="shTitle">Rattacher « ${esc(nameOf(old))} »</h3>
      <p>Choisis le nouveau compte de cette personne. Les matchs créés, compos saisies, actions et délégations de l’ancien compte lui seront transférés.</p>
      <input id="lkQ" class="dpq" type="search" placeholder="Rechercher un nom…" autocomplete="off">
      <div class="alist dplist" id="lkList"></div>
      <button class="cancel" id="lkNo">Annuler</button>`);
    const q = $('lkQ'), list = $('lkList');
    const drawList = () => {
      const w = sansAccent(q.value).split(/\s+/).filter(Boolean);
      const f = cands.filter(p => w.every(x => sansAccent(nameOf(p) + ' ' + (p.email||'')).includes(x)));
      list.innerHTML = f.map(p => `<button type="button" class="arow dprow" data-to="${esc(p.id)}"><div class="who"><b>${esc(nameOf(p))}</b><small>${esc(p.email || '')}</small></div></button>`).join('') || '<div class="empty">Aucun compte ne correspond.</div>';
      list.querySelectorAll('[data-to]').forEach(b => b.onclick = () => {
        const to = cands.find(p => p.id === b.dataset.to);
        askConfirm(`Rattacher à ${nameOf(to)} ?`,
          `Tout l’historique de « ${nameOf(old)} » (compte supprimé) passera sur le compte de ${nameOf(to)}, puis l’ancienne fiche sera effacée. Les droits de ${nameOf(to)} ne changent pas. C’est définitif.`,
          'Rattacher', async () => {
            const { data: r, error } = await sb.rpc('rattacher_compte', { p_ancien: old.id, p_nouveau: to.id });
            if (error){ toast(isNetErr(error) ? 'Pas de réseau' : 'Rattachement refusé'); return; }
            const n = (r.matchs||0) + (r.compos||0) + (r.delegations||0) + (r.actions||0);
            people = null; delegues = null;
            toast(n ? `Historique transféré à ${nameOf(to)} (${r.actions||0} action${r.actions>1?'s':''}, ${r.matchs||0} match${r.matchs>1?'s':''} créé${r.matchs>1?'s':''})` : `Rattaché à ${nameOf(to)} (aucun historique à transférer)`);
            adminView();
          });
      });
    };
    q.oninput = drawList; drawList();
    $('lkNo').onclick = closeSheet;
  }

  function editPerson(p){
    const me = p.id === session.user.id;
    let role = p.role, eqs = new Set(p.equipes || []);
    let [pre, nm] = splitNom(p.nom);
    let joueur = p.joueur || '';
    const tous = joueursClub((lsGet('asm-stats', null) || {}).ms);
    const draw = () => {
      openSheet(`<div class="phead"><span class="pav">${initial(p)}</span><div class="who"><h3 id="shTitle" style="margin:0">${esc(nameOf(p))}</h3><small>${esc(p.email || '')}</small></div></div>
        <div class="frow2" style="margin-top:14px"><label class="field"><span>Prénom</span><input id="edPre" value="${esc(pre)}" autocapitalize="words"></label><label class="field"><span>Nom</span><input id="edNom" value="${esc(nm)}" autocapitalize="words"></label></div>
        <div class="field"><span>Rôle</span>
          <div class="rseg" role="group" aria-label="Rôle">${ROLES.map(([v, l]) => `<button type="button" data-role="${v}" class="${role === v ? 'on' : ''}" aria-pressed="${role === v}"${me ? ' disabled' : ''}>${l}</button>`).join('')}</div>
          <small>${role === 'admin' ? 'Gère toutes les équipes, les accès et les classements.' : role === 'delegue' ? 'Crée et saisit les matchs des équipes cochées ci-dessous.' : role === 'joueur' || role === 'supporter' || role === 'dirigeant' ? 'Aucun accès, sauf les matchs où il est responsable score.' : 'Ne peut rien modifier.'}${me ? ' Tu ne peux pas changer ton propre rôle.' : ''}</small></div>
        ${role === 'delegue' ? `<div class="field"><span>Équipes dont il est responsable</span>
          ${CATS.map(c => `<div class="eqcat"><small>${esc(c)}</small><div class="eqpick">${catTeams(c).map(n => `<button type="button" data-e="${n}" class="${eqs.has(n) ? 'on' : ''}" aria-pressed="${eqs.has(n)}"><b>${esc(teamLetter(n))}</b><small>${esc(teamLabel(n))}</small></button>`).join('')}</div></div>`).join('')}</div>` : ''}
        <label class="field"><span>Joueur dans les compos</span><input id="edJoueur" list="edJoueurs" value="${esc(joueur)}" placeholder="Aucun (nom tel qu’écrit dans les compos)" autocomplete="off">
          <datalist id="edJoueurs">${tous.map(j => `<option value="${esc(j.name)}">`).join('')}</datalist><small>Pour « Mes stats » dans son compte et ses actions mises en avant.</small></label>
        ${p.a_confirmer ? '<p class="note" style="margin:0 0 6px">Nouveau compte : choisis son rôle puis valide.</p>' : ''}
        <div class="foot" style="margin-top:6px"><button class="fbtn primary" id="edSave">${p.a_confirmer ? 'Valider le compte' : 'Enregistrer'}</button><button class="fbtn" id="edNo">Annuler</button></div>
        ${me ? '' : '<button class="link danger-link" id="edDel" style="width:100%;margin-top:12px">Supprimer ce compte</button>'}`);
      $('shBody').querySelectorAll('[data-role]').forEach(b => b.onclick = () => { role = b.dataset.role; draw(); });
      $('shBody').querySelectorAll('[data-e]').forEach(b => b.onclick = () => { const n = +b.dataset.e; eqs.has(n) ? eqs.delete(n) : eqs.add(n); draw(); });
      $('edPre').oninput = e => { pre = e.target.value; }; $('edNom').oninput = e => { nm = e.target.value; };
      $('edJoueur').oninput = e => { joueur = e.target.value; };
      $('edNo').onclick = closeSheet;
      $('edSave').onclick = async () => {
        if (!nomOk(pre + ' ' + nm) || fmtNom(pre).length < 2 || fmtNom(nm).length < 2){ toast('Prénom et nom obligatoires'); return; }
        const fields = { role, equipes: role === 'delegue' ? [...eqs].sort() : (p.equipes || []), nom: fmtNom(pre) + ' ' + fmtNom(nm), a_confirmer: false };
        $('edSave').disabled = true;
        const { data: upd, error } = await sb.from('profiles').update(fields).eq('id', p.id).select('id');
        if (error || !upd || !upd.length){ $('edSave').disabled = false; toast('Modification refusée'); return; }
        if ((joueur || '').trim() !== (p.joueur || '')) await sb.rpc('lier_joueur', { p_user: p.id, p_nom: joueur.trim() || null });
        if (p.id === myId()){ profile = { ...profile, joueur: joueur.trim() || null }; lsSet('asm-profile', profile); }
        people = null; closeSheet(); toast(p.a_confirmer ? nameOf(p) + ' validé' : 'Accès de ' + nameOf(p) + ' mis à jour'); adminView();
      };
      if ($('edDel')) $('edDel').onclick = () => askConfirm('Supprimer le compte de ' + nameOf(p) + ' ?',
        'Cette personne ne pourra plus se connecter. Les matchs et actions qu’elle a saisis restent dans l’historique, avec son nom. Cette suppression est définitive.',
        'Supprimer le compte', async () => {
          const { error } = await sb.rpc('supprimer_compte', { p_id: p.id });
          if (error){ toast(/dernier admin/.test(error.message) ? 'Impossible : c’est le dernier admin' : 'Suppression refusée'); return; }
          people = null; toast('Compte supprimé'); adminView();
        });
    };
    draw();
  }
}

// ---------- Notifications de buts ----------
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function b64ToBytes(b64){ const p = '='.repeat((4 - b64.length % 4) % 4); const s = atob((b64 + p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function saveFollow(teams, admin){
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!teams.length && !admin){
    if (sub){ const j = sub.toJSON(); await sb.rpc('push_subscribe', {p_endpoint:j.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth, p_equipes:[]}); await sub.unsubscribe(); }
    lsSet('asm-follow', []); return true;
  }
  if (Notification.permission !== 'granted'){
    const p = await Notification.requestPermission();
    if (p !== 'granted') return false;
  }
  if (!sub) sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey: b64ToBytes(VAPID_PUBLIC)});
  const j = sub.toJSON();
  const { error } = await sb.rpc('push_subscribe', {p_endpoint:j.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth, p_equipes:teams, p_admin:!!admin});
  if (error) throw error;
  lsSet('asm-follow', teams); return true;
}
function openBell(preselect){
  if (!pushSupported() || (isIOS && !isStandalone())){
    openSheet(`<h3 id="shTitle">Notifications de buts</h3>
      <p>${isIOS ? 'Sur iPhone, les notifications marchent seulement depuis l’appli installée : touche <b>Partager</b> puis <b>Sur l’écran d’accueil</b>, ouvre l’appli depuis l’icône, puis reviens sur cette cloche.' : 'Ce navigateur ne permet pas les notifications. Essaie avec Chrome, ou installe l’appli sur l’écran d’accueil.'}</p>
      <button class="fbtn primary" id="bOk" style="width:100%">Compris</button>`);
    $('bOk').onclick = closeSheet; return;
  }
  const cur = new Set(lsGet('asm-follow', []));
  if (preselect && !cur.size) cur.add(preselect);
  const denied = Notification.permission === 'denied';
  openSheet(`<h3 id="shTitle">Notifications de buts</h3>
    <p>Reçois une notification à chaque but et chaque carton des équipes choisies, même appli fermée.</p>
    ${denied ? '<div class="msg err">Les notifications sont bloquées pour ce site. Autorise-les dans les réglages du téléphone (ou du navigateur), puis reviens ici.</div>' : ''}
    <div class="msg" id="bState">Vérification de ce téléphone…</div>
    <div class="follow">${CATS.map(c => `<div class="fcat">${esc(c)}</div>` + catTeams(c).map(n => `<label class="fl"><input type="checkbox" value="${n}"${cur.has(n)?' checked':''}><span>${esc(teamLabel(n))}</span></label>`).join('')).join('')}</div>
    ${isAdmin() ? `<label class="fl fladmin"><input type="checkbox" id="bAdmin"${lsGet('asm-follow-admin', false) ? ' checked' : ''}><span>👤 Nouveaux comptes à valider <small>(admins)</small></span></label>` : ''}
    <div class="foot" style="margin-top:12px"><button class="fbtn primary" id="bSave">Enregistrer</button><button class="fbtn" id="bNo">Annuler</button></div>
    <button class="link" id="bTest" hidden style="width:100%">Envoyer une notification d’essai</button>`);
  $('bNo').onclick = closeSheet;
  // État réel, lu dans la base (et non dans la mémoire du téléphone)
  pushState().then(st => {
    const el = $('bState'); if (!el) return;
    const parts = [];
    if (st.teams.length) parts.push('les buts de : ' + teamsText(st.teams));
    if (st.admin) parts.push('les nouveaux comptes à valider');
    el.textContent = parts.length ? 'Ce téléphone reçoit ' + parts.join(' et ') + '.' : 'Ce téléphone n’est pas encore abonné.';
    lsSet('asm-follow', st.teams); lsSet('asm-follow-admin', st.admin); renderBell();
    if ($('bAdmin')) $('bAdmin').checked = st.admin;
    if (st.sub && parts.length) $('bTest').hidden = false;
  }).catch(() => { const el = $('bState'); if (el) el.textContent = navigator.onLine ? 'État inconnu.' : 'Pas de réseau.'; });
  $('bTest').onclick = async () => { const st = await pushState(); toast(await sendTestPush(st.sub) ? 'Notification d’essai envoyée' : 'L’envoi d’essai a échoué'); };
  $('bSave').onclick = async () => {
    const teams = [...$('shBody').querySelectorAll('.follow input:checked')].map(i => +i.value);
    const admin = !!($('bAdmin') && $('bAdmin').checked);
    $('bSave').disabled = true;
    try{
      const ok = await saveFollow(teams, admin);
      if (!ok){ closeSheet(); renderBell(); toast('Notifications refusées'); return; }
      const st = await pushState();
      closeSheet(); renderBell();
      if (!teams.length && !admin){ toast('Notifications désactivées'); return; }
      if (st.teams.length !== teams.length || st.admin !== admin){ toast('Échec : l’abonnement n’a pas été enregistré'); return; }
      toast(await sendTestPush(st.sub) ? 'Activé : tu vas recevoir une notification d’essai' : 'Abonné, mais l’essai n’est pas arrivé');
    }catch(e){ console.error(e); $('bSave').disabled = false; toast(navigator.onLine ? 'Impossible d’activer : ' + (e && e.message || e) : 'Pas de réseau'); }
  };
}
async function pushState(){
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { sub: null, teams: [], admin: false };
  const { data, error } = await sb.rpc('push_status', { p_endpoint: sub.endpoint });
  if (error) throw error;
  return { sub, teams: (data && data.equipes) || [], admin: !!(data && data.admin) };
}
async function sendTestPush(sub){
  if (!sub) return false;
  try{
    const r = await fetch('api/test-push', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ subscription: sub.toJSON() }) });
    return r.ok;
  }catch(e){ return false; }
}
function renderBell(){ const b = $('bell'); if (b) b.classList.toggle('on', lsGet('asm-follow', []).length > 0 || !!lsGet('asm-follow-admin', false)); }
$('bell').onclick = () => openBell(homeF.team || 0);
// Thème : Auto (suit le téléphone) → Jour → Sombre
const THEMES = {
  auto: ['Auto (suit le téléphone)', '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>'],
  light: ['Jour', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'],
  dark: ['Sombre', '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'],
};
function applyTheme(t, say){
  if (!THEMES[t]) t = 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const b = $('themeBtn');
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${THEMES[t][1]}</svg>`;
  b.title = b.ariaLabel = 'Thème : ' + THEMES[t][0];
  if (say) toast('Thème : ' + THEMES[t][0]);
}
applyTheme(lsGet('asm-theme', 'auto'));
$('themeBtn').onclick = () => {
  const order = ['auto', 'light', 'dark'];
  const t = order[(order.indexOf(lsGet('asm-theme', 'auto')) + 1) % 3];
  lsSet('asm-theme', t); applyTheme(t, true);
};
renderBell();

// ---------- Présence : qui est sur le site en ce moment ----------
// Chaque visiteur signale seulement la page ouverte et s'il est connecté (pas de nom, pas d'adresse).
const presKey = uuid();
let presCh = null, presReady = false, presState = {};
const presHooks = new Set();   // pages qui suivent la présence (bandeau « saisit aussi ce match »)
function presPage(){
  const [p, a] = (location.hash.replace(/^#\/?/, '') || '').split('/');
  return p === 'match' || p === 'gerer' ? 'match:' + a : (p || 'accueil');
}
function presTrack(){
  if (!presCh || !presReady) return;
  // sur la page « Gérer » : le match et le prénom, pour prévenir les autres personnes qui saisissent le même match
  const [p, a] = (location.hash.replace(/^#\/?/, '') || '').split('/');
  const gerer = p === 'gerer' ? a : null;
  presCh.track({ page: presPage(), compte: !!session, uid: myId(), gerer, nom: gerer && profile ? profile.nom || null : null }).catch(() => {});
}
function startPresence(){
  presCh = sb.channel('en-ligne', { config: { presence: { key: presKey } } });
  presCh.on('presence', { event: 'sync' }, () => { presState = presCh.presenceState(); renderOnline(); presHooks.forEach(f => { try{ f(); }catch(e){} }); });
  presCh.subscribe(st => { if (st === 'SUBSCRIBED'){ presReady = true; presTrack(); } });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') presTrack(); });
// personnes en ligne : un même compte ouvert sur plusieurs écrans (téléphone + ordinateur) ne compte qu'une fois
function onlineCount(){
  const metas = Object.values(presState).map(a => (a && a[0]) || {});
  const comptes = new Set(metas.filter(m => m.compte).map(m => m.uid || '?')).size;
  return { n: comptes + metas.filter(m => !m.compte).length, comptes };
}
function renderOnline(){
  const b = $('online'); if (!b) return;
  b.hidden = !isAdmin();
  b.querySelector('span').textContent = onlineCount().n || '…';
  if (document.body.classList.contains('open') && $('onlineList')) $('onlineList').innerHTML = onlineHTML();
  renderAdminOnline();
}
function pageLabel(p){
  if (!p) return 'Autre';
  if (p.startsWith('match:')){
    const m = [...((lsGet('asm-home', null) || {}).matches || []), ...presMatches].find(x => x.id === p.slice(6));
    return m ? '⚽ ' + teamName(m, 'H') + ' – ' + teamName(m, 'A') : '⚽ un match';
  }
  return ({ accueil: 'Accueil', classements: 'Classements', stats: 'Stats joueurs', compte: 'Mon compte', admin: 'Accès', connexion: 'Connexion', nouveau: 'Nouveau match' })[p] || p;
}
// comptes en ligne : uid → pages ouvertes
function onlineUsers(){
  const u = new Map();
  Object.values(presState).forEach(a => (a || []).forEach(m => { if (m && m.uid){ if (!u.has(m.uid)) u.set(m.uid, new Set()); u.get(m.uid).add(m.page); } }));
  return u;
}
function renderAdminOnline(){
  const rows = document.querySelectorAll('.arow[data-uid]'); if (!rows.length) return;
  const u = onlineUsers();
  rows.forEach(r => {
    const pages = u.get(r.dataset.uid), el = r.querySelector('.onstate');
    r.classList.toggle('isOn', !!pages);
    if (el) el.textContent = pages ? 'En ligne · ' + [...pages].map(pageLabel).join(', ') : '';
  });
  const sum = $('accOnline');
  if (sum){ const n = [...u.keys()].filter(id => document.querySelector('.arow[data-uid="' + id + '"]')).length; sum.innerHTML = '<i></i>' + n + ' compte' + (n > 1 ? 's' : '') + ' connecté' + (n > 1 ? 's' : '') + ' en ce moment'; }
}
function onlineHTML(){
  const metas = Object.values(presState).map(a => (a && a[0]) || {});
  const { n, comptes } = onlineCount();
  const matches = [...((lsGet('asm-home', null) || {}).matches || []), ...presMatches];
  const NOMS = { accueil: 'Accueil', classements: 'Classements', stats: 'Stats joueurs', compte: 'Mon compte', admin: 'Accès', connexion: 'Connexion', nouveau: 'Nouveau match' };
  const label = p => {
    if (!p) return 'Autre';
    if (p.startsWith('match:')){ const m = matches.find(x => x.id === p.slice(6)); return m ? '⚽ ' + teamName(m, 'H') + ' – ' + teamName(m, 'A') : '⚽ Un match'; }
    return NOMS[p] || p;
  };
  const byPage = {}; metas.forEach(m => { byPage[m.page] = (byPage[m.page] || 0) + 1; });
  const rows = Object.entries(byPage).sort((a, b) => b[1] - a[1]);
  return `<div class="onbig"><b>${n}</b><span>personne${n > 1 ? 's' : ''} sur le site en ce moment</span></div>
    <p class="note" style="margin:0 0 10px">${comptes} connecté${comptes > 1 ? 's' : ''} à un compte (toi compris) · ${n - comptes} visiteur${n - comptes > 1 ? 's' : ''}</p>
    <div class="alist">${rows.map(([p, c]) => `<div class="arow"><div class="who"><b>${esc(label(p))}</b></div><span class="oncount">${c}</span></div>`).join('') || '<div class="arow">Personne</div>'}</div>`;
}
let presMatches = [];
async function openOnline(){
  // noms des matchs pas encore chargés sur ce téléphone
  const known = new Set([...((lsGet('asm-home', null) || {}).matches || []), ...presMatches].map(m => m.id));
  const ids = [...new Set(Object.values(presState).map(a => (a && a[0] || {}).page).filter(p => p && p.startsWith('match:')).map(p => p.slice(6)))].filter(id => !known.has(id));
  if (ids.length){ const { data } = await sb.from('matches').select('id,home_name,away_name').in('id', ids); presMatches.push(...(data || [])); }
  openSheet(`<h3 id="shTitle">En ligne</h3><p>Mis à jour en direct.</p><div id="onlineList">${onlineHTML()}</div>
    <button class="cancel" id="onNo">Fermer</button>`);
  $('onNo').onclick = closeSheet;
}
$('online').onclick = openOnline;

// ---------- Démarrage ----------
renderAcct();
if (sb){
  sb.auth.onAuthStateChange((ev, s) => {
    session = s;
    if (ev === 'SIGNED_OUT'){ profile = null; lsSet('asm-profile', null); renderAcct(); }
  });
  loadProfile().catch(()=>{}).finally(() => { route(); flush(); });
  // liste des équipes à jour (nouvelle catégorie ajoutée dans la base) : on réaffiche si elle a changé
  sb.from('equipes').select('*').then(({ data }) => {
    if (!data || !data.length || JSON.stringify(data) === JSON.stringify(lsGet('asm-equipes', null))) return;
    lsSet('asm-equipes', data); setEquipes(data); if (!location.hash.startsWith('#/gerer')) route();
  });
  startPresence();
} else route();

// PWA : fonctionnement hors ligne
if ('serviceWorker' in navigator) {
  // clic sur une notification alors que l'appli est déjà ouverte : aller sur la page concernée
  navigator.serviceWorker.addEventListener('message', e => {
    if (!e.data || e.data.type !== 'ouvrir') return;
    const h = new URL(e.data.url, location.href).hash || '#/';
    if (location.hash !== h) location.hash = h; else route();
  });
  navigator.serviceWorker.startMessages();
  // nouvelle version installée : l'appli se recharge toute seule (sauf pendant la saisie d'un match)
  const avaitControleur = !!navigator.serviceWorker.controller;
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitControleur || recharge) return;
    if (location.hash.startsWith('#/gerer')) return toast('Mise à jour prête : relance l\'appli après le match');
    recharge = true; location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller && location.hash.startsWith('#/gerer')) toast('Mise à jour prête : relance l\'appli');
        });
      });
      // appli restée ouverte en arrière-plan : vérifie s'il y a une nouvelle version quand on revient dessus
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(()=>{});
  });
}
