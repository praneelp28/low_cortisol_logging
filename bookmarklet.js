javascript:void(function(){
/* ── lib (inlined) ──────────────────────────────────────────── */
var DU={s:1e3,m:6e4,h:36e5,d:864e5};
function detectTool(u){if(!u)return null;if(u.includes('grafana.cfdata.org')||u.includes('grafana.cloudflare.com'))return'grafana';if(u.includes('kibana.cfdata.org')&&!u.includes('/goto/'))return'kibana';if(u.includes('metrics.cfdata.org')||u.includes('thanos.cfdata.org')||u.includes('prometheus-access.cfdata.org')||u.includes('prometheus.access.'))return'thanos';return null}
function isRel(v){return typeof v==='string'&&v.startsWith('now')}
function strip(v){return typeof v==='string'?v.replace(/\/[smhd]$/,''):v}
function relMs(v){var c=strip(v);if(c==='now')return 0;var m=c.match(/^now-(\d+)([smhd])$/);return m?parseInt(m[1])*DU[m[2]]:null}
function durMs(d){var m=d.match(/^(\d+)([smhd])$/);return m?parseInt(m[1])*DU[m[2]]:null}
function ms2dur(ms){if(ms<=0)return'1h';if(ms%DU.d===0)return ms/DU.d+'d';if(ms%DU.h===0)return ms/DU.h+'h';if(ms%DU.m===0)return ms/DU.m+'m';return Math.round(ms/DU.s)+'s'}
function toMs(v){var n=Number(v);if(!isNaN(n)&&n>1e12)return n;if(!isNaN(n)&&n>1e9)return n*1e3;return Date.parse(v)}
function abs(t){var now=Date.now(),f,o;if(isRel(t.to)){o=now}else{o=toMs(t.to)}if(isRel(t.from)){var off=relMs(t.from);if(off===null)return null;f=now-off}else{f=toMs(t.from)}if(isNaN(f)||isNaN(o))return null;return{from:f,to:o}}

function parseTime(url){
  var tool=detectTool(url);if(!tool)return null;
  try{var u=new URL(url)}catch(e){return null}
  if(tool==='grafana'){
    if(u.pathname.includes('/explore')){var l=u.searchParams.get('left');if(!l)return null;try{var a=JSON.parse(decodeURIComponent(l));if(a&&a[0]&&a[1])return{from:String(a[0]),to:String(a[1])}}catch(e){}return null}
    var f=u.searchParams.get('from'),t=u.searchParams.get('to');return(f&&t)?{from:f,to:t}:null;
  }
  if(tool==='kibana'){
    var h=u.hash;if(!h)return null;var d;try{d=decodeURIComponent(h)}catch(e){d=h}
    var tb=d.match(/time:\(([^)]*)\)/);if(!tb)return null;var inner=tb[1];
    var fq=inner.match(/from:'([^']*)'/),fu=inner.match(/from:([^,)]+)/);
    var tq=inner.match(/to:'([^']*)'/),tu=inner.match(/to:([^,)]+)/);
    var fr=fq?fq[1]:fu?fu[1]:null,tr=tq?tq[1]:tu?tu[1]:null;
    return(fr&&tr)?{from:fr,to:tr}:null;
  }
  if(tool==='thanos'){
    var r=u.searchParams.get('g0.range_input');if(!r)return null;
    var ei=u.searchParams.get('g0.end_input');
    if(ei){var em=Date.parse(ei);if(isNaN(em))return null;var dm=durMs(r);if(!dm)return null;return{from:String(em-dm),to:String(em)}}
    return{from:'now-'+r,to:'now'};
  }
  return null;
}

