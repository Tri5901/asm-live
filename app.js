// AS Mésanger – Matchs en direct
// Vue publique (liste, direct, stats) + espace délégué (saisie du match, compositions, photo de la feuille).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const CLUB = 'AS Mésanger';
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
  let lastP = null, html = '';
  for (const e of list){
    if (lastP !== null && e.p !== lastP) html += '<div class="period-mark">Mi-temps</div>';
    lastP = e.p;
    const color = e.t===clubSide(m) ? 'var(--home)' : 'var(--away)';
    let detail = '';
    if (e.k==='goal') detail = who(m,e.t,e.n,'Buteur non précisé');
    if (e.k==='sub') detail = `Sort ${who(m,e.t,e.out_n,'?')} · Entre ${who(m,e.t,e.in_n,'?')}`;
    if (e.k==='yellow'||e.k==='red') detail = who(m,e.t,e.n,'Joueur non précisé');
    const kIcon = e.k==='yellow' ? '<span class="ic y" style="width:12px;height:16px"></span>' :
                  e.k==='red' ? '<span class="ic r" style="width:12px;height:16px"></span>' : e.k==='goal' ? '⚽' : '';
    html += `<div class="ev ${editable ? 'edit' : 'ro'}" data-id="${esc(e.id)}"><div class="min">${esc(e.min)}</div>
      <div class="what"><span class="dot" style="background:${color}"></span><div class="txt"><b>${LABEL[e.k]}</b> ${kIcon}<div>${esc(teamName(m,e.t))} · ${esc(detail)}</div></div></div>
      ${editable ? '<button class="del" aria-label="Supprimer">×</button>' : ''}</div>`;
  }
  return html;
}

