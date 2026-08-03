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
        date: f.date, state: asState(f.status.short, go.home)
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
      date: g.date || g.time || (g.timestamp ? new Date(g.timestamp * 1000).toISOString() : null),
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

// 날짜별 경기 (정규화 + 해외배당 매칭)
app.get('/api/asports/games', async (req, res) => {
  if (!APISPORTS_KEY) return res.json({ needKey: true, games: [] });
  const sport = req.query.sport || 'football';
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const cfg = AS[sport]; if (!cfg) return res.status(400).json({ error: 'bad sport' });
  try {
    const path = `${cfg.path}?date=${date}&timezone=Asia/Seoul`;
    const j = await asRaw(sport, path, 6000);   // 라이브 신선도 우선 (6초)
    let games = (j.response || []).map(g => normAS(sport, g)).filter(Boolean);
    // ⚾ MLB는 공식 StatsAPI로 스코어·상태·이닝 덮어쓰기 (API-Sports 지연 보정 → 실시간)
    // MLB(sportId 1) + LMB 멕시코리그(sportId 23)를 공식 StatsAPI로 실시간 덮어쓰기
    if (sport === 'baseball' && games.some(g => g.league === 'MLB' || g.league === 'LMB')) {
      const sm = {};
      if (games.some(g => g.league === 'MLB')) Object.assign(sm, await mlbScoreMap(date, 1).catch(() => ({})));
      if (games.some(g => g.league === 'LMB')) Object.assign(sm, await mlbScoreMap(date, 23).catch(() => ({})));
      games.forEach(g => {
        if (g.league !== 'MLB' && g.league !== 'LMB') return;
        const hN = mlbNick(g.home), aN = mlbNick(g.away), e = sm[[hN, aN].sort().join('|')];
        if (!e) return;
        const H = e.byNick[hN] || {}, A = e.byNick[aN] || {};
        if (H.r != null) g.hs = H.r;
        if (A.r != null) g.as = A.r;
        g.state = e.state;
        g.status = e.state === 'finished' ? 'FT' : e.state === 'live' ? 'IN' : 'NS';
        if (e.inning != null) { g.curInning = e.inning; g.period = e.inning; }
        if (e.half) g.inningHalf = e.half === 'Top' ? 'top' : e.half === 'Bottom' ? 'bottom' : g.inningHalf;
        if (e.bso) g.bso = e.bso;   // 카드용 볼/스트라이크/아웃 + 주자
        // R/H/E/BB 박스 (카드 미니 스코어보드용)
        const prevH = g.box && g.box.home ? g.box.home : {}, prevA = g.box && g.box.away ? g.box.away : {};
        g.box = {
          home: { r: H.r != null ? H.r : g.hs, h: H.h != null ? H.h : (prevH.h ?? null), e: H.e != null ? H.e : (prevH.e ?? null), bb: H.bb != null ? H.bb : null, innings: prevH.innings || {} },
          away: { r: A.r != null ? A.r : g.as, h: A.h != null ? A.h : (prevA.h ?? null), e: A.e != null ? A.e : (prevA.e ?? null), bb: A.bb != null ? A.bb : null, innings: prevA.innings || {} }
        };
      });
    }
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
        bo: parseInt(p.battingOrder, 10), id: p.person.id, name: p.person.fullName, pos: p.position ? p.position.abbreviation : ''
      }));
      const lineup = arr.filter(p => p.bo % 100 === 0).sort((a, b) => a.bo - b.bo).map((p, i) => ({ order: i + 1, id: p.id, name: p.name, pos: p.pos }));
      let pitcher = null;
      const pid = (T.pitchers || [])[0];
      if (pid && players['ID' + pid]) pitcher = { id: pid, name: players['ID' + pid].person.fullName, pos: 'P' };
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
  for (const sportId of [1, 23]) {   // 1=MLB, 23=LMB(멕시코)
    for (const d of [date, mlbAddDays(date, -1), mlbAddDays(date, 1)]) {
      let sch;
      try { sch = await mlbFetch(`/api/v1/schedule?sportId=${sportId}&date=${d}`, 60000); } catch { continue; }
      const games = [];
      (sch.dates || []).forEach(dd => (dd.games || []).forEach(g => games.push(g)));
    for (const g of games) {
      const st = (g.status && g.status.abstractGameState) || '';
      if (mlbTeamMatch(g.teams.home.team.name, home) && mlbTeamMatch(g.teams.away.team.name, away)) cands.push({ gamePk: g.gamePk, swap: false, st });
      else if (mlbTeamMatch(g.teams.home.team.name, away) && mlbTeamMatch(g.teams.away.team.name, home)) cands.push({ gamePk: g.gamePk, swap: true, st });
      }
    }
  }
  if (!cands.length) return null;
  // 진행 중(Live) > 종료(Final) > 예정(Preview) 순으로 선택 → 시리즈 중 실제 라이브 경기를 잡음
  const rank = s => s === 'Live' ? 0 : s === 'Final' ? 1 : 2;
  cands.sort((a, b) => rank(a.st) - rank(b.st));
  return cands[0];
}
// MLB 스코어/상태/이닝을 공식 StatsAPI로 덮어쓰기용 맵 (API-Sports보다 훨씬 빠름·정확)
async function mlbScoreMap(date, sportId = 1) {
  const map = {};
  const rank = s => s === 'live' ? 0 : s === 'finished' ? 1 : 2;
  for (const d of [date, mlbAddDays(date, -1), mlbAddDays(date, 1)]) {
    let sch;
    try { sch = await mlbFetch(`/api/v1/schedule?sportId=${sportId}&date=${d}&hydrate=linescore`, 15000); } catch { continue; }
    const games = [];
    (sch.dates || []).forEach(dd => (dd.games || []).forEach(g => games.push(g)));
    await Promise.all(games.map(async g => {
      const hN = mlbNick(g.teams.home.team.name), aN = mlbNick(g.teams.away.team.name);
      if (!hN || !aN) return;
      const key = [hN, aN].sort().join('|');
      const st = (g.status && g.status.abstractGameState) || '';
      const ls = g.linescore || {}, lt = ls.teams || {};
      const side = who => ({
        r: g.teams[who].score != null ? g.teams[who].score : (lt[who] && lt[who].runs != null ? lt[who].runs : null),
        h: lt[who] && lt[who].hits != null ? lt[who].hits : null,
        e: lt[who] && lt[who].errors != null ? lt[who].errors : null,
        bb: null
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