function writeTime(url,time){
  var tool=detectTool(url);if(!tool)return url;
  try{var u=new URL(url)}catch(e){return url}
  if(tool==='grafana'){
    if(u.pathname.includes('/explore')){var l=u.searchParams.get('left');if(!l)return url;try{var a=JSON.parse(decodeURIComponent(l));if(isRel(time.from)){a[0]=time.from;a[1]=time.to}else{var ab=abs(time);if(!ab)return url;a[0]=String(ab.from);a[1]=String(ab.to)}u.searchParams.set('left',JSON.stringify(a))}catch(e){}return u.toString()}
    if(isRel(time.from)){u.searchParams.set('from',time.from);u.searchParams.set('to',time.to)}else{var ab=abs(time);if(!ab)return url;u.searchParams.set('from',String(ab.from));u.searchParams.set('to',String(ab.to))}return u.toString();
  }
  if(tool==='kibana'){
    var h=u.hash;if(!h)return url;var d;try{d=decodeURIComponent(h)}catch(e){d=h}
    var fs,ts;if(isRel(time.from)){fs=strip(time.from);ts=strip(time.to)}else{var ab=abs(time);if(!ab)return url;fs="'"+new Date(ab.from).toISOString()+"'";ts="'"+new Date(ab.to).toISOString()+"'"}
    var tr=/time:\([^)]*\)/;if(tr.test(d)){d=d.replace(tr,'time:(from:'+fs+',to:'+ts+')')}else{var gr=/_g=\(([^)]*)\)/;var gm=d.match(gr);if(gm){var inn=gm[1];d=d.replace(gr,'_g=('+(inn?'time:(from:'+fs+',to:'+ts+'),'+inn:'time:(from:'+fs+',to:'+ts+')')+')')}}
    u.hash=d;return u.toString();
  }
  if(tool==='thanos'){
    var hp=u.searchParams.has('g0.expr')||u.searchParams.has('g0.range_input');if(!hp)return url;
    if(isRel(time.from)){var off=relMs(time.from);var dur=off!==null?ms2dur(off):'1h';for(var i=0;i<20;i++){if(!u.searchParams.has('g'+i+'.expr')&&!u.searchParams.has('g'+i+'.range_input'))break;u.searchParams.set('g'+i+'.range_input',dur);u.searchParams.delete('g'+i+'.end_input');u.searchParams.delete('g'+i+'.moment_input')}}
    else{var ab=abs(time);if(!ab)return url;var dur=ms2dur(ab.to-ab.from);var es=new Date(ab.to).toISOString().replace('T',' ').replace(/\.\d+Z$/,'');for(var i=0;i<20;i++){if(!u.searchParams.has('g'+i+'.expr')&&!u.searchParams.has('g'+i+'.range_input'))break;u.searchParams.set('g'+i+'.range_input',dur);u.searchParams.set('g'+i+'.end_input',es)}}
    return u.toString();
  }
  return url;
}

function fmtTime(t){
  if(!t)return'none';
  function sh(v){var ms=toMs(v);if(isNaN(ms))return String(v);return new Date(ms).toISOString().replace('T',' ').replace(/\.\d+Z$/,' UTC')}
  var f=isRel(t.from)?t.from:sh(t.from);var o=isRel(t.to)?t.to:sh(t.to);return f+' → '+o;
}

function toolLabel(t){return{grafana:'Grafana',kibana:'Kibana',thanos:'Thanos/Prom'}[t]||t}

/* ── overlay UI ─────────────────────────────────────────────── */
var old=document.getElementById('lcl-overlay');if(old)old.remove();

var tool=detectTool(location.href);
var time=parseTime(location.href);

