/* 아이카 위치 중계 (T13) — 휴대폰 GPS → Cloudflare → 헤드유닛.
   navigator.geolocation 을 감싸서, 휴대폰 위치가 들어오면 그것을 우선 사용하고 없으면 기기 자체 GPS로 대체. */
(function(){
 const W='https://dualpage-loc.holhiholl.workers.dev',FRESH=20000;
 const LSK='v10relay';let S={};try{S=JSON.parse(localStorage[LSK]||'{}')}catch(e){}
 if(!/^\d{6}$/.test(S.code||'')){S.code=String(Math.floor(100000+Math.random()*900000));try{localStorage[LSK]=JSON.stringify(S)}catch(e){}}
 const NATIVE=navigator.geolocation||null;
 const R=window.RELAY={code:S.code,last:null,lastRx:0,ws:null,mode:'off',watchers:new Map(),nid:1,listeners:[]};
 const fresh=()=>R.last&&Date.now()-R.lastRx<FRESH;
 const toPos=p=>({coords:{latitude:p.lat,longitude:p.lng,accuracy:p.acc==null?30:p.acc,heading:p.heading,speed:p.speed,altitude:null,altitudeAccuracy:null},timestamp:p.ts||Date.now(),relay:true});
 function feed(p,age){if(!p||!isFinite(p.lat)||!isFinite(p.lng))return;if(R.last&&p.rx&&R.last.rx===p.rx)return;age=+age||0;if(age>FRESH)return;R.last=p;R.lastRx=Date.now()-age;const pos=toPos(p);
  R.watchers.forEach(w=>{try{w.ok(pos)}catch(e){}});R.listeners.forEach(f=>{try{f(pos)}catch(e){}});ui()}
 R.feed=feed;
 function connect(){if(R.ws)try{R.ws.close()}catch(e){}let ws;try{ws=new WebSocket(W.replace('https','wss')+'/ws?code='+R.code)}catch(e){return poll()}
  R.ws=ws;R.mode='ws…';ws.onopen=()=>{R.mode='ws';ui()};ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type=='pos')feed(m.pos,m.age)}catch(x){}};
  ws.onclose=ws.onerror=()=>{if(R.ws!==ws)return;R.ws=null;R.mode='poll';ui();clearTimeout(R.rc);R.rc=setTimeout(connect,5000)}}
 async function pollOnce(){try{const r=await fetch(W+'/loc?code='+R.code,{cache:'no-store'});const j=await r.json();if(j&&j.pos)feed(j.pos,j.age)}catch(e){}}
 function poll(){clearInterval(R.pi);R.pi=setInterval(()=>{if(!R.ws||R.ws.readyState!==1)pollOnce()},2000)}
 R.start=()=>{connect();poll();pollOnce();clearInterval(R.ka);R.ka=setInterval(()=>{try{R.ws&&R.ws.readyState===1&&R.ws.send('ping')}catch(e){}ui()},15000)};
 R.newCode=()=>{R.code=S.code=String(Math.floor(100000+Math.random()*900000));try{localStorage[LSK]=JSON.stringify(S)}catch(e){}R.last=null;R.lastRx=0;R.start();ui();if(window.relayModal)relayModal(true)};
 // geolocation 래퍼
 const G={
  getCurrentPosition(ok,no,o){if(fresh())return setTimeout(()=>ok(toPos(R.last)),0);const to=(o&&o.timeout)||10000;let done=false;
   const fin=(f,v)=>{if(done)return;done=true;clearTimeout(t);R.listeners=R.listeners.filter(x=>x!==lis);f&&f(v)};
   const lis=p=>fin(ok,p);R.listeners.push(lis);const t=setTimeout(()=>fin(no,{code:3,message:'timeout',TIMEOUT:3}),to);
   if(NATIVE)try{NATIVE.getCurrentPosition(p=>{if(!fresh())fin(ok,p)},e=>{setTimeout(()=>fin(no,e),fresh()?0:Math.min(to,4000))},o)}catch(e){}},
  watchPosition(ok,no,o){const id=R.nid++;const w={ok,no,nat:null};R.watchers.set(id,w);if(fresh())setTimeout(()=>ok(toPos(R.last)),0);
   if(NATIVE)try{w.nat=NATIVE.watchPosition(p=>{if(!fresh())ok(p)},e=>{if(!fresh()&&no)no(e)},o)}catch(e){}return id},
  clearWatch(id){const w=R.watchers.get(id);if(w&&w.nat!=null&&NATIVE)try{NATIVE.clearWatch(w.nat)}catch(e){}R.watchers.delete(id)}};
 try{Object.defineProperty(navigator,'geolocation',{value:G,configurable:true})}catch(e){try{navigator.geolocation=G}catch(x){}}
 // UI
 function ui(){const c=document.getElementById('rlc');if(!c)return;const ok=fresh();c.classList.toggle('on',ok);c.innerHTML=ok?'📱 폰 GPS 연결됨':'📱 폰 연결 안됨 · '+R.code;const m=document.getElementById('rlm');if(m&&!m.hidden){document.getElementById('rlst').textContent=ok?'✅ 연결됨 · 위치 수신 중 ('+Math.round((Date.now()-R.lastRx)/1000)+'초 전)':'⏳ 휴대폰 연결을 기다리는 중…';if(ok&&!R.autoClosed){R.autoClosed=1;setTimeout(()=>relayModal(false),1500)}}}
 window.relayModal=function(show){const m=document.getElementById('rlm');if(!m)return;m.hidden=!show;if(!show)return;
  const url=new URL('phone.html?code='+R.code,location.href).href;document.getElementById('rlcode').textContent=R.code.replace(/(\d{3})(\d{3})/,'$1 $2');document.getElementById('rlurl').textContent=url.replace(/^https?:\/\//,'');
  const draw=()=>{try{const q=qrcode(0,'M');q.addData(url);q.make();document.getElementById('rlqr').innerHTML=q.createSvgTag({cellSize:5,margin:2,scalable:true})}catch(e){}};
  if(window.qrcode)draw();else{const s=document.createElement('script');s.src='./qrcode.js';s.onload=draw;document.head.appendChild(s)}ui()};
 function mount(){const css=document.createElement('style');css.textContent=`#rlc{position:absolute;z-index:1600;right:10px;bottom:30px;height:44px;padding:0 14px;border-radius:22px;border:1px solid rgba(255,255,255,.15);background:rgba(18,21,26,.88);color:#ffb4b4;font:600 15px system-ui,sans-serif;cursor:pointer}#rlc.on{color:#7dffb0}
#rlm{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center}#rlm[hidden]{display:none}#rlb{background:#151821;color:#fff;border-radius:22px;padding:18px 22px;display:flex;gap:22px;align-items:center;max-width:94vw;max-height:94vh;border:1px solid rgba(255,255,255,.12);font-family:system-ui,sans-serif}
#rlqr{width:min(42vh,260px);height:min(42vh,260px);background:#fff;border-radius:12px;padding:6px;flex:none}#rlqr svg{width:100%;height:100%}#rlt h3{margin:0 0 6px;font-size:22px}#rlcode{font-size:clamp(34px,8vh,60px);font-weight:800;letter-spacing:4px;color:#ffd84d}#rlt p{margin:6px 0;color:#aab;font-size:15px}#rlst{font-size:17px;margin:8px 0}#rlt button{height:48px;padding:0 16px;margin:6px 6px 0 0;border-radius:14px;border:1px solid rgba(255,255,255,.15);background:#2a2d38;color:#fff;font-size:16px;font-weight:600}`;document.head.appendChild(css);
  const c=document.createElement('button');c.id='rlc';c.onclick=()=>relayModal(true);(document.getElementById('mapw')||document.body).appendChild(c);
  const m=document.createElement('div');m.id='rlm';m.hidden=true;m.innerHTML='<div id="rlb"><div id="rlqr"></div><div id="rlt"><h3>📱 휴대폰 GPS 연결</h3><p>이 기기에는 GPS가 없어요. 휴대폰 카메라로 QR을 찍거나<br>아래 주소에서 코드를 입력하세요.</p><div id="rlcode"></div><p id="rlurl"></p><div id="rlst"></div><button onclick="relayModal(false)">닫기</button><button onclick="RELAY.newCode()">새 코드</button></div></div>';m.onclick=e=>{if(e.target===m)relayModal(false)};document.body.appendChild(m);
  ui();R.start();setTimeout(()=>{if(!window.NOAUTOQR&&!fresh()&&!R.nativeOk&&!sessionStorage.rlShown){sessionStorage.rlShown=1;relayModal(true)}},4000);
  if(NATIVE)try{NATIVE.getCurrentPosition(()=>{R.nativeOk=1},()=>{},{timeout:3500,maximumAge:600000})}catch(e){}}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
