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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  🔐 구글 로그인 (Google Identity Services · ID토큰 서버검증)
//  · Google Cloud에서 OAuth 웹 클라이언트ID 발급 → 환경변수 GOOGLE_CLIENT_ID 에 넣기
//  · 클라이언트ID는 공개값이라 노출돼도 안전 (시크릿 아님)
// ============================================================
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const USERS = new Map(); // sub -> {id,email,name,picture,first,last}
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
      <p style="color:#444;line-height:1.6;font-size:14px">LIVE UP에 오신 것을 환영해요! 이제 실시간 스코어·AI 픽·배당·커뮤니티를 모두 이용하실 수 있어요.</p>
      <ul style="color:#444;font-size:14px;line-height:1.8;padding-left:18px">
        <li>⚡ KBO·NPB·MLB 실시간 스코어와 선수 기록</li>
        <li>🎯 AI 종합 지표 · 승부 예측 PICK</li>
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
app.get('/api/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }));
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
    USERS.set(info.sub, Object.assign({ first: prev ? prev.first : now }, user, { last: now }));
    if (!prev) sendWelcomeMail(user.email, user.name);   // 첫 가입 시 환영 메일
    res.json({ ok: true, user, isNew: !prev });
  } catch (e) { res.json({ ok: false, error: String(e.message || e) }); }
});
app.get('/api/auth/count', (req, res) => res.json({ users: USERS.size }));

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
//  배당 (The Odds API · 실제 해외 북메이커 배당)
//  ※ 무료키를 환경변수 ODDS_API_KEY 에 넣으면 실제 배당 표시.
//    키 없으면 needKey:true 로 안내.
// ============================================================
const ODDS_KEY = process.env.ODDS_API_KEY || '';
const ODDS_SPORTS = [
  { key: 'baseball_kbo', ko: 'KBO', em: '⚾' },
  { key: 'baseball_mlb', ko: 'MLB', em: '⚾' },
  { key: 'baseball_npb', ko: 'NPB', em: '⚾' },
  { key: 'soccer_korea_kleague1', ko: 'K리그1', em: '⚽' },
  { key: 'soccer_epl', ko: 'EPL', em: '⚽' },
  { key: 'soccer_spain_la_liga', ko: '라리가', em: '⚽' },
  { key: 'soccer_usa_mls', ko: 'MLS', em: '⚽' },
  { key: 'basketball_wnba', ko: 'WNBA', em: '🏀' }
];

app.get('/api/odds/sports', (req, res) => res.json({ sports: ODDS_SPORTS, hasKey: !!ODDS_KEY }));