// ---------- Session / profil ----------
let session = null;
let profile = lsGet('asm-profile', null);
const isStaff = () => !!profile && (profile.role==='delegue' || profile.role==='admin');
const isAdmin = () => !!profile && profile.role==='admin';

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
  if (session && profile){ a.textContent = profile.nom ? profile.nom.split(' ')[0] : 'Mon compte'; a.href = '#/compte'; }
  else if (session){ a.textContent = 'Mon compte'; a.href = '#/compte'; }
  else { a.textContent = 'Connexion'; a.href = '#/connexion'; }
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
      if (op.kind==='match') res = await sb.from('matches').update({...op.fields, updated_at:new Date().toISOString()}).eq('id', op.match);
      else if (op.kind==='ev') res = await sb.from('events').upsert(op.row);
      else if (op.kind==='evdel') res = await sb.from('events').delete().eq('id', op.id);
      if (res && res.error){
        if (isNetErr(res.error)) break;
        toast('Envoi refusé : ' + (res.error.message || 'erreur'));
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
    (a.dataset.tab==='stats' && page==='stats') || (a.dataset.tab==='matchs' && (page==='' || page==='match'))));
  $('tabs').hidden = page==='gerer';
  window.scrollTo(0,0);
  if (!sb){ view.innerHTML = `<div class="card"><h1>Configuration à terminer</h1><p class="sub">Le site n'est pas encore relié à sa base de données (fichier config.js).</p></div>`; return; }
  try{
    if (page==='' ) return await homeView();
    if (page==='match') return await matchView(arg);
    if (page==='gerer') return await consoleView(arg);
    if (page==='nouveau') return newMatchView();
    if (page==='stats') return await statsView();
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
      sb.from('matches').select('id,kickoff,competition,club_side,home_name,away_name,half,period,running,started_at,acc,status').order('kickoff', {ascending:false}).limit(200),
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
function drawHome(matches, goalRows){
  const byMatch = {};
  goalRows.forEach(g => { (byMatch[g.match_id] ||= []).push({k:'goal', t:g.t}); });
  const card = m => {
    const evs = byMatch[m.id] || [];
    const c = clubSide(m);
    let badge = '';
    if (m.status==='direct') badge = `<span class="badge live" data-live='${esc(JSON.stringify({status:m.status,period:m.period,half:m.half,running:m.running,started_at:m.started_at,acc:m.acc}))}'>Direct${m.period ? ' · ' + esc(currentMinute(m).label) : ''}</span>`;
    else if (m.status==='termine'){ const r = resultOf(m, evs); badge = `<span class="badge ${r==='V'?'w':r==='D'?'l':''}">${r==='V'?'Victoire':r==='D'?'Défaite':'Nul'}</span>`; }
    else badge = `<span class="badge">${esc(new Date(m.kickoff).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}))}</span>`;
    const sc = m.status==='prevu' ? 'vs' : `${goals(evs,'H')} – ${goals(evs,'A')}`;
    return `<a class="mcard" href="#/match/${esc(m.id)}">
      <div class="meta"><span>${esc(fmtDate(m.kickoff, false))}${m.competition ? ' · ' + esc(m.competition) : ''}</span>${badge}</div>
      <div class="row"><span class="tn${c==='H'?' club':''}">${esc(teamName(m,'H'))}</span><span class="sc">${sc}</span><span class="tn r${c==='A'?' club':''}">${esc(teamName(m,'A'))}</span></div></a>`;
  };
  const live = matches.filter(m=>m.status==='direct');
  const next = matches.filter(m=>m.status==='prevu').sort((a,b)=>a.kickoff.localeCompare(b.kickoff));
  const done = matches.filter(m=>m.status==='termine');
  let html = '';
  if (isStaff()) html += `<a class="fbtn club" href="#/nouveau" style="width:100%;margin-bottom:4px">+ Nouveau match</a>`;
  if (live.length) html += `<div class="sec">En direct</div>` + live.map(card).join('');
  if (next.length) html += `<div class="sec">À venir</div>` + next.map(card).join('');
  if (done.length) html += `<div class="sec">Résultats</div>` + done.map(card).join('');
  if (!matches.length) html += `<div class="empty" style="margin-top:12px">Aucun match pour l'instant.${isStaff() ? '' : ' Reviens le jour du match pour le suivre en direct.'}</div>`;
  view.innerHTML = html;
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
    <div class="bmeta"><span>${esc(fmtDate(m.kickoff))}${m.competition ? ' · ' + esc(m.competition) : ''}</span>${m.status==='direct' ? '<span class="badge live">Direct</span>' : ''}</div>
    <div class="teams">
      <div class="team"><span class="tname${c==='H'?' club':''}">${esc(teamName(m,'H'))}</span></div>
      <div class="score" aria-live="polite"><span id="scH">${goals(evs,'H')}</span><span class="sep">–</span><span id="scA">${goals(evs,'A')}</span></div>
      <div class="team"><span class="tname${c==='A'?' club':''}">${esc(teamName(m,'A'))}</span></div>
    </div>
    <div class="clockrow">
      <div>${staff ? `<button class="clock" id="clock" aria-label="Régler le chrono">${clockText(m)}</button>` : `<div class="clock" id="clock">${m.status==='prevu' ? '--:--' : clockText(m)}</div>`}<div class="period" id="period">${esc(periodText(m))}</div></div>
      ${staff ? `<div class="clockbtns"><button class="cbtn ghost" id="btnPeriod"></button><button class="cbtn" id="btnClock"></button></div>` : ''}
    </div>
  </section>`;
}
function lineupsHTML(m){
  const side = t => {
    const list = rosterSorted(m,t);
    if (!list.length) return '';
    return `<div><h3>${esc(teamName(m,t))}</h3><ol>${list.map(p=>`<li class="${p.sub?'bench':''}"><b>${esc(p.n)}</b><span>${esc(p.name)}${p.sub?' (R)':''}</span></li>`).join('')}</ol></div>`;
  };
  const h = side('H'), a = side('A');
  if (!h && !a) return '';
  return `<section class="log"><div class="loghead"><h2>Compositions</h2></div><div class="lineups">${h||'<div></div>'}${a||'<div></div>'}</div></section>`;
}
async function matchView(id){
  view.innerHTML = '<div class="loading">Chargement…</div>';
  let { m, evs } = await fetchMatch(id);
  if (!m){ view.innerHTML = '<div class="empty">Ce match n\'existe plus.</div>'; return; }
  const draw = () => {
    view.innerHTML = boardHTML(m, evs, false)
      + `<div class="foot" style="margin-top:12px"><button class="fbtn" id="btnShareLive">Partager le lien</button>${isStaff() ? `<a class="fbtn primary" href="#/gerer/${esc(m.id)}">Gérer ce match</a>` : ''}</div>`
      + `<section class="log"><div class="loghead"><h2>Chronologie</h2></div><div id="events">${timelineHTML(m, evs, false)}</div></section>`
      + lineupsHTML(m);
    $('btnShareLive').onclick = () => shareLink(m);
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
function newMatchView(){
  if (!isStaff()){ location.hash = session ? '#/compte' : '#/connexion'; return; }
  const d = new Date(); d.setMinutes(Math.ceil(d.getMinutes()/15)*15, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  let side = 'H';
  view.innerHTML = `<form class="card" id="nf">
    <h1>Nouveau match</h1><p class="sub">Deux mi-temps de 45 min.</p>
    <label class="field"><span>Adversaire</span><input id="nfOpp" required autocomplete="off" placeholder="Nom de l'équipe adverse"></label>
    <div class="field"><span>Lieu</span><div class="seg" id="nfSide"><button type="button" data-s="H" class="on">Domicile</button><button type="button" data-s="A">Extérieur</button></div></div>
    <label class="field"><span>Date et heure du coup d'envoi</span><input id="nfDate" type="datetime-local" value="${local}" required></label>
    <label class="field"><span>Compétition</span><input id="nfComp" autocomplete="off" placeholder="Championnat, Coupe…" list="compList"><datalist id="compList"></datalist></label>
    <div id="nfMsg"></div>
    <div class="foot" style="margin-top:4px"><button class="fbtn primary" id="nfGo">Créer le match</button><a class="fbtn" href="#/">Annuler</a></div>
  </form>`;
  sb.from('matches').select('competition').neq('competition','').limit(200).then(({data}) => {
    const set = [...new Set((data||[]).map(r=>r.competition))];
    $('compList') && ($('compList').innerHTML = set.map(c=>`<option value="${esc(c)}">`).join(''));
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
      club_side: side, home_name: side==='H' ? CLUB : opp, away_name: side==='H' ? opp : CLUB, half: HALF
    };
    const { error } = await sb.from('matches').insert(row);
    if (error){ $('nfGo').disabled = false; $('nfMsg').innerHTML = `<div class="msg err">${esc(isNetErr(error) ? 'Pas de réseau : il faut être connecté pour créer le match.' : error.message)}</div>`; return; }
    location.hash = '#/gerer/' + row.id;
  };
}

// ---------- Console du délégué ----------
async function consoleView(id){
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
      <button class="fbtn danger" id="btnDelete">Supprimer le match</button>
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
    e.id = uuid(); e.p = S.period || 1; e.created_at = new Date().toISOString();
    e.sort = sortFromLabel(e.min, e.sort);
    if (S.status==='prevu') patch({status:'direct', period: S.period || 1});
    S.events.push(e); pushEv(e); render();
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

  // Compositions + lecture de la photo de la feuille
  const toText = t => rosterSorted(S,t).map(p=>`${p.n} ${p.name}${p.sub?' R':''}`).join('\n');
  function parse(txt){
    return txt.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
      const m = l.match(/^(\d{1,3})\s+(.*?)(\s+R)?$/i); if(!m) return null;
      return {n:String(+m[1]), name:m[2].trim(), sub:!!m[3]};
    }).filter(Boolean);
  }
  $('btnLineup').onclick = () => {
    openSheet(`<h3 id="shTitle">Compositions</h3>
      <p>Une ligne par joueur : numéro puis nom. « R » à la fin pour un remplaçant. Tu peux aussi prendre en photo la liste d'une équipe sur la feuille de match.</p>
      <div class="lineup">
        ${['H','A'].map(t => `<div class="lhead"><label for="ros${t}">${esc(teamName(S,t))}</label>
          <button type="button" class="photo" data-t="${t}">📷 Photo</button></div>
          <input type="file" accept="image/*" capture="environment" id="file${t}" hidden>
          <textarea id="ros${t}" placeholder="10 DUPONT Lucas&#10;7 MARTIN Hugo&#10;14 BERNARD Léo R">${esc(toText(t))}</textarea>
          <div class="ocrstat" id="ocr${t}"></div>`).join('')}
      </div>
      <div class="foot" style="margin-top:10px"><button class="fbtn primary" id="rosSave">Enregistrer</button><button class="fbtn" id="rosCancel">Annuler</button></div>`);
    $('shBody').querySelectorAll('.photo').forEach(b => b.onclick = () => $('file'+b.dataset.t).click());
    ['H','A'].forEach(t => $('file'+t).onchange = async ev => {
      const file = ev.target.files[0]; ev.target.value = '';
      if (file) await readSheetPhoto(file, $('ros'+t), $('ocr'+t));
    });
    $('rosSave').onclick = () => { patch({rosters:{H:parse($('rosH').value), A:parse($('rosA').value)}}); closeSheet(); render(); toast('Compositions enregistrées'); };
    $('rosCancel').onclick = closeSheet;
  };

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
  $('btnDelete').onclick = () => askConfirm('Supprimer ce match ?', 'Le match, sa chronologie et ses compositions seront effacés pour tout le monde, et retirés des stats.', 'Supprimer définitivement', async () => {
    const { error } = await sb.from('matches').delete().eq('id', id);
    if (error){ toast(isNetErr(error) ? 'Pas de réseau : réessaie plus tard' : error.message); return; }
    outbox = outbox.filter(o => o.match !== id); saveOutbox();
    try{ localStorage.removeItem(CK); }catch(e){}
    toast('Match supprimé'); location.hash = '#/';
  });

  render(); renderSync();
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
async function readSheetPhoto(file, ta, stat){
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
    const lines = found.map((p, i) => `${p.n} ${p.name}${i >= 11 ? ' R' : ''}`).join('\n');
    ta.value = ta.value.trim() ? ta.value.trim() + '\n' + lines : lines;
    stat.textContent = `${found.length} joueur${found.length>1?'s':''} trouvé${found.length>1?'s':''}. Vérifie les noms et les « R » avant d'enregistrer.`;
  }catch(e){
    console.error(e);
    stat.textContent = 'La lecture a échoué. Tu peux taper les joueurs à la main.';
  }
}

