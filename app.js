// AS Mésanger – Matchs en direct
// Vue publique (liste, direct, stats) + espace délégué (saisie du match, compositions, photo de la feuille).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC } from './config.js';

const CLUB = 'AS Mésanger';
const TEAMS = [1, 2, 3, 4, 5]; // équipes seniors A à E
const teamLetter = n => 'ABCDE'[(n || 1) - 1];
const teamLabel = n => 'Seniors ' + teamLetter(n);
const clubTeamName = n => (n > 1 ? `${CLUB} ${teamLetter(n)}` : CLUB);
// Logo de chaque équipe : celui du club, ou celui de l'adversaire s'il est connu
const logoOf = (m, t) => t === (m.club_side || 'H') ? 'icons/notif-192.png' : (m.opp_logo || '');
const logoImg = (m, t, cls) => { const src = logoOf(m, t); return src ? `<img class="${cls}${t === (m.club_side || 'H') ? ' own' : ''}" src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''; };
const sb = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const $ = id => document.getElementById(id);
const view = $('view');
const LABEL = {goal:'But', sub:'Remplacement', yellow:'Carton jaune', red:'Carton rouge'};
const HALF = 45; // durée d'une mi-temps : toujours 45 min, non modifiable

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x' ? r : (r&3|8)).toString(16); }));

let tt;
function toast(msg){ const el=$('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(tt); tt=setTimeout(()=>el.classList.remove('show'),1800); }

// ---------- Feuille (bottom sheet) ----------
function openSheet(html){ $('shBody').innerHTML = html; document.body.classList.add('open'); }
function closeSheet(){ document.body.classList.remove('open'); }
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
const who = (m, t, n, none) => n ? `n°${n}${nameOf(m,t,n) ? ' ' + nameOf(m,t,n) : ''}` : none;
const rosterSorted = (m, t) => [...rosterOf(m,t)].sort((a,b)=>(+a.n)-(+b.n));

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
function periodText(m){
  if (m.status==='termine') return 'Match terminé';
  if (m.period===0) return 'Avant match';
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
  if (!evs.length) return `<div class="empty">${editable ? 'Lance le chrono puis touche une action : la minute est notée toute seule.' : 'Aucune action pour le moment.'}</div>`;
  const list = [...evs].sort((a,b)=> b.sort - a.sort || String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const ICON = {goal:'<span class="evi goal">⚽</span>', yellow:'<span class="evi"><i class="kc y"></i></span>', red:'<span class="evi"><i class="kc r"></i></span>', sub:'<span class="evi sub">⇄</span>'};
  let lastP = null, html = '';
  for (const e of list){
    if (lastP !== null && e.p !== lastP) html += '<div class="period-mark">Mi-temps</div>';
    lastP = e.p;
    let detail = '';
    if (e.k==='goal') detail = who(m,e.t,e.n,'Buteur non précisé');
    if (e.k==='sub') detail = `Sort ${who(m,e.t,e.out_n,'?')} · Entre ${who(m,e.t,e.in_n,'?')}`;
    if (e.k==='yellow'||e.k==='red') detail = who(m,e.t,e.n,'Joueur non précisé');
    const by = isAdmin() && people ? `<div class="evby">Saisi par ${esc(personName(e.created_by))}${e.created_at ? ' à ' + hhmm(e.created_at) : ''}</div>` : '';
    html += `<div class="ev ${editable ? 'edit' : 'ro'}${e.t===clubSide(m) ? ' club' : ''}" data-id="${esc(e.id)}"><div class="min">${esc(e.min)}</div>${ICON[e.k]}
      <div class="txt"><b>${LABEL[e.k]}</b> <span class="evteam">${esc(teamName(m,e.t))}</span><div>${esc(detail)}</div>${by}</div>
      ${editable ? '<button class="del" aria-label="Supprimer">×</button>' : ''}</div>`;
  }
  return html;
}

// ---------- Session / profil ----------
let session = null;
let profile = lsGet('asm-profile', null);
const isStaff = () => !!profile && (profile.role==='delegue' || profile.role==='admin');
const isAdmin = () => !!profile && profile.role==='admin';
const myId = () => session && session.user ? session.user.id : null;
// Un match avec un délégué désigné ne peut être saisi que par lui (ou un admin)
// Responsable d'équipe : compte "delegue" avec les équipes cochées par un admin (profiles.equipes)
const myTeams = () => (profile && Array.isArray(profile.equipes)) ? profile.equipes : [];
const isTeamManager = eq => isAdmin() || (isStaff() && myTeams().includes(eq || 1));
const canCreate = () => isAdmin() || (isStaff() && myTeams().length > 0);
// Peut saisir un match : admin, responsable de l'équipe, ou délégué désigné sur ce match
const canManage = m => isTeamManager(m.equipe) || (isStaff() && !!m.delegue_id && m.delegue_id === myId());
let delegues = null;
async function loadDelegues(){ if (!delegues){ const { data } = await sb.rpc('list_delegues'); delegues = data || []; } return delegues; }
function delegueOptions(cur, curNom){
  const opts = [['', 'Personne (tous les délégués)']];
  if (canCreate()) (delegues||[]).forEach(d => opts.push([d.id, d.nom]));
  else if (myId()) opts.push([myId(), 'Moi']); // (les responsables voient toute la liste, voir canCreate)
  if (cur && !opts.some(o => o[0] === cur)) opts.push([cur, curNom || 'Autre délégué']);
  return opts.map(([v, l]) => `<option value="${esc(v)}"${v === (cur||'') ? ' selected' : ''}>${esc(l)}</option>`).join('');
}
let people = null;
async function loadPeople(){
  if (!isAdmin()) return {};
  if (!people){ const { data } = await sb.from('profiles').select('id,nom,email'); people = {}; (data||[]).forEach(p => { people[p.id] = p.nom || p.email; }); }
  return people;
}
const personName = id => id ? ((people||{})[id] || 'compte supprimé') : 'import du calendrier';
const hhmm = iso => iso ? new Date(iso).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}) : '';
const delegueNom = id => !id ? null : id === myId() ? (profile && profile.nom) || 'Moi' : ((delegues||[]).find(d => d.id === id) || {}).nom || null;

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
        toast(/row-level security|42501/i.test(res.error.message + res.error.code) ? 'Refusé : seuls les délégués et admins peuvent modifier ce match' : 'Envoi refusé : ' + (res.error.message || 'erreur'));
      } else if (op.kind==='match' && res && Array.isArray(res.data) && !res.data.length){
        // la base a ignoré la modification : pas les droits sur ce match (ou match supprimé)
        toast('Refusé : seuls les délégués et admins peuvent modifier ce match');
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
  if (cleanup){ try{ cleanup(); }catch(e){} cleanup = null; }
  closeSheet();
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  const [page, arg] = parts;
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on',
    a.dataset.tab === (page === '' || page === 'match' ? 'matchs' : page)));
  $('tabs').hidden = page==='gerer' || page==='match';
  $('fab').hidden = !(canCreate() && page==='');
  window.scrollTo(0,0);
  if (!sb){ view.innerHTML = `<div class="card"><h1>Configuration à terminer</h1><p class="sub">Le site n'est pas encore relié à sa base de données (fichier config.js).</p></div>`; return; }
  try{
    if (page==='' ) return await homeView();
    if (page==='match') return await matchView(arg);
    if (page==='gerer') return await consoleView(arg, parts[2]==='compo');
    if (page==='nouveau') return await newMatchView();
    if (page==='stats') return await statsView();
    if (page==='classements') return await classementsView();
    if (page==='connexion') return loginView();
    if (page==='compte') return accountView();
    if (page==='admin') return await adminView();
    location.hash = '#/';
  }catch(e){
    console.error(e);
    view.innerHTML = `<div class="empty">Impossible de charger la page${navigator.onLine ? '' : ' (pas de réseau)'}.<br><button class="link" onclick="location.reload()">Réessayer</button></div>`;
  }
}
window.addEventListener('hashchange', route);