// 진단: The Odds API 남은 크레딧 확인 (헤더 x-requests-remaining)
app.get('/api/odds/quota', async (req, res) => {
  if (!ODDS_KEY) return res.json({ needKey: true });
  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/upcoming/odds/?apiKey=${ODDS_KEY}&regions=us&markets=h2h`);
    const body = await r.text();
    res.json({
      httpStatus: r.status,
      remaining: r.headers.get('x-requests-remaining'),
      used: r.headers.get('x-requests-used'),
      bodyPreview: body.slice(0, 200)
    });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

app.get('/api/odds', async (req, res) => {
  if (!ODDS_KEY) return res.json({ needKey: true, games: [] });
  try {
    const sport = req.query.sport || 'soccer_epl';
    const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds/?apiKey=${ODDS_KEY}&regions=us,uk,eu&markets=h2h&oddsFormat=decimal`;
    const data = await cachedJSON(url, 90000);
    const arr = Array.isArray(data) ? data : [];
    const games = arr.map(g => {
      // 여러 북메이커의 h2h 배당 중 최고값(사용자에게 유리) 집계
      let hi = { home: 0, draw: 0, away: 0 }, books = 0, sample = null;
      (g.bookmakers || []).forEach(bk => {
        const m = (bk.markets || []).find(x => x.key === 'h2h'); if (!m) return;
        books++; if (!sample) sample = bk.title;
        (m.outcomes || []).forEach(o => {
          if (o.name === g.home_team) hi.home = Math.max(hi.home, o.price);
          else if (o.name === g.away_team) hi.away = Math.max(hi.away, o.price);
          else if (o.name === 'Draw') hi.draw = Math.max(hi.draw, o.price);
        });
      });
      return {
        id: g.id, league: g.sport_title, home: g.home_team, away: g.away_team,
        time: g.commence_time,
        homeOdds: hi.home || null, drawOdds: hi.draw || null, awayOdds: hi.away || null,
        books, sample
      };
    }).sort((a, b) => new Date(a.time) - new Date(b.time));
    res.json({ needKey: false, sport, count: games.length, games });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// 단일 경기 상세 배당 (승무패 + 핸디캡 + 오버언더, 업체별)
app.get('/api/odds/event', async (req, res) => {
  if (!ODDS_KEY) return res.json({ needKey: true });
  try {
    const { id, sport } = req.query;
    if (!id || !sport) return res.status(400).json({ error: 'id/sport required' });
    const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(id)}/odds/?apiKey=${ODDS_KEY}&regions=us,uk,eu&markets=h2h,spreads,totals&oddsFormat=decimal`;
    const g = await cachedJSON(url, 60000);
    if (!g || !g.id) return res.json({ event: null });
    const books = (g.bookmakers || []).map(bk => {
      const h2h = (bk.markets || []).find(m => m.key === 'h2h');
      const get = n => { const o = ((h2h && h2h.outcomes) || []).find(x => x.name === n); return o ? o.price : null; };
      const spreads = (bk.markets || []).find(m => m.key === 'spreads');
      const totals = (bk.markets || []).find(m => m.key === 'totals');
      return {
        title: bk.title,
        home: get(g.home_team), away: get(g.away_team), draw: get('Draw'),
        spread: spreads ? (spreads.outcomes || []).map(o => ({ name: o.name, price: o.price, point: o.point })) : [],
        total: totals ? (totals.outcomes || []).map(o => ({ name: o.name, price: o.price, point: o.point })) : []
      };
    });
    const hi = { home: 0, draw: 0, away: 0 };
    books.forEach(b => { if (b.home) hi.home = Math.max(hi.home, b.home); if (b.away) hi.away = Math.max(hi.away, b.away); if (b.draw) hi.draw = Math.max(hi.draw, b.draw); });
    // 대표 핸디/오버언더(첫 업체 값)
    const sampleSpread = (books.find(b => b.spread.length) || {}).spread || [];
    const sampleTotal = (books.find(b => b.total.length) || {}).total || [];
    res.json({
      event: { id: g.id, home: g.home_team, away: g.away_team, time: g.commence_time, league: g.sport_title },
      best: hi, books, sampleSpread, sampleTotal
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// 팀 최근 경기 (TheSportsDB · 팀명 검색 → 최근 5경기)
app.get('/api/team/recent', async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: 'name' });
    const s = await cachedJSON(`${TSDB}/searchteams.php?t=${encodeURIComponent(name)}`, 86400000);
    const team = (s.teams || [])[0];
    if (!team) return res.json({ team: null, events: [] });
    const d = await cachedJSON(`${TSDB}/eventslast.php?id=${team.idTeam}`, 300000);
    const events = (d.results || []).slice(0, 6).map(e => ({
      date: e.dateEvent, home: e.strHomeTeam, away: e.strAwayTeam,
      hs: e.intHomeScore, as: e.intAwayScore, league: e.strLeague
    }));
    res.json({ team: { id: team.idTeam, name: team.strTeam, badge: team.strTeamBadge }, events });
  } catch (e) {
    res.json({ team: null, events: [] });
  }
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

async function asRaw(sport, path, ttl = 30000) {
  const cfg = AS[sport]; if (!cfg) throw new Error('bad sport');
  const url = `https://${cfg.host}${path}`;
  const hit = cache.get(url), now = Date.now();
  if (hit && now - hit.t < ttl) return hit.v;
  const r = await fetch(url, { headers: { 'x-apisports-key': APISPORTS_KEY } });
  if (!r.ok) throw new Error('upstream ' + r.status);
  const v = await r.json();
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
        id: f.id, league: l.name, leagueLogo: l.logo, country: l.country, round: l.round,
        home: t.home.name, homeLogo: t.home.logo, away: t.away.name, awayLogo: t.away.logo,
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
    let livePts = null;
    const pr = g.periods;
    if (pr && typeof pr === 'object') {
      const order = ['fifth', 'fourth', 'third', 'second', 'first'];
      for (const k of order) {
        const p = pr[k];
        if (p && typeof p === 'object' && (p.home != null || p.away != null)) { livePts = { home: p.home, away: p.away }; break; }
      }
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
      if (curInning != null) {
        const hFilled = filled(hi, curInning), aFilled = filled(ai, curInning);
        // 원정팀(초 공격)만 기록 → 초 / 홈팀(말 공격)까지 기록 → 말
        if (aFilled && !hFilled) inningHalf = 'top';
        else if (hFilled) inningHalf = 'bottom';
        else inningHalf = 'top';   // 이닝 시작 직후(초 공격 준비)
      }
      box = {
        home: { r: (s.home && s.home.total != null ? s.home.total : hs), h: (s.home && s.home.hits != null ? s.home.hits : null), e: (s.home && s.home.errors != null ? s.home.errors : null), innings: hi },
        away: { r: (s.away && s.away.total != null ? s.away.total : as), h: (s.away && s.away.hits != null ? s.away.hits : null), e: (s.away && s.away.errors != null ? s.away.errors : null), innings: ai }
      };
    }
    return {
      id: g.id, league: l ? l.name : '', leagueLogo: l ? l.logo : '', country: l ? (l.country ? (l.country.name || l.country) : '') : '',
      home: t.home.name, homeLogo: t.home.logo, away: t.away.name, awayLogo: t.away.logo,
      hs, as, status: short || long, statusLong: long,
      period: g.period || g.inning || curInning || null, timer: g.timer || (g.status && g.status.timer) || null,
      livePts, box, curInning, inningHalf,
      // ⏱️ 절대시각(UTC)로 저장 — 유닉스 timestamp 우선(타임존 문자열은 애매해서 최후순위). 표시/그룹은 기기 타임존으로 변환
      date: (g.timestamp ? new Date(g.timestamp * 1000).toISOString() : (g.date || g.time || null)),
      state: asState(short || long, hs)
    };
  } catch { return null; }
}

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
  const names = Object.keys(process.env).filter(k => /(API|SPORT|ODDS|KEY|FOOTBALL)/i.test(k));
  res.json({
    matchingEnvNames: names,
    apisportsKeyDetected: !!APISPORTS_KEY,
    apisportsKeyLen: APISPORTS_KEY.length
  });
});
// 키/쿼터 상태 확인 (배포 후 검증용)
app.get('/api/asports/status', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ key: false, msg: 'APISPORTS_KEY 미설정' });
  try { const j = await asRaw('football', '/status', 10000); res.json({ key: true, status: j.response || j }); }
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
    const leagues = Object.entries(counts).map(([name, n]) => ({ name, games: n, mapped: sport === 'football' ? !!LEAGUE_TO_ODDS[name] : 'group' })).sort((a, b) => b.games - a.games);
    res.json({ sport, date, leagues });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});