// ---------- Stats joueurs ----------
let statSort = {key:'goals', dir:-1}, statSeason = null;
function playerKey(name){
  return name.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z ]/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
}
async function statsView(){
  view.innerHTML = '<div class="loading">Chargement…</div>';
  const [{ data: ms, error }, { data: evs, error: e2 }] = await Promise.all([
    sb.from('matches').select('id,kickoff,club_side,rosters,status').neq('status','prevu'),
    sb.from('events').select('match_id,t,k,n,in_n')
  ]);
  if (error || e2) throw (error || e2);
  const seasons = [...new Set(ms.map(m=>seasonOf(m.kickoff)))].sort().reverse();
  if (!statSeason || !seasons.includes(statSeason)) statSeason = seasons[0] || null;
  const draw = () => {
    const list = ms.filter(m => seasonOf(m.kickoff)===statSeason);
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
      ${seasons.length > 1 ? `<div class="seasons"><label>Saison <select id="season">${seasons.map(s=>`<option${s===statSeason?' selected':''}>${s}</option>`).join('')}</select></label></div>` : (statSeason ? `<div class="sec" style="margin-top:0">Saison ${statSeason}</div>` : '')}
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
      await loadProfile();
      location.hash = isStaff() ? '#/' : '#/compte';
    };
  };
  draw();
}
function accountView(){
  if (!session){ location.hash = '#/connexion'; return; }
  const ROLE = {pending:'En attente de validation', delegue:'Délégué', admin:'Administrateur'};
  const role = profile ? profile.role : 'pending';
  view.innerHTML = `<div class="card">
    <h1>${esc(profile && profile.nom || 'Mon compte')}</h1>
    <p class="sub">${esc(session.user.email)} · ${ROLE[role]}</p>
    ${role==='pending' ? '<div class="msg">Ton compte doit être validé par un administrateur du club avant de pouvoir saisir les matchs.</div>' : ''}
    <div class="foot" style="margin-top:4px">
      ${isStaff() ? '<a class="fbtn club" href="#/nouveau">+ Nouveau match</a>' : ''}
      ${isAdmin() ? '<a class="fbtn" href="#/admin">Gérer les délégués</a>' : ''}
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
  view.innerHTML = `<div class="card"><h1>Délégués</h1>
    <p class="sub">Chaque personne crée son compte depuis « Connexion », puis tu lui donnes l'accès ici.${pending ? ` <b>${pending} en attente.</b>` : ''}</p>
    ${data.map(p=>`<div class="urow"><div class="who"><b>${esc(p.nom || '—')}</b><small>${esc(p.email)}</small></div>
      <select data-id="${esc(p.id)}" aria-label="Rôle de ${esc(p.nom||p.email)}" ${p.id===session.user.id?'disabled':''}>
        <option value="pending"${p.role==='pending'?' selected':''}>Sans accès</option>
        <option value="delegue"${p.role==='delegue'?' selected':''}>Délégué</option>
        <option value="admin"${p.role==='admin'?' selected':''}>Admin</option>
      </select></div>`).join('')}
    <div class="foot"><a class="fbtn" href="#/compte">Retour</a></div></div>`;
  view.querySelectorAll('select[data-id]').forEach(s => s.onchange = async () => {
    const { error } = await sb.from('profiles').update({role: s.value}).eq('id', s.dataset.id);
    toast(error ? 'Erreur : ' + error.message : 'Accès mis à jour');
  });
}

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
