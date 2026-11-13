/* 아이카 위치 중계 (T14: 장기 기기 ID, GPSLogger, 1회 페어링) — 휴대폰 GPS → Cloudflare → 헤드유닛.
   navigator.geolocation 을 감싸서, 휴대폰 위치가 들어오면 그것을 우선 사용하고 없으면 기기 자체 GPS로 대체. */
(function () {
  const W = 'https://dualpage-loc.holhiholl.workers.dev', FRESH = 20000, LSK = 'v10relay';
  const ID_LONG = /^[a-z0-9]{12,32}$/, ID_SHORT = /^\d{6}$/;
  function makeId() {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    let s = 'ic'; for (let i = 0; i < b.length; i++) s += abc[b[i] % abc.length];
    return s;
  }
  function okId(s) { return ID_SHORT.test(s) || ID_LONG.test(s); }
  let S = {}; try { S = JSON.parse(localStorage[LSK] || '{}'); } catch (e) { }
  if (!okId(S.id) || ID_SHORT.test(S.id)) { S.id = makeId(); try { localStorage[LSK] = JSON.stringify({ id: S.id }); } catch (e) { } }
  else { S = { id: S.id }; try { localStorage[LSK] = JSON.stringify(S); } catch (e) { } }
  const NATIVE = navigator.geolocation || null;
  const R = window.RELAY = { id: S.id, code: S.id, last: null, lastRx: 0, ws: null, mode: 'off', watchers: new Map(), nid: 1, listeners: [] };
  const fresh = () => R.last && Date.now() - R.lastRx < FRESH;
  const toPos = p => ({ coords: { latitude: p.lat, longitude: p.lng, accuracy: p.acc == null ? 30 : p.acc, heading: p.heading, speed: p.speed, altitude: null, altitudeAccuracy: null }, timestamp: p.ts || Date.now(), relay: true });
  function feed(p, age) { if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return; if (R.last && p.rx && R.last.rx === p.rx) return; age = +age || 0; if (age > FRESH) return; R.last = p; R.lastRx = Date.now() - age; const pos = toPos(p); R.watchers.forEach(w => { try { w.ok(pos); } catch (e) { } }); R.listeners.forEach(f => { try { f(pos); } catch (e) { } }); ui(); }
  R.feed = feed;
  R.phoneUrl = () => new URL('phone.html?id=' + encodeURIComponent(R.id), location.href).href;
  R.gUrl = () => W + '/g/' + R.id + '?lat=%LAT&lon=%LON&spd=%SPD&dir=%DIR&acc=%ACC&t=%TIMESTAMP';
  R.fmtId = id => String(id || '').replace(/(.{2})/g, '$1 ').trim();
  function connect() { if (R.ws) try { R.ws.close(); } catch (e) { } let ws; try { ws = new WebSocket(W.replace('https', 'wss') + '/ws?id=' + encodeURIComponent(R.id)); } catch (e) { return poll(); }
    R.ws = ws; R.mode = 'ws…'; ws.onopen = () => { R.mode = 'ws'; ui(); }; ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type == 'pos') feed(m.pos, m.age); } catch (x) { } };
    ws.onclose = ws.onerror = () => { if (R.ws !== ws) return; R.ws = null; R.mode = 'poll'; ui(); clearTimeout(R.rc); R.rc = setTimeout(connect, 5000); }; }
  async function pollOnce() { try { const r = await fetch(W + '/loc?id=' + encodeURIComponent(R.id), { cache: 'no-store' }); const j = await r.json(); if (j && j.pos) feed(j.pos, j.age); } catch (e) { } }
  function poll() { clearInterval(R.pi); R.pi = setInterval(() => { if (!R.ws || R.ws.readyState !== 1) pollOnce(); }, 1000); }
  R.start = () => { connect(); poll(); pollOnce(); clearInterval(R.ka); R.ka = setInterval(() => { try { R.ws && R.ws.readyState === 1 && R.ws.send('ping'); } catch (e) { } ui(); }, 15000); };
  R.resetId = () => { R.id = S.id = makeId(); R.code = R.id; try { localStorage[LSK] = JSON.stringify({ id: S.id }); } catch (e) { } R.last = null; R.lastRx = 0; R.start(); ui(); if (window.relayModal) relayModal(true); };
  R.newCode = R.resetId;
  const G = {
    getCurrentPosition(ok, no, o) { if (fresh()) return setTimeout(() => ok(toPos(R.last)), 0); const to = (o && o.timeout) || 10000; let done = false;
      const fin = (f, v) => { if (done) return; done = true; clearTimeout(t); R.listeners = R.listeners.filter(x => x !== lis); f && f(v); };
      const lis = p => fin(ok, p); R.listeners.push(lis); const t = setTimeout(() => fin(no, { code: 3, message: 'timeout', TIMEOUT: 3 }), to);
      if (NATIVE) try { NATIVE.getCurrentPosition(p => { if (!fresh()) fin(ok, p); }, e => { setTimeout(() => fin(no, e), fresh() ? 0 : Math.min(to, 4000)); }, o); } catch (e) { } },
    watchPosition(ok, no, o) { const id = R.nid++; const w = { ok, no, nat: null }; R.watchers.set(id, w); if (fresh()) setTimeout(() => ok(toPos(R.last)), 0);
      if (NATIVE) try { w.nat = NATIVE.watchPosition(p => { if (!fresh()) ok(p); }, e => { if (!fresh() && no) no(e); }, o); } catch (e) { } return id; },
    clearWatch(id) { const w = R.watchers.get(id); if (w && w.nat != null && NATIVE) try { NATIVE.clearWatch(w.nat); } catch (e) { } R.watchers.delete(id); }
  };
  try { Object.defineProperty(navigator, 'geolocation', { value: G, configurable: true }); } catch (e) { try { navigator.geolocation = G; } catch (x) { } }
  function drawQr(el, data) { if (!el) return; try { const q = qrcode(0, 'M'); q.addData(data); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch (e) { } }
  function showTab(name) {
    const web = document.getElementById('rl-web'), app = document.getElementById('rl-app');
    if (!web || !app) return; const isApp = name === 'app';
    web.hidden = isApp; app.hidden = !isApp;
    document.querySelectorAll('#rl-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === (isApp ? 'app' : 'web')));
  }
  function ui() {
    const c = document.getElementById('rlc'); if (!c) return;
    const ok = fresh(); c.classList.toggle('on', ok);
    c.innerHTML = ok ? '📱 폰 GPS 연결됨' : '📱 폰 연결 안됨';
    const m = document.getElementById('rlm');
    if (m && !m.hidden) {
      const st = document.getElementById('rlst');
      if (st) st.textContent = ok ? '✅ 연결됨 · 위치 수신 중 (' + Math.round((Date.now() - R.lastRx) / 1000) + '초 전)' : '⏳ 휴대폰 연결을 기다리는 중… 한 번만 연결하면 다음부터 자동입니다.';
      if (ok && !R.autoClosed) { R.autoClosed = 1; setTimeout(() => relayModal(false), 2000); }
    }
  }
  window.relayModal = function (show) {
    const m = document.getElementById('rlm'); if (!m) return; m.hidden = !show; if (!show) return;
    document.getElementById('rlcode').textContent = R.fmtId(R.id);
    document.getElementById('rlurl').textContent = R.phoneUrl().replace(/^https?:\/\//, '');
    const g = R.gUrl(); document.getElementById('rlgurl').textContent = g;
    const apk = document.getElementById('rlapk'); if (apk) apk.href = new URL('app/icar-gps.apk', location.href).href;
    const go = () => { drawQr(document.getElementById('rlqr'), R.phoneUrl()); drawQr(document.getElementById('rlqr2'), g); };
    if (window.qrcode) go(); else { const s = document.createElement('script'); s.src = './qrcode.js'; s.onload = go; document.head.appendChild(s); }
    showTab('web'); ui();
  };
  function copy(t) { try { navigator.clipboard.writeText(t); } catch (e) { try { const i = document.createElement('textarea'); i.value = t; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove(); } catch (x) { } } }
  function mount() {
    const css = document.createElement('style');
    css.textContent = `#rlc{position:absolute;z-index:1600;right:10px;bottom:30px;height:44px;padding:0 14px;border-radius:22px;border:1px solid rgba(255,255,255,.15);background:rgba(18,21,26,.88);color:#ffb4b4;font:600 15px system-ui,sans-serif;cursor:pointer}#rlc.on{color:#7dffb0}
#rlm{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:8px}#rlm[hidden]{display:none}
#rlb{background:#151821;color:#fff;border-radius:22px;padding:14px 16px 12px;display:flex;flex-direction:column;gap:8px;width:min(920px,96vw);max-height:94vh;overflow:auto;border:1px solid rgba(255,255,255,.12);font-family:system-ui,sans-serif}
#rl-tabs{display:flex;gap:6px;flex-wrap:wrap}#rl-tabs button{height:42px;padding:0 14px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:#2a2d38;color:#fff;font-size:15px;font-weight:700}#rl-tabs button.on{background:#7b5cff}
.rl-pane{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}.rl-pane[hidden]{display:none!important}
#rlqr,#rlqr2{width:min(32vh,200px);height:min(32vh,200px);background:#fff;border-radius:12px;padding:6px;flex:none}#rlqr svg,#rlqr2 svg{width:100%;height:100%}
#rlt h3{margin:0 0 6px;font-size:20px}#rlcode{font-size:clamp(20px,4.5vh,32px);font-weight:800;letter-spacing:2px;color:#ffd84d;word-break:break-all}
#rlt p,#rl-app p{margin:6px 0;color:#aab;font-size:14px;line-height:1.45}#rlst{font-size:16px;margin:4px 0}
#rlgurl{font-family:ui-monospace,monospace;font-size:11px;line-height:1.35;word-break:break-all;background:#0b0d12;padding:8px;border-radius:8px;color:#d7deea}
#rl-app ol{margin:4px 0 0 1.15rem;padding:0;color:#d7deea;font-size:14px;line-height:1.45}#rl-app li{margin:3px 0}
#rlb .rl-actions{display:flex;flex-wrap:wrap;gap:6px}#rlb .rl-actions button,a.rl-btn{height:44px;padding:0 14px;border-radius:14px;border:1px solid rgba(255,255,255,.15);background:#2a2d38;color:#fff;font-size:15px;font-weight:600;display:inline-flex;align-items:center;text-decoration:none;cursor:pointer}
#rlnote{font-size:13px;color:#8a90a0}body.short #rlqr,body.short #rlqr2{width:140px;height:140px}
/* N8: QR은 모든 패널 폭에서 가로·세로 가운데 */
#rlb .rl-pane{flex-direction:column!important;flex-wrap:nowrap!important;align-items:center!important;justify-content:center!important;gap:10px!important;width:100%}
#rlb .rl-qrbox{width:100%;display:flex!important;align-items:center;justify-content:center;flex:none;margin:0 auto}
#rlb #rlqr,#rlb #rlqr2{margin:0 auto!important;display:flex;align-items:center;justify-content:center}
#rlb #rlt,#rlb #rl-app>div:not(.rl-qrbox){width:100%;max-width:640px;text-align:center}#rlb #rl-app ol{text-align:left;display:inline-block}#rlb #rlgurl{text-align:left}
#rlb #rl-tabs,#rlb .rl-actions{justify-content:center}#rlst{text-align:center}`;
    document.head.appendChild(css);
    const c = document.createElement('button'); c.id = 'rlc'; c.onclick = () => relayModal(true); (document.getElementById('mapw') || document.body).appendChild(c);
    const m = document.createElement('div'); m.id = 'rlm'; m.hidden = true;
    m.innerHTML = '<div id="rlb"><div id="rl-tabs"><button type="button" class="on" data-tab="web">웹으로 연결</button><button type="button" data-tab="app">앱으로 연결</button></div>'
      + '<div id="rl-web" class="rl-pane"><div class="rl-qrbox"><div id="rlqr"></div></div><div id="rlt"><h3>📱 휴대폰 브라우저</h3><p>안드로이드 크롬으로 QR을 찍으세요. <b>한 번만</b> 연결하면 다음부터 자동으로 이어집니다. 아이폰은 지원하지 않습니다.</p><div id="rlcode"></div><p id="rlurl"></p></div></div>'
      + '<div id="rl-app" class="rl-pane" hidden><div class="rl-qrbox"><div id="rlqr2"></div></div><div><h3>앱으로 연결 (안드로이드)</h3><p>아래 주소를 GPSLogger에 한 번만 넣으면 백그라운드에서 위치가 옵니다. QR을 찍어도 됩니다.</p><div id="rlgurl"></div>'
      + '<ol><li>Play 스토어에서 <b>GPSLogger</b>(무료)를 설치합니다.</li><li><b>로그 기록 → Log to custom URL</b>(사용자 지정 URL로 기록)을 켭니다.</li><li>URL에 위 주소를 <b>그대로</b> 붙여 넣습니다.</li><li>HTTP 방법: <b>GET</b> · 주기: <b>1초</b> · 거리: <b>0</b>.</li><li>(선택) 부팅 시 자동 시작, 배터리 최적화 제외.</li></ol>'
      + '<p id="rlnote">또는 <b>아이카 GPS</b> 앱을 설치하세요. 앱에서 이 QR(웹 주소)이나 기기 아이디로 연결하면 백그라운드 전송이 됩니다. 아이폰은 지원하지 않습니다.</p></div></div>'
      + '<div id="rlst"></div><div class="rl-actions"><button type="button" id="rlclose">닫기</button><button type="button" id="rlcopy">주소 복사</button><a class="rl-btn" id="rlapk">아이카 GPS 앱 받기</a><button type="button" id="rlnew">새 기기 연결</button></div></div>';
    m.onclick = e => { if (e.target === m) relayModal(false); };
    document.body.appendChild(m);
    document.getElementById('rl-tabs').onclick = e => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); };
    document.getElementById('rlclose').onclick = () => relayModal(false);
    document.getElementById('rlcopy').onclick = () => { const app = !document.getElementById('rl-app').hidden; copy(app ? R.gUrl() : R.phoneUrl()); const st = document.getElementById('rlst'); if (st) st.textContent = '📋 주소를 복사했습니다.'; };
    document.getElementById('rlnew').onclick = () => { if (confirm('새 기기 아이디를 만들면 기존에 연결된 폰·앱은 다시 연결해야 합니다. 계속할까요?')) R.resetId(); };
    ui(); R.start();
    setTimeout(() => { if (!window.NOAUTOQR && !fresh() && !R.nativeOk && !sessionStorage.rlShown) { sessionStorage.rlShown = 1; relayModal(true); } }, 4000);
    if (NATIVE && !window.NO_NATIVE_PROBE) try { NATIVE.getCurrentPosition(() => { R.nativeOk = 1; }, () => { }, { timeout: 3500, maximumAge: 600000 }); } catch (e) { }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
