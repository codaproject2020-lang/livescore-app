// ============================================================
//  LiveScore AI · Frontend
// ============================================================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SPORTS = [
  { key: 'Soccer', ko: '축구', em: '⚽' },
  { key: 'Baseball', ko: '야구', em: '⚾' },
  { key: 'Basketball', ko: '농구', em: '🏀' },
  { key: 'Ice Hockey', ko: '하키', em: '🏒' },
  { key: 'American Football', ko: '미식축구', em: '🏈' },
  { key: 'Tennis', ko: '테니스', em: '🎾' },
  { key: 'Volleyball', ko: '배구', em: '🏐' }
];

const state = {
  date: new Date().toISOString().slice(0, 10),
  sport: 'Baseball',   // 여름철 진행 종목 기본
  leagues: []
};

// ---------- 팀 뱃지/엠블럼 ----------
function badge(url, fallback) {
  return url
    ? `<img src="${esc(url)}" onerror="this.replaceWith(document.createTextNode('${fallback}'))" alt="">`
    : fallback;
}

// ============================================================
//  탭 전환
// ============================================================
const views = { live: 'view-live', table: 'view-table', comm: 'view-comm' };
function setTab(t) {
  Object.values(views).forEach(id => $('#' + id)?.classList.add('hidden'));
  $('#' + views[t])?.classList.remove('hidden');
  $$('.topbar .tt[data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  if (t === 'table' && !$('#tblLeague').options.length) buildTableControls();
}
$$('.topbar .tt[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

// ============================================================
//  종목 / 리그 네비 구성
// ============================================================
function buildSportNav() {
  const row = SPORTS.map(s => `<div class="sp ${s.key === state.sport ? 'on' : ''}" data-sport="${s.key}" title="${s.ko}">${s.em}</div>`).join('');
  $('#sportRow').innerHTML = row;
  const list = SPORTS.map(s => `<a data-sport="${s.key}" class="${s.key === state.sport ? 'on' : ''}"><span class="em">${s.em}</span>${s.ko}</a>`).join('');
  $('#sportNav').innerHTML = list;
  $('#sportNavD').innerHTML = list;
  $$('[data-sport]').forEach(el => el.addEventListener('click', () => { state.sport = el.dataset.sport; buildSportNav(); loadEvents(); closeDrawer(); }));
}
function buildLeagueNav() {
  const items = state.leagues.map(l => `<a data-league="${l.id}" data-sport="${l.sport}"><span class="em">${l.flag}</span>${l.name}</a>`).join('');
  $('#leagueNav').innerHTML = items;
  $('#leagueNavD').innerHTML = items;
  $$('[data-league]').forEach(el => el.addEventListener('click', () => {
    state.sport = el.dataset.sport; buildSportNav();
    loadEvents(el.dataset.league); closeDrawer();
  }));
}

// ============================================================
//  fetch + 자동 재시도 (무료 서버 콜드스타트 대응)
// ============================================================
async function fetchJSON(url, { tries = 15, delay = 4000, onWait } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) throw new Error('not-json');
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      if (onWait) onWait(i + 1);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

// ============================================================
//  이벤트 로드 & 렌더
// ============================================================
async function loadEvents(focusLeague) {
  const feed = $('#feed');
  feed.innerHTML = `<div class="loading">경기 불러오는 중…</div>`;
  try {
    const d = await fetchJSON(`/api/events?date=${state.date}&sport=${encodeURIComponent(state.sport)}`, {
      onWait: (n) => { feed.innerHTML = `<div class="loading">⏳ 무료 서버를 깨우는 중이에요…<br>최초 접속은 최대 1분 정도 걸릴 수 있어요.<br><span style="color:#aeb6c0">(자동 재시도 ${n})</span></div>`; }
    });
    let events = d.events || [];
    if (focusLeague) events = events.filter(e => e.leagueId === focusLeague);
    renderFeed(events);
  } catch (e) {
    feed.innerHTML = `<div class="loading">데이터를 불러오지 못했습니다.<br><button onclick="loadEvents()" style="margin-top:10px;padding:9px 18px;border:none;border-radius:8px;background:#2f6fed;color:#fff;font-weight:800;cursor:pointer">다시 시도</button></div>`;
  }
}

function stateBadge(e) {
  if (e.state === 'live') {
    const label = e.progress || e.status || 'LIVE';
    return `<span class="badge-state live">● ${esc(label)}</span>`;
  }
  if (e.state === 'finished') return `<span class="badge-state ft">종료</span>`;
  return `<span class="badge-state sched">${esc((e.time || '').slice(0, 5) || '예정')}</span>`;
}

function scoreBlock(e) {
  if (e.state === 'scheduled' || (e.homeScore == null && e.awayScore == null)) {
    return `<div class="mid">${stateBadge(e)}<div class="vs">VS</div></div>`;
  }
  const cls = e.state === 'live' ? 'score live' : 'score';
  return `<div class="mid">${stateBadge(e)}<div class="scores"><span class="${cls}">${esc(e.homeScore ?? 0)}</span><span class="vs">:</span><span class="${cls}">${esc(e.awayScore ?? 0)}</span></div></div>`;
}

function predictBanner(e) {
  const h = Number(e.homeScore), a = Number(e.awayScore);
  let side = e.home, pct = 50;
  if (!isNaN(h) && !isNaN(a) && h !== a) { side = h > a ? e.home : e.away; pct = 55 + Math.min(35, Math.abs(h - a) * 9); }
  const ou = (!isNaN(h) && !isNaN(a) && (h + a) >= 3) ? '오버' : '언더';
  return `<div class="ansban" data-ev="${e.id}"><span class="badge">답</span><span class="t"><b>${esc(side)} ${pct}%</b> <span class="g">/ 핸디 / ${ou}</span></span><span class="go">›</span></div>`;
}

function matchCard(e) {
  return `<div class="match" data-ev="${e.id}">
    <span class="bell">🔔</span>
    <div class="mrow">
      <div class="side"><div class="ph">${badge(e.homeBadge, '🏟')}</div><div class="team">${esc(e.home)}</div></div>
      ${scoreBlock(e)}
      <div class="side"><div class="ph">${badge(e.awayBadge, '🏟')}</div><div class="team">${esc(e.away)}</div></div>
    </div>
    <span class="pick">픽</span>
  </div>`;
}

function renderFeed(events) {
  const feed = $('#feed');
  if (!events.length) {
    feed.innerHTML = `<div class="loading">${esc(state.date)} · ${SPORTS.find(s=>s.key===state.sport)?.ko || state.sport} 경기가 없습니다.<br>날짜를 바꾸거나 다른 종목을 선택해 보세요.</div>`;
    return;
  }
  // 리그별 그룹
  const groups = {};
  events.forEach(e => { (groups[e.leagueId] = groups[e.leagueId] || { league: e, items: [] }).items.push(e); });
  // live 우선
  const order = Object.values(groups).sort((a, b) =>
    (b.items.some(x => x.state === 'live') - a.items.some(x => x.state === 'live')));

  feed.innerHTML = order.map(g => {
    const lg = g.league;
    const live = g.items.filter(x => x.state === 'live').length;
    const head = `<div class="lghd"><span class="flag">${badge(lg.leagueBadge, '🏆')}</span><span class="nm">${esc(lg.league)}</span><span class="cnt">(${g.items.length})</span>${live ? `<span class="live-dot" style="color:#e2231a;font-weight:800">🔴 ${live} LIVE</span>` : ''}<span class="up">∧</span></div>`;
    const body = g.items.map(e => {
      const showAns = e.state !== 'finished';
      return (showAns ? predictBanner(e) : '') + matchCard(e);
    }).join('');
    return `<div class="lg">${head}${body}</div>`;
  }).join('');

  // 리그 접기
  $$('#feed .lghd').forEach(h => h.addEventListener('click', () => {
    let el = h.nextElementSibling; const arr = h.querySelector('.up'); const col = arr.textContent === '∨';
    while (el && !el.classList.contains('lghd')) { el.style.display = col ? '' : 'none'; el = el.nextElementSibling; }
    arr.textContent = col ? '∧' : '∨';
  }));
  // 클릭 → 상세
  $$('#feed [data-ev]').forEach(el => el.addEventListener('click', () => openEvent(el.dataset.ev)));
}

// ============================================================
//  경기 상세 모달
// ============================================================
async function openEvent(id) {
  $('#scrim').classList.add('on'); $('#modal').classList.add('on');
  $('#mBody').innerHTML = `<div class="loading">상세 정보 불러오는 중…</div>`;
  try {
    const [ed, pd] = await Promise.all([
      fetch(`/api/event?id=${id}`).then(r => r.json()),
      fetch(`/api/predict?id=${id}`).then(r => r.json()).catch(() => null)
    ]);
    const e = ed.event; if (!e) throw new Error('no data');
    const pr = await fetch(`/api/predict?h=${e.homeScore ?? ''}&a=${e.awayScore ?? ''}`).then(r => r.json());
    $('#mTitle').textContent = e.league || '경기 상세';
    const box = ed.boxscore ? `<div class="box">${esc(ed.boxscore.replace(/<br>/g, '\n').replace(/<[^>]+>/g, ''))}</div>` : '';
    $('#mBody').innerHTML = `
      <div class="mteams">
        <div class="mt"><div class="ph">${badge(e.homeBadge, '🏟')}</div><div class="nm">${esc(e.home)}</div></div>
        <div class="msc"><div class="n">${e.state==='scheduled'?'VS':`${esc(e.homeScore??0)} : ${esc(e.awayScore??0)}`}</div><div class="st" style="color:${e.state==='live'?'#e2231a':'#8b93a0'}">${esc(e.progress||e.status||(e.time||'').slice(0,5)||'예정')}</div></div>
        <div class="mt"><div class="ph">${badge(e.awayBadge, '🏟')}</div><div class="nm">${esc(e.away)}</div></div>
      </div>
      <div class="probwrap">
        <div class="probttl"><span>🤖 AI 승부 예측</span><span>신뢰도 ${pr.confidence}%</span></div>
        <div class="probbar"><div class="pw" style="width:${pr.home}%">${pr.home}%</div><div class="pd" style="width:${pr.draw}%">${pr.draw}%</div><div class="pl" style="width:${pr.away}%">${pr.away}%</div></div>
        <div class="problbl"><span>${esc(e.home)} 승</span><span>무</span><span>${esc(e.away)} 승</span></div>
      </div>
      <div class="minfo">
        <div><span class="k">리그</span> ${esc(e.league)} ${e.round ? '· '+esc(e.round)+'R' : ''}</div>
        <div><span class="k">일시</span> ${esc(e.date)} ${esc((e.time||'').slice(0,5))}</div>
        <div><span class="k">경기장</span> ${esc(e.venue || '-')}</div>
        <div><span class="k">상태</span> ${esc(e.status || '-')}</div>
      </div>
      ${box}
      ${e.video ? `<a class="mchat-open" style="background:#c4302b;margin-bottom:8px;display:block" href="${esc(e.video)}" target="_blank" rel="noopener">▶ 하이라이트 영상 보기</a>` : ''}
      <div class="mchat-open" id="joinRoom" data-room="event:${e.id}">💬 이 경기 대화방 입장 (${esc(e.home)} vs ${esc(e.away)})</div>
    `;
    $('#joinRoom')?.addEventListener('click', () => { joinRoom($('#joinRoom').dataset.room, `${e.home} vs ${e.away}`); closeModal(); setTab('comm'); });
  } catch (e) {
    $('#mBody').innerHTML = `<div class="loading">상세 정보를 불러오지 못했습니다.</div>`;
  }
}
function closeModal() { $('#scrim').classList.remove('on'); $('#modal').classList.remove('on'); }
$('#mClose').addEventListener('click', closeModal);
$('#scrim').addEventListener('click', closeModal);

// ============================================================
//  순위표
// ============================================================
function buildTableControls() {
  $('#tblLeague').innerHTML = state.leagues.map(l => `<option value="${l.id}" data-season="${l.sport==='Baseball'?'2026':'2025-2026'}">${l.name}</option>`).join('');
  $('#tblSeason').value = '2025-2026';
  $('#tblLeague').addEventListener('change', () => { $('#tblSeason').value = $('#tblLeague').selectedOptions[0].dataset.season; });
  $('#tblSeason').value = $('#tblLeague').selectedOptions[0]?.dataset.season || '2025-2026';
  $('#tblLoad').addEventListener('click', loadTable);
  loadTable();
}
async function loadTable() {
  const id = $('#tblLeague').value, season = $('#tblSeason').value.trim();
  const wrap = $('#tableWrap'); wrap.innerHTML = `<div class="loading">순위 불러오는 중…</div>`;
  try {
    const d = await fetch(`/api/table?id=${id}&season=${encodeURIComponent(season)}`).then(r => r.json());
    const t = d.table || [];
    if (!t.length) { wrap.innerHTML = `<div class="loading">해당 시즌 순위 데이터가 없습니다. 시즌 형식을 확인하세요.<br>(축구: 2025-2026 / 야구·농구: 2026)</div>`; return; }
    wrap.innerHTML = `<table class="rank"><thead><tr><th>#</th><th style="text-align:left">팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>승점</th></tr></thead><tbody>${
      t.map(x => `<tr><td>${esc(x.intRank)}</td><td class="tm">${badge(x.strBadge,'🏳')}${esc(x.strTeam)}</td><td>${esc(x.intPlayed)}</td><td>${esc(x.intWin)}</td><td>${esc(x.intDraw)}</td><td>${esc(x.intLoss)}</td><td class="pt">${esc(x.intPoints)}</td></tr>`).join('')
    }</tbody></table>`;
  } catch (e) {
    wrap.innerHTML = `<div class="loading">순위를 불러오지 못했습니다.</div>`;
  }
}

// ============================================================
//  WebSocket · 채팅 + 접속인원
// ============================================================
let ws, myName = '손님', curRoom = 'all', curRoomLabel = '전경기 대화방';
const chatUIs = [];

function buildChatUI(container) {
  const tpl = $('#chatTpl').content.cloneNode(true);
  container.innerHTML = '';
  container.appendChild(tpl);
  const msgs = $('.chat-msgs', container), input = $('.ci', container), send = $('.cs', container);
  const doSend = () => { const v = input.value.trim(); if (!v || !ws || ws.readyState !== 1) return; ws.send(JSON.stringify({ type: 'chat', text: v })); input.value = ''; };
  send.addEventListener('click', doSend);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
  const ui = { msgs, input };
  chatUIs.push(ui);
  return ui;
}
const seenMsgs = new Set();
function addMsg(m) {
  // 중복 방지(소켓 재연결 등으로 같은 메시지가 두 번 오는 것 차단)
  if (m.type === 'chat') {
    const key = (m.ts || '') + '|' + m.name + '|' + m.text;
    if (seenMsgs.has(key)) return;
    seenMsgs.add(key);
  }
  chatUIs.forEach(ui => {
    const div = document.createElement('div');
    if (m.type === 'sys') { div.className = 'cmsg'; div.innerHTML = `<span class="sys">${esc(m.text)}</span>`; }
    else { div.className = 'cmsg' + (m.name === myName ? ' me' : ''); div.innerHTML = `<span class="u">${esc(m.name)}</span>${esc(m.text)}`; }
    ui.msgs.appendChild(div);
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
  });
}
function clearMsgs() { chatUIs.forEach(ui => ui.msgs.innerHTML = ''); seenMsgs.clear(); }
function setOnline(total) { ['#onlineAll', '#onlineR', '#onlineD'].forEach(s => { const el = $(s); if (el) el.textContent = total; }); }

function joinRoom(room, label) {
  if (!ws || ws.readyState !== 1) return;
  curRoom = room; curRoomLabel = label || room;
  ws.send(JSON.stringify({ type: 'join', room }));
  clearMsgs();
  addMsg({ type: 'sys', text: `『${curRoomLabel}』 입장` });
}

function connectWS() {
  // 이미 연결(또는 연결 중)이면 새로 만들지 않음 → 소켓 중복 방지
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type === 'welcome') { myName = m.name; $('#drawerName').textContent = m.name; clearMsgs(); (m.history || []).forEach(addMsg); addMsg({ type: 'sys', text: `『${curRoomLabel}』 실시간 채팅에 연결되었습니다 · ${m.name}` }); }
    else if (m.type === 'joined') { clearMsgs(); (m.history || []).forEach(addMsg); }
    else if (m.type === 'chat') addMsg(m);
    else if (m.type === 'presence') setOnline(m.total);
  };
  ws.onclose = () => { addMsg({ type: 'sys', text: '연결이 끊겼습니다. 재접속 중…' }); setTimeout(connectWS, 2500); };
}

