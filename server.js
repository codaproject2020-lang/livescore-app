// ============================================================
//  LiveScore AI · Backend
//  - TheSportsDB 프록시 (실시간 경기 데이터)
//  - WebSocket: 실시간 채팅 + 접속인원(presence)
//  - 정적 프론트엔드 서빙
// ============================================================
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import nodemailer from 'nodemailer';
import { MongoClient } from 'mongodb';
import crypto from 'crypto';
import geoip from 'fast-geoip';   // 오프라인 IP→국가 (저메모리)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const APP_VERSION = 'v450';

// ============================================================
//  📏 성능 계측(instrumentation) — 엔드포인트 지연·캐시·공급사·WS·이벤트루프
//     개인정보·토큰·비밀키는 절대 기록하지 않음(경로/숫자만)
// ============================================================
const METRICS = {
  startAt: Date.now(), version: APP_VERSION,
  ep: new Map(),                                  // label -> {n, err, samples:[ms,...] (ring, cap 400)}
  cache: { hit: 0, miss: 0, refresh: 0, merge: 0 },   // 공용 캐시: 적중/미적중(콜드빌드)/백그라운드갱신/병합(single-flight 공유)
  supplier: { asCall: 0, as429: 0, asFail: 0, tsCall: 0, tsFail: 0 },  // 공급사 실호출/429/실패
  ws: { connects: 0, disconnects: 0, fails: 0 },
  elLagMs: 0
};
function epLabelFromPath(p) {
  // ID·날짜 등 가변 세그먼트를 접어 라벨 폭발 방지
  if (p.indexOf('/api/') !== 0) return p === '/' ? '/(root)' : 'STATIC';
  const parts = p.split('/').slice(0, 4).map(s => /^\d/.test(s) || s.length > 24 ? ':v' : s);
  return parts.join('/');
}
function recordEp(label, ms, isErr) {
  let m = METRICS.ep.get(label);
  if (!m) { m = { n: 0, err: 0, samples: [] }; METRICS.ep.set(label, m); }
  m.n++; if (isErr) m.err++;
  m.samples.push(ms); if (m.samples.length > 400) m.samples.shift();
}
function pctl(sorted, p) { if (!sorted.length) return null; const i = Math.min(sorted.length - 1, Math.floor(p / 100 * sorted.length)); return Math.round(sorted[i]); }
// 이벤트 루프 지연: 1초 타이머의 실제 지연을 측정
let _elTick = Date.now();
setInterval(() => { const now = Date.now(); METRICS.elLagMs = Math.max(0, now - _elTick - 1000); _elTick = now; }, 1000).unref?.();
// 요청 지연 미들웨어(가장 먼저 — 정적 포함 전체 측정)
app.use((req, res, next) => {
  const t = process.hrtime.bigint();
  res.on('finish', () => {
    try { const ms = Number(process.hrtime.bigint() - t) / 1e6; recordEp(req.method + ' ' + epLabelFromPath(req.path), ms, res.statusCode >= 500); } catch (e) {}
  });
  next();
});
// TheSportsDB 무료 테스트 키("3"/"123"). 유료 키가 있으면 환경변수로 교체.
const TSDB_KEY = process.env.THESPORTSDB_KEY || '3';
const TSDB = `https://www.thesportsdb.com/api/v1/json/${TSDB_KEY}`;

// 🔁 onrender.com 기본주소로 들어오면 커스텀 도메인(liveup.fans)으로 301 리다이렉트 → 사용자에겐 liveup.fans만 노출
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (host.includes('onrender.com')) {
    return res.redirect(301, 'https://liveup.fans' + req.originalUrl);
  }
  next();
});
app.set('trust proxy', true);   // Render 프록시 뒤 실제 클라이언트 IP 인식
app.use(express.json());
// 앱 셸(HTML)·서비스워커는 매 로드 재검증(배포 즉시 반영) — 정적 자산(이미지/폰트)은 기본 캐시 유지
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: function(res, p){
  if(/\.html$/i.test(p) || /sw\.js$/i.test(p)){ res.setHeader('Cache-Control', 'no-cache, must-revalidate'); }
} }));

// ============================================================
//  📊 접속자 추적(analytics) — 방문·버튼클릭·IP·시각 수집
//     메모리 링버퍼 + (MONGODB 있으면) events 컬렉션 영구저장
// ============================================================
const EVENTS = [];              // 최근 이벤트 링버퍼(화면 표시용)
const EVENTS_MAX = 8000;
let eventsCol = null;           // 원본 이벤트(최근 90일만 보관)
let statsCol = null;            // 일별 요약(영구 보관)
let subsCol = null;             // 웹푸시 구독(재시작·재배포 시 유지)
// 👥 재방문자 추적: 방문자키 → {key,name,count(방문횟수),first,last,ip,cc}
const VISITORS = new Map();
const ONLINE_WIN = 5 * 60 * 1000;   // 최근 5분 이내 활동 = "접속중"
// 📡 재배포(재시작) 직후 접속자 숫자가 0으로 꺼졌다 다시 차오르는 현상 방지용 '바닥값'.
// 직전 접속수를 DB에 저장해두고, 부팅 후 잠깐 동안 그 값을 바닥으로 깔아 끊김 없이 실제 수치로 넘겨준다.
let _presenceFloor = 0;
let visitorsCol = null;             // 방문자 영속 컬렉션(연결 시)

// ============================================================
//  🛠️ 운영 관리자: 에러 모니터링 + 관리자 폰 알림 + 기능 토글(라이브 config)
// ============================================================
const ERRLOG = [];                 // 최근 에러 링버퍼(관리자 화면 표시)
const ERR_MAX = 300;
let errorsCol = null, configCol = null, adminSubsCol = null, highlightsCol = null, bskSnapCol = null;
// 🎬 경기 하이라이트(관리자 수동 등록) — key: "sport:matchId"
const HIGHLIGHTS = new Map();
// 공식 채널 허용목록(채널ID·핸들). 자동수집·공식 배지 판정에 사용. 수동 등록은 경고만.
const OFFICIAL_CHANNELS = [
  { league: 'NBA', name: 'NBA', channelId: 'UCWJ2lWNubArHWmf3FIHbfcQ', handle: '@nba' },
  { league: 'KBL', name: 'KBL TV', channelId: 'UCoki0B1g_yItdxRWRxe_syg', handle: '@onkbl' }
];
function ytVideoId(url) {
  if (!url) return '';
  const s = String(url).trim();
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^&]*&)*v=|embed\/|shorts\/|live\/|v\/))([0-9A-Za-z_-]{11})/)
    || s.match(/^([0-9A-Za-z_-]{11})$/);
  return m ? m[1] : '';
}
function officialMatch(channelId, authorUrl) {
  const cid = String(channelId || '');
  const au = String(authorUrl || '').toLowerCase();
  return OFFICIAL_CHANNELS.find(o => (cid && cid === o.channelId) || (au && au.indexOf(o.handle) >= 0)) || null;
}
// oEmbed로 제목·채널명·썸네일 확보(+가능하면 채널ID). 실패해도 videoId만으로 등록 가능.
async function ytMeta(videoId) {
  const out = { title: '', channel: '', authorUrl: '', channelId: '', thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 4500);
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: ctrl.signal });
    clearTimeout(to);
    if (r.ok) { const j = await r.json(); out.title = j.title || ''; out.channel = j.author_name || ''; out.authorUrl = j.author_url || ''; if (j.thumbnail_url) out.thumb = j.thumbnail_url; }
  } catch (e) { }
  // authorUrl이 /channel/UC... 형태면 채널ID 추출
  const cm = String(out.authorUrl).match(/channel\/(UC[0-9A-Za-z_-]{22})/); if (cm) out.channelId = cm[1];
  return out;
}
const adminSubs = new Map();        // 관리자 알림 구독: endpoint -> subscription
let _lastErrPush = 0;
// 기능 토글/메인터넌스 (관리자가 바꾸면 전체 유저에 즉시 반영, 코드/배포 불필요)
const CFG = { flags: {}, maint: '', bskSrc: 'thesports', ftbSrc: 'thesports', volSrc: 'thesports', bsbSrc: 'thesports', alertsOff: false, alertsNight: false, updatedAt: 0 };
function logError(src, type, msg, extra, force) {
  try {
    const e = { ts: Date.now(), src: src || 'server', type: type || 'error', msg: String((msg && msg.message) || msg || '').slice(0, 600), extra: extra || null };
    ERRLOG.push(e); if (ERRLOG.length > ERR_MAX) ERRLOG.splice(0, ERRLOG.length - ERR_MAX);
    if (errorsCol) errorsCol.insertOne({ ts: e.ts, at: new Date(e.ts), src: e.src, type: e.type, msg: e.msg, extra: e.extra }).catch(() => {});
    adminAlert(e, force);
  } catch (_) {}
}
// 📡 운영 경보: API 소진·연속 실패처럼 '조용히 처리되던' 장애를 관리자 폰으로 알림.
// 2분 글로벌 쓰로틀을 우회(force)하는 대신, 경보 종류별 쿨다운으로 스팸을 막는다.
const _opAlertAt = new Map();   // key -> 마지막 발송 ts
function opAlert(key, body, gapMs) {
  try {
    const now = Date.now();
    if (now - (_opAlertAt.get(key) || 0) < (gapMs || 1800000)) return;   // 기본 30분 쿨다운
    _opAlertAt.set(key, now);
    logError('api', key, body, { op: true }, true);   // 오류 로그에도 남기고 + 폰 알림 강제 발송
  } catch (_) {}
}
const _alertDedup = new Map();   // 'src/type' -> 마지막 폰알림 발송 ts (동일 유형 반복 억제)
function inQuietHours() {   // 야간(KST 0~8시) = 폰 알림 억제 시간대. 로그에는 계속 쌓임.
  const h = (new Date().getUTCHours() + 9) % 24;
  return h >= 0 && h < 8;
}
function adminAlert(e, force) {
  try {
    if (typeof PUSH_ON === 'undefined' || !PUSH_ON || !adminSubs.size) return;
    const isTest = e && e.src === 'admin' && e.type === 'test';   // 관리자 '테스트 알림' 버튼은 항상 발송
    if (!isTest) {
      if (CFG.alertsOff) return;                       // 🔕 관리자페이지에서 알림 완전 OFF
      if (e && e.src === 'client') return;             // 브라우저(사용자) JS 에러는 폰 알림 X — 너무 잦음. 로그만.
      if (inQuietHours() && !CFG.alertsNight) return;  // 🌙 야간 억제(기본 ON). 에러는 로그에 남아 아침에 확인 가능.
      const now = Date.now();
      const sig = (e && (e.src + '/' + e.type)) || 'x';
      if (now - (_alertDedup.get(sig) || 0) < 3600000) return;   // 동일 유형은 60분에 한 번만
      if (!force && now - _lastErrPush < 120000) return;         // 전체 최소 간격 2분
      _alertDedup.set(sig, now);
      _lastErrPush = now;
    }
    const title = isTest ? '🔔 LIVE UP 테스트' : (e && e.src === 'api') ? '📡 LIVE UP 데이터 경보' : '⚠️ LIVE UP 오류 감지';
    const payload = JSON.stringify({ title, body: `[${e.src}/${e.type}] ${e.msg}`.slice(0, 140), admin: true, url: '/admin' });
    for (const [ep, sub] of adminSubs) {
      webpush.sendNotification(sub, payload).catch(err => { if (err && (err.statusCode === 404 || err.statusCode === 410)) { adminSubs.delete(ep); if (adminSubsCol) adminSubsCol.deleteOne({ endpoint: ep }).catch(() => {}); } });
    }
  } catch (_) {}
}
// ⚠️ 복구 불가능한 프로세스 오류(uncaughtException)는 상태가 불확정 → 로그 남기고 '깨끗하게 재시작'
//    (요청별 오류는 각 라우트의 try/catch에서 처리됨. 여기는 그 바깥에서 샌 '프로세스 레벨' 오류만 도달)
//    unhandledRejection은 대부분 요청-스코프라 로그만 남기고 계속 실행.
let _shuttingDown = false;
function gracefulExit(code, reason) {
  if (_shuttingDown) return; _shuttingDown = true;
  logError('server', 'shutdown', reason || 'graceful', {}, true);
  try { wss && wss.clients && wss.clients.forEach(c => { try { c.close(1012, 'restart'); } catch (_) {} }); } catch (_) {}
  try { server.close(() => process.exit(code)); } catch (_) { process.exit(code); }
  setTimeout(() => process.exit(code), 3000).unref?.();   // 드레인 타임아웃
}
process.on('uncaughtException', (e) => {
  logError('server', 'uncaughtException', e, { stack: String((e && e.stack) || '').slice(0, 400) }, true);
  opAlert('server-fatal', `치명 오류(uncaughtException) — 프로세스 재시작: ${String((e && e.message) || e).slice(0, 100)}`, 300000);
  gracefulExit(1, 'uncaughtException');   // 재시작은 플랫폼(Render)이 담당
});
process.on('unhandledRejection', (e) => { logError('server', 'unhandledRejection', e, { stack: String((e && e.stack) || '').slice(0, 400) }); });
// Render 배포/재시작 시 SIGTERM → 안전 종료(연결 드레인)
process.on('SIGTERM', () => gracefulExit(0, 'SIGTERM'));
process.on('SIGINT', () => gracefulExit(0, 'SIGINT'));

function maskKey(k) {
  k = String(k || '');
  if (k.startsWith('u:')) return '회원';
  if (k.startsWith('d:')) return '기기·' + k.slice(2, 8);
  if (k.startsWith('ip:')) { const p = k.slice(3).split('.'); return 'IP ' + (p[0] || '') + '.' + (p[1] || '') + '.*.*'; }
  return k.slice(0, 12);
}
function recordVisitor(key, name, ip, cc, type, now) {
  if (!key) return;
  let v = VISITORS.get(key);
  if (!v) { v = { key, name: name || '', count: 0, first: now, last: now, ip, cc }; VISITORS.set(key, v); }
  v.last = now; if (name) v.name = name; if (ip) v.ip = ip; if (cc) v.cc = cc;
  if (type === 'visit') {
    v.count = (v.count || 0) + 1;
    if (visitorsCol) visitorsCol.updateOne({ key }, { $inc: { count: 1 }, $set: { name: v.name, ip, cc, last: now }, $setOnInsert: { first: now } }, { upsert: true }).catch(() => {});
  } else if (visitorsCol) {
    visitorsCol.updateOne({ key }, { $set: { last: now } }).catch(() => {});
  }
}
function clientIP(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  let ip = xf || req.ip || (req.socket && req.socket.remoteAddress) || '';
  return ip.replace(/^::ffff:/, '');   // IPv4-mapped 정리
}
// IP → 국가코드 (오프라인 GeoIP + 캐시)
const geoCache = new Map();   // ip -> countryCode
function isPrivateIP(ip) { return !ip || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80|localhost)/i.test(ip); }
async function geoCountry(ip) {
  if (isPrivateIP(ip)) return '';
  if (geoCache.has(ip)) return geoCache.get(ip);
  let cc = '';
  try { const g = await geoip.lookup(ip); cc = (g && g.country) || ''; } catch (e) { cc = ''; }
  geoCache.set(ip, cc);
  if (geoCache.size > 20000) geoCache.delete(geoCache.keys().next().value);
  return cc;
}
// KST(한국시간) 기준 날짜/시(요약 집계용)
function kstParts(ts) { const d = new Date(ts + 9 * 3600000); return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() }; }
function fieldSafe(s) { return String(s || '(기타)').replace(/[.$]/g, '_').slice(0, 40); }
// 일별 요약 업데이트(영구 보관) — 방문/클릭/시간대/버튼별/순IP
async function aggregateDaily(ev) {
  if (!statsCol) return;
  const { day, hour } = kstParts(ev.ts);
  const inc = {};
  if (ev.t === 'visit') { inc['visits'] = 1; inc['hours.' + hour] = 1; if (ev.cc) inc['countries.' + ev.cc] = 1; }
  else if (ev.t === 'click') { inc['clicks'] = 1; inc['buttons.' + fieldSafe(ev.n)] = 1; }
  const op = { $inc: inc, $set: { day, lastTs: ev.ts } };
  if (ev.t === 'visit' && ev.ip) op.$addToSet = { ips: ev.ip };
  try { await statsCol.updateOne({ _id: day }, op, { upsert: true }); } catch (e) {}
}
function pushEvent(ev) {
  EVENTS.push(ev);
  if (EVENTS.length > EVENTS_MAX) EVENTS.splice(0, EVENTS.length - EVENTS_MAX);
  if (eventsCol) eventsCol.insertOne(ev).catch(() => {});
  aggregateDaily(ev);   // 요약은 영구 보관(용량 최소)
}

// ============================================================
//  🔐 구글 로그인 (Google Identity Services · ID토큰 서버검증)
//  · Google Cloud에서 OAuth 웹 클라이언트ID 발급 → 환경변수 GOOGLE_CLIENT_ID 에 넣기
//  · 클라이언트ID는 공개값이라 노출돼도 안전 (시크릿 아님)
// ============================================================
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const USERS = new Map(); // sub -> {id,email,name,picture,first,last,token}
const TOKENS = new Map(); // 로그인 토큰 -> sub (API 인증용)

function genToken() { return crypto.randomBytes(24).toString('hex'); }
function userFromReq(req) { const tk = req.get('x-user-token') || (req.body && req.body.token) || ''; const sub = TOKENS.get(String(tk)); return sub ? USERS.get(sub) : null; }

// ============================================================
//  🗄️ MongoDB (선택) — 회원 영구 저장. MONGODB_URI 없으면 메모리 모드로 동작.
//     Render 환경변수: MONGODB_URI = mongodb+srv://... (MongoDB Atlas 무료 M0)
// ============================================================
const MONGODB_URI = (process.env.MONGODB_URI || process.env.DATABASE_URL || '').trim();
let usersCol = null;   // 연결되면 회원 컬렉션, 아니면 null(메모리 모드)
let _dbTries = 0;
async function initDB() {
  if (!MONGODB_URI) { console.log('[DB] MONGODB_URI 미설정 — 메모리 모드(재시작 시 회원 초기화)'); return; }
  if (usersCol) return;   // 이미 연결됨
  try {
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'liveup');
    usersCol = db.collection('users');
    await usersCol.createIndex({ id: 1 }, { unique: true });
    // 📊 접속 추적 — 원본은 최근 90일만(TTL 자동정리), 일별 요약은 영구 보관
    eventsCol = db.collection('events');
    statsCol = db.collection('stats_daily');
    try {
      await eventsCol.createIndex({ ts: 1 });
      await eventsCol.createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });   // 원본 90일 후 자동삭제
      const recent = await eventsCol.find({}).sort({ ts: -1 }).limit(EVENTS_MAX).toArray();
      recent.reverse().forEach(e => EVENTS.push(e));
      console.log(`[DB] 접속 원본 ${recent.length}건 로드 · 일별요약 영구보관`);
    } catch (e) { console.error('[DB] events 초기화 실패:', e.message); }
    // 👥 재방문자 컬렉션
    visitorsCol = db.collection('visitors');
    try {
      await visitorsCol.createIndex({ key: 1 }, { unique: true });
      await visitorsCol.createIndex({ last: -1 });
      const vs = await visitorsCol.find({}).sort({ last: -1 }).limit(8000).toArray();
      vs.forEach(v => VISITORS.set(v.key, { key: v.key, name: v.name || '', count: v.count || 0, first: v.first || 0, last: v.last || 0, ip: v.ip || '', cc: v.cc || '' }));
      console.log(`[DB] 방문자 ${vs.length}명 로드`);
    } catch (e) { console.error('[DB] visitors 초기화 실패:', e.message); }
    // 🔔 웹푸시 구독 — 재시작·재배포 후에도 알림이 계속 오도록 DB에 영구 저장
    subsCol = db.collection('push_subs');
    try {
      await subsCol.createIndex({ endpoint: 1 }, { unique: true });
      const allSubs = await subsCol.find({}).toArray();
      for (const s of allSubs) { if (s.endpoint && s.sub) subs.set(s.endpoint, { sub: s.sub, fav: s.fav || [], prefs: s.prefs || {}, lang: s.lang || 'en' }); }
      console.log(`[DB] 푸시 구독 ${allSubs.length}건 로드`);
    } catch (e) { console.error('[DB] push_subs 초기화 실패:', e.message); }
    // 🛠️ 운영: 에러로그·기능토글·관리자알림 컬렉션
    try {
      errorsCol = db.collection('errors'); await errorsCol.createIndex({ ts: -1 }).catch(() => {});
      configCol = db.collection('config');
      const c = await configCol.findOne({ _id: 'main' });
      if (c) { CFG.flags = c.flags || {}; CFG.maint = c.maint || ''; CFG.bskSrc = c.bskSrc || 'thesports'; CFG.ftbSrc = c.ftbSrc || 'thesports'; CFG.volSrc = c.volSrc || 'thesports'; CFG.bsbSrc = c.bsbSrc || 'thesports'; CFG.alertsOff = !!c.alertsOff; CFG.alertsNight = !!c.alertsNight; CFG.updatedAt = c.updatedAt || 0;
        // 🎥 트래커 URL(72시간마다 갱신) 복원 — 관리자가 저장한 값이 하드코딩 기본값을 덮어씀(재배포 불필요)
        if (c.tracker) { ['football', 'basketball', 'volleyball', 'baseball'].forEach(s => { if (typeof c.tracker[s] === 'string' && c.tracker[s]) TRACKER_URLS[s] = c.tracker[s]; }); console.log('[DB] 트래커 URL 복원'); }
      }
      // 📡 직전 접속수 복원 — 10분 이내에 저장된 값만 바닥값으로 사용(오래된 값은 무시)
      try { const pdoc = await configCol.findOne({ _id: 'presence' }); if (pdoc && pdoc.n > 0 && (Date.now() - (pdoc.at || 0) < 10 * 60 * 1000)) { _presenceFloor = pdoc.n; console.log(`[DB] 접속수 바닥값 복원: ${_presenceFloor}`); } } catch (_) {}
      adminSubsCol = db.collection('admin_subs');
      const asList = await adminSubsCol.find({}).toArray();
      for (const s of asList) { if (s.endpoint && s.sub) adminSubs.set(s.endpoint, s.sub); }
      console.log(`[DB] 운영 config/에러/관리자알림 로드 (관리자구독 ${asList.length})`);
      // 🎬 하이라이트 로드
      try { highlightsCol = db.collection('highlights'); await highlightsCol.createIndex({ key: 1 }, { unique: true }).catch(() => {}); const hls = await highlightsCol.find({}).toArray(); for (const h of hls) { if (h.key) HIGHLIGHTS.set(h.key, h); } console.log(`[DB] 하이라이트 ${hls.length}건 로드`); } catch (e) { console.error('[DB] highlights 로드 실패:', e.message); }
      // 🗄️ 농구 종료경기 박스/흐름 스냅샷 영속 저장(서버 재시작 후에도 유지). 48h TTL 자동정리.
      try { bskSnapCol = db.collection('bsk_snap'); await bskSnapCol.createIndex({ at: 1 }, { expireAfterSeconds: 172800 }).catch(() => {}); const cnt = await bskSnapCol.estimatedDocumentCount().catch(() => 0); console.log(`[DB] 농구 스냅샷 컬렉션 준비(보존 ${cnt}건)`); } catch (e) { console.error('[DB] bsk_snap 초기화 실패:', e.message); }
    } catch (e) { console.error('[DB] 운영 컬렉션 초기화 실패:', e.message); }
    const all = await usersCol.find({}).toArray();   // 기존 회원 메모리에 로드
    for (const u of all) {
      USERS.set(u.id, { id: u.id, email: u.email, name: u.name, picture: u.picture, verified: u.verified, first: u.first, last: u.last, token: u.token });
      if (u.token) TOKENS.set(u.token, u.id);   // 로그인 토큰 복원
    }
    console.log(`[DB] MongoDB 연결됨 · 회원 ${all.length}명 로드`);
  } catch (e) {
    usersCol = null; _dbTries++;
    console.error(`[DB] 연결 실패(#${_dbTries}) → 60초 후 자동 재시도:`, e.message);
    setTimeout(initDB, 60000);   // IP 화이트리스트 추가 등으로 나중에 열리면 자동 연결
  }
}
initDB();
// 회원 1명 저장(업서트) — DB 있으면 영구 저장, 없으면 메모리만
function persistUser(rec) {
  if (!usersCol || !rec || !rec.id) return;
  usersCol.updateOne({ id: rec.id }, { $set: rec }, { upsert: true }).catch(e => console.error('[DB] upsert 실패:', e.message));
}
// ✉️ 회원가입 안내 메일 발송 (Google Workspace SMTP · @liveup.fans)
//   Render 환경변수: SMTP_USER=noreply@liveup.fans, SMTP_PASS=<Workspace 앱 비밀번호>
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASS = (process.env.SMTP_PASS || '').trim();
const MAIL_FROM = (process.env.MAIL_FROM || `LIVE UP <${SMTP_USER || 'noreply@liveup.fans'}>`).trim();
let mailer = null;
if (SMTP_USER && SMTP_PASS) {
  try { mailer = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: SMTP_USER, pass: SMTP_PASS } }); } catch (e) { mailer = null; }
}
async function sendWelcomeMail(to, name) {
  if (!mailer || !to) return;
  const html = `<div style="max-width:520px;margin:0 auto;font-family:Apple SD Gothic Neo,Arial,sans-serif;color:#1a2333">
    <div style="background:radial-gradient(120% 150% at 50% 0%,#1a2740,#0b0f16);border-radius:16px;padding:26px;text-align:center">
      <div style="font-size:26px;font-weight:900;font-style:italic;color:#f0c14e">LIVE<span style="color:#7fc7ff">UP</span></div>
      <div style="color:#c7d0dd;font-size:12px;margin-top:4px">REAL TIME, ALL THE TIME</div>
    </div>
    <div style="padding:22px 6px">
      <h2 style="margin:0 0 8px">${name || '회원'}님, 가입을 환영합니다 🎉</h2>
      <p style="color:#444;line-height:1.6;font-size:14px">LIVE UP에 오신 것을 환영해요! 이제 실시간 스코어·AI 코멘트·커뮤니티를 모두 이용하실 수 있어요.</p>
      <ul style="color:#444;font-size:14px;line-height:1.8;padding-left:18px">
        <li>⚡ KBO·NPB·MLB 실시간 스코어와 선수 기록</li>
        <li>🤖 AI 경기 코멘트 · 최근 전적·상대전적</li>
        <li>💬 경기별 실시간 채팅</li>
      </ul>
      <div style="text-align:center;margin:22px 0">
        <a href="https://liveup.fans" style="background:linear-gradient(135deg,#f6d67a,#e0a92e);color:#2a1e05;text-decoration:none;font-weight:800;padding:12px 26px;border-radius:12px;display:inline-block">지금 시작하기 ›</a>
      </div>
      <p style="color:#8b93a0;font-size:11px;line-height:1.5">본 메일은 회원가입 안내용으로 발송되었습니다. · LIVE UP · liveup.fans</p>
    </div>
  </div>`;
  try { await mailer.sendMail({ from: MAIL_FROM, to, subject: 'LIVE UP 가입을 환영합니다 🎉', html }); }
  catch (e) { console.error('welcome mail failed:', e.message); }
}
app.get('/api/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID, flags: CFG.flags || {}, maint: CFG.maint || '', bskSrc: CFG.bskSrc || 'auto', ftbSrc: CFG.ftbSrc || 'thesports', volSrc: CFG.volSrc || 'thesports' }));
app.post('/api/auth/google', async (req, res) => {
  const cred = req.body && req.body.credential;
  if (!GOOGLE_CLIENT_ID) return res.json({ ok: false, error: '서버에 GOOGLE_CLIENT_ID 미설정' });
  if (!cred) return res.json({ ok: false, error: 'no credential' });
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred));
    const info = await r.json();
    if (!info || info.error_description) return res.json({ ok: false, error: 'invalid token' });
    if (info.aud !== GOOGLE_CLIENT_ID) return res.json({ ok: false, error: 'audience mismatch' });
    if (!/accounts\.google\.com$/.test(String(info.iss || '').replace(/^https?:\/\//, ''))) return res.json({ ok: false, error: 'issuer mismatch' });
    if (info.exp && Number(info.exp) * 1000 < Date.now()) return res.json({ ok: false, error: 'expired' });
    const now = Date.now();
    const prev = USERS.get(info.sub);
    const user = { id: info.sub, email: info.email || '', name: info.name || (info.email || 'user').split('@')[0], picture: info.picture || '', verified: String(info.email_verified) === 'true' };
    const token = (prev && prev.token) || genToken();
    const rec = Object.assign({ first: prev ? prev.first : now }, user, { last: now, token });
    USERS.set(info.sub, rec);
    TOKENS.set(token, info.sub);
    persistUser(rec);   // 🗄️ DB에 영구 저장(있을 때)
    if (!prev) sendWelcomeMail(user.email, user.name);   // 첫 가입 시 환영 메일
    res.json({ ok: true, user, isNew: !prev, token });
  } catch (e) { res.json({ ok: false, error: String(e.message || e) }); }
});
app.get('/api/auth/count', (req, res) => res.json({ users: USERS.size }));

// 🗑️ 회원 탈퇴 — 토큰으로 본인 확인 후 실제 삭제(메모리 + DB)
app.post('/api/auth/delete', async (req, res) => {
  const token = (req.body && req.body.token) || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const sub = token && TOKENS.get(token);
  if (!sub) return res.json({ ok: false, error: '인증 필요(토큰 없음)' });
  const rec = USERS.get(sub);
  try {
    USERS.delete(sub);
    TOKENS.delete(token);
    if (usersCol) await usersCol.deleteOne({ id: sub });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: String(e.message || e) }); }
});

// ============================================================
//  👑 관리자 (비밀번호 인증) — Render 환경변수 ADMIN_KEY 설정
//     /admin 페이지에서 비밀번호 입력 → 회원 목록·통계 확인
// ============================================================
const ADMIN_KEY = (process.env.ADMIN_KEY || '').trim();
function adminOK(req) {
  const k = req.get('x-admin-key') || (req.query && req.query.key) || (req.body && req.body.key) || '';
  return !!ADMIN_KEY && String(k) === ADMIN_KEY;
}
// 관리자 로그인 확인(비밀번호 검증만)
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_KEY) return res.json({ ok: false, error: '서버에 ADMIN_KEY 환경변수가 설정되지 않았습니다' });
  res.json({ ok: !!(req.body && String(req.body.key) === ADMIN_KEY) });
});
// 회원 통계
app.get('/api/admin/stats', (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const now = Date.now();
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const todayStart = t0.getTime(), weekAgo = now - 7 * 86400000;
  const arr = [...USERS.values()];
  res.json({
    ok: true,
    total: arr.length,
    todayNew: arr.filter(u => (u.first || 0) >= todayStart).length,
    weekNew: arr.filter(u => (u.first || 0) >= weekAgo).length,
    online: (typeof livePresence === 'function') ? livePresence() : 0,
    persist: !!usersCol
  });
});
// 회원 목록(최신 가입순)
app.get('/api/admin/users', (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const list = [...USERS.values()]
    .sort((a, b) => (b.first || 0) - (a.first || 0))
    .map(u => ({ name: u.name, email: u.email, picture: u.picture, verified: u.verified, first: u.first, last: u.last }));
  res.json({ ok: true, count: list.length, persist: !!usersCol, users: list });
});

// 📊 접속/클릭 수집 (공개) — 클라이언트가 방문·버튼클릭 전송
app.post('/api/track', async (req, res) => {
  try {
    const b = req.body || {};
    const type = String(b.t || 'visit').slice(0, 12);           // 'visit' | 'click'
    const name = String(b.n || '').slice(0, 60);                // 버튼/탭 라벨
    const page = String(b.p || '').slice(0, 60);
    const lang = String(b.l || '').slice(0, 6);
    const u = userFromReq(req);
    const now = Date.now();
    const ip = clientIP(req);
    const cc = await geoCountry(ip);                            // 국가코드(오프라인)
    // 👥 재방문자 기록: 회원=uid, 비회원=기기 vid, 없으면 IP 기준
    const vid = String(b.vid || '').slice(0, 40);
    const vkey = (u && u.id) ? ('u:' + u.id) : (vid ? ('d:' + vid) : ('ip:' + ip));
    recordVisitor(vkey, u ? u.name : '', ip, cc, type, now);
    if (type === 'ping') { return res.json({ ok: true }); }   // 하트비트는 이벤트버퍼에 안 쌓음
    pushEvent({
      ts: now, at: new Date(now), t: type, n: name, p: page, l: lang,
      ip, cc,
      ua: String(req.get('user-agent') || '').slice(0, 200),
      uid: u ? u.id : '', uname: u ? u.name : ''
    });
  } catch (e) {}
  res.json({ ok: true });
});

// 📊 관리자 접속자 추적 통계
app.get('/api/admin/analytics', async (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
  const now = Date.now();
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const todayStart = t0.getTime();
  const dayAgo = now - 24 * 3600000;
  const visits = EVENTS.filter(e => e.t === 'visit');
  const clicks = EVENTS.filter(e => e.t === 'click');
  let todayVisits = visits.filter(e => e.ts >= todayStart);
  let uniqIPToday = new Set(todayVisits.map(e => e.ip)).size;
  // 시간대별(최근 24시간) 방문 수 — 메모리(롤링)
  const byHour = [];
  for (let h = 23; h >= 0; h--) {
    const start = now - (h + 1) * 3600000, end = now - h * 3600000;
    const d = new Date(end);
    byHour.push({ label: String(d.getHours()).padStart(2, '0'), count: visits.filter(e => e.ts >= start && e.ts < end).length });
  }
  // 📊 영구 요약(stats_daily) 기반 — 전체 통계·클릭TOP·국가TOP·14일 추이
  let totalVisits, totalClicks, topClicks, topCountries = [], trend = [];
  if (statsCol) {
    try {
      // ⚡ ips 배열(대용량)은 제외하고 로드 → analytics 응답 빠르게(타임아웃·에러 방지)
      const docs = await statsCol.find({}, { projection: { ips: 0 } }).toArray();
      const todayKey = kstParts(now).day;
      let tv = 0, tc = 0; const bmap = {}, cmap = {};
      docs.forEach(d => {
        tv += d.visits || 0; tc += d.clicks || 0;
        const b = d.buttons || {}; for (const k in b) bmap[k] = (bmap[k] || 0) + b[k];
        const c = d.countries || {}; for (const k in c) cmap[k] = (cmap[k] || 0) + c[k];
      });
      totalVisits = tv; totalClicks = tc;
      topClicks = Object.entries(bmap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20);
      topCountries = Object.entries(cmap).map(([cc, count]) => ({ cc, count })).sort((a, b) => b.count - a.count).slice(0, 12);
      const td = docs.find(d => d._id === todayKey);
      todayVisits = td ? (td.visits || 0) : 0;
      // 오늘 순방문 IP 수는 today 문서만 따로(가볍게) 조회
      try { const tdoc = await statsCol.findOne({ _id: todayKey }, { projection: { ips: 1 } }); uniqIPToday = tdoc && tdoc.ips ? tdoc.ips.length : 0; } catch { uniqIPToday = 0; }
      trend = docs.map(d => ({ day: d._id, visits: d.visits || 0 })).filter(x => x.day).sort((a, b) => a.day < b.day ? -1 : 1).slice(-14);
    } catch (e) { totalVisits = undefined; }
  }
  // 메모리 폴백 (DB 없을 때)
  if (totalVisits === undefined) {
    totalVisits = visits.length; totalClicks = clicks.length;
    todayVisits = visits.filter(e => e.ts >= todayStart).length;
    uniqIPToday = new Set(visits.filter(e => e.ts >= todayStart).map(e => e.ip)).size;
    const clickMap = {}; clicks.forEach(e => { const k = e.n || '(기타)'; clickMap[k] = (clickMap[k] || 0) + 1; });
    topClicks = Object.entries(clickMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20);
    const ccMap = {}; visits.forEach(e => { if (e.cc) ccMap[e.cc] = (ccMap[e.cc] || 0) + 1; });
    topCountries = Object.entries(ccMap).map(([cc, count]) => ({ cc, count })).sort((a, b) => b.count - a.count).slice(0, 12);
  }
  // 최근 접속/클릭 로그 (최신순 80건) — 국가 포함
  const recent = EVENTS.slice(-80).reverse().map(e => ({
    ts: e.ts, t: e.t, n: e.n, ip: e.ip, cc: e.cc || '', ua: e.ua, uname: e.uname, l: e.l, p: e.p
  }));
  // 👥 재방문자 통계 (총 접속중 / 재방문 접속중 / 방문자별 방문횟수)
  const nowT = Date.now();
  let onlineVisitors = 0, returningOnline = 0, returningTotal = 0;
  const vlist = [];
  for (const v of VISITORS.values()) {
    const on = (nowT - (v.last || 0)) <= ONLINE_WIN;
    const ret = (v.count || 0) >= 2;
    if (ret) returningTotal++;
    if (on) { onlineVisitors++; if (ret) returningOnline++; }
    vlist.push({ who: v.name || maskKey(v.key), count: v.count || 0, online: on, returning: ret, last: v.last || 0, cc: v.cc || '' });
  }
  vlist.sort((a, b) => (b.online - a.online) || (b.count - a.count) || (b.last - a.last));
  const visitors = vlist.slice(0, 80);
  res.json({
    ok: true,
    persist: !!statsCol,
    stored: EVENTS.length,
    online: (typeof livePresence === 'function') ? livePresence() : 0,
    todayVisits, uniqIPToday,
    visits24h: visits.filter(e => e.ts >= dayAgo).length,
    totalVisits, totalClicks,
    onlineVisitors, returningOnline, returningTotal, uniqueVisitors: VISITORS.size,
    byHour, topClicks, topCountries, trend, recent, visitors
  });
  } catch (e) {
    // 어떤 이유로든 집계 실패해도 500(비JSON)이 아니라 JSON으로 안전 응답 → 관리자 "-"/에러 방지
    res.json({ ok: true, degraded: true, err: String((e && e.message) || e), stored: EVENTS.length, online: (typeof livePresence === 'function') ? livePresence() : 0, todayVisits: 0, uniqIPToday: 0, totalVisits: 0, totalClicks: 0, onlineVisitors: 0, returningOnline: 0, returningTotal: 0, uniqueVisitors: VISITORS.size, byHour: [], topClicks: [], topCountries: [], trend: [], recent: [], visitors: [] });
  }
});

// ============================================================
//  🛠️ 운영 관리자 API — 에러 모니터링 / 기능 토글 / 관리자 폰 알림 / 캐시
// ============================================================
// (공개 config는 위의 /api/config 에 병합됨 — flags/maint/bskSrc 포함)
// 클라이언트 JS 에러 수집 (window.onerror 등)
app.post('/api/clienterror', (req, res) => {
  const b = req.body || {};
  logError('client', String(b.type || 'js').slice(0, 30), b.msg, { url: String(b.url || '').slice(0, 200), line: b.line, ua: String(req.headers['user-agent'] || '').slice(0, 140) });
  res.json({ ok: true });
});
// 관리자: 에러 목록 / 비우기
app.get('/api/admin/errors', (req, res) => { if (!adminOK(req)) return res.status(401).json({ ok: false }); res.json({ ok: true, count: ERRLOG.length, errors: ERRLOG.slice(-150).reverse() }); });
app.post('/api/admin/errors/clear', (req, res) => { if (!adminOK(req)) return res.status(401).json({ ok: false }); ERRLOG.length = 0; res.json({ ok: true }); });
// 관리자: 기능 토글 / 메인터넌스 / 농구소스 저장 (전체 유저 즉시 반영)
app.get('/api/admin/config', (req, res) => { if (!adminOK(req)) return res.status(401).json({ ok: false }); res.json({ ok: true, flags: CFG.flags, maint: CFG.maint, bskSrc: CFG.bskSrc, ftbSrc: CFG.ftbSrc, volSrc: CFG.volSrc, alertsOff: CFG.alertsOff, alertsNight: CFG.alertsNight, updatedAt: CFG.updatedAt }); });
app.post('/api/admin/config', (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false });
  const b = req.body || {};
  if (b.flags && typeof b.flags === 'object') CFG.flags = b.flags;
  if (typeof b.maint === 'string') CFG.maint = b.maint.slice(0, 300);
  if (typeof b.bskSrc === 'string') CFG.bskSrc = b.bskSrc;
  if (typeof b.ftbSrc === 'string') CFG.ftbSrc = b.ftbSrc;
  if (typeof b.volSrc === 'string') CFG.volSrc = b.volSrc;
  if (typeof b.alertsOff === 'boolean') CFG.alertsOff = b.alertsOff;
  if (typeof b.alertsNight === 'boolean') CFG.alertsNight = b.alertsNight;
  CFG.updatedAt = Date.now();
  if (configCol) configCol.updateOne({ _id: 'main' }, { $set: { flags: CFG.flags, maint: CFG.maint, bskSrc: CFG.bskSrc, ftbSrc: CFG.ftbSrc, volSrc: CFG.volSrc, alertsOff: CFG.alertsOff, alertsNight: CFG.alertsNight, updatedAt: CFG.updatedAt } }, { upsert: true }).catch(() => {});
  res.json({ ok: true, flags: CFG.flags, maint: CFG.maint, bskSrc: CFG.bskSrc, ftbSrc: CFG.ftbSrc, volSrc: CFG.volSrc, alertsOff: CFG.alertsOff, alertsNight: CFG.alertsNight });
});
// 관리자: 폰 알림 구독 / 테스트
app.post('/api/admin/push/subscribe', (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false });
  const s = req.body && req.body.subscription;
  if (!s || !s.endpoint) return res.status(400).json({ ok: false, error: 'no subscription' });
  adminSubs.set(s.endpoint, s);
  if (adminSubsCol) adminSubsCol.updateOne({ endpoint: s.endpoint }, { $set: { endpoint: s.endpoint, sub: s, at: new Date() } }, { upsert: true }).catch(() => {});
  res.json({ ok: true, count: adminSubs.size });
});
app.post('/api/admin/push/test', (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false });
  adminAlert({ src: 'admin', type: 'test', msg: '테스트 알림 — 정상 작동합니다 ✅' }, true);
  res.json({ ok: true, admins: adminSubs.size });
});
// 관리자: 서버 캐시 비우기 (스코어 지연·오염 즉시 해소)
app.post('/api/admin/cache/clear', (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false });
  let cleared = [];
  try { if (typeof cache !== 'undefined' && cache.clear) { cache.clear(); cleared.push('raw'); } } catch {}
  try { if (typeof gamesCoreCache !== 'undefined') { gamesCoreCache.clear(); cleared.push('core'); } } catch {}
  try { if (typeof fullGamesCache !== 'undefined') { fullGamesCache.clear(); cleared.push('full'); } } catch {}
  res.json({ ok: true, cleared });
});

// 📰 스포츠 뉴스 (ESPN RSS 프록시) — 전체/축구/MLB/NBA/NFL/NHL
const NEWS_FEEDS = {
  all: 'https://www.espn.com/espn/rss/news',
  soccer: 'https://www.espn.com/espn/rss/soccer/news',
  mlb: 'https://www.espn.com/espn/rss/mlb/news',
  nba: 'https://www.espn.com/espn/rss/nba/news',
  nfl: 'https://www.espn.com/espn/rss/nfl/news',
  nhl: 'https://www.espn.com/espn/rss/nhl/news'
};
const newsCache = new Map();
function decodeEnt(s) { return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)); }
function parseRss(xml) {
  const items = [];
  const blocks = String(xml).split(/<item[\s>]/i).slice(1);
  for (const b of blocks) {
    const end = b.search(/<\/item>/i); const seg = end >= 0 ? b.slice(0, end) : b;
    const pick = (tag) => { const m = seg.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i')); if (!m) return ''; let v = m[1].trim(); v = v.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim(); return v; };
    const title = pick('title'); const link = pick('link'); const pub = pick('pubDate'); const desc = pick('description');
    // RSS 자체에 이미지가 있으면 사용(media:thumbnail/content, enclosure)
    let img = '';
    const mm = seg.match(/<media:(?:thumbnail|content)[^>]*url=["']([^"']+)["']/i) || seg.match(/<enclosure[^>]*url=["']([^"']+)["']/i);
    if (mm) img = mm[1];
    if (title) items.push({ title: decodeEnt(title), link: link || '', desc: decodeEnt(desc).replace(/<[^>]+>/g, '').slice(0, 140), ts: pub ? (Date.parse(pub) || 0) : 0, image: img });
  }
  return items;
}
// 기사 자체의 대표 이미지(og:image) 추출 — RSS에 이미지가 없을 때 실데이터 썸네일 확보
const ogCache = new Map();
async function fetchOgImage(url) {
  if (!url) return '';
  const c = ogCache.get(url);
  if (c && Date.now() - c.t < 86400000) return c.img;   // 1일 캐시
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 4500);
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LiveUp News)' }, signal: ctrl.signal });
    clearTimeout(to);
    const html = (await r.text()).slice(0, 60000);   // head 영역만 보면 충분
    const m = html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::url)?["']/i)
      || html.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
    const img = m ? decodeEnt(m[1]) : '';
    ogCache.set(url, { t: Date.now(), img });
    return img;
  } catch (e) { ogCache.set(url, { t: Date.now(), img: '' }); return ''; }
}
app.get('/api/news', async (req, res) => {
  const cat = String(req.query.cat || 'all').toLowerCase();
  const url = NEWS_FEEDS[cat] || NEWS_FEEDS.all;
  const now = Date.now(); const hit = newsCache.get(cat);
  if (hit && now - hit.t < 600000) return res.json({ ok: true, cat, items: hit.items });
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LiveUp News)' } });
    const xml = await r.text();
    const items = parseRss(xml).slice(0, 15);
    // 이미지 없는 항목은 기사 og:image로 보강(상위 12개, 병렬·타임아웃·캐시)
    const need = items.slice(0, 12).filter(it => !it.image && it.link);
    await Promise.all(need.map(async it => { it.image = await fetchOgImage(it.link); }));
    if (items.length) newsCache.set(cat, { t: now, items });
    res.json({ ok: true, cat, items: items.length ? items : (hit ? hit.items : []) });
  } catch (e) {
    if (hit) return res.json({ ok: true, cat, items: hit.items });
    res.json({ ok: false, cat, items: [] });
  }
});

// ============================================================
//  🎬 경기 하이라이트 (관리자 수동 등록 CRUD + 공개 조회)
// ============================================================
function hlKey(sport, matchId) { return String(sport || '').toLowerCase() + ':' + String(matchId || ''); }
function hlPublic(h) { return h ? { sport: h.sport, matchId: h.matchId, videoId: h.videoId, url: h.url, title: h.title || '', channel: h.channel || '', channelId: h.channelId || '', authorUrl: h.authorUrl || '', thumb: h.thumb || (h.videoId ? `https://i.ytimg.com/vi/${h.videoId}/hqdefault.jpg` : ''), official: !!h.official, officialName: h.officialName || '', home: h.home || '', away: h.away || '', league: h.league || '', updatedAt: h.updatedAt || 0 } : null; }
// 공개: 해당 경기의 하이라이트 1건
app.get('/api/highlight', (req, res) => {
  const k = hlKey(req.query.sport, req.query.id);
  res.json({ ok: true, highlight: hlPublic(HIGHLIGHTS.get(k)) });
});
// 관리자: 전체 목록
app.get('/api/admin/highlights', (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false });
  const list = Array.from(HIGHLIGHTS.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(hlPublic);
  res.json({ ok: true, count: list.length, items: list, officialChannels: OFFICIAL_CHANNELS });
});
// 관리자: 등록·수정(업서트) — {sport, matchId, url, home, away, league}
app.post('/api/admin/highlight', async (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false });
  const b = req.body || {};
  const sport = String(b.sport || '').toLowerCase(), matchId = String(b.matchId || '').trim();
  if (!sport || !matchId) return res.json({ ok: false, error: '경기(sport·matchId)를 지정하세요.' });
  const vid = ytVideoId(b.url);
  if (!vid) return res.json({ ok: false, error: '유효한 YouTube 링크가 아닙니다.' });
  const meta = await ytMeta(vid);
  const off = officialMatch(meta.channelId, meta.authorUrl);
  const key = hlKey(sport, matchId);
  const prev = HIGHLIGHTS.get(key) || {};
  const doc = {
    key, sport, matchId,
    url: 'https://www.youtube.com/watch?v=' + vid, videoId: vid,
    title: meta.title, channel: meta.channel, channelId: meta.channelId, authorUrl: meta.authorUrl, thumb: meta.thumb,
    official: !!off, officialName: off ? off.name : '',
    home: b.home != null ? String(b.home) : (prev.home || ''), away: b.away != null ? String(b.away) : (prev.away || ''),
    league: b.league != null ? String(b.league) : (prev.league || ''),
    addedAt: prev.addedAt || Date.now(), updatedAt: Date.now()
  };
  HIGHLIGHTS.set(key, doc);
  if (highlightsCol) highlightsCol.updateOne({ key }, { $set: doc }, { upsert: true }).catch(e => console.error('[HL] 저장 실패', e.message));
  res.json({ ok: true, highlight: hlPublic(doc), warnOfficial: !off });
});
// 관리자: 삭제 — {sport, matchId}
app.post('/api/admin/highlight/delete', (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false });
  const key = hlKey((req.body || {}).sport, (req.body || {}).matchId);
  HIGHLIGHTS.delete(key);
  if (highlightsCol) highlightsCol.deleteOne({ key }).catch(() => {});
  res.json({ ok: true });
});

// 🩺 헬스체크(공개·경량) — Render 헬스체크 경로로 지정하면 장애 시 자동재시작/롤백에 활용
app.get('/healthz', (req, res) => {
  const mem = process.memoryUsage();
  res.json({ ok: true, version: APP_VERSION, uptimeSec: Math.round((Date.now() - METRICS.startAt) / 1000),
    db: usersCol ? 'connected' : 'memory', rssMB: Math.round(mem.rss / 1048576), elLagMs: METRICS.elLagMs });
});
// 📏 성능 지표(관리자 전용) — 개인정보·토큰·비밀키 미포함, 경로/숫자만
app.get('/api/admin/metrics', (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false });
  const mem = process.memoryUsage();
  const eps = [];
  for (const [label, m] of METRICS.ep) {
    const s = m.samples.slice().sort((a, b) => a - b);
    eps.push({ ep: label, n: m.n, errRate: m.n ? +(m.err / m.n * 100).toFixed(2) : 0,
      p50: pctl(s, 50), p95: pctl(s, 95), p99: pctl(s, 99), max: s.length ? Math.round(s[s.length - 1]) : null });
  }
  eps.sort((a, b) => b.n - a.n);
  res.json({
    ok: true, version: APP_VERSION,
    process: { startAt: new Date(METRICS.startAt).toISOString(), uptimeSec: Math.round((Date.now() - METRICS.startAt) / 1000), node: process.version,
      rssMB: +(mem.rss / 1048576).toFixed(1), heapUsedMB: +(mem.heapUsed / 1048576).toFixed(1), elLagMs: METRICS.elLagMs },
    db: { connected: !!usersCol, mode: usersCol ? 'mongodb' : 'memory' },
    presence: { online접속추정: (typeof livePresence === 'function') ? livePresence() : null, ws채팅연결: (wss && wss.clients) ? wss.clients.size : null },
    ws: METRICS.ws,
    cache: METRICS.cache,
    supplier: { ...METRICS.supplier, apiSports오늘남음: _asUsage ? _asUsage.remaining : null, apiSports하루한도: _asUsage ? _asUsage.limit : null },
    endpoints: eps.slice(0, 40)
  });
});
// 관리자 페이지
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ---------- 간단 캐시 (레이트리밋 보호) ----------
const cache = new Map();
// 🚑 공급사 호출 요청 타임아웃(장애 복구): fetch에 데드라인이 없으면 느린 공급사(TheSports 등)에서
//   요청이 무한 대기 → 1,700 동시접속에서 누적 → 이벤트루프/소켓 포화 → 사이트 전체 멈춤.
//   reqTimeout(기본 6s) 내 응답 없으면 abort. 실패 시 직전 정상 캐시가 있으면 그걸 반환(빈 결과·오류로 뭉뚱그리지 않음).
async function cachedJSON(url, ttlMs = 30000, reqTimeout = 6000) {
  const hit = cache.get(url);
  const now = Date.now();
  if (hit && now - hit.t < ttlMs) return hit.v;
  const isTs = /thesports|\/ts\/v1/i.test(url);   // 공급사 실호출 계측(캐시 미스만)
  if (isTs) METRICS.supplier.tsCall++;
  let r;
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, reqTimeout);
  try { r = await fetch(url, { headers: { 'User-Agent': 'livescore-ai/1.0' }, signal: ctrl.signal }); }
  catch (e) { if (isTs) METRICS.supplier.tsFail++; if (hit) return hit.v; throw e; }   // 타임아웃/네트워크 실패 → 직전 캐시라도 유지
  finally { clearTimeout(timer); }
  if (!r.ok) { if (isTs) METRICS.supplier.tsFail++; if (hit) return hit.v; throw new Error(`upstream ${r.status}`); }
  const v = await r.json();
  cache.set(url, { t: now, v });
  return v;
}

// ---------- 관심 리그 (프론트 좌측 네비 + 종목 매핑) ----------
const LEAGUES = [
  { id: '4328', name: '프리미어리그', en: 'English Premier League', sport: 'Soccer', flag: '🏴', country: '잉글랜드' },
  { id: '4335', name: '라리가', en: 'Spanish La Liga', sport: 'Soccer', flag: '🇪🇸', country: '스페인' },
  { id: '4480', name: '챔피언스리그', en: 'UEFA Champions League', sport: 'Soccer', flag: '🇪🇺', country: '유럽' },
  { id: '4689', name: 'K리그1', en: 'South Korean K League 1', sport: 'Soccer', flag: '🇰🇷', country: '대한민국' },
  { id: '4424', name: 'MLB', en: 'MLB', sport: 'Baseball', flag: '🇺🇸', country: '미국' },
  { id: '4830', name: 'KBO', en: 'Korean KBO League', sport: 'Baseball', flag: '🇰🇷', country: '대한민국' },
  { id: '4426', name: 'NBA', en: 'NBA', sport: 'Basketball', flag: '🇺🇸', country: '미국' },
  { id: '4423', name: 'NPB', en: 'Japanese Baseball League', sport: 'Baseball', flag: '🇯🇵', country: '일본' }
];

// 종목 한글 라벨
const SPORT_KO = { Soccer: '축구', Baseball: '야구', Basketball: '농구', 'Ice Hockey': '하키', Tennis: '테니스', 'American Football': '미식축구', Volleyball: '배구', Esports: 'e스포츠' };

// ---------- 이벤트 정규화 ----------
function normEvent(e) {
  const live = /(1st|2nd|3rd|4th|half|inning|live|playing|in progress|q1|q2|q3|q4)/i.test(e.strStatus || e.strProgress || '');
  const finished = /^(ft|aet|match finished|finished)$/i.test((e.strStatus || '').trim());
  return {
    id: e.idEvent,
    name: e.strEvent,
    sport: e.strSport,
    sportKo: SPORT_KO[e.strSport] || e.strSport,
    leagueId: e.idLeague,
    league: e.strLeague,
    leagueBadge: e.strLeagueBadge,
    round: e.intRound,
    season: e.strSeason,
    home: e.strHomeTeam,
    away: e.strAwayTeam,
    homeId: e.idHomeTeam,
    awayId: e.idAwayTeam,
    homeBadge: e.strHomeTeamBadge,
    awayBadge: e.strAwayTeamBadge,
    homeScore: e.intHomeScore,
    awayScore: e.intAwayScore,
    date: e.dateEvent,
    time: e.strTime,
    timestamp: e.strTimestamp,
    status: e.strStatus,
    progress: e.strProgress,
    venue: e.strVenue,
    thumb: e.strThumb,
    video: e.strVideo,
    state: finished ? 'finished' : (live ? 'live' : 'scheduled')
  };
}

// ============================================================
//  REST API
// ============================================================

// 관심 리그 목록
app.get('/api/leagues', (req, res) => res.json({ leagues: LEAGUES }));

// 특정 날짜 + 종목의 경기 (실시간/결과)
app.get('/api/events', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const sport = req.query.sport || 'Soccer';
    const url = `${TSDB}/eventsday.php?d=${date}&s=${encodeURIComponent(sport)}`;
    const data = await cachedJSON(url, 25000);
    const events = (data.events || []).map(normEvent);
    // 관심 리그 우선 정렬
    const pref = new Set(LEAGUES.map(l => l.id));
    events.sort((a, b) => (pref.has(b.leagueId) - pref.has(a.leagueId)) ||
      (a.state === 'live' ? -1 : 0) - (b.state === 'live' ? -1 : 0));
    res.json({ date, sport, count: events.length, events });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// 리그 순위표
app.get('/api/table', async (req, res) => {
  try {
    const id = req.query.id;
    const season = req.query.season || String(new Date().getFullYear());
    if (!id) return res.status(400).json({ error: 'id required' });
    const url = `${TSDB}/lookuptable.php?l=${id}&s=${encodeURIComponent(season)}`;
    const data = await cachedJSON(url, 120000);
    res.json({ table: data.table || [] });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// ============================================================
//  🏆 순위표 (실데이터) — 축구=API-Football, 야구=MLB StatsAPI/TheSports, 농구=API-Sports
// ============================================================
// 축구 리그명 → API-Football 리그 ID
const AF_RANK_ID = {
  'Premier League': 39, 'Championship': 40, 'La Liga': 140, 'Segunda División': 141, 'Serie A': 135, 'Serie B': 136,
  'Bundesliga': 78, 'Bundesliga 2': 79, 'Ligue 1': 61, 'Ligue 2': 62, 'Eredivisie': 88, 'Primeira Liga': 94,
  'Süper Lig': 203, 'Saudi Pro League': 307, 'K League 1': 292, 'K League 2': 293, 'J1 League': 98, 'J2 League': 99,
  'Major League Soccer': 253, 'Liga MX': 262, 'Brasileirão': 71, 'Liga Profesional Argentina': 128,
  'UEFA Champions League': 2, 'UEFA Europa League': 3, 'Eliteserien': 103, 'Allsvenskan': 113
};
// 농구 리그명 → API-Sports 농구 리그 ID
// R011: KBL 남자는 API-Sports 미커버(과거 48은 아이슬란드 리그여서 제거). WKBL=92 확인됨.
const AB_RANK_ID = { 'NBA': 12, 'EuroLeague': 120, 'KBL': 91, 'WKBL': 92 };   // B06: KBL=91, WKBL=92 (diag 확인)
const BASEBALL_RANK_ID = { 'MLB': 1, 'NPB': 2, 'KBO': 5 };   // R012/R013: API-Sports 야구 리그 id(검증됨)
function bskLeagueAlias(name) { const n = String(name || ''); if ((/\bNBA\b/i.test(n) || /national\s+basketball\s+association/i.test(n)) && !/g[\s-]?league|g\s*리그/i.test(n)) return 'NBA'; if (/euroleague/i.test(n)) return 'EuroLeague'; if (/\bWKBL\b|women'?s?\s*korean|여자\s*농구/i.test(n)) return 'WKBL'; if (/\bKBL\b|korean?\s*basketball|한국?\s*농구/i.test(n)) return 'KBL'; return name; }
async function rankFootball(league, season) {
  const lid = AF_RANK_ID[league] || (/^\d+$/.test(league) ? league : null);
  if (!lid) return { table: [], note: 'unmapped' };
  const yr = String(season || '').match(/\d{4}/); const sy = yr ? +yr[0] : new Date().getFullYear();
  const parse = j => {
    const resp = j && j.response && j.response[0];
    const st = resp && resp.league && resp.league.standings;
    const rows = (st && (st[0] || [])) || [];
    return rows.map(r => ({ rank: r.rank, teamId: r.team.id, team: r.team.name, logo: r.team.logo, played: r.all.played, win: r.all.win, draw: r.all.draw, loss: r.all.lose, points: r.points, gd: r.goalsDiff, form: r.form || '' }));
  };
  // 요청 시즌 → 비어있으면(새 시즌 시작 전 등) 직전 시즌으로 폴백
  for (const s of [sy, sy - 1]) {
    const j = await asRaw('football', `/standings?league=${lid}&season=${s}`, 3600000).catch(() => null);
    const table = parse(j);
    if (table.length) return { table, kind: 'football', season: s };
  }
  return { table: [], kind: 'football' };
}
async function rankMLB(season) {
  const m = String(season || '').match(/\d{4}/); const sy = m ? +m[0] : new Date().getFullYear();
  const DIV = { 200: 'AL West', 201: 'AL East', 202: 'AL Central', 203: 'NL West', 204: 'NL East', 205: 'NL Central' };
  for (const yr of [sy, sy - 1]) {
    const st = await mlbFetch(`/api/v1/standings?leagueId=103,104&season=${yr}&standingsTypes=regularSeason`, 600000).catch(() => null);
    if (!st) continue;
    const rows = [];
    (st.records || []).forEach(rec => (rec.teamRecords || []).forEach(tr => {
      rows.push({ team: tr.team.name, div: DIV[rec.division && rec.division.id] || '', win: tr.wins, loss: tr.losses, pct: tr.winningPercentage, gb: tr.gamesBack, streak: tr.streak ? tr.streak.streakCode : '' });
    }));
    if (rows.length) {
      rows.sort((a, b) => parseFloat(b.pct) - parseFloat(a.pct));
      rows.forEach((r, i) => r.rank = i + 1);
      return { table: rows, kind: 'baseball', season: yr };
    }
  }
  return { table: [], kind: 'baseball' };
}
// API-Sports 농구/배구 리그명 → 리그 ID 자동 검색 (하드코딩 없이 커버)
const _leagueIdCache = new Map();
// 🏐 배구 리그명(현지어 포함) → API-Sports 검색어 별칭. 성별 구분 유지(여자부는 남자 리그로 매핑 금지).
function vbLeagueAlias(name) {
  const n = String(name || '');
  if (/v\s*리그|v-?\s*league/i.test(n)) {
    if (/여자|여성|women|female|\bw\b/i.test(n)) return 'KOVO Women';   // 여자부(미커버 시 unmapped 유지)
    if (/남자|남성|men|male|\bm\b/i.test(n)) return 'KOVO';             // 남자부 → API-Sports KOVO
  }
  return name;
}
async function asLeagueId(sport, name) {
  if (!name) return null;
  const ck = sport + '|' + name;
  if (_leagueIdCache.has(ck)) return _leagueIdCache.get(ck);
  let id = null;
  try {
    const j = await asRaw(sport, `/leagues?search=${encodeURIComponent(name)}`, 86400000);
    const arr = (j && j.response) || [];
    const nl = _nrm(name);
    let best = arr.find(l => _nrm(l.name) === nl) || arr.find(l => _nrm(l.name).includes(nl) || nl.includes(_nrm(l.name))) || arr[0];
    id = best && best.id;
  } catch { }
  _leagueIdCache.set(ck, id);
  return id;
}
function parseHoopStandings(j) {
  const groups = (j && j.response) || [];
  // 팀별 1행만(콘퍼런스/디비전/전체 중복 제거). 콘퍼런스 레벨 그룹을 우선 보존.
  const byTeam = new Map();
  const asStr = v => { if (v == null) return ''; if (typeof v === 'object') return String(v.name || v.long || v.short || ''); return String(v); };  // R010: 객체 문자열화 방지
  const asNum = v => { if (v == null || v === '') return null; if (typeof v === 'object') { const n = v.total ?? v.value ?? v.count; return (n == null ? null : +n); } const n = +v; return isNaN(n) ? null : n; };
  groups.forEach(g => (Array.isArray(g) ? g : [g]).forEach(r => {
    if (!r || !r.team) return;
    const gname = asStr(r.group) || asStr(r.stage);
    const key = r.team.id || r.team.name;
    const row = {
      rank: r.position || null, teamId: r.team.id, team: asStr(r.team.name), logo: r.team.logo, group: gname,
      played: asNum(r.games && r.games.played),
      win: asNum(r.games && (r.games.win)),
      loss: asNum(r.games && (r.games.lose != null ? r.games.lose : r.games.loss)),
      points: (r.points == null || typeof r.points === 'object') ? asNum(r.points) : r.points
    };
    const prev = byTeam.get(key);
    const isConf = s => /(conference|east|west)/i.test(s || '');
    if (!prev || (isConf(gname) && !isConf(prev.group))) byTeam.set(key, row);
  }));
  const flat = Array.from(byTeam.values());
  flat.sort((a, b) => String(a.group || '').localeCompare(String(b.group || '')) || (a.rank || 99) - (b.rank || 99));
  return flat;
}
// 현재 농구 시즌(가을 개막 기준). 예: 2026-11 → "2026-2027"
function hoopSeason(d) { d = d || new Date(); const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; const s = (m >= 9) ? y : (y - 1); return s + '-' + (s + 1); }
async function rankBasketball(league, season) {
  // R008/R011: 농구 feed의 숫자 리그 id는 API-Sports 네임스페이스가 아님 → 숫자 그대로 신뢰 금지(아이슬란드 등 오매칭 원인). 이름으로만 해석.
  let lid = AB_RANK_ID[bskLeagueAlias(league)] || AB_RANK_ID[league] || null;
  if (!lid && !/^\d+$/.test(String(league))) lid = await asLeagueId('basketball', bskLeagueAlias(league));
  if (!lid) return { table: [], note: 'unmapped' };
  const cur = hoopSeason();
  const py = parseInt(cur, 10) - 1;
  for (const sy of [String(season || cur), cur, py + '-' + (py + 1)]) {
    const j = await asRaw('basketball', `/standings?league=${lid}&season=${encodeURIComponent(sy)}`, 3600000).catch(() => null);
    const table = parseHoopStandings(j);
    if (table.length) return { table, kind: 'basketball', season: sy };
  }
  return { table: [], kind: 'basketball' };
}
async function rankVolleyball(league, season) {
  let lid = /^\d+$/.test(league) ? league : await asLeagueId('volleyball', vbLeagueAlias(league));
  if (!lid) return { table: [], note: 'unmapped' };
  const m = String(season || '').match(/\d{4}/); const y = m ? +m[0] : new Date().getFullYear();
  for (const sy of [`${y}-${y + 1}`, String(y), `${y - 1}-${y}`, String(y - 1)]) {
    const j = await asRaw('volleyball', `/standings?league=${lid}&season=${encodeURIComponent(sy)}`, 3600000).catch(() => null);
    const table = parseHoopStandings(j);
    if (table.length) return { table, kind: 'volleyball', season: sy };
  }
  return { table: [], kind: 'volleyball' };
}
async function rankHockey(league, season) {
  let lid = /^\d+$/.test(league) ? league : await asLeagueId('hockey', league);
  if (!lid) return { table: [], note: 'unmapped' };
  const m = String(season || '').match(/\d{4}/); const y = m ? +m[0] : new Date().getFullYear();
  for (const sy of [String(y), String(y - 1)]) {
    const j = await asRaw('hockey', `/standings?league=${lid}&season=${encodeURIComponent(sy)}`, 3600000).catch(() => null);
    const table = parseHoopStandings(j);
    if (table.length) return { table, kind: 'hockey', season: sy };
  }
  return { table: [], kind: 'hockey' };
}
// R012/R013: KBO·NPB 순위 — API-Sports 야구 /standings (리그 48=아이슬란드 같은 교차 네임스페이스 숫자 신뢰 금지)
async function rankBaseballAS(league, season) {
  let lid = BASEBALL_RANK_ID[league] || null;
  if (!lid) { if (/kbo|korea|대한민국/i.test(league)) lid = 5; else if (/npb|nippon|japan|일본/i.test(league)) lid = 2; }
  if (!lid) return { table: [], note: 'unmapped', kind: 'baseball' };
  const m = String(season || '').match(/\d{4}/); const y = m ? +m[0] : new Date().getFullYear();
  for (const sy of [y, y - 1]) {
    const j = await asRaw('baseball', `/standings?league=${lid}&season=${sy}`, 1800000).catch(() => null);
    const table = parseHoopStandings(j);   // games.win/lose·position 구조 공통
    if (table.length) return { table, kind: 'baseball', season: String(sy) };
  }
  return { table: [], kind: 'baseball' };
}
app.get('/api/rank', async (req, res) => {
  const sport = req.query.sport || 'football', league = req.query.league || '', season = req.query.season || '';
  try {
    let out = { table: [] };
    if (sport === 'football') out = await rankFootball(league, season);
    else if (sport === 'baseball') {
      if (/KBO|NPB|CPBL|korea|japan|대한민국|일본/i.test(league)) out = await rankBaseballAS(league, season);   // R012/R013: KBO·NPB API-Sports 순위
      else out = await rankMLB(season);   // MLB(및 기본)
    }
    else if (sport === 'basketball') out = await rankBasketball(league, season);
    else if (sport === 'volleyball') out = await rankVolleyball(league, season);
    else if (sport === 'hockey') out = await rankHockey(league, season);
    res.json(out);
  } catch (e) { res.status(502).json({ table: [], error: String(e.message || e) }); }
});

// 경기 상세 (클릭 시)
app.get('/api/event', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const url = `${TSDB}/lookupevent.php?id=${id}`;
    const data = await cachedJSON(url, 20000);
    const ev = (data.events && data.events[0]) ? normEvent(data.events[0]) : null;
    const raw = (data.events && data.events[0]) || null;
    res.json({ event: ev, boxscore: raw ? raw.strResult : null, description: raw ? raw.strDescriptionEN : null });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// 간단 AI 예측 (배당/최근 상태 기반 규칙 — 데모용, 후에 모델로 교체 가능)
app.get('/api/predict', async (req, res) => {
  const h = Number(req.query.h ?? NaN), a = Number(req.query.a ?? NaN);
  // 스코어 기반 간이 승률 (실데이터 없을 때 균형값)
  let pw = 40, pd = 25, pl = 35;
  if (!isNaN(h) && !isNaN(a)) {
    const diff = h - a;
    pw = Math.max(8, Math.min(88, 45 + diff * 12));
    pl = Math.max(8, Math.min(88, 45 - diff * 12));
    pd = Math.max(4, 100 - pw - pl);
    const s = pw + pd + pl; pw = Math.round(pw / s * 100); pd = Math.round(pd / s * 100); pl = 100 - pw - pd;
  }
  res.json({ home: pw, draw: pd, away: pl, confidence: Math.min(92, 60 + Math.abs((h||0)-(a||0)) * 8) });
});


// 팀 최근 경기 (TheSportsDB · 팀명 검색 → 최근 5경기)
app.get('/api/team/recent', async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: 'name' });
    const s = await cachedJSON(`${TSDB}/searchteams.php?t=${encodeURIComponent(name)}`, 86400000).catch(() => ({ teams: [] }));
    // 종목 힌트가 오면 동명이인(여자팀·유소년 등) 구분: 이름 정확일치 + (가능하면)종목 일치 우선
    const wantSport = (req.query.sport || '').toLowerCase();
    const SP_MAP = { football: 'soccer', basketball: 'basketball', baseball: 'baseball', volleyball: 'volleyball', hockey: 'ice hockey' };
    const arr = (s.teams || []);
    const nl = String(name).toLowerCase().trim();
    let team = arr.find(t => String(t.strTeam || '').toLowerCase() === nl && (!wantSport || String(t.strSport || '').toLowerCase() === (SP_MAP[wantSport] || wantSport)))
      || arr.find(t => (!wantSport || String(t.strSport || '').toLowerCase() === (SP_MAP[wantSport] || wantSport)))
      || arr[0];
    if (!team) return res.json({ team: null, events: [], next: [] });
    const [last, next] = await Promise.all([
      cachedJSON(`${TSDB}/eventslast.php?id=${team.idTeam}`, 300000).catch(() => ({ results: [] })),
      cachedJSON(`${TSDB}/eventsnext.php?id=${team.idTeam}`, 600000).catch(() => ({ events: [] }))
    ]);
    const mapEv = e => ({ id: e.idEvent, date: e.dateEvent, time: e.strTime, home: e.strHomeTeam, away: e.strAwayTeam, hs: e.intHomeScore, as: e.intAwayScore, league: e.strLeague });
    const events = (last.results || []).slice(0, 8).map(mapEv);
    const nextEvents = (next.events || []).slice(0, 6).map(mapEv);
    res.json({
      team: { id: team.idTeam, name: team.strTeam, badge: team.strTeamBadge || team.strBadge || '',
        country: team.strCountry || '', league: team.strLeague || '', sport: team.strSport || '',
        stadium: team.strStadium || '', formed: team.intFormedYear || '', manager: team.strManager || '',
        desc: (team.strDescriptionEN || '').slice(0, 320) },
      events, next: nextEvents
    });
  } catch (e) {
    res.json({ team: null, events: [], next: [] });
  }
});

// 🏟️ 팀 상세(API-Sports team_id 기반) — 이름검색이 아닌 정확한 ID로 조회(동명·여자팀 혼입 방지)
//    TheSportsDB 무료키(3)가 searchteams에 403을 반환하므로, 순위표에서 넘어온 team_id를 사용.
app.get('/api/team/as', async (req, res) => {
  const sport = String(req.query.sport || 'football').toLowerCase();
  const id = req.query.id;
  if (!APISPORTS_KEY) return res.json({ team: null, events: [], next: [], note: 'needKey' });
  if (!id) return res.json({ team: null, events: [], next: [], note: 'noId' });
  try {
    if (sport === 'football') {
      const [tj, last, next] = await Promise.all([
        asRaw('football', `/teams?id=${encodeURIComponent(id)}`, 86400000).catch(() => null),
        asRaw('football', `/fixtures?team=${encodeURIComponent(id)}&last=8`, 300000).catch(() => null),
        asRaw('football', `/fixtures?team=${encodeURIComponent(id)}&next=6`, 600000).catch(() => null)
      ]);
      const t = tj && tj.response && tj.response[0];
      const team = t ? { id, name: t.team.name, badge: t.team.logo, country: t.team.country, formed: t.team.founded, stadium: t.venue && t.venue.name, city: t.venue && t.venue.city } : null;
      const mapF = f => ({ id: f.fixture.id, date: f.fixture.date, home: f.teams.home.name, away: f.teams.away.name, hs: f.goals.home, as: f.goals.away, league: f.league.name });
      return res.json({ team, events: ((last && last.response) || []).map(mapF), next: ((next && next.response) || []).map(mapF) });
    }
    if (sport === 'basketball') {
      const seasonTry = hoopSeason();
      const [tj, games] = await Promise.all([
        asRaw('basketball', `/teams?id=${encodeURIComponent(id)}`, 86400000).catch(() => null),
        asRaw('basketball', `/games?team=${encodeURIComponent(id)}&season=${encodeURIComponent(seasonTry)}`, 600000).catch(() => null)
      ]);
      const t = tj && tj.response && tj.response[0];
      const team = t ? { id, name: t.name, badge: t.logo, country: t.country && t.country.name } : null;
      const g = (games && games.response) || [];
      const mapB = x => ({ id: x.id, date: x.date, home: x.teams.home.name, away: x.teams.away.name, hs: x.scores && x.scores.home && x.scores.home.total, as: x.scores && x.scores.away && x.scores.away.total, league: x.league && x.league.name, done: (x.status && /finished|FT|AOT/i.test(x.status.short || x.status.long || '')) });
      const all = g.map(mapB);
      const events = all.filter(x => x.done).slice(-8).reverse();
      const next = all.filter(x => !x.done).slice(0, 6);
      return res.json({ team, events, next });
    }
    if (sport === 'baseball') {
      // R019: 야구 순위표 팀 클릭 → API-Sports 팀 ID 기반 상세(TheSportsDB 403 우회)
      const y = new Date().getFullYear();
      let tj = null, games = null;
      for (const sy of [y, y - 1]) {
        if (!tj) tj = await asRaw('baseball', `/teams?id=${encodeURIComponent(id)}`, 86400000).catch(() => null);
        const gj = await asRaw('baseball', `/games?team=${encodeURIComponent(id)}&season=${sy}`, 600000).catch(() => null);
        if (gj && gj.response && gj.response.length) { games = gj; break; }
        if (!games) games = gj;
      }
      const t = tj && tj.response && tj.response[0];
      const team = t ? { id, name: t.name, badge: t.logo, country: t.country && t.country.name } : null;
      const g = (games && games.response) || [];
      const mapBb = x => ({ id: x.id, date: x.date, home: x.teams && x.teams.home && x.teams.home.name, away: x.teams && x.teams.away && x.teams.away.name, hs: x.scores && x.scores.home && (x.scores.home.total != null ? x.scores.home.total : x.scores.home), as: x.scores && x.scores.away && (x.scores.away.total != null ? x.scores.away.total : x.scores.away), league: x.league && x.league.name, done: (x.status && /finished|FT|AOT|game finished/i.test((x.status.short || '') + ' ' + (x.status.long || ''))) });
      const all = g.map(mapBb);
      const events = all.filter(x => x.done).slice(-8).reverse();
      const next = all.filter(x => !x.done).slice(0, 6);
      return res.json({ team, events, next });
    }
    if (sport === 'volleyball') {
      // R019: 배구 순위표 팀 클릭 → API-Sports 팀 ID 기반 상세
      const y = new Date().getFullYear();
      let tj = null, games = null;
      for (const sy of [`${y}-${y + 1}`, String(y), `${y - 1}-${y}`, String(y - 1)]) {
        if (!tj) tj = await asRaw('volleyball', `/teams?id=${encodeURIComponent(id)}`, 86400000).catch(() => null);
        const gj = await asRaw('volleyball', `/games?team=${encodeURIComponent(id)}&season=${encodeURIComponent(sy)}`, 600000).catch(() => null);
        if (gj && gj.response && gj.response.length) { games = gj; break; }
        if (!games) games = gj;
      }
      const t = tj && tj.response && tj.response[0];
      const team = t ? { id, name: t.name, badge: t.logo, country: t.country && t.country.name } : null;
      const g = (games && games.response) || [];
      const mapV = x => ({ id: x.id, date: x.date, home: x.teams && x.teams.home && x.teams.home.name, away: x.teams && x.teams.away && x.teams.away.name, hs: x.scores && (x.scores.home != null ? (x.scores.home.total != null ? x.scores.home.total : x.scores.home) : null), as: x.scores && (x.scores.away != null ? (x.scores.away.total != null ? x.scores.away.total : x.scores.away) : null), league: x.league && x.league.name, done: (x.status && /finished|FT|game finished/i.test((x.status.short || '') + ' ' + (x.status.long || ''))) });
      const all = g.map(mapV);
      const events = all.filter(x => x.done).slice(-8).reverse();
      const next = all.filter(x => !x.done).slice(0, 6);
      return res.json({ team, events, next });
    }
    return res.json({ team: null, events: [], next: [], note: 'sport-todo' });
  } catch (e) { return res.json({ team: null, events: [], next: [], error: String(e.message || e) }); }
});

// 팀 선수단 (쿼터 보호: 24h 장기 캐시 — 탭을 열 때만 1회 호출, 전 지역 공유 캐시)
app.get('/api/team/squad', async (req, res) => {
  const sport = String(req.query.sport || 'football').toLowerCase();
  const id = req.query.id;
  if (!APISPORTS_KEY) return res.json({ players: [], note: 'needKey' });
  if (!id) return res.json({ players: [], note: 'noId' });
  try {
    if (sport === 'football') {
      const j = await asRaw('football', `/players/squads?team=${encodeURIComponent(id)}`, 86400000).catch(() => null);
      const sq = j && j.response && j.response[0];
      const players = ((sq && sq.players) || []).map(p => ({ id: p.id, name: p.name, number: p.number, pos: p.position, photo: p.photo || '', age: p.age }));
      return res.json({ players, note: players.length ? '' : 'empty' });
    }
    if (sport === 'basketball') {
      // R024: 새 시즌 로스터 미반영 시 직전 시즌으로 폴백(선수단 빈 화면 방지). API-Sports 농구는 선수 사진 미제공.
      const cur = hoopSeason();
      const py = +cur.slice(0, 4) - 1; const prev = py + '-' + (py + 1);
      let players = [];
      for (const season of [cur, prev]) {
        const j = await asRaw('basketball', `/players?team=${encodeURIComponent(id)}&season=${encodeURIComponent(season)}`, 86400000).catch(() => null);
        players = ((j && j.response) || []).map(p => ({ id: p.id, name: ((p.firstname || '') + ' ' + (p.lastname || '')).trim(), number: '', pos: (p.leagues && p.leagues.standard && p.leagues.standard.pos) || '', photo: '', age: p.age })).filter(p => p.name);
        if (players.length) break;
      }
      return res.json({ players, note: players.length ? '' : 'empty' });
    }
    return res.json({ players: [], note: 'sport-todo' });
  } catch (e) { return res.json({ players: [], error: String(e.message || e) }); }
});

// 팀 시즌 통계 (쿼터 보호: 6h 장기 캐시 — 탭을 열 때만 호출). 축구만 제공사 통계 지원.
app.get('/api/team/stats', async (req, res) => {
  const sport = String(req.query.sport || 'football').toLowerCase();
  const id = req.query.id, league = req.query.league, season = req.query.season;
  if (!APISPORTS_KEY) return res.json({ stats: null, note: 'needKey' });
  if (!id) return res.json({ stats: null, note: 'noId' });
  try {
    if (sport === 'football') {
      let lid = AF_RANK_ID[league] || (/^\d+$/.test(String(league || '')) ? league : null);
      if (!lid) return res.json({ stats: null, note: 'noLeague' });
      const m = String(season || '').match(/\d{4}/); const sy = m ? +m[0] : new Date().getFullYear();
      let j = null;
      for (const s of [sy, sy - 1]) {
        j = await asRaw('football', `/teams/statistics?team=${encodeURIComponent(id)}&league=${encodeURIComponent(lid)}&season=${s}`, 21600000).catch(() => null);
        if (j && j.response && j.response.fixtures && j.response.fixtures.played && j.response.fixtures.played.total != null) { j._sy = s; break; }
        j = null;
      }
      const r = j && j.response;
      if (!r) return res.json({ stats: null, note: 'empty' });
      const gi = o => (o && o.total && o.total.total != null) ? o.total.total : (o && o.total != null ? o.total : null);
      const stats = {
        season: j._sy,
        played: r.fixtures && r.fixtures.played && r.fixtures.played.total,
        wins: r.fixtures && r.fixtures.wins && r.fixtures.wins.total,
        draws: r.fixtures && r.fixtures.draws && r.fixtures.draws.total,
        loses: r.fixtures && r.fixtures.loses && r.fixtures.loses.total,
        gf: gi(r.goals && r.goals.for), ga: gi(r.goals && r.goals.against),
        form: r.form || '', cleanSheet: r.clean_sheet && r.clean_sheet.total,
        failedToScore: r.failed_to_score && r.failed_to_score.total
      };
      return res.json({ stats });
    }
    return res.json({ stats: null, note: 'sport-todo' });
  } catch (e) { return res.json({ stats: null, error: String(e.message || e) }); }
});

// 👤 선수 상세(명령서 ②-7·#8): API-Sports 선수 프로필 + 시즌 기록 (team_id 아닌 정확한 player_id 사용). 장기 캐시(쿼터 보호).
app.get('/api/player', async (req, res) => {
  const sport = String(req.query.sport || 'football').toLowerCase();
  const id = req.query.id;
  if (!APISPORTS_KEY) return res.json({ player: null, note: 'needKey' });
  if (!id) return res.json({ player: null, note: 'noId' });
  try {
    if (sport === 'football') {
      const m = String(req.query.season || '').match(/\d{4}/); const sy = m ? +m[0] : new Date().getFullYear();
      let j = null;
      for (const s of [sy, sy - 1]) {
        j = await asRaw('football', `/players?id=${encodeURIComponent(id)}&season=${s}`, 21600000).catch(() => null);
        if (j && j.response && j.response.length) { j._sy = s; break; }
        j = null;
      }
      const r = j && j.response && j.response[0];
      if (!r) return res.json({ player: null, note: 'empty' });
      const p = r.player || {};
      // 통계 항목이 여러 개(클럽·대표팀)면 출전수 많은 클럽 기록 우선(국가대표 'England' 등이 대표로 뜨는 문제 방지)
      const stats = (r.statistics || []).slice();
      stats.sort((a, b) => ((b.games && b.games.appearences) || 0) - ((a.games && a.games.appearences) || 0));
      const st = stats[0] || {};
      return res.json({
        player: {
          id: p.id, name: p.name, firstname: p.firstname, lastname: p.lastname, photo: p.photo,
          age: p.age, nationality: p.nationality, height: p.height, weight: p.weight,
          team: st.team && st.team.name, teamLogo: st.team && st.team.logo, league: st.league && st.league.name, season: j._sy,
          position: st.games && st.games.position,
          stats: {
            appearances: st.games && st.games.appearences, minutes: st.games && st.games.minutes,
            goals: st.goals && st.goals.total, assists: st.goals && st.goals.assists,
            yellow: st.cards && st.cards.yellow, red: st.cards && st.cards.red,
            rating: st.games && st.games.rating
          }
        }
      });
    }
    if (sport === 'basketball') {
      const season = hoopSeason();
      const j = await asRaw('basketball', `/players?id=${encodeURIComponent(id)}&season=${encodeURIComponent(season)}`, 21600000).catch(() => null);
      const r = j && j.response && j.response[0];
      if (!r) return res.json({ player: null, note: 'empty' });
      return res.json({ player: { id: r.id, name: ((r.firstname || '') + ' ' + (r.lastname || '')).trim(), age: r.age, nationality: r.country && r.country.name, height: r.height && (r.height.meters || r.height.feets), weight: r.weight && (r.weight.kilograms || r.weight.pounds), season, stats: null } });
    }
    return res.json({ player: null, note: 'sport-todo' });
  } catch (e) { return res.json({ player: null, error: String(e.message || e) }); }
});

// ============================================================
//  API-Sports (정식 다종목 실시간) · 프록시 + 캐싱
//  키: 환경변수 APISPORTS_KEY (헤더 x-apisports-key)
// ============================================================
// 방어적으로 읽기 (이름 변형·앞뒤 공백 대응)
const APISPORTS_KEY = (
  process.env.APISPORTS_KEY ||
  process.env.API_SPORTS_KEY ||
  process.env.APISPORT_KEY ||
  process.env.APIFOOTBALL_KEY ||
  ''
).trim();
const AS = {
  football: { host: 'v3.football.api-sports.io', ko: '축구', em: '⚽', path: '/fixtures' },
  baseball: { host: 'v1.baseball.api-sports.io', ko: '야구', em: '⚾', path: '/games' },
  basketball: { host: 'v1.basketball.api-sports.io', ko: '농구', em: '🏀', path: '/games' },
  volleyball: { host: 'v1.volleyball.api-sports.io', ko: '배구', em: '🏐', path: '/games' },
  hockey: { host: 'v1.hockey.api-sports.io', ko: '하키', em: '🏒', path: '/games' },
  handball: { host: 'v1.handball.api-sports.io', ko: '핸드볼', em: '🤾', path: '/games' },
  rugby: { host: 'v1.rugby.api-sports.io', ko: '럭비', em: '🏉', path: '/games' },
  mma: { host: 'v1.mma.api-sports.io', ko: '격투기', em: '🥊', path: '/fights' }
};

// 타임존 쿼리: API-Sports는 "Asia/Seoul"처럼 슬래시가 살아있어야 인식. encodeURIComponent는 슬래시를 %2F로 바꿔
// v1 종목(배구·농구·하키 등)이 '잘못된 타임존'으로 보고 0건 반환 → 슬래시만 원복(다른 특수문자는 안전하게 인코딩 유지)
function tzq(tz) { return encodeURIComponent(tz || 'Asia/Seoul').replace(/%2F/gi, '/'); }
// 옛 타임존 별칭 → 표준 IANA 이름으로 정규화. (일부 서버/ICU가 Asia/Saigon 같은 옛 이름을 잘못 처리해
//  날짜 필터가 깨지고 경기가 0건이 되는 문제 방어. 베트남 기기가 흔히 Asia/Saigon을 보냄)
const TZ_ALIAS = {
  'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Ulan_Bator': 'Asia/Ulaanbaatar', 'Asia/Chongqing': 'Asia/Shanghai',
  'Asia/Harbin': 'Asia/Shanghai', 'Europe/Kiev': 'Europe/Kyiv', 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires'
};
function canonTz(tz) {
  tz = String(tz || '').trim() || 'Asia/Seoul';
  if (TZ_ALIAS[tz]) tz = TZ_ALIAS[tz];
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); return tz; }
  catch { return 'Asia/Seoul'; }   // 인식 못 하는 타임존은 안전하게 서울로
}
let _asCalls = 0, _asUsage = null, _bootAt = Date.now();   // 📊 API-Sports 호출량 추적
let _asFailStreak = 0;   // 🔴 API-Sports 연속 실패(네트워크/429/5xx/한도초과) 카운트 — 성공 시 0으로 리셋
async function asRaw(sport, path, ttl = 30000) {
  const cfg = AS[sport]; if (!cfg) throw new Error('bad sport');
  const url = `https://${cfg.host}${path}`;
  const hit = cache.get(url), now = Date.now();
  if (hit && now - hit.t < ttl) return hit.v;
  _asCalls++; METRICS.supplier.asCall++;   // 📊 실제 API-Sports 호출 1건 (캐시 miss)
  let r;
  // 🚑 API-Sports 요청 타임아웃(장애 복구): 응답이 7s 내 없으면 abort → 느린 공급사로 요청이 무한 대기하지 않게.
  const _ctrl = new AbortController();
  const _timer = setTimeout(() => { try { _ctrl.abort(); } catch (_) {} }, 7000);
  try {
    r = await fetch(url, { headers: { 'x-apisports-key': APISPORTS_KEY }, signal: _ctrl.signal });
  } catch (netErr) {   // 네트워크 자체 실패(연결 끊김) 또는 타임아웃(abort)
    _asFailStreak++; METRICS.supplier.asFail++;
    if (_asFailStreak >= 5) opAlert('apisports-down', `API-Sports 연속 실패 ${_asFailStreak}회(연결 불가/지연): ${String((netErr && netErr.message) || netErr).slice(0, 80)}`, 600000);
    if (hit) { hit.t = now; return hit.v; }
    throw netErr;
  } finally { clearTimeout(_timer); }
  try {   // 응답 헤더에서 하루 한도/남은 횟수 캡처
    const lim = r.headers.get('x-ratelimit-requests-limit'), rem = r.headers.get('x-ratelimit-requests-remaining');
    if (lim != null || rem != null) {
      _asUsage = { limit: lim != null ? Number(lim) : null, remaining: rem != null ? Number(rem) : null, used: (lim != null && rem != null) ? (Number(lim) - Number(rem)) : null, at: new Date().toISOString() };
      // 🔴 하루 한도의 5% 이하만 남으면 경보 (곧 데이터 멈춤 위험) — 30분 쿨다운
      if (_asUsage.limit && _asUsage.remaining != null && _asUsage.remaining <= Math.max(1, _asUsage.limit * 0.05)) {
        opAlert('apisports-quota', `API-Sports 하루 한도 임박 — ${_asUsage.remaining}/${_asUsage.limit}건만 남음(5% 이하). 곧 스코어 갱신이 멈출 수 있습니다.`, 1800000);
      }
    }
  } catch {}
  if (!r.ok) {
    _asFailStreak++; METRICS.supplier.asFail++; if (r.status === 429) METRICS.supplier.as429++;
    if (_asFailStreak >= 5) opAlert('apisports-fail', `API-Sports 오류 연속 ${_asFailStreak}회 (HTTP ${r.status}). 쿼터 소진 또는 서버 장애 가능성.`, 600000);
    if (hit) { hit.t = now; return hit.v; }   // ⚡ 429/5xx: 이전 정상 데이터 유지 + 백오프(빈 화면·예상라인업 방지)
    throw new Error('upstream ' + r.status);
  }
  const v = await r.json();
  // ⚠️ 에러/한도초과 응답(errors 존재 + 결과 0)은 캐시하지 않음 → 한도 회복/복구 즉시 반영
  const errObj = v && v.errors;
  const hasErr = errObj && (Array.isArray(errObj) ? errObj.length > 0 : Object.keys(errObj).length > 0);
  if (hasErr && (v.results === 0 || v.results == null)) {
    _asFailStreak++;
    const emsg = Array.isArray(errObj) ? errObj.join('; ') : Object.values(errObj).join('; ');
    if (/limit|quota|subscription|plan|exceed/i.test(emsg)) opAlert('apisports-quota', `API-Sports 한도 초과 응답: ${String(emsg).slice(0, 110)}`, 1800000);   // 한도 메시지면 즉시 경보
    else if (_asFailStreak >= 5) opAlert('apisports-fail', `API-Sports 오류 연속 ${_asFailStreak}회: ${String(emsg).slice(0, 90)}`, 600000);
    if (hit) return hit.v;   // 이전 정상 캐시가 있으면 그걸 유지(빈 화면 방지)
    return v;                 // 없으면 그대로 반환(캐시는 안 함)
  }
  _asFailStreak = 0;   // ✅ 정상 응답 → 연속 실패 리셋
  cache.set(url, { t: now, v });
  return v;
}
function asState(short, score) {
  const s = String(short || '').toUpperCase();
  if (['NS', 'TBD', 'PST', 'CANC', 'ABD', 'SUSP', 'AWD', 'WO'].includes(s)) return 'scheduled';
  if (['FT', 'AET', 'PEN', 'AOT', 'AH', 'END', 'FINISHED', 'AP', 'POST'].includes(s)) return 'finished';
  if (s === '' ) return score == null ? 'scheduled' : 'live';
  return 'live';
}
function normAS(sport, g) {
  try {
    if (sport === 'football') {
      const f = g.fixture, l = g.league, t = g.teams, go = g.goals;
      return {
        id: f.id, league: l.name, leagueId: l.id, leagueLogo: l.logo, country: l.country, round: l.round,
        home: t.home.name, homeLogo: t.home.logo, away: t.away.name, awayLogo: t.away.logo,
        homeId: t.home.id, awayId: t.away.id,
        hs: go.home, as: go.away, status: f.status.short, statusLong: f.status.long, elapsed: f.status.elapsed,
        date: (f.timestamp ? new Date(f.timestamp * 1000).toISOString() : f.date), state: asState(f.status.short, go.home)
      };
    }
    const l = g.league, t = g.teams, s = g.scores || {};
    const hs = s.home && typeof s.home === 'object' ? (s.home.total ?? s.home.points ?? null) : (s.home ?? null);
    const as = s.away && typeof s.away === 'object' ? (s.away.total ?? s.away.points ?? null) : (s.away ?? null);
    const short = (g.status && g.status.short) || '';
    const long = (g.status && g.status.long) || '';
    // 현재 세트/피리어드 실시간 점수 (배구 등): periods에서 마지막 진행 세트 추출
    let livePts = null, setScores = null;
    const pr = g.periods;
    if (pr && typeof pr === 'object') {
      const order = ['fifth', 'fourth', 'third', 'second', 'first'];
      for (const k of order) {
        const p = pr[k];
        if (p && typeof p === 'object' && (p.home != null || p.away != null)) { livePts = { home: p.home, away: p.away }; break; }
      }
      // 세트/쿼터별 점수 전체 (배구=세트, 농구=쿼터)
      const seq = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'overtime', 'extratime'];
      const arr = [];
      seq.forEach(k => { const p = pr[k]; if (p && typeof p === 'object' && (p.home != null || p.away != null)) arr.push({ home: p.home, away: p.away }); });
      if (arr.length) setScores = arr;
    }
    // 야구: 라인스코어(이닝별 득점)·안타(H)·실책(E) + 초/말 추론
    let box = null, curInning = null, inningHalf = null;
    if (sport === 'baseball') {
      const hi = (s.home && s.home.innings) || {}, ai = (s.away && s.away.innings) || {};
      const filled = (o, n) => o[n] != null && o[n] !== '';
      // ✅ 현재 이닝은 status에서 (예: "IN4" / "Inning 4"). innings 칸은 1~9가 미리 null로 차 있어 최댓값으로 계산하면 항상 9가 됨.
      const statusNum = parseInt(String(short).replace(/\D/g, ''), 10) || parseInt(String(long).replace(/\D/g, ''), 10) || 0;
      // 백업: 실제 득점이 기록된 마지막 이닝
      let lastPlayed = 0;
      for (let n = 1; n <= 15; n++) { if (filled(hi, n) || filled(ai, n)) lastPlayed = n; }
      curInning = statusNum || lastPlayed || null;
      // ⚠️ API-Sports 야구는 status에 초/말 정보가 없음("Inning 4"만). 점수 칸으로 추측하면 자주 틀림(4회말을 4회초로).
      //    → 초/말은 표시하지 않고 회차만 표시(틀린 정보 방지). MLB(StatsAPI)·KBO/NPB/CPBL(TheSports)은 실제 초/말로 나중에 덮어씀.
      inningHalf = null;
      box = {
        home: { r: (s.home && s.home.total != null ? s.home.total : hs), h: (s.home && s.home.hits != null ? s.home.hits : null), e: (s.home && s.home.errors != null ? s.home.errors : null), innings: hi },
        away: { r: (s.away && s.away.total != null ? s.away.total : as), h: (s.away && s.away.hits != null ? s.away.hits : null), e: (s.away && s.away.errors != null ? s.away.errors : null), innings: ai }
      };
    }
    return {
      id: g.id, league: l ? l.name : '', leagueId: l ? l.id : null, leagueLogo: l ? l.logo : '', country: l ? (l.country ? (l.country.name || l.country) : '') : '',
      home: t.home.name, homeLogo: t.home.logo, away: t.away.name, awayLogo: t.away.logo,
      hs, as, status: short || long, statusLong: long,
      period: g.period || g.inning || curInning || null, timer: g.timer || (g.status && g.status.timer) || null,
      livePts, setScores, box, curInning, inningHalf,
      // ⏱️ 절대시각(UTC)로 저장 — 유닉스 timestamp 우선(타임존 문자열은 애매해서 최후순위). 표시/그룹은 기기 타임존으로 변환
      date: (g.timestamp ? new Date(g.timestamp * 1000).toISOString() : (g.date || g.time || null)),
      state: asState(short || long, hs)
    };
  } catch { return null; }
}

// 진단: 팀명으로 특정 경기의 원시 API 응답(teams/scores) 확인 — 점수 뒤집힘이 API 데이터인지 우리 매핑인지 판별용
app.get('/api/asports/rawfind', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true });
  const sport = req.query.sport || 'baseball';
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const q = String(req.query.q || '').toLowerCase();
  const cfg = AS[sport]; if (!cfg) return res.status(400).json({ error: 'bad sport' });
  try {
    const j = await asRaw(sport, `${cfg.path}?date=${date}&timezone=Asia/Seoul`, 10000);
    const arr = j.response || [];
    const hits = arr.filter(g => { const h = ((g.teams && g.teams.home && g.teams.home.name) || '').toLowerCase(); const a = ((g.teams && g.teams.away && g.teams.away.name) || '').toLowerCase(); return q && (h.includes(q) || a.includes(q)); });
    res.json({ total: arr.length, matched: hits.length, games: hits.slice(0, 4).map(g => ({ home: g.teams.home.name, away: g.teams.away.name, status: g.status, scores: g.scores })) });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});
// 진단: 라이브 경기의 원시 응답 구조 확인 (초/말·히트·실책·타석 데이터 유무 파악)
app.get('/api/asports/raw', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true });
  const sport = req.query.sport || 'baseball';
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const cfg = AS[sport]; if (!cfg) return res.status(400).json({ error: 'bad sport' });
  try {
    const j = await asRaw(sport, `${cfg.path}?date=${date}&timezone=Asia/Seoul`, 20000);
    // 진행 중(라이브) 경기 우선 1개만 원시 그대로
    const arr = j.response || [];
    const live = arr.find(g => { const s = ((g.status && (g.status.short || g.status.long)) || '').toUpperCase(); return !/(NS|FT|POST|CANC|TBD)/.test(s); }) || arr[0];
    res.json({ sample: live || null });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});
// 진단: 서버가 받은 환경변수 "이름"만 표시 (값은 노출 안 함)
app.get('/api/asports/debug', (req, res) => {
  const names = Object.keys(process.env).filter(k => /(API|SPORT|KEY|FOOTBALL)/i.test(k));
  res.json({
    matchingEnvNames: names,
    apisportsKeyDetected: !!APISPORTS_KEY,
    apisportsKeyLen: APISPORTS_KEY.length
  });
});
// 키/쿼터 상태 확인 (배포 후 검증용)
// 📊 호출량 조회 — API-Sports 하루 한도/남은횟수(헤더 기준) + 서버 기동 후 우리가 보낸 호출 수
app.get('/api/asports/usage', (req, res) => {
  const upMs = Date.now() - _bootAt, upMin = Math.round(upMs / 60000);
  res.json({
    apiSports하루한도: _asUsage ? _asUsage.limit : null,
    오늘사용: _asUsage ? _asUsage.used : null,
    오늘남음: _asUsage ? _asUsage.remaining : null,
    헤더확인시각: _asUsage ? _asUsage.at : null,
    서버기동후우리호출수: _asCalls,
    서버가동시간분: upMin,
    분당평균호출: upMin > 0 ? (_asCalls / upMin).toFixed(1) : _asCalls,
    note: 'apiSports하루한도/사용/남음 = API-Sports 응답헤더 기준(축구·야구). 농구는 Goalserve(별도). 전체 공식 집계는 dashboard.api-football.com 참고.'
  });
});
app.get('/api/asports/status', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ key: false, msg: 'APISPORTS_KEY 미설정' });
  try {
    const j = await asRaw('football', '/status', 10000);
    const cov = {};
    for (const [nm, id] of [['K League 1', 292], ['K League 2', 293], ['J1 League', 98]]) {
      try {
        const lj = await asRaw('football', `/leagues?id=${id}`, 60000);
        const r = (lj.response || [])[0], s = r && (r.seasons || []).slice(-1)[0], c = s && s.coverage && s.coverage.fixtures;
        cov[nm] = s ? { season: s.year, lineups: !!(c && c.lineups), stats_fixtures: !!(c && c.statistics_fixtures), events: !!(c && c.events) } : { note: 'no season' };
      } catch (e) { cov[nm] = { error: String(e.message || e) }; }
    }
    res.json({ key: true, status: j.response || j, coverage: cov });
  }
  catch (e) { res.status(502).json({ key: true, error: String(e.message || e) }); }
});
// 종목 목록
app.get('/api/asports/sports', (req, res) => {
  res.json({ hasKey: !!APISPORTS_KEY, sports: Object.entries(AS).map(([k, v]) => ({ key: k, ko: v.ko, em: v.em })) });
});
// 진단: 특정 종목/날짜의 리그명 목록 + 배당 매핑 여부 (축구 매핑 보완용)
app.get('/api/asports/leagues', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true });
  const sport = req.query.sport || 'football';
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const cfg = AS[sport]; if (!cfg) return res.status(400).json({ error: 'bad sport' });
  try {
    const j = await asRaw(sport, `${cfg.path}?date=${date}&timezone=Asia/Seoul`, 60000);
    const counts = {};
    (j.response || []).map(g => normAS(sport, g)).filter(Boolean).forEach(g => { counts[g.league] = (counts[g.league] || 0) + 1; });
    const leagues = Object.entries(counts).map(([name, n]) => ({ name, games: n, mapped: false })).sort((a, b) => b.games - a.games);
    res.json({ sport, date, leagues });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

// ============================================================
//  🏀 Goalserve 농구 라이브 시계 테스트 엔드포인트
//  배포 후 브라우저로 /api/gs/bsktest 열면 쿼터/시계 수신 여부 확인
//  키는 환경변수 GOALSERVE_KEY 우선, 없으면 테스트키 폴백
// ============================================================
app.get('/api/gs/bsktest', async (req, res) => {
  const KEY = (process.env.GOALSERVE_KEY || '063b89c0de9d4078431908df2595d029').trim();
  const base = `https://www.goalserve.com/getfeed/${KEY}/bsktbl`;
  const A = (o, k) => { if (!o) return undefined; if (o['@' + k] !== undefined) return o['@' + k]; if (o[k] !== undefined && typeof o[k] !== 'object') return o[k]; return undefined; };
  const arr = x => Array.isArray(x) ? x : (x ? [x] : []);
  try {
    // 1) 연결 체크 — leagues 피드(항상 데이터 있음)
    let lgCount = 0, lgErr = null;
    try { const lj = await cachedJSON(`${base}/leagues?json=1`, 60000); lgCount = arr(lj?.scores?.category || lj?.leagues?.league || lj?.scores?.league).length; } catch (e) { lgErr = String(e.message || e); }
    // 2) 라이브 스코어 피드
    const j = await cachedJSON(`${base}/home?json=1`, 8000);
    const cats = arr(j?.scores?.category);
    let total = 0; const statusCounts = {}; const live = []; const timerSamples = new Set();
    for (const c of cats) {
      const league = A(c, 'name');
      for (const m of arr(c.match)) {
        total++;
        const st = A(m, 'status') || '';
        statusCounts[st] = (statusCounts[st] || 0) + 1;
        const tm = A(m, 'timer'); if (tm) timerSamples.add(tm);
        const lt = m.localteam, at = m.visitorteam || m.awayteam;
        if (/quarter|overtime|half ?time|break/i.test(st)) {
          live.push({
            league, home: A(lt, 'name'), away: A(at, 'name'),
            score: `${A(lt, 'totalscore') || 0}:${A(at, 'totalscore') || 0}`,
            status: st, timer: tm || '(없음)',
            quarters: `${A(lt, 'q1') || '-'}/${A(lt, 'q2') || '-'}/${A(lt, 'q3') || '-'}/${A(lt, 'q4') || '-'}  vs  ${A(at, 'q1') || '-'}/${A(at, 'q2') || '-'}/${A(at, 'q3') || '-'}/${A(at, 'q4') || '-'}`
          });
        }
      }
    }
    res.json({
      ok: true,
      keyUsed: KEY.slice(0, 6) + '…',
      연결상태: (lgCount > 0 || total > 0) ? '✅ 피드 정상 (IP 통과됨)' : '❌ 빈 응답 → IP 잠금 가능성, Goalserve에 142.93.195.157 화이트리스트 요청',
      리그수: lgCount, 리그에러: lgErr,
      오늘경기수: total,
      현재라이브: live.length,
      상태별카운트: statusCounts,
      시계값샘플: [...timerSamples].slice(0, 20),
      라이브경기: live.slice(0, 30),
      설명: 'status=쿼터(1st/2nd/3rd/4th Quarter 등), timer=라이브 시계(분). 라이브 경기가 있을 때만 값이 참. 한국 오전엔 경기 적음(유럽/미국 저녁~새벽 권장).'
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e), hint: '빈 응답/에러면 IP 잠금 가능성 → Goalserve에 142.93.195.157(또는 Render 아웃바운드 IP) 화이트리스트 요청' });
  }
});

// 🏀 팀 로고 응답 형태 확인용 진단 (ids 미지정 시 오늘 라이브 경기 팀 ID 자동 사용)
app.get('/api/gs/logotest', async (req, res) => {
  try {
    let ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) {
      const date = ymdInTz(new Date(), 'Asia/Seoul');
      const games = await gsBasketballGames(date, 'Asia/Seoul').catch(() => []);
      ids = [...new Set(games.flatMap(g => [g.homeTid, g.awayTid]).filter(Boolean).map(String))].slice(0, 6);
    }
    const url = `http://data2.goalserve.com:8084/api/v1/logotips/basketball/teams?k=${GOALSERVE_KEY}&ids=${ids.join(',')}`;
    let parsed = null, err = null, shape = null;
    try { const raw = await cachedJSON(url, 30000); parsed = gsParseLogos(raw); shape = Array.isArray(raw) ? ('array[' + raw.length + '] keys=' + Object.keys(raw[0] || {}).join(',')) : typeof raw; } catch (e) { err = String(e.message || e); }
    const summary = {}; if (parsed) for (const [id, v] of Object.entries(parsed)) summary[id] = v.b64 ? ('base64(' + v.b64.length + ')') : (v.url || '?');
    res.json({ idsTested: ids, resolved: parsed ? Object.keys(parsed).length : 0, logos: summary, imageUrls: ids.map(id => '/api/gs/logo/' + id), responseShape: shape, error: err });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

// 🏀 초 단위 시계 탐색 진단 — 여러 농구 피드에서 분:초/clock 필드가 오는 엔드포인트 찾기
app.get('/api/gs/secprobe', async (req, res) => {
  const K = GOALSERVE_KEY, B = `https://www.goalserve.com/getfeed/${K}/bsktbl`;
  const cands = [
    { name: 'inplay', url: `${B}/inplay?json=1` },
    { name: 'home_stats', url: `${B}/home_stats?json=1` },
    { name: 'nba-playbyplay', url: `${B}/nba-playbyplay?json=1` },
    { name: 'home_p2p', url: `${B}/home_p2p?json=1` }
  ];
  const out = [];
  for (const c of cands) {
    try {
      const txt = JSON.stringify(await cachedJSON(c.url, 8000));
      const hasSeconds = /"seconds?"\s*:/i.test(txt) || /"clock"\s*:/i.test(txt) || /"time_?remaining"\s*:/i.test(txt);
      const mmss = (txt.match(/"\d{1,2}:\d{2}"/g) || []).slice(0, 5);   // "7:32" 형태 샘플
      const keys = [...new Set((txt.match(/"[a-z_]+"\s*:/gi) || []).map(s => s.replace(/["\s:]/g, '')))].filter(k => /sec|clock|time|minute|period|quarter|status|timer/i.test(k)).slice(0, 25);
      out.push({ feed: c.name, bytes: txt.length, hasSecondsField: hasSeconds, mmssSamples: mmss, timeKeys: keys });
    } catch (e) { out.push({ feed: c.name, error: String(e.message || e) }); }
  }
  res.json({ note: 'hasSecondsField=true 이거나 mmssSamples에 "7:32" 같은 값이 보이는 피드가 초 단위 제공', results: out });
});

// 🏀 농구 선발/출전 라인업 — Goalserve home_stats(라이브 선수 스탯) 기반. 출전시간 상위 5명을 선발로 추정.
const _bskLineupCache = new Map();
app.get('/api/gs/bsklineup', async (req, res) => {
  const ev = String(req.query.ev || '').replace(/^gs/i, '').replace(/[^0-9]/g, '');
  if (!ev) return res.status(400).json({ error: 'need ev' });
  const toSec = m => { const t = String(m || '').split(':'); if (t.length >= 2) return (+t[0] || 0) * 60 + (+t[1] || 0); return (+t[0] || 0) * 60; };
  const parseTeam = node => {
    const players = GSARR(node && node.player).map(p => ({
      name: GSA(p, 'name'), min: GSA(p, 'minutes') || '',
      pts: numOrNull(GSA(p, 'points')), reb: numOrNull(GSA(p, 'total_rebounds')),
      ast: numOrNull(GSA(p, 'assists')), fg: GSA(p, 'field_goals_made'), fga: GSA(p, 'field_goals_attempts'),
      tp: GSA(p, 'threepoint_goals_made')
    })).filter(p => p.name);
    players.sort((a, b) => toSec(b.min) - toSec(a.min));
    players.forEach((p, i) => p.starter = i < 5);
    return players;
  };
  try {
    const data = await cachedJSON(`https://www.goalserve.com/getfeed/${GOALSERVE_KEY}/bsktbl/home_stats?json=1`, 30000);
    const cats = GSARR(data && data.scores && data.scores.category);
    let match = null;
    for (const c of cats) { for (const m of GSARR(c.match)) { if (String(GSA(m, 'id')) === ev) { match = m; break; } } if (match) break; }
    if (!match) return res.json({ ev, found: false, note: '라이브 스탯 피드에 없음(라이브 아님/미지원 리그)' });
    const lt = match.localteam, at = match.visitorteam || match.awayteam;
    const samplePlayer = GSARR(lt && lt.player)[0] || GSARR(at && at.player)[0] || null;
    res.json({
      ev, found: true, status: GSA(match, 'status'),
      home: { name: GSA(lt, 'name'), players: parseTeam(lt) },
      away: { name: GSA(at, 'name'), players: parseTeam(at) },
      _debug: { localteamKeys: lt ? Object.keys(lt) : null, samplePlayerKeys: samplePlayer ? Object.keys(samplePlayer) : null }
    });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

// 🏀 팀 로고 이미지 서빙 (base64 → PNG, 브라우저/CDN 캐시). 카드엔 이 URL만 들어가 폴링이 가벼움.
app.get('/api/gs/logo/:id', async (req, res) => {
  const id = String(req.params.id || '').replace(/[^0-9]/g, '');
  if (!id) return res.status(400).end();
  try {
    let h = _gsLogoCache.get(id);
    if (!(h && h.exp > Date.now() && (h.b64 || h.url))) { await gsTeamLogos([id]).catch(() => {}); h = _gsLogoCache.get(id); }
    if (h && h.b64) { res.set('Content-Type', 'image/png'); res.set('Cache-Control', 'public, max-age=86400'); return res.end(Buffer.from(h.b64, 'base64')); }
    if (h && h.url) { res.set('Cache-Control', 'public, max-age=86400'); return res.redirect(h.url); }
    return res.status(404).end();
  } catch { return res.status(502).end(); }
});

const _nrm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');


// ============================================================
//  ⚡ TheSports API (유료) — 축구 실시간·라인업 (테스트 단계)
//  · 인증: user + secret (쿼리) + 화이트리스트 IP (Render 아웃바운드 IP 등록 필수)
//  · 키는 환경변수 우선(THESPORTS_USER/SECRET), 없으면 테스트 키 폴백
// ============================================================
const TS_BASE = 'https://api.thesports.com/v1';
const TS_USER = (process.env.THESPORTS_USER || 'theockyplos').trim();
const TS_SECRET = (process.env.THESPORTS_SECRET || '192924ef77e94e40b7c59cc43d585647').trim();
// 고정 IP VPS 프록시(중계기) 경유용 — 설정 시 모든 TheSports 호출이 VPS를 거쳐 나감(화이트리스트된 고정 IP)
const TS_PROXY = (process.env.THESPORTS_PROXY || '').trim().replace(/\/$/, '');   // 예: http://1.2.3.4:8080
const TS_RELAY_TOKEN = (process.env.THESPORTS_RELAY_TOKEN || '').trim();
const TS_ON = !!(TS_USER && TS_SECRET);
// 🏷️ 공급사 리그 원본명 → 사용자 표시명(원본은 leagueOrig로 보존). 명령서 #4-2·#6.
function tsLeagueDisplay(sport, name) {
  const n = String(name || '');
  if (sport === 'basketball') {
    if (/^National Basketball Association G League$/i.test(n)) return 'NBA G리그';
    if (/^National Basketball Association$/i.test(n)) return 'NBA';
  }
  if (sport === 'volleyball') {
    if (/^Volleyball League Women$/i.test(n)) return 'V리그 여자부';   // 한국 KOVO 여자부(IBK·GS칼텍스 등으로 확인)
    if (/^Volleyball League$/i.test(n)) return 'V리그 남자부';          // 한국 KOVO 남자부(원본명 기준 — 실경기 재확인)
  }
  return n;
}
async function tsFetch(path, params, ttl = 6000, reqTimeout) {
  if (TS_PROXY) {
    // 릴레이가 user/secret 를 붙여 TheSports로 전달 → 요청 IP = VPS 고정 IP
    // 릴레이 base는 api.thesports.com(버전 없음)이므로 /v1 을 여기서 붙임
    const qs = new URLSearchParams(Object.assign({ token: TS_RELAY_TOKEN }, params || {})).toString();
    return cachedJSON(`${TS_PROXY}/ts/v1${path}?${qs}`, ttl, reqTimeout);
  }
  const qs = new URLSearchParams(Object.assign({ user: TS_USER, secret: TS_SECRET }, params || {})).toString();
  return cachedJSON(`${TS_BASE}${path}?${qs}`, ttl, reqTimeout);
}

// ====== 🎥 TheSports Live Match Tracker 위젯 ======
// 대시보드에서 생성한 Online URL(profile 포함)을 종목별로 보관. 비어있으면 '설정 전'으로 정직 처리.
// 환경변수 TRACKER_FOOTBALL/BASKETBALL/VOLLEYBALL/BASEBALL 로도 주입 가능.
// 대시보드 생성 Online URL(종목별 profile). {language}·{버전/version}·{match_uuid} 치환. 야구는 버전 세그먼트 없음.
let TRACKER_URLS = {
  football: process.env.TRACKER_FOOTBALL || 'https://widgets.thesports01.com/{language}/{version}/football?profile=3nhwvkzvj0adhkkoly8x&uuid={match_uuid}',
  basketball: process.env.TRACKER_BASKETBALL || 'https://widgets.thesports01.com/{language}/{version}/basketball?profile=jztx9nz9w6tphkkldw3d&uuid={match_uuid}',
  volleyball: process.env.TRACKER_VOLLEYBALL || 'https://widgets.thesports01.com/{language}/{version}/volleyball?profile=kdhek83k67a6hnn0jej8&uuid={match_uuid}',
  baseball: process.env.TRACKER_BASEBALL || 'https://widgets.thesports01.com/{language}/baseball?profile=j7sx9nz9w6tphkkldg24&uuid={match_uuid}'
};
const TRACKER_LANGS = { en: 1, ko: 1, ja: 1, zh: 1, es: 1, ru: 1, de: 1, fr: 1, it: 1, th: 1, vi: 1 };  // 위젯 지원 추정 언어(미지원은 en)
function trackerTemplate(sport) {
  if (TRACKER_URLS[sport]) return TRACKER_URLS[sport];
  // 한 종목만 입력된 경우 경로의 /view/{sport} 만 바꿔 파생(프로필 공유 가정)
  const base = TRACKER_URLS.football || TRACKER_URLS.basketball || TRACKER_URLS.volleyball || TRACKER_URLS.baseball;
  if (base && /\/view\/[a-z]+/i.test(base)) return base.replace(/(\/view\/)[a-z]+/i, '$1' + sport);
  return '';
}
function buildTrackerUrl(tmpl, uuid, lang, version) {
  if (!tmpl || !uuid) return '';
  let url = tmpl;
  if (/^\/\//.test(url)) url = 'https:' + url;                 // 프로토콜 상대 → https
  url = url.replace(/\{\s*language\s*\}/ig, TRACKER_LANGS[lang] ? lang : 'en');
  url = url.replace(/\{\s*(버전|버젼|version|ver)\s*\}/ig, version || '3d');
  if (/\{\s*(match_uuid|match_id|uuid)\s*\}/i.test(url)) url = url.replace(/\{\s*(match_uuid|match_id|uuid)\s*\}/ig, encodeURIComponent(uuid));
  else if (/([?&]uuid=)[^&]*/i.test(url)) url = url.replace(/([?&]uuid=)[^&]*/i, '$1' + encodeURIComponent(uuid));
  else url += (url.indexOf('?') >= 0 ? '&' : '?') + 'uuid=' + encodeURIComponent(uuid);
  return url;
}
// 야구(API-Sports 숫자 id)는 TheSports match_id가 없으므로 diary에서 팀명·날짜로 best-effort 해석
function _nrmTeam(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, ''); }
async function resolveBaseballTsid(home, away, date) {
  if (!TS_ON) return '';
  const ymd = String(date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  try {
    const d = await tsFetch('/baseball/match/diary', { date: ymd }, 300000).catch(() => null);
    const ex = (d && d.results_extra) || {};
    const teams = (ex.team) || {};
    const idByName = {};
    Object.keys(teams).forEach(tid => { const nm = _nrmTeam(teams[tid] && (teams[tid].name || teams[tid])); if (nm) idByName[nm] = tid; });
    const h = _nrmTeam(home), a = _nrmTeam(away);
    const findId = n => { if (idByName[n]) return idByName[n]; const k = Object.keys(idByName).find(x => x.indexOf(n) >= 0 || n.indexOf(x) >= 0); return k ? idByName[k] : null; };
    const hid = findId(h), aid = findId(a);
    const arr = (d && d.results) || [];
    const m = arr.find(x => (x.home_team_id === hid && x.away_team_id === aid) || (x.home_team_id === aid && x.away_team_id === hid));
    return m ? String(m.id) : '';
  } catch (e) { return ''; }
}
app.get('/api/tracker', async (req, res) => {
  const sport = String(req.query.sport || 'football').toLowerCase();
  const tmpl = trackerTemplate(sport);
  if (!tmpl) return res.json({ url: '', note: 'not-configured' });
  let uuid = String(req.query.uuid || '');
  if (!uuid && sport === 'baseball') uuid = await resolveBaseballTsid(req.query.home, req.query.away, req.query.date);
  if (!uuid) return res.json({ url: '', note: 'no-id' });
  const lang = String(req.query.lang || 'en').toLowerCase();
  const version = String(req.query.version || '3d').toLowerCase();   // 야구 템플릿엔 버전 세그먼트 없음(치환 무시됨)
  res.json({ url: buildTrackerUrl(tmpl, uuid, lang, version), sport, uuid });
});
// 관리자: 트래커 URL 설정(비밀번호). 72시간마다 갱신한 URL을 붙여넣으면 즉시 적용·DB 영속(재배포 불필요).
app.post('/api/admin/tracker', express.json(), async (req, res) => {
  if (!adminOK(req)) return res.status(403).json({ error: 'auth' });
  const u = (req.body && req.body.urls) || {};
  ['football', 'basketball', 'volleyball', 'baseball'].forEach(s => { if (typeof u[s] === 'string') TRACKER_URLS[s] = u[s].trim(); });
  // DB 영속 저장(서버 재시작 후에도 유지). Mongo 없으면 메모리만.
  try { if (configCol) await configCol.updateOne({ _id: 'main' }, { $set: { tracker: { football: TRACKER_URLS.football, basketball: TRACKER_URLS.basketball, volleyball: TRACKER_URLS.volleyball, baseball: TRACKER_URLS.baseball }, trackerUpdatedAt: Date.now() } }, { upsert: true }); } catch (e) { console.error('[tracker save]', e.message); }
  res.json({ ok: true, configured: Object.keys(TRACKER_URLS).filter(k => TRACKER_URLS[k]) });
});
app.get('/api/admin/tracker', (req, res) => {
  // 관리자 페이지 프리필용. 현재 저장된 URL 그대로 반환(비밀 아님 — 위젯 iframe src로 공개됨).
  const auth = ADMIN_KEY && String(req.query.key || '') === ADMIN_KEY;
  res.json({ configured: Object.keys(TRACKER_URLS).filter(k => TRACKER_URLS[k]), sports: ['football', 'basketball', 'volleyball', 'baseball'], urls: auth ? TRACKER_URLS : undefined });
});
// 🏐 진단: TheSports 배구 커버리지 확인 (현재 플랜에 배구 스케줄/라이브가 포함되는지)
app.get('/api/ts/volley', async (req, res) => {
  if (!TS_ON) return res.json({ on: false, msg: 'TheSports 키 미설정' });
  const ymd = String(req.query.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  try {
    const d = await tsFetch('/volleyball/match/diary', { date: ymd }, 5000).catch(e => ({ err: String((e && e.message) || e) }));
    let lv = {};
    try { lv = await tsFetch('/volleyball/match/detail_live', {}, 5000); } catch (e) { lv = { err: String((e && e.message) || e) }; }
    const ex = (d && d.results_extra) || {};
    res.json({
      on: true, date: ymd,
      diaryErr: (d && d.err) || null,
      diaryCount: ((d && d.results) || []).length,
      comps: ((ex.competition) || []).slice(0, 25).map(c => c.name),
      teamsSample: ((ex.team) || []).slice(0, 12).map(t => t.name),
      diarySample: ((d && d.results) || []).slice(0, 3),
      liveErr: (lv && lv.err) || null,
      liveCount: ((lv && lv.results) || []).length,
      liveSample: ((lv && lv.results) || []).slice(0, 3)
    });
  } catch (e) { res.json({ on: true, error: String((e && e.message) || e) }); }
});
// 🏐 진단(D01): 더스포츠 배구 통계·순위·맞대결·일정 후보 엔드포인트 가용성 탐색(구조 확인용)
app.get('/api/ts/vbdiag', async (req, res) => {
  if (!TS_ON) return res.json({ on: false });
  const out = { on: true, ids: {}, probes: {} };
  try {
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const d = await tsFetch('/volleyball/match/diary', { date: ymd }, 6000).catch(() => null);
    const results = (d && d.results) || [];
    // 종료/진행 경기 우선(통계 있을 확률 높음)
    const m = results.find(x => String(x.status_id) === '8' || String(x.status_id) === '4') || results[0] || {};
    const matchId = m.id, teamId = m.home_team_id, awayTid = m.away_team_id, compId = m.unique_tournament_id || m.tournament_id, seasonId = m.season_id;
    out.ids = { matchId, teamId, awayTid, compId, seasonId, status: m.status_id };
    const probe = async (name, path, params) => {
      try { const r = await tsFetch(path, params, 5000); const res0 = r && r.results;
        let sk = null;
        if (Array.isArray(res0)) sk = (res0[0] && typeof res0[0] === 'object') ? Object.keys(res0[0]).slice(0, 18) : (res0.length ? typeof res0[0] : null);
        else if (res0 && typeof res0 === 'object') sk = Object.keys(res0).slice(0, 18);
        else if (r && typeof r === 'object') sk = Object.keys(r).slice(0, 10);
        out.probes[name] = { path, ok: !!(res0 && (Array.isArray(res0) ? res0.length : Object.keys(res0).length)), type: Array.isArray(res0) ? ('array ' + res0.length) : typeof res0, sampleKeys: sk }; }
      catch (e) { out.probes[name] = { path, err: String((e && e.message) || e).slice(0, 70) }; }
    };
    // 현재 경기 통계(detail_live 전체에서 해당 경기 추출: 서브/리시브/에이스/타임아웃 필드 확인)
    try { const lv = await tsFetch('/volleyball/match/detail_live', {}, 6000); const arr = (lv && lv.results) || []; const mine = arr.find(x => String(x && (x.id || (x[0]))) === String(matchId)) || arr[0];
      out.probes['detail_live.self'] = { count: arr.length, keys: mine ? (Array.isArray(mine) ? ('arr' + mine.length) : Object.keys(mine).slice(0, 20)) : null, statsRaw: mine ? JSON.stringify(mine.stats || mine.score || mine).slice(0, 900) : null }; } catch (e) { out.probes['detail_live.self'] = { err: String(e).slice(0, 60) }; }
    // API-Sports 배구 보완 가용성(순위는 이미 /api/rank 사용) — H2H·팀일정 확인
    const asProbe = async (name, path) => { try { const j = await asRaw('volleyball', path, 60000); const r = (j && j.response); out.probes[name] = { path, results: j && j.results, ok: Array.isArray(r) ? r.length : typeof r, sampleKeys: Array.isArray(r) && r[0] ? Object.keys(r[0]).slice(0, 16) : null, errors: j && j.errors }; } catch (e) { out.probes[name] = { path, err: String((e && e.message) || e).slice(0, 70) }; } };
    await asProbe('AS.status', '/status');
    await asProbe('AS.games.today', '/games?date=' + new Date().toISOString().slice(0, 10));
    // h2h/팀일정은 API-Sports 팀ID 필요 → today 게임에서 추출 후 2차 프로브
    try { const g = await asRaw('volleyball', '/games?date=' + new Date().toISOString().slice(0, 10), 60000); const gm = (g && g.response || [])[0]; const th = gm && gm.teams && gm.teams.home && gm.teams.home.id, ta = gm && gm.teams && gm.teams.away && gm.teams.away.id, lg = gm && gm.league && gm.league.id, se = gm && gm.league && gm.league.season;
      out.ids.asSample = { th, ta, lg, se };
      if (th && ta) await asProbe('AS.h2h', '/games?h2h=' + th + '-' + ta);
      if (th && se) await asProbe('AS.team_games', '/games?team=' + th + '&season=' + se);
    } catch (e) { out.probes['AS.derive'] = { err: String(e).slice(0, 60) }; }
    if (seasonId) { await probe('standing.detail', '/volleyball/standing/detail', { uuid: seasonId }); await probe('standing.table', '/volleyball/standing/table', { uuid: seasonId }); await probe('season.team_stats', '/volleyball/season/team_stats/list', { uuid: seasonId }); }
    if (compId) { await probe('season.list', '/volleyball/season/list', { uuid: compId }); await probe('competition.list', '/volleyball/competition/list', { uuid: compId }); }
    if (teamId) { await probe('team.list', '/volleyball/team/list', { uuid: teamId }); await probe('team.additional', '/volleyball/team/additional/list', { uuid: teamId }); await probe('match.recent_byteam', '/volleyball/match/recent/list', { team_id: teamId }); }
    if (matchId) { await probe('head2head', '/volleyball/head2head', { uuid: matchId }); await probe('match.trend', '/volleyball/match/trend/detail', { uuid: matchId }); await probe('match.analysis', '/volleyball/match/analysis', { uuid: matchId }); await probe('match.recent_bymatch', '/volleyball/match/recent/list', { uuid: matchId }); }
  } catch (e) { out.error = String((e && e.message) || e); }
  res.json(out);
});
// ============ 🏐 배구 상세 보완: 팀일정·맞대결(유도)·라이브통계 — API-Sports 보완 + TheSports 라이브 ============
const _vbResolveCache = new Map();
function _nrmVbTeam(s){ return String(s||'').toLowerCase().replace(/\b(women|woman|men|man|ladies|female|male|w|m|vc|bc|volley(ball)?|club)\b/g,'').replace(/[^a-z0-9가-힣]/g,'').trim(); }
function vbNormGame(g){
  const H=(g.teams&&g.teams.home)||{}, A=(g.teams&&g.teams.away)||{};
  const sc=g.scores||{}; const stObj=g.status||{};
  const stShort=String((typeof stObj==='object'?(stObj.short||stObj.long):stObj)||'');
  const fin=/FT|AOT|AW|WO|fin/i.test(stShort)||/finish/i.test(String(stObj&&stObj.long||''));
  const sched=/NS|TBD|POST/i.test(stShort)||/not started|scheduled/i.test(String(stObj&&stObj.long||''));
  return { id:g.id, date:g.date||(g.timestamp?new Date(g.timestamp*1000).toISOString():null), ts:g.timestamp||null,
    league:(g.league&&g.league.name)||'', leagueId:(g.league&&g.league.id)||null, season:(g.league&&g.league.season)||null,
    homeId:H.id, awayId:A.id, home:H.name||'', away:A.name||'', homeLogo:H.logo||'', awayLogo:A.logo||'',
    setsH:(sc.home!=null?sc.home:null), setsA:(sc.away!=null?sc.away:null), periods:g.periods||null,
    status:stShort, finished:fin, scheduled:sched };
}
async function vbTeamGamesRaw(teamId, season){
  const j=await asRaw('volleyball', `/games?team=${encodeURIComponent(teamId)}&season=${encodeURIComponent(season)}`, 300000).catch(()=>null);
  return ((j&&j.response)||[]);
}
// TheSports 경기 → API-Sports 팀/리그/시즌 ID 해석: 리그명→순위표의 팀명 매칭(제공사 간 안정적)
async function vbResolve(home, away, leagueName, season){
  const key='std|'+_nrmVbTeam(home)+'|'+_nrmVbTeam(away)+'|'+_nrmVbTeam(leagueName);
  const c=_vbResolveCache.get(key); if(c&&Date.now()-c.t<6*3600e3) return c.v;
  let out=null;
  try{
    const lid=await asLeagueId('volleyball', vbLeagueAlias(leagueName));
    if(lid){
      const m=String(season||'').match(/\d{4}/); const y=m?+m[0]:new Date().getFullYear();
      const h=_nrmVbTeam(home), a=_nrmVbTeam(away);
      for(const sy of [`${y}-${y+1}`, String(y), `${y-1}-${y}`, String(y-1)]){
        const j=await asRaw('volleyball', `/standings?league=${lid}&season=${encodeURIComponent(sy)}`, 3600e3).catch(()=>null);
        const table=parseHoopStandings(j); if(!table.length) continue;
        const find=n=>{ let r=table.find(t=>_nrmVbTeam(t.team)===n); if(r)return r; return table.find(t=>{ const tn=_nrmVbTeam(t.team); return tn&&(tn.includes(n)||n.includes(tn)); }); };
        const rh=find(h), ra=find(a);
        if(rh&&ra){ out={ leagueId:lid, leagueName, season:sy, homeId:rh.teamId, awayId:ra.teamId, homeName:rh.team, awayName:ra.team }; break; }
      }
    }
  }catch(e){}
  _vbResolveCache.set(key,{t:Date.now(),v:out});
  return out;
}
app.get('/api/volleyball/resolve', async (req,res)=>{ res.set('Cache-Control','no-store');
  try{ const r=await vbResolve(req.query.home,req.query.away,req.query.league,req.query.season); res.json(Object.assign({found:!!r}, r||{})); }
  catch(e){ res.json({found:false, error:String(e.message||e)}); } });
app.get('/api/volleyball/teamgames', async (req,res)=>{ res.set('Cache-Control','no-store');
  if(!APISPORTS_KEY) return res.json({needKey:true, games:[]});
  const team=req.query.team, season=req.query.season||new Date().getFullYear();
  if(!team) return res.status(400).json({error:'team required', games:[]});
  try{ let gs=(await vbTeamGamesRaw(team,season)).map(vbNormGame);
    if(!gs.length){ gs=(await vbTeamGamesRaw(team, (+String(season).slice(0,4))-1)).map(vbNormGame); }
    gs.sort((x,y)=>(x.ts||0)-(y.ts||0));
    res.json({ games:gs, raw:(req.query.debug?gs.slice(0,1):undefined) }); }
  catch(e){ res.status(502).json({error:String(e.message||e), games:[]}); } });
app.get('/api/volleyball/h2h', async (req,res)=>{ res.set('Cache-Control','no-store');
  if(!APISPORTS_KEY) return res.json({needKey:true, games:[]});
  const homeId=req.query.home, awayId=req.query.away; let season=+String(req.query.season||new Date().getFullYear()).slice(0,4);
  if(!homeId||!awayId) return res.status(400).json({error:'home/away required', games:[]});
  try{ let all=[];
    for(const s of [season, season-1, season-2]){ const rows=await vbTeamGamesRaw(homeId,s).catch(()=>[]);
      rows.forEach(g=>{ const h=g.teams&&g.teams.home&&g.teams.home.id, a=g.teams&&g.teams.away&&g.teams.away.id;
        if((String(h)===String(homeId)&&String(a)===String(awayId))||(String(h)===String(awayId)&&String(a)===String(homeId))) all.push(vbNormGame(g)); }); }
    const seen=new Set(); all=all.filter(g=>{ if(seen.has(g.id))return false; seen.add(g.id); return true; }).sort((x,y)=>(y.ts||0)-(x.ts||0));
    res.json({ games:all }); }
  catch(e){ res.status(502).json({error:String(e.message||e), games:[]}); } });
// 🏐 배구 라이브 통계(현재 경기) — TheSports detail_live. stats=[[scope,[[statId,home,away]...]]].
app.get('/api/volleyball/live', async (req,res)=>{ res.set('Cache-Control','no-store');
  const raw=String(req.query.id||''); if(!/^ts/.test(raw)) return res.json({found:false, note:'not-thesports'});
  const id=raw.replace(/^ts/,'');
  try{ const lv=await tsFetch('/volleyball/match/detail_live', {}, 5000).catch(()=>null);
    const arr=(lv&&lv.results)||[]; const mine=arr.find(x=>String(x&&x.id)===String(id));
    if(!mine) return res.json({ found:false });
    const scopes=[]; (mine.stats||[]).forEach(sc=>{ if(Array.isArray(sc)&&Array.isArray(sc[1])){ scopes.push({ scope:sc[0], rows:sc[1].map(r=>({id:r[0], home:r[1], away:r[2]})) }); } });
    res.json({ found:true, score:mine.score||null, scopes, rawStats:(req.query.debug?mine.stats:undefined), rawScore:(req.query.debug?mine.score:undefined) });
  }catch(e){ res.status(502).json({error:String(e.message||e)}); } });
// 🔎 진단(R011~R014): API-Sports 리그 검색 — 정확한 리그 id/국가 확인(KBL·WKBL·KBO·NPB·EuroLeague 등)
app.get('/api/diag/leagues', async (req, res) => {
  const sport = req.query.sport || 'basketball'; const q = req.query.q || '';
  try {
    const j = await asRaw(sport, `/leagues?search=${encodeURIComponent(q)}`, 86400000);
    const arr = (j && j.response) || [];
    const out = arr.slice(0, 20).map(l => { const lg = l.league || l; const co = l.country || {}; return { id: lg.id, name: lg.name, type: lg.type, country: co.name || l.country, code: co.code }; });
    res.json({ sport, q, results: arr.length, leagues: out, errors: j && j.errors });
  } catch (e) { res.json({ error: String(e.message || e) }); }
});
// 🔎 진단: API-Sports(api-basketball)가 종료 경기 팀/선수 통계를 제공하는지 실응답 확인(비밀키 비노출).
//   예: /api/diag/bskstats?date=2026-11-10&league=12&home=Golden&away=New%20Orleans
app.get('/api/diag/bskstats', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ note: 'needKey' });
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const league = String(req.query.league || '12');   // 12 = NBA
  const home = String(req.query.home || '').toLowerCase(), away = String(req.query.away || '').toLowerCase();
  const out = { date, league, tried: [] };
  try {
    const yr = +date.slice(0, 4); const seasons = [String(yr), `${yr}-${yr + 1}`, String(yr - 1), `${yr - 1}-${yr}`];
    let games = [], usedSeason = null;
    for (const s of seasons) {
      const j = await asRaw('basketball', `/games?league=${league}&season=${encodeURIComponent(s)}&date=${date}&timezone=Asia/Seoul`, 600000).catch(() => null);
      out.tried.push({ season: s, results: j && j.results, errors: j && j.errors });
      const arr = (j && j.response) || [];
      if (arr.length) { games = arr; usedSeason = s; break; }
    }
    out.usedSeason = usedSeason; out.gameCount = games.length;
    const match = games.find(g => { const h = ((g.teams && g.teams.home && g.teams.home.name) || '').toLowerCase(), a = ((g.teams && g.teams.away && g.teams.away.name) || '').toLowerCase(); return (!home || h.includes(home) || home.includes(h.split(' ')[0])) && (!away || a.includes(away) || away.includes(a.split(' ')[0])); }) || games[0] || null;
    if (!match) { out.note = 'no-game-matched'; out.sampleTeams = games.slice(0, 6).map(g => ({ id: g.id, h: g.teams && g.teams.home && g.teams.home.name, a: g.teams && g.teams.away && g.teams.away.name, st: g.status && g.status.short })); return res.json(out); }
    out.game = { id: match.id, home: match.teams.home.name, away: match.teams.away.name, status: match.status && match.status.short, scores: match.scores };
    const st = await asRaw('basketball', `/games/statistics/teams?id=${match.id}`, 600000).catch(e => ({ _err: String(e.message || e) }));
    const sr = (st && st.response) || [];
    out.teamStats = { results: st && st.results, errors: st && st.errors, teams: sr.length, sample: sr.slice(0, 2).map(x => ({ team: x.team && x.team.name, keys: x.statistics ? (Array.isArray(x.statistics) ? x.statistics.map(s => s.type).slice(0, 30) : Object.keys(x.statistics).slice(0, 30)) : Object.keys(x).slice(0, 20), raw: JSON.stringify(x.statistics || x).slice(0, 700) })) };
    const sp = await asRaw('basketball', `/games/statistics/players?id=${match.id}`, 600000).catch(e => ({ _err: String(e.message || e) }));
    const spr = (sp && sp.response) || [];
    out.playerStats = { results: sp && sp.results, errors: sp && sp.errors, rows: spr.length };
  } catch (e) { out.error = String(e.message || e); }
  res.json(out);
});
// 🏐 진단: 농구 활성화/커버리지 + 초단위 timer + 라인업 확인
app.get('/api/ts/bskdiag', async (req, res) => {
  if (!TS_ON) return res.json({ on: false });
  const out = { on: true, ids: {}, probes: {} };
  try {
    // 샘플 id 확보: 오늘 diary에서 경기/팀/대회, detail_live에서 선수
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const d = await tsFetch('/basketball/match/diary', { date: ymd }, 5000).catch(() => null);
    const m = ((d && d.results) || [])[0] || {};
    const matchId = m.id, teamId = m.home_team_id, compId = m.competition_id, seasonId = m.season_id;
    out.ids = { matchId, teamId, compId, seasonId };
    let playerId = null;
    try { const lu = await tsFetch('/basketball/match/lineup_live', {}, 4000); const it = ((lu && lu.results) || [])[0]; const pl = it && it.players && it.players[0] && it.players[0][0]; playerId = pl && pl[0]; out.ids.playerId = playerId; } catch (e) {}
    const probe = async (name, path, params) => {
      try { const r = await tsFetch(path, params, 4000); const res0 = r && r.results; out.probes[name] = { ok: !!(res0 && (Array.isArray(res0) ? res0.length : Object.keys(res0).length)), type: Array.isArray(res0) ? ('array ' + res0.length) : typeof res0, sampleKeys: res0 ? (Array.isArray(res0) ? (res0[0] && typeof res0[0] === 'object' ? Object.keys(res0[0]).slice(0, 14) : typeof res0[0]) : Object.keys(res0).slice(0, 14)) : null }; }
      catch (e) { out.probes[name] = { err: String((e && e.message) || e).slice(0, 60) }; }
    };
    if (teamId) { await probe('team.list', '/basketball/team/list', { uuid: teamId }); await probe('team.additional', '/basketball/team/additional/list', { uuid: teamId }); }
    if (playerId) { await probe('player.list', '/basketball/player/list', { uuid: playerId }); }
    if (compId) { await probe('season.list', '/basketball/season/list', { uuid: compId }); await probe('competition.list', '/basketball/competition/list', { uuid: compId }); }
    if (seasonId) { await probe('standing.detail', '/basketball/standing/detail', { uuid: seasonId }); await probe('season.player_stats', '/basketball/season/player_stats/list', { uuid: seasonId }); await probe('season.team_stats', '/basketball/season/team_stats/list', { uuid: seasonId }); }
    if (teamId && seasonId) { await probe('player.list_byteam', '/basketball/player/list', { team_id: teamId, season_id: seasonId }); }
    if (matchId) { await probe('match.live_history', '/basketball/match/live/history', { uuid: matchId }); await probe('match.trend', '/basketball/match/trend/detail', { uuid: matchId }); await probe('match.recent_byteam', '/basketball/match/recent/list', { team_id: teamId }); }
  } catch (e) { out.error = String((e && e.message) || e); }
  res.json(out);
});
app.get('/api/ts/bsktest', async (req, res) => {
  if (!TS_ON) return res.json({ on: false, msg: 'TheSports 키 미설정' });
  const ymd = String(req.query.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  var out = { on: true, date: ymd };
  try {
    const d = await tsFetch('/basketball/match/diary', { date: ymd }, 5000).catch(e => ({ err: String((e && e.message) || e) }));
    out.diaryErr = (d && d.err) || null;
    out.diaryCount = ((d && d.results) || []).length;
    const ex = (d && d.results_extra) || {};
    out.comps = ((ex.competition) || []).slice(0, 30).map(c => c.name);
    out.diarySample = ((d && d.results) || []).slice(0, 2);
  } catch (e) { out.diaryErr = String((e && e.message) || e); }
  try {
    const lv = await tsFetch('/basketball/match/detail_live', {}, 4000);
    const list = (lv && lv.results) || [];
    out.liveCount = list.length;
    out.liveSample = list.slice(0, 3);   // score/timer/stats 실제 구조 확인용
    // timer 있는(진행중) 경기 하나로 라인업도 호출
    const firstId = (list[0] && (list[0].id || (list[0].score && list[0].score[0]))) || null;
    out.firstId = firstId;
    if (firstId) {
      try { const lu = await tsFetch('/basketball/match/lineup_live', { uuid: firstId }, 4000); out.lineupSample = (lu && lu.results) || lu; }
      catch (e) { out.lineupErr = String((e && e.message) || e); }
    }
  } catch (e) { out.liveErr = String((e && e.message) || e); }
  res.json(out);
});
// 🔬 진단(읽기전용): 특정 종료경기 uuid 로 TheSports 미사용 엔드포인트가 완전한 데이터를 주는지 확인.
//   live/history(PBP)·trend/detail(흐름·슛)·lineup_live(선발/박스) 구조만 보고, 비밀키는 노출 안 함.
//   예: /api/ts/bskmatch?uuid=vjxm8xt51361q6o   (골스-뉴올리언스 ts id 에서 ts 접두 제거)
app.get('/api/ts/bskmatch', async (req, res) => {
  if (!TS_ON) return res.json({ on: false });
  const uuid = String(req.query.uuid || '').replace(/^ts/, '');
  if (!uuid) return res.json({ error: 'need uuid' });
  const out = { uuid, probes: {} };
  const dig = (obj, depth = 0) => {
    if (obj == null) return null;
    if (Array.isArray(obj)) return { _arr: obj.length, _first: depth < 3 ? dig(obj[0], depth + 1) : '…' };
    if (typeof obj === 'object') { const o = {}; for (const k of Object.keys(obj).slice(0, 25)) o[k] = depth < 3 ? dig(obj[k], depth + 1) : '…'; return o; }
    return (typeof obj === 'string' && obj.length > 40) ? obj.slice(0, 40) + '…' : obj;
  };
  const probe = async (name, path, params) => {
    try { const r = await tsFetch(path, params, 5000); const results = (r && r.results); out.probes[name] = { ok: results != null, count: Array.isArray(results) ? results.length : (results ? 1 : 0), shape: dig(results), rawSample: JSON.stringify(results).slice(0, 1200) }; }
    catch (e) { out.probes[name] = { err: String((e && e.message) || e).slice(0, 80) }; }
  };
  await probe('live_history', '/basketball/match/live/history', { uuid });
  await probe('trend_detail', '/basketball/match/trend/detail', { uuid });
  await probe('lineup_live', '/basketball/match/lineup_live', { uuid });
  if (String(req.query.raw) === '1') {
    try {
      const lh = await tsFetch('/basketball/match/live/history', { uuid }, 5000);
      const m = ((lh && lh.results) || lh && lh.results === undefined ? lh.results : null);
      const item = lh && lh.results;
      out.rawFull = {
        score: item && item.score,
        stats: item && item.stats,
        players_g0_first2: item && item.players && item.players[0] && item.players[0].slice(0, 2),
        players_groups: item && item.players && item.players.map(g => (g || []).length),
        tlive_q1_first6: item && item.tlive && item.tlive[0] && item.tlive[0].slice(0, 6)
      };
      const tr = await tsFetch('/basketball/match/trend/detail', { uuid }, 5000);
      out.trendFull = tr && tr.results;
    } catch (e) { out.rawErr = String((e && e.message) || e).slice(0, 80); }
  }
  res.json(out);
});
// 🔬 진단: TheSports diary를 '캐시 없이 직접' 호출해 실제 소요시간·응답을 측정(느림 vs 무응답 vs 빈응답 구분).
//   ?sport=basketball&date=2026-11-06&to=15000  (to = 요청 타임아웃 ms, 최대 25000)
//   비밀키(user/secret/token)는 응답에 절대 노출하지 않음. 경로 연결 방식만 via로 표기.
app.get('/api/ts/raw', async (req, res) => {
  if (!TS_ON) return res.json({ on: false, msg: 'TheSports 키 미설정' });
  const sport = String(req.query.sport || 'basketball').toLowerCase().replace(/[^a-z]/g, '');
  const ymd = String(req.query.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const toMs = Math.min(25000, Math.max(1000, +req.query.to || 15000));
  const path = '/' + sport + '/match/diary';
  const force = String(req.query.via || '').toLowerCase();   // 'direct' | 'proxy' 강제(호환 진단용)
  const useProxy = force === 'proxy' ? true : force === 'direct' ? false : !!TS_PROXY;
  let url, via;
  if (useProxy && TS_PROXY) { via = 'proxy'; url = `${TS_PROXY}/ts/v1${path}?` + new URLSearchParams({ token: TS_RELAY_TOKEN, date: ymd }).toString(); }
  else { via = 'direct'; url = `${TS_BASE}${path}?` + new URLSearchParams({ user: TS_USER, secret: TS_SECRET, date: ymd }).toString(); }
  const t0 = Date.now(); const ctrl = new AbortController(); const timer = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, toMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'livescore-ai/1.0' }, signal: ctrl.signal });
    const ms = Date.now() - t0; let body = null; try { body = await r.json(); } catch (e) {}
    clearTimeout(timer);
    const results = (body && body.results) || [];
    const full = String(req.query.full || '') === '1';
    res.json({ on: true, sport, date: ymd, via, httpStatus: r.status, ms, toMs,
      resultCount: Array.isArray(results) ? results.length : null,
      errField: (body && (body.err || body.msg || body.error)) || null,
      compCount: ((body && body.results_extra && body.results_extra.competition) || []).length,
      extraKeys: (body && body.results_extra) ? Object.keys(body.results_extra) : null,
      matchKeys: (full && Array.isArray(results) && results[0]) ? Object.keys(results[0]) : null,
      rawFirst: (full && Array.isArray(results)) ? results[0] : null,
      sample: (Array.isArray(results) ? results.slice(0, 2).map(m => ({ id: m.id, home: m.home_team_id, away: m.away_team_id, comp: m.competition_id, status: m.status_id, match_time: m.match_time })) : null) });
  } catch (e) { clearTimeout(timer); res.json({ on: true, sport, date: ymd, via, ms: Date.now() - t0, toMs, aborted: String((e && e.message) || e) }); }
});
// 🔬 진단: TheSports 팀 최근경기(recent/list) 응답 구조 확인 — 인사이트/팀상세 실데이터 연결용
app.get('/api/ts/recentprobe', async (req, res) => {
  if (!TS_ON) return res.json({ on: false });
  const sport = String(req.query.sport || 'football').toLowerCase().replace(/[^a-z]/g, '');
  const tid = String(req.query.tid || '');
  if (!tid) return res.json({ err: 'no tid' });
  try {
    const r = await tsFetch('/' + sport + '/match/recent/list', { team_id: tid }, 5000, 9000).catch(e => ({ err: String((e && e.message) || e) }));
    const results = (r && r.results) || [];
    res.json({ on: true, sport, tid, count: Array.isArray(results) ? results.length : null,
      resultsType: Array.isArray(results) ? 'array' : typeof results,
      firstKeys: (results[0] && typeof results[0] === 'object' && !Array.isArray(results[0])) ? Object.keys(results[0]) : (Array.isArray(results[0]) ? ('array len ' + results[0].length) : typeof results[0]),
      first: results[0] || null, extraKeys: (r && r.results_extra) ? Object.keys(r.results_extra) : null, err: r && r.err });
  } catch (e) { res.json({ err: String((e && e.message) || e) }); }
});
// 🏟️ 진단: TheSports 야구가 아시안게임을 갖고 있는지 + 점수가 올바른지 확인
app.get('/api/ts/baseball', async (req, res) => {
  if (!TS_ON) return res.json({ on: false });
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const q = String(req.query.q || '').toLowerCase();
  try {
    const ts = await tsBaseballGames(date).catch(() => []);
    const leagues = [...new Set(ts.map(g => g.league))];
    const hit = q ? ts.filter(g => ((g.home || '') + (g.away || '') + (g.league || '')).toLowerCase().includes(q)) : [];
    res.json({ count: ts.length, leagues, q, matched: hit.slice(0, 6).map(g => ({ h: g.home, a: g.away, hs: g.hs, as: g.as, league: g.league, state: g.state, inning: g.curInning, half: g.inningHalf })) });
  } catch (e) { res.json({ err: String((e && e.message) || e) }); }
});
// 축구 status_id → 상태/표기 (TheSports enum)
function tsFootState(s) { s = Number(s); if (s === 8) return 'finished'; if ([2, 3, 4, 5, 7].includes(s)) return 'live'; return 'scheduled'; }
function tsFootStatus(s) { return ({ 1: 'NS', 2: '1H', 3: 'HT', 4: '2H', 5: 'ET', 7: 'PEN', 8: 'FT' })[Number(s)] || 'NS'; }
// 축구 경기목록(diary) + 실시간(detail_live) 오버레이 → 우리 표준 형태로
async function tsFootballGames(date) {
  const ymd = String(date).replace(/-/g, '');
  const d = await tsFetch('/football/match/diary', { date: ymd }, 6000);
  const ex = d.results_extra || {};
  const teams = {}, comps = {}, countries = {};
  (ex.country || []).forEach(c => countries[c.id] = c.name);
  (ex.team || []).forEach(t => teams[t.id] = { name: t.name, logo: t.logo });
  (ex.competition || []).forEach(c => comps[c.id] = { name: c.name, logo: c.logo, country: countries[c.country_id] || '' });
  // 실시간 오버레이 (진행 경기)
  const live = {};
  try {
    const lv = await tsFetch('/football/match/detail_live', {}, 6000);
    // TheSports 축구 detail_live score 배열: [matchId, status_id, home_scores[], away_scores[], 현재하프_킥오프_timestamp(초)]
    (lv.results || []).forEach(m => { const s = m.score || m; if (Array.isArray(s)) live[s[0]] = { st: s[1], h: (s[2] || [])[0], a: (s[3] || [])[0], ts: s[4] }; });
  } catch (e) {}
  // status_id → 하프 시작까지 누적초(base). 2=1H시작, 3=HT(45:00 고정), 4=2H시작(+45분), 5=연장(+90분)
  const FT_BASE = { 2: 0, 3: 45 * 60, 4: 45 * 60, 5: 90 * 60 };
  const FT_RUN = { 2: 1, 4: 1, 5: 1 };   // 실제로 시계가 흐르는 하프(HT·PEN 제외)
  const nowSec = Math.floor(Date.now() / 1000);
  return (d.results || []).map(m => {
    const ht = teams[m.home_team_id] || {}, at = teams[m.away_team_id] || {}, cp = comps[m.competition_id] || {};
    const lvm = live[m.id];
    const sid = lvm ? lvm.st : m.status_id;
    let hs = m.home_scores ? m.home_scores[0] : null, as = m.away_scores ? m.away_scores[0] : null;
    if (lvm) { if (lvm.h != null) hs = lvm.h; if (lvm.a != null) as = lvm.a; }
    // ⏱️ #6 경기시계: 현재 하프 킥오프 timestamp가 '검증 가능'할 때만 초 단위 제공.
    //    교차검증: (지금 - ts)가 0~70분 범위여야 '현재 하프의 시작'으로 인정(1H킥오프가 2H에 그대로 오는 등 오탐 차단).
    //    범위 밖이면 초 미제공(ftTs=null) → 프론트는 분/하프 라벨만 정직하게 표시.
    let ftTs = null, ftBase = 0, ftRun = 0, ftCap = 0, elapsed = null;
    const sidN = Number(sid);
    if (lvm && lvm.ts && tsFootState(sid) === 'live' && FT_BASE[sidN] != null) {
      const within = nowSec - Number(lvm.ts);
      if (within >= 0 && within <= 70 * 60) {
        ftTs = Number(lvm.ts); ftBase = FT_BASE[sidN]; ftRun = FT_RUN[sidN] ? 1 : 0;
        ftCap = ftBase + 70 * 60;
        elapsed = Math.floor((ftBase + (ftRun ? within : 0)) / 60);
      }
    }
    return {
      id: m.id, sport: 'football', tsid: m.id,
      home: ht.name || m.home_team_id, away: at.name || m.away_team_id,
      homeLogo: ht.logo || '', awayLogo: at.logo || '',
      homeTid: m.home_team_id, awayTid: m.away_team_id,
      league: cp.name || '', leagueLogo: cp.logo || '', leagueId: m.competition_id || '', country: cp.country || '',
      hs, as, state: tsFootState(sid), status: tsFootStatus(sid), statusLong: '',
      date: m.match_time ? new Date(m.match_time * 1000).toISOString() : null,
      elapsed, ftTs, ftBase, ftRun, ftCap
    };
  });
}
// ⚾ TheSports 야구 경기목록(diary)+실시간(detail_live) → 우리 표준 형태
//    scores: ft=득점(R) / h=안타(H) / e=실책(E) / p1~p9=이닝별 득점  [모두 [home, away]]
//    실시간 extra: base="1루2루3루"(0/1) / out=아웃 / good=스트라이크 / bad=볼
const tsNum = v => { const n = Number(v); return (v === '' || v == null || isNaN(n)) ? null : n; };
// ⚾ TheSports 경기별 박스스코어(match/live/history) — 팀 R/H/E/BB + 선수별 기록
const TS_TSTAT = { 601: 'h', 602: 'e', 605: 'hr', 606: 'rbi', 608: 'bb', 609: 'k', 611: 'ab', 612: 'avg', 677: 'r' };
const TS_PSTAT = { 613: 'pos', 614: 'ab', 615: 'r', 616: 'h', 617: 'rbi', 618: 'avg', 619: 'd2', 620: 't3', 621: 'hr', 627: 'tb', 628: 'sb', 650: 'k', 651: 'bb', 634: 'ip', 635: 'ph', 636: 'er', 637: 'pbb', 638: 'pk', 639: 'era', 640: 'np', 644: 'bf', 648: 'phr', 649: 'ra', 696: 'w', 697: 'l', 703: 'sv' };
const POS_NAME = { '1': 'DH', '2': 'C', '3': '1B', '4': '2B', '5': '3B', '6': 'CF', '7': 'LF', '8': 'RF', '9': 'SS', '10': 'PH', '11': 'PR', '12': 'SP', '13': 'RP', '14': 'P' };
const TS_PNAME = new Map(); // player_id -> {name, logo, pos}
let KBO_KO = {};            // player_id -> 한글 이름 (KBO 선수 현지화)
let KBO_KO_NAME = {};       // 정규화 영문명 -> 한글 (id 안 맞을 때 이름으로 폴백)
try { KBO_KO = JSON.parse(fs.readFileSync(path.join(__dirname, 'kbo_names.json'), 'utf8')); } catch (e) { KBO_KO = {}; }
try { KBO_KO_NAME = JSON.parse(fs.readFileSync(path.join(__dirname, 'kbo_names_byname.json'), 'utf8')); } catch (e) { KBO_KO_NAME = {}; }
const koNorm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
function koName(pid, engName) { return KBO_KO[pid] || KBO_KO_NAME[koNorm(engName)] || null; }
const tsDecode = (arr, map) => { const o = {}; (arr || []).forEach(p => { const k = map[p[0]]; if (k != null) o[k] = p[1]; }); return o; };
// ⚾ 경기상태 코드 → {inning, half}  (top=초·원정공격 / bottom=말·홈공격)
const TS_STATUS = {
  432: [1, 'top'], 433: [1, 'bottom'], 434: [2, 'top'], 435: [2, 'bottom'], 436: [3, 'top'], 437: [3, 'bottom'],
  438: [4, 'top'], 439: [4, 'bottom'], 440: [5, 'top'], 411: [5, 'bottom'], 412: [6, 'top'], 413: [6, 'bottom'],
  414: [7, 'top'], 415: [7, 'bottom'], 416: [8, 'top'], 417: [8, 'bottom'], 418: [9, 'top'], 419: [9, 'bottom'],
  420: [10, 'top'], 421: [10, 'bottom']
};
// 비정상 상태 코드 → 라벨 키 (우천취소·연기·중단 등)
const TS_ABN = { 0: 'abnormal', 14: 'postponed', 15: 'delayed', 16: 'canceled', 17: 'suspended', 19: 'halved', 99: 'tbd' };
const TS_WANT = /KBO|NPB|CPBL|Korea|Nippon|Japan|일본|한국|대만|Taiwan|Chinese Professional/i;
async function tsBox(matchId, ttl = 60000) {
  const h = await tsFetch('/baseball/match/live/history', { uuid: matchId }, ttl).catch(() => null);
  const r = h && h.results; if (!r) return null;
  return tsDecodeBox(r);
}
async function tsName(pid) {
  if (TS_PNAME.has(pid)) return TS_PNAME.get(pid);
  let v = { name: null, logo: '', pos: '' };
  try { const r = await tsFetch('/baseball/player/list', { uuid: pid }, 86400000); const p = (r.results || [])[0]; if (p) v = { name: p.name || null, logo: p.logo || '', pos: p.position || '' }; } catch (e) {}
  TS_PNAME.set(pid, v); return v;
}
// stats/players 배열 → 표준 박스 형태로 디코드 (실시간·완료 공용)
function tsDecodeBox(m) {
  const full = (m.stats || []).find(s => s[0] === 0);
  const team = { home: {}, away: {} };
  if (full) (full[1] || []).forEach(c => { const k = TS_TSTAT[c[0]]; if (k) { team.home[k] = c[1]; team.away[k] = c[2]; } });
  const side = list => (list || []).map(p => Object.assign({ id: p.id }, tsDecode(p.stats, TS_PSTAT)));
  return { team, players: { home: side(m.players && m.players.home), away: side(m.players && m.players.away) }, battingTeam: Array.isArray(m.score) ? m.score[2] : null };
}
// ⚡ 진행중 경기 실시간 박스(detail_live 에서 stats+players 추출)
async function tsLiveBox(matchId, ttl = 2500) {
  const lv = await tsFetch('/baseball/match/detail_live', {}, ttl).catch(() => null);
  const m = lv && (lv.results || []).find(x => (Array.isArray(x.score) && x.score[0] === matchId) || x.id === matchId);
  if (!m) return null;
  const b = tsDecodeBox(m);
  if (!b.players.home.length && !b.players.away.length && !Object.keys(b.team.home).length) return null;
  return b;
}
async function tsBaseballGames(date) {
  const ymd = String(date).replace(/-/g, '');
  const d = await tsFetch('/baseball/match/diary', { date: ymd }, 6000);
  const ex = d.results_extra || {};
  const teams = {}, leagues = {};
  (ex.team || []).forEach(t => teams[t.id] = { name: t.name, logo: t.logo });
  (ex.unique_tournament || []).forEach(u => leagues[u.id] = { name: u.name, logo: u.logo });
  // 실시간(진행 경기): score[3]=scores객체, extra=볼카운트/주자/아웃
  const live = {};
  try {
    const lv = await tsFetch('/baseball/match/detail_live', {}, 3000);
    (lv.results || []).forEach(m => { const s = m.score || []; live[(s[0]) || m.id] = { status: s[1], batTeam: s[2], sc: s[3] || {}, extra: m.extra || {}, stats: m.stats || [], players: m.players || {} }; });
  } catch (e) {}
  const now = Date.now();
  const games = (d.results || []).map(m => {
    const ht = teams[m.home_team_id] || {}, at = teams[m.away_team_id] || {}, lg = leagues[m.unique_tournament_id] || {};
    const lvm = live[m.id];
    const sc = (lvm && lvm.sc && Object.keys(lvm.sc).length) ? lvm.sc : (m.scores || {});
    const ft = sc.ft || [], H = sc.h || [], E = sc.e || [];
    const hs = tsNum(ft[0]), as = tsNum(ft[1]);
    const hInn = {}, aInn = {}; let maxInn = 0;
    for (let i = 1; i <= 12; i++) { const p = sc['p' + i]; if (p && (p[0] !== '' || p[1] !== '')) { const a = tsNum(p[0]), b = tsNum(p[1]); if (a != null) hInn[i] = a; if (b != null) aInn[i] = b; maxInn = i; } }
    const t = m.match_time ? m.match_time * 1000 : 0;
    // 상태: detail_live에 있어도 "경기상태 코드"로 정확히 판정 (시작 120분 전이면 detail_live에 잡히지만 아직 예정)
    const stCode = lvm ? lvm.status : m.status_id;
    const abn = TS_ABN[stCode] || null;   // 우천취소·연기·중단 등
    let state;
    if (lvm) {
      const st = lvm.status;
      if (TS_STATUS[st]) state = 'live';
      else if (st === 100) state = 'finished';
      else if (st === 1) state = 'scheduled';
      else if (abn) state = (abn === 'delayed' || abn === 'suspended') ? 'live' : 'finished';
      else state = (t > now ? 'scheduled' : 'live');
    } else {
      state = abn ? (abn === 'postponed' || abn === 'tbd' ? 'scheduled' : 'finished') : (t > now ? 'scheduled' : 'finished');
    }
    const isLive = state === 'live';
    const g = {
      id: m.id, sport: 'baseball', home: ht.name || m.home_team_id, away: at.name || m.away_team_id,
      homeLogo: ht.logo || '', awayLogo: at.logo || '', league: lg.name || '', leagueLogo: lg.logo || '',
      hs, as, state, status: state === 'finished' ? 'FT' : state === 'live' ? 'IN' : 'NS', abnStatus: abn,
      date: t ? new Date(t).toISOString() : null,
      box: {
        home: { r: hs, h: tsNum(H[0]), e: tsNum(E[0]), bb: null, innings: hInn },
        away: { r: as, h: tsNum(H[1]), e: tsNum(E[1]), bb: null, innings: aInn }
      }
    };
    if (lvm && isLive) {
      // 이닝·초말·공격팀 = 경기상태 코드 우선(정확), 없으면 점수 들어간 마지막 회
      const sd = TS_STATUS[lvm.status];
      if (sd) { g.curInning = sd[0]; g.period = sd[0]; g.inningHalf = sd[1]; }
      else if (maxInn) { g.curInning = maxInn; g.period = maxInn; }
      // 공격팀/초말: 상태코드(sd=이닝+초말 직접 인코딩)가 가장 정확 → sd가 있으면 그 초말을 신뢰(덮어쓰지 않음).
      //   ⚠️ 예전엔 batTeam으로 초말을 무조건 덮어써서, batTeam이 틀리면 8회초를 8회말로 뒤집는 버그가 있었음.
      //   → sd 있으면 sd 초말 고정, 공격팀은 거기서 유도. batTeam은 sd가 없을 때만 초말 결정에 사용.
      if (sd) {
        g.batting = g.inningHalf === 'top' ? 'away' : 'home';
      } else if (lvm.batTeam === 1) { g.batting = 'home'; g.inningHalf = 'bottom'; }
      else if (lvm.batTeam === 2) { g.batting = 'away'; g.inningHalf = 'top'; }
      else if (g.inningHalf) { g.batting = g.inningHalf === 'top' ? 'away' : 'home'; }
      // 🛡️ 라인스코어 폴백(신뢰 신호가 전혀 없을 때만): 현재 회에 홈팀이 '실제 득점(>0)'했으면 홈이 그 회 공격 → '말'.
      //    ⚠️ 예전엔 "현재 회 양팀 칸이 둘 다 null이 아니면 무조건 말"로 판정해, 0:0으로 채워진 3회초를 3회말로 뒤집는 버그가 있었음.
      //    → 상태코드(sd)·공격팀(batTeam)이 있으면 그걸 신뢰하고, 둘 다 없을 때만 '홈 실득점(>0)' 조건으로 보정.
      if (!sd && lvm.batTeam == null && g.curInning && (tsNum(hInn[g.curInning]) || 0) > 0) {
        g.inningHalf = 'bottom'; g.batting = 'home';
      }
      const x = lvm.extra || {};
      if (x.base != null || x.out != null || x.good != null || x.bad != null) {
        const base = String(x.base || '000');
        g.bso = { balls: tsNum(x.bad), strikes: tsNum(x.good), outs: tsNum(x.out), bases: { first: base[0] === '1', second: base[1] === '1', third: base[2] === '1' } };
      }
      // ⚡ 진행중 경기: 실시간 팀 통계에서 BB(및 누락 H/E) 바로 병합 (detail_live 에 이미 포함)
      if (lvm.stats && lvm.stats.length) {
        const tb = tsDecodeBox({ stats: lvm.stats }).team;
        ['home', 'away'].forEach(s => {
          if (tb[s].bb != null) g.box[s].bb = tb[s].bb;
          if ((g.box[s].h == null) && tb[s].h != null) g.box[s].h = tb[s].h;
          if ((g.box[s].e == null) && tb[s].e != null) g.box[s].e = tb[s].e;
        });
      }
      // 🏏 안타(H)·볼넷(BB) 팀 합계 보정: 라인스코어/팀스탯에 안 실려도(NPB 라이브 등) 타자 개인기록 합계로 채움
      ['home', 'away'].forEach(s => {
        const pl = (lvm.players && lvm.players[s]) || [];
        if (!pl.length) return;
        let hh = 0, bb = 0, hasH = false, hasBB = false;
        pl.forEach(p => {
          const d = tsDecode(p.stats, TS_PSTAT); if (!d || d.ip != null) return;   // 타자만(투수 제외)
          if (d.h != null) { hh += (tsNum(d.h) || 0); hasH = true; }
          if (d.bb != null) { bb += (tsNum(d.bb) || 0); hasBB = true; }
        });
        if (hasH && !(g.box[s].h > 0)) g.box[s].h = hh;
        if (hasBB && !(g.box[s].bb > 0)) g.box[s].bb = bb;
      });
      // 🏏 타격팀 타자 3명(카드 좌측 표시용) — 이름/사진은 map 이후 일괄 조회
      const bside = g.batting || (g.inningHalf === 'top' ? 'away' : 'home');
      const rawP = (lvm.players && lvm.players[bside]) || [];
      if (rawP.length) {
        const dec = rawP.map(p => Object.assign({ id: p.id }, tsDecode(p.stats, TS_PSTAT))).filter(p => p.ip == null).slice(0, 3);
        if (dec.length) g._atbatRaw = { side: bside, players: dec.map(p => ({ id: p.id, ab: p.ab, h: p.h, pos: p.pos })) };
      }
    }
    return g;
  });
  // 🧮 KBO/NPB 완료 경기 → 경기별 통계(history)에서 팀 BB(및 누락 H/E) 병합
  const bbTargets = games.filter(g => TS_WANT.test(g.league) && g.state === 'finished');
  await Promise.all(bbTargets.map(async g => {
    const b = await tsBox(g.id, 3600000).catch(() => null);
    if (!b || !b.team) return;
    ['home', 'away'].forEach(s => {
      if (b.team[s].bb != null) g.box[s].bb = b.team[s].bb;
      if (g.box[s].h == null && b.team[s].h != null) g.box[s].h = b.team[s].h;
      if (g.box[s].e == null && b.team[s].e != null) g.box[s].e = b.team[s].e;
    });
  }));
  // 🏏 타격 중 타자 이름/사진 일괄 조회 후 부착 (카드 좌측용)
  const abIds = [];
  games.forEach(g => { if (g._atbatRaw) g._atbatRaw.players.forEach(p => abIds.push(p.id)); });
  if (abIds.length) {
    await Promise.all([...new Set(abIds)].map(id => tsName(id).catch(() => {})));
    games.forEach(g => {
      if (!g._atbatRaw) return;
      g.atbat = { side: g._atbatRaw.side, players: g._atbatRaw.players.map(p => { const n = TS_PNAME.get(p.id) || {}; return { name: n.name || '', name_ko: koName(p.id, n.name), photo: n.logo || '', ab: p.ab, h: p.h, pos: POS_NAME[p.pos != null ? String(p.pos) : ''] || '' }; }) };
      delete g._atbatRaw;
    });
  }
  return games;
}
// ⚾ 경기별 박스스코어(선수 라인업+기록, 이름/사진 포함) — KBO/NPB 상세용
app.get('/api/baseball/box', async (req, res) => {
  const id = req.query.id; if (!id) return res.json({ error: 'no id' });
  const live = req.query.live === '1';
  try {
    // ⚾ 항상 실시간(detail_live) 먼저 — 경기 전 "확정 라인업"·진행중 데이터가 여기 들어옴
    //    없으면 완료경기 history 폴백
    let b = await tsLiveBox(id).catch(() => null);
    let src = b ? 'live' : '';
    if (!b) { b = await tsBox(id, live ? 20000 : 3600000); src = b ? 'history' : ''; }
    if (!b) return res.json({ available: false });
    const pids = [...new Set([...b.players.home, ...b.players.away].map(p => p.id))];
    await Promise.all(pids.map(tsName));
    const attach = arr => arr.map(p => {
      const n = TS_PNAME.get(p.id) || {};
      const posCode = p.pos != null ? String(p.pos) : '';
      return Object.assign({}, p, { name: n.name || null, name_ko: koName(p.id, n.name), photo: n.logo || '', position: POS_NAME[posCode] || n.pos || '', pitcher: p.ip != null });
    });
    res.json({ available: true, src, team: b.team, battingTeam: b.battingTeam, players: { home: attach(b.players.home), away: attach(b.players.away) } });
  } catch (e) { res.json({ error: String(e.message || e) }); }
});
// ⚾ KBO/NPB 예상 라인업 — 각 팀 직전 완료경기의 라인업(타순·수비위치·선수사진)을 예측으로 사용
app.get('/api/baseball/predlineup', async (req, res) => {
  const mid = req.query.match, date = req.query.date;
  if (!mid || !date) return res.json({ available: false });
  try {
    const dcur = await tsFetch('/baseball/match/diary', { date: String(date).replace(/-/g, '') }, 60000).catch(() => null);
    const m0 = dcur && (dcur.results || []).find(x => x.id === mid);
    if (!m0) return res.json({ available: false });
    const now = Date.now();
    // 특정 팀의 "직전 완료경기"에서 그 팀 라인업(선수배열) 찾기
    const findLast = async (teamId) => {
      for (let i = 0; i < 21; i++) {
        const ymd = new Date(Date.parse(date + 'T12:00:00Z') - i * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
        const d = await tsFetch('/baseball/match/diary', { date: ymd }, 3600000).catch(() => null);
        if (!d) continue;
        const cand = (d.results || [])
          .filter(x => (x.home_team_id === teamId || x.away_team_id === teamId) && x.id !== mid)
          .filter(x => { const t = x.match_time ? x.match_time * 1000 : 0; return x.status_id === 100 || (t && t < now - 3 * 3600e3); })
          .sort((a, b) => (b.match_time || 0) - (a.match_time || 0));
        for (const x of cand) {
          const b = await tsBox(x.id, 86400000).catch(() => null);
          if (!b) continue;
          const isHome = x.home_team_id === teamId;
          const arr = isHome ? b.players.home : b.players.away;
          if (arr && arr.length) return { arr, gameId: x.id, date: x.match_time ? x.match_time * 1000 : null };
        }
      }
      return null;
    };
    const [hL, aL] = await Promise.all([findLast(m0.home_team_id), findLast(m0.away_team_id)]);
    const homeArr = hL ? hL.arr : [], awayArr = aL ? aL.arr : [];
    const pids = [...new Set([...homeArr, ...awayArr].map(p => p.id))];
    await Promise.all(pids.map(tsName));
    const attach = arr => arr.map(p => {
      const n = TS_PNAME.get(p.id) || {};
      const posCode = p.pos != null ? String(p.pos) : '';
      return Object.assign({}, p, { name: n.name || null, name_ko: koName(p.id, n.name), photo: n.logo || '', position: POS_NAME[posCode] || n.pos || '', pitcher: p.ip != null });
    });
    res.json({
      available: !!(homeArr.length || awayArr.length), predicted: true,
      players: { home: attach(homeArr), away: attach(awayArr) },
      fromDate: { home: hL && hL.date ? new Date(hL.date).toISOString() : null, away: aL && aL.date ? new Date(aL.date).toISOString() : null }
    });
  } catch (e) { res.json({ available: false, error: String(e.message || e) }); }
});
// ⚾ KBO/NPB 선수 최근 경기 기록 — 그 선수 팀의 최근 완료경기들에서 개인 기록 추출
app.get('/api/baseball/playerlog', async (req, res) => {
  const pid = req.query.pid, mid = req.query.match, side = req.query.side, date = req.query.date;
  if (!pid || !mid || !date) return res.json({ error: 'missing params' });
  try {
    const dcur = await tsFetch('/baseball/match/diary', { date: String(date).replace(/-/g, '') }, 60000).catch(() => null);
    const m0 = dcur && (dcur.results || []).find(x => x.id === mid);
    if (!m0) return res.json({ found: false });
    const teamId = side === 'away' ? m0.away_team_id : m0.home_team_id;
    const now = Date.now(); const matches = [];
    for (let i = 0; i < 21 && matches.length < 12; i++) {
      const ymd = new Date(Date.parse(date + 'T12:00:00Z') - i * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
      const d = await tsFetch('/baseball/match/diary', { date: ymd }, 3600000).catch(() => null);
      if (!d) continue;
      const tm = {}; ((d.results_extra || {}).team || []).forEach(t => tm[t.id] = t.name);
      (d.results || []).forEach(x => {
        if (x.home_team_id !== teamId && x.away_team_id !== teamId) return;
        if (x.id === mid) return; // 현재 경기 제외
        const t = x.match_time ? x.match_time * 1000 : 0;
        const finished = x.status_id === 100 || (t && t < now - 3 * 3600e3);
        if (!finished) return;
        const isHome = x.home_team_id === teamId;
        matches.push({ id: x.id, date: t, opp: tm[isHome ? x.away_team_id : x.home_team_id] || '', isHome });
      });
    }
    matches.sort((a, b) => b.date - a.date);
    const games = [];
    for (const mm of matches.slice(0, 10)) {
      const b = await tsBox(mm.id, 86400000).catch(() => null);
      if (!b) continue;
      const arr = mm.isHome ? b.players.home : b.players.away;
      const p = (arr || []).find(x => x.id === pid);
      if (p) games.push({ date: new Date(mm.date).toISOString(), opp: mm.opp, isHome: mm.isHome, stat: p });
    }
    await tsName(pid); const nm = TS_PNAME.get(pid) || {};
    const role = games.some(g => g.stat.ip != null) ? 'pitcher' : 'batter';
    res.json({ found: games.length > 0, name: nm.name || null, name_ko: koName(pid, nm.name), photo: nm.logo || '', role, games });
  } catch (e) { res.json({ error: String(e.message || e) }); }
});
// ⚾ KBO/NPB 양팀 최근 10경기 (승패·상대·스코어) — diary 최종스코어로 계산
app.get('/api/baseball/teamrecent', async (req, res) => {
  const mid = req.query.match, date = req.query.date;
  if (!mid || !date) return res.json({ error: 'missing params' });
  try {
    const dcur = await tsFetch('/baseball/match/diary', { date: String(date).replace(/-/g, '') }, 60000).catch(() => null);
    const m0 = dcur && (dcur.results || []).find(x => x.id === mid);
    if (!m0) return res.json({ found: false });
    const tmCur = {}; ((dcur.results_extra || {}).team || []).forEach(t => tmCur[t.id] = t.name);
    const homeId = m0.home_team_id, awayId = m0.away_team_id;
    const now = Date.now(); const buckets = { [homeId]: [], [awayId]: [] }; const h2h = [];
    for (let i = 0; i < 80; i++) {
      if (buckets[homeId].length >= 10 && buckets[awayId].length >= 10 && h2h.length >= 10) break;
      const ymd = new Date(Date.parse(date + 'T12:00:00Z') - i * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
      const d = await tsFetch('/baseball/match/diary', { date: ymd }, 3600000).catch(() => null);
      if (!d) continue;
      const tm = {}; ((d.results_extra || {}).team || []).forEach(t => tm[t.id] = t.name);
      (d.results || []).forEach(x => {
        if (x.id === mid) return;
        const t = x.match_time ? x.match_time * 1000 : 0;
        const finished = x.status_id === 100 || (t && t < now - 3 * 3600e3);
        if (!finished) return;
        const ft = (x.scores || {}).ft; if (!ft) return;
        [homeId, awayId].forEach(teamId => {
          if (x.home_team_id !== teamId && x.away_team_id !== teamId) return;
          if (buckets[teamId].length >= 10) return;
          const isHome = x.home_team_id === teamId;
          const my = tsNum(ft[isHome ? 0 : 1]), op = tsNum(ft[isHome ? 1 : 0]);
          if (my == null || op == null) return;
          buckets[teamId].push({ date: t, opp: tm[isHome ? x.away_team_id : x.home_team_id] || '', ts: my, os: op, win: my > op, draw: my === op, isHome });
        });
        // 🆚 두 팀 맞대결(H2H)
        const ids = [x.home_team_id, x.away_team_id];
        if (h2h.length < 10 && ids.includes(homeId) && ids.includes(awayId)) {
          const hs = tsNum(ft[0]), as = tsNum(ft[1]);
          if (hs != null && as != null) h2h.push({ date: t, homeId: x.home_team_id, awayId: x.away_team_id, hName: tm[x.home_team_id] || '', aName: tm[x.away_team_id] || '', hs, as });
        }
      });
    }
    const sortTake = arr => arr.sort((a, b) => b.date - a.date).slice(0, 10);
    res.json({ found: true, home: { name: tmCur[homeId] || '', games: sortTake(buckets[homeId]) }, away: { name: tmCur[awayId] || '', games: sortTake(buckets[awayId]) }, h2h: sortTake(h2h) });
  } catch (e) { res.json({ error: String(e.message || e) }); }
});
// 연결 확인용 (원본 응답 전체 노출 — 에러 메시지 확인)
app.get('/api/thesports/status', async (req, res) => {
  const sport = req.query.sport || 'baseball';
  const date = (req.query.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  try {
    const d = await tsFetch(`/${sport}/match/diary`, { date }, 3000);
    res.json({ on: TS_ON, sport, code: d && d.code, count: (d && d.results || []).length, resp: d });
  } catch (e) { res.json({ on: TS_ON, sport, error: String(e.message || e) }); }
});
// 라인업 구축 타당성 종합 프로브 — 팀id 매칭 + 선수이름 소스 확인
app.get('/api/thesports/histprobe', async (req, res) => {
  try {
    const ymd = (req.query.date || new Date(Date.now() - 864e5).toISOString().slice(0, 10)).replace(/-/g, '');
    const d = await tsFetch('/baseball/match/diary', { date: ymd }, 3000);
    const ex = d.results_extra || {}; const lg = {}, tm = {};
    (ex.unique_tournament || []).forEach(u => lg[u.id] = u.name);
    (ex.team || []).forEach(t => tm[t.id] = t.name);
    const TSTAT = { 601: 'H', 602: 'E', 605: 'HR', 606: 'RBI', 608: 'BB', 609: 'K', 611: 'AB', 612: 'AVG', 677: 'R' };
    const PSTAT = { 613: 'pos', 614: 'AB', 615: 'R', 616: 'H', 617: 'RBI', 618: 'AVG', 621: 'HR', 650: 'K', 651: 'BB', 634: 'IP', 635: 'pH', 636: 'ER', 637: 'pBB', 638: 'pK', 639: 'ERA' };
    const dec = (arr, map) => { const o = {}; (arr || []).forEach(p => { if (map[p[0]] != null) o[map[p[0]]] = p[1]; }); return o; };
    const kn = (d.results || []).filter(m => /KBO|NPB|CPBL|Korea|Nippon|Japan|일본|한국|대만|Taiwan|Chinese Professional/i.test(lg[m.unique_tournament_id] || ''));
    const out = { date: ymd, knGames: kn.length, matches: [], nameLookup: {} };
    let firstPids = [];
    for (const m of kn.slice(0, 3)) {
      const row = { id: m.id, league: lg[m.unique_tournament_id], home: tm[m.home_team_id], away: tm[m.away_team_id], status: m.status_id };
      try {
        const h = await tsFetch('/baseball/match/live/history', { uuid: m.id }, 4000);
        const r = h.results || {};
        // 팀 통계 decode: stats = [[type, [[code,home,away],...]]]
        const full = (r.stats || []).find(s => s[0] === 0);
        if (full) { const ts = { home: {}, away: {} }; (full[1] || []).forEach(c => { const k = TSTAT[c[0]]; if (k) { ts.home[k] = c[1]; ts.away[k] = c[2]; } }); row.teamStats = ts; }
        row.playersHome = (r.players && r.players.home || []).length;
        row.playersAway = (r.players && r.players.away || []).length;
        const ph = (r.players && r.players.home) || [];
        row.playerSample = ph.slice(0, 3).map(p => ({ id: p.id, stat: dec(p.stats, PSTAT) }));
        firstPids.push(...ph.slice(0, 4).map(p => p.id));
      } catch (e) { row.histErr = String(e.message || e); }
      out.matches.push(row);
    }
    // 선수 이름/사진 resolve
    for (const pid of [...new Set(firstPids)].slice(0, 4)) {
      try { const r = await tsFetch('/baseball/player/list', { uuid: pid }, 4000); const p = (r.results || [])[0]; out.nameLookup[pid] = p ? { name: p.name, logo: p.logo, position: p.position } : { empty: true, code: r.code }; }
      catch (e) { out.nameLookup[pid] = { error: String(e.message || e) }; }
    }
    res.json(out);
  } catch (e) { res.json({ error: String(e.message || e) }); }
});
app.get('/api/thesports/lineupbuild', async (req, res) => {
  try {
    const ymd = (req.query.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const d = await tsFetch('/baseball/match/diary', { date: ymd }, 3000);
    const ex = d.results_extra || {}; const lg = {}, tm = {};
    (ex.unique_tournament || []).forEach(u => lg[u.id] = u.name);
    (ex.team || []).forEach(t => tm[t.id] = t.name);
    // KBO·NPB 경기만 골라 홈/원정 팀 전수 스캔
    const kn = (d.results || []).filter(m => /KBO|NPB|CPBL|Korea|Nippon|Japan|일본|한국|대만|Taiwan|Chinese Professional/i.test(lg[m.unique_tournament_id] || ''));
    const seen = new Set(); const teamRows = [];
    for (const m of kn) {
      for (const side of ['home_team_id', 'away_team_id']) {
        const tid = m[side]; if (!tid || seen.has(tid)) continue; seen.add(tid);
        const row = { league: lg[m.unique_tournament_id], team_uuid: tid, diaryName: tm[tid] || null };
        // 팀 로스터
        try { const r = await tsFetch('/baseball/team/squad/list', { uuid: tid }, 4000); const sq = (r.results || [])[0]; row.squadCount = sq && sq.squad ? sq.squad.length : 0; row.squadSample = sq && sq.squad ? sq.squad.slice(0, 2) : null; }
        catch (e) { row.squadErr = String(e.message || e); }
        // 팀 이름
        try { const r = await tsFetch('/baseball/team/list', { uuid: tid }, 4000); const t = (r.results || [])[0]; row.teamListName = t ? (t.name || t.short_name) : null; row.teamListErr = t ? null : (r.code === 0 ? 'empty' : r.code); }
        catch (e) { row.teamListErr = String(e.message || e); }
        teamRows.push(row);
        if (teamRows.length >= 12) break;
      }
      if (teamRows.length >= 12) break;
    }
    // 시즌 통계(BB) — 각 리그 대표 season_id 로 확인
    const stats = {}; const seasons = [...new Set(kn.map(m => m.season_id).filter(Boolean))].slice(0, 3);
    for (const sid of seasons) {
      for (const p of ['/baseball/season/team/stats/detail', '/baseball/season/player/stats/detail']) {
        try { const r = await tsFetch(p, { uuid: sid }, 4000); stats[p + ' @' + sid] = { code: r.code, total: r.query && r.query.total, count: (r.results || []).length, sample: (r.results || [])[0] || null }; }
        catch (e) { stats[p + ' @' + sid] = { error: String(e.message || e) }; }
      }
    }
    // 선수 이름 소스 확인 (roster 에서 첫 player_id 뽑아)
    let playerSample = null; const firstPid = teamRows.map(r => r.squadSample && r.squadSample[0] && r.squadSample[0].player_id).find(Boolean);
    if (firstPid) { try { const r = await tsFetch('/baseball/player/list', { uuid: firstPid }, 4000); playerSample = (r.results || [])[0] || null; } catch (e) { playerSample = { error: String(e.message || e) }; } }
    res.json({ date: ymd, knGames: kn.length, teamRows, stats, playerSample });
  } catch (e) { res.json({ error: String(e.message || e) }); }
});
// KBO 선수 전수 수집 (id + 영문명) — 한글 매핑 구축용. 최근 N일 경기 스캔
app.get('/api/thesports/kboplayers', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || '7', 10), 14);
    const pids = new Set(); const teamOf = {};
    for (let i = 0; i < days; i++) {
      const ymd = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
      const d = await tsFetch('/baseball/match/diary', { date: ymd }, 3600000).catch(() => null);
      if (!d) continue;
      const ex = d.results_extra || {}; const lg = {}, tm = {};
      (ex.unique_tournament || []).forEach(u => lg[u.id] = u.name);
      (ex.team || []).forEach(t => tm[t.id] = t.name);
      const kbo = (d.results || []).filter(m => /KBO|Korea/i.test(lg[m.unique_tournament_id] || ''));
      for (const m of kbo) {
        const b = await tsBox(m.id, 3600000).catch(() => null);
        if (!b) continue;
        b.players.home.forEach(p => { pids.add(p.id); teamOf[p.id] = tm[m.home_team_id] || ''; });
        b.players.away.forEach(p => { pids.add(p.id); teamOf[p.id] = tm[m.away_team_id] || ''; });
      }
    }
    const ids = [...pids];
    await Promise.all(ids.map(tsName));
    const out = ids.map(id => { const n = TS_PNAME.get(id) || {}; return { id, name: n.name || null, team: teamOf[id] || '' }; }).filter(x => x.name);
    out.sort((a, b) => (a.team + a.name).localeCompare(b.team + b.name));
    res.json({ count: out.length, players: out });
  } catch (e) { res.json({ error: String(e.message || e) }); }
});
// 진행중 경기 실시간 선수/통계 유무 확인 — detail_live 검사
app.get('/api/thesports/liveprobe', async (req, res) => {
  try {
    const lv = await tsFetch('/baseball/match/detail_live', {}, 3000);
    const rows = (lv.results || []).slice(0, 8).map(m => {
      const b = tsDecodeBox(m);
      return { id: Array.isArray(m.score) ? m.score[0] : m.id, status: Array.isArray(m.score) ? m.score[1] : null, teamBB: { home: b.team.home.bb, away: b.team.away.bb }, playersHome: b.players.home.length, playersAway: b.players.away.length, sample: b.players.home[0] || null };
    });
    res.json({ total: (lv.results || []).length, rows });
  } catch (e) { res.json({ error: String(e.message || e) }); }
});
// 원시 응답 확인용 (필드 매핑 점검) — /api/thesports/raw?sport=baseball
app.get('/api/thesports/raw', async (req, res) => {
  const sport = req.query.sport || 'baseball';
  const ymd = (req.query.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  try {
    const d = await tsFetch(`/${sport}/match/diary`, { date: ymd }, 3000);
    const lv = await tsFetch(`/${sport}/match/detail_live`, {}, 3000).catch(() => ({}));
    const ex = d.results_extra || {};
    res.json({
      code: d.code, total: d.query && d.query.total,
      allLeagues: (ex.unique_tournament || []).map(u => u.name),
      diarySample: (d.results || []).slice(0, 1),
      liveSample: (lv.results || []).slice(0, 2)
    });
  } catch (e) { res.json({ error: String(e.message || e) }); }
});

// 경기 목록 생성 (정규화 + MLB 실시간 덮어쓰기) — 라우트/푸시 스케줄러 공용
// ⚽ 축구=API-Sports(유료) · ⚾ MLB계열=StatsAPI · ⚾ KBO/NPB=TheSports(유료)
// ISO 시각 → 특정 타임존의 YYYY-MM-DD (뷰어 로컬 날짜 판정용)
function ymdInTz(iso, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
  catch { return String(iso || '').slice(0, 10); }
}
// 팀 닉네임(마지막 유의미 단어) 추출 — 소스별 팀명 표기 차이 흡수용 (예: "Rakuten Gold. Eagles"→"eagles")
function nkLast(name) {
  const toks = String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  return toks.length ? toks[toks.length - 1] : '';
}
const _lastGoodBB = new Map();   // 야구 간헐적 사라짐 방지용 직전 정상빌드 캐시
const _lastGoodMinor = new Map();   // 배구·농구·하키 등 간헐적 사라짐 방지용 직전 정상빌드 캐시
// 🔌 TheSports 서킷브레이커: 특정 종목이 2회 연속 빈응답이면 TS_CB_COOLDOWN 동안 TheSports 시도를 건너뛰고
//   바로 폴백(API-Sports/Goalserve)로 → "빈응답인데도 매번 6초 시도"하던 지연 제거. 복구되면 자동 재시도.
const _tsFail = new Map(), _tsOpenUntil = new Map();
const TS_CB_FAILS = 2, TS_CB_COOLDOWN = 180000;   // 2회 연속 빈응답 → 3분 차단
function tsCircuitOpen(sport) { const u = _tsOpenUntil.get(sport); return !!(u && Date.now() < u); }
function tsCircuitNote(sport, gotGames) {
  if (gotGames) { _tsFail.set(sport, 0); _tsOpenUntil.delete(sport); return; }
  const n = (_tsFail.get(sport) || 0) + 1; _tsFail.set(sport, n);
  if (n >= TS_CB_FAILS) { _tsOpenUntil.set(sport, Date.now() + TS_CB_COOLDOWN); METRICS.supplier.tsFail++; }
}

// ============================================================
//  🏀 Goalserve 농구 — 라이브 쿼터 + 시계(timer) 제공 (API-Sports 대체)
//  · getfeed 키 기반(IP 잠금 아님). home/d-1/d1 3일치 받아 기기 타임존으로 필터
//  · game 객체 shape를 normAS 농구와 동일하게 맞춤(status/period/timer/setScores/hs/as)
// ============================================================
const GOALSERVE_KEY = (process.env.GOALSERVE_KEY || '063b89c0de9d4078431908df2595d029').trim();
const GSA = (o, k) => { if (!o) return undefined; if (o['@' + k] !== undefined) return o['@' + k]; if (o[k] !== undefined && typeof o[k] !== 'object') return o[k]; return undefined; };
const GSARR = x => Array.isArray(x) ? x : (x ? [x] : []);
function gsBskShort(st) {
  const s = String(st || '').toLowerCase();
  if (/1st q/.test(s)) return 'Q1';
  if (/2nd q/.test(s)) return 'Q2';
  if (/3rd q/.test(s)) return 'Q3';
  if (/4th q/.test(s)) return 'Q4';
  if (/after over time/.test(s)) return 'FT';
  if (/overtime/.test(s)) return 'OT';
  if (/half ?time/.test(s)) return 'HT';
  if (/break/.test(s)) return 'BT';
  if (/not started/.test(s)) return 'NS';
  if (/finished|\bend\b|\bft\b/.test(s)) return 'FT';
  if (/postponed/.test(s)) return 'PST';
  if (/cancel/.test(s)) return 'CANC';
  if (/abandon/.test(s)) return 'ABD';
  if (/suspend|interrupt|delay/.test(s)) return 'SUSP';
  if (/awarded|walk ?over/.test(s)) return 'AWD';
  return (st || '').trim();
}
const GS_LG_ACRONYMS = ['NBA', 'WNBA', 'NBL', 'KBL', 'WKBL', 'NCAA', 'CBA', 'BBL', 'PBA', 'MPBL', 'NBDL', 'ABA', 'KBSL', 'BSL', 'VTB', 'ACB', 'LNB', 'BNXT', 'FIBA', 'EASL', 'U18', 'U19', 'U16', 'W'];
function gsPrettyLeague(name) {
  let s = String(name || '').trim();
  if (!s) return s;
  // 각 단어가 약어면 대문자로 (예: "Nba"→"NBA", "Nbl"→"NBL", "Kbl Basket League"→"KBL Basket League")
  s = s.split(/\s+/).map(w => {
    const up = w.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return GS_LG_ACRONYMS.includes(up) ? w.toUpperCase() : w;
  }).join(' ');
  return s;
}
function gsIso(d, tm) {   // d="22.11.2023"(UTC) tm="01:00" → ISO UTC
  if (!d) return null;
  const p = String(d).split('.'); if (p.length < 3) return null;
  const dd = p[0].padStart(2, '0'), mo = p[1].padStart(2, '0'), yy = p[2];
  let hh = '00', mi = '00'; const tp = String(tm || '').split(':');
  if (tp.length >= 2 && /^\d/.test(tp[0])) { hh = tp[0].padStart(2, '0'); mi = tp[1].padStart(2, '0'); }
  return `${yy}-${mo}-${dd}T${hh}:${mi}:00Z`;
}
async function gsBasketballGames(date, tz) {
  tz = canonTz(tz);
  const base = `https://www.goalserve.com/getfeed/${GOALSERVE_KEY}/bsktbl`;
  const feeds = ['d-1', 'home', 'd1'];   // 전날/오늘/다음날(UTC) → 기기 타임존 날짜로 필터
  const out = []; const seen = new Set();
  const numOrNull = v => (v === '' || v == null) ? null : (isNaN(+v) ? null : +v);
  for (const f of feeds) {
    let j; try { j = await cachedJSON(`${base}/${f}?json=1`, 9000); } catch { continue; }
    const cats = GSARR(j && j.scores && j.scores.category);
    for (const c of cats) {
      const rawName = GSA(c, 'name') || '';
      // 🚫 e스포츠/시뮬레이션 농구(Ebasketball, GG League, 4x5mins, Cyber 등) 제외 — 실제 경기만
      if (/e-?basketball|\bgg league\b|\b4x5\b|cyber|simulated|esports/i.test(rawName)) continue;
      const country = rawName.includes(':') ? rawName.split(':')[0].trim() : '';
      let league = rawName.includes(':') ? rawName.split(':').slice(1).join(':').trim() : rawName;
      league = gsPrettyLeague(league);
      for (const m of GSARR(c.match)) {
        const id = 'gs' + (GSA(m, 'id') || '');
        if (seen.has(id)) continue;
        const stRaw = GSA(m, 'status') || '';
        const short = gsBskShort(stRaw);
        const lt = m.localteam, at = m.visitorteam || m.awayteam;
        const hsN = numOrNull(GSA(lt, 'totalscore')), asN = numOrNull(GSA(at, 'totalscore'));
        const iso = gsIso(GSA(m, 'date'), GSA(m, 'time'));
        const qn = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, OT: 5 }[short] || null;
        // §3: 미진행 쿼터·OT의 0:0 자동생성 방지 — TheSports 분기와 동일하게 '시작된 기간까지만' 표시.
        //   예정/확인중(비live·비finished)은 쿼터 미표시. 실제 득점이 있는 기간 또는 진행 중 현재 기간까지만.
        const _stNow = asState(short, hsN);
        const _hq = ['q1', 'q2', 'q3', 'q4', 'ot'].map(k => GSA(lt, k));
        const _aq = ['q1', 'q2', 'q3', 'q4', 'ot'].map(k => GSA(at, k));
        let _lastPlayed = 0;
        for (let i = 0; i < _hq.length; i++) { if ((numOrNull(_hq[i]) || 0) > 0 || (numOrNull(_aq[i]) || 0) > 0) _lastPlayed = i + 1; }
        const _showN = (_stNow === 'live' || _stNow === 'finished') ? Math.max(_lastPlayed, (_stNow === 'live' && qn) ? qn : 0) : 0;
        const setScores = [];
        for (let i = 0; i < _showN; i++) { const h = _hq[i], a = _aq[i]; setScores.push({ home: (h != null && h !== '') ? numOrNull(h) : null, away: (a != null && a !== '') ? numOrNull(a) : null }); }
        const tmr = GSA(m, 'timer');
        const htid = GSA(lt, 'id'), atid = GSA(at, 'id');
        const g = {
          id, league, leagueLogo: '', country,
          home: GSA(lt, 'name') || '', homeLogo: '', away: GSA(at, 'name') || '', awayLogo: '',
          homeTid: htid, awayTid: atid,
          hs: hsN, as: asN, status: short, statusLong: stRaw,
          period: qn, timer: (tmr != null && tmr !== '') ? String(tmr) : null,
          livePts: null, setScores: setScores.length ? setScores : null, box: null, curInning: null, inningHalf: null,
          date: iso, state: asState(short, hsN), _src: 'goalserve'
        };
        if (iso && ymdInTz(iso, tz) !== date) continue;   // 기기 타임존 날짜만
        seen.add(id); out.push(g);
      }
    }
  }
  // 🏀 팀 로고 붙이기 — 캐시에 있으면 바로 URL, 없으면 백그라운드로 받아둠(경기 응답은 안 막힘).
  //    로고 API가 '초당 1회' 제한이라 한 번에 많이 부르면 일부가 막힘 → gsTeamLogos가 묶음마다 간격을 둠.
  try {
    const now = Date.now();
    out.forEach(g => {
      const h = g.homeTid && _gsLogoCache.get(String(g.homeTid)); if (h && h.exp > now && (h.b64 || h.url)) g.homeLogo = '/api/gs/logo/' + g.homeTid;
      const a = g.awayTid && _gsLogoCache.get(String(g.awayTid)); if (a && a.exp > now && (a.b64 || a.url)) g.awayLogo = '/api/gs/logo/' + g.awayTid;
    });
    const uncached = [...new Set(out.flatMap(g => [g.homeTid, g.awayTid]).filter(Boolean).map(String))]
      .filter(id => { const h = _gsLogoCache.get(id); return !(h && h.exp > now); });
    if (uncached.length && !_gsLogoFetching) { _gsLogoFetching = true; gsTeamLogos(uncached).catch(() => {}).finally(() => { _gsLogoFetching = false; }); }
  } catch {}
  return out;
}
let _gsLogoFetching = false;

// 🏀 Goalserve 팀 로고 — 팀 ID로 조회. 응답은 [{id, base64}] 형태(PNG base64). URL 형태도 대비해 수용. 장기 캐시.
const _gsLogoCache = new Map();   // id → { b64, url, exp }
const GS_LOGO_TTL = 24 * 3600 * 1000;      // 로고 있으면 24시간 캐시
const GS_LOGO_RETRY = 10 * 60 * 1000;      // 못 찾음/실패는 10분 뒤 재시도
function gsParseLogos(data) {
  const map = {};
  const pid = o => o && (o.id ?? o['@id'] ?? o.team_id ?? o.teamId ?? o.entity_id);
  const pb64 = o => o && (o.base64 ?? o['@base64'] ?? o.img64 ?? o.logo64);
  const purl = o => o && (o.url || o.logo || o.image || o.src || o.path || o['@url']);
  const add = o => { const id = pid(o); if (id == null) return; const b = pb64(o), u = purl(o); if (b) map[String(id)] = { b64: String(b) }; else if (u && typeof u === 'string') map[String(id)] = { url: u }; };
  if (Array.isArray(data)) data.forEach(add);
  else if (data && typeof data === 'object') {
    const arr = data.teams || data.data || data.logos || data.result || data.logotips || (data.scores && data.scores.team);
    if (Array.isArray(arr)) arr.forEach(add);
    else Object.values(data).forEach(v => { if (v && typeof v === 'object') add(v); });
  }
  return map;
}
async function gsTeamLogos(ids) {
  const now = Date.now(); const have = new Set(); const need = [];
  for (const id of ids) { const h = _gsLogoCache.get(id); if (h && h.exp > now) { if (h.b64 || h.url) have.add(String(id)); } else need.push(id); }
  for (let i = 0; i < need.length; i += 50) {
    if (i > 0) await new Promise(r => setTimeout(r, 1200));   // 로고 API '초당 1회' 제한 준수 (묶음 간 간격)
    const chunk = need.slice(i, i + 50);
    try {
      const url = `http://data2.goalserve.com:8084/api/v1/logotips/basketball/teams?k=${GOALSERVE_KEY}&ids=${chunk.join(',')}`;
      const data = await cachedJSON(url, GS_LOGO_TTL);
      const m = gsParseLogos(data);
      chunk.forEach(id => { const e = m[String(id)]; if (e && (e.b64 || e.url)) { _gsLogoCache.set(String(id), { b64: e.b64 || '', url: e.url || '', exp: now + GS_LOGO_TTL }); have.add(String(id)); } else { _gsLogoCache.set(String(id), { b64: '', url: '', exp: now + GS_LOGO_RETRY }); } });
    } catch { chunk.forEach(id => _gsLogoCache.set(String(id), { b64: '', url: '', exp: now + GS_LOGO_RETRY })); }
  }
  return have;
}

// 🏀 TheSports 농구 — 초단위 시계(detail_live) + 쿼터별 점수 + 라인업. (KBL/NBA/NCAA 등 커버)
//   상태코드: 1=예정, 2/4/6/8=1~4쿼터 진행, 3/5/7=쿼터 종료(휴식), 9=연장, 10=종료, 12=취소
const TS_BSK_PER = { 2: 1, 3: 1, 4: 2, 5: 2, 6: 3, 7: 3, 8: 4, 9: 5, 13: 5 };
function tsBskState(st) { if (st === 1 || st === 15 || st === 0) return 'scheduled'; if (st === 10 || st === 12) return 'finished'; return 'live'; }
function fmtClockSec(sec) { sec = Math.max(0, Math.round(+sec || 0)); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
// detail_live.tlive(플레이바이플레이) 파싱 → 이벤트 배열 + 현재기간 팀파울 + 전후반/쿼터 판별
//  이벤트 라인 형식(^ 구분): [기간(0-base), "MM:SS", 팀(1=홈·2=원정), ?, "원정-홈 점수", 설명, ...]
function tsBskParseEvents(lv) {
  let lines = [];
  const tl = lv && lv.tlive;
  if (Array.isArray(tl) && tl.length) lines = Array.isArray(tl[0]) ? tl[0] : tl;
  const evs = [];
  lines.forEach(L => {
    const s = String(L).split('^');
    const text = s[5] || ''; if (!text) return;
    const sc = String(s[4] || '').split('-');   // "원정-홈"
    // 시계 필드는 두 형태: "MM:SS"(1분 이상) 또는 "SS.t"(1분 미만 남은 초, 예: 33.1 = 33초). 표시용 MM:SS 로 정규화.
    let raw = String(s[1] || '').trim(), clk = raw;
    if (/^\d{1,2}:\d{2}$/.test(raw)) { clk = raw; }
    else if (/^\d+(\.\d+)?$/.test(raw)) { const sec = Math.min(59, Math.round(parseFloat(raw))); clk = '0:' + (sec < 10 ? '0' : '') + sec; }
    evs.push({ clock: clk, rawClock: raw, team: +s[2] || 0, away: (sc[0] !== undefined ? +sc[0] : null), home: (sc[1] !== undefined ? +sc[1] : null), text });
  });
  return evs;   // 오래된→최신 순
}
function tsBskLiveInfo(lv) {
  const evs = tsBskParseEvents(lv);
  if (!evs.length) return null;
  // 쿼터/하프 판별: play-by-play 경계 텍스트 기준(임의 시간 해석 금지)
  let sawQuarter = false, sawHalf = false;
  evs.forEach(e => { if (/quarter/i.test(e.text)) sawQuarter = true; if (/\bhalf\b/i.test(e.text) && /(end|start|of the|time)/i.test(e.text)) sawHalf = true; });
  const isHalves = sawHalf && !sawQuarter;
  // 현재 기간 번호: 마지막 "End of the Nth Quarter/Half" → N+1, 연장은 그 뒤로
  const boundRe = /end of the (\d+)(?:st|nd|rd|th)?\s+(quarter|half|period)/i;
  const reg = isHalves ? 2 : 4;
  let curP = null, otCount = 0;
  evs.forEach(e => { const m = e.text.match(boundRe); if (m) curP = parseInt(m[1], 10) + 1; if (/end of (?:overtime|ot)/i.test(e.text)) { otCount++; curP = reg + otCount + 1; } });
  // 현재 기간 팀파울: 기간 경계에서 리셋 후, 팀파울에 포함되는 파울만 팀 필드(1=홈/2=원정)로 집계
  const foulRe = /\b(personal|shooting|loose ball|offensive)\s+foul\b|\bfoul\s+(?:on|by)\b/i;
  const resetRe = /end of the .*\b(quarter|half|period)\b|end of (?:overtime|ot)/i;
  let hf = 0, af = 0;
  evs.forEach(e => { if (resetRe.test(e.text)) { hf = 0; af = 0; return; } if (foulRe.test(e.text)) { if (e.team === 1) hf++; else if (e.team === 2) af++; } });
  return { curP, isHalves, hf, af, events: evs };
}
async function tsBasketballGames(date, tz) {
  tz = canonTz(tz);
  const toYmd = d => String(d).replace(/-/g, '');
  const prev = new Date(Date.parse(date + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
  const next = new Date(Date.parse(date + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  const comp = {}, team = {}, out = [], seen = new Set();
  let liveMap = {};
  try { const lv = await tsFetch('/basketball/match/detail_live', {}, 3000); ((lv && lv.results) || []).forEach(r => { const id = r.id || (r.score && r.score[0]); if (id) liveMap[id] = r; }); } catch (e) {}
  // 🚑 3일치 diary를 병렬 조회(순차 시 느린 공급사에서 3배 지연 → 멈춤). 각 호출은 cachedJSON 요청 타임아웃(6s)으로 상한.
  const _diaries = await Promise.all([prev, date, next].map(dt => tsFetch('/basketball/match/diary', { date: toYmd(dt) }, 8000).catch(() => null)));
  for (const d of _diaries) {
    if (!d) continue;
    const ex = (d && d.results_extra) || {};
    (ex.competition || []).forEach(c => { comp[c.id] = { name: c.name, logo: c.logo || '' }; });
    (ex.team || []).forEach(t => { team[t.id] = { name: t.name, logo: t.logo || '' }; });
    for (const m of (d && d.results) || []) {
      const id = m.id; if (!id || seen.has(id)) continue;
      const iso = m.match_time ? new Date(m.match_time * 1000).toISOString() : null;
      if (iso && ymdInTz(iso, tz) !== date) continue;
      seen.add(id);
      const hc = comp[m.competition_id] || {}, ht = team[m.home_team_id] || {}, at = team[m.away_team_id] || {};
      let st = m.status_id;
      let hsArr = m.home_scores || [], asArr = m.away_scores || [];
      let hs = hsArr.reduce((a, b) => a + (+b || 0), 0), as = asArr.reduce((a, b) => a + (+b || 0), 0);
      let timerSec = null, timerRun = 0, timerUpd = 0;
      const lv = liveMap[id];
      if (lv) {
        if (lv.score) { if (lv.score[1] != null) st = lv.score[1]; const hq = lv.score[3] || [], aq = lv.score[4] || []; if (hq.length) { hsArr = hq; asArr = aq; hs = hq.reduce((a, b) => a + (+b || 0), 0); as = aq.reduce((a, b) => a + (+b || 0), 0); } }
        if (lv.timer) { timerRun = lv.timer[0]; timerUpd = lv.timer[2]; timerSec = lv.timer[3]; }
      }
      // 진행 경기: detail_live 의 tlive(플레이바이플레이)로 현재기간·전후반/쿼터·현재기간 팀파울을 산출(추가 호출 없음)
      const info = (lv && tsBskState(st) === 'live') ? tsBskLiveInfo(lv) : null;
      const statePer = TS_BSK_PER[st] || null;            // status_id → 현재 기간(가장 신뢰, 쿼터제 기준)
      const isHalves = info ? info.isHalves : false;
      // 기간 번호: 쿼터제는 status_id 우선, 하프제(대학 등)는 play-by-play 경계 우선
      const curPeriod = isHalves ? (info && info.curP != null ? info.curP : statePer) : (statePer || (info && info.curP != null ? info.curP : null));
      // 시작된 기간까지만 쿼터표시(미시작 기간의 0:0 제거). curPeriod 모르면 '득점 있는 마지막 기간'까지.
      let lastPlayed = 0;
      for (let i = 0; i < Math.max(hsArr.length, asArr.length); i++) { if ((+hsArr[i] || 0) > 0 || (+asArr[i] || 0) > 0) lastPlayed = i + 1; }
      const showN = Math.max(lastPlayed, (tsBskState(st) === 'live' && curPeriod) ? curPeriod : 0);
      const setScores = [];
      for (let i = 0; i < showN; i++) { const h = hsArr[i], a = asArr[i]; setScores.push({ home: (h != null && h !== '') ? +h : null, away: (a != null && a !== '') ? +a : null }); }
      const periodLabel = curPeriod ? (isHalves ? (curPeriod <= 2 ? 'H' + curPeriod : 'OT' + (curPeriod - 2)) : (curPeriod <= 4 ? 'Q' + curPeriod : 'OT' + (curPeriod - 4))) : '';
      // 팀파울: play-by-play가 '현재 기간'까지 도달했을 때만 신뢰(더스포츠 NBA tlive가 점수보다 지연될 수 있어, 지연 시 0으로 단정하지 않고 null)
      let foulsOk = false;
      if (info) { if (isHalves) foulsOk = info.curP != null; else foulsOk = (info.curP != null && (statePer ? info.curP >= statePer : true)); }
      out.push({
        id: 'ts' + id, tsid: id, league: tsLeagueDisplay('basketball', hc.name) || 'Basketball', leagueOrig: hc.name || '', leagueLogo: hc.logo || '', country: '',
        home: ht.name || '', homeLogo: ht.logo || '', away: at.name || '', awayLogo: at.logo || '',
        homeTid: m.home_team_id, awayTid: m.away_team_id,
        hs, as, status: periodLabel, statusLong: String(st),
        period: curPeriod, periodLabel, isHalves,
        homeFouls: foulsOk ? info.hf : null, awayFouls: foulsOk ? info.af : null,   // 현재 기간 팀파울(확인 가능할 때만, 아니면 null=미표시)
        timer: (timerSec != null && tsBskState(st) === 'live') ? fmtClockSec(timerSec) : null,
        timerSec: (tsBskState(st) === 'live') ? timerSec : null, timerRun, timerUpd,
        livePts: null, setScores: setScores.length ? setScores : null, box: null, curInning: null, inningHalf: null,
        date: iso, state: tsBskState(st), _src: 'thesports'
      });
    }
  }
  return out;
}
// TheSports 농구 선수 기록 디코드. stat 문자열(^ 구분) 인덱스는 실데이터로 검증:
//  0=출전분, 1=야투(성공-시도), 2=3점, 3=자유투, 4=공격리바, 5=수비리바, 6=리바운드,
//  7=어시스트, 8=스틸, 9=블록, 10=턴오버, 11=개인파울, 13=득점  (득점 합 = 팀 점수로 검증 완료)
function tsBskPlayer(p) {
  const s = String(p[4] || '').split('^');
  const pair = x => { const v = String(x || '0-0').split('-'); return (+v[0] || 0) + '-' + (+v[1] || 0); };
  const n = i => +s[i] || 0;
  return { id: p[0], name: String(p[1] || '').trim(), photo: p[2] || '', number: p[3] || '',
    min: n(0), fg: pair(s[1]), p3: pair(s[2]), ft: pair(s[3]),
    oreb: n(4), dreb: n(5), reb: n(6), ast: n(7), stl: n(8), blk: n(9), to: n(10), pf: n(11), pts: n(13),
    // s[16]: 선발 구분(0=선발, 1=벤치) — 실데이터 검증. 필드 없으면 null.
    starter: (s.length > 16 ? (String(s[16]) === '0') : null) };
}
// 🏀 종료(및 진행) 경기 완전 데이터 — TheSports /basketball/match/live/history (종료 후에도 지속).
//   box(선발/BLK/STL/사진) + tlive(플레이바이플레이·슛좌표) + 쿼터점수. 라이브 전용 lineup_live/detail_live 와 별개.
async function tsBskHistory(tsid) {
  const r = await tsFetch('/basketball/match/live/history', { uuid: tsid }, 1800000).catch(() => null); // 종료경기 1회→30분 캐시
  const item = r && r.results; if (!item || !item.players) return null;
  const pl = item.players;
  const mk = arr => (arr || []).filter(x => Array.isArray(x)).map(tsBskPlayer);
  const home = mk(pl[0]), away = mk(pl[1]);
  if (!home.length && !away.length) return null;
  // tlive: [[q1events...],[q2...],...]. 이벤트 문자열 "period^clock^team^?^away-home^text^pids^isShot^made^pts^x,y"
  const flow = [], shots = [];
  const tl = item.tlive || [];
  for (const q of tl) {
    for (const s of (q || [])) {
      const f = String(s).split('^');
      const sc = String(f[4] || '0-0').split('-'); const away2 = +sc[0] || 0, home2 = +sc[1] || 0;
      const xy = String(f[10] || '').split(','); const x = xy[0] !== '' ? +xy[0] : null, y = xy[1] != null && xy[1] !== '' ? +xy[1] : null;
      const ev = { period: +f[0] || 0, clock: f[1] || '', team: (f[2] === '1' ? 'home' : 'away'),
        home: home2, away: away2, text: f[5] || '', pids: f[6] || '', isShot: (f[7] === '1'), made: (f[8] === '1'), pts: +f[9] || 0, x, y };
      flow.push(ev);
      if (ev.isShot && x != null && y != null) shots.push({ period: ev.period, team: ev.team, made: ev.made, x, y, pt: /3pt|3-pt/i.test(ev.text) ? 3 : 2, text: ev.text, pid: (ev.pids.split(',')[0] || '') });
    }
  }
  const sc = item.score || []; const hq = sc[3] || [], aq = sc[4] || [];
  const byPts = (a, b) => (b.pts - a.pts) || (b.min - a.min);
  const stH = home.filter(p => p.starter).length, stA = away.filter(p => p.starter).length;
  return { id: tsid, home: home.sort(byPts), away: away.sort(byPts),
    homePts: home.reduce((a, b) => a + b.pts, 0), awayPts: away.reduce((a, b) => a + b.pts, 0),
    hasStarters: (stH === 5 && stA === 5), source: 'history',
    flow: flow.reverse().slice(0, 300), shots, quarters: { home: hq, away: aq } };
}
async function tsBasketballLineup(tsid) {
  // lineup_live 는 (uuid 를 줘도) 여러 경기를 배열로 반환 → 반드시 요청한 경기 id 와 일치하는 항목만 사용.
  //  일치 항목이 없으면 null(= 이 경기 라인업 미제공). 절대 res[0](다른 경기)로 대체하지 않음.
  const r = await tsFetch('/basketball/match/lineup_live', { uuid: tsid }, 8000).catch(() => null);
  const res = r && r.results; if (!res) return null;
  const list = Array.isArray(res) ? res : [res];
  const item = list.find(x => x && String(x.id) === String(tsid));
  if (!item) return null;
  const pl = item.players; if (!pl || !pl.length) return null;
  const mk = arr => (arr || []).filter(x => Array.isArray(x)).map(tsBskPlayer);
  const home = mk(pl[0]), away = mk(pl[1]);
  if (!home.length && !away.length) return null;
  const byPts = (a, b) => (b.pts - a.pts) || (b.min - a.min);   // 득점순(공급사 선발 플래그 미제공 → 임의 선발분류 안 함)
  return { id: item.id, home: home.sort(byPts), away: away.sort(byPts),
    homePts: home.reduce((a, b) => a + b.pts, 0), awayPts: away.reduce((a, b) => a + b.pts, 0) };
}
// 🗄️ 박스/흐름 스냅샷: TheSports detail_live/lineup_live 는 라이브 중에만 제공 → 라이브 때 받아두고,
//   종료 후 비면 마지막 정상 스냅샷을 반환(명령서 ②-8 '종료 후 박스·이벤트 유지'). fromSnapshot 플래그로 구분.
const _bskSnap = new Map();
function _snapSet(k, v) {
  _bskSnap.set(k, { v, t: Date.now() });
  if (_bskSnap.size > 400) { const now = Date.now(); for (const [kk, vv] of _bskSnap) { if (now - vv.t > 21600000) _bskSnap.delete(kk); } }
  // 영속: 종료 후/재시작 후에도 유지. 실패해도 메모리 스냅샷은 유효.
  if (bskSnapCol) bskSnapCol.updateOne({ _id: k }, { $set: { v, at: new Date() } }, { upsert: true }).catch(() => {});
}
// 메모리 우선, 없으면 Mongo에서 복원(재시작 직후 등). 반환형은 { v, t } 또는 null.
async function _snapGet(k) {
  const m = _bskSnap.get(k); if (m) return m;
  if (!bskSnapCol) return null;
  try { const d = await bskSnapCol.findOne({ _id: k }); if (d && d.v) { const rec = { v: d.v, t: (d.at ? +new Date(d.at) : Date.now()) }; _bskSnap.set(k, rec); return rec; } } catch (e) {}
  return null;
}
app.get('/api/basketball/lineup', async (req, res) => {
  const raw = String(req.query.id || '');
  if (!raw) return res.status(400).json({ error: 'need id' });
  // 박스스코어/라인업은 더스포츠(초단위) 경기(id 가 'ts' 접두)만 제공. 타 공급사 경기에 다른 경기 데이터를 대신 표시하지 않음.
  if (!/^ts/.test(raw)) return res.json({ home: [], away: [], note: 'not-thesports' });
  const id = raw.replace(/^ts/, '');
  try {
    const lu = await tsBasketballLineup(id);
    const has = lu && ((lu.home && lu.home.length) || (lu.away && lu.away.length));
    if (has) { _snapSet('box|' + id, lu); return res.json(lu); }
    // 🏀 라이브 lineup_live 비면(= 종료 경기) → live/history 로 완전 박스(선발/BLK/STL) 복원
    const hist = await tsBskHistory(id).catch(() => null);
    if (hist && ((hist.home && hist.home.length) || (hist.away && hist.away.length))) {
      const box = { id: hist.id, home: hist.home, away: hist.away, homePts: hist.homePts, awayPts: hist.awayPts, hasStarters: hist.hasStarters, source: 'history' };
      _snapSet('box|' + id, box); return res.json(box);
    }
    const s = await _snapGet('box|' + id);
    if (s) return res.json(Object.assign({}, s.v, { fromSnapshot: true, snapAgeSec: Math.round((Date.now() - s.t) / 1000) }));
    res.json(lu || { home: [], away: [], note: 'no-lineup' });
  } catch (e) { const s = await _snapGet('box|' + id); if (s) return res.json(Object.assign({}, s.v, { fromSnapshot: true })); res.json({ home: [], away: [], error: String(e.message || e) }); }
});
// 🏀 농구 경기 흐름(플레이바이플레이) + 현재기간 팀파울 — detail_live 1회(전 경기 공용 캐시)에서 해당 경기만 추출
app.get('/api/basketball/live', async (req, res) => {
  res.set('Cache-Control', 'no-store');   // 라이브 경기흐름: 중간 캐시 재사용 금지
  const raw = String(req.query.id || '');
  if (!/^ts/.test(raw)) return res.json({ note: 'not-thesports', events: [] });
  const id = raw.replace(/^ts/, '');
  try {
    const lv = await tsFetch('/basketball/match/detail_live', {}, 4000).catch(() => null);
    const list = (lv && lv.results) || [];
    const item = list.find(x => x && String(x.id || (x.score && x.score[0])) === String(id));
    if (!item) {   // 종료 후 detail_live에서 빠짐 → ① live/history(공식 지속 PBP) ② 라이브 중 저장 스냅샷
      const hist = await tsBskHistory(id).catch(() => null);
      if (hist && hist.flow && hist.flow.length) {
        const payload = { found: true, fromHistory: true, period: null, isHalves: false, homeFouls: null, awayFouls: null,
          quarters: hist.quarters, events: hist.flow.map(e => ({ period: e.period, clock: e.clock, team: e.team, home: e.home, away: e.away, text: e.text })) };
        _snapSet('flow|' + id, payload);
        return res.json(payload);
      }
      const s = await _snapGet('flow|' + id);
      if (s) return res.json(Object.assign({}, s.v, { found: true, fromSnapshot: true, snapAgeSec: Math.round((Date.now() - s.t) / 1000) }));
      return res.json({ found: false, events: [] });
    }
    const info = tsBskLiveInfo(item);
    const sc = item.score || [];
    const statePer = TS_BSK_PER[sc[1]] || null;
    let foulsOk = false;
    if (info) { if (info.isHalves) foulsOk = info.curP != null; else foulsOk = (info.curP != null && (statePer ? info.curP >= statePer : true)); }
    const payload = {
      found: true,
      period: (statePer && !info.isHalves) ? statePer : (info ? info.curP : null), isHalves: info ? info.isHalves : false,
      homeFouls: foulsOk ? info.hf : null, awayFouls: foulsOk ? info.af : null,
      quarters: { home: sc[3] || [], away: sc[4] || [] },
      // 최신순, 최대 150개. 점수는 "홈-원정"으로 정렬해 전달
      events: (info ? info.events : []).slice(-150).reverse().map(e => ({ period: e.period, clock: e.clock, team: e.team, home: e.home, away: e.away, text: e.text }))
    };
    if (payload.events.length || (payload.quarters.home && payload.quarters.home.length)) _snapSet('flow|' + id, payload);
    res.json(payload);
  } catch (e) { const s = await _snapGet('flow|' + id); if (s) return res.json(Object.assign({}, s.v, { found: true, fromSnapshot: true })); res.json({ error: String(e.message || e), events: [] }); }
});
// 🏀 농구 슛차트 — live/history tlive 의 슛 이벤트(좌표·성공여부·쿼터) 반환. 종료 경기도 지속.
app.get('/api/basketball/shotchart', async (req, res) => {
  const raw = String(req.query.id || '');
  if (!/^ts/.test(raw)) return res.json({ note: 'not-thesports', shots: [] });
  const id = raw.replace(/^ts/, '');
  try {
    const hist = await tsBskHistory(id).catch(() => null);
    if (hist && hist.shots && hist.shots.length) {
      // 쿼터 정보는 flow 에서 매칭(선택). 여기선 좌표·팀·성공·종류만.
      return res.json({ found: true, shots: hist.shots });
    }
    res.json({ found: false, shots: [] });
  } catch (e) { res.json({ error: String(e.message || e), shots: [] }); }
});
// 🤖 백그라운드 농구 스냅샷 캡처: 아무도 상세를 열지 않아도 라이브 중 흐름/박스를 저장해 둔다.
//    detail_live 1회(전 경기 공용)로 모든 라이브 경기 흐름을 스냅샷 → 종료 후에도 /live 가 유지 반환.
//    박스(라인업)는 라이브 경기당 1회 호출이라 동시성 상한(6)으로 과호출 방지(§14 호출량 보호).
let _bgSnapRunning = false;
async function bskSnapshotTick() {
  if (_bgSnapRunning) return; _bgSnapRunning = true;
  try {
    const lv = await tsFetch('/basketball/match/detail_live', {}, 5000).catch(() => null);
    const list = (lv && lv.results) || [];
    const liveIds = [];
    for (const item of list) {
      const id = item && (item.id || (item.score && item.score[0])); if (!id) continue;
      const info = tsBskLiveInfo(item); const sc = item.score || [];
      const statePer = TS_BSK_PER[sc[1]] || null;
      let foulsOk = false;
      if (info) { if (info.isHalves) foulsOk = info.curP != null; else foulsOk = (info.curP != null && (statePer ? info.curP >= statePer : true)); }
      const payload = {
        found: true,
        period: (statePer && info && !info.isHalves) ? statePer : (info ? info.curP : null), isHalves: info ? info.isHalves : false,
        homeFouls: foulsOk ? info.hf : null, awayFouls: foulsOk ? info.af : null,
        quarters: { home: sc[3] || [], away: sc[4] || [] },
        events: (info ? info.events : []).slice(-150).reverse().map(e => ({ period: e.period, clock: e.clock, team: e.team, home: e.home, away: e.away, text: e.text }))
      };
      if (payload.events.length || (payload.quarters.home && payload.quarters.home.length)) { _snapSet('flow|' + id, payload); liveIds.push(id); }
    }
    // 박스(라인업)도 라이브 동안 저장 — 동시성 6으로 제한, 한 틱에 최대 18경기.
    const todo = liveIds.slice(0, 18); let i = 0;
    async function worker() { while (i < todo.length) { const id = todo[i++]; try { const lu = await tsBasketballLineup(id); if (lu && ((lu.home && lu.home.length) || (lu.away && lu.away.length))) _snapSet('box|' + id, lu); } catch (e) {} } }
    await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  } catch (e) { } finally { _bgSnapRunning = false; }
}
setTimeout(() => { bskSnapshotTick().catch(() => {}); }, 8000);
setInterval(() => { bskSnapshotTick().catch(() => {}); }, 60000);
// 🔁 종료 경기 팀 통계 폴백: TheSports 라이브 박스가 종료 후 사라진 경기를, API-Sports(종료 통계 보관)에서 보완.
//   매칭: 리그명→API-Sports 리그ID, 날짜+팀명으로 경기 탐색 → /games/statistics/teams. 실데이터만 반환(없으면 null).
function _abTok(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').split(/\s+/).filter(w=>w.length>3); }
function _abTeamMatch(gn, want){ const g=String(gn||'').toLowerCase(), w=String(want||'').toLowerCase(); if(!g||!w) return false; if(g===w||g.includes(w)||w.includes(g)) return true; const gt=_abTok(g), wt=_abTok(w); return gt.some(x=>wt.includes(x)); }
// 공용: 리그명+날짜+팀명으로 API-Sports 농구 경기 1건 탐색(여러 시즌 표기 폴백).
async function asFindBskGame(home, away, date, leagueName){
  const lid = AB_RANK_ID[bskLeagueAlias(leagueName)] || AB_RANK_ID[leagueName] || null;
  if(!lid) return { err:'no-league-map' };
  const ymd = String(date).slice(0,10); const yr = +ymd.slice(0,4);
  const seasons = [`${yr}-${yr+1}`, String(yr), `${yr-1}-${yr}`, String(yr-1)];
  let games=[];
  for(const s of seasons){
    const j = await asRaw('basketball', `/games?league=${lid}&season=${encodeURIComponent(s)}&date=${ymd}&timezone=Asia/Seoul`, 3600000).catch(()=>null);
    const arr=(j&&j.response)||[]; if(arr.length){ games=arr; break; }
  }
  if(!games.length) return { err:'no-apisports-game' };
  const match = games.find(g=>_abTeamMatch(g.teams&&g.teams.home&&g.teams.home.name, home) && _abTeamMatch(g.teams&&g.teams.away&&g.teams.away.name, away));
  if(!match) return { err:'no-match' };
  return { match };
}
// ⚾/🏀 "MM:SS" 또는 "MM" → 정수 분
function _abMinutes(m){ if(m==null) return 0; const s=String(m); const mm=s.split(':')[0]; const n=parseInt(mm,10); return isNaN(n)?0:n; }
// API-Sports 이름에 섞인 HTML 엔티티(&apos; &amp; 등) 디코딩 → 이름 깨짐 방지
function _deHtml(s){ if(s==null) return s; return String(s).replace(/&apos;/g,"'").replace(/&#0*39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'); }
// 🔁 종료 경기 선수 박스 폴백(§08 라인업): API-Sports 선수 기록 → 우리 박스 형태. 확정 선발(type=starters) 구분.
async function asBasketballPlayerBox(home, away, date, leagueName){
  const f = await asFindBskGame(home, away, date, leagueName);
  if(f.err) return { note:f.err };
  const match = f.match;
  const sp = await asRaw('basketball', `/games/statistics/players?id=${match.id}`, 3600000).catch(()=>null);
  const rows=(sp&&sp.response)||[]; if(!rows.length) return { note:'no-players' };
  const nz=v=>(v==null?null:+v);
  const conv=r=>{ const fg=r.field_goals||{}, tp=r.threepoint_goals||{}, ft=r.freethrows_goals||{}, rb=r.rebounds||{};
    const p2m=+fg.total||0, p2a=+fg.attempts||0, t3m=+tp.total||0, t3a=+tp.attempts||0;
    return { id:(r.player&&r.player.id)||'', name:_deHtml((r.player&&r.player.name))||'-', number:'',
      min:_abMinutes(r.minutes), pts:nz(r.points), reb:nz(rb.total), ast:nz(r.assists),
      fg:(p2m+t3m)+'-'+(p2a+t3a), p3:t3m+'-'+t3a, ft:(ft.total==null?'-':ft.total)+'-'+(ft.attempts==null?'-':ft.attempts),
      oreb:null, dreb:null, stl:null, blk:null, to:null, pf:null,
      starter:/start/i.test(String(r.type||'')) };
  };
  const hid=match.teams.home.id, aid=match.teams.away.id;
  const home2=[], away2=[];
  rows.forEach(r=>{ const tid=r.team&&r.team.id; const p=conv(r); if(tid===hid) home2.push(p); else if(tid===aid) away2.push(p); });
  if(!home2.length&&!away2.length) return { note:'no-players' };
  const stH=home2.filter(p=>p.starter).length, stA=away2.filter(p=>p.starter).length;
  return { home:home2, away:away2, source:'apisports', hasStarters:(stH===5&&stA===5) };
}
app.get('/api/basketball/playerbox', async (req, res) => {
  const home=req.query.home, away=req.query.away, date=req.query.date, league=req.query.league||'';
  if(!home||!away||!date) return res.json({ note:'need-params' });
  if(!APISPORTS_KEY) return res.json({ note:'needKey' });
  try{ const r=await asBasketballPlayerBox(home, away, date, league); res.json(r||{ note:'no-data' }); }
  catch(e){ res.json({ error:String(e.message||e) }); }
});
async function asBasketballTeamStats(home, away, date, leagueName){
  const lid = AB_RANK_ID[bskLeagueAlias(leagueName)] || AB_RANK_ID[leagueName] || null;
  if(!lid) return { note:'no-league-map' };
  const ymd = String(date).slice(0,10); const yr = +ymd.slice(0,4);
  const seasons = [`${yr}-${yr+1}`, String(yr), `${yr-1}-${yr}`, String(yr-1)];
  let games=[];
  for(const s of seasons){
    const j = await asRaw('basketball', `/games?league=${lid}&season=${encodeURIComponent(s)}&date=${ymd}&timezone=Asia/Seoul`, 3600000).catch(()=>null);
    const arr=(j&&j.response)||[]; if(arr.length){ games=arr; break; }
  }
  if(!games.length) return { note:'no-apisports-game' };
  const match = games.find(g=>_abTeamMatch(g.teams&&g.teams.home&&g.teams.home.name, home) && _abTeamMatch(g.teams&&g.teams.away&&g.teams.away.name, away));
  if(!match) return { note:'no-match' };
  const st = await asRaw('basketball', `/games/statistics/teams?id=${match.id}`, 3600000).catch(()=>null);
  const rows=(st&&st.response)||[]; if(rows.length<2) return { note:'no-stats' };
  // ⚠️ API-Sports 규약: field_goals = 2점 전용(3점 미포함). 우리 프론트는 fg=전체FG(2P+3P) 기준(TheSports와 동일) →
  //    여기서 2P(field_goals) + 3P(threepoint)를 합산해 전체 FG로 변환. (검증: 2P·2 + 3P·3 + FT = 최종점수)
  const conv=r=>{ const S=r.statistics||r, fg=S.field_goals||{}, tp=S.threepoint_goals||{}, ft=S.freethrows_goals||{}, rb=S.rebounds||{}; const nz=v=>(v==null?null:+v);
    const p2m=nz(fg.total), p2a=nz(fg.attempts), t3m=nz(tp.total), t3a=nz(tp.attempts);
    const add=(a,b)=>(a==null&&b==null)?null:((a||0)+(b||0));
    return { fgm:add(p2m,t3m), fga:add(p2a,t3a), tpm:t3m, tpa:t3a, ftm:nz(ft.total), fta:nz(ft.attempts),
      reb:nz(rb.total), oreb:nz(rb.offence), dreb:nz(rb.defense), ast:nz(S.assists), stl:nz(S.steals), blk:nz(S.blocks), to:nz(S.turnovers), pf:nz(S.personal_fouls) }; };
  const byId={}; rows.forEach(r=>{ const tid=r.team&&r.team.id; if(tid!=null) byId[tid]=conv(r); });
  const H=byId[match.teams.home.id], A=byId[match.teams.away.id];
  if(!H||!A) return { note:'no-stats' };
  return { home:H, away:A, source:'apisports', gameId:match.id };
}
app.get('/api/basketball/teamstats', async (req, res) => {
  const home=req.query.home, away=req.query.away, date=req.query.date, league=req.query.league||'';
  if(!home||!away||!date) return res.json({ note:'need-params' });
  if(!APISPORTS_KEY) return res.json({ note:'needKey' });
  try{ const r=await asBasketballTeamStats(home, away, date, league); res.json(r||{ note:'no-apisports-stats' }); }
  catch(e){ res.json({ error:String(e.message||e) }); }
});
// 🏐 TheSports 배구 경기목록(diary) → 세트 승수(ft) + 세트별 점수(p1~p5)
function tsVolState(s) { s = Number(s); if (s === 1 || s === 0) return 'scheduled'; if (s === 100 || s < 0) return 'finished'; return 'live'; }
async function tsVolleyballGames(date, tz) {
  tz = canonTz(tz);
  const toYmd = d => String(d).replace(/-/g, '');
  const prev = new Date(Date.parse(date + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
  const next = new Date(Date.parse(date + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  const team = {}, comp = {}, countries = {}, out = [], seen = new Set();
  // 🚑 3일치 diary 병렬 조회(순차 시 느린 공급사에서 지연 누적 → 멈춤). 각 호출은 요청 타임아웃(6s)으로 상한.
  const _diaries = await Promise.all([prev, date, next].map(dt => tsFetch('/volleyball/match/diary', { date: toYmd(dt) }, 8000).catch(() => null)));
  for (const d of _diaries) {
    if (!d) continue;
    const ex = (d && d.results_extra) || {};
    (ex.country || []).forEach(c => countries[c.id] = c.name);
    // 🏐 배구는 대회 정보가 results_extra.unique_tournament 에 있음(농구의 competition 과 키가 다름) → 리그명이 비던 버그 수정
    (ex.unique_tournament || ex.competition || []).forEach(c => comp[c.id] = { name: c.name, logo: c.logo || '', country: countries[c.country_id] || '' });
    (ex.team || []).forEach(t => team[t.id] = { name: t.name, logo: t.logo || '' });
    for (const m of (d && d.results) || []) {
      const id = m.id; if (!id || seen.has(id)) continue;
      const iso = m.match_time ? new Date(m.match_time * 1000).toISOString() : null;
      if (iso && ymdInTz(iso, tz) !== date) continue;
      seen.add(id);
      const ht = team[m.home_team_id] || {}, at = team[m.away_team_id] || {}, cp = comp[m.unique_tournament_id] || comp[m.tournament_id] || {};
      const sc = m.scores || {}; const ft = sc.ft || [];
      const setScores = [];
      ['p1', 'p2', 'p3', 'p4', 'p5'].forEach(k => { const p = sc[k]; if (Array.isArray(p) && (p[0] != null || p[1] != null)) setScores.push({ home: (p[0] != null ? +p[0] : null), away: (p[1] != null ? +p[1] : null) }); });
      const st = m.status_id, state = tsVolState(st);
      out.push({
        id: 'ts' + id, tsid: id, sport: 'volleyball',
        league: tsLeagueDisplay('volleyball', cp.name) || '', leagueOrig: cp.name || '', leagueLogo: cp.logo || '', leagueId: m.unique_tournament_id || m.tournament_id || '', country: cp.country || '',
        home: ht.name || '', homeLogo: ht.logo || '', away: at.name || '', awayLogo: at.logo || '',
        homeTid: m.home_team_id, awayTid: m.away_team_id,
        hs: (ft[0] != null ? +ft[0] : null), as: (ft[1] != null ? +ft[1] : null),   // 세트 승수
        status: '', statusLong: String(st), period: setScores.length,
        setScores: setScores.length ? setScores : null,
        livePts: (state === 'live' && setScores.length) ? setScores[setScores.length - 1] : null,
        box: null, curInning: null, inningHalf: null,
        date: iso, state: state, _src: 'thesports'
      });
    }
  }
  return out;
}
async function buildGamesCore(sport, date, tz) {
  const cfg = AS[sport]; if (!cfg) return { games: [], j: {} };
  tz = canonTz(tz);
  // ⚽ 축구 = 더스포츠 (CFG.ftbSrc). 비면 아래 API-Sports 폴백.
  if (sport === 'football' && CFG.ftbSrc === 'thesports' && !tsCircuitOpen('football')) {
    let games = [];
    try {
      const prev = new Date(Date.parse(date + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
      const next = new Date(Date.parse(date + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
      // 🚑 3일치 병렬 조회(순차 시 느린 공급사에서 콜드 빌드가 3배 지연 → 멈춤)
      const _fb = await Promise.all([prev, date, next].map(dt => tsFootballGames(dt).catch(() => [])));
      let all = [].concat.apply([], _fb);
      const seen = new Set();
      games = all.filter(g => { if (!g.date || ymdInTz(g.date, tz) !== date) return false; if (seen.has(g.tsid)) return false; seen.add(g.tsid); return true; })
        .map(g => Object.assign({}, g, { id: 'ts' + g.tsid }));
    } catch (e) {}
    tsCircuitNote('football', games.length > 0);
    const gk = 'TS|football|' + date + '|' + (tz || '');
    if (games.length) { _lastGoodMinor.set(gk, { t: Date.now(), list: games.slice() }); return { games, j: { results: games.length, src: 'thesports' } }; }
    const prev = _lastGoodMinor.get(gk);
    if (prev && prev.list && prev.list.length && Date.now() - prev.t < 90000) return { games: prev.list.slice(), j: { results: prev.list.length, src: 'thesports-cache' } };
    // 폴백: 아래 API-Sports 축구
  }
  // 🏐 배구 = 더스포츠 (CFG.volSrc). 비면 아래 API-Sports 폴백.
  if (sport === 'volleyball' && CFG.volSrc === 'thesports' && !tsCircuitOpen('volleyball')) {
    let games = []; try { games = await tsVolleyballGames(date, tz); } catch (e) {}
    tsCircuitNote('volleyball', games.length > 0);
    const gk = 'TS|volleyball|' + date + '|' + (tz || '');
    if (games.length) { _lastGoodMinor.set(gk, { t: Date.now(), list: games.slice() }); return { games, j: { results: games.length, src: 'thesports' } }; }
    const prev = _lastGoodMinor.get(gk);
    if (prev && prev.list && prev.list.length && Date.now() - prev.t < 90000) return { games: prev.list.slice(), j: { results: prev.list.length, src: 'thesports-cache' } };
    // 폴백: 아래 API-Sports 배구
  }
  // 🏀 농구 = 더스포츠(초단위 시계+라인업) 강제 옵션
  if (sport === 'basketball' && CFG.bskSrc === 'thesports' && !tsCircuitOpen('basketball')) {
    let games = []; try { games = await tsBasketballGames(date, tz); } catch (e) {}
    tsCircuitNote('basketball', games.length > 0);
    const gk = 'TS|basketball|' + date + '|' + (tz || '');
    if (games.length) { _lastGoodMinor.set(gk, { t: Date.now(), list: games.slice() }); return { games, j: { results: games.length, src: 'thesports' } }; }
    const prev = _lastGoodMinor.get(gk);
    if (prev && prev.list && prev.list.length && Date.now() - prev.t < 90000) return { games: prev.list.slice(), j: { results: prev.list.length, src: 'thesports-cache' } };
    // ⚠️ TheSports 농구가 비어있으면(플랜 미커버/장애) 하드 리턴하지 않고 아래 Goalserve→API-Sports로 폴백한다.
    //    (축구·배구와 동일한 폴백 정책. 하드 리턴 시 농구 탭 전체가 빈 화면이 되던 버그 수정)
  }
  // 🏀 농구 = Goalserve 우선(라이브 쿼터+시계). 비어있으면(테스트키 만료/장애) API-Sports로 자동 폴백.
  //    관리자 설정(CFG.bskSrc): 'auto'(기본) / 'goalserve'(강제) / 'apisports'(강제 폴백) / 'thesports'(초단위)
  if (sport === 'basketball' && CFG.bskSrc !== 'apisports') {
    let games = [];
    try { games = await gsBasketballGames(date, tz); } catch {}
    const gk = 'GS|basketball|' + date + '|' + (tz || '');
    if (!games.length && CFG.bskSrc === 'goalserve') return { games: [], j: { results: 0, src: 'goalserve-forced' } };
    if (games.length) {   // Goalserve 정상
      _lastGoodMinor.set(gk, { t: Date.now(), list: games.slice() });
      for (const [k, v] of _lastGoodMinor) { if (Date.now() - v.t > 1800000) _lastGoodMinor.delete(k); }
      return { games, j: { results: games.length, src: 'goalserve' } };
    }
    // Goalserve 빈 응답 — 최근 90초 내 정상빌드 있으면 잠깐 버팀(일시 장애 깜빡임 방지)
    const prev = _lastGoodMinor.get(gk);
    if (prev && prev.list && prev.list.length && Date.now() - prev.t < 90000) {
      return { games: prev.list.slice(), j: { results: prev.list.length, src: 'goalserve-cache' } };
    }
    // 장기 비어있음(테스트키 만료 등) → 아래 API-Sports 일반 경로로 폴백(early-return 안 함)
  }
  // 옛 타임존 별칭(Asia/Saigon 등) 표준화 → 날짜 필터 안정화
  // 🏐 배구·농구·하키 등 v1 종목: API가 기기 타임존별 날짜버킷을 불안정하게 반환(라이브 경기 누락) →
  //    안정적인 Asia/Seoul로 조회한 뒤, 화면 표시는 기기 타임존 날짜로 필터한다.
  const MINOR = ['volleyball', 'basketball', 'hockey', 'handball', 'rugby'];
  const isMinor = MINOR.includes(sport);
  // 🌐 모든 종목을 단일 타임존 버킷(Asia/Seoul)으로 조회 → 사용자 타임존(베트남 Asia/Saigon·태국·인니 등)마다
  //    API를 따로 호출해 하루 요청한도(쿼터)를 소진하던 문제 해결. 전 지역이 같은 캐시를 공유한다.
  //    표시용 날짜 그룹은 아래에서 기기 타임존으로 필터한다.
  const apiTz = 'Asia/Seoul';
  // 🗓️ 날짜 그룹 — KBO/NPB=한국시간, MLB=미국(동부) 날짜 기준. 미국 저녁 경기는 한국시간 다음날 새벽이라 전날·다음날치도 받아 필터
  const prevDate = new Date(Date.parse(date + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
  const nextDate = new Date(Date.parse(date + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  // 단일 버킷(Seoul)으로 받으므로 축구도 전날·당일·다음날 3일치를 받아 기기 타임존 날짜로 거른다(경계 경기 누락 방지).
  const apiDates = [prevDate, date, nextDate];
  let j = {}; let games = []; const _seen = new Set();
  for (const dt of apiDates) {
    const jj = await asRaw(sport, `${cfg.path}?date=${dt}&timezone=${tzq(apiTz)}`, 8000).catch(() => ({ response: [] }));
    if (dt === date) j = jj;
    (jj.response || []).map(g => normAS(sport, g)).filter(Boolean).forEach(g => { if (!_seen.has(g.id)) { _seen.add(g.id); g._apiDate = dt; games.push(g); } });
  }
  // 🚫 고교야구(고시엔 등) 제외 — 로고·데이터 빈약해 제외
  games = games.filter(g => !/koshien|senbatsu|high\s*school|甲子園|고교|highschool/i.test(String(g.league || '')));
  const STATS_LG = { 'MLB': 1, 'LMB': 23, 'IL': 11, 'PCL': 11 };
  if (sport === 'baseball' && games.some(g => STATS_LG[g.league])) {
    const smByDate = {};
    for (const dt of apiDates) {
      const need = [...new Set(games.filter(g => g._apiDate === dt && STATS_LG[g.league]).map(g => STATS_LG[g.league]))];
      if (!need.length) continue;
      const sm = {}; for (const sid of need) Object.assign(sm, await mlbScoreMap(dt, sid, tz).catch(() => ({}))); smByDate[dt] = sm;
    }
    games.forEach(g => {
      if (!STATS_LG[g.league]) return;
      const sm = smByDate[g._apiDate] || {};
      const gYmd = g.date ? ymdInTz(g.date, tz) : g._apiDate;
      const hN = mlbNick(g.home), aN = mlbNick(g.away);
      // 날짜까지 맞춰 매칭(시리즈 혼동 방지). 혹시 못 찾으면 팀조합만으로 폴백
      const e = sm[[hN, aN].sort().join('|') + '|' + gYmd] || sm[[hN, aN].sort().join('|') + '|' + g._apiDate];
      if (!e) return;
      const H = e.byNick[hN] || {}, A = e.byNick[aN] || {};
      if (H.pitcher || A.pitcher) g.pitchers = {   // 예상 선발투수(+사진용 ID·시즌 성적)
        home: { name: H.pitcher || null, id: H.pitcherId || null, era: H.era || null, w: H.w != null ? H.w : null, l: H.l != null ? H.l : null },
        away: { name: A.pitcher || null, id: A.pitcherId || null, era: A.era || null, w: A.w != null ? A.w : null, l: A.l != null ? A.l : null }
      };
      if (H.r != null) g.hs = H.r;
      if (A.r != null) g.as = A.r;
      g.state = e.state;
      g.status = e.state === 'finished' ? 'FT' : e.state === 'live' ? 'IN' : 'NS';
      if (e.inning != null) { g.curInning = e.inning; g.period = e.inning; }
      if (e.half) g.inningHalf = e.half === 'Top' ? 'top' : e.half === 'Bottom' ? 'bottom' : g.inningHalf;
      if (e.bso) g.bso = e.bso;
      const prevH = g.box && g.box.home ? g.box.home : {}, prevA = g.box && g.box.away ? g.box.away : {};
      g.box = {
        home: { r: H.r != null ? H.r : g.hs, h: H.h != null ? H.h : (prevH.h ?? null), e: H.e != null ? H.e : (prevH.e ?? null), bb: H.bb != null ? H.bb : null, innings: prevH.innings || {} },
        away: { r: A.r != null ? A.r : g.as, h: A.h != null ? A.h : (prevA.h ?? null), e: A.e != null ? A.e : (prevA.e ?? null), bb: A.bb != null ? A.bb : null, innings: prevA.innings || {} }
      };
    });
  }
  // ⚾ 야구 = TheSports 1순위(계약 메인). MLB만 MLB 공식 무료 StatsAPI 유지(API-Sports 아님·최고품질), 그 외 전 리그는 TheSports로 교체.
  if (sport === 'baseball' && TS_ON && CFG.bsbSrc !== 'apisports') {
    try {
      const keepApi = /\bMLB\b|major\s*league\s*baseball/i;   // MLB는 공식 StatsAPI 유지(TheSports보다 피치·박스 상세)
      const hsRe = /koshien|senbatsu|high\s*school|甲子園|고교|amateur|university|college/i;
      const ts = await tsBaseballGames(date).catch(() => []);
      // MLB·고교 제외한 모든 TheSports 야구 경기를 메인으로 사용(KBO·NPB·CPBL·멕시칸·기타 포함)
      const kn = ts.filter(g => !hsRe.test(g.league || '') && !keepApi.test(g.league || ''));
      if (kn.length) {
        // 🔑 닉네임(마지막 단어) 쌍으로 매칭. TheSports 커버 경기는 API-Sports 버전 제거 후 TheSports로 교체, 없는 경기는 추가.
        const key = g => [nkLast(g.home), nkLast(g.away)].sort().join('|');
        const knKeys = new Set(kn.map(key));
        games = games.filter(g => keepApi.test(g.league || '') || !knKeys.has(key(g)));  // MLB는 항상 유지, 그 외 TheSports가 커버하면 제거
        games = games.concat(kn);
      }
    } catch (e) { /* TheSports 실패 시 API-Sports 유지 */ }
  }
  // 🗓️ 야구만 날짜 필터: 경기 시작(UTC)을 기기 타임존으로 변환한 날짜가 선택 날짜와 같은 경기만 (MLB KST 시차 정확 처리)
  //    그 외 종목은 API가 timezone 파라미터로 이미 그날 경기만 반환 → 추가 필터 없음(경기 누락 방지)
  if (sport === 'baseball') games = games.filter(g => !g.date || ymdInTz(g.date, tz) === date);
  // ⚽ 축구도 이제 단일 버킷(Seoul)으로 3일치 받으므로 기기 타임존 날짜로 필터 (타임존별 중복 API호출 제거 → 쿼터 보호)
  if (sport === 'football') games = games.filter(g => !g.date || ymdInTz(g.date, tz) === date);
  // 🏐 마이너 종목: 서울tz로 3일치 받아왔으니, 기기 타임존 날짜와 같은 경기만 남긴다(라이브는 오늘 버킷에 들어와 유지됨)
  if (isMinor) games = games.filter(g => !g.date || ymdInTz(g.date, tz) === date);
  // 🛡️ 마이너 종목 + 축구 간헐적 사라짐 방지: API가 잠깐 빈 응답(쿼터/타임아웃)을 줘도 직전 정상빌드의 같은-날짜 경기는 유지
  if (isMinor || sport === 'football') {
    try {
      const mk = 'MN|' + sport + '|' + date + '|' + (tz || '');
      const prev = _lastGoodMinor.get(mk);
      if (prev && prev.list && prev.list.length) {
        const ids = new Set(games.map(g => String(g.id)));
        prev.list.forEach(pg => { if (!ids.has(String(pg.id))) games.push(pg); });
      }
      if (games.length) _lastGoodMinor.set(mk, { t: Date.now(), list: games.slice() });
      for (const [k, v] of _lastGoodMinor) { if (Date.now() - v.t > 1800000) _lastGoodMinor.delete(k); }
    } catch {}
  }
  // 🛡️ MLB/야구 간헐적 사라짐 방지: 이번 빌드에 없는데 직전 정상빌드에 있던 같은-날짜 경기는 유지(업스트림 일시 빈응답 대응)
  if (sport === 'baseball') {
    try {
      const kk = 'BB|' + date + '|' + (tz || '');
      const prev = _lastGoodBB.get(kk);
      if (prev && prev.list && prev.list.length) {
        const ids = new Set(games.map(g => String(g.id)));
        prev.list.forEach(pg => { if (!ids.has(String(pg.id))) games.push(pg); });
      }
      if (games.length) _lastGoodBB.set(kk, { t: Date.now(), list: games.slice() });
      for (const [k, v] of _lastGoodBB) { if (Date.now() - v.t > 1800000) _lastGoodBB.delete(k); }
    } catch {}
  }
  // ⚾ 최종 중복 제거: 같은 경기가 두 소스(API-Sports·TheSports)에서 팀명만 다르게 두 번 뜨는 것 방지.
  //    닉네임 쌍 + 날짜로 묶고, 정보가 더 풍부한 쪽(초/말·B/S/O·라이브·긴 팀명 = 보통 TheSports)만 남김.
  if (sport === 'baseball') {
    const bestScore = g => {
      let s = 0;
      const st = String(g.status || g.state || '').toUpperCase();
      if (g.state === 'live' || /IN|TOP|BOT/.test(st)) s += 1000; else if (g.state === 'finished') s += 100;
      if (g.inningHalf) s += 40;              // 초/말 정보 = TheSports
      if (g.bso) s += 40;                     // B/S/O 카운트 = TheSports
      if (g.box && (g.box.home && (g.box.home.h != null))) s += 10;
      s += String(g.home || '').length + String(g.away || '').length; // 긴 정식 팀명 우선
      return s;
    };
    const seen = new Map();
    for (const g of games) {
      const k = [nkLast(g.home), nkLast(g.away)].sort().join('|') + '|' + (g.date ? ymdInTz(g.date, tz) : '');
      const cur = seen.get(k);
      if (!cur || bestScore(g) > bestScore(cur)) seen.set(k, g);
    }
    games = [...seen.values()];
  }
  // ⚾ 선발투수 시즌성적(ERA·승·패) 채우기 — 화면에 보이는 경기 투수만, 선수별 1시간 캐시로 호출 최소화
  if (sport === 'baseball') {
    const need = new Set();
    games.forEach(g => { if (g.pitchers) ['home', 'away'].forEach(s => { const p = g.pitchers[s]; if (p && p.id && p.era == null) need.add(p.id); }); });
    if (need.size) {
      const stats = {};
      await Promise.all([...need].map(async id => { stats[id] = await mlbPitcherSeason(id).catch(() => null); }));
      games.forEach(g => { if (g.pitchers) ['home', 'away'].forEach(s => {
        const p = g.pitchers[s], st = p && p.id ? stats[p.id] : null;
        if (p && st) { if (p.era == null && st.era && st.era !== '-') p.era = String(st.era); if (p.w == null) p.w = st.w; if (p.l == null) p.l = st.l; }
      }); });
    }
  }
  // ⚽ 축구 팀별 통계(점유율·슈팅·유효슈팅·카드) — 라이브 + 종료 경기(최종 카드 표시). 종료는 길게 캐시.
  if (sport === 'football') {
    const liveG = games.filter(g => g.state === 'live');
    const finG = games.filter(g => g.state === 'finished');
    const targets = liveG.concat(finG).slice(0, 200);   // 라이브 우선 + 종료, 최대 200경기(사실상 전 경기)
    // 캐시 히트는 즉시 처리, 미스만 API 호출 — 미스는 배치(20개씩)로 나눠 rate-limit 버스트 방지
    const fetchOne = async g => {
      try {
        const ck = 'FBS:' + g.id, hit = cache.get(ck);
        const ttl = g.state === 'finished' ? 3600000 : 30000;   // 종료=1시간(안 변함), 라이브=30초
        let stats;
        // 통계가 비어있으면(경기 직후 API 지연·일시 실패 등) 25초만 캐시 → 점유율 나올 때까지 빨리 재시도
        if (hit && Date.now() - hit.t < (hit.v ? ttl : 25000)) stats = hit.v;
        else {
          const st = await asRaw('football', `/fixtures/statistics?fixture=${g.id}`, 15000);
          const val = (arr, type) => { const it = (arr || []).find(x => x.type === type); return it ? it.value : null; };
          const s = {};
          (st.response || []).forEach(row => {
            const tid = row.team ? row.team.id : null, tn = row.team ? row.team.name : '';
            let side = (tid != null && tid === g.homeId) ? 'home' : (tid != null && tid === g.awayId) ? 'away' : null;
            if (!side) side = tn === g.home ? 'home' : tn === g.away ? 'away' : null;
            if (!side) return;
            const a = row.statistics || [];
            s[side] = {
              poss: val(a, 'Ball Possession'),                          // "66%"
              shots: val(a, 'Total Shots'),
              sot: val(a, 'Shots on Goal'),
              y: val(a, 'Yellow Cards') || 0,
              r: val(a, 'Red Cards') || 0
            };
          });
          stats = (s.home || s.away) ? { home: s.home || {}, away: s.away || {} } : null;
          cache.set(ck, { t: Date.now(), v: stats });
        }
        if (stats) {
          g.stats = stats;
          const hy = (stats.home || {}).y || 0, hr = (stats.home || {}).r || 0, ay = (stats.away || {}).y || 0, ar = (stats.away || {}).r || 0;
          if (hy || hr || ay || ar) g.cards = { home: { y: hy, r: hr }, away: { y: ay, r: ar } };
        }
      } catch {}
    };
    // 캐시된 것 먼저 즉시 반영, 미완료(API 호출 필요)만 6개씩 배치로 순차 처리(버스트 rate-limit 회피 → 누락 방지)
    for (let i = 0; i < targets.length; i += 6) {
      await Promise.all(targets.slice(i, i + 6).map(fetchOne));
      if (i + 6 < targets.length) await new Promise(r => setTimeout(r, 150));
    }
  }
  // ⚡ 지난 킥오프인데 아직 '예정'인 축구 경기는 fixture id 직접조회로 최신 상태 보정 (api-football 날짜목록이 NS로 안 바뀌는 문제 대응)
  if (sport === 'football') {
    try {
      const now = Date.now();
      if (now - (globalThis._staleRefetchAt || 0) > 40000) {
      globalThis._staleRefetchAt = now;
      const stale = games.filter(g => g.state === 'scheduled' && g.date && (now - Date.parse(g.date) > 6 * 60000)).slice(0, 20);
      for (let bi = 0; bi < stale.length; bi += 20) {
        const ids = stale.slice(bi, bi + 20).map(g => g.id).join('-');
        const jj = await asRaw('football', `/fixtures?ids=${ids}&timezone=${tzq(tz)}`, 3000).catch(() => ({ response: [] }));
        const fresh = {};
        (jj.response || []).forEach(x => { const n = normAS('football', x); if (n) fresh[n.id] = n; });
        games = games.map(g => fresh[g.id] || g);
      }
      }
    } catch (e) {}
  }
  // ⏱️ 종료됐는데 stale 상태(HT/1H/2H 등 live)로 남는 축구 경기 보정: 킥오프 후 170분 지나면 무조건 종료(FT) 처리
  if (sport === 'football') {
    const now2 = Date.now();
    games.forEach(g => {
      if (g.state === 'live' && g.date) {
        const mins = (now2 - Date.parse(g.date)) / 60000;
        if (mins > 170) {
          g.state = 'finished';
          const st = String(g.status || '').toUpperCase();
          if (!st || ['HT', '1H', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP'].includes(st)) g.status = 'FT';
        }
      }
    });
  }
  // 🛡️ [전종목] 시작 시각이 아직 미래인데 '종료/라이브'로 온 경기 → '예정'으로 보정.
  //     (API-Sports가 경기 시작 전 KBO 등에 FT·0:0을 주는 결함 방어. 미래 경기는 종료·진행일 수 없음)
  {
    const nowMs = Date.now();
    games.forEach(g => {
      if (g.state && g.state !== 'scheduled' && g.date) {
        const st = Date.parse(g.date);
        if (st && st - nowMs > 5 * 60000) { g.state = 'scheduled'; g.status = 'NS'; }
      }
    });
  }
  if (j && !j.src) j.src = 'apisports';   // 계측용 출처 표기(원본/캐시 구분)
  return { games, j };
}

// ⚡ 경기목록 전체 결과를 짧게 캐시 (피드 7초·중계봇 10초·픽제공·푸시가 공유 → 외부호출/CPU 절감)
// ⚡ 종목별 캐시/갱신 주기: 축구=Mega(15만/일) 빠르게, 야구=Ultra 중간, 그 외=보수적(Pro 한도 보호)
// 단일 타임존 버킷(전 지역 공유)이라 TTL을 당겨도 API 호출이 적음 → 업데이트 체감 속도 개선
function sportTtl(sport){ return sport==='football' ? 7000 : sport==='baseball' ? 8000 : 8000; }
const gamesCoreCache = new Map();
// 🔗 single-flight: 같은 키의 동시 빌드를 1건으로 병합(콜드·30초초과·오류복구 경로 모두)
const _coreInflight = new Map();
function coreBuildOnce(k, sport, date, tz) {
  const ex = _coreInflight.get(k);
  if (ex) { METRICS.cache.merge++; return ex; }   // 진행 중 빌드에 합류 → 원본 API 중복 호출 방지
  const p = buildGamesCore(sport, date, tz)
    .finally(() => { _coreInflight.delete(k); });   // 성공·실패·타임아웃 모두 정리
  _coreInflight.set(k, p);
  return p;
}
async function buildGamesCoreCached(sport, date, tz, ttl = sportTtl(sport)) {
  const k = sport + '|' + date + '|' + (tz || '');
  const hit = gamesCoreCache.get(k), now = Date.now();
  if (hit) {
    const age = now - hit.t;
    // 🕒 아주 오래된 캐시(복귀 유저 등, 30초 초과)면 새로 받아서 반환 — single-flight로 동시요청 1건만 원본 호출
    if (age > 30000) {
      METRICS.cache.miss++;
      try { const v = await coreBuildOnce(k, sport, date, tz); gamesCoreCache.set(k, { t: Date.now(), v }); return v; }
      catch { return hit.v; }   // 실패 시 마지막 정상값 유지
    }
    // ⚡ stale-while-revalidate: 보통의 만료는 이전 값 즉시 반환 + 뒤에서 1건만 갱신
    if (age >= ttl && !_coreInflight.has(k)) {
      METRICS.cache.refresh++;
      coreBuildOnce(k, sport, date, tz).then(v => gamesCoreCache.set(k, { t: Date.now(), v })).catch(() => {});
    }
    METRICS.cache.hit++;
    return hit.v;
  }
  METRICS.cache.miss++;
  const v = await coreBuildOnce(k, sport, date, tz);   // 콜드: 동시 요청 전부 이 1건을 공유
  gamesCoreCache.set(k, { t: now, v });
  if (gamesCoreCache.size > 40) { for (const [key, val] of gamesCoreCache) { if (now - val.t > 120000) gamesCoreCache.delete(key); } }
  return v;
}
// 날짜별 경기 (정규화 + 해외배당 매칭)
const fullGamesCache = new Map();
async function buildFullGames(sport, date, tz) {
  const { games, j } = await buildGamesCoreCached(sport, date, tz);
    games.sort((a, b) => (b.state === 'live') - (a.state === 'live'));
  const src = (j && j.src) || null;
  return { sport, date, count: games.length, apiErrors: j.errors || null, results: j.results, games,
    src, origin: src ? !/cache/.test(src) : null, builtAt: Date.now() };   // 계측: 출처·원본여부·생성시각
}
const _fullInflight = new Map();
function fullBuildOnce(k, sport, date, tz) {
  const ex = _fullInflight.get(k);
  if (ex) { METRICS.cache.merge++; return ex; }
  const p = buildFullGames(sport, date, tz).finally(() => { _fullInflight.delete(k); });
  _fullInflight.set(k, p);
  return p;
}
async function fullGamesCached(sport, date, tz, ttl = sportTtl(sport)) {
  const k = sport + '|' + date + '|' + (tz || ''); const hit = fullGamesCache.get(k), now = Date.now();
  if (hit) {
    const age = now - hit.t;
    // 🕒 아주 오래된 캐시(복귀 유저, 30초 초과)면 새로 받아서 반환 — single-flight로 동시요청 1건만
    if (age > 30000) {
      METRICS.cache.miss++;
      try { const v = await fullBuildOnce(k, sport, date, tz); const keepPrev = v && v.apiErrors && (!v.games || v.games.length === 0) && hit.v && hit.v.games && hit.v.games.length > 0; if (!keepPrev) fullGamesCache.set(k, { t: Date.now(), v }); else hit.t = Date.now(); return keepPrev ? hit.v : v; }
      catch { return hit.v; }
    }
    if (age >= ttl && !_fullInflight.has(k)) { METRICS.cache.refresh++; fullBuildOnce(k, sport, date, tz).then(v => { const cur = fullGamesCache.get(k); const keepPrev = v && v.apiErrors && (!v.games || v.games.length === 0) && cur && cur.v && cur.v.games && cur.v.games.length > 0; if (keepPrev) { cur.t = Date.now(); } else { fullGamesCache.set(k, { t: Date.now(), v }); } }).catch(() => {}); }
    METRICS.cache.hit++;
    return hit.v;
  }
  METRICS.cache.miss++;
  const v = await fullBuildOnce(k, sport, date, tz); fullGamesCache.set(k, { t: Date.now(), v }); return v;
}
// 🔥 기본 피드 백그라운드 워머 (항상 캐시를 데워둬 첫 로드 즉시 응답)
let _warmN = 0;
function warmFeeds() {
  try {
    const tz = 'Asia/Seoul';
    const d = (typeof ymdInTz === 'function') ? ymdInTz(new Date(), tz) : new Date().toISOString().slice(0, 10);
    fullGamesCached('basketball', d, tz).catch(() => {});         // 🏀 농구(Goalserve) 워밍 — API-Sports 키 불필요
    // 🏐🏒 배구·하키도 워밍(더스포츠) — 캐시가 식어 콜드 요청이 타임아웃되는 현상 방지(배구 빈화면 수정)
    if (TS_ON) {
      fullGamesCached('volleyball', d, tz).catch(() => {});   // 🏐 매 사이클(20초) 워밍 — 콜드 6초 지연 윈도 제거
      fullGamesCached('hockey', d, tz).catch(() => {});       // 🏒 매 사이클 워밍
    }
    if (APISPORTS_KEY) {
      fullGamesCached('football', d, tz).catch(() => {});         // 축구는 매 사이클 워밍 → 항상 뜨겁게
      if (_warmN % 2 === 0) fullGamesCached('baseball', d, tz).catch(() => {}); // 야구는 40초마다
    }
    _warmN++;
  } catch (e) {}
}
setTimeout(warmFeeds, 1500); setInterval(warmFeeds, 20000);
app.get('/api/asports/games', async (req, res) => {
  // 🏀 농구는 Goalserve 사용(API-Sports 키 불필요) → 키 없어도 통과
  if (!APISPORTS_KEY && req.query.sport !== 'basketball') return res.json({ needKey: true, games: [] });
  const sport = req.query.sport || 'football';
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const cfg = AS[sport]; if (!cfg) return res.status(400).json({ error: 'bad sport' });
  res.set('Cache-Control', 'no-store');   // 라이브 점수: 중간 캐시(브라우저·CDN)가 과거 응답 재사용 금지 — 항상 origin 최신
  try { const v = await fullGamesCached(sport, date, req.query.tz); const ageMs = v && v.builtAt ? (Date.now() - v.builtAt) : null; res.json(Object.assign({}, v, { ageMs, ageSec: ageMs != null ? Math.round(ageMs / 1000) : null })); }
  catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});
// 🔎 피드 진단(공개·비밀정보 없음): 종목별 출처(원본/캐시)·데이터 나이·마지막 정상수신 시각.
//    30분 안정성 관찰·'원본조회 성공 vs 타임아웃 후 캐시반환' 구분용. 캐시만 읽고 원본 호출 안 함.
app.get('/api/diag/feeds', (req, res) => {
  const tz = 'Asia/Seoul';
  const d = (typeof ymdInTz === 'function') ? ymdInTz(new Date(), tz) : new Date().toISOString().slice(0, 10);
  const out = {}; const now = Date.now();
  for (const sp of ['football', 'basketball', 'volleyball', 'baseball', 'hockey']) {
    const k = sp + '|' + d + '|' + tz;
    const hit = fullGamesCache.get(k);
    const gk1 = 'TS|' + sp + '|' + d + '|' + tz, gk2 = 'GS|' + sp + '|' + d + '|' + tz;
    const lg = _lastGoodMinor.get(gk1) || _lastGoodMinor.get(gk2);
    out[sp] = {
      cached: !!hit,
      src: hit && hit.v ? hit.v.src : null,
      origin: hit && hit.v ? hit.v.origin : null,
      count: hit && hit.v ? hit.v.count : null,
      ageSec: hit ? Math.round((now - hit.t) / 1000) : null,
      lastGoodAgeSec: lg ? Math.round((now - lg.t) / 1000) : null,
      building: _fullInflight.has(k),
      tsCircuitOpen: tsCircuitOpen(sp)
    };
  }
  res.json({ at: new Date().toISOString(), uptimeSec: Math.round((Date.now() - METRICS.startAt) / 1000), version: APP_VERSION, out });
});// 축구 실시간 이벤트 (골·퇴장·경고·교체) — 선수 이름 포함 (API-Sports 축구만 제공)
app.get('/api/asports/events', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true, events: [] });
  const fixture = req.query.fixture;
  if (!fixture) return res.status(400).json({ error: 'need fixture' });
  try {
    const j = await asRaw('football', `/fixtures/events?fixture=${encodeURIComponent(fixture)}`, 12000);
    const events = (j.response || []).map(ev => ({
      minute: ev.time ? ev.time.elapsed : null,
      extra: ev.time ? ev.time.extra : null,
      team: ev.team ? ev.team.name : '',
      teamId: ev.team ? ev.team.id : null,
      type: ev.type || '',
      detail: ev.detail || '',
      player: ev.player ? ev.player.name : '',
      pid: ev.player ? ev.player.id : null,
      assist: ev.assist ? ev.assist.name : ''
    }));
    res.json({ events });
  } catch (e) { res.status(502).json({ error: String(e.message || e), events: [] }); }
});

// 축구 선발 라인업 (선발11·포메이션·grid 좌표·교체·감독) — API-Sports 축구
app.get('/api/asports/lineups', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true, teams: [] });
  const fixture = req.query.fixture;
  if (!fixture) return res.status(400).json({ error: 'need fixture' });
  try {
    // ✅ 확정 라인업(startXI≥11)이 한 번 잡히면 6시간 고정(안 바뀜) → 재호출 없이 즉시 응답
    const OKK = 'LUOK:' + fixture, okHit = cache.get(OKK);
    if (okHit && Date.now() - okHit.t < 6 * 3600 * 1000) return res.json(okHit.v);
    // 확정 전(빈 응답)은 45초만 캐시 → 경기 시작 후 확정 명단 뜨면 최대 45초 내 전환
    const j = await asRaw('football', `/fixtures/lineups?fixture=${encodeURIComponent(fixture)}`, 45000);
    const teams = (j.response || []).map(t => ({
      team: t.team ? t.team.name : '', logo: t.team ? t.team.logo : '',
      formation: t.formation || '',
      coach: t.coach ? t.coach.name : '',
      startXI: (t.startXI || []).map(x => ({ id: x.player.id, name: x.player.name, number: x.player.number, pos: x.player.pos, grid: x.player.grid, photo: x.player.id ? ('https://media.api-sports.io/football/players/' + x.player.id + '.png') : '' })),
      subs: (t.substitutes || []).map(x => ({ id: x.player.id, name: x.player.name, number: x.player.number, pos: x.player.pos, photo: x.player.id ? ('https://media.api-sports.io/football/players/' + x.player.id + '.png') : '' }))
    }));
    const out = { teams };
    if (teams.length >= 2 && (teams[0].startXI || []).length >= 11) cache.set(OKK, { t: Date.now(), v: out });
    res.json(out);
  } catch (e) { res.status(502).json({ error: String(e.message || e), teams: [] }); }
});

// ⚽ 예상 라인업 — 각 팀의 "직전 종료 경기 선발 XI"를 예측으로 사용 (확정 라인업 나오기 전 표시용)
async function fbLastLineup(teamId) {
  try {
    const j = await asRaw('football', `/fixtures?team=${teamId}&last=6&timezone=Asia/Seoul`, 3 * 3600 * 1000);
    const fins = (j.response || []).filter(fx => ['FT', 'AET', 'PEN'].includes(fx.fixture && fx.fixture.status && fx.fixture.status.short));
    for (const fx of fins) {
      const lu = await asRaw('football', `/fixtures/lineups?fixture=${fx.fixture.id}`, 24 * 3600 * 1000).catch(() => ({}));
      const mine = (lu.response || []).find(t => t.team && t.team.id === teamId);
      if (mine && (mine.startXI || []).length >= 11) {
        return {
          team: mine.team.name, logo: mine.team.logo, formation: mine.formation || '',
          coach: mine.coach ? mine.coach.name : '',
          startXI: (mine.startXI || []).map(x => ({ id: x.player.id, name: x.player.name, number: x.player.number, pos: x.player.pos, grid: x.player.grid, photo: x.player.id ? ('https://media.api-sports.io/football/players/' + x.player.id + '.png') : '' })),
          subs: (mine.substitutes || []).map(x => ({ id: x.player.id, name: x.player.name, number: x.player.number, pos: x.player.pos, photo: x.player.id ? ('https://media.api-sports.io/football/players/' + x.player.id + '.png') : '' })),
          fromDate: fx.fixture.date
        };
      }
    }
  } catch { }
  return null;
}
app.get('/api/football/predlineup', async (req, res) => {
  const homeId = parseInt(req.query.home, 10), awayId = parseInt(req.query.away, 10);
  if (!homeId || !awayId) return res.json({ found: false });
  try {
    const [h, a] = await Promise.all([fbLastLineup(homeId), fbLastLineup(awayId)]);
    const teams = [];
    if (h) teams.push(h); if (a) teams.push(a);
    res.json({ found: teams.length === 2, predicted: true, teams });
  } catch (e) { res.json({ found: false, error: String(e.message || e) }); }
});

// ⚾ MLB 예상 라인업 — 각 팀 직전 경기 타순(선발 야수) + 이 경기 예상 선발투수
async function mlbLastLineup(teamId, sportId, date) {
  const recent = await mlbRecent(teamId, sportId, date).catch(() => []);
  for (const g of recent) {
    if (!g.gamePk) continue;
    try {
      const box = await mlbFetch(`/api/v1/game/${g.gamePk}/boxscore`, 6 * 3600 * 1000);
      for (const side of ['home', 'away']) {
        const T = box.teams[side]; if (!T || !T.team || T.team.id !== teamId) continue;
        const players = T.players || {};
        const arr = Object.values(players).filter(p => p.battingOrder).map(p => ({
          bo: parseInt(p.battingOrder, 10), id: p.person.id, name: p.person.fullName,
          pos: p.position ? p.position.abbreviation : '', number: p.jerseyNumber || ''
        }));
        const lineup = arr.filter(p => p.bo % 100 === 0).sort((a, b) => a.bo - b.bo).map((p, i) => ({ order: i + 1, id: p.id, name: p.name, pos: p.pos, number: p.number }));
        if (lineup.length) return { lineup, fromDate: g.date || null };
      }
    } catch { }
  }
  return { lineup: [] };
}
app.get('/api/mlb/predlineup', async (req, res) => {
  const { home, away } = req.query, date = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const f = await mlbFindGame(home, away, date);
    if (!f) return res.json({ found: false });
    const hId = f.swap ? f.awayId : f.homeId, aId = f.swap ? f.homeId : f.awayId;
    // 이 경기 예상 선발투수 (schedule hydrate)
    let hp = null, ap = null;
    try {
      const sg = await mlbFetch(`/api/v1/schedule?sportId=${f.sportId}&gamePk=${f.gamePk}&hydrate=probablePitcher`, 3600000);
      const gg = ((sg.dates || [])[0] || {}).games || [];
      const g0 = gg[0];
      if (g0) {
        const hpp = g0.teams.home.probablePitcher, app_ = g0.teams.away.probablePitcher;
        const mk = pp => pp ? { id: pp.id, name: pp.fullName, pos: 'P' } : null;
        hp = f.swap ? mk(app_) : mk(hpp); ap = f.swap ? mk(hpp) : mk(app_);
      }
    } catch { }
    const [hL, aL] = await Promise.all([mlbLastLineup(hId, f.sportId, date), mlbLastLineup(aId, f.sportId, date)]);
    res.json({ found: true, predicted: true, home: { lineup: hL.lineup, pitcher: hp, fromDate: hL.fromDate }, away: { lineup: aL.lineup, pitcher: ap, fromDate: aL.fromDate } });
  } catch (e) { res.json({ found: false, error: String(e.message || e) }); }
});

// ⚽ TheSports 축구 라인업 폴백 (API-Sports가 K/J리그 라인업을 안 줄 때) — 팀명+날짜로 매칭 후 라인업+선수사진
const FB_PLAYER = new Map();   // TheSports 축구 선수 id -> {name, logo}
async function tsFbPlayer(pid) {
  if (!pid) return {};
  if (FB_PLAYER.has(pid)) return FB_PLAYER.get(pid);
  let v = {};
  try { const r = await tsFetch('/football/player/list', { uuid: pid }, 5000); const p = (r.results || [])[0]; if (p) v = { name: p.name || '', logo: p.logo || '' }; } catch (e) {}
  FB_PLAYER.set(pid, v); return v;
}
const tsFbIsStarter = p => p.first === 1 || p.first === true || p.first === '1' || p.type === 1 || p.on_bench === 0;
async function tsFbBuildSide(arr) {
  if (!Array.isArray(arr)) return { xi: [], subs: [] };
  const mk = async p => { const pid = p.id || p.player_id || p.uuid; const info = await tsFbPlayer(pid); return { id: pid, name: p.name || info.name || '', number: (p.shirt_number != null ? p.shirt_number : (p.number != null ? p.number : '')), pos: p.position || p.pos || '', grid: '', photo: p.logo || info.logo || '' }; };
  const st = arr.filter(tsFbIsStarter), sb = arr.filter(p => !tsFbIsStarter(p));
  return { xi: await Promise.all(st.slice(0, 11).map(mk)), subs: await Promise.all(sb.slice(0, 12).map(mk)) };
}
// ⭐ TheSports 축구 라인업 파서(재사용) — uuid로 조회 → 표준 teams 반환. raw=true면 원본 구조도 함께.
async function tsFootLineup(tsid, wantRaw) {
  // TheSports 라인업 — 올바른 경로는 /lineup/detail (plan 포함). /lineup·/lineup/list는 권한 미인증이라 폴백용.
  const paths = ['/football/match/lineup/detail', '/football/match/lineup'];
  let lu = null, usedPath = null, tries = [];
  for (const p of paths) {
    const resp = await tsFetch(p, { uuid: tsid }, 8000).catch(e => ({ err: String((e && e.message) || e) }));
    const rr = (resp && resp.results) ? resp.results : (resp || {});
    const ha = (rr.lineup && rr.lineup.home) || rr.home || rr.home_players || (Array.isArray(rr.lineup) ? rr.lineup[0] : null) || [];
    tries.push({ path: p, err: resp && resp.err, hasData: (ha || []).length > 0, topKeys: rr && typeof rr === 'object' ? Object.keys(rr).slice(0, 6) : null });
    if ((ha || []).length) { lu = resp; usedPath = p; break; }
    if (!lu) lu = resp; // 첫 응답 보관(에러 메시지 표시용)
  }
  const r = (lu && lu.results) ? lu.results : (lu || {});
  // TheSports 응답 변형 모두 수용: results.lineup.{home,away} / results.{home,away} / results.lineup[0..1]
  let homeArr = (r.lineup && r.lineup.home) || r.home || r.home_players || (Array.isArray(r.lineup) ? r.lineup[0] : null) || [];
  let awayArr = (r.lineup && r.lineup.away) || r.away || r.away_players || (Array.isArray(r.lineup) ? r.lineup[1] : null) || [];
  const dbg = wantRaw ? { usedPath, tries, topKeys: r && typeof r === 'object' ? Object.keys(r) : null, lineupKeys: r.lineup && typeof r.lineup === 'object' ? Object.keys(r.lineup) : null, confirmed: r.confirmed, homeLen: (homeArr || []).length, awayLen: (awayArr || []).length, sampleHome: (homeArr || [])[0] || null } : null;
  if (!(homeArr || []).length && !(awayArr || []).length) return { teams: null, debug: dbg };
  const H = await tsFbBuildSide(homeArr), A = await tsFbBuildSide(awayArr);
  const teams = [
    { team: '', logo: '', formation: r.home_formation || (r.home && r.home.formation) || '', coach: (r.home_coach && r.home_coach.name) || '', startXI: H.xi, subs: H.subs },
    { team: '', logo: '', formation: r.away_formation || (r.away && r.away.formation) || '', coach: (r.away_coach && r.away_coach.name) || '', startXI: A.xi, subs: A.subs }
  ];
  return { teams, debug: dbg, confirmed: r.confirmed };
}
// ③ 직전 경기 선발(참고용) — 팀의 가장 최근 종료 경기에서 그 팀의 선발을 가져온다. 당시 날짜·상대 포함.
async function lastMatchLineup(teamId) {
  try {
    const fj = await asRaw('football', `/fixtures?team=${teamId}&last=1&timezone=Asia/Seoul`, 2 * 3600e3);
    const fx = (fj.response || [])[0]; if (!fx) return null;
    const fid = fx.fixture.id;
    const iAmHome = fx.teams.home && fx.teams.home.id === teamId;
    const opp = iAmHome ? (fx.teams.away && fx.teams.away.name) : (fx.teams.home && fx.teams.home.name);
    const lj = await asRaw('football', `/fixtures/lineups?fixture=${fid}`, 24 * 3600e3);
    const block = (lj.response || []).find(b => b.team && b.team.id === teamId);
    if (!block || !(block.startXI || []).length) return null;
    const mkP = x => ({ id: x.player && x.player.id, name: (x.player && x.player.name) || '', number: (x.player && x.player.number != null) ? x.player.number : '', pos: (x.player && x.player.pos) || '', grid: (x.player && x.player.grid) || '', photo: (x.player && x.player.id) ? ('https://media.api-sports.io/football/players/' + x.player.id + '.png') : '' });
    return {
      team: (block.team && block.team.name) || '', logo: (block.team && block.team.logo) || '',
      formation: block.formation || '', coach: (block.coach && block.coach.name) || '',
      startXI: (block.startXI || []).map(mkP), subs: (block.substitutes || []).map(mkP),
      lastDate: (fx.fixture && fx.fixture.date) || null, lastOpp: opp || ''
    };
  } catch (e) { return null; }
}
app.get('/api/football/lineup', async (req, res) => {
  const home = req.query.home, away = req.query.away, debug = req.query.debug;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const fixtureId = req.query.fixture;
  const wantRaw = req.query.raw === '1';
  // ⭐ 더스포츠 경기(id 'ts' 접두): 경기 id로 라인업 직접 조회
  if (/^ts/.test(String(fixtureId || ''))) {
    if (!TS_ON) return res.json({ teams: [] });
    try {
      const tsid = String(fixtureId).replace(/^ts/, '');
      const lr = await tsFootLineup(tsid, wantRaw);
      if (!lr.teams) return res.json({ teams: [], note: 'no-lineup', src: 'thesports-id', kind: 'confirmed', debug: wantRaw ? lr.debug : undefined });
      lr.teams[0].team = home || lr.teams[0].team; lr.teams[1].team = away || lr.teams[1].team;
      return res.json({ teams: lr.teams, src: 'thesports-id', kind: 'confirmed', debug: wantRaw ? lr.debug : undefined });
    } catch (e) { return res.json({ teams: [], error: String(e.message || e) }); }
  }
  // 1) ⭐ 라인업 우선순위: ① TheSports(계약 메인·중상급 커버) → ② API-Football 확정 → ③ 직전 경기(참고용)
  if (fixtureId && APISPORTS_KEY) {
    // ① TheSports 라인업 — ts 경기면 tsid 전달받아 메인 소스로 먼저 시도
    const tsid2 = req.query.tsid ? String(req.query.tsid).replace(/^ts/, '') : '';
    if (tsid2 && TS_ON) {
      try {
        const lr = await tsFootLineup(tsid2, wantRaw);
        if (lr.teams && ((lr.teams[0].startXI || []).length || (lr.teams[1].startXI || []).length)) {
          lr.teams[0].team = home || lr.teams[0].team; lr.teams[1].team = away || lr.teams[1].team;
          return res.json({ teams: lr.teams, src: 'thesports', kind: 'confirmed', debug: wantRaw ? lr.debug : undefined });
        }
        if (wantRaw) return res.json({ teams: [], note: 'ts-no-lineup', debug: lr.debug });
      } catch (e) {}
    }
    // ② API-Football 확정 라인업 (TheSports가 해당 경기를 커버 안 할 때 보완)
    try {
      const j = await asRaw('football', `/fixtures/lineups?fixture=${encodeURIComponent(fixtureId)}`, 45000);
      const arr = j.response || [];
      if (arr.length >= 2 && (arr[0].startXI || []).length) {
        const mkP = x => ({ id: x.player && x.player.id, name: (x.player && x.player.name) || '', number: (x.player && x.player.number != null) ? x.player.number : '', pos: (x.player && x.player.pos) || '', grid: (x.player && x.player.grid) || '', photo: (x.player && x.player.id) ? ('https://media.api-sports.io/football/players/' + x.player.id + '.png') : '' });
        const mkT = a => ({ team: (a.team && a.team.name) || '', logo: (a.team && a.team.logo) || '', formation: a.formation || '', coach: (a.coach && a.coach.name) || '', startXI: (a.startXI || []).map(mkP), subs: (a.substitutes || []).map(mkP) });
        return res.json({ teams: [mkT(arr[0]), mkT(arr[1])], src: 'apifootball', kind: 'confirmed' });
      }
    } catch (e) {}
    // ③ 확정 라인업이 아직 없을 때 — 직전 경기 선발(참고용). homeId/awayId 있을 때만. '예상'/'확정'으로 둔갑시키지 않음.
    const hId = parseInt(req.query.homeId, 10), aId = parseInt(req.query.awayId, 10);
    if (hId && aId) {
      try {
        const side = await lastMatchLineup(hId), side2 = await lastMatchLineup(aId);
        if ((side && side.startXI.length) || (side2 && side2.startXI.length)) {
          const nmH = home || (side && side.team) || '', nmA = away || (side2 && side2.team) || '';
          return res.json({ kind: 'last', src: 'apifootball-last', teams: [
            side ? Object.assign({ team: nmH }, side) : { team: nmH, startXI: [], subs: [] },
            side2 ? Object.assign({ team: nmA }, side2) : { team: nmA, startXI: [], subs: [] }
          ] });
        }
      } catch (e) {}
    }
  }
  // 2) TheSports 폴백 (구독 시)
  if (!TS_ON) return res.json({ teams: [] });
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nh = norm(home), na = norm(away);
  const fit = (a, b) => a && b && (a.includes(b) || b.includes(a));
  try {
    // 1) TheSports 경기 찾기 (당일·전날·다음날)
    const prev = new Date(Date.parse(date + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
    const next = new Date(Date.parse(date + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
    let match = null, swap = false, diag = [];
    for (const dt of [date, prev, next]) {
      const games = await tsFootballGames(dt).catch(e => { diag.push({ dt, err: String(e.message || e) }); return []; });
      diag.push({ dt, count: games.length, sample: games.slice(0, 8).map(g => ({ home: g.home, away: g.away, league: g.league })) });
      match = games.find(g => fit(norm(g.home), nh) && fit(norm(g.away), na));
      if (match) break;
      const sw = games.find(g => fit(norm(g.home), na) && fit(norm(g.away), nh));
      if (sw) { match = sw; swap = true; break; }
    }
    if (!match) return res.json({ teams: [], reason: 'no-match', diag: debug ? diag : undefined });
    // 2) 라인업
    const lu = await tsFetch('/football/match/lineup', { uuid: match.id }, 8000).catch(() => null);
    if (debug) return res.json({ matchId: match.id, home: match.home, away: match.away, raw: lu });
    const r = (lu && lu.results) ? lu.results : (lu || {});
    const homeArr = (r.lineup && r.lineup.home) || r.home || r.home_players || [];
    const awayArr = (r.lineup && r.lineup.away) || r.away || r.away_players || [];
    const hForm = r.home_formation || r.homeFormation || (r.home && r.home.formation) || '';
    const aForm = r.away_formation || r.awayFormation || (r.away && r.away.formation) || '';
    const isStarter = p => p.first === 1 || p.first === true || p.first === '1' || p.type === 1 || p.on_bench === 0;
    const build = async arr => {
      if (!Array.isArray(arr)) return { xi: [], subs: [] };
      const mk = async p => {
        const pid = p.id || p.player_id || p.uuid;
        const info = await tsFbPlayer(pid);
        return { id: pid, name: p.name || info.name || '', number: (p.shirt_number != null ? p.shirt_number : (p.number != null ? p.number : '')), pos: p.position || p.pos || '', grid: '', photo: p.logo || info.logo || '' };
      };
      const st = arr.filter(isStarter), sb = arr.filter(p => !isStarter(p));
      return { xi: await Promise.all(st.slice(0, 11).map(mk)), subs: await Promise.all(sb.slice(0, 12).map(mk)) };
    };
    const H = await build(homeArr), A = await build(awayArr);
    const t1 = { team: match.home, logo: match.homeLogo, formation: hForm, coach: (r.home_coach && r.home_coach.name) || '', startXI: H.xi, subs: H.subs };
    const t2 = { team: match.away, logo: match.awayLogo, formation: aForm, coach: (r.away_coach && r.away_coach.name) || '', startXI: A.xi, subs: A.subs };
    res.json({ teams: [t1, t2], src: 'thesports', swap });
  } catch (e) { res.json({ teams: [], error: String(e.message || e) }); }
});
// ⚽ 축구 경기 흐름/이벤트 (더스포츠 경기) — detail_live 1회에서 해당 경기 tlive 추출
app.get('/api/football/live', async (req, res) => {
  const raw = String(req.query.id || '');
  if (!/^ts/.test(raw)) return res.json({ note: 'not-thesports', events: [] });
  const id = raw.replace(/^ts/, '');
  try {
    const lv = await tsFetch('/football/match/detail_live', {}, 5000).catch(() => null);
    const list = (lv && lv.results) || [];
    const item = list.find(x => x && String(x.id || (x.score && x.score[0])) === String(id));
    if (!item) return res.json({ found: false, events: [] });
    let lines = []; const tl = item.tlive || item.incidents;
    if (Array.isArray(tl) && tl.length) lines = Array.isArray(tl[0]) ? tl[0] : tl;
    const evs = [];
    lines.forEach(L => {
      if (Array.isArray(L)) {
        // 배열형: [type, minute, team, ...] 또는 [period, "mm:ss", team, ?, score, text]
        const txt = L[5] || L[4] || '';
        evs.push({ minute: (typeof L[1] === 'number' ? L[1] : (String(L[1] || '').match(/\d+/) || [''])[0]), team: +L[2] || 0, text: String(txt), type: L[0] });
      } else if (L && typeof L === 'object') {
        evs.push({ minute: L.minute != null ? L.minute : (L.time || ''), team: (L.position || L.team || 0), text: L.text || L.detail || '', type: L.type });
      }
    });
    res.json({ found: true, events: evs.slice(-120).reverse() });
  } catch (e) { res.json({ error: String(e.message || e), events: [] }); }
});

// ⚽ 축구 상대전적(H2H) + 최근 10경기 — API-Football (팀 ID 기준)
//    프론트 이벤트의 homeId/awayId 를 그대로 넘겨받아 조회한다.
function fbFixRow(fx, myId) {
  // 내 팀 관점의 승/무/패 + 상대/스코어
  const t = fx.teams || {}, g = fx.goals || {};
  const iAmHome = t.home && t.home.id === myId;
  const my = iAmHome ? g.home : g.away;
  const op = iAmHome ? g.away : g.home;
  const opName = iAmHome ? (t.away && t.away.name) : (t.home && t.home.name);
  const win = my != null && op != null && my > op;
  const draw = my != null && op != null && my === op;
  return {
    date: (fx.fixture && fx.fixture.date) || null,
    win, draw,
    opp: opName || '',
    ts: my != null ? my : '-',
    os: op != null ? op : '-',
    league: (fx.league && fx.league.name) || ''
  };
}
async function fbTeamRecent(teamId) {
  try {
    const j = await asRaw('football', `/fixtures?team=${teamId}&last=10&timezone=Asia/Seoul`, 6 * 3600 * 1000);
    const list = (j.response || []).filter(fx => {
      const s = fx.fixture && fx.fixture.status && fx.fixture.status.short;
      return ['FT', 'AET', 'PEN'].includes(s);   // 종료 경기만
    });
    return list.map(fx => fbFixRow(fx, teamId)).reverse().slice(0, 10);
  } catch { return []; }
}
async function fbH2H(homeId, awayId) {
  try {
    const j = await asRaw('football', `/fixtures/headtohead?h2h=${homeId}-${awayId}&last=10&timezone=Asia/Seoul`, 6 * 3600 * 1000);
    const list = (j.response || []).filter(fx => {
      const s = fx.fixture && fx.fixture.status && fx.fixture.status.short;
      return ['FT', 'AET', 'PEN'].includes(s);
    });
    return list.map(fx => {
      const t = fx.teams || {}, g = fx.goals || {};
      return {
        date: (fx.fixture && fx.fixture.date) || null,
        hId: (t.home && t.home.id) != null ? t.home.id : null, aId: (t.away && t.away.id) != null ? t.away.id : null,
        hName: (t.home && t.home.name) || '', aName: (t.away && t.away.name) || '',
        hs: g.home != null ? g.home : '-', as: g.away != null ? g.away : '-'
      };
    }).reverse().slice(0, 10);
  } catch { return []; }
}
app.get('/api/football/info', async (req, res) => {
  const homeId = parseInt(req.query.home, 10), awayId = parseInt(req.query.away, 10);
  if (!homeId || !awayId) return res.json({ found: false });
  try {
    const [rh, ra, h2h] = await Promise.all([
      fbTeamRecent(homeId), fbTeamRecent(awayId), fbH2H(homeId, awayId)
    ]);
    const found = rh.length || ra.length || h2h.length;
    res.json({ found: !!found, recent: { home: rh, away: ra }, h2h });
  } catch (e) { res.json({ found: false, error: String(e.message || e) }); }
});

// 🔗 TheSports 경기 → API-Football fixture/team id 매핑 (팀명+날짜).
//    TheSports에서 스코어를 받는 주요리그 경기에 대해 평점·상세통계·H2H(API-Football)를 붙이기 위한 해결자.
//    결과는 영속 캐시(경기 id는 고정). 이름만 비슷한 다른 경기를 연결하지 않도록 양 팀 모두 일치해야 함.
const _fixMapCache = new Map();  // key: home|away|date → {fixtureId, homeId, awayId, league} | {found:false}
async function resolveApiFixture(home, away, date) {
  const key = String(home).toLowerCase() + '|' + String(away).toLowerCase() + '|' + date;
  const hit = _fixMapCache.get(key);
  if (hit && (hit.found || Date.now() - hit.t < 6 * 3600e3)) return hit;
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nh = norm(home), na = norm(away), fit = (a, b) => a && b && (a.includes(b) || b.includes(a));
  // 당일·전후 1일(타임존 경계) 조회
  const days = [date,
    new Date(Date.parse(date + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10),
    new Date(Date.parse(date + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10)];
  for (const d of days) {
    const jj = await asRaw('football', `/fixtures?date=${d}&timezone=Asia/Seoul`, 6 * 3600e3).catch(() => null);
    const list = (jj && jj.response) || [];
    let fx = list.find(f => fit(norm(f.teams.home.name), nh) && fit(norm(f.teams.away.name), na));
    let swap = false;
    if (!fx) { fx = list.find(f => fit(norm(f.teams.home.name), na) && fit(norm(f.teams.away.name), nh)); if (fx) swap = true; }
    if (fx) {
      const val = { found: true, t: Date.now(), fixtureId: fx.fixture.id,
        homeId: swap ? fx.teams.away.id : fx.teams.home.id, awayId: swap ? fx.teams.home.id : fx.teams.away.id,
        league: fx.league && fx.league.name, swap };
      _fixMapCache.set(key, val); return val;
    }
  }
  const miss = { found: false, t: Date.now() };
  _fixMapCache.set(key, miss); return miss;
}
app.get('/api/football/fixmap', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true, found: false });
  const { home, away } = req.query, date = req.query.date || new Date().toISOString().slice(0, 10);
  if (!home || !away) return res.status(400).json({ error: 'need home & away' });
  try { res.json(await resolveApiFixture(home, away, date)); }
  catch (e) { res.json({ found: false, error: String(e.message || e) }); }
});
// 🔎 진단: 특정 경기(팀명+날짜)의 API-Sports fixture id + 라인업/통계 실제 응답 확인
app.get('/api/asports/probe', async (req, res) => {
  const { home, away } = req.query, date = req.query.date || new Date().toISOString().slice(0, 10);
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nh = norm(home), na = norm(away), fit = (a, b) => a && b && (a.includes(b) || b.includes(a));
  try {
    const jj = await asRaw('football', `/fixtures?date=${date}&timezone=Asia/Seoul`, 15000);
    const list = jj.response || [];
    const fx = list.find(f => fit(norm(f.teams.home.name), nh) && fit(norm(f.teams.away.name), na))
            || list.find(f => fit(norm(f.teams.home.name), na) && fit(norm(f.teams.away.name), nh));
    if (!fx) return res.json({ found: false, dayCount: list.length, sample: list.slice(0, 6).map(f => ({ h: f.teams.home.name, a: f.teams.away.name, lg: f.league.name })) });
    const id = fx.fixture.id;
    const [lu, st] = await Promise.all([
      asRaw('football', `/fixtures/lineups?fixture=${id}`, 12000).catch(e => ({ error: String(e.message || e) })),
      asRaw('football', `/fixtures/statistics?fixture=${id}`, 12000).catch(e => ({ error: String(e.message || e) }))
    ]);
    const l0 = (lu.response || [])[0];
    res.json({
      found: true, fixtureId: id, league: fx.league.name, status: fx.fixture.status,
      lineups: { count: (lu.response || []).length, errors: lu.errors, sample: l0 ? { team: l0.team.name, formation: l0.formation, xi: (l0.startXI || []).length, subs: (l0.substitutes || []).length } : null },
      statistics: { count: (st.response || []).length, errors: st.errors, sample: (st.response || [])[0] ? (st.response[0].statistics || []).slice(0, 4) : null }
    });
  } catch (e) { res.json({ error: String(e.message || e) }); }
});
// ⚽ 축구 팀 경기 스탯 (점유율·슈팅·코너·파울 등) — API-Sports /fixtures/statistics
app.get('/api/asports/fbstats', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true, teams: [] });
  const fixture = req.query.fixture;
  if (!fixture) return res.status(400).json({ error: 'need fixture' });
  try {
    const j = await asRaw('football', `/fixtures/statistics?fixture=${encodeURIComponent(fixture)}`, 30000);
    const teams = (j.response || []).map(t => ({
      team: t.team ? t.team.name : '', logo: t.team ? t.team.logo : '',
      stats: (t.statistics || []).map(s => ({ type: s.type, value: s.value }))
    }));
    res.json({ teams });
  } catch (e) { res.status(502).json({ error: String(e.message || e), teams: [] }); }
});

// ⚽ 경기별 선수 평점/기록 (API-Football /fixtures/players) — 01 '오늘의 주요선수' + 06 최근경기 평점용.
//    평점은 공급사 제공값만 사용(임의 계산 금지). 미제공 시 rating=null.
app.get('/api/football/fixplayers', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true, players: [] });
  const fixture = req.query.fixture;
  if (!fixture) return res.status(400).json({ error: 'need fixture' });
  try {
    const j = await asRaw('football', `/fixtures/players?fixture=${encodeURIComponent(fixture)}`, 10 * 60 * 1000);
    const out = [];
    (j.response || []).forEach(teamBlock => {
      const teamName = (teamBlock.team && teamBlock.team.name) || '';
      const teamId = (teamBlock.team && teamBlock.team.id) || null;
      (teamBlock.players || []).forEach(p => {
        const st = (p.statistics || [])[0] || {};
        const games = st.games || {};
        const goals = st.goals || {};
        out.push({
          pid: (p.player && p.player.id) || null,
          name: (p.player && p.player.name) || '',
          photo: (p.player && p.player.photo) || ((p.player && p.player.id) ? ('https://media.api-sports.io/football/players/' + p.player.id + '.png') : ''),
          team: teamName, teamId,
          number: games.number != null ? games.number : '',
          pos: games.position || '',
          minutes: games.minutes != null ? games.minutes : null,
          rating: games.rating != null ? Number(games.rating) : null,  // 공급사 평점(없으면 null)
          goals: goals.total != null ? goals.total : 0,
          assists: goals.assists != null ? goals.assists : 0,
          captain: !!games.captain
        });
      });
    });
    res.json({ players: out });
  } catch (e) { res.status(502).json({ error: String(e.message || e), players: [] }); }
});
// ⚽ 09 팀 분석 — API-Football /teams/statistics(시간대별 득실·폼·경기수) + 다음일정 난이도(상대 순위·홈원정).
//    선제골 승률 등 per-fixture 이벤트 집계가 필요한 지표는 과도한 호출을 피하려 이 단계에선 미제공(사유 표시).
app.get('/api/football/teamanalysis', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true });
  const teamId = req.query.team, leagueName = req.query.league || '';
  let season = req.query.season || '';
  if (!teamId) return res.status(400).json({ error: 'need team' });
  try {
    // 리그 ID 해석: ① 팀의 현재 리그에서 직접(가장 정확) → ② 이름 검색(국가 접두사 제거 폴백)
    let leagueId = null, dbg = {};
    try {
      const lj = await asRaw('football', `/leagues?team=${teamId}&current=true`, 86400e3);
      const arr = (lj && lj.response) || [];
      dbg.leaguesCount = arr.length; dbg.leaguesErr = lj && lj.errors;
      dbg.sample = arr.slice(0, 5).map(x => x.league && { id: x.league.id, name: x.league.name, type: x.league.type });
      const pick = arr.find(x => x.league && /league/i.test(x.league.type)) || arr[0];
      leagueId = pick && pick.league && pick.league.id;
    } catch (e) { dbg.ex = String(e.message || e); }
    if (!leagueId && leagueName) {
      leagueId = await asLeagueId('football', leagueName)
        || await asLeagueId('football', String(leagueName).replace(/^(english|spanish|italian|french|german|korean|japanese|portuguese|dutch|belgian|turkish|saudi|usa|american)\s+/i, ''));
      dbg.byName = leagueId;
    }
    if (!leagueId) return res.json({ found: false, note: 'league-unmapped', debug: req.query.debug ? dbg : undefined });
    if (!season) { const yr = new Date().getFullYear(); season = (new Date().getMonth() >= 6 ? yr : yr - 1); }  // 유럽 시즌: 하반기=당해
    const [stJ, nxJ, stdJ] = await Promise.all([
      asRaw('football', `/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`, 3600e3).catch(() => null),
      asRaw('football', `/fixtures?team=${teamId}&next=5&timezone=Asia/Seoul`, 1800e3).catch(() => null),
      asRaw('football', `/standings?league=${leagueId}&season=${season}`, 3600e3).catch(() => null)
    ]);
    const s = stJ && stJ.response;
    if (!s) return res.json({ found: false, note: 'no-stats', season });
    // 시간대별 득실(분 구간)
    const buckets = ['0-15', '16-30', '31-45', '46-60', '61-75', '76-90', '91-105', '106-120'];
    const gm = (s.goals && s.goals.for && s.goals.for.minute) || {};
    const ga = (s.goals && s.goals.against && s.goals.against.minute) || {};
    const byMinute = buckets.map(b => ({ b, f: (gm[b] && gm[b].total) || 0, a: (ga[b] && ga[b].total) || 0 })).filter(x => (gm[x.b] !== undefined || ga[x.b] !== undefined));
    // 순위맵(상대 난이도용)
    const stdRows = (() => {
      const g = (stdJ && stdJ.response && stdJ.response[0] && stdJ.response[0].league && stdJ.response[0].league.standings) || [];
      const flat = []; (Array.isArray(g) ? g : [g]).forEach(grp => (grp || []).forEach(r => flat.push(r)));
      return flat;
    })();
    const rankOf = id => { const r = stdRows.find(x => x.team && x.team.id === id); return r ? r.rank : null; };
    const totalTeams = stdRows.length || 20;
    const myRow = stdRows.find(x => x.team && String(x.team.id) === String(teamId));
    const next = ((nxJ && nxJ.response) || []).map(fx => {
      const home = fx.teams.home, away = fx.teams.away;
      const iAmHome = String(home.id) === String(teamId);
      const opp = iAmHome ? away : home;
      const oppRank = rankOf(opp.id);
      let diff = 'mid';
      if (oppRank != null) { const top = Math.ceil(totalTeams * 0.3), bot = Math.floor(totalTeams * 0.7); diff = oppRank <= top ? 'hard' : (oppRank > bot ? 'easy' : 'mid'); }
      if (!iAmHome && diff === 'easy') diff = 'mid'; else if (!iAmHome && diff === 'mid') diff = 'hard';  // 원정 가중
      return { date: fx.fixture.date, oppName: opp.name, oppLogo: opp.logo, oppRank, home: iAmHome, diff };
    });
    res.json({
      found: true, season, league: leagueName, teamId: Number(teamId),
      form: s.form || '', rank: myRow ? myRow.rank : null, points: myRow ? myRow.points : null,
      fixtures: s.fixtures || null, byMinute, next,
      cleanSheet: s.clean_sheet || null, failedToScore: s.failed_to_score || null,
      goalsForTotal: s.goals && s.goals.for && s.goals.for.total, goalsAgainstTotal: s.goals && s.goals.against && s.goals.against.total
    });
  } catch (e) { res.json({ found: false, error: String(e.message || e) }); }
});
// ⚽ 메인카드용 라이브 요약 통계 — 진행 중 경기만 서버에서 묶어서 1회 응답(개별 호출 금지 규칙 준수)
//    각 경기 stats 는 asRaw 캐시(60s) + 전체 응답 45s 캐시로 호출 제한을 지킴. 미제공은 null(0으로 채우지 않음).
const _liveStatsCache = new Map();
function _pickStat(arr, re) { for (const s of (arr || [])) { if (re.test(String(s.type))) { const v = s.value; return (v == null || v === '') ? null : v; } } return null; }
function _numOrNull(v) { if (v == null || v === '') return null; const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10); return isNaN(n) ? null : n; }
async function _fbStatSide(fixture) {
  const j = await asRaw('football', `/fixtures/statistics?fixture=${encodeURIComponent(fixture)}`, 60000).catch(() => null);
  const resp = (j && j.response) || [];
  if (resp.length < 2) return null;
  const side = t => {
    const st = t.statistics || [];
    return {
      poss: _pickStat(st, /possession/i),                 // "55%" 형태 유지
      shots: _numOrNull(_pickStat(st, /total shots/i)),
      sot: _numOrNull(_pickStat(st, /shots on goal|on target/i)),
      yc: _numOrNull(_pickStat(st, /yellow/i)),
      rc: _numOrNull(_pickStat(st, /red/i))
    };
  };
  return { team0: resp[0].team ? resp[0].team.name : '', team0Id: resp[0].team ? resp[0].team.id : null, a: side(resp[0]),
           team1: resp[1].team ? resp[1].team.name : '', team1Id: resp[1].team ? resp[1].team.id : null, b: side(resp[1]) };
}
app.get('/api/asports/livestats', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true, stats: {} });
  if (CFG.liveStatsOff) return res.json({ stats: {}, off: true });   // 쿼터 절약용 관리자 스위치
  const sport = req.query.sport || 'football';
  if (sport !== 'football') return res.json({ stats: {} });   // 현재 축구만 집계(타 종목은 상세에서 제공)
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const tz = req.query.tz || 'Asia/Seoul';
  const ck = 'ls|' + sport + '|' + date + '|' + tz;
  const hit = _liveStatsCache.get(ck), now = Date.now();
  if (hit && now - hit.t < 45000) return res.json(hit.v);
  try {
    const { games } = await buildGamesCoreCached(sport, date, tz).catch(() => ({ games: [] }));
    const live = (games || []).filter(g => g.state === 'live').slice(0, 40);   // 진행 중만, 최대 40경기
    const out = {};
    // 순차가 아니라 병렬이되 캐시로 대부분 즉시 반환
    await Promise.all(live.map(async g => {
      try {
        // 🔗 더스포츠 소스 경기(ts 접두)는 API-Sports fixture id 가 없어 통계 조회 실패 → 팀명+날짜로 fixture 해석 후 조회.
        //    resolveApiFixture 는 6h 캐시(일자별 fixtures 1회 공용) → 카드마다 중복 호출 없음(§08 호출량 보호).
        let fixtureId = g.id, resolvedHomeId = null, resolvedAwayId = null;
        if (!/^\d+$/.test(String(g.id))) {
          const rf = await resolveApiFixture(g.home, g.away, date).catch(() => null);
          if (!rf || !rf.found) return;
          fixtureId = rf.fixtureId; resolvedHomeId = rf.homeId; resolvedAwayId = rf.awayId;
        }
        const s = await _fbStatSide(fixtureId);
        if (!s) return;
        // §08 홈/원정 매핑: 가능하면 팀 ID 기준, 없으면 이름 매칭(실패 시 0=홈 가정)
        let home = s.a, away = s.b;
        if (resolvedHomeId != null && (s.team0Id != null || s.team1Id != null)) {
          if (String(s.team1Id) === String(resolvedHomeId)) { home = s.b; away = s.a; }
        } else {
          const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (norm(s.team1) === norm(g.home) || norm(s.team0) === norm(g.away)) { home = s.b; away = s.a; }
        }
        // 전부 null 이면 수록하지 않음(미제공)
        const any = o => o && (o.poss != null || o.shots != null || o.sot != null || o.yc != null || o.rc != null);
        if (any(home) || any(away)) out['' + g.id] = { home, away };
      } catch (_) { }
    }));
    const payload = { stats: out, at: now };
    _liveStatsCache.set(ck, { t: now, v: payload });
    res.json(payload);
  } catch (e) { res.status(502).json({ error: String(e.message || e), stats: {} }); }
});

// ⚽ 축구 선수별 경기 기록·평점 — API-Sports /fixtures/players
app.get('/api/asports/fbplayers', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true, teams: [] });
  const fixture = req.query.fixture;
  if (!fixture) return res.status(400).json({ error: 'need fixture' });
  try {
    const j = await asRaw('football', `/fixtures/players?fixture=${encodeURIComponent(fixture)}`, 30000);
    const teams = (j.response || []).map(t => ({
      team: t.team ? t.team.name : '', logo: t.team ? t.team.logo : '',
      players: (t.players || []).map(p => {
        const st = (p.statistics && p.statistics[0]) || {};
        const g = st.games || {};
        return {
          id: p.player ? p.player.id : null, name: p.player ? p.player.name : '', photo: p.player ? p.player.photo : '',
          number: g.number, pos: g.position, minutes: g.minutes, rating: g.rating,
          goals: st.goals ? st.goals.total : null, assists: st.goals ? st.goals.assists : null,
          shots: st.shots ? st.shots.total : null, shotsOn: st.shots ? st.shots.on : null,
          passes: st.passes ? st.passes.total : null, keyPasses: st.passes ? st.passes.key : null, passAcc: st.passes ? st.passes.accuracy : null,
          tackles: st.tackles ? st.tackles.total : null, duelsWon: st.duels ? st.duels.won : null,
          yellow: st.cards ? st.cards.yellow : null, red: st.cards ? st.cards.red : null
        };
      })
    }));
    res.json({ teams });
  } catch (e) { res.status(502).json({ error: String(e.message || e), teams: [] }); }
});

// ============================================================
//  MLB 무료 실데이터 (statsapi.mlb.com · API 키 불필요)
// ============================================================
async function mlbFetch(path, ttl = 30000) {
  const url = 'https://statsapi.mlb.com' + path;
  const hit = cache.get(url), now = Date.now();
  if (hit && now - hit.t < ttl) return hit.v;
  const r = await fetch(url);
  if (!r.ok) throw new Error('mlb ' + r.status);
  const v = await r.json();
  cache.set(url, { t: now, v });
  return v;
}
// 팀명 별명(마지막 단어)으로 매칭 (API-Sports ↔ MLB StatsAPI)
// 팀 별명 정규화 (약칭↔풀네임 매칭). LMB(멕시코)는 API-Sports 약칭 ↔ StatsAPI 풀네임이 달라 별칭 보정.
const MLB_NICK_ALIAS = { mexico: 'diablos', rojos: 'diablos', norte: 'acereros', monclova: 'acereros' };
function mlbNick(s) {
  const w = String(s || '').toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);
  let n = w[w.length - 1] || '';
  if (n === 'sox' && w.length >= 2) n = w[w.length - 2] + n;
  return MLB_NICK_ALIAS[n] || n;
}
function mlbTeamMatch(a, b) { const na = mlbNick(a), nb = mlbNick(b); return na && nb && na === nb; }
// MLB 경기 라인업(타순) — gamePk를 스케줄에서 매칭
app.get('/api/mlb/game', async (req, res) => {
  const { home, away } = req.query;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const f = await mlbFindGame(home, away, date);
    if (!f) return res.json({ found: false });
    const swap = f.swap;
    const box = await mlbFetch(`/api/v1/game/${f.gamePk}/boxscore`, 20000);
    const side = t => {
      const T = box.teams[t]; if (!T) return { team: '', lineup: [], pitcher: null };
      const players = T.players || {};
      const arr = Object.values(players).filter(p => p.battingOrder).map(p => ({
        bo: parseInt(p.battingOrder, 10), id: p.person.id, name: p.person.fullName, pos: p.position ? p.position.abbreviation : '', number: p.jerseyNumber || ''
      }));
      const lineup = arr.filter(p => p.bo % 100 === 0).sort((a, b) => a.bo - b.bo).map((p, i) => ({ order: i + 1, id: p.id, name: p.name, pos: p.pos, number: p.number }));
      let pitcher = null;
      const pid = (T.pitchers || [])[0];
      if (pid && players['ID' + pid]) pitcher = { id: pid, name: players['ID' + pid].person.fullName, pos: 'P', number: players['ID' + pid].jerseyNumber || '' };
      return { team: T.team.name, lineup, pitcher };
    };
    const hSide = side('home'), aSide = side('away');
    res.json({ found: true, gamePk: f.gamePk, home: swap ? aSide : hSide, away: swap ? hSide : aSide });
  } catch (e) { res.status(502).json({ found: false, error: String(e.message || e) }); }
});
// gamePk 찾기 — 한국/미국 날짜 시차 때문에 전날·당일·다음날까지 검색
function mlbAddDays(dstr, n) { const d = new Date(dstr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
async function mlbFindGame(home, away, date) {
  const cands = [];
  for (const sportId of [1, 23, 11]) {   // 1=MLB, 23=LMB(멕시코), 11=Triple-A(IL·PCL 등)
    for (const d of [date, mlbAddDays(date, -1), mlbAddDays(date, 1)]) {
      let sch;
      try { sch = await mlbFetch(`/api/v1/schedule?sportId=${sportId}&date=${d}`, 60000); } catch { continue; }
      const games = [];
      (sch.dates || []).forEach(dd => (dd.games || []).forEach(g => games.push(g)));
    for (const g of games) {
      const st = (g.status && g.status.abstractGameState) || '';
      if (mlbTeamMatch(g.teams.home.team.name, home) && mlbTeamMatch(g.teams.away.team.name, away)) cands.push({ gamePk: g.gamePk, swap: false, st, sportId, homeId: g.teams.home.team.id, awayId: g.teams.away.team.id, gameDate: g.gameDate });
      else if (mlbTeamMatch(g.teams.home.team.name, away) && mlbTeamMatch(g.teams.away.team.name, home)) cands.push({ gamePk: g.gamePk, swap: true, st, sportId, homeId: g.teams.home.team.id, awayId: g.teams.away.team.id, gameDate: g.gameDate });
      }
    }
  }
  if (!cands.length) return null;
  // 🔑 시리즈(같은 두 팀 며칠 연속) 구분: 선택 날짜(한국시간)와 같은 경기 우선, 그 안에서 진행>종료>예정 순
  const rank = s => s === 'Live' ? 0 : s === 'Final' ? 1 : 2;
  const onDate = cands.filter(c => c.gameDate && ymdInTz(c.gameDate, 'Asia/Seoul') === date);
  const pool = onDate.length ? onDate : cands;
  pool.sort((a, b) => rank(a.st) - rank(b.st));
  return pool[0];
}
// 예상 선발투수의 시즌 성적(ERA·승·패) 파싱 (schedule hydrate 안에 함께 옴 → 추가 호출 없음)
function ppStat(pp) {
  if (!pp || !pp.stats) return {};
  for (const s of pp.stats) {
    const st = s.stats || (s.splits && s.splits[0] && s.splits[0].stat);
    if (st && (st.era != null || st.wins != null || st.losses != null)) {
      return { era: st.era != null ? String(st.era) : null, w: st.wins != null ? st.wins : null, l: st.losses != null ? st.losses : null };
    }
  }
  return {};
}
// MLB 스코어/상태/이닝을 공식 StatsAPI로 덮어쓰기용 맵 (API-Sports보다 훨씬 빠름·정확)
async function mlbScoreMap(date, sportId = 1, tz = 'Asia/Seoul') {
  const map = {};
  const rank = s => s === 'live' ? 0 : s === 'finished' ? 1 : 2;
  for (const d of [date, mlbAddDays(date, -1), mlbAddDays(date, 1)]) {
    let sch;
    try { sch = await mlbFetch(`/api/v1/schedule?sportId=${sportId}&date=${d}&hydrate=linescore,probablePitcher`, 15000); } catch { continue; }
    const games = [];
    (sch.dates || []).forEach(dd => (dd.games || []).forEach(g => games.push(g)));
    await Promise.all(games.map(async g => {
      const hN = mlbNick(g.teams.home.team.name), aN = mlbNick(g.teams.away.team.name);
      if (!hN || !aN) return;
      // 🔑 같은 두 팀이 며칠 연속 붙는 시리즈 구분 위해 날짜(뷰어 타임존)까지 키에 포함
      const gYmd = g.gameDate ? ymdInTz(g.gameDate, tz) : d;
      const key = [hN, aN].sort().join('|') + '|' + gYmd;
      const st = (g.status && g.status.abstractGameState) || '';
      const dt = (g.status && g.status.detailedState) || '';
      const isLive = st === 'Live' && !/warmup|pre-?game|delayed start|scheduled|postponed/i.test(dt);
      const ls = g.linescore || {}, lt = ls.teams || {};
      const side = who => ({
        r: g.teams[who].score != null ? g.teams[who].score : (lt[who] && lt[who].runs != null ? lt[who].runs : null),
        h: lt[who] && lt[who].hits != null ? lt[who].hits : null,
        e: lt[who] && lt[who].errors != null ? lt[who].errors : null,
        bb: null,
        pitcher: (g.teams[who].probablePitcher && g.teams[who].probablePitcher.fullName) || null,   // 예상 선발(며칠 전부터 제공)
        pitcherId: (g.teams[who].probablePitcher && g.teams[who].probablePitcher.id) || null,         // 선수 ID(얼굴 사진용)
        ...ppStat(g.teams[who].probablePitcher)                                                       // era / w / l (시즌 성적)
      });
      const hs = side('home'), as = side('away');
      // 사사구(BB)·안타 보정은 boxscore에서 (진행/종료 경기만 — 비용 절약)
      if (isLive || st === 'Final') {
        try {
          const box = await mlbFetch(`/api/v1/game/${g.gamePk}/boxscore`, 30000);
          const bt = who => (box.teams[who] && box.teams[who].teamStats && box.teams[who].teamStats.batting) || {};
          const bh = bt('home'), ba = bt('away');
          hs.bb = bh.baseOnBalls != null ? bh.baseOnBalls : null; if (hs.h == null) hs.h = bh.hits != null ? bh.hits : null;
          as.bb = ba.baseOnBalls != null ? ba.baseOnBalls : null; if (as.h == null) as.h = ba.hits != null ? ba.hits : null;
        } catch {}
      }
      // 진행 중 경기: 볼/스트라이크/아웃 + 주자(1·2·3루) — 카드(바깥)에서 바로 보이도록
      // 🔑 라이브일 땐 여기서 부른 최신 /linescore의 이닝/초말을 카드에도 사용 → 상세보기(=같은 /linescore)와 100% 일치 + 지연 없음
      let bso = null, liveInning = null, liveHalf = null;
      if (isLive) {
        try {
          const fl = await mlbFetch(`/api/v1/game/${g.gamePk}/linescore`, 8000);
          const off = fl.offense || {};
          bso = {
            balls: fl.balls != null ? fl.balls : null, strikes: fl.strikes != null ? fl.strikes : null, outs: fl.outs != null ? fl.outs : null,
            bases: { first: !!off.first, second: !!off.second, third: !!off.third },
            batter: off.batter ? off.batter.fullName : null
          };
          if (fl.currentInning != null) liveInning = fl.currentInning;
          if (fl.inningHalf) liveHalf = fl.inningHalf;
        } catch {}
      }
      const entry = {
        state: st === 'Final' ? 'finished' : isLive ? 'live' : 'scheduled',
        inning: liveInning != null ? liveInning : (ls.currentInning != null ? ls.currentInning : null),
        half: liveHalf || ls.inningHalf || null,
        byNick: { [hN]: hs, [aN]: as },
        bso
      };
      if (!map[key] || rank(entry.state) < rank(map[key].state)) map[key] = entry;
    }));
  }
  return map;
}
// MLB 실시간 상태 (볼·스트라이크·아웃 · 주자 1/2/3루 · 현재 타자/투수 · R/H/E/사사구)
app.get('/api/mlb/live', async (req, res) => {
  const { home, away } = req.query;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const f = await mlbFindGame(home, away, date);
    if (!f) return res.json({ found: false });
    const ls = await mlbFetch(`/api/v1/game/${f.gamePk}/linescore`, 8000);
    const off = ls.offense || {}, def = ls.defense || {}, tr = ls.teams || {};
    const mk = t => ({ r: (tr[t] && tr[t].runs != null) ? tr[t].runs : null, h: (tr[t] && tr[t].hits != null) ? tr[t].hits : null, e: (tr[t] && tr[t].errors != null) ? tr[t].errors : null, bb: null });
    let H = mk('home'), A = mk('away');
    let batterLine = null, pitcherLine = null;
    try {
      const box = await mlbFetch(`/api/v1/game/${f.gamePk}/boxscore`, 15000);
      const bb = t => { try { return box.teams[t].teamStats.batting.baseOnBalls; } catch { return null; } };
      H.bb = bb('home'); A.bb = bb('away');
      // 현재 타자/투수의 이 경기 성적 (0/3 0BB, 투구수 등)
      const offSide = (ls.inningHalf === 'Bottom') ? 'home' : 'away';
      const defSide = offSide === 'home' ? 'away' : 'home';
      if (off.batter && box.teams[offSide]) {
        const p = box.teams[offSide].players['ID' + off.batter.id];
        if (p && p.stats && p.stats.batting) { const s = p.stats.batting; batterLine = { ab: s.atBats ?? 0, h: s.hits ?? 0, k: s.strikeOuts ?? 0, bb: s.baseOnBalls ?? 0, hr: s.homeRuns ?? 0, rbi: s.rbi ?? 0 }; }
      }
      if (def.pitcher && box.teams[defSide]) {
        const p = box.teams[defSide].players['ID' + def.pitcher.id];
        if (p && p.stats && p.stats.pitching) { const s = p.stats.pitching; pitcherLine = { ip: s.inningsPitched ?? '0.0', k: s.strikeOuts ?? 0, er: s.earnedRuns ?? 0, np: s.numberOfPitches ?? s.pitchesThrown ?? null, h: s.hits ?? 0, bb: s.baseOnBalls ?? 0 }; }
      }
    } catch {}
    res.json({
      found: true,
      inning: ls.currentInning != null ? ls.currentInning : null,
      inningOrdinal: ls.currentInningOrdinal || null,
      half: ls.inningHalf || null,            // "Top" / "Bottom" / "Middle" / "End"
      balls: ls.balls != null ? ls.balls : null,
      strikes: ls.strikes != null ? ls.strikes : null,
      outs: ls.outs != null ? ls.outs : null,
      bases: { first: !!off.first, second: !!off.second, third: !!off.third },
      batter: off.batter ? off.batter.fullName : null,
      pitcher: def.pitcher ? def.pitcher.fullName : null,
      batterLine, pitcherLine,
      box: f.swap ? { home: A, away: H } : { home: H, away: A }
    });
  } catch (e) { res.status(502).json({ found: false, error: String(e.message || e) }); }
});
// ⚾ MLB 플레이별(투구 단위) — 이닝→타석→투구(볼/스트라이크/파울/카운트/구속)
app.get('/api/mlb/pbp', async (req, res) => {
  const { home, away } = req.query;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const f = await mlbFindGame(home, away, date);
    if (!f) return res.json({ found: false });
    const pbp = await mlbFetch(`/api/v1/game/${f.gamePk}/playByPlay`, 10000);
    const plays = pbp.allPlays || [];
    // 선수 타순 맵(id → 타순 1~9) — boxscore battingOrder에서 (at-bat에 타순 표시용)
    const numById = {};
    try {
      const bx = await mlbFetch(`/api/v1/game/${f.gamePk}/boxscore`, 60000);
      for (const side of ['home', 'away']) {
        const players = (bx.teams && bx.teams[side] && bx.teams[side].players) || {};
        for (const k in players) {
          const p = players[k];
          if (p && p.person && p.battingOrder) { const bo = parseInt(p.battingOrder, 10); if (bo) numById[p.person.id] = Math.floor(bo / 100) || Math.round(bo / 100); }
        }
      }
    } catch (e) { /* 타순 없어도 진행 */ }
    const innMap = {};
    for (const p of plays) {
      const ab = p.about || {};
      let inn = ab.inning; if (inn == null) continue;
      let half = (ab.halfInning || '').toLowerCase() === 'bottom' ? 'bottom' : 'top';
      if (f.swap) half = half === 'top' ? 'bottom' : 'top';   // 우리 피드가 홈/원정 반대면 초·말 뒤집기
      const key = inn + '|' + half;
      const pitches = (p.playEvents || []).filter(ev => ev.isPitch).map(ev => {
        const call = (ev.details && ev.details.call && ev.details.call.code) || '';
        const c = ev.count || {};
        return { c: call, b: c.balls != null ? c.balls : null, s: c.strikes != null ? c.strikes : null, n: ev.pitchNumber || null, spd: (ev.pitchData && ev.pitchData.startSpeed) ? Math.round(ev.pitchData.startSpeed) : null };
      });
      const r = p.result || {}, mu = p.matchup || {};
      (innMap[key] = innMap[key] || []).push({
        batter: mu.batter ? mu.batter.fullName : '', pitcher: mu.pitcher ? mu.pitcher.fullName : '',
        num: (mu.batter && numById[mu.batter.id]) ? numById[mu.batter.id] : '',   // 타자 타순(1~9)
        event: r.event || '', desc: r.description || '', rbi: r.rbi || 0,
        np: pitches.length, pitches, complete: ab.isComplete !== false
      });
    }
    const innings = Object.keys(innMap).map(k => { const [inn, half] = k.split('|'); return { inn: Number(inn), half, plays: innMap[k] }; })
      .sort((a, b) => a.inn - b.inn || (a.half === 'top' ? -1 : 1));
    res.json({ found: true, innings });
  } catch (e) { res.status(502).json({ found: false, error: String(e.message || e) }); }
});
// MLB 선수 최근 경기 로그 (타자 hitting / 투수 pitching)
app.get('/api/mlb/player', async (req, res) => {
  const id = req.query.id, group = req.query.group === 'pitching' ? 'pitching' : 'hitting';
  if (!id) return res.status(400).json({ error: 'need id' });
  const season = new Date().getFullYear();
  try {
    const j = await mlbFetch(`/api/v1/people/${id}/stats?stats=gameLog&group=${group}&season=${season}`, 120000);
    const splits = (j.stats && j.stats[0] && j.stats[0].splits) || [];
    const games = splits.slice(-10).reverse().map(s => ({ date: s.date, opp: s.opponent ? s.opponent.name : '', home: s.isHome, stat: s.stat || {} }));
    res.json({ id, group, games });
  } catch (e) { res.status(502).json({ error: String(e.message || e), games: [] }); }
});
// MLB/LMB 경기 박스스코어 (투수 기록 + 타자 기록) — 경기정보방용
app.get('/api/mlb/boxscore', async (req, res) => {
  const { home, away } = req.query;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const f = await mlbFindGame(home, away, date);
    if (!f) return res.json({ found: false });
    const box = await mlbFetch(`/api/v1/game/${f.gamePk}/boxscore`, 20000);
    const side = t => {
      const T = box.teams[t] || {}, P = T.players || {};
      const pitchers = (T.pitchers || []).map(id => {
        const p = P['ID' + id] || {}, s = (p.stats && p.stats.pitching) || {};
        return { name: p.person ? p.person.fullName : '', ip: s.inningsPitched ?? '-', np: s.numberOfPitches ?? s.pitchesThrown ?? '-', h: s.hits ?? 0, er: s.earnedRuns ?? 0, hr: s.homeRuns ?? 0, k: s.strikeOuts ?? 0, bb: s.baseOnBalls ?? 0 };
      });
      const batters = (T.batters || []).map(id => {
        const p = P['ID' + id] || {}, s = (p.stats && p.stats.batting) || {};
        return { name: p.person ? p.person.fullName : '', pos: p.position ? p.position.abbreviation : '', ab: s.atBats ?? 0, h: s.hits ?? 0, bb: s.baseOnBalls ?? 0, rbi: s.rbi ?? 0, hr: s.homeRuns ?? 0, k: s.strikeOuts ?? 0, sb: s.stolenBases ?? 0 };
      });
      return { team: T.team ? T.team.name : '', pitchers, batters };
    };
    const hSide = side('home'), aSide = side('away');
    res.json({ found: true, home: f.swap ? aSide : hSide, away: f.swap ? hSide : aSide });
  } catch (e) { res.status(502).json({ found: false, error: String(e.message || e) }); }
});
// 팀 최근 10경기
async function mlbRecent(teamId, sportId, date) {
  if (!teamId) return [];
  const start = mlbAddDays(date, -30);
  let sch;
  try { sch = await mlbFetch(`/api/v1/schedule?sportId=${sportId}&teamId=${teamId}&startDate=${start}&endDate=${date}&gameType=R`, 300000); } catch { return []; }
  const games = [];
  (sch.dates || []).forEach(dd => (dd.games || []).forEach(g => games.push(g)));
  const fin = games.filter(g => (g.status && g.status.abstractGameState) === 'Final' && g.teams.home.score != null);
  fin.sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));
  return fin.slice(0, 10).map(g => {
    const isHome = g.teams.home.team.id === Number(teamId);
    const my = isHome ? g.teams.home : g.teams.away, op = isHome ? g.teams.away : g.teams.home;
    return { date: g.officialDate, opp: op.team.name, ts: my.score, os: op.score, win: my.score > op.score, gamePk: g.gamePk };
  });
}
// 특정 과거 경기의 이닝스코어 + 투수/타자 박스 (최근경기·맞대결 펼쳐보기)
app.get('/api/mlb/gamebox', async (req, res) => {
  const gp = req.query.gamePk;
  if (!gp) return res.status(400).json({ error: 'need gamePk' });
  try {
    const [ls, box] = await Promise.all([
      mlbFetch(`/api/v1/game/${gp}/linescore`, 86400000),
      mlbFetch(`/api/v1/game/${gp}/boxscore`, 86400000)
    ]);
    const innings = (ls.innings || []).map(i => ({ num: i.num, home: i.home ? i.home.runs : null, away: i.away ? i.away.runs : null }));
    const lt = ls.teams || {};
    const side = t => {
      const T = box.teams[t] || {}, P = T.players || {};
      const pitchers = (T.pitchers || []).map(id => { const p = P['ID' + id] || {}, s = (p.stats && p.stats.pitching) || {}; return { name: p.person ? p.person.fullName : '', ip: s.inningsPitched ?? '-', h: s.hits ?? 0, er: s.earnedRuns ?? 0, k: s.strikeOuts ?? 0 }; });
      const batters = (T.batters || []).map(id => { const p = P['ID' + id] || {}, s = (p.stats && p.stats.batting) || {}; return { name: p.person ? p.person.fullName : '', pos: p.position ? p.position.abbreviation : '', ab: s.atBats ?? 0, h: s.hits ?? 0, rbi: s.rbi ?? 0 }; });
      return { name: T.team ? T.team.name : '', r: lt[t] ? lt[t].runs : null, h: lt[t] ? lt[t].hits : null, e: lt[t] ? lt[t].errors : null, pitchers, batters };
    };
    res.json({ innings, home: side('home'), away: side('away') });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});
// 선발(예상) 투수 시즌 성적
async function mlbPitcherSeason(id) {
  if (!id) return null;
  const season = new Date().getFullYear();
  try {
    const j = await mlbFetch(`/api/v1/people/${id}/stats?stats=season&group=pitching&season=${season}`, 3600000);
    const s = (j.stats && j.stats[0] && j.stats[0].splits && j.stats[0].splits[0] && j.stats[0].splits[0].stat) || {};
    return { w: s.wins ?? 0, l: s.losses ?? 0, era: s.era ?? '-', ip: s.inningsPitched ?? '-', k: s.strikeOuts ?? 0, bb: s.baseOnBalls ?? 0 };
  } catch { return { w: 0, l: 0, era: '-', ip: '-', k: 0, bb: 0 }; }
}
// 맞대결(H2H) — 두 팀 시즌 대결 기록
async function mlbH2H(homeId, awayId, sportId) {
  if (!homeId || !awayId) return [];
  const season = new Date().getFullYear();
  let sch;
  try { sch = await mlbFetch(`/api/v1/schedule?sportId=${sportId}&teamId=${homeId}&opponentId=${awayId}&season=${season}&gameType=R`, 600000); } catch { return []; }
  const games = [];
  (sch.dates || []).forEach(dd => (dd.games || []).forEach(g => games.push(g)));
  const fin = games.filter(g => (g.status && g.status.abstractGameState) === 'Final' && g.teams.home.score != null);
  fin.sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));
  return fin.slice(0, 8).map(g => ({ date: g.officialDate, home: g.teams.home.team.name, away: g.teams.away.team.name, hs: g.teams.home.score, as: g.teams.away.score, gamePk: g.gamePk }));
}
// 팀 순위표 (리그 순위/득실/연승)
async function mlbStandings(teamId, homeId, awayId) {
  if (!teamId) return null;
  const season = new Date().getFullYear();
  let leagueId;
  try { const t = await mlbFetch(`/api/v1/teams/${teamId}`, 3600000); leagueId = t.teams && t.teams[0] && t.teams[0].league && t.teams[0].league.id; } catch {}
  if (!leagueId) return null;
  let st;
  try { st = await mlbFetch(`/api/v1/standings?leagueId=${leagueId}&season=${season}&standingsTypes=regularSeason`, 600000); } catch { return null; }
  const rows = [];
  (st.records || []).forEach(rec => (rec.teamRecords || []).forEach(tr => {
    rows.push({ id: tr.team.id, name: tr.team.name, w: tr.wins, l: tr.losses, pct: tr.winningPercentage, rs: tr.runsScored ?? '-', ra: tr.runsAllowed ?? '-', streak: tr.streak ? tr.streak.streakCode : '' });
  }));
  rows.sort((a, b) => parseFloat(b.pct) - parseFloat(a.pct));
  rows.forEach((r, i) => { r.rank = i + 1; r.hl = (r.id === Number(homeId) || r.id === Number(awayId)); });
  return rows;
}
// 경기정보: 예상 선발투수 + 양팀 최근 10경기 + 맞대결 + 순위표
app.get('/api/mlb/info', async (req, res) => {
  const { home, away } = req.query;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const f = await mlbFindGame(home, away, date);
    if (!f) return res.json({ found: false });
    const sportId = f.sportId || 1;
    const ourHomeId = f.swap ? f.awayId : f.homeId, ourAwayId = f.swap ? f.homeId : f.awayId;
    // 선발투수 (schedule + hydrate)
    let probable = { home: null, away: null };
    try {
      const sg = await mlbFetch(`/api/v1/schedule?sportId=${sportId}&gamePk=${f.gamePk}&hydrate=probablePitcher`, 120000);
      const g = sg.dates && sg.dates[0] && sg.dates[0].games && sg.dates[0].games[0];
      if (g) {
        const hp = g.teams.home.probablePitcher, ap = g.teams.away.probablePitcher;
        const [hs, as] = await Promise.all([
          hp ? mlbPitcherSeason(hp.id).then(s => ({ name: hp.fullName, ...s })) : null,
          ap ? mlbPitcherSeason(ap.id).then(s => ({ name: ap.fullName, ...s })) : null
        ]);
        probable = f.swap ? { home: as, away: hs } : { home: hs, away: as };
      }
    } catch {}
    const [rHome, rAway, h2h, standings] = await Promise.all([
      mlbRecent(ourHomeId, sportId, date),
      mlbRecent(ourAwayId, sportId, date),
      mlbH2H(ourHomeId, ourAwayId, sportId),
      mlbStandings(ourHomeId, ourHomeId, ourAwayId)
    ]);
    res.json({ found: true, probable, recent: { home: rHome, away: rAway }, h2h, standings });
  } catch (e) { res.status(502).json({ found: false, error: String(e.message || e) }); }
});

// ============================================================
//  YouTube 하이라이트 검색 (화면 내 재생용 · YouTube Data API v3)
//  ※ 무료 키를 환경변수 YT_API_KEY 에 넣으면 경기 하이라이트를 앱 안에서 바로 재생.
//    키 없으면 프론트가 YouTube 검색 링크로 폴백.
// ============================================================
const YT_KEY = (process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY || 'AIzaSyC9Ot692beQz-Ci3V3V_LJJHZDomF7aqCU').trim();
app.get('/api/youtube', async (req, res) => {
  if (!YT_KEY) return res.json({ needKey: true });
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'need q' });
  const ck = 'YT:' + q, hit = cache.get(ck);
  if (hit && Date.now() - hit.t < 3600000) return res.json(hit.v);   // 1시간 캐시(쿼터 절약)
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&order=relevance&videoEmbeddable=true&q=${encodeURIComponent(q)}&key=${YT_KEY}`;
    const r = await fetch(url); const j = await r.json();
    const it = (j.items || [])[0];
    const v = it ? { videoId: it.id.videoId, title: it.snippet.title } : { videoId: null };
    cache.set(ck, { t: Date.now(), v });
    res.json(v);
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

// ============================================================
//  커뮤니티 게시판 (자유 / 수익인증 / 손실인증)
//  ※ 메모리 저장(서버 재시작 시 초기화). DB 붙이면 영구 저장 가능.
// ============================================================
const BOARDS = ['free', 'profit', 'loss'];
const posts = { free: [], profit: [], loss: [] };
let postSeq = 1;
// 샘플 시드 글 없음 — 언어 혼선 방지(각 언어 UI에서 하드코딩 한국어가 보이지 않도록). 첫 글은 사용자가 작성.

app.get('/api/posts', (req, res) => {
  const b = BOARDS.includes(req.query.board) ? req.query.board : 'free';
  res.json({ board: b, posts: posts[b].slice(-200).reverse() });
});
app.post('/api/posts', (req, res) => {
  const { board = 'free', name = '익명', title = '', text = '' } = req.body || {};
  if (!BOARDS.includes(board)) return res.status(400).json({ error: 'bad board' });
  const t = String(title).trim().slice(0, 80), x = String(text).trim().slice(0, 1000);
  if (!t && !x) return res.status(400).json({ error: 'empty' });
  const p = { id: postSeq++, name: String(name).slice(0, 20) || '익명', title: t || '(제목 없음)', text: x, ts: Date.now(), up: 0 };
  posts[board].push(p);
  if (posts[board].length > 1000) posts[board].shift();
  res.json({ ok: true, post: p });
});
app.post('/api/posts/like', (req, res) => {
  const { board, id } = req.body || {};
  const arr = posts[board] || [];
  const p = arr.find(x => x.id === Number(id));
  if (p) p.up++;
  res.json({ ok: true, up: p ? p.up : 0 });
});

// ============================================================
//  WebSocket · 채팅 + 접속인원(presence)
// ============================================================
const wss = new WebSocketServer({ server, path: '/ws' });
// room -> Set<ws>
const rooms = new Map();
const HISTORY = new Map(); // room -> 최근 메시지 배열(최대 30)

function roomSet(room) { if (!rooms.has(room)) rooms.set(room, new Set()); return rooms.get(room); }
function presence(room) { return roomSet(room).size; }
function totalOnline() { let n = 0; for (const s of rooms.values()) n += s.size; return n; }
// 📡 재배포 직후 숫자가 꺼지지 않게: 부팅 후 3분 동안은 '직전 접속수(바닥값)'를 선형 감쇠시키며 깔아준다.
//    실제 소켓이 재연결되며 raw가 차오르면 max로 자연스럽게 실수치로 넘어간다. 3분 지나면 순수 raw.
function livePresence() {
  const raw = totalOnline();
  if (_presenceFloor > 0) {
    const age = Date.now() - _bootAt, DECAY = 180000;
    if (age < DECAY) { const floor = Math.round(_presenceFloor * (1 - age / DECAY)); if (floor > raw) return floor; }
  }
  return raw;
}
function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const c of roomSet(room)) { if (c.readyState === 1) c.send(msg); }
}
function sendPresence(room) {
  broadcast(room, { type: 'presence', room, count: presence(room), total: livePresence() });
}
// 접속수 주기 저장(재시작 시 바닥값으로 복원) + 전체방 주기 브로드캐스트(숫자가 매끄럽게 실수치로 수렴)
setInterval(() => { try { const n = totalOnline(); if (n > 0 && configCol) configCol.updateOne({ _id: 'presence' }, { $set: { n, at: Date.now() } }, { upsert: true }).catch(() => {}); } catch (_) {} }, 30000);
setInterval(() => { try { sendPresence('all'); } catch (_) {} }, 30000);

// 게스트 닉네임: 영어 단어 + 숫자 (한글 랜덤 사용 안 함)
const ADJ = ['Cool', 'Lucky', 'Sharp', 'Bold', 'Swift', 'Prime', 'Star', 'Ace', 'Mega', 'Epic', 'Pro', 'Neo'];
const NOUN = ['Fan', 'Picker', 'Scout', 'Analyst', 'Watcher', 'Bettor', 'Player', 'Fanatic', 'Supporter', 'Guru'];
function guestName() { return ADJ[Math.random()*ADJ.length|0] + NOUN[Math.random()*NOUN.length|0] + (Math.random()*9000+1000|0); }

wss.on('error', () => { METRICS.ws.fails++; });
wss.on('connection', (ws) => {
  METRICS.ws.connects++;
  ws.on('error', () => { METRICS.ws.fails++; });
  ws.room = 'all';
  ws.name = guestName();
  roomSet(ws.room).add(ws);
  ws.send(JSON.stringify({ type: 'welcome', name: ws.name, room: ws.room, history: HISTORY.get(ws.room) || [] }));
  sendPresence(ws.room);

  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }

    if (m.type === 'join') {
      // 방 이동 (전경기대화방 'all' 또는 경기별 'event:{id}')
      roomSet(ws.room).delete(ws);
      const prev = ws.room;
      ws.room = String(m.room || 'all');
      roomSet(ws.room).add(ws);
      sendPresence(prev); sendPresence(ws.room);
      const existing = HISTORY.get(ws.room) || [];
      if (ws.room.startsWith('event:')) {
        // 경기방: 이전 회차 요약을 재구성해 히스토리 앞에 붙여 전송 (늦게 들어와도 처음부터 보임)
        const gid = ws.room.slice(6), room = ws.room;
        buildRecap(gid).then(recap => {
          if (ws.readyState === 1 && ws.room === room) ws.send(JSON.stringify({ type: 'joined', room, history: [...recap, ...existing] }));
        }).catch(() => {
          if (ws.readyState === 1 && ws.room === room) ws.send(JSON.stringify({ type: 'joined', room, history: existing }));
        });
      } else {
        ws.send(JSON.stringify({ type: 'joined', room: ws.room, history: existing }));
      }
    }

    if (m.type === 'chat') {
      const text = String(m.text || '').slice(0, 300).trim();
      if (!text) return;
      const out = { type: 'chat', room: ws.room, name: ws.name, text, ts: Date.now() };
      const h = HISTORY.get(ws.room) || []; h.push(out); if (h.length > 30) h.shift(); HISTORY.set(ws.room, h);
      broadcast(ws.room, out);
    }

    if (m.type === 'name' && m.name) {
      ws.name = String(m.name).slice(0, 20);
      ws.send(JSON.stringify({ type: 'renamed', name: ws.name }));
    }
  });

  ws.on('close', () => {
    METRICS.ws.disconnects++;
    roomSet(ws.room).delete(ws);
    sendPresence(ws.room);
  });
});

// ============================================================
//  🔔 웹 푸시 (앱을 완전히 닫아도 오는 알림) · Web Push + VAPID
//  · 관심팀 경기의 시작/득점/종료/라인업/퇴장을 서버가 감지 → 구독자에게 푸시
//  · ⚠️ 무료 Render는 15분 후 잠들어 감지가 끊김 → 상시 서버(유료) 권장
// ============================================================
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || 'BK9w16DfLnhkCXW2RscfgEXwaYnhqSraV1cGxbefQV3FccVmh716bSOHT7MGAL_y3L11xcJTLusGM-3lJWmvB6Q';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'G39TutUfTrpnk6LZtn4ura0Yk9scbRplKTNgpoQBgRw';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@liveup.fans';
let PUSH_ON = false;
try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); PUSH_ON = true; } catch (e) { console.log('web-push init fail', e.message); }

// 구독 저장 (메모리: 재시작 시 초기화 → 클라가 다시 구독). endpoint를 키로.
const subs = new Map();   // endpoint -> { sub, fav:[teams], prefs:{}, lang }
function nick(s) { return String(s || '').toLowerCase().replace(/[.]/g, '').trim(); }
function favMatch(favArr, name) {
  const n = nick(name); return (favArr || []).some(f => { const nf = nick(f); return nf && (n === nf || n.includes(nf) || nf.includes(n)); });
}

app.get('/api/push/key', (req, res) => res.json({ key: VAPID_PUBLIC, enabled: PUSH_ON }));
app.post('/api/push/subscribe', (req, res) => {
  const { subscription, fav, prefs, lang } = req.body || {};
  if (!subscription || !subscription.endpoint) return res.status(400).json({ ok: false });
  subs.set(subscription.endpoint, { sub: subscription, fav: fav || [], prefs: prefs || {}, lang: lang || 'en' });
  if (subsCol) subsCol.updateOne({ endpoint: subscription.endpoint }, { $set: { endpoint: subscription.endpoint, sub: subscription, fav: fav || [], prefs: prefs || {}, lang: lang || 'en', at: new Date() } }, { upsert: true }).catch(e => console.error('[DB] sub 저장 실패:', e.message));
  res.json({ ok: true, count: subs.size });
});
app.post('/api/push/unsubscribe', (req, res) => {
  const ep = req.body && req.body.endpoint; if (ep) subs.delete(ep);
  if (subsCol && ep) subsCol.deleteOne({ endpoint: ep }).catch(() => {});
  res.json({ ok: true });
});
app.get('/api/push/status', (req, res) => res.json({ enabled: PUSH_ON, subscribers: subs.size, publicKey: VAPID_PUBLIC.slice(0, 12) + '…' }));

// 다국어 푸시 문구 (서버측 최소 사전)
const PL = {
  start: { en: 'Match start', ko: '경기 시작', ja: '試合開始', zh: '比赛开始', es: 'Inicio del partido', hi: 'मैच शुरू', vi: 'Bắt đầu trận', th: 'เริ่มแข่ง', ru: 'Начало матча', de: 'Spielbeginn', fr: 'Coup d’envoi', it: 'Inizio partita' },
  score: { en: 'Score', ko: '득점', ja: '得点', zh: '得分', es: 'Gol/Anotación', hi: 'स्कोर', vi: 'Ghi điểm', th: 'ทำแต้ม', ru: 'Гол/очко', de: 'Tor/Punkt', fr: 'But/point', it: 'Gol/punto' },
  finish: { en: 'Full time', ko: '경기 종료', ja: '試合終了', zh: '比赛结束', es: 'Final', hi: 'समाप्त', vi: 'Kết thúc', th: 'จบเกม', ru: 'Матч окончен', de: 'Spielende', fr: 'Fin du match', it: 'Fine partita' },
  lineup: { en: 'Lineups announced', ko: '라인업 발표', ja: 'スタメン発表', zh: '首发公布', es: 'Alineaciones', hi: 'लाइनअप घोषित', vi: 'Đội hình ra sân', th: 'ประกาศตัวจริง', ru: 'Составы', de: 'Aufstellungen', fr: 'Compositions', it: 'Formazioni' },
  red: { en: 'Red card', ko: '퇴장', ja: '退場', zh: '罚下', es: 'Expulsión', hi: 'रेड कार्ड', vi: 'Thẻ đỏ', th: 'ใบแดง', ru: 'Удаление', de: 'Platzverweis', fr: 'Expulsion', it: 'Espulsione' }
};
function plabel(type, lang) { const m = PL[type] || {}; return m[lang] || m.en || type; }
function iconOf(type) { return type === 'start' ? '⚽' : type === 'finish' ? '🏁' : type === 'lineup' ? '📋' : type === 'red' ? '🟥' : '🔴'; }

async function sendPushEvent(type, prefKey, sport, g) {
  if (!PUSH_ON || !subs.size) return;
  const home = g.home, away = g.away;
  const scoreLine = `${home} ${g.hs ?? 0}:${g.as ?? 0} ${away}`;
  const vsLine = `${home} vs ${away}`;
  for (const [ep, rec] of subs) {
    if (!(rec.prefs && rec.prefs[prefKey])) continue;
    if (!(favMatch(rec.fav, home) || favMatch(rec.fav, away))) continue;
    const payload = JSON.stringify({
      title: `${iconOf(type)} ${plabel(type, rec.lang)}`,
      body: (type === 'finish' || type === 'score') ? scoreLine : vsLine,
      gameId: g.id, sport
    });
    try { await webpush.sendNotification(rec.sub, payload); }
    catch (err) { if (err && (err.statusCode === 404 || err.statusCode === 410)) { subs.delete(ep); if (subsCol) subsCol.deleteOne({ endpoint: ep }).catch(() => {}); } }
  }
}

// 스케줄러: 구독자가 있으면 30초마다 관심 종목 감지
const pushSnap = {};   // gameId -> {state,total,lineup,reds}
const PUSH_SPORTS = ['football', 'baseball', 'basketball'];
async function pushTick() {
  if (!PUSH_ON || !subs.size || !APISPORTS_KEY) return;
  // 구독자들의 관심팀 합집합 (하나도 없으면 스킵)
  const anyFav = [...subs.values()].some(r => (r.fav || []).length);
  if (!anyFav) return;
  const date = new Date().toISOString().slice(0, 10);
  for (const sport of PUSH_SPORTS) {
    let games = [];
    try { games = (await buildGamesCoreCached(sport, date)).games || []; } catch (e) { continue; }
    for (const g of games) {
      const favd = [...subs.values()].some(r => favMatch(r.fav, g.home) || favMatch(r.fav, g.away));
      if (!favd) continue;
      const id = g.id, prev = pushSnap[id] || {}, total = (Number(g.hs) || 0) + (Number(g.as) || 0);
      if (prev.state) {
        if (prev.state === 'scheduled' && g.state === 'live') sendPushEvent('start', 'start', sport, g);
        if (prev.state !== 'finished' && g.state === 'finished') sendPushEvent('finish', 'finish', sport, g);
        if (prev.total != null && total > prev.total && g.state === 'live') sendPushEvent('score', 'score', sport, g);
      }
      pushSnap[id] = Object.assign({}, prev, { state: g.state, total });
      // 라인업 (1회) — 축구/ MLB계열
      if (!prev.lineup && (g.state === 'live' || (g.date && (new Date(g.date) - Date.now()) < 3 * 3600e3 && (new Date(g.date) - Date.now()) > -6 * 3600e3))) {
        pushLineupCheck(sport, g).catch(() => {});
      }
      // 퇴장 (축구 라이브)
      if (sport === 'football' && g.state === 'live') pushRedCheck(g, prev.reds || 0).catch(() => {});
    }
  }
}
async function pushLineupCheck(sport, g) {
  let has = false;
  try {
    if (sport === 'football') { const d = await asRaw('football', `/fixtures/lineups?fixture=${g.id}`, 60000); has = (d.response || []).some(t => (t.startXI || []).length >= 11); }
    else if (['MLB', 'LMB', 'IL', 'PCL'].includes(g.league)) { const f = await mlbFindGame(g.home, g.away, new Date().toISOString().slice(0, 10)); if (f && f.gamePk) { const bx = await mlbFetch(`/api/v1/game/${f.gamePk}/boxscore`, 30000); has = !!(bx && bx.teams && (Object.keys(bx.teams.home.players || {}).length || Object.keys(bx.teams.away.players || {}).length)); } }
  } catch (e) {}
  if (has && !(pushSnap[g.id] || {}).lineup) { pushSnap[g.id] = Object.assign({}, pushSnap[g.id], { lineup: true }); sendPushEvent('lineup', 'lineup', sport, g); }
}
async function pushRedCheck(g, prevReds) {
  try {
    const d = await asRaw('football', `/fixtures/events?fixture=${g.id}`, 20000);
    const reds = (d.response || []).filter(x => x.type === 'Card' && /red/i.test((x.detail || ''))).length;
    if (reds > prevReds) sendPushEvent('red', 'red', 'football', g);
    pushSnap[g.id] = Object.assign({}, pushSnap[g.id], { reds });
  } catch (e) {}
}
setInterval(() => { pushTick().catch(() => {}); }, 30000);

// ============================================================
//  🎙️ 서버 사이드 중계봇 — 시청 중인 경기방(event:{id})에 이벤트를 채팅으로 기록
//  · 사람이 남긴 채팅처럼 HISTORY에 저장 → 방 나갔다 와도 유지, 모든 시청자 공유
//  · 구조화된 이벤트(kind)로 보내고, 팀명/문구 번역은 클라이언트가 각 언어로 렌더
// ============================================================
const castSnap = {};   // gameId -> 직전 스냅샷
function pushHistory(room, obj, cap) {
  const h = HISTORY.get(room) || []; h.push(obj); while (h.length > (cap || 30)) h.shift(); HISTORY.set(room, h);
}
function castBroadcast(room, obj) { pushHistory(room, obj, 100); broadcast(room, obj); }
// 🕘 늦게 들어온 사람용: 현재 경기 데이터로 이전 회차 요약 + 사전 안내를 재구성
async function buildRecap(gameId) {
  const date = new Date().toISOString().slice(0, 10);
  for (const sport of ['baseball', 'football']) {
    let games = [];
    try { games = (await buildGamesCoreCached(sport, date)).games || []; } catch (e) { continue; }
    const g = games.find(x => String(x.id) === String(gameId));
    if (g) return recapMessages(sport, g);
  }
  return [];
}
function recapMessages(sport, g) {
  const out = [];
  let ts = Date.now() - 3600000;   // 과거로 표시(라이브 메시지와 구분)
  const base = () => ({ type: 'bot', home: g.home, away: g.away, league: g.league, homeLogo: g.homeLogo, awayLogo: g.awayLogo, sport, ts: ++ts, recap: true });
  const num = v => { const n = Number(v); return (v == null || v === '' || isNaN(n)) ? null : n; };
  out.push(Object.assign(base(), { kind: 'intro' }));
  if (sport === 'baseball') {
    const bx = g.box || {}, hi = (bx.home && bx.home.innings) || {}, ai = (bx.away && bx.away.innings) || {};
    const keys = [...Object.keys(hi), ...Object.keys(ai)].map(Number).filter(n => n > 0);
    const maxInn = Math.max(g.curInning || 0, keys.length ? Math.max(...keys) : 0);
    for (let i = 1; i <= maxInn; i++) {
      const ar = num(ai[i]), hr = num(hi[i]);
      if (ar > 0) out.push(Object.assign(base(), { kind: 'innsum', inn: i, half: 'top', side: 'away', n: ar }));
      if (hr > 0) out.push(Object.assign(base(), { kind: 'innsum', inn: i, half: 'bottom', side: 'home', n: hr }));
    }
    out.push(Object.assign(base(), { kind: 'curbb', inn: g.curInning || maxInn || 1, half: g.inningHalf || null, hs: Number(g.hs) || 0, as: Number(g.as) || 0 }));
  } else if (sport === 'football') {
    out.push(Object.assign(base(), { kind: 'curfb', hs: Number(g.hs) || 0, as: Number(g.as) || 0, min: g.timer || g.period || null }));
  }
  return out;
}
function detectCast(sport, g) {
  const room = 'event:' + g.id, id = g.id, prev = castSnap[id], bx = g.box || {};
  const snap = {
    state: g.state, hs: Number(g.hs) || 0, as: Number(g.as) || 0,
    hh: bx.home ? bx.home.h : null, ah: bx.away ? bx.away.h : null,
    inn: g.curInning != null ? g.curInning : null, half: g.inningHalf || null,
    out: (g.bso && g.bso.outs != null) ? g.bso.outs : null, batTeam: g.batting || null
  };
  const base = () => ({ type: 'bot', home: g.home, away: g.away, league: g.league, homeLogo: g.homeLogo, awayLogo: g.awayLogo, sport, ts: Date.now() });
  if (prev) {
    if (sport === 'baseball') {
      if (snap.hs > prev.hs) castBroadcast(room, Object.assign(base(), { kind: 'score', side: 'home', hs: snap.hs, as: snap.as }));
      if (snap.as > prev.as) castBroadcast(room, Object.assign(base(), { kind: 'score', side: 'away', hs: snap.hs, as: snap.as }));
      if (snap.hh != null && prev.hh != null && snap.hh > prev.hh) castBroadcast(room, Object.assign(base(), { kind: 'hit', side: 'home', n: snap.hh }));
      if (snap.ah != null && prev.ah != null && snap.ah > prev.ah) castBroadcast(room, Object.assign(base(), { kind: 'hit', side: 'away', n: snap.ah }));
      if (snap.out != null && prev.out != null && snap.out > prev.out && snap.inn === prev.inn && snap.half === prev.half && snap.batTeam) castBroadcast(room, Object.assign(base(), { kind: 'out', side: snap.batTeam, n: snap.out }));
      if ((snap.inn !== prev.inn || snap.half !== prev.half) && snap.inn) castBroadcast(room, Object.assign(base(), { kind: 'inn', inn: snap.inn, half: snap.half }));
    } else if (sport === 'football') {
      if (snap.hs > prev.hs) castBroadcast(room, Object.assign(base(), { kind: 'goal', side: 'home', hs: snap.hs, as: snap.as }));
      if (snap.as > prev.as) castBroadcast(room, Object.assign(base(), { kind: 'goal', side: 'away', hs: snap.hs, as: snap.as }));
    }
  }
  castSnap[id] = snap;
}
async function castTick() {
  // 사람이 보고 있는 경기방만 폴링 (없으면 스킵 → 서버 부하/쿼리 절약)
  const watched = [...rooms.keys()].filter(r => r.startsWith('event:') && roomSet(r).size > 0);
  if (!watched.length) return;
  const ids = new Set(watched.map(r => r.slice(6)));
  const date = new Date().toISOString().slice(0, 10);
  for (const sport of ['baseball', 'football']) {
    let games = [];
    try { games = (await buildGamesCoreCached(sport, date)).games || []; } catch (e) { continue; }
    for (const g of games) { if (ids.has(String(g.id)) && g.state === 'live') detectCast(sport, g); }
  }
}
setInterval(() => { castTick().catch(() => {}); }, 10000);

// 접속인원 주기적 브로드캐스트(집계 정확도)
setInterval(() => { for (const room of rooms.keys()) sendPresence(room); }, 15000);

// 🛠️ Express 전역 에러 핸들러(모든 라우트 뒤) — 라우트에서 throw돼도 서버 안 죽고 에러 로그/알림
app.use((err, req, res, next) => {
  logError('server', 'express', err, { path: req.path, stack: String((err && err.stack) || '').slice(0, 400) });
  if (!res.headersSent) res.status(500).json({ error: 'internal' });
});

server.listen(PORT, () => {
  console.log(`✅ LiveScore AI 서버 실행 · http://localhost:${PORT}  (TheSportsDB key=${TSDB_KEY})`);
});
