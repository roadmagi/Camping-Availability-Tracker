#!/usr/bin/env node
'use strict';
/*
 * nj-campsite-availability.js — NJ State Park campsite availability checker
 * --------------------------------------------------------------------------
 * WHAT IT DOES
 *   Reads your stored favorite sites (config/preferred-sites.json), fetches
 *   live availability from the NJ reservation portal (njportal.com/DEP/
 *   NJOutdoors), and writes ONE interactive, color-coded HTML calendar that
 *   spans all your parks. Click any date in the calendar to see which park +
 *   site is open that day.
 *
 *   READ-ONLY: it only views availability. It never books, pays, or logs in.
 *
 * INPUTS
 *   - config/preferred-sites.json  (parks + site numbers; months; start date)
 *   - command-line flags (see USAGE)
 *
 * OUTPUT
 *   - temp/outputs/campsite-availability/availability-YYYY-MM-DD.html
 *
 * USAGE
 *   node tools/nj-campsite-availability.js                 # build calendar from config
 *   node tools/nj-campsite-availability.js --list                 # show stored prefs
 *   node tools/nj-campsite-availability.js --list-parks           # all NJ parks + ids
 *   node tools/nj-campsite-availability.js --list-sites --park "High Point"
 *   node tools/nj-campsite-availability.js --add --park "High Point" --sites 1,2,3
 *   node tools/nj-campsite-availability.js --remove --park "High Point" [--sites 1,2]
 *   node tools/nj-campsite-availability.js --park "High Point" --sites 1,2,3   # ad-hoc, no save
 *   Optional on any build: --start 2026-08-01 --months 6
 *
 * No external dependencies (Node 18+ / Bun, built-in fetch). No secrets.
 */

const fs = require('fs');
const path = require('path');