// 리그명 → The Odds API sport 키 (해외배당 매칭용)
const LEAGUE_TO_ODDS = {
  // 야구
  'MLB': 'baseball_mlb', 'KBO': 'baseball_kbo', 'NPB': 'baseball_npb',
  // 축구
  'Premier League': 'soccer_epl', 'La Liga': 'soccer_spain_la_liga', 'Serie A': 'soccer_italy_serie_a',
  'Bundesliga': 'soccer_germany_bundesliga', 'Ligue 1': 'soccer_france_ligue_one', 'Ligue 1 - France': 'soccer_france_ligue_one',
  'K League 1': 'soccer_korea_kleague1', 'Major League Soccer': 'soccer_usa_mls', 'MLS': 'soccer_usa_mls',
  'UEFA Champions League': 'soccer_uefa_champs_league', 'Eredivisie': 'soccer_netherlands_eredivisie',
  'Primeira Liga': 'soccer_portugal_primeira_liga', 'Championship': 'soccer_efl_champ',
  'Serie A - Brazil': 'soccer_brazil_campeonato', 'Brasileirão Série A': 'soccer_brazil_campeonato',
  'Primera División': 'soccer_argentina_primera_division', 'Liga Profesional Argentina': 'soccer_argentina_primera_division',
  'J1 League': 'soccer_japan_j_league', 'J League': 'soccer_japan_j_league',
  'A-League': 'soccer_australia_aleague', 'Süper Lig': 'soccer_turkey_super_league', 'Super Lig': 'soccer_turkey_super_league',
  // 여름 시즌 진행 리그 (북유럽·남미 등)
  'Eliteserien': 'soccer_norway_eliteserien', 'Allsvenskan': 'soccer_sweden_allsvenskan', 'Superettan': 'soccer_sweden_superettan',
  'Veikkausliiga': 'soccer_finland_veikkausliiga', 'Superliga': 'soccer_denmark_superliga',
  'Jupiler Pro League': 'soccer_belgium_first_div', 'First Division A': 'soccer_belgium_first_div',
  'Serie B': 'soccer_brazil_serie_b', 'Liga MX': 'soccer_mexico_ligamx', 'Primera A': 'soccer_chile_campeonato',
  'Super League': 'soccer_china_superleague', 'Premiership': 'soccer_spl', 'Bundesliga 2': 'soccer_germany_bundesliga2',
  '3. Liga': 'soccer_germany_liga3', 'League One': 'soccer_england_league1', 'League Two': 'soccer_england_league2',
  'UEFA Europa League': 'soccer_uefa_europa_league', 'UEFA Champions League Qualifying': 'soccer_uefa_champs_league_qualification',
  // 농구·하키·미식축구·격투기
  'NBA': 'basketball_nba', 'WNBA': 'basketball_wnba', 'NCAA': 'basketball_ncaab',
  'NHL': 'icehockey_nhl', 'NFL': 'americanfootball_nfl', 'MMA': 'mma_mixed_martial_arts'
};
// 앱 종목 → The Odds API 그룹명 (그룹 안의 모든 활성 리그를 가져와 팀명으로 매칭)
// ※ 축구(soccer)는 리그가 60개+라 개별 호출 비용이 커서 LEAGUE_TO_ODDS 매핑을 씀.
// ※ 배구/핸드볼은 The Odds API에 아예 없음 → 배당 불가.
const ODDS_GROUP = { baseball: 'Baseball', basketball: 'Basketball', hockey: 'Ice Hockey', rugby: 'Rugby League' };
let oddsSportsList = null, oddsSportsListT = 0;
async function oddsSportKeys(group) {
  if (!ODDS_KEY || !group) return [];
  const now = Date.now();
  if (!oddsSportsList || now - oddsSportsListT > 3600000) {   // /v4/sports는 크레딧 소모 안 함, 1시간 캐시
    try { const r = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_KEY}`); oddsSportsList = await r.json(); oddsSportsListT = now; }
    catch { return []; }
  }
  return (Array.isArray(oddsSportsList) ? oddsSportsList : []).filter(s => s.group === group && s.active && !s.has_outrights).map(s => s.key);
}
const normTeam = s => String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
// 경기별 배당 영구 저장소(팀쌍 키). 경기 시작 후 The Odds API에서 사라져도 마지막 배당을 계속 보여줌.
const oddsStore = new Map();   // key -> { home, away, draw, t }
const ODDS_STORE_TTL = 8 * 3600 * 1000;   // 8시간 유지
async function oddsLookup(oddsSport) {
  if (!ODDS_KEY) return null;
  const url = `https://api.the-odds-api.com/v4/sports/${oddsSport}/odds/?apiKey=${ODDS_KEY}&regions=us,uk,eu&markets=h2h&oddsFormat=decimal`;
  const ck = 'OL:' + oddsSport, now = Date.now(), hit = cache.get(ck);
  if (hit && now - hit.t < 600000) return hit.v;   // 15분 캐시(무료 쿼터 절약)
  try {
    const r = await fetch(url); if (!r.ok) throw new Error('odds ' + r.status);
    const arr = await r.json();
    const map = {};
    (Array.isArray(arr) ? arr : []).forEach(g => {
      const hi = { home: 0, away: 0, draw: 0 };
      (g.bookmakers || []).forEach(bk => {
        const m = (bk.markets || []).find(x => x.key === 'h2h'); if (!m) return;
        (m.outcomes || []).forEach(o => {
          if (o.name === g.home_team) hi.home = Math.max(hi.home, o.price);
          else if (o.name === g.away_team) hi.away = Math.max(hi.away, o.price);
          else if (o.name === 'Draw') hi.draw = Math.max(hi.draw, o.price);
        });
      });
      const key = normTeam(g.home_team) + '|' + normTeam(g.away_team);
      const val = { home: hi.home || null, away: hi.away || null, draw: hi.draw || null };
      map[key] = val;
      if (val.home || val.away) oddsStore.set(key, { ...val, t: now });   // 영구 저장소에도 적립
    });
    cache.set(ck, { t: now, v: map });
    return map;
  } catch { return null; }
}
function fuzzyFind(container, hk, ak, getEntries) {
  for (const [k, v] of getEntries(container)) {
    const [kh, ka] = k.split('|');
    if ((kh.includes(hk.slice(0, 5)) || hk.includes(kh.slice(0, 5))) && (ka.includes(ak.slice(0, 5)) || ak.includes(ka.slice(0, 5)))) return v;
  }
  return null;
}
function attachOdds(g, map) {
  const hk = normTeam(g.home), ak = normTeam(g.away), pair = hk + '|' + ak;
  let f = map ? map[pair] : null;
  if (!f && map) f = fuzzyFind(map, hk, ak, m => Object.entries(m));
  // 라이브 등으로 현재 맵에 없으면 영구 저장소에서 마지막 배당 사용
  if (!f) {
    const now = Date.now();
    let s = oddsStore.get(pair);
    if (!s) s = fuzzyFind(oddsStore, hk, ak, m => m.entries());
    if (s && now - s.t < ODDS_STORE_TTL) f = s;
  }
  if (f) g.odds = f;
}

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
async function tsFetch(path, params, ttl = 6000) {
  if (TS_PROXY) {
    // 릴레이가 user/secret 를 붙여 TheSports로 전달 → 요청 IP = VPS 고정 IP
    // 릴레이 base는 api.thesports.com(버전 없음)이므로 /v1 을 여기서 붙임
    const qs = new URLSearchParams(Object.assign({ token: TS_RELAY_TOKEN }, params || {})).toString();
    return cachedJSON(`${TS_PROXY}/ts/v1${path}?${qs}`, ttl);
  }
  const qs = new URLSearchParams(Object.assign({ user: TS_USER, secret: TS_SECRET }, params || {})).toString();
  return cachedJSON(`${TS_BASE}${path}?${qs}`, ttl);
}
// 축구 status_id → 상태/표기 (TheSports enum)
function tsFootState(s) { s = Number(s); if (s === 8) return 'finished'; if ([2, 3, 4, 5, 7].includes(s)) return 'live'; return 'scheduled'; }
function tsFootStatus(s) { return ({ 1: 'NS', 2: '1H', 3: 'HT', 4: '2H', 5: 'ET', 7: 'PEN', 8: 'FT' })[Number(s)] || 'NS'; }
// 축구 경기목록(diary) + 실시간(detail_live) 오버레이 → 우리 표준 형태로
async function tsFootballGames(date) {
  const ymd = String(date).replace(/-/g, '');
  const d = await tsFetch('/football/match/diary', { date: ymd }, 6000);
  const ex = d.results_extra || {};
  const teams = {}, comps = {};
  (ex.team || []).forEach(t => teams[t.id] = { name: t.name, logo: t.logo });
  (ex.competition || []).forEach(c => comps[c.id] = { name: c.name, logo: c.logo });
  // 실시간 오버레이 (진행 경기)
  const live = {};
  try {
    const lv = await tsFetch('/football/match/detail_live', {}, 6000);
    (lv.results || []).forEach(m => { const s = m.score || m; if (Array.isArray(s)) live[s[0]] = { st: s[1], h: (s[2] || [])[0], a: (s[3] || [])[0] }; });
  } catch (e) {}
  return (d.results || []).map(m => {
    const ht = teams[m.home_team_id] || {}, at = teams[m.away_team_id] || {}, cp = comps[m.competition_id] || {};
    const lvm = live[m.id];
    const sid = lvm ? lvm.st : m.status_id;
    let hs = m.home_scores ? m.home_scores[0] : null, as = m.away_scores ? m.away_scores[0] : null;
    if (lvm) { if (lvm.h != null) hs = lvm.h; if (lvm.a != null) as = lvm.a; }
    return {
      id: m.id, sport: 'football',
      home: ht.name || m.home_team_id, away: at.name || m.away_team_id,
      homeLogo: ht.logo || '', awayLogo: at.logo || '',
      league: cp.name || '', leagueLogo: cp.logo || '',
      hs, as, state: tsFootState(sid), status: tsFootStatus(sid), statusLong: '',
      date: m.match_time ? new Date(m.match_time * 1000).toISOString() : null, elapsed: null
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
async function tsLiveBox(matchId, ttl = 4000) {
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
    const lv = await tsFetch('/baseball/match/detail_live', {}, 6000);
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
      // 공격팀: detail_live batTeam(1=홈,2=원정) 우선, 없으면 초=원정/말=홈
      if (lvm.batTeam === 1) g.batting = 'home';
      else if (lvm.batTeam === 2) g.batting = 'away';
      else if (g.inningHalf) g.batting = g.inningHalf === 'top' ? 'away' : 'home';
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
async function buildGamesCore(sport, date, tz) {
  const cfg = AS[sport]; if (!cfg) return { games: [], j: {} };
  tz = tz || 'Asia/Seoul';
  // 🗓️ 날짜 그룹 — KBO/NPB=한국시간, MLB=미국(동부) 날짜 기준. 미국 저녁 경기는 한국시간 다음날 새벽이라 전날·다음날치도 받아 필터
  const prevDate = new Date(Date.parse(date + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
  const nextDate = new Date(Date.parse(date + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  // 야구만 전날·당일·다음날 3일치(미국 리그 KST 시차 보정). 그 외 종목은 API가 timezone으로 이미 정확히 그룹 → 당일만(호출량 절약)
  const apiDates = (sport === 'baseball') ? [prevDate, date, nextDate] : [date];
  let j = {}; let games = []; const _seen = new Set();
  for (const dt of apiDates) {
    const jj = await asRaw(sport, `${cfg.path}?date=${dt}&timezone=${encodeURIComponent(tz)}`, 6000).catch(() => ({ response: [] }));
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
  // ⚾ KBO(한국)·NPB(일본) = TheSports 실시간으로 교체 (API-Sports 지연 보정)
  if (sport === 'baseball' && TS_ON) {
    try {
      // KBO(한국)·NPB(일본)·CPBL(대만) 아시아 프로리그만 TheSports로 (고교/아마추어 제외)
      const wantRe = /KBO|NPB|CPBL|Korea|Korean|Nippon|Japan|Chinese Professional|Taiwan|일본|한국|대만|Futures|퓨처스|퓨쳐스|Eastern League|Western League/i;
      const hsRe = /koshien|senbatsu|high\s*school|甲子園|고교|amateur|university|college/i;
      // KBO/NPB/CPBL은 아시아(한국시간) 리그 → 보는 날짜 하루만 조회 (전날치까지 넣으면 날짜필터에 걸려 사라지는 버그 방지 + 호출 절감)
      const ts = await tsBaseballGames(date).catch(() => []);
      const kn = ts.filter(g => wantRe.test(g.league || '') && !hsRe.test(g.league || ''));
      if (kn.length) {
        // TheSports가 해당 날짜 경기를 갖고 있을 때만 API-Sports 동일리그 제거 후 교체(더 정확). 없으면 API-Sports 그대로 유지
        games = games.filter(g => !wantRe.test(g.league || ''));
        games = games.concat(kn);
      }
    } catch (e) { /* TheSports 실패 시 API-Sports 유지 */ }
  }
  // 🗓️ 야구만 날짜 필터: 경기 시작(UTC)을 기기 타임존으로 변환한 날짜가 선택 날짜와 같은 경기만 (MLB KST 시차 정확 처리)
  //    그 외 종목은 API가 timezone 파라미터로 이미 그날 경기만 반환 → 추가 필터 없음(경기 누락 방지)
  if (sport === 'baseball') games = games.filter(g => !g.date || ymdInTz(g.date, tz) === date);
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
  // ⚽ 라이브 축구: 팀별 옐로/레드 카드 수 (피드 목록 표시용) — 라이브 경기만, 경기당 30초 캐시로 호출 최소화
  if (sport === 'football') {
    const liveG = games.filter(g => g.state === 'live').slice(0, 40);
    await Promise.all(liveG.map(async g => {
      try {
        const ck = 'FBC:' + g.id, hit = cache.get(ck);
        let cards;
        if (hit && Date.now() - hit.t < 30000) cards = hit.v;
        else {
          const j2 = await asRaw('football', `/fixtures/events?fixture=${g.id}`, 9000);
          const c = { home: { y: 0, r: 0 }, away: { y: 0, r: 0 } };
          (j2.response || []).forEach(ev => {
            if ((ev.type || '') !== 'Card') return;
            const tn = ev.team ? ev.team.name : '';
            const side = tn === g.home ? 'home' : tn === g.away ? 'away' : null;
            if (!side) return;
            if (/red/i.test(ev.detail || '')) c[side].r++; else c[side].y++;
          });
          cards = c; cache.set(ck, { t: Date.now(), v: cards });
        }
        if (cards.home.y || cards.home.r || cards.away.y || cards.away.r) g.cards = cards;
      } catch {}
    }));
  }
  return { games, j };
}

// ⚡ 경기목록 전체 결과를 짧게 캐시 (피드 7초·중계봇 10초·픽제공·푸시가 공유 → 외부호출/CPU 절감)
const gamesCoreCache = new Map();
async function buildGamesCoreCached(sport, date, tz, ttl = 8000) {
  const k = sport + '|' + date + '|' + (tz || '');
  const hit = gamesCoreCache.get(k), now = Date.now();
  if (hit) {
    // ⚡ stale-while-revalidate: 만료돼도 이전 값 즉시 반환 + 뒤에서 갱신 → 모든 요청이 즉시 응답
    if (now - hit.t >= ttl && !hit.refreshing) {
      hit.refreshing = true;
      buildGamesCore(sport, date, tz)
        .then(v => gamesCoreCache.set(k, { t: Date.now(), v }))
        .catch(() => { hit.refreshing = false; });
    }
    return hit.v;
  }
  const v = await buildGamesCore(sport, date, tz);   // 최초 1회만 대기
  gamesCoreCache.set(k, { t: now, v });
  if (gamesCoreCache.size > 40) { for (const [key, val] of gamesCoreCache) { if (now - val.t > 120000) gamesCoreCache.delete(key); } }
  return v;
}
// 날짜별 경기 (정규화 + 해외배당 매칭)
app.get('/api/asports/games', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true, games: [] });
  const sport = req.query.sport || 'football';
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const cfg = AS[sport]; if (!cfg) return res.status(400).json({ error: 'bad sport' });
  try {
    const { games, j } = await buildGamesCoreCached(sport, date, req.query.tz);
    // ⚡ 배당 매칭:
    //   - 축구: 리그가 너무 많아 LEAGUE_TO_ODDS 매핑으로 필요한 리그만 조회
    //   - 그 외(야구/농구/하키/럭비): The Odds API 그룹 안의 활성 리그 전부 조회해 팀명으로 매칭
    //     → MLB·KBO·NPB·MiLB, NBA·WNBA·유로리그, NHL·SHL 등 자동 커버
    let needed;
    if (sport === 'football') {
      needed = [...new Set(games.map(g => LEAGUE_TO_ODDS[g.league]).filter(Boolean))];
    } else {
      needed = await oddsSportKeys(ODDS_GROUP[sport]);
    }
    const merged = {};
    await Promise.all(needed.map(async os => {
      let map = null;
      const hit = cache.get('OL:' + os);
      if (hit && Date.now() - hit.t < 600000) map = hit.v;
      else map = await Promise.race([oddsLookup(os), new Promise(r => setTimeout(() => r(null), 3500))]);
      if (map) Object.assign(merged, map);
    }));
    // 모든 경기에 팀명으로 매칭 시도 (merged에 없으면 attachOdds가 영구 저장소에서 보완)
    games.forEach(g => attachOdds(g, merged));
    games.sort((a, b) => (b.state === 'live') - (a.state === 'live'));
    res.json({ sport, date, count: games.length, apiErrors: j.errors || null, results: j.results, games });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// 축구 실시간 이벤트 (골·퇴장·경고·교체) — 선수 이름 포함 (API-Sports 축구만 제공)
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
      type: ev.type || '',
      detail: ev.detail || '',
      player: ev.player ? ev.player.name : '',
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
    const j = await asRaw('football', `/fixtures/lineups?fixture=${encodeURIComponent(fixture)}`, 120000);
    const teams = (j.response || []).map(t => ({
      team: t.team ? t.team.name : '', logo: t.team ? t.team.logo : '',
      formation: t.formation || '',
      coach: t.coach ? t.coach.name : '',
      startXI: (t.startXI || []).map(x => ({ id: x.player.id, name: x.player.name, number: x.player.number, pos: x.player.pos, grid: x.player.grid })),
      subs: (t.substitutes || []).map(x => ({ id: x.player.id, name: x.player.name, number: x.player.number, pos: x.player.pos }))
    }));
    res.json({ teams });
  } catch (e) { res.status(502).json({ error: String(e.message || e), teams: [] }); }
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
      if (st === 'Live' || st === 'Final') {
        try {
          const box = await mlbFetch(`/api/v1/game/${g.gamePk}/boxscore`, 30000);
          const bt = who => (box.teams[who] && box.teams[who].teamStats && box.teams[who].teamStats.batting) || {};
          const bh = bt('home'), ba = bt('away');
          hs.bb = bh.baseOnBalls != null ? bh.baseOnBalls : null; if (hs.h == null) hs.h = bh.hits != null ? bh.hits : null;
          as.bb = ba.baseOnBalls != null ? ba.baseOnBalls : null; if (as.h == null) as.h = ba.hits != null ? ba.hits : null;
        } catch {}
      }
      // 진행 중 경기: 볼/스트라이크/아웃 + 주자(1·2·3루) — 카드(바깥)에서 바로 보이도록
      let bso = null;
      if (st === 'Live') {
        try {
          const fl = await mlbFetch(`/api/v1/game/${g.gamePk}/linescore`, 8000);
          const off = fl.offense || {};
          bso = {
            balls: fl.balls != null ? fl.balls : null, strikes: fl.strikes != null ? fl.strikes : null, outs: fl.outs != null ? fl.outs : null,
            bases: { first: !!off.first, second: !!off.second, third: !!off.third },
            batter: off.batter ? off.batter.fullName : null
          };
        } catch {}
      }
      const entry = {
        state: st === 'Final' ? 'finished' : st === 'Live' ? 'live' : 'scheduled',
        inning: ls.currentInning != null ? ls.currentInning : null,
        half: ls.inningHalf || null,
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
  res.json({ ok: true, count: subs.size });
});
app.post('/api/push/unsubscribe', (req, res) => {
  const ep = req.body && req.body.endpoint; if (ep) subs.delete(ep);
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
    catch (err) { if (err && (err.statusCode === 404 || err.statusCode === 410)) subs.delete(ep); }
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

server.listen(PORT, () => {
  console.log(`✅ LiveScore AI 서버 실행 · http://localhost:${PORT}  (TheSportsDB key=${TSDB_KEY})`);
});
