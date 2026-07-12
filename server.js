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
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
// TheSportsDB 무료 테스트 키("3"/"123"). 유료 키가 있으면 환경변수로 교체.
const TSDB_KEY = process.env.THESPORTSDB_KEY || '3';
const TSDB = `https://www.thesportsdb.com/api/v1/json/${TSDB_KEY}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 간단 캐시 (레이트리밋 보호) ----------
const cache = new Map();
async function cachedJSON(url, ttlMs = 30000) {
  const hit = cache.get(url);
  const now = Date.now();
  if (hit && now - hit.t < ttlMs) return hit.v;
  const r = await fetch(url, { headers: { 'User-Agent': 'livescore-ai/1.0' } });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
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

// ============================================================
//  커뮤니티 게시판 (자유 / 수익인증 / 손실인증)
//  ※ 메모리 저장(서버 재시작 시 초기화). DB 붙이면 영구 저장 가능.
// ============================================================
const BOARDS = ['free', 'profit', 'loss'];
const posts = { free: [], profit: [], loss: [] };
let postSeq = 1;
// 시작 시 예시 글 몇 개
posts.free.push({ id: postSeq++, name: '운영자', title: '커뮤니티가 열렸습니다 🎉', text: '자유롭게 이야기 나눠주세요. 서로 존중하는 매너 채팅 부탁드립니다.', ts: Date.now(), up: 3 });
posts.profit.push({ id: postSeq++, name: '고수픽', title: '오늘 야구 3연승 인증', text: 'AI 답픽 그대로 따라가서 수익 봤습니다. 다들 성투하세요!', ts: Date.now(), up: 12 });
posts.loss.push({ id: postSeq++, name: '초보', title: '막판 역전패 손실…', text: '다 이긴 경기였는데 9회에 뒤집혔네요. 다음엔 언더로 갑니다.', ts: Date.now(), up: 5 });

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
function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const c of roomSet(room)) { if (c.readyState === 1) c.send(msg); }
}
function sendPresence(room) {
  broadcast(room, { type: 'presence', room, count: presence(room), total: totalOnline() });
}

const ADJ = ['축구', '야구', '농구', '열혈', '냉정', '분석', '고수', '초보', '행운', '전설'];
const NOUN = ['팬', '유저', '관중', '분석가', '픽마', '중립러', '해설가', '서포터'];
function guestName() { return ADJ[Math.random()*ADJ.length|0] + NOUN[Math.random()*NOUN.length|0] + (Math.random()*900+100|0); }

wss.on('connection', (ws) => {
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
      ws.send(JSON.stringify({ type: 'joined', room: ws.room, history: HISTORY.get(ws.room) || [] }));
      sendPresence(prev); sendPresence(ws.room);
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
    roomSet(ws.room).delete(ws);
    sendPresence(ws.room);
  });
});

// 접속인원 주기적 브로드캐스트(집계 정확도)
setInterval(() => { for (const room of rooms.keys()) sendPresence(room); }, 15000);

server.listen(PORT, () => {
  console.log(`✅ LiveScore AI 서버 실행 · http://localhost:${PORT}  (TheSportsDB key=${TSDB_KEY})`);
});