var el=document.createElement('div');el.id='lcl-overlay';
el.innerHTML='<style>'
+'#lcl-overlay{position:fixed;top:12px;right:12px;z-index:2147483647;width:280px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",monospace;font-size:12px;background:#f4f0fa;color:#3d3456;border-radius:12px;border:1.5px solid #e4ddf0;box-shadow:0 4px 24px rgba(120,100,160,0.18);padding:14px;line-height:1.5}'
+'#lcl-overlay *{box-sizing:border-box}'
+'#lcl-overlay .lcl-title{font-size:10px;font-weight:600;letter-spacing:0.1em;color:#8b82a0;text-transform:uppercase;margin-bottom:6px}'
+'#lcl-overlay .lcl-badge{display:inline-block;font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;margin-bottom:4px}'
+'#lcl-overlay .lcl-badge.grafana{background:#f5c77e;color:#5a4012}'
+'#lcl-overlay .lcl-badge.kibana{background:#9ee0b8;color:#1a4a2a}'
+'#lcl-overlay .lcl-badge.thanos{background:#a0c4f0;color:#1e3a5a}'
+'#lcl-overlay .lcl-time{font-family:monospace;font-size:11px;color:#3d3456;margin:4px 0 10px;word-break:break-all}'
+'#lcl-overlay .lcl-row{display:flex;gap:6px;margin-bottom:6px}'
+'#lcl-overlay button{flex:1;padding:8px;border:none;border-radius:8px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;transition:transform 0.1s,box-shadow 0.1s}'
+'#lcl-overlay button:active{transform:scale(0.97)}'
+'#lcl-overlay .lcl-copy{background:#c4b0e0;color:#2d2444}'
+'#lcl-overlay .lcl-apply{background:#9ee0b8;color:#1a4a2a}'
+'#lcl-overlay .lcl-close{background:transparent;color:#8b82a0;font-size:16px;position:absolute;top:6px;right:10px;padding:2px 6px;flex:none}'
+'#lcl-overlay input{width:100%;padding:7px 8px;border:1.5px solid #e4ddf0;border-radius:8px;font-family:monospace;font-size:11px;color:#3d3456;background:#fff;outline:none;margin-bottom:6px}'
+'#lcl-overlay input:focus{border-color:#c4b0e0}'
+'#lcl-overlay .lcl-status{text-align:center;font-size:10px;color:#8b82a0;min-height:14px}'
+'</style>'
+'<button class="lcl-close" id="lcl-close">&times;</button>'
+'<div class="lcl-title">~ low cortisol logged ~</div>'
+(tool?'<span class="lcl-badge '+tool+'">'+toolLabel(tool)+'</span>':'')
+'<div class="lcl-time">'+(time?fmtTime(time):'no time detected')+'</div>'
+'<div class="lcl-row"><button class="lcl-copy" id="lcl-copy"'+(time?'':' disabled')+'>copy time</button></div>'
+'<div class="lcl-title" style="margin-top:6px">apply from another tab</div>'
+'<input id="lcl-input" placeholder="paste time here (e.g. now-1h|now)" />'
+'<div class="lcl-row"><button class="lcl-apply" id="lcl-apply">apply</button></div>'
+'<div class="lcl-status" id="lcl-status"></div>';

document.body.appendChild(el);

/* ── handlers ───────────────────────────────────────────────── */
document.getElementById('lcl-close').onclick=function(){el.remove()};

document.getElementById('lcl-copy').onclick=function(){
  if(!time)return;
  var s=time.from+'|'+time.to;
  navigator.clipboard.writeText(s).then(function(){
    document.getElementById('lcl-status').textContent='copied!';
    document.getElementById('lcl-status').style.color='#6ecf94';
  });
};

document.getElementById('lcl-apply').onclick=function(){
  var v=document.getElementById('lcl-input').value.trim();
  if(!v){document.getElementById('lcl-status').textContent='paste a time first';document.getElementById('lcl-status').style.color='#e8879a';return}
  var parts=v.split('|');
  if(parts.length!==2){document.getElementById('lcl-status').textContent='format: from|to';document.getElementById('lcl-status').style.color='#e8879a';return}
  var newTime={from:parts[0].trim(),to:parts[1].trim()};
  var newUrl=writeTime(location.href,newTime);
  if(newUrl&&newUrl!==location.href){location.href=newUrl}
  else{document.getElementById('lcl-status').textContent='nothing changed';document.getElementById('lcl-status').style.color='#8b82a0'}
};
}())
