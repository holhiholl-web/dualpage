/* 아이카 내비 N3 — 순수 로직 코어 (DOM 없음, Node 테스트 가능)
   좌표 규칙: 앱 내부는 항상 {lat, lon}. TMAP 응답의 [lon, lat] 순서는 mapRoute/mapPoi 한 곳에서만 변환한다. */
(function (root, factory) { const m = factory(); if (typeof module === 'object' && module.exports) module.exports = m; else root.NavCore = m; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RAD = Math.PI / 180, EARTH = 6371008.8;
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const toNum = v => { if (v === null || v === undefined || v === '') return NaN; const n = typeof v === 'number' ? v : Number(String(v).trim()); return Number.isFinite(n) ? n : NaN; };
  const validLL = (lat, lon) => isNum(lat) && isNum(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0);
  const inKorea = (lat, lon) => validLL(lat, lon) && lat >= 32.5 && lat <= 39.5 && lon >= 124 && lon <= 132.5;
  const normDeg = d => ((d % 360) + 360) % 360;
  const angDiff = (a, b) => { let d = normDeg(b) - normDeg(a); if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
  const lerpAng = (a, b, t) => normDeg(a + angDiff(a, b) * t);
  function dist(a, b) {
    const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function bearing(a, b) {
    const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
    const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
    return normDeg(Math.atan2(y, x) / RAD);
  }
  function offset(p, brg, m) { // 등거리 근사 (짧은 거리)
    const dn = Math.cos(brg * RAD) * m, de = Math.sin(brg * RAD) * m;
    return { lat: p.lat + dn / EARTH / RAD, lon: p.lon + de / (EARTH * Math.cos(p.lat * RAD)) / RAD };
  }
  function cumulative(path) { const c = new Array(path.length); let s = 0; for (let i = 0; i < path.length; i++) { if (i) s += dist(path[i - 1], path[i]); c[i] = s; } return c; }
  // 경로 위 투영: hint 주변 창을 먼저 보고, 멀면 전체 탐색
  function project(path, cum, p, hint) {
    if (!path || path.length < 2) return null;
    const cosL = Math.cos(p.lat * RAD), kx = EARTH * RAD * cosL, ky = EARTH * RAD;
    const scan = (from, to) => {
      let best = null;
      for (let i = Math.max(0, from); i < Math.min(path.length - 1, to); i++) {
        const a = path[i], b = path[i + 1];
        const ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky, bx = (b.lon - p.lon) * kx, by = (b.lat - p.lat) * ky;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        let t = L2 ? -(ax * dx + ay * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
        const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(px, py);
        if (!best || d < best.off) best = { idx: i, t, off: d };
      }
      return best;
    };
    let best = null;
    if (isNum(hint)) { best = scan(hint - 5, hint + 60); if (best && best.off > 60) best = null; }
    if (!best) best = scan(0, path.length);
    const a = path[best.idx], b = path[best.idx + 1];
    const point = { lat: a.lat + (b.lat - a.lat) * best.t, lon: a.lon + (b.lon - a.lon) * best.t };
    return { idx: best.idx, t: best.t, off: best.off, point, along: cum[best.idx] + (cum[best.idx + 1] - cum[best.idx]) * best.t, segBearing: bearing(a, b) };
  }
  function pointAt(path, cum, along) {
    if (!path.length) return null; if (path.length === 1 || along <= 0) return { lat: path[0].lat, lon: path[0].lon, bearing: path.length > 1 ? bearing(path[0], path[1]) : 0, idx: 0 };
    const total = cum[cum.length - 1]; if (along >= total) { const n = path.length; return { lat: path[n - 1].lat, lon: path[n - 1].lon, bearing: bearing(path[n - 2], path[n - 1]), idx: n - 2 }; }
    let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= along) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1, t = (along - cum[lo]) / seg, a = path[lo], b = path[hi];
    return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, bearing: bearing(a, b), idx: lo };
  }
  // ---------- 포맷 ----------
  function fmtDist(m) {
    if (!isNum(m) || m < 0) return '-';
    if (m < 1000) return (m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10) + 'm';
    if (m < 10000) return (Math.round(m / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'km';
    return Math.round(m / 1000) + 'km';
  }
  function fmtDur(sec) {
    if (!isNum(sec) || sec < 0) return '-';
    const mTot = Math.round(sec / 60); if (mTot < 1) return '1분 미만';
    const h = Math.floor(mTot / 60), m = mTot % 60; return h ? (m ? h + '시간 ' + m + '분' : h + '시간') : m + '분';
  }
  function fmtClock(ms) {
    if (!isNum(ms)) return '-'; const d = new Date(ms); let h = d.getHours(); const m = d.getMinutes();
    const ap = h < 12 ? '오전' : '오후'; h = h % 12; if (h === 0) h = 12; return ap + ' ' + h + ':' + String(m).padStart(2, '0');
  }
  const eta = (nowMs, sec) => isNum(nowMs) && isNum(sec) && sec >= 0 ? nowMs + sec * 1000 : NaN;
  const fmtWon = n => isNum(n) && n > 0 ? n.toLocaleString('ko-KR') + '원' : '무료';
  // ---------- 회전 코드 (TMAP 공식 turnType 표) ----------
  const TT = {
    11: ['직진', 'straight'], 12: ['좌회전', 'left'], 13: ['우회전', 'right'], 14: ['유턴', 'uturn'], 15: ['P턴', 'uturn'],
    16: ['8시 방향 좌회전', 'sharpleft'], 17: ['10시 방향 좌회전', 'slightleft'], 18: ['2시 방향 우회전', 'slightright'], 19: ['4시 방향 우회전', 'sharpright'],
    43: ['오른쪽', 'slightright'], 44: ['왼쪽', 'slightleft'], 51: ['직진 방향', 'straight'], 52: ['왼쪽 차선', 'keepleft'], 53: ['오른쪽 차선', 'keepright'],
    71: ['첫번째 출구', 'right'], 72: ['두번째 출구', 'right'], 73: ['첫번째 오른쪽 길', 'right'], 74: ['두번째 오른쪽 길', 'right'], 75: ['첫번째 왼쪽 길', 'left'], 76: ['두번째 왼쪽 길', 'left'],
    101: ['오른쪽 고속도로 입구', 'keepright'], 102: ['왼쪽 고속도로 입구', 'keepleft'], 103: ['전방 고속도로 입구', 'straight'], 104: ['오른쪽 고속도로 출구', 'keepright'], 105: ['왼쪽 고속도로 출구', 'keepleft'], 106: ['전방 고속도로 출구', 'straight'],
    111: ['오른쪽 도시고속도로 입구', 'keepright'], 112: ['왼쪽 도시고속도로 입구', 'keepleft'], 113: ['전방 도시고속도로 입구', 'straight'], 114: ['오른쪽 도시고속도로 출구', 'keepright'], 115: ['왼쪽 도시고속도로 출구', 'keepleft'], 116: ['전방 도시고속도로 출구', 'straight'],
    117: ['오른쪽 방향', 'keepright'], 118: ['왼쪽 방향', 'keepleft'], 119: ['지하차도', 'straight'], 120: ['고가도로', 'straight'], 121: ['터널', 'tunnel'], 122: ['교량', 'straight'], 123: ['지하차도 옆', 'straight'], 124: ['고가도로 옆', 'straight'], 130: ['토끼굴 진입', 'straight'],
    150: ['졸음쉼터', 'rest'], 151: ['휴게소', 'rest'], 0: ['휴게소', 'rest'],
    182: ['왼쪽 방향 도착', 'dest'], 183: ['오른쪽 방향 도착', 'dest'], 184: ['경유지', 'via'], 185: ['첫번째 경유지', 'via'], 186: ['두번째 경유지', 'via'], 187: ['세번째 경유지', 'via'], 188: ['네번째 경유지', 'via'], 189: ['다섯번째 경유지', 'via'],
    191: ['제한속도 구간', 'safety'], 192: ['사고다발 구간', 'safety'], 193: ['급커브 구간', 'safety'], 194: ['낙석주의 구간', 'safety'],
    200: ['출발', 'start'], 201: ['목적지', 'dest'], 203: ['목적지 건너편', 'dest'], 233: ['직진', 'straight']
  };
  for (let i = 54; i <= 63; i++) TT[i] = [(i - 53) + '차선', 'lane'];
  for (let i = 131; i <= 142; i++) { const h = i - 130; TT[i] = ['회전교차로 ' + h + '시 방향', 'rotary']; }
  function turnInfo(code) {
    const c = toNum(code); const t = TT[c];
    if (!t) return { code: isNum(c) ? c : null, text: (c >= 1 && c <= 7) ? '안내 없음' : '경로 안내', kind: (c >= 1 && c <= 7) ? 'none' : 'straight', silent: c >= 1 && c <= 7 };
    return { code: c, text: t[0], kind: t[1], silent: false };
  }
  const TURN_KINDS = new Set(['left', 'right', 'uturn', 'sharpleft', 'sharpright', 'slightleft', 'slightright', 'keepleft', 'keepright', 'rotary']);
  // 안내 단계: 이후(>300m) → 잠시 후(≤300m) → 지금(≤ max(40m, 4초 주행거리))
  function stageFor(d, speedMps) {
    if (!isNum(d)) return 'later'; const now = Math.max(40, (isNum(speedMps) ? speedMps : 0) * 4);
    if (d <= now) return 'now'; if (d <= 300) return 'soon'; return 'later';
  }
  const STAGE_LABEL = { later: '이후', soon: '잠시 후', now: '지금' };
  function phrase(g, d, stage) {
    if (!g) return ''; const ti = turnInfo(g.turnType);
    if (ti.kind === 'dest') return stage === 'now' ? '목적지에 도착했습니다. 안내를 종료합니다.' : fmtDistSpeech(d) + ' 앞 목적지입니다.';
    if (ti.kind === 'via') return stage === 'now' ? '경유지에 도착했습니다.' : fmtDistSpeech(d) + ' 앞 경유지입니다.';
    if (ti.kind === 'safety') return fmtDistSpeech(d) + ' 앞 ' + ti.text + '입니다. 안전운전 하세요.';
    if (ti.kind === 'tunnel') return fmtDistSpeech(d) + ' 앞 터널입니다.';
    const road = g.road && !/^(일반도로|교차로)$/.test(g.road) ? ' ' + g.road + ' 방면으로' : '';
    if (stage === 'now') return '지금' + road + ' ' + ti.text + (ti.kind === 'straight' ? '하세요.' : '하세요.');
    if (stage === 'soon') return '잠시 후' + road + ' ' + ti.text + '입니다.';
    return fmtDistSpeech(d) + ' 앞에서' + road + ' ' + ti.text + '입니다.';
  }
  function fmtDistSpeech(m) { if (!isNum(m)) return ''; if (m < 1000) return (Math.round(m / 50) * 50 || 50) + '미터'; return (Math.round(m / 100) / 10).toFixed(1).replace(/\.0$/, '') + '킬로미터'; }
  // ---------- 매퍼 ----------
  class ApiError extends Error { constructor(code, message, extra) { super(message || code); this.code = code; Object.assign(this, extra || {}); } }
  function joinAddr(parts) { return parts.filter(x => x !== undefined && x !== null && String(x).trim() !== '' && String(x) !== '0').map(x => String(x).trim()).join(' '); }
  function mapPoi(r) {
    if (!r || typeof r !== 'object') return null;
    const lat = toNum(r.noorLat) || toNum(r.frontLat) || toNum(r.pnsLat), lon = toNum(r.noorLon) || toNum(r.frontLon) || toNum(r.pnsLon);
    if (!validLL(lat, lon)) return null;
    const fl = toNum(r.frontLat), fo = toNum(r.frontLon);
    const name = String(r.name || '').trim(); if (!name) return null;
    const area = joinAddr([r.upperAddrName, r.middleAddrName, r.lowerAddrName]);
    const jibunNo = r.firstNo && String(r.firstNo) !== '0' ? (r.firstNo + (r.secondNo && String(r.secondNo) !== '0' ? '-' + r.secondNo : '')) : '';
    const roadNo = r.firstBuildNo && String(r.firstBuildNo) !== '0' ? (r.firstBuildNo + (r.secondBuildNo && String(r.secondBuildNo) !== '0' ? '-' + r.secondBuildNo : '')) : '';
    return { id: r.id ? String(r.id) : (r.pkey ? String(r.pkey) : null), name, kind: 'poi', lat, lon,
      addrRoad: r.roadName ? joinAddr([r.upperAddrName, r.middleAddrName, r.roadName, roadNo]) : '',
      addrJibun: joinAddr([area, jibunNo]), entrance: validLL(fl, fo) ? { lat: fl, lon: fo } : null, tel: r.telNo || '',
      category: joinAddr([r.upperBizName, r.middleBizName, r.lowerBizName]) || '', distKm: isNum(toNum(r.radius)) ? toNum(r.radius) : null };
  }
  function mapPoiResponse(data) {
    if (data === null || data === undefined || data === '') return [];
    if (typeof data !== 'object') throw new ApiError('BAD_RESPONSE', '검색 응답 형식 오류');
    const info = data.searchPoiInfo; if (!info) { if (data.error) throw new ApiError('UPSTREAM', '검색 오류'); return []; }
    let poi = info.pois && info.pois.poi; if (!poi) return []; if (!Array.isArray(poi)) poi = [poi];
    const out = [], seen = new Set();
    for (const r of poi) { const p = mapPoi(r); if (!p) continue; const k = p.name + '|' + p.lat.toFixed(5) + p.lon.toFixed(5); if (seen.has(k)) continue; seen.add(k); out.push(p); }
    return out;
  }
  function mapGeoResponse(data, q) {
    if (!data || typeof data !== 'object') return [];
    let c = data.coordinateInfo && data.coordinateInfo.coordinate; if (!c) return []; if (!Array.isArray(c)) c = [c];
    const out = [];
    for (const x of c) {
      const lat = toNum(x.lat) || toNum(x.newLat), lon = toNum(x.lon) || toNum(x.newLon); if (!validLL(lat, lon)) continue;
      const road = joinAddr([x.city_do, x.gu_gun, x.newRoadName, joinAddr([x.newBuildingIndex])]);
      const jibun = joinAddr([x.city_do, x.gu_gun, x.eup_myun, x.legalDong || x.adminDong, x.ri, x.bunji]);
      out.push({ id: null, kind: 'addr', name: (x.buildingName && String(x.buildingName).trim()) || road || jibun || String(q || '주소'), lat, lon, addrRoad: road, addrJibun: jibun, entrance: validLL(toNum(x.latEntr), toNum(x.lonEntr)) ? { lat: toNum(x.latEntr), lon: toNum(x.lonEntr) } : null });
    }
    return out;
  }
  function mapRev(data) {
    const a = data && data.addressInfo; if (!a) return null;
    const full = String(a.fullAddress || ''); const parts = full.split(',');
    return { full: full, short: (parts[parts.length - 1] || full).trim() || joinAddr([a.city_do, a.gu_gun, a.legalDong]) };
  }
  const OPTION_LABEL = { '0': '추천', '1': '무료우선', '2': '최소시간', '4': '고속도로우선', '10': '최단거리' };
  const CONGESTION = { 0: '정보없음', 1: '원활', 2: '서행', 3: '지체', 4: '정체' };
  // Only explicit legal limits. traffic speed / distance÷time are NOT legal limits.
  function validLimit(v) { const n = toNum(v); return isNum(n) && n >= 10 && n <= 150 ? n : null; }
  function explicitLimit(p) { return validLimit(p.speedLimit) || validLimit(p.limitSpeed) || validLimit(p.speed_limit); }
  function textLimit(text) { const m = /(?:제한(?:속도)?\s*[:：]?\s*(\d{2,3})(?:\s*(?:km|㎞|킬로))?|(?:시속\s*)?(\d{2,3})\s*(?:km\s*\/?\s*h|㎞|킬로미터))/i.exec(text || ''); return m ? validLimit(m[1] || m[2]) : null; }
  function routeLimit(route, along) {
    if (!route || !isNum(along)) return null;
    const segment = route.segments.find(x => x.limit && along >= x.from && along < x.to);
    if (segment) return { limit: segment.limit, demo: !!route.demo, src: 'TMAP 구간 제한속도', key: 'seg' + segment.from };
    // A point without an end cannot establish the limit for the entire road.
    const point = route.guides.find(x => x.limit && along >= x.at - 30 && along <= x.at + 20);
    return point ? { limit: point.limit, demo: !!route.demo, src: 'TMAP 제한속도 안내지점 부근', key: 'point' + point.at } : null;
  }
  function mapRoute(data, opt) {
    opt = opt || {};
    if (!data || typeof data !== 'object') throw new ApiError('EMPTY_ROUTE', '경로 응답이 비어 있습니다.');
    if (data.error) throw new ApiError('UPSTREAM', String(data.error.message || '경로 오류'));
    const F = Array.isArray(data.features) ? data.features : null;
    if (!F || !F.length) throw new ApiError('EMPTY_ROUTE', '경로가 없습니다.');
    const feats = F.slice().sort((a, b) => toNum(a && a.properties && a.properties.index) - toNum(b && b.properties && b.properties.index) || 0);
    const path = []; const guides = []; const segments = []; const traffic = []; let summary = null; let trafficSeen = false;
    const cumNow = () => { if (path.length < 2) return 0; return segCum[segCum.length - 1]; };
    const segCum = [0];
    const pushPt = (lon, lat) => {
      lat = toNum(lat); lon = toNum(lon); if (!validLL(lat, lon)) return false;
      const last = path[path.length - 1]; if (last && Math.abs(last.lat - lat) < 1e-7 && Math.abs(last.lon - lon) < 1e-7) return true;
      if (last) segCum.push(segCum[segCum.length - 1] + dist(last, { lat, lon })); path.push({ lat, lon }); return true;
    };
    for (const f of feats) {
      if (!f || !f.geometry || !f.properties) continue; const g = f.geometry, p = f.properties;
      if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
        const startAlong = cumNow(); const startIdx = Math.max(0, path.length - 1);
        const localIdx = [];
        for (const c of g.coordinates) { if (!Array.isArray(c) || c.length < 2) continue; pushPt(c[0], c[1]); localIdx.push(path.length - 1); }
        const endAlong = cumNow();
        segments.push({ from: startAlong, to: endAlong, name: p.name || '', facilityType: isNum(toNum(p.facilityType)) ? toNum(p.facilityType) : null, roadType: isNum(toNum(p.roadType)) ? toNum(p.roadType) : null, time: toNum(p.time), distance: toNum(p.distance), limit: explicitLimit(p) });
        if (Array.isArray(p.traffic)) { trafficSeen = true; for (const t of p.traffic) { if (!Array.isArray(t) || t.length < 3) continue; const a = localIdx[toNum(t[0])], b = localIdx[toNum(t[1])]; if (a === undefined || b === undefined) continue; traffic.push({ from: segCum[a] || 0, to: segCum[b] || 0, level: toNum(t[2]), label: CONGESTION[toNum(t[2])] || '정보없음', speed: toNum(t[3]) }); } }
      } else if (g.type === 'Point' && Array.isArray(g.coordinates)) {
        if (p.pointType === 'S' || isNum(toNum(p.totalDistance))) summary = summary || p;
        const lat = toNum(g.coordinates[1]), lon = toNum(g.coordinates[0]); if (!validLL(lat, lon)) continue;
        let tt = toNum(p.turnType); const bm = /^B(\d)$/.exec(p.pointType || ''); // 실제 TMAP: 경유지는 pointType B1~B5, turnType 0/없음
        if (bm && !(tt >= 184 && tt <= 189)) tt = 184 + Number(bm[1]);
        if (bm && guides.some(x => x.pointType === p.pointType)) continue; // 끝에 중복으로 오는 경유지 점 무시
        guides.push({ lat, lon, at: cumNow(), turnType: tt, pointType: p.pointType || 'N', text: p.description || '', road: p.nextRoadName || '', name: p.name || '', limit: explicitLimit(p) || (tt === 191 ? textLimit(p.description) : null), camera: /과속.{0,8}단속|단속.{0,8}카메라|속도.{0,8}카메라/.test((p.description || '') + ' ' + (p.name || '')) });
      }
    }
    if (path.length < 2) throw new ApiError('EMPTY_ROUTE', '경로 좌표가 부족합니다.');
    const cum = segCum.slice(0, path.length);
    // 안내점 위치를 실제 경로 위로 다시 투영 (응답 순서가 어긋나도 안전)
    let hint = 0;
    for (const g of guides) { const pr = project(path, cum, g, hint); if (pr && pr.off < 80) { g.at = pr.along; hint = pr.idx; } g.info = turnInfo(g.turnType); }
    guides.sort((a, b) => a.at - b.at);
    const total = cum[cum.length - 1];
    const s = summary || {};
    const distance = isNum(toNum(s.totalDistance)) ? toNum(s.totalDistance) : Math.round(total);
    let time = toNum(s.totalTime); if (!isNum(time)) { const st = segments.reduce((a, b) => a + (isNum(b.time) ? b.time : 0), 0); time = st || Math.round(total / 11); }
    const tunnels = segments.filter(x => x.facilityType === 2).map(x => ({ from: x.from, to: x.to, name: x.name }));
    return {
      id: opt.id || ('r' + String(opt.option || '0') + '_' + Math.round(distance) + '_' + Math.round(time)), option: String(opt.option || '0'), optionLabel: OPTION_LABEL[String(opt.option || '0')] || '경로',
      distance, time, fare: isNum(toNum(s.totalFare)) ? toNum(s.totalFare) : null, taxiFare: isNum(toNum(s.taxiFare)) ? toNum(s.taxiFare) : null, fuel: null,
      path, cum, length: total, guides, segments, tunnels, traffic: trafficSeen ? traffic : null, trafficAvailable: trafficSeen,
      fetchedAt: isNum(opt.now) ? opt.now : Date.now(), source: opt.source || 'tmap', demo: !!opt.demo
    };
  }
  function dedupeRoutes(rs) { const out = []; for (const r of rs) { if (!r) continue; if (out.some(o => Math.abs(o.distance - r.distance) < 30 && Math.abs(o.time - r.time) < 30)) continue; out.push(r); } return out; }
  // ---------- GPS 필터 ----------
  class GpsFilter {
    constructor(o) { o = o || {}; this.maxAge = o.maxAge || 15000; this.maxAcc = o.maxAcc || 200; this.poorAcc = o.poorAcc || 50; this.maxSpeed = o.maxSpeed || 70; this.last = null; this.heading = null; this.jumps = 0; this.pend = null; }
    reset() { this.last = null; this.heading = null; this.jumps = 0; this.pend = null; }
    accept(fix, now) {
      if (!fix || !validLL(fix.lat, fix.lon)) return { ok: false, reason: 'invalid' };
      now = isNum(now) ? now : Date.now(); const ts = isNum(fix.ts) ? fix.ts : now;
      if (now - ts > this.maxAge) return { ok: false, reason: 'stale' };
      if (this.last && ts < this.last.ts) return { ok: false, reason: 'old' };
      const acc = isNum(fix.acc) ? fix.acc : 30; if (acc > this.maxAcc) return { ok: false, reason: 'inaccurate', acc };
      let speed = isNum(fix.speed) && fix.speed >= 0 ? fix.speed : null, head = isNum(fix.heading) && fix.heading >= 0 ? normDeg(fix.heading) : null;
      if (this.last) {
        const d = dist(this.last, fix), dt = Math.max(0.001, (ts - this.last.ts) / 1000), v = d / dt;
        if (v > this.maxSpeed && d > 50) { // 튀는 좌표: 같은 방향으로 연속 2번 이상이면 수용
          if (this.pend && dist(this.pend, fix) < Math.max(60, acc * 2)) this.jumps++; else this.jumps = 1;
          this.pend = { lat: fix.lat, lon: fix.lon, ts };
          if (this.jumps < 3) return { ok: false, reason: 'jump', jump: d };
        }
        this.jumps = 0; this.pend = null;
        if (speed === null && dt < 10) speed = v;
        else if (dt < 10 && speed != null && speed < 0.6 && v > 1.5 && d > 2) speed = v;
        if (head === null && d >= 3) head = bearing(this.last, fix);
      }
      if (head === null) head = this.heading; else if (this.heading !== null && (speed === null || speed > 1.5)) head = lerpAng(this.heading, head, 0.6); else if (speed !== null && speed <= 1.5 && this.heading !== null) head = this.heading;
      this.heading = head;
      const out = { lat: fix.lat, lon: fix.lon, ts, acc, speed, heading: head, source: fix.source || 'gps', quality: acc > this.poorAcc ? 'poor' : 'good' };
      this.last = out; return { ok: true, fix: out };
    }
  }
  // ---------- 경로 이탈 판정 ----------
  class OffRoute {
    constructor(o) { o = o || {}; this.minDist = o.minDist || 32; this.count = o.count || 2; this.minMs = o.minMs || 2000; this.reset(); }
    reset() { this.n = 0; this.since = null; }
    update(off, acc, now) {
      const th = Math.max(this.minDist, (isNum(acc) ? acc : 20) * 1.5);
      if (!isNum(off) || off <= th) { this.reset(); return false; }
      this.n++; if (this.since === null) this.since = now; return this.n >= this.count && now - this.since >= this.minMs;
    }
  }
  // ---------- 안내 엔진 ----------
  class Guidance {
    constructor(route, o) { this.route = route; o = o || {}; this.arriveM = o.arriveM || 30; this.hint = 0; this.along = 0; this.spoken = new Set(); this.passedVia = new Set(); this.arrived = false; }
    update(p, speed) {
      const r = this.route; const pr = project(r.path, r.cum, p, this.hint); if (!pr) return null;
      // 역주행 방지: 크게 뒤로 가는 투영은 무시 (경로가 겹칠 때)
      if (pr.along < this.along - 80 && pr.off < 30) { /* 같은 길 반대편 겹침 */ }
      this.hint = pr.idx; this.along = Math.max(pr.along, this.along - 30);
      const remain = Math.max(0, r.length - this.along);
      const ratio = r.length ? remain / r.length : 0; const remainTime = r.time * ratio;
      const ahead = r.guides.filter(g => g.at > this.along + 3 && !g.info.silent && g.info.kind !== 'start');
      const next = ahead[0] || null, after = ahead[1] || null;
      const dNext = next ? next.at - this.along : remain;
      const stage = stageFor(dNext, speed);
      let viaArrived = null;
      for (const g of r.guides) if (g.info.kind === 'via' && !this.passedVia.has(g.at) && this.along >= g.at - this.arriveM) { this.passedVia.add(g.at); viaArrived = g; }
      const arrived = remain <= this.arriveM; if (arrived) this.arrived = true;
      const inTunnel = r.tunnels.some(t => this.along >= t.from && this.along <= t.to);
      const tunnelAhead = r.tunnels.find(t => t.from > this.along && t.from - this.along < 500) || null;
      return { along: this.along, remain, remainTime, progress: r.length ? this.along / r.length : 0, next, after, dNext, stage, off: pr.off, snapped: pr.point, segBearing: pr.segBearing, viaArrived, arrived, inTunnel, tunnelAhead };
    }
    // 같은 안내점·단계는 1회만 음성 (반복 방지)
    shouldSpeak(g, stage, d, consume = true) {
      if (!g) return false; if (stage === 'later' && !(d <= 1100 && d >= 700)) { if (!(d > 1100 && d < 2100 && g.info.kind !== 'safety')) return false; }
      const band = stage === 'later' ? (d > 1100 ? '2k' : '1k') : (stage === 'soon' && d <= 100 ? '100m' : stage); const k = g.at + '|' + band;
      if (this.spoken.has(k)) return false; if (consume) this.spoken.add(k); return true;
    }
  }
  // ---------- 상태 머신 ----------
  const STATES = ['ready', 'search', 'candidates', 'preview', 'starting', 'driving', 'paused', 'rerouting', 'viaArrived', 'arrived', 'ended', 'error'];
  const STATE_LABEL = { ready: '준비', search: '장소 검색', candidates: '경로 후보', preview: '경로 미리보기', starting: '안내 시작', driving: '주행 중', paused: '일시정지', rerouting: '재탐색 중', viaArrived: '경유지 도착', arrived: '목적지 도착', ended: '종료', error: '오류' };
  const TRANS = {
    ready: ['search', 'candidates', 'error'], search: ['ready', 'candidates', 'search', 'error'], candidates: ['preview', 'search', 'ready', 'candidates', 'error'],
    preview: ['starting', 'candidates', 'search', 'ready', 'error'], starting: ['driving', 'error', 'ended'], driving: ['paused', 'rerouting', 'viaArrived', 'arrived', 'ended', 'error'],
    paused: ['driving', 'ended'], rerouting: ['driving', 'ended', 'error'], viaArrived: ['driving', 'ended', 'arrived'], arrived: ['ended', 'ready'], ended: ['ready', 'search', 'candidates'], error: ['ready', 'search', 'candidates', 'driving', 'ended']
  };
  function canGo(a, b) { return !!(TRANS[a] && TRANS[a].includes(b)); }
  const GPS_STATES = { none: '위치 미요청', wait: '위치 대기', ok: '정상', poor: '부정확', denied: '권한 거부', lost: '신호 끊김', demo: '데모 위치' };
  // ---------- 최신 응답 가드 ----------
  function latestGuard() { let seq = 0; return { next: () => ++seq, isLatest: t => t === seq, get seq() { return seq; } }; }
  // ---------- 경유지 ----------
  const MAX_VIA = 5;
  function addVia(list, p) { if (!p || !validLL(p.lat, p.lon)) throw new ApiError('BAD_PLACE', '경유지 좌표가 올바르지 않습니다.'); if (list.length >= MAX_VIA) throw new ApiError('VIA_LIMIT', '경유지는 최대 ' + MAX_VIA + '개까지 추가할 수 있습니다.'); return list.concat([p]); }
  function removeVia(list, i) { return list.filter((_, j) => j !== i); }
  function moveVia(list, i, dir) { const j = i + dir; if (j < 0 || j >= list.length || i < 0 || i >= list.length) return list.slice(); const c = list.slice(); [c[i], c[j]] = [c[j], c[i]]; return c; }
  // ---------- 데모 데이터 ----------
  const DEMO_PLACES = [
    ['서울역', 37.55473, 126.97074, '서울 용산구 한강대로 405'], ['강남역', 37.49796, 127.02763, '서울 강남구 강남대로 396'], ['광화문', 37.57589, 126.97695, '서울 종로구 세종대로 172'],
    ['여의도 IFC몰', 37.52519, 126.92558, '서울 영등포구 국제금융로 10'], ['잠실 롯데월드타워', 37.51253, 127.10250, '서울 송파구 올림픽로 300'], ['판교역', 37.39467, 127.11120, '경기 성남시 분당구 판교역로 160'],
    ['인천국제공항 제1터미널', 37.44910, 126.45069, '인천 중구 공항로 272'], ['수원역', 37.26570, 127.00030, '경기 수원시 팔달구 덕영대로 924'], ['부산역', 35.11515, 129.04218, '부산 동구 중앙대로 206'],
    ['대전역', 36.33242, 127.43430, '대전 동구 중앙로 215'], ['홍대입구역', 37.55717, 126.92452, '서울 마포구 양화로 160'], ['코엑스', 37.51174, 127.05919, '서울 강남구 영동대로 513'],
    ['김포공항', 37.55862, 126.79448, '서울 강서구 하늘길 112'], ['일산 킨텍스', 37.66851, 126.74535, '경기 고양시 일산서구 킨텍스로 217-60'], ['동대문디자인플라자', 37.56661, 127.00927, '서울 중구 을지로 281']
  ];
  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function demoSearch(q, near) {
    q = String(q || '').trim(); if (!q) return [];
    if (/^(없음|결과없음|zzz+)$/i.test(q)) return [];
    const norm = s => s.replace(/\s+/g, '').toLowerCase(); const nq = norm(q);
    let out = DEMO_PLACES.filter(p => norm(p[0]).includes(nq) || norm(p[3]).includes(nq) || nq.includes(norm(p[0]))).map(p => ({ id: 'demo-' + hash(p[0]), name: p[0], kind: 'poi', lat: p[1], lon: p[2], addrRoad: p[3], addrJibun: '', entrance: null, demo: true }));
    if (!out.length) { const base = near && validLL(near.lat, near.lon) ? near : { lat: 37.5547, lon: 126.9707 }; const h = hash(q); const n = 1 + (h % 3);
      for (let i = 0; i < n; i++) { const hh = hash(q + i); const p = offset(base, hh % 360, 1500 + (hh % 9000)); out.push({ id: 'demo-' + hh, name: q.slice(0, 40) + (i ? ' ' + (i + 1) + '호점' : ''), kind: 'poi', lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), addrRoad: '데모 주소 ' + (100 + hh % 800) + '번길', addrJibun: '', entrance: null, demo: true }); } }
    return out.slice(0, 10);
  }
  // 데모 경로: TMAP과 같은 FeatureCollection 형태로 생성 → 같은 매퍼(mapRoute)를 통과
  function demoRouteRaw(A, B, via, option) {
    const pts = [A].concat(via || []).concat([B]); const feats = []; let idx = 0; const opt = String(option || '0');
    const roads = ['세종대로', '한강대로', '올림픽대로', '강남대로', '테헤란로', '도산대로', '남부순환로', '동일로'];
    let coords = []; const turns = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1]; const h = hash(a.lat.toFixed(4) + b.lon.toFixed(4) + opt + k);
      const legs = 3 + (h % 3); let cur = a; const legPts = [a];
      for (let i = 1; i < legs; i++) { const t = i / legs; const tgt = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }; const corner = (i + (opt === '10' ? 1 : 0)) % 2 ? { lat: cur.lat, lon: tgt.lon } : { lat: tgt.lat, lon: cur.lon }; legPts.push(corner); cur = corner; }
      legPts.push({ lat: cur.lat, lon: b.lon }); legPts.push(b);
      for (let i = 0; i < legPts.length; i++) { const p = legPts[i]; if (coords.length && dist(coords[coords.length - 1], p) < 5) continue; coords.push(p); if (i > 0 && i < legPts.length - 1) turns.push({ at: coords.length - 1, via: false }); }
      if (k < pts.length - 2) turns.push({ at: coords.length - 1, via: true, n: k });
    }
    // 세분화 (주행 시뮬레이션이 부드럽도록 60m 간격)
    const dense = [coords[0]]; const turnAt = new Map();
    for (let i = 1; i < coords.length; i++) { const a = coords[i - 1], b = coords[i], d = dist(a, b), n = Math.max(1, Math.ceil(d / 60)); for (let j = 1; j <= n; j++) dense.push({ lat: a.lat + (b.lat - a.lat) * j / n, lon: a.lon + (b.lon - a.lon) * j / n }); const t = turns.find(x => x.at === i); if (t) turnAt.set(dense.length - 1, t); }
    const total = cumulative(dense); const L = total[total.length - 1];
    const speed = opt === '4' || opt === '2' ? 16 : opt === '10' ? 11 : 13;
    const totalTime = Math.round(L / speed);
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [dense[0].lon, dense[0].lat] }, properties: { index: idx++, pointType: 'S', turnType: 200, totalDistance: Math.round(L), totalTime, totalFare: opt === '1' || opt === '10' ? 0 : (L > 15000 ? 1800 : 0), description: '출발', nextRoadName: roads[0] } });
    let start = 0; const keys = [...turnAt.keys()].sort((a, b) => a - b).concat([dense.length - 1]); let ri = 0;
    const tunnelLeg = keys.length > 2 ? 1 : -1;
    keys.forEach((end, li) => {
      const seg = dense.slice(start, end + 1); if (seg.length < 2) { start = end; return; }
      const segL = total[end] - total[start]; const name = roads[(ri++) % roads.length];
      // 터널(데모): 두 번째 구간 중간 일부
      if (li === tunnelLeg && seg.length > 8) {
        const q1 = Math.floor(seg.length * 0.4), q2 = Math.floor(seg.length * 0.7);
        [[0, q1, 0], [q1, q2, 2], [q2, seg.length - 1, 0]].forEach(([s, e, f]) => feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: seg.slice(s, e + 1).map(p => [p.lon, p.lat]) }, properties: { index: idx++, name: f === 2 ? name + ' 터널' : name, distance: Math.round(total[start + e] - total[start + s]), time: Math.round((total[start + e] - total[start + s]) / speed), roadType: 5, facilityType: f } }));
      } else feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: seg.map(p => [p.lon, p.lat]) }, properties: { index: idx++, name, distance: Math.round(segL), time: Math.round(segL / speed), roadType: 5, facilityType: 0 } });
      if (end === dense.length - 1) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [dense[end].lon, dense[end].lat] }, properties: { index: idx++, pointType: 'E', turnType: 201, description: '도착', nextRoadName: '' } });
      else { const t = turnAt.get(end); const b1 = bearing(dense[end - 1], dense[end]), b2 = bearing(dense[end], dense[end + 1]); const df = angDiff(b1, b2);
        const tt = t.via ? 185 + t.n : (Math.abs(df) < 20 ? 11 : df < -150 || df > 150 ? 14 : df < 0 ? 12 : 13);
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [dense[end].lon, dense[end].lat] }, properties: { index: idx++, pointType: t.via ? 'B' + (t.n + 1) : 'N', turnType: tt, description: (t.via ? '경유지' : turnInfo(tt).text) + ' 후 ' + roads[ri % roads.length] + ' 이동', nextRoadName: roads[ri % roads.length] } }); }
      start = end;
    });
    return { type: 'FeatureCollection', features: feats };
  }
  // 시뮬레이션 이벤트 10종
  const SIM_EVENTS = [
    { id: 'left', label: '좌회전', real: true }, { id: 'right', label: '우회전', real: true }, { id: 'lane', label: '차로 분기', real: false },
    { id: 'camera', label: '과속단속 예고', real: false }, { id: 'jam', label: '정체 구간', real: false }, { id: 'tunnel', label: '터널 GPS 저하', real: false },
    { id: 'offroute', label: '경로 이탈·재탐색', real: true }, { id: 'via', label: '경유지 통과', real: true }, { id: 'arrive', label: '목적지 도착', real: true }, { id: 'gpslost', label: 'GPS 끊김·재연결', real: false }
  ];
  function findGuide(route, along, kinds) { return route.guides.find(g => g.at > along + 50 && kinds.includes(g.info.kind)) || route.guides.find(g => kinds.includes(g.info.kind)) || null; }
  // 오류 코드 → 사용자 안내
  const ERR_HELP = {
    NETWORK: ['네트워크 연결이 끊겼습니다.', '연결 확인 후 다시 시도하거나 데모로 계속하세요.'], TIMEOUT: ['TMAP 응답이 늦습니다.', '잠시 후 다시 시도하세요.'],
    AUTH: ['TMAP 인증에 실패했습니다.', 'TMAP 콘솔에서 키·상품·도메인을 확인하세요. 지금은 데모로 계속할 수 있습니다.'], QUOTA: ['TMAP 호출 한도를 초과했습니다.', '내일 다시 시도하거나 데모로 계속하세요.'],
    RATE_LIMIT: ['요청이 너무 많습니다.', '몇 초 후 다시 시도하세요.'], NO_KEY: ['TMAP 키가 서버에 설정되지 않았습니다.', '데모 모드로 계속하세요.'], ORIGIN: ['허용되지 않은 주소에서 실행 중입니다.', '등록된 도메인에서 열거나 데모로 계속하세요.'],
    BAD_REQUEST: ['입력값을 확인해 주세요.', '출발지·목적지를 다시 선택하세요.'], EMPTY_ROUTE: ['경로를 찾지 못했습니다.', '목적지나 경로 옵션을 바꿔 보세요.'], NO_RESULT: ['검색 결과가 없습니다.', '다른 이름이나 주소로 검색하세요.'],
    BAD_RESPONSE: ['응답 형식이 올바르지 않습니다.', '다시 시도하세요.'], UPSTREAM: ['TMAP 서버 오류입니다.', '잠시 후 다시 시도하세요.'], ABORTED: ['요청이 취소되었습니다.', ''], VIA_LIMIT: ['경유지는 최대 5개입니다.', '기존 경유지를 삭제하세요.'], BAD_PLACE: ['장소 좌표가 올바르지 않습니다.', '다른 장소를 선택하세요.'], REROUTE_FAIL: ['재탐색에 실패했습니다.', '기존 경로로 계속 안내합니다. 다시 시도할 수 있습니다.']
  };

  // ---------- 안내 중 시각 타깃(경로 스냅·저속 방위 유지) ----------
  const HOLD_SPEED = 5 / 3.6; // 5 km/h
  const onRouteTh = acc => Math.max(40, (isNum(acc) ? acc : 20) * 1.2);
  function guideVisualTarget(u, fix, lastBearing) {
    if (!fix || !isNum(fix.lat)) return null;
    const acc = isNum(fix.acc) ? fix.acc : 20;
    const speed = isNum(fix.speed) ? fix.speed : null;
    const slow = speed !== null && speed < HOLD_SPEED;
    const onRoute = !!(u && isNum(u.off) && u.snapped && u.off <= onRouteTh(acc));
    let lat = fix.lat, lon = fix.lon, bearing = isNum(fix.heading) ? normDeg(fix.heading) : lastBearing;
    if (onRoute) { lat = u.snapped.lat; lon = u.snapped.lon; if (isNum(u.segBearing)) bearing = u.segBearing; }
    if (slow && isNum(lastBearing)) bearing = lastBearing;
    return { lat, lon, bearing, onRoute, speed: isNum(speed) ? speed : null };
  }
  // N7 연속 운동: 표시 위치는 스무딩된 속도로 경로를 계속 진행.
  // 새 GPS는 ~1초 동안 오차만 보정(뒤로 점프/정지 없음). 표시는 lead 초 지연해 도래 간격이 비어도 멈추지 않음.
  class ViewSmoother {
    constructor(o) {
      o = o || {};
      this.tauPos = o.tauPos || 0.16; // 이탈 시 위치 이징(호환)
      this.tauV = o.tauV || 0.35;
      this.tauCorr = o.tauCorr || 1.0;
      this.lead = o.lead || 0.7;
      this.maxPred = o.maxPred || 3.5;
      this.tauHead = o.tauHead || 0.2;
      this.maxDegPerSec = o.maxDegPerSec || 90;
      this.reset();
    }
    reset() {
      this.lat = this.lon = this.bearing = null;
      this.tLat = this.tLon = this.tBearing = this.tAlong = null;
      this.speed = 0; this.v = 0; this.cruiseV = 0;
      this.onRoute = false; this.route = null;
      this.fixTs = 0; this.fixRecv = null; this.last = 0;
      this.along = null; this.fixAlong = null; this._fixId = null; this._notedAlong = null;
    }
    _isNewFix(t) {
      if (isNum(t.ts) && t.ts !== this._fixId) return true;
      if (isNum(t.along) && this._notedAlong != null && Math.abs(t.along - this._notedAlong) > 0.8) return true;
      if (this.tLat == null) return true;
      if (!isNum(t.along) && isNum(t.lat) && (Math.abs(t.lat - this.tLat) > 1e-6 || Math.abs(t.lon - this.tLon) > 1e-6)) return true;
      return false;
    }
    setTarget(t, now) {
      if (!t || !isNum(t.lat)) return;
      now = isNum(now) ? now : Date.now();
      this.onRoute = !!t.onRoute;
      if (t.route) this.route = t.route;
      if (isNum(t.bearing)) this.tBearing = normDeg(t.bearing);
      if (this._isNewFix(t)) this._noteFix(t, now);
      else {
        this.tLat = t.lat; this.tLon = t.lon;
        if (isNum(t.along) && !(this.tAlong != null && t.onRoute && t.along < this.tAlong - 8)) this.tAlong = t.along;
      }
      if (this.lat == null) { this.lat = t.lat; this.lon = t.lon; this.bearing = isNum(t.bearing) ? normDeg(t.bearing) : 0; this.last = now; }
    }
    _noteFix(t, now) {
      const recv = now;
      let measV = null;
      if (this.fixRecv && isNum(t.along) && this.fixAlong != null) {
        const dt = (recv - this.fixRecv) / 1000;
        if (dt > 0.2 && dt < 6) {
          const da = t.along - this.fixAlong;
          if (da > -8) measV = Math.max(0, da / dt);
        }
      } else if (this.fixRecv && isNum(t.lat) && this.tLat != null) {
        const dt = (recv - this.fixRecv) / 1000;
        if (dt > 0.2 && dt < 6) measV = Math.max(0, dist({ lat: this.tLat, lon: this.tLon }, t) / dt);
      }
      const gpsV = isNum(t.speed) && t.speed > 0.4 ? t.speed : null;
      const inst = measV != null ? (gpsV != null ? measV * 0.6 + gpsV * 0.4 : measV) : gpsV;
      if (inst != null) {
        if (!this.cruiseV) this.cruiseV = inst;
        else this.cruiseV += (inst - this.cruiseV) * 0.45;
        this.cruiseV = Math.max(0, Math.min(50, this.cruiseV));
      }
      this.fixRecv = recv;
      this.fixTs = recv; // 운동 시계는 수신 시각. 폰 GPS ts는 쓰지 않음(기기와 시계 오차)
      if (isNum(t.ts)) this._fixId = t.ts;
      if (isNum(t.along)) {
        if (!(this.fixAlong != null && t.onRoute && t.along < this.fixAlong - 8)) {
          this.fixAlong = t.along; this.tAlong = t.along; this._notedAlong = t.along;
        }
      }
      this.tLat = t.lat; this.tLon = t.lon;
      this.onRoute = !!t.onRoute;
      if (t.route) this.route = t.route;
      if (isNum(t.bearing)) this.tBearing = normDeg(t.bearing);
      this.speed = this.cruiseV || (isNum(t.speed) ? Math.max(0, t.speed) : this.speed);
      if (this.along == null && isNum(t.along)) {
        const leadM = (this.cruiseV || 0) * this.lead;
        this.along = Math.max(0, t.along - leadM);
        const p0 = (this.route && this.route.path) ? pointAt(this.route.path, this.route.cum, this.along) : t;
        this.lat = p0.lat; this.lon = p0.lon;
        if (isNum(p0.bearing)) this.bearing = p0.bearing;
        this.v = this.cruiseV || 0;
      }
    }
    jump(t, now) {
      if (!t || !isNum(t.lat)) return;
      this.reset();
      now = isNum(now) ? now : Date.now();
      this.setTarget(t, now);
      this.lat = t.lat; this.lon = t.lon;
      if (isNum(t.along)) this.along = t.along;
      if (isNum(t.bearing)) this.bearing = normDeg(t.bearing);
      if (isNum(t.speed) && t.speed > 0.4) { this.cruiseV = t.speed; this.v = t.speed; this.speed = t.speed; }
      this.last = now;
    }
    sample(now) {
      now = isNum(now) ? now : Date.now();
      const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0;
      this.last = now;
      if (this.tLat == null) return null;
      const age = this.fixRecv != null ? Math.max(0, (now - this.fixRecv) / 1000) : 0;
      let cruise = this.cruiseV || 0;
      if (age > this.maxPred) cruise *= Math.max(0, 1 - (age - this.maxPred) / 1.2);
      let tgtBrg = this.tBearing;
      if (this.onRoute && this.route && this.route.path && this.along != null && this.fixAlong != null) {
        const predT = Math.min(age, this.maxPred);
        const aim = this.fixAlong + cruise * (predT - this.lead);
        const err = aim - this.along;
        let vCmd = cruise + err / this.tauCorr;
        if (vCmd < 0) vCmd = 0;
        if (cruise >= HOLD_SPEED) vCmd = Math.min(vCmd, cruise * 1.8 + 2);
        else {
          if (cruise < HOLD_SPEED && Math.abs(err) < 2.5) vCmd = 0;
          else vCmd = Math.min(vCmd, Math.max(cruise, HOLD_SPEED));
        }
        const aV = dt ? (1 - Math.exp(-dt / this.tauV)) : 1;
        this.v += (vCmd - this.v) * aV;
        if (this.v < 0) this.v = 0;
        this.along += this.v * dt;
        const p = pointAt(this.route.path, this.route.cum, this.along);
        this.lat = p.lat; this.lon = p.lon;
        if (isNum(p.bearing)) tgtBrg = p.bearing;
      } else {
        // 이탈: 헤딩 방향 추측항법 + 새 픽스로 완만히 보정
        let tgtLat = this.tLat, tgtLon = this.tLon;
        if (cruise > HOLD_SPEED && isNum(this.tBearing)) {
          const predT = Math.max(0, Math.min(age, this.maxPred) - this.lead);
          const pred = offset({ lat: this.tLat, lon: this.tLon }, this.tBearing, cruise * predT);
          tgtLat = pred.lat; tgtLon = pred.lon;
        }
        if (this.lat == null) { this.lat = tgtLat; this.lon = tgtLon; }
        else {
          const aPos = dt ? (1 - Math.exp(-dt / Math.max(this.tauPos, this.tauCorr))) : 1;
          // 앞으로만: 새 타깃이 뒤면 속도만 줄임
          const d = dist({ lat: this.lat, lon: this.lon }, { lat: tgtLat, lon: tgtLon });
          const aV = dt ? (1 - Math.exp(-dt / this.tauV)) : 1;
          this.v += ((cruise || 0) - this.v) * aV;
          if (d > 0.05) {
            const step = Math.min(d, Math.max(this.v, 0) * dt + d * aPos * 0.35);
            const br = bearing({ lat: this.lat, lon: this.lon }, { lat: tgtLat, lon: tgtLon });
            const np = offset({ lat: this.lat, lon: this.lon }, br, step);
            this.lat = np.lat; this.lon = np.lon;
          }
        }
      }
      this.speed = this.v;
      if (isNum(tgtBrg)) {
        const aHead = dt ? (1 - Math.exp(-dt / this.tauHead)) : 1;
        let step = angDiff(this.bearing == null ? tgtBrg : this.bearing, tgtBrg) * aHead;
        const cap = this.maxDegPerSec * Math.max(dt, 0.001);
        if (step > cap) step = cap; if (step < -cap) step = -cap;
        this.bearing = normDeg((this.bearing == null ? tgtBrg : this.bearing) + step);
      }
      return { lat: this.lat, lon: this.lon, bearing: this.bearing, onRoute: this.onRoute, along: this.along, speed: this.v };
    }
  }
    function errHelp(code) { const h = ERR_HELP[code] || ['알 수 없는 오류입니다.', '다시 시도하세요.']; return { title: h[0], action: h[1] }; }
  function redact(s, secrets) { s = String(s); for (const k of secrets || []) if (k && k.length > 8) s = s.split(k).join('[REDACTED]'); return s.replace(/appKey=[^&\s"']+/gi, 'appKey=[REDACTED]'); }
  // 지도 미터/픽셀 (웹 메르카토르, 256 타일)
  const mpp = (lat, zoom) => 156543.03392 * Math.cos(lat * RAD) / Math.pow(2, zoom);
  function scaleFor(w, h) { if (!(w > 0 && h > 0)) return 1; if (h > w * 1.1) return Math.max(0.78, Math.min(1.1, w / 430)); return Math.max(0.6, Math.min(1.5, Math.min(w / 1000, h / 470))); }
  return { explicitLimit, textLimit, routeLimit, RAD, isNum, toNum, validLL, inKorea, normDeg, angDiff, lerpAng, dist, bearing, offset, cumulative, project, pointAt, fmtDist, fmtDur, fmtClock, eta, fmtWon, turnInfo, TURN_KINDS, stageFor, STAGE_LABEL, phrase, fmtDistSpeech,
    ApiError, mapPoi, mapPoiResponse, mapGeoResponse, mapRev, mapRoute, dedupeRoutes, OPTION_LABEL, CONGESTION, GpsFilter, OffRoute, Guidance, STATES, STATE_LABEL, canGo, GPS_STATES, latestGuard, MAX_VIA, addVia, removeVia, moveVia,
    DEMO_PLACES, demoSearch, demoRouteRaw, SIM_EVENTS, findGuide, errHelp, redact, mpp, scaleFor, hash,
    HOLD_SPEED, onRouteTh, guideVisualTarget, ViewSmoother };
});