const nj = require('../lib/nj-portal');
const {
  getParks, norm, resolvePark,
  getSession, isoUTC, addDays, todayUTC, fetchWindow,
  getParkAvailability, normSite,
} = nj;

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'preferred-sites.json');
const OUT_DIR = path.join(ROOT, 'temp', 'outputs', 'campsite-availability');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out.flags[key] = true;
      } else {
        out.flags[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// Mark each site as favorite (and sort favorites first within each park) from
// the config's per-park `favorites` list. Re-applied on --rebuild so favorites
// can be edited and previewed without re-fetching.
function applyFavorites(data, cfg) {
  const parks = (cfg && cfg.parks) || [];
  for (const park of data.parks) {
    const entry =
      parks.find((p) => norm(p.park) === norm(park.parkName)) ||
      parks.find((p) => norm(p.park) && (norm(park.parkName).includes(norm(p.park)) || norm(p.park).includes(norm(park.parkName))));
    park.description = (entry && entry.description) || '';
    const favs = new Set(((entry && entry.favorites) || []).map(normSite));
    for (const s of park.sites) s.favorite = favs.has(normSite(s.shortName));
    park.sites.sort((a, b) => {
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      return normSite(a.shortName).localeCompare(normSite(b.shortName), undefined, { numeric: true });
    });
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { startDateDefault: null, months: 6, parks: [] };
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  cfg.parks = cfg.parks || [];
  if (cfg.months == null) cfg.months = 6;
  return cfg;
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NJ Campsite Availability</title>
<style>
  :root{--green:#2e7d32;--greenbg:#d7f3d8;--red:#c62828;--redbg:#fbdada;--grey:#9e9e9e;--greybg:#ececec;}
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;color:#1c1c1c;background:#fafafa}
  header{background:#0b3d2e;color:#fff;padding:18px 22px}
  header h1{margin:0 0 4px;font-size:20px}
  header .meta{font-size:13px;opacity:.85}
  .bar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid #ddd;padding:12px 22px;display:flex;flex-wrap:wrap;gap:14px;align-items:center}
  .bar input[type=date]{padding:6px 8px;font-size:14px}
  .legend{display:flex;gap:14px;font-size:13px;flex-wrap:wrap}
  .legend span{display:inline-flex;align-items:center;gap:5px}
  .sw{width:13px;height:13px;border-radius:3px;display:inline-block;border:1px solid rgba(0,0,0,.15)}
  .sw.available{background:var(--greenbg)} .sw.booked{background:var(--redbg)} .sw.closed{background:var(--greybg)}
  main{padding:18px 22px 92px}
  .park{margin-bottom:30px;scroll-margin-top:140px}
  .park h2{font-size:17px;margin:0 0 10px;color:#0b3d2e;border-bottom:2px solid #0b3d2e;padding-bottom:4px}
  .alert-banner{background:#fff4e5;border:1px solid #ffcc80;border-left:4px solid #ef6c00;border-radius:6px;padding:9px 12px;margin:0 0 12px;font-size:13px;color:#7a3b00}
  .alert-banner b{color:#b34700}
  .alert-banner .ab{margin-top:3px;opacity:.9}
  .site{margin:0 0 18px}
  .lbl{position:sticky;left:0;z-index:3;flex:0 0 165px;background:#fafafa;display:flex;flex-direction:column;justify-content:center;padding:4px 12px 4px 12px;border-right:1px solid #e0e0e0;box-shadow:7px 0 7px -5px rgba(0,0,0,.10)}
  .lbl-id{font-size:14px;font-weight:600;line-height:1.2}
  .lbl-sub{font-weight:400;color:#666;font-size:12px;margin-top:3px}
  .months{display:flex;flex-wrap:nowrap;gap:12px;overflow:hidden}
  .slider-bar{position:fixed;left:0;right:0;bottom:0;z-index:20;background:#0b3d2e;color:#fff;display:flex;align-items:center;gap:16px;padding:11px 22px;box-shadow:0 -2px 12px rgba(0,0,0,.18)}
  .slider-bar input[type=range]{flex:1;cursor:pointer;accent-color:#7bd389;height:6px}
  .slider-bar .slider-label{font-size:13px;font-weight:600;min-width:128px}
  .slider-bar .slider-hint{font-size:12px;opacity:.82;white-space:nowrap}
  .cal{flex:0 0 max(180px, calc((100vw - 116px) / 7));border:1px solid #e2e2e2;border-radius:8px;padding:8px;background:#fff;scroll-snap-align:start}
  .cal .mon{font-size:12px;font-weight:600;text-align:center;margin-bottom:5px}
  .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
  .grid .wd{font-size:9px;color:#999;text-align:center}
  .cell{aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:11px;border-radius:3px;cursor:default;color:#333}
  .cell.available{background:var(--greenbg);color:var(--green);font-weight:600;cursor:pointer}
  .cell.booked{background:var(--redbg);color:var(--red)}
  .cell.closed{background:var(--greybg);color:var(--grey)}
  .cell.empty{background:transparent}
  .cell.sel{outline:2px solid #0b3d2e;outline-offset:-2px}
  .none{color:#999;font-style:italic}
  html{scroll-behavior:smooth}
  .parknav{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
  .parknav a{font-size:12px;color:#0b3d2e;text-decoration:none;padding:3px 9px;border-radius:12px;background:#eef3f0;border:1px solid #d8e4dd;white-space:nowrap}
  .parknav a:hover{background:#dcebe2}
  .parknav a.closed{opacity:.55}
  .parknav .dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;vertical-align:middle}
  .park-h2{cursor:pointer;user-select:none}
  .park .caret{display:inline-block;transition:transform .15s;font-size:12px;color:#2e7d32}
  .park.collapsed .caret{transform:rotate(-90deg)}
  .park .ph-hint{font-size:12px;font-weight:400;color:#888;margin-left:4px}
  .info-btn{display:inline-block;cursor:pointer;color:#fff;background:#0b3d2e;font-size:12px;font-weight:600;margin-left:9px;padding:2px 10px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.25);vertical-align:middle;white-space:nowrap}
  .info-btn:hover{background:#16604a}
  .info-btn.open{background:#b34700}
  .park-desc{font-size:13px;color:#444;line-height:1.45;max-width:900px;margin:2px 0 12px;background:#f3f6f4;border-left:3px solid #b9cabf;padding:8px 12px;border-radius:0 6px 6px 0;white-space:pre-wrap}
  .park-desc[hidden]{display:none}
  .park.collapsed .park-body{display:none}
  .cell.today{box-shadow:inset 0 0 0 2px #1565c0;font-weight:700}
  .site.fav .lbl{background:#fff8e1;box-shadow:7px 0 7px -5px rgba(0,0,0,.10),inset 4px 0 0 #f4c430}
  .site.fav .lbl-id{font-weight:800;color:#7a5c00}
  .lbl .star{color:#f4b400}
  .fav-toggle{font-size:13px;padding:5px 11px;border-radius:14px;border:1px solid #e6c200;background:#fff8e1;color:#7a5c00;cursor:pointer;font-weight:600}
  .fav-toggle.on{background:#f4c430;color:#3a2c00;border-color:#caa200}
  body.fav-only .site:not(.fav){display:none}
  body.fav-only .park.no-fav{display:none}
  .slider-bar button{background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:6px;width:32px;height:30px;font-size:14px;cursor:pointer}
  .slider-bar button:hover{background:rgba(255,255,255,.30)}
  .slider-bar input[type=range]::-webkit-slider-runnable-track{height:6px;background:rgba(255,255,255,.30);border-radius:3px}
  .slider-bar input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;border-radius:50%;background:#7bd389;border:2px solid #fff;margin-top:-7px;cursor:pointer}
</style>
</head>
<body>
<header>
  <h1>🏕️ NJ Campsite Availability</h1>
  <div class="meta" id="hdrMeta"></div>
</header>
<div class="bar">
  <label>Check a date: <input type="date" id="datePick" /></label>
  <button id="favToggle" class="fav-toggle" type="button">★ Favorites only</button>
  <div class="legend">
    <span><i class="sw available"></i>Available</span>
    <span><i class="sw booked"></i>Booked</span>
    <span><i class="sw closed"></i>Closed/Unavailable</span>
    <span><i class="sw" style="box-shadow:inset 0 0 0 2px #1565c0;background:#fff"></i>Today</span>
  </div>
  <div class="parknav" id="parknav"></div>
</div>
<main id="main"></main>
<div class="slider-bar">
  <span class="slider-label" id="slLabel">Months</span>
  <button id="slPrev" title="Earlier month" aria-label="Earlier month">◀</button>
  <input type="range" id="monthSlider" min="0" max="1000" value="0" step="1" aria-label="Scroll all calendars through the months" />
  <button id="slNext" title="Later month" aria-label="Later month">▶</button>
  <span class="slider-hint">drag or ◀ ▶</span>
</div>
<script>
const DATA = ${json};
const WD = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function iso(y,m,d){return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
function fmtLong(isoStr){const [y,m,d]=isoStr.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()]+' '+MON[m-1]+' '+d+', '+y;}

document.getElementById('hdrMeta').textContent =
  'Range: '+DATA.start+' to '+DATA.end+'  •  '+DATA.parkCount+' park(s)  •  generated '+DATA.generatedAt;

// collect the set of months spanned
function monthsBetween(startIso,endIso){
  const [sy,sm]=startIso.split('-').map(Number); const [ey,em]=endIso.split('-').map(Number);
  const out=[]; let y=sy,m=sm-1; const endY=ey,endM=em-1;
  while(y<endY || (y===endY && m<=endM)){ out.push([y,m]); m++; if(m>11){m=0;y++;} }
  return out;
}
const MONTHS = monthsBetween(DATA.start, DATA.end);
const _now=new Date();
const todayIso=iso(_now.getFullYear(),_now.getMonth(),_now.getDate());

function renderCal(days, y, m){
  const first=new Date(Date.UTC(y,m,1)).getUTCDay();
  const dim=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  let cells='';
  for(const w of WD) cells+='<div class="wd">'+w+'</div>';
  for(let i=0;i<first;i++) cells+='<div class="cell empty"></div>';
  for(let d=1;d<=dim;d++){
    const k=iso(y,m,d); const st=days[k]||'';
    const cls = st==='available'?'available':st==='booked'?'booked':st==='closed'?'closed':'empty';
    const attr = st? ' data-date="'+k+'"':'';
    const tcls = k===todayIso? ' today':'';
    cells+='<div class="cell '+cls+tcls+'"'+attr+'>'+d+'</div>';
  }
  return '<div class="cal"><div class="mon">'+MON[m]+' '+y+'</div><div class="grid">'+cells+'</div></div>';
}

const main=document.getElementById('main');
let html='';
function E(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function shortPark(n){return n.replace(/ STATE PARK| STATE FOREST| RECREATION AREA/i,'').toUpperCase();}
function parkHasOpen(p){return p.sites.some(s=>Object.values(s.days).includes('available'));}
DATA.parks.forEach((park,pi)=>{
  const collapsed=!parkHasOpen(park);
  const cnt=park.sites.length;
  const favN=park.sites.filter(s=>s.favorite).length;
  const desc=park.description||'';
  html+='<div class="park'+(collapsed?' collapsed':'')+(favN?'':' no-fav')+'" id="park-'+pi+'">';
  html+='<h2 class="park-h2"><span class="caret">▾</span> '+E(park.parkName)+
        (desc?' <span class="info-btn" title="추천 & 설명 보기">ⓘ 추천/설명</span>':'')+
        ' <span class="ph-hint">'+cnt+' site'+(cnt!==1?'s':'')+(favN?' · ★'+favN:'')+(collapsed?' · closed — click to show':'')+'</span></h2>';
  if(desc) html+='<div class="park-desc" hidden>'+E(desc)+'</div>';
  if(park.alert){ html+='<div class="alert-banner">⚠ <b>'+E(park.alert.title)+'</b>'+(park.alert.body?'<div class="ab">'+E(park.alert.body)+'</div>':'')+'</div>'; }
  html+='<div class="park-body">';
  if(!park.sites.length){ html+='<div class="none">No matching sites found for your numbers at this park.</div>'; }
  for(const s of park.sites){
    const bits=[]; if(s.type)bits.push(s.type); if(s.cost!=null)bits.push('$'+s.cost);
    const tag=(/^[0-9]/.test(s.shortName)?'#':'')+E(s.shortName);
    html+='<div class="site'+(s.favorite?' fav':'')+'"><div class="months">'+
          '<div class="lbl"><div class="lbl-id">'+(s.favorite?'<span class="star">★</span> ':'')+tag+(s.name?' '+E(s.name):'')+'</div>'+
          (bits.length?'<div class="lbl-sub">'+E(bits.join(' · '))+'</div>':'')+'</div>';
    for(const [y,m] of MONTHS) html+=renderCal(s.days,y,m);
    html+='</div></div>';
  }
  html+='</div></div>';
});
main.innerHTML=html;

// Park jump-menu (top bar): click a park to scroll to it; dot = open/closed.
document.getElementById('parknav').innerHTML=DATA.parks.map((p,i)=>{
  const open=parkHasOpen(p);
  return '<a href="#park-'+i+'" class="'+(open?'':'closed')+'"><span class="dot" style="background:'+(open?'#2e7d32':'#9e9e9e')+'"></span>'+E(shortPark(p.parkName))+'</a>';
}).join('');

// Collapse/expand a park by clicking its header.
document.querySelectorAll('.park-h2').forEach(h=>h.addEventListener('click',()=>{
  h.parentElement.classList.toggle('collapsed');
  applySlider();
}));

// ⓘ toggles a park's description without collapsing the park.
document.querySelectorAll('.info-btn').forEach(b=>b.addEventListener('click',e=>{
  e.stopPropagation();
  const d=b.closest('.park').querySelector('.park-desc');
  if(!d) return;
  d.hidden=!d.hidden;
  b.classList.toggle('open',!d.hidden);
  b.textContent=d.hidden?'ⓘ 추천/설명':'✕ 닫기';
}));

// "Favorites only" toggle: hide non-favorite sites and favorite-less parks.
const favBtn=document.getElementById('favToggle');
favBtn.addEventListener('click',()=>{
  const on=document.body.classList.toggle('fav-only');
  favBtn.classList.toggle('on',on);
  favBtn.textContent=on?'★ Showing favorites only':'★ Favorites only';
  applySlider();
});

// One slider (with ◀ ▶) at the bottom scrolls every site's month strip together.
const rows=[...document.querySelectorAll('.months')];
const slider=document.getElementById('monthSlider');
const slLabel=document.getElementById('slLabel');
function firstVisible(sel){for(const el of document.querySelectorAll(sel)){if(el.getClientRects().length) return el;} return null;}
function maxScroll(){return rows.length?Math.max(0,...rows.map(r=>r.scrollWidth-r.clientWidth)):0;}
function calStep(){const c=firstVisible('.cal');return c?c.getBoundingClientRect().width+12:200;}
function applySlider(){
  const ms=maxScroll();
  const x=ms*(slider.value/1000);
  for(const r of rows) r.scrollLeft=x;
  const cw=calStep();
  const firstIdx=Math.max(0,Math.min(MONTHS.length-1,Math.round(x/cw)));
  const row=firstVisible('.months');
  const visW=row?Math.max(0,row.clientWidth-177):cw;   // 177 = sticky label (165) + gap (12)
  const vis=Math.max(1,Math.floor(visW/cw));
  const lastIdx=Math.min(MONTHS.length-1,firstIdx+vis-1);
  const f=MONTHS[firstIdx], l=MONTHS[lastIdx];
  if(f) slLabel.textContent=MON[f[1]].slice(0,3)+' '+f[0]+(lastIdx>firstIdx?' – '+MON[l[1]].slice(0,3)+' '+l[0]:'');
}
function step(dir){const ms=maxScroll();if(ms<=0)return;const dv=(calStep()/ms)*1000;slider.value=Math.max(0,Math.min(1000,(+slider.value)+dir*dv));applySlider();}
slider.addEventListener('input',applySlider);
document.getElementById('slPrev').addEventListener('click',()=>step(-1));
document.getElementById('slNext').addEventListener('click',()=>step(1));
window.addEventListener('resize',applySlider);
applySlider();

function showDate(k){
  // Highlight the same day across all calendars; no summary panel.
  document.querySelectorAll('.cell.sel').forEach(e=>e.classList.remove('sel'));
  document.querySelectorAll('.cell[data-date="'+k+'"]').forEach(e=>e.classList.add('sel'));
}
main.addEventListener('click',e=>{const c=e.target.closest('.cell[data-date]'); if(c) showDate(c.dataset.date);});
document.getElementById('datePick').addEventListener('change',e=>{ if(e.target.value) showDate(e.target.value); });
document.getElementById('datePick').min=DATA.start; document.getElementById('datePick').max=DATA.end;
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
function parseSitesArg(v) {
  if (v == null || v === true) return [];
  return String(v)
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function cmdListParks() {
  const parks = await getParks();
  console.log('NJ parks on the reservation portal (' + parks.length + '):\n');
  for (const p of parks.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log('  ' + String(p.id).padStart(4) + '  ' + p.name);
  }
}

async function cmdListSites(parkQuery) {
  const hits = await resolvePark(parkQuery);
  if (hits.length !== 1) return reportPark(hits, parkQuery);
  const park = hits[0];
  const session = await getSession(park.id);
  const sites = await fetchWindow(session, park.id, todayUTC());
  console.log('Sites at ' + park.name + ' (locationId ' + park.id + '):\n');
  for (const s of sites) {
    const d = s.SiteDetails || {};
    const type = (d.SiteTypes || []).map((t) => t.Name).join(', ');
    console.log(
      '  #' + String(d.ShortName).padEnd(6) + (d.Name || '').padEnd(18) + (type ? '[' + type + '] ' : '') + (d.ResidentCost != null ? '$' + d.ResidentCost : '')
    );
  }
  console.log('\nUse the # value (e.g. ' + (sites[0] && sites[0].SiteDetails.ShortName) + ') as your site number.');
}

function reportPark(hits, query) {
  if (!hits.length) {
    console.error('No NJ park matched "' + query + '". Run --list-parks to see them all.');
  } else {
    console.error('"' + query + '" is ambiguous. Did you mean:');
    hits.forEach((p) => console.error('   - ' + p.name));
  }
  process.exitCode = 1;
}

async function cmdAdd(parkQuery, sites, asFav) {
  const hits = await resolvePark(parkQuery);
  if (hits.length !== 1) return reportPark(hits, parkQuery);
  const park = hits[0];
  const cfg = loadConfig();
  let entry = cfg.parks.find((p) => norm(p.park) === norm(park.name));
  if (!entry) {
    entry = { park: park.name, sites: [] };
    cfg.parks.push(entry);
  }
  const set = new Set(entry.sites.map(normSite));
  for (const s of sites) if (!set.has(normSite(s))) entry.sites.push(s);
  if (asFav) {
    entry.favorites = entry.favorites || [];
    const fset = new Set(entry.favorites.map(normSite));
    for (const s of sites) if (!fset.has(normSite(s))) entry.favorites.push(s);
  }
  saveConfig(cfg);
  console.log('Saved. ' + park.name + ' → sites: ' + entry.sites.join(', ') + (asFav ? '\n  ★ favorites: ' + entry.favorites.join(', ') : ''));
}

async function cmdRemove(parkQuery, sites) {
  const cfg = loadConfig();
  const entry = cfg.parks.find((p) => norm(p.park).includes(norm(parkQuery)) || norm(parkQuery).includes(norm(p.park)));
  if (!entry) {
    console.error('No stored park matched "' + parkQuery + '".');
    process.exitCode = 1;
    return;
  }
  if (sites.length) {
    const rm = new Set(sites.map(normSite));
    entry.sites = entry.sites.filter((s) => !rm.has(normSite(s)));
    if (!entry.sites.length) cfg.parks = cfg.parks.filter((p) => p !== entry);
  } else {
    cfg.parks = cfg.parks.filter((p) => p !== entry);
  }
  saveConfig(cfg);
  console.log('Updated. Stored parks: ' + (cfg.parks.map((p) => p.park).join(', ') || '(none)'));
}

function cmdRebuild() {
  const cachePath = path.join(OUT_DIR, 'last-data.json');
  if (!fs.existsSync(cachePath)) {
    console.error('No cached data found. Run a normal build once first (then --rebuild regenerates the HTML without re-fetching).');
    process.exitCode = 1;
    return;
  }
  const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  try { applyFavorites(data, loadConfig()); } catch (e) {}
  const outPath = path.join(OUT_DIR, 'availability-' + isoUTC(todayUTC()) + '.html');
  fs.writeFileSync(outPath, buildHtml(data));
  console.log('✅ Rebuilt HTML from cached data (no fetch): ' + outPath);
}

function cmdList() {
  const cfg = loadConfig();
  if (!cfg.parks.length) {
    console.log('No preferred sites stored yet. Add some with:');
    console.log('  node tools/nj-campsite-availability.js --add --park "High Point" --sites 1,2,3');
    return;
  }
  console.log('Preferred sites (months=' + cfg.months + (cfg.startDateDefault ? ', start=' + cfg.startDateDefault : '') + '):\n');
  for (const p of cfg.parks) console.log('  ' + p.park + ' → ' + p.sites.join(', ') + (p.favorites && p.favorites.length ? '   ★ ' + p.favorites.join(', ') : ''));
}

async function cmdBuild(opts) {
  const cfg = loadConfig();
  // Determine the park/site set: config, or ad-hoc --park/--sites
  let targets;
  if (opts.adhocPark) {
    const hits = await resolvePark(opts.adhocPark);
    if (hits.length !== 1) return reportPark(hits, opts.adhocPark);
    targets = [{ park: hits[0], wanted: opts.adhocSites }];
  } else {
    if (!cfg.parks.length) {
      console.error('No preferred sites stored. Add some first:');
      console.error('  node tools/nj-campsite-availability.js --add --park "High Point" --sites 1,2,3');
      process.exitCode = 1;
      return;
    }
    targets = [];
    for (const pref of cfg.parks) {
      const hits = await resolvePark(pref.park);
      if (hits.length !== 1) {
        console.error('Skipping "' + pref.park + '" (no unique match).');
        continue;
      }
      targets.push({ park: hits[0], wanted: pref.sites });
    }
  }

  const months = opts.months || cfg.months || 6;
  const start = opts.start
    ? new Date(opts.start + 'T00:00:00Z')
    : cfg.startDateDefault
    ? new Date(cfg.startDateDefault + 'T00:00:00Z')
    : todayUTC();
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()));

  const parksOut = [];
  for (const t of targets) {
    process.stderr.write('Fetching ' + t.park.name + ' …\n');
    const avail = await getParkAvailability(t.park, start, months);
    const wanted = t.wanted.map(normSite);
    let sites = avail.sites.filter((s) => wanted.includes(normSite(s.shortName)));
    // warn for any requested number we couldn't find
    const found = new Set(sites.map((s) => normSite(s.shortName)));
    for (const w of t.wanted) {
      if (!found.has(normSite(w))) process.stderr.write('  ⚠ site "' + w + '" not found at ' + t.park.name + '\n');
    }
    sites.sort((a, b) => normSite(a.shortName).localeCompare(normSite(b.shortName), undefined, { numeric: true }));
    if (avail.alert) process.stderr.write('  ⚠ ' + avail.alert.title + '\n');
    const anyOpen = sites.some((s) => Object.values(s.days).includes('available'));
    if (!anyOpen && sites.length) {
      process.stderr.write('  ⓘ none of your ' + avail.parkName + ' sites have an open day in this range' + (avail.alert ? ' (see notice above)' : '') + '\n');
    }
    parksOut.push({ parkName: avail.parkName, alert: avail.alert, sites });
  }

  const data = {
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    start: isoUTC(start),
    end: isoUTC(addDays(end, -1)),
    parkCount: parksOut.length,
    parks: parksOut,
  };

  applyFavorites(data, cfg);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Cache the assembled data so --rebuild can regenerate the HTML (e.g. after a
  // layout tweak) without re-fetching from the portal.
  fs.writeFileSync(path.join(OUT_DIR, 'last-data.json'), JSON.stringify(data));
  const outPath = path.join(OUT_DIR, 'availability-' + isoUTC(todayUTC()) + '.html');
  fs.writeFileSync(outPath, buildHtml(data));
  const total = parksOut.reduce((n, p) => n + p.sites.length, 0);
  console.log('\n✅ Calendar written: ' + outPath);
  console.log('   ' + parksOut.length + ' park(s), ' + total + ' preferred site(s), ' + data.start + ' → ' + data.end);
  console.log('   Open it in your browser and click a green day to see which sites are free.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const { flags } = parseArgs(process.argv.slice(2));
  try {
    if (flags['list-parks']) return await cmdListParks();
    if (flags['list-sites']) {
      if (!flags.park) throw new Error('--list-sites needs --park "<name>"');
      return await cmdListSites(flags.park);
    }
    if (flags.rebuild) return cmdRebuild();
    if (flags.list) return cmdList();
    if (flags.add) {
      if (!flags.park) throw new Error('--add needs --park "<name>" --sites 1,2,3');
      return await cmdAdd(flags.park, parseSitesArg(flags.sites), !!flags.fav);
    }
    if (flags.remove) {
      if (!flags.park) throw new Error('--remove needs --park "<name>"');
      return await cmdRemove(flags.park, parseSitesArg(flags.sites));
    }
    // build calendar (config-driven, or ad-hoc if --park provided)
    return await cmdBuild({
      adhocPark: typeof flags.park === 'string' ? flags.park : null,
      adhocSites: parseSitesArg(flags.sites),
      months: flags.months ? parseInt(flags.months, 10) : null,
      start: typeof flags.start === 'string' ? flags.start : null,
    });
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exitCode = 1;
  }
})();
