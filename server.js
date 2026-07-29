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

app.get('/api/odds', async (req, res) => {
  if (!ODDS_KEY) return res.json({ needKey: true, games: [] });
  try {
    const sport = req.query.sport || 'soccer_epl';
    const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds/?apiKey=${ODDS_KEY}&regions=uk,eu&markets=h2h&oddsFormat=decimal`;
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
    const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(id)}/odds/?apiKey=${ODDS_KEY}&regions=uk,eu&markets=h2h,spreads,totals&oddsFormat=decimal`;
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
        hs: go.home, as: go.away, status: f.status.short, elapsed: f.status.elapsed,
        date: f.date, state: asState(f.status.short, go.home)
      };
    }
    const l = g.league, t = g.teams, s = g.scores || {};
    const hs = s.home && typeof s.home === 'object' ? (s.home.total ?? s.home.points ?? null) : (s.home ?? null);
    const as = s.away && typeof s.away === 'object' ? (s.away.total ?? s.away.points ?? null) : (s.away ?? null);
    const short = (g.status && (g.status.short || g.status.long)) || '';
    return {
      id: g.id, league: l ? l.name : '', leagueLogo: l ? l.logo : '', country: l ? (l.country ? (l.country.name || l.country) : '') : '',
      home: t.home.name, homeLogo: t.home.logo, away: t.away.name, awayLogo: t.away.logo,
      hs, as, status: short, date: g.date || g.time || (g.timestamp ? new Date(g.timestamp * 1000).toISOString() : null),
      state: asState(short, hs)
    };
  } catch { return null; }
}

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
// 리그명 → The Odds API sport 키 (해외배당 매칭용)
const LEAGUE_TO_ODDS = {
  'MLB': 'baseball_mlb', 'KBO': 'baseball_kbo', 'NPB': 'baseball_npb',
  'Premier League': 'soccer_epl', 'La Liga': 'soccer_spain_la_liga', 'Serie A': 'soccer_italy_serie_a',
  'Bundesliga': 'soccer_germany_bundesliga', 'Ligue 1': 'soccer_france_ligue_one',
  'K League 1': 'soccer_korea_kleague1', 'MLS': 'soccer_usa_mls',
  'NBA': 'basketball_nba', 'WNBA': 'basketball_wnba', 'NHL': 'icehockey_nhl'
};
const normTeam = s => String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
async function oddsLookup(oddsSport) {
  if (!ODDS_KEY) return null;
  const url = `https://api.the-odds-api.com/v4/sports/${oddsSport}/odds/?apiKey=${ODDS_KEY}&regions=uk,eu&markets=h2h&oddsFormat=decimal`;
  const ck = 'OL:' + oddsSport, now = Date.now(), hit = cache.get(ck);
  if (hit && now - hit.t < 300000) return hit.v;   // 5분 캐시(쿼터 절약)
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
      map[normTeam(g.home_team) + '|' + normTeam(g.away_team)] = { home: hi.home || null, away: hi.away || null, draw: hi.draw || null };
    });
    cache.set(ck, { t: now, v: map });
    return map;
  } catch { return null; }
}
function attachOdds(g, map) {
  if (!map) return;
  const hk = normTeam(g.home), ak = normTeam(g.away);
  let f = map[hk + '|' + ak];
  if (!f) {
    for (const k in map) {
      const [kh, ka] = k.split('|');
      if ((kh.includes(hk.slice(0, 5)) || hk.includes(kh.slice(0, 5))) && (ka.includes(ak.slice(0, 5)) || ak.includes(ka.slice(0, 5)))) { f = map[k]; break; }
    }
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
    const j = await asRaw(sport, path, 20000);
    let games = (j.response || []).map(g => normAS(sport, g)).filter(Boolean);
    // 해외배당 붙이기 (매핑되는 주요 리그만)
    const needed = [...new Set(games.map(g => LEAGUE_TO_ODDS[g.league]).filter(Boolean))];
    const maps = {};
    for (const os of needed) maps[os] = await oddsLookup(os);
    games.forEach(g => { const os = LEAGUE_TO_ODDS[g.league]; if (os) attachOdds(g, maps[os]); });
    games.sort((a, b) => (b.state === 'live') - (a.state === 'live'));
    res.json({ sport, date, count: games.length, apiErrors: j.errors || null, results: j.results, games });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
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