// ============================================================
//  날짜 네비 / 드로어 / 기타
// ============================================================
function shiftDate(days) {
  const d = new Date(state.date); d.setDate(d.getDate() + days);
  state.date = d.toISOString().slice(0, 10); $('#datePick').value = state.date;
  $('#dateToday').textContent = (state.date === new Date().toISOString().slice(0, 10)) ? '오늘' : state.date.slice(5);
  loadEvents();
}
$('#datePrev').addEventListener('click', () => shiftDate(-1));
$('#dateNext').addEventListener('click', () => shiftDate(1));
$('#dateToday').addEventListener('click', () => { state.date = new Date().toISOString().slice(0, 10); $('#datePick').value = state.date; $('#dateToday').textContent = '오늘'; loadEvents(); });
$('#datePick').addEventListener('change', e => { state.date = e.target.value; $('#dateToday').textContent = (state.date === new Date().toISOString().slice(0,10)) ? '오늘' : state.date.slice(5); loadEvents(); });
$('#btnRefresh').addEventListener('click', () => loadEvents());
$('#btnBell').addEventListener('click', () => alert('알림 (데모)'));
$('#btnUser').addEventListener('click', openDrawer);
$('#btnMenu').addEventListener('click', openDrawer);
function openDrawer() { $('#drawer').classList.add('on'); $('#scrimD').classList.add('on'); }
function closeDrawer() { $('#drawer').classList.remove('on'); $('#scrimD').classList.remove('on'); }
$('#scrimD').addEventListener('click', closeDrawer);

// ============================================================
//  INIT
// ============================================================
async function init() {
  $('#datePick').value = state.date;
  buildChatUI($('#chatDesk'));
  buildChatUI($('#chatMobile'));
  connectWS();
  buildSportNav();          // 종목 메뉴 즉시 표시(네트워크 불필요)
  loadEvents();             // 경기 즉시 로드(자체 자동 재시도 내장)
  // 관심 리그는 백그라운드로, 서버 깰 때까지 재시도
  fetchJSON('/api/leagues', { tries: 15, delay: 4000 })
    .then(d => { state.leagues = d.leagues || []; buildLeagueNav(); })
    .catch(() => {});
  // 라이브 자동 갱신 (30초)
  setInterval(() => { if (!$('#view-live').classList.contains('hidden')) loadEvents(); }, 30000);
}
init();
