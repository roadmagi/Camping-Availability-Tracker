(function (root) {
  'use strict';
  var WD = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  var MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function iso(y,m,d){ return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'); }
  // Escapes &<>"' — portal-derived fields must only be placed in element text or QUOTED attributes.
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function statusClass(st){ return st==='available'?'available':st==='booked'?'booked':st==='closed'?'closed':'empty'; }
  function monthsBetween(startIso,endIso){
    var sa=startIso.split('-').map(Number), ea=endIso.split('-').map(Number);
    var out=[], y=sa[0], m=sa[1]-1, endY=ea[0], endM=ea[1]-1;
    while(y<endY || (y===endY && m<=endM)){ out.push([y,m]); m++; if(m>11){m=0;y++;} }
    return out;
  }
  // Build one month's calendar HTML. days: {iso:status}. todayIso: highlight.
  function renderCal(days,y,m,todayIso){
    var first=new Date(Date.UTC(y,m,1)).getUTCDay();
    var dim=new Date(Date.UTC(y,m+1,0)).getUTCDate();
    var cells='';
    for(var w=0;w<WD.length;w++) cells+='<div class="wd">'+WD[w]+'</div>';
    for(var i=0;i<first;i++) cells+='<div class="cell empty"></div>';
    for(var d=1;d<=dim;d++){
      var k=iso(y,m,d), st=days[k]||'';
      var cls=statusClass(st);
      var attr=st?' data-date="'+k+'"':'';
      var tcls=(k===todayIso)?' today':'';
      cells+='<div class="cell '+cls+tcls+'"'+attr+'>'+d+'</div>';
    }
    return '<div class="cal"><div class="mon">'+MON[m]+' '+y+'</div><div class="grid">'+cells+'</div></div>';
  }
  // Build one site's row (label + a calendar per month). Two tiers: best (베스트)
  // and recommended (추천) get a colored tag + sit in their own group.
  function siteRowHtml(site,months,todayIso){
    var bits=[]; if(site.type)bits.push(site.type); if(site.cost!=null)bits.push('$'+site.cost);
    var tag=(/^[0-9]/.test(site.shortName)?'#':'')+escapeHtml(site.shortName);
    var tier=site.tier==='best'?' best':site.tier==='recommended'?' rec':'';
    var pill=site.tier==='best'?'<span class="tier-tag best">★ 베스트</span> '
            :site.tier==='recommended'?'<span class="tier-tag rec">추천</span> ':'';
    var h='<div class="site'+tier+'"><div class="months">'+
      '<div class="lbl"><div class="lbl-id">'+pill+tag+(site.name&&!/^\d+$/.test(site.name)?' '+escapeHtml(site.name):'')+'</div>'+
      (bits.length?'<div class="lbl-sub">'+escapeHtml(bits.join(' · '))+'</div>':'')+'</div>';
    for(var i=0;i<months.length;i++) h+=renderCal(site.days,months[i][0],months[i][1],todayIso);
    return h+'</div></div>';
  }
  var api={ WD:WD, MON:MON, iso:iso, escapeHtml:escapeHtml, statusClass:statusClass, monthsBetween:monthsBetween, renderCal:renderCal, siteRowHtml:siteRowHtml };
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.Calendar=api;
})(typeof window!=='undefined'?window:globalThis);