function liveChannel(name, onChange, filters){
  const ch = sb.channel(name + '-' + Math.random().toString(36).slice(2));
  filters.forEach(f => ch.on('postgres_changes', {schema:'public', ...f}, onChange));
  ch.subscribe();
  return () => sb.removeChannel(ch);
}
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
    drawHome(matches, g||[]);
  };
  await load();
  const reload = debounce(load, 400);
  const off = liveChannel('home', reload, [{event:'*', table:'matches'}, {event:'*', table:'events'}]);
  const tick = setInterval(() => document.querySelectorAll('[data-live]').forEach(el => {
    const m = JSON.parse(el.dataset.live); el.textContent = m.status==='direct' && m.period ? 'Direct · ' + currentMinute(m).label : 'Direct';
  }), 5000);
  const vis = () => { if (document.visibilityState==='visible') reload(); };
  document.addEventListener('visibilitychange', vis);
  cleanup = () => { off(); clearInterval(tick); document.removeEventListener('visibilitychange', vis); };
}
let homeTeam = lsGet('asm-team', 0), showAllNext = false;
function drawHome(matches, goalRows){
  const byMatch = {};
  goalRows.forEach(g => { (byMatch[g.match_id] ||= []).push({k:'goal', t:g.t}); });
  const card = m => {
    const evs = byMatch[m.id] || [];
    const c = clubSide(m);
    let badge = '', mid;
    if (m.status==='prevu') mid = `<span class="mtime">${esc(hhmm(m.kickoff))}</span>`;
    else mid = `<span class="msc">${goals(evs,'H')}<i>–</i>${goals(evs,'A')}</span>`;
    if (m.status==='direct') badge = `<span class="badge live" data-live='${esc(JSON.stringify({status:m.status,period:m.period,half:m.half,running:m.running,started_at:m.started_at,acc:m.acc}))}'>Direct${m.period ? ' · ' + esc(currentMinute(m).label) : ''}</span>`;
    else if (m.status==='termine'){ const r = resultOf(m, evs); badge = `<span class="badge ${r==='V'?'w':r==='D'?'l':''}">${r==='V'?'Victoire':r==='D'?'Défaite':'Nul'}</span>`; }
    const side = t => `<div class="mside${c===t?' club':''}">${logoOf(m,t) ? logoImg(m,t,'mlg') : '<span class="mlg ph"></span>'}<span>${esc(teamName(m,t))}</span></div>`;
    return `<a class="mcard${m.status==='direct' ? ' live' : ''}" href="#/match/${esc(m.id)}">
      <div class="mtop"><span class="tchip" title="${esc(teamLabel(m.equipe))}">${teamLetter(m.equipe)}</span><span class="mcomp">${esc(m.competition || teamLabel(m.equipe))}</span>${canManage(m) ? `<span class="gerer" role="link" tabindex="0" data-href="#/gerer/${esc(m.id)}" aria-label="Gérer ce match">✎ Gérer</span>` : ''}${badge}</div>
      <div class="mrow">${side('H')}<div class="mmid">${mid}</div>${side('A')}</div>
      ${isStaff() && m.delegue_nom ? `<div class="mdel">Délégué : ${esc(m.delegue_nom)}</div>` : ''}</a>`;
  };
  const byDay = list => { let h = '', last = ''; list.forEach(m => { const d = new Date(m.kickoff).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'}); if (d !== last){ h += `<div class="day">${esc(d)}</div>`; last = d; } h += card(m); }); return h; };
  const all = matches;
  matches = homeTeam ? matches.filter(m => (m.equipe||1) === homeTeam) : matches;
  const live = matches.filter(m=>m.status==='direct');
  const next = matches.filter(m=>m.status==='prevu').sort((a,b)=>a.kickoff.localeCompare(b.kickoff));
  const done = matches.filter(m=>m.status==='termine');
  let html = `<div class="chipbar" role="group" aria-label="Équipe">${[0, ...TEAMS].map(n => `<button data-team="${n}" class="${homeTeam===n?'on':''}" aria-pressed="${homeTeam===n}">${n ? 'Seniors ' + teamLetter(n) : 'Toutes'}</button>`).join('')}</div>`;
  const mine = myId() ? all.filter(m => m.delegue_id === myId() && m.status !== 'termine').sort((a,b)=>a.kickoff.localeCompare(b.kickoff)) : [];
  if (mine.length) html += `<div class="sec">Mes matchs (délégué)</div>` + byDay(mine);
  if (live.length) html += `<div class="sec">En direct</div>` + live.map(card).join('');
  const NEXT_MAX = 6;
  if (next.length) html += `<div class="sec">À venir</div>` + byDay(showAllNext ? next : next.slice(0, NEXT_MAX))
    + (next.length > NEXT_MAX && !showAllNext ? `<button class="fbtn" id="moreNext" style="width:100%">Voir les ${next.length} matchs à venir</button>` : '');
  if (done.length) html += `<div class="sec">Résultats</div>` + byDay(done);
  if (!matches.length) html += `<div class="empty" style="margin-top:12px">Aucun match pour l'instant.${isStaff() ? '' : ' Reviens le jour du match pour le suivre en direct.'}</div>`;
  view.innerHTML = html;
  view.querySelectorAll('[data-team]').forEach(b => b.onclick = () => { homeTeam = +b.dataset.team; lsSet('asm-team', homeTeam); showAllNext = false; drawHome(all, goalRows); });
  view.querySelectorAll('.gerer').forEach(g => {
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
  return { m, evs: evs || [] };
}
function boardHTML(m, evs, staff){
  const c = clubSide(m);
  return `<section class="board" aria-label="Tableau d'affichage">
    <div class="bmeta"><span>${esc(teamLabel(m.equipe))} · ${esc(fmtDate(m.kickoff))}${m.competition ? ' · ' + esc(m.competition) : ''}</span>${m.status==='direct' ? '<span class="badge live">Direct</span>' : ''}</div>
    <div class="teams">
      <div class="team">${logoImg(m,'H','blg')}<span class="tname${c==='H'?' club':''}">${esc(teamName(m,'H'))}</span></div>
      <div class="score" aria-live="polite"><span id="scH">${goals(evs,'H')}</span><span class="sep">–</span><span id="scA">${goals(evs,'A')}</span></div>
      <div class="team">${logoImg(m,'A','blg')}<span class="tname${c==='A'?' club':''}">${esc(teamName(m,'A'))}</span></div>
    </div>
    <div class="clockrow">
      <div>${staff ? `<button class="clock" id="clock" aria-label="Régler le chrono">${clockText(m)}</button>` : `<div class="clock" id="clock">${m.status==='prevu' ? '--:--' : clockText(m)}</div>`}<div class="period" id="period">${esc(periodText(m))}</div></div>
      ${staff ? `<div class="clockbtns"><button class="cbtn ghost" id="btnPeriod"></button><button class="cbtn" id="btnClock"></button></div>` : ''}
    </div>
  </section>`;
}
function lineupsHTML(m){
  const li = p => `<li><b>${esc(p.n)}</b><span>${esc(p.name)}</span></li>`;
  const side = t => {
    const list = rosterSorted(m,t);
    if (!list.length) return `<div><h3>${esc(teamName(m,t))}</h3><p class="nolu">Pas encore saisie</p></div>`;
    const tit = list.filter(p=>!p.sub), rem = list.filter(p=>p.sub);
    return `<div><h3>${esc(teamName(m,t))}</h3>`
      + (tit.length ? `<div class="lusub">Titulaires</div><ol>${tit.map(li).join('')}</ol>` : '')
      + (rem.length ? `<div class="lusub">Remplaçants</div><ol class="bench">${rem.map(li).join('')}</ol>` : '')
      + '</div>';
  };
  const has = rosterOf(m,'H').length || rosterOf(m,'A').length;
  if (!has && !canManage(m)) return '';
  return `<section class="log"><div class="loghead"><h2>Compositions</h2>${canManage(m) ? `<a class="link" href="#/gerer/${esc(m.id)}/compo">${has ? 'Modifier' : '📋 Saisir la compo'}</a>` : ''}</div>`
    + (has ? `<div class="lineups">${side('H')}${side('A')}</div>` : '<div class="empty">Compo pas encore saisie.</div>')
    + '</section>';
}
async function matchView(id){
  view.innerHTML = '<div class="loading">Chargement…</div>';
  if (isStaff()) await loadDelegues().catch(()=>{});
  if (isAdmin()) await loadPeople().catch(()=>{});
  let { m, evs } = await fetchMatch(id);
  if (!m){ view.innerHTML = '<div class="empty">Ce match n\'existe plus.</div>'; return; }
  const draw = () => {
    view.innerHTML = `<a class="back" href="#/">← Tous les matchs</a>` + boardHTML(m, evs, false)
      + `<div class="mactions"><button class="pill" id="btnBell">🔔 Buts des ${esc(teamLabel(m.equipe))}</button><button class="pill" id="btnShareLive">↗ Partager</button></div>`
      + (canManage(m) ? `<a class="fbtn primary big" href="#/gerer/${esc(m.id)}">Gérer ce match</a>` : '')
      + (isStaff() ? `<label class="field deleg"><span>Délégué du match</span><select id="delSel"${canManage(m) ? '' : ' disabled'}>${delegueOptions(m.delegue_id, m.delegue_nom)}</select>${!canManage(m) ? '<small>Seuls le responsable de l’équipe, le délégué désigné ou un admin peuvent modifier ce match.</small>' : ''}</label>` : '')
      + (isAdmin() && people ? `<div class="audit">Match créé par ${esc(personName(m.created_by))}${m.rosters_at ? ` · Compo saisie par ${esc(personName(m.rosters_by))} le ${esc(fmtDate(m.rosters_at))}` : ''}</div>` : '')
      + (m.status==='prevu' ? lineupsHTML(m) : '')
      + `<section class="log"><div class="loghead"><h2>Chronologie</h2></div><div id="events">${timelineHTML(m, evs, false)}</div></section>`
      + (m.status!=='prevu' ? lineupsHTML(m) : '');
    $('btnShareLive').onclick = () => shareLink(m);
    $('btnBell').onclick = () => openBell(m.equipe || 1);
    const ds = $('delSel');
    if (ds) ds.onchange = async () => {
      const id = ds.value || null;
      const { data: upd, error } = await sb.from('matches').update({delegue_id: id, delegue_nom: delegueNom(id)}).eq('id', m.id).select('id');
      if (error || !upd || !upd.length){ toast(isNetErr(error) ? 'Pas de réseau' : 'Modification refusée'); ds.value = m.delegue_id || ''; return; }
      m.delegue_id = id; m.delegue_nom = delegueNom(id); toast(id ? 'Délégué : ' + m.delegue_nom : 'Aucun délégué désigné'); draw();
    };
    document.title = `${teamName(m,'H')} ${goals(evs,'H')}–${goals(evs,'A')} ${teamName(m,'A')} · AS Mésanger`;
  };
  draw();
  const reload = debounce(async () => { try{ const r = await fetchMatch(id); if (r.m){ m = r.m; evs = r.evs; draw(); } }catch(e){} }, 300);
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
  const poll = setInterval(reload, 30000); // filet de sécurité si le temps réel décroche
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
  let side = 'H', equipe = TEAMS_OK.includes(homeTeam) ? homeTeam : TEAMS_OK[0];
  view.innerHTML = `<form class="card" id="nf">
    <h1>Nouveau match</h1><p class="sub">Deux mi-temps de 45 min.</p>
    <label class="field"><span>Adversaire</span><input id="nfOpp" required autocomplete="off" placeholder="Nom de l'équipe adverse"></label>
    <div class="field"><span>Équipe</span><div class="seg" id="nfTeam">${TEAMS_OK.map(n=>`<button type="button" data-e="${n}" class="${n===equipe?'on':''}">${teamLetter(n)}</button>`).join('')}</div></div>
    <div class="field"><span>Lieu</span><div class="seg" id="nfSide"><button type="button" data-s="H" class="on">Domicile</button><button type="button" data-s="A">Extérieur</button></div></div>
    <label class="field"><span>Date et heure du coup d'envoi</span><input id="nfDate" type="datetime-local" value="${local}" required></label>
    <label class="field"><span>Compétition</span><input id="nfComp" autocomplete="off" placeholder="Championnat, Coupe…" list="compList"><datalist id="compList"></datalist></label>
    <label class="field"><span>Délégué du match</span><select id="nfDel">${delegueOptions(isAdmin() ? '' : myId())}</select><small>Si un délégué est choisi, lui seul (et les admins) pourra saisir le match.</small></label>
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
  $('nf').onsubmit = async ev => {
    ev.preventDefault();
    const opp = $('nfOpp').value.trim(); if (!opp) return;
    $('nfGo').disabled = true;
    const row = {
      id: uuid(), kickoff: new Date($('nfDate').value).toISOString(), competition: $('nfComp').value.trim(),
      equipe, delegue_id: $('nfDel').value || null, delegue_nom: delegueNom($('nfDel').value || null), club_side: side, home_name: side==='H' ? clubTeamName(equipe) : opp, away_name: side==='H' ? opp : clubTeamName(equipe), half: HALF
    };
    const { error } = await sb.from('matches').insert(row);
    if (error){ $('nfGo').disabled = false; $('nfMsg').innerHTML = `<div class="msg err">${esc(isNetErr(error) ? 'Pas de réseau : il faut être connecté pour créer le match.' : error.message)}</div>`; return; }
    location.hash = '#/gerer/' + row.id;
  };
}

// ---------- Console du délégué ----------
async function consoleView(id, openCompo){
  if (isAdmin()) await loadPeople().catch(()=>{});
  if (!isStaff()){ location.hash = session ? '#/compte' : '#/connexion'; return; }
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
    view.innerHTML = `<div class="card"><h1>Tu ne gères pas ce match</h1><p class="sub">Ce match des ${esc(teamLabel(S.equipe))} peut être saisi par le responsable de l’équipe${S.delegue_nom ? `, par ${esc(S.delegue_nom)} (délégué désigné)` : ''} ou par un admin.</p><a class="fbtn" href="#/match/${esc(id)}" style="width:100%">Voir le direct</a></div>`;
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
    <div class="syncrow"><span class="sync" id="sync">Envoyé</span><button class="link" id="btnShareLive" style="padding:0">Partager le direct</button></div>
    <section class="actions">
      ${['H','A'].map(t => `<div class="col ${t===clubSide(S)?'home':'away'}">
        <h2>${esc(teamName(S,t))}</h2>
        <button class="act goal" data-t="${t}" data-k="goal">But</button>
        <button class="act" data-t="${t}" data-k="sub"><span class="ic sub">⇄</span>Remplacement</button>
        <button class="act" data-t="${t}" data-k="yellow"><span class="ic y"></span>Carton jaune</button>
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
    bc.textContent = S.running ? 'Pause' : (S.period===0 ? 'Lancer' : 'Reprendre');
    bp.hidden = S.period===0;
    bp.textContent = S.status==='termine' ? 'Rouvrir' : S.period===1 ? '2e mi-temps' : 'Fin du match';
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
  function bindClock(){
    $('btnClock').onclick = () => {
      const f = {};
      if (S.period===0){ f.period = 1; f.status = 'direct'; }
      if (S.running){ f.acc = (+S.acc) + Date.now() - (+S.started_at); f.running = false; }
      else { f.started_at = Date.now(); f.running = true; }
      patch(f); renderClock();
    };
    $('btnPeriod').onclick = () => {
      if (S.status==='termine') return askConfirm('Rouvrir le match', 'Le match repasse en direct pour corriger ou reprendre.', 'Rouvrir', () => { patch({status:'direct'}); render(); });
      if (S.period===1) return askConfirm('2e mi-temps', 'Le chrono repartira de ' + S.half + ':00. Touche Reprendre au coup d\'envoi.', 'Passer en 2e mi-temps', () => {
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
  function askNumber(title, sub, minLabel, cb, t, choices){
    let val = '';
    const chips = (choices||[]).map(p=>`<button class="chip${p.bench?' bench':''}" data-c="${esc(p.n)}"><b>${esc(p.n)}</b><span>${esc(p.name)}</span></button>`).join('');
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
      <div class="minrow"><label for="minEdit">Minute</label><input id="minEdit" value="${esc(minLabel)}"></div>
      <button class="cancel" id="cancel">Annuler</button>`);
    const disp = $('disp');
    const done = v => { const m = $('minEdit').value.trim() || minLabel; closeSheet(); cb(v, m); };
    const upd = () => { disp.textContent = val || 'Numéro du joueur'; disp.classList.toggle('empty-n', !val); $('pname').textContent = val ? nameOf(S,t,val) : ''; };
    $('shBody').querySelectorAll('.chip').forEach(c => c.onclick = () => done(c.dataset.c));
    $('shBody').querySelectorAll('.key').forEach(k => k.onclick = () => {
      const n = k.dataset.n;
      if (n==='back') val = val.slice(0,-1);
      else if (n==='ok') { done(val ? String(+val) : ''); return; }
      else if (val.length < 3) val += n;
      upd();
    });
    $('cancel').onclick = closeSheet;
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
  function add(e){
    e.id = uuid(); e.p = S.period || 1; e.created_at = new Date().toISOString(); e.created_by = myId();
    e.sort = sortFromLabel(e.min, e.sort);
    if (S.status==='prevu') patch({status:'direct', period: S.period || 1});
    S.events.push(e); pushEv(e);
    if (e.k==='goal') queue({kind:'notify', match:id, id:e.id});
    render();
    toast(`${LABEL[e.k]} noté · ${e.min}`);
  }
  view.querySelectorAll('.act').forEach(b => b.onclick = () => {
    const t = b.dataset.t, k = b.dataset.k, cm = currentMinute(S), tn = teamName(S,t);
    if (k === 'sub'){
      const pitch = onPitch(t), off = sentOff(t);
      const onField = rosterSorted(S,t).filter(p=>pitch.has(p.n));
      const bench = rosterSorted(S,t).filter(p=>!pitch.has(p.n) && !off.has(p.n)).map(p=>({...p, bench:true}));
      askNumber('Joueur qui sort', tn, cm.label, (out, min) => {
        askNumber('Joueur qui entre', `${tn} · remplace ${who(S,t,out,'?')}`, min, (inn, min2) => {
          add({t, k, out_n:out, in_n:inn, min:min2, sort:cm.sort});
        }, t, bench);
      }, t, onField);
    } else {
      const pitch = onPitch(t);
      const list = rosterSorted(S,t).map(p => pitch.has(p.n) ? p : {...p, bench:true});
      askNumber(LABEL[k], tn, cm.label, (n, min) => add({t, k, n, min, sort:cm.sort}), t, k==='goal' ? list.filter(p=>!p.bench) : list);
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
    const grouped = t => { const l = rosterSorted(S,t).map(p=>({...p})); return [...l.filter(p=>!p.sub), ...l.filter(p=>p.sub)]; };
    const ed = {H: grouped('H'), A: grouped('A')};
    let cur = order[0], paste = false, errs = new Set(), msg = '';
    const counts = t => { const tit = ed[t].filter(p=>!p.sub).length; return {tit, rem: ed[t].length - tit}; };
    const nextNum = t => { const used = new Set(ed[t].map(p=>+p.n).filter(Boolean)); let n = 1; while (used.has(n)) n++; return String(n); };
    const addPlayer = (t, p) => ed[t].push({
      n: p.n && !ed[t].some(x => x.n === String(p.n)) ? String(p.n) : nextNum(t),
      name: p.name || '',
      sub: p.sub !== undefined ? p.sub : counts(t).tit >= 11
    });
    const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

    function draw(focusLast){
      const c = counts(cur);
      const inList = new Set(ed[cur].map(p => playerKey(p.name)));
      const sugg = cur === clubSide(S) ? (pastPlayers || []).filter(p => !inList.has(playerKey(p.name))) : [];
      openSheet(`<h3 id="shTitle">Compositions</h3>
        <div class="seg luteams">${order.map(t => `<button type="button" data-t="${t}" class="${t===cur?'on':''}">${esc(teamName(S,t))} · ${ed[t].length}</button>`).join('')}</div>
        <div class="lubar"><span><b>${plural(c.tit, 'titulaire')}</b> · ${plural(c.rem, 'remplaçant')}</span>
          <span class="lutools"><button type="button" class="photo" id="luPhoto">📷 Photo</button><button type="button" class="photo" id="luPaste">${paste ? 'Fermer' : 'Coller'}</button></span></div>
        <input type="file" accept="image/*" capture="environment" id="luFile" hidden>
        <div class="ocrstat" id="luStat"></div>
        ${paste ? `<textarea id="luText" placeholder="10 DUPONT Lucas&#10;7 MARTIN Hugo&#10;14 BERNARD Léo R"></textarea>
          <button type="button" class="fbtn" id="luParse" style="width:100%;margin:6px 0 10px">Ajouter ces joueurs</button>` : ''}
        <div class="lurows">${ed[cur].map((p, i) => `<div class="lrow${p.sub ? ' sub' : ''}${errs.has(cur + i) ? ' err' : ''}" data-i="${i}">
            <input class="ln" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${esc(p.n)}" aria-label="Numéro">
            <input class="lname" value="${esc(p.name)}" placeholder="Nom Prénom" autocomplete="off" enterkeyhint="next" list="luNames" aria-label="Nom du joueur">
            <button type="button" class="ltog" aria-label="Titulaire ou remplaçant">${p.sub ? 'Remp.' : 'Titul.'}</button>
            <button type="button" class="ldel" aria-label="Retirer ce joueur">×</button></div>`).join('')
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
        nm.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); addPlayer(cur, {}); draw(true); } };
        row.querySelector('.ltog').onclick = () => { p.sub = !p.sub; draw(); };
        row.querySelector('.ldel').onclick = () => { ed[cur].splice(i, 1); errs.clear(); draw(); };
      });
      $('luAdd').onclick = () => { addPlayer(cur, {}); draw(true); };
      body.querySelectorAll('.lusug button').forEach(b => b.onclick = () => { addPlayer(cur, sugg[+b.dataset.j]); draw(); });
      $('luPaste').onclick = () => { paste = !paste; draw(); if (paste) $('luText').focus(); };
      if (paste) $('luParse').onclick = () => { parse($('luText').value).forEach(p => addPlayer(cur, p)); paste = false; draw(); };
      $('luPhoto').onclick = () => $('luFile').click();
      $('luFile').onchange = async ev => {
        const file = ev.target.files[0]; ev.target.value = '';
        if (file) await readSheetPhoto(file, $('luStat'), found => { const t = cur; found.forEach(p => addPlayer(t, p)); draw(); $('luStat').textContent = `${plural(found.length, 'joueur')} ajouté${found.length > 1 ? 's' : ''} depuis la photo. Vérifie les noms et les remplaçants.`; });
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
          if (!p.n || !p.name){ errs.add(t + i); msg = msg || `${teamName(S,t)} : il manque un numéro ou un nom.`; }
          else if (seen[p.n] !== undefined){ errs.add(t + i); errs.add(t + seen[p.n]); msg = msg || `${teamName(S,t)} : le n°${p.n} est utilisé deux fois.`; }
          else seen[p.n] = i;
        });
        out[t] = [...ed[t].filter(p=>!p.sub), ...ed[t].filter(p=>p.sub)].map(p => ({n:p.n, name:p.name, sub:!!p.sub}));
      }
      if (errs.size){ cur = [...errs][0][0]; draw(); return; }
      patch({rosters: out}); closeSheet(); render(); toast('Compositions enregistrées');
    }

    draw();
    if (!pastPlayers) loadPastPlayers().then(() => { if (document.body.classList.contains('open') && $('luAdd')) draw(); });
  }
  $('btnLineup').onclick = openLineupEditor;

  // Récapitulatif (WhatsApp, feuille officielle)
  function recapText(){
    const ev = [...S.events].sort((a,b)=>a.sort-b.sort);
    const ICON = {goal:'⚽', sub:'🔄', yellow:'🟨', red:'🟥'};
    const TITLE = {goal:'Buts', sub:'Remplacements', yellow:'Cartons jaunes', red:'Cartons rouges'};
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
}

// ---------- Lecture de la photo de la feuille de match (dans le téléphone, gratuit) ----------
function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('script')); document.head.appendChild(s); });
}
async function prepImage(file){
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width*scale), h = Math.round(bmp.height*scale);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4){ const g = d[i]*.299 + d[i+1]*.587 + d[i+2]*.114; d[i] = g; if (g<lo) lo=g; if (g>hi) hi=g; }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4){ const g = Math.min(255, Math.max(0, (d[i]-lo)*255/span)); d[i] = d[i+1] = d[i+2] = g; }
  ctx.putImageData(img, 0, 0);
  return cv;
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
async function readSheetPhoto(file, stat, onFound){
  if (!navigator.onLine && !window.Tesseract){ stat.textContent = 'La lecture de photo a besoin du réseau la première fois.'; return; }
  try{
    stat.textContent = 'Préparation de la photo…';
    const [cv] = await Promise.all([prepImage(file), window.Tesseract ? null : loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js')]);
    stat.textContent = 'Lecture en cours… (la première fois peut prendre 20 s)';
    const { data } = await window.Tesseract.recognize(cv, 'fra', {
      logger: m => { if (m.status==='recognizing text') stat.textContent = `Lecture en cours… ${Math.round(m.progress*100)} %`; }
    });
    const found = parseSheet(data.text || '');
    if (!found.length){ stat.textContent = 'Aucun joueur reconnu. Reprends la photo bien à plat, en cadrant seulement la liste de l\'équipe.'; return; }
    onFound(found);
  }catch(e){
    console.error(e);
    stat.textContent = 'La lecture a échoué. Tu peux taper les joueurs à la main.';
  }
}

// ---------- Classements (recopiés depuis la FFF) ----------
// Ligne : [rang, équipe, pts, joués, gagnés, nuls, perdus, buts pour, buts contre, diff, code club FFF]
const CLUB_FFF = '516995';
let clsTeam = 0;
async function classementsView(){
  let rows = lsGet('asm-cls', null), maj = null;
  if (!rows) view.innerHTML = '<div class="loading">Chargement…</div>';
  try{
    const { data, error } = await sb.from('classements').select('*').order('equipe');
    if (error) throw error;
    rows = data; lsSet('asm-cls', data);
    if (isAdmin()){ const r2 = await sb.from('classements_maj').select('*').maybeSingle(); maj = r2.data; }
  }catch(e){ if (!rows) throw e; }
  const byTeam = {}; (rows || []).forEach(r => { byTeam[r.equipe] = r; });
  const rankOf = n => { const r = byTeam[n]; const l = r && r.lignes.find(x => x[10] === CLUB_FFF); return l ? l[0] : null; };
  const draw = () => {
    const cur = clsTeam || homeTeam || 1, r = byTeam[cur];
    const chips = `<div class="chipbar" role="group" aria-label="Équipe">${TEAMS.map(n => { const k = rankOf(n); return `<button data-cls="${n}" class="${n===cur?'on':''}" aria-pressed="${n===cur}">Seniors ${teamLetter(n)}${k ? ` · ${k}${k===1?'er':'e'}` : ''}</button>`; }).join('')}</div>`;
    if (!r){ view.innerHTML = chips + '<div class="empty">Classement pas encore disponible pour cette équipe.</div>'; bind(); return; }
    const d = new Date(r.updated_at).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
    view.innerHTML = chips + `
      <div class="clshead"><h2>${esc(teamLabel(cur))}</h2><span>${esc(r.competition)}</span></div>
      <div class="tblwrap"><table class="cls">
        <thead><tr><th>#</th><th>Équipe</th><th>Pts</th><th>J</th><th>G</th><th>N</th><th>P</th><th>Diff</th></tr></thead>
        <tbody>${r.lignes.map(l => `<tr class="${l[10]===CLUB_FFF ? 'me' : ''}">
          <td class="rk">${l[0]}</td>
          <td class="tm"><div class="tmi">${l[10] ? `<img src="https://cdn-transverse.azureedge.net/phlogos/BC${esc(l[10])}.jpg" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${esc(l[1])}</span></div></td>
          <td class="pts">${l[2]}</td><td>${l[3]}</td><td>${l[4]}</td><td>${l[5]}</td><td>${l[6]}</td><td>${l[9] > 0 ? '+' + l[9] : l[9]}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="note">Mis à jour le ${esc(d)}, d’après le site de la FFF (classement sous réserve de procédures en cours). ${r.source ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">Voir le classement officiel ↗</a>` : ''}</p>` + majHTML();
    bind();
  };
  // Bouton admin : la mise à jour est faite par la tâche programmée du PC du club (la FFF bloque les accès automatiques)
  const majHTML = () => {
    if (!isAdmin()) return '';
    const enAttente = maj && maj.demande_at && (!maj.fait_at || new Date(maj.demande_at) > new Date(maj.fait_at));
    return `<div class="majbox">${enAttente
      ? `<b>Mise à jour demandée</b> par ${esc(maj.demande_par || '?')} à ${esc(hhmm(maj.demande_at))}. Elle se fait dans l’heure qui suit, dès que l’ordinateur de Tristan est allumé avec Claude ouvert.`
      : 'Les classements se mettent à jour tout seuls toutes les heures le lundi (quand l’ordinateur de Tristan est allumé avec Claude ouvert).'}
      <button class="fbtn" id="majBtn" style="width:100%;margin-top:10px"${enAttente ? ' disabled' : ''}>${enAttente ? 'Mise à jour en attente…' : '↻ Mettre à jour les classements'}</button></div>`;
  };
  const bind = () => {
    view.querySelectorAll('[data-cls]').forEach(b => b.onclick = () => { clsTeam = +b.dataset.cls; draw(); });
    const mb = $('majBtn');
    if (mb) mb.onclick = async () => {
      mb.disabled = true;
      const { error } = await sb.rpc('demander_maj_classements');
      if (error){ mb.disabled = false; toast(isNetErr(error) ? 'Pas de réseau' : 'Demande refusée'); return; }
      const r2 = await sb.from('classements_maj').select('*').maybeSingle(); maj = r2.data;
      toast('Demande envoyée'); draw();
    };
  };
  draw();
}

// ---------- Stats joueurs ----------
let statSort = {key:'goals', dir:-1}, statSeason = null, statTeam = 0;
function playerKey(name){
  return name.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z ]/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
}
async function statsView(){
  view.innerHTML = '<div class="loading">Chargement…</div>';
  const [{ data: ms, error }, { data: evs, error: e2 }] = await Promise.all([
    sb.from('matches').select('id,kickoff,equipe,club_side,rosters,status').neq('status','prevu'),
    sb.from('events').select('match_id,t,k,n,in_n')
  ]);
  if (error || e2) throw (error || e2);
  const seasons = [...new Set(ms.map(m=>seasonOf(m.kickoff)))].sort().reverse();
  if (!statSeason || !seasons.includes(statSeason)) statSeason = seasons[0] || null;
  const draw = () => {
    const list = ms.filter(m => seasonOf(m.kickoff)===statSeason && (!statTeam || (m.equipe||1)===statTeam));
    const ids = new Set(list.map(m=>m.id));
    const byMatch = {}; evs.forEach(e => { if (ids.has(e.match_id)) (byMatch[e.match_id] ||= []).push(e); });
    const P = {}; let unknownGoals = 0;
    const get = name => { const k = playerKey(name); return P[k] ||= {name, mj:0, tit:0, goals:0, y:0, r:0}; };
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
      played.forEach(k => { if (P[k]) P[k].mj++; });
      me.filter(e=>e.t===c && e.k!=='sub').forEach(e => {
        const x = e.n ? nm(e.n) : null;
        if (!x){ if (e.k==='goal') unknownGoals++; return; }
        const s = get(x); if (e.k==='goal') s.goals++; if (e.k==='yellow') s.y++; if (e.k==='red') s.r++;
      });
    }
    const rows = Object.values(P).sort((a,b) => {
      const k = statSort.key;
      if (k==='name') return statSort.dir * a.name.localeCompare(b.name, 'fr');
      return statSort.dir * (a[k]-b[k]) || b.goals-a.goals || b.mj-a.mj || a.name.localeCompare(b.name,'fr');
    });
    const COLS = [['name','Joueur'],['mj','Matchs'],['tit','Titul.'],['goals','Buts'],['y','🟨'],['r','🟥']];
    const cell = (v) => `<td class="${v?'':'zero'}">${v}</td>`;
    view.innerHTML = `
      <div class="seasons">${seasons.length > 1 ? `<label>Saison <select id="season">${seasons.map(s=>`<option${s===statSeason?' selected':''}>${s}</option>`).join('')}</select></label> ` : (statSeason ? `<b>Saison ${statSeason}</b> ` : '')}<label>Équipe <select id="steam"><option value="0">Toutes</option>${TEAMS.map(n=>`<option value="${n}"${statTeam===n?' selected':''}>Seniors ${teamLetter(n)}</option>`).join('')}</select></label></div>
      <div class="kpis">
        <div class="kpi"><b>${list.length}</b><span>Matchs</span></div>
        <div class="kpi"><b>${W}-${D}-${L}</b><span>V-N-D</span></div>
        <div class="kpi"><b>${gf}</b><span>Buts marqués</span></div>
        <div class="kpi"><b>${ga}</b><span>Encaissés</span></div>
      </div>
      ${rows.length ? `<div class="tblwrap"><table class="stats"><thead><tr>${COLS.map(([k,l])=>`<th class="${statSort.key===k?'on':''}" aria-sort="${statSort.key===k?(statSort.dir<0?'descending':'ascending'):'none'}"><button data-k="${k}">${l}${statSort.key===k?(statSort.dir<0?' ▾':' ▴'):''}</button></th>`).join('')}</tr></thead>
        <tbody>${rows.map(p=>`<tr><td>${esc(p.name)}</td>${cell(p.mj)}${cell(p.tit)}${cell(p.goals)}${cell(p.y)}${cell(p.r)}</tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">Les stats apparaîtront après le premier match dont la composition de l'${CLUB} a été saisie.</div>`}
      <p class="note">Stats des joueurs de l'${CLUB}, calculées à partir des compositions et de la chronologie de chaque match.${unknownGoals ? ` ${unknownGoals} but${unknownGoals>1?'s':''} sans buteur identifié.` : ''}</p>`;
    view.querySelectorAll('th button').forEach(b => b.onclick = () => {
      const k = b.dataset.k; statSort = statSort.key===k ? {key:k, dir:-statSort.dir} : {key:k, dir: k==='name' ? 1 : -1}; draw();
    });
    const s = $('season'); if (s) s.onchange = () => { statSeason = s.value; draw(); };
    $('steam').onchange = e => { statTeam = +e.target.value; draw(); };
  };
  draw();
}

// ---------- Connexion / compte ----------
function loginView(){
  if (session){ location.hash = '#/compte'; return; }
  let mode = 'in';
  const draw = (msg='') => {
    view.innerHTML = `<form class="card" id="lf">
      <h1>${mode==='in' ? 'Connexion' : 'Créer un compte'}</h1>
      <p class="sub">Réservé aux délégués du club pour saisir les matchs. Pas besoin de compte pour suivre les matchs.</p>
      ${msg}
      ${mode==='up' ? `<label class="field"><span>Prénom et nom</span><input id="lfNom" required autocomplete="name"></label>` : ''}
      <label class="field"><span>Email</span><input id="lfMail" type="email" required autocomplete="email"></label>
      <label class="field"><span>Mot de passe</span><input id="lfPw" type="password" required minlength="6" autocomplete="${mode==='in'?'current-password':'new-password'}">${mode==='up' ? '<small>6 caractères minimum.</small>' : ''}</label>
      <div class="foot" style="margin-top:4px"><button class="fbtn primary" id="lfGo">${mode==='in' ? 'Se connecter' : 'Créer mon compte'}</button></div>
      <button type="button" class="link" id="lfSwitch">${mode==='in' ? 'Pas encore de compte ? Créer un compte' : 'Déjà un compte ? Se connecter'}</button>
    </form>`;
    $('lfSwitch').onclick = () => { mode = mode==='in' ? 'up' : 'in'; draw(); };
    $('lf').onsubmit = async ev => {
      ev.preventDefault();
      $('lfGo').disabled = true;
      const email = $('lfMail').value.trim(), password = $('lfPw').value;
      let res;
      if (mode==='in') res = await sb.auth.signInWithPassword({email, password});
      else res = await sb.auth.signUp({email, password, options:{data:{nom: $('lfNom').value.trim()}}});
      if (res.error){
        const m = /invalid login/i.test(res.error.message) ? 'Email ou mot de passe incorrect.' : /already registered/i.test(res.error.message) ? 'Un compte existe déjà avec cet email.' : res.error.message;
        return draw(`<div class="msg err">${esc(m)}</div>`);
      }
      if (!res.data.session) return draw('<div class="msg">Compte créé. Confirme ton adresse avec le lien reçu par email, puis connecte-toi.</div>');
      if (mode === 'up'){
        // prévient les admins (une seule fois par compte, contrôlé par la base)
        fetch('api/notify-signup', { method: 'POST', keepalive: true, headers: { Authorization: 'Bearer ' + res.data.session.access_token } }).catch(() => {});
      }
      await loadProfile();
      location.hash = isStaff() ? '#/' : '#/compte';
    };
  };
  draw();
}
function accountView(){
  if (!session){ location.hash = '#/connexion'; return; }
  const ROLE = {pending:'En attente de validation', delegue:'Responsable d’équipe', admin:'Administrateur'};
  const role = profile ? profile.role : 'pending';
  view.innerHTML = `<div class="card">
    <h1>${esc(profile && profile.nom || 'Mon compte')}</h1>
    <p class="sub">${esc(session.user.email)} · ${ROLE[role]}</p>
    ${role==='pending' ? '<div class="msg">Ton compte doit être validé par un administrateur du club avant de pouvoir saisir les matchs.</div>' : ''}
    ${role==='delegue' ? `<div class="msg">${myTeams().length ? 'Tu gères les matchs des ' + myTeams().slice().sort().map(teamLabel).join(', ') + '.' : 'Aucune équipe ne t’est encore confiée : tu peux saisir uniquement les matchs où tu es désigné délégué.'}</div>` : ''}
    <div class="foot" style="margin-top:4px">
      ${canCreate() ? '<a class="fbtn club" href="#/nouveau">+ Nouveau match</a>' : ''}
      ${isAdmin() ? '<a class="fbtn" href="#/admin">Gérer les accès</a>' : ''}
    </div>
    <div class="foot" style="margin-top:10px"><button class="fbtn danger" id="logout">Se déconnecter</button></div>
  </div>`;
  $('logout').onclick = async () => {
    if (outbox.length && !confirm('Des actions ne sont pas encore envoyées. Se déconnecter quand même ?')) return;
    await sb.auth.signOut(); session = null; profile = null; lsSet('asm-profile', null); renderAcct(); location.hash = '#/';
  };
}
async function adminView(){
  if (!isAdmin()){ location.hash = '#/compte'; return; }
  view.innerHTML = '<div class="loading">Chargement…</div>';
  const { data, error } = await sb.from('profiles').select('*').order('created_at');
  if (error) throw error;
  const pending = data.filter(p=>p.role==='pending').length;
  const row = p => {
    const me = p.id === session.user.id, eqs = p.equipes || [];
    return `<div class="urow" data-id="${esc(p.id)}">
      <div class="uline"><div class="who"><b>${esc(p.nom || '—')}</b><small>${esc(p.email)}</small></div>
      <select class="urole" aria-label="Accès de ${esc(p.nom||p.email)}" ${me ? 'disabled' : ''}>
        <option value="pending"${p.role==='pending'?' selected':''}>Sans accès</option>
        <option value="delegue"${p.role==='delegue'?' selected':''}>Responsable</option>
        <option value="admin"${p.role==='admin'?' selected':''}>Admin</option>
      </select></div>
      ${p.role==='delegue' ? `<div class="uteams" role="group" aria-label="Équipes gérées">${TEAMS.map(n => `<button type="button" data-e="${n}" class="${eqs.includes(n)?'on':''}" aria-pressed="${eqs.includes(n)}">${teamLetter(n)}</button>`).join('')}<span class="uhint">${eqs.length ? '' : 'Aucune équipe'}</span></div>` : ''}
    </div>`;
  };
  view.innerHTML = `<div class="card"><h1>Accès</h1>
    <p class="sub">Chaque personne crée son compte depuis « Connexion », puis tu lui donnes l'accès ici. Un <b>responsable</b> gère uniquement les matchs des équipes cochées (A à E). Un <b>admin</b> gère tout.${pending ? ` <b>${pending} en attente.</b>` : ''}</p>
    ${data.map(row).join('')}
    <div class="foot"><a class="fbtn" href="#/compte">Retour</a></div></div>`;
  const save = async (id, fields) => {
    const { data: upd, error } = await sb.from('profiles').update(fields).eq('id', id).select('id');
    toast(error || !upd || !upd.length ? 'Modification refusée' : 'Accès mis à jour');
    return !error && upd && upd.length;
  };
  view.querySelectorAll('.urow').forEach(r => {
    const id = r.dataset.id, p = data.find(x => x.id === id);
    const sel = r.querySelector('.urole');
    sel.onchange = async () => { if (await save(id, {role: sel.value})){ adminView(); } };
    r.querySelectorAll('.uteams button').forEach(b => b.onclick = async () => {
      const n = +b.dataset.e, cur = new Set(p.equipes || []);
      cur.has(n) ? cur.delete(n) : cur.add(n);
      const eqs = [...cur].sort();
      if (await save(id, {equipes: eqs})){ p.equipes = eqs; b.classList.toggle('on', cur.has(n)); b.setAttribute('aria-pressed', cur.has(n)); r.querySelector('.uhint').textContent = eqs.length ? '' : 'Aucune équipe'; }
    });
  });
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
    <p>Reçois une notification à chaque but des équipes choisies, même appli fermée.</p>
    ${denied ? '<div class="msg err">Les notifications sont bloquées pour ce site. Autorise-les dans les réglages du téléphone (ou du navigateur), puis reviens ici.</div>' : ''}
    <div class="msg" id="bState">Vérification de ce téléphone…</div>
    <div class="follow">${TEAMS.map(n => `<label class="fl"><input type="checkbox" value="${n}"${cur.has(n)?' checked':''}><span>${teamLabel(n)}</span></label>`).join('')}</div>
    ${isAdmin() ? `<label class="fl fladmin"><input type="checkbox" id="bAdmin"${lsGet('asm-follow-admin', false) ? ' checked' : ''}><span>👤 Nouveaux comptes à valider <small>(admins)</small></span></label>` : ''}
    <div class="foot" style="margin-top:12px"><button class="fbtn primary" id="bSave">Enregistrer</button><button class="fbtn" id="bNo">Annuler</button></div>
    <button class="link" id="bTest" hidden style="width:100%">Envoyer une notification d’essai</button>`);
  $('bNo').onclick = closeSheet;
  // État réel, lu dans la base (et non dans la mémoire du téléphone)
  pushState().then(st => {
    const el = $('bState'); if (!el) return;
    const parts = [];
    if (st.teams.length) parts.push('les buts de : ' + st.teams.map(teamLabel).join(', '));
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
$('bell').onclick = () => openBell(homeTeam || 0);
renderBell();

// ---------- Démarrage ----------
renderAcct();
if (sb){
  sb.auth.onAuthStateChange((ev, s) => {
    session = s;
    if (ev === 'SIGNED_OUT'){ profile = null; lsSet('asm-profile', null); renderAcct(); }
  });
  loadProfile().catch(()=>{}).finally(() => { route(); flush(); });
} else route();

// PWA : fonctionnement hors ligne
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Mise à jour prête : relance l\'appli');
        });
      });
    }).catch(()=>{});
  });
}
