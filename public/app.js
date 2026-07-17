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
const views = { live: 'view-live', table: 'view-table', odds: 'view-odds', info: 'view-info', comm: 'view-comm', board: 'view-board' };
function setTab(t) {
  Object.values(views).forEach(id => $('#' + id)?.classList.add('hidden'));
  $('#' + views[t])?.classList.remove('hidden');
  $$('.topbar .tt[data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  $$('.topnav a[data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  $$('.dmenu a[data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  if (t === 'table' && !$('#tblLeague').options.length) buildTableControls();
  if (t === 'board') loadPosts();
  if (t === 'odds') initOdds();
  if (t === 'info') initInfo();
  $('.center')?.classList.toggle('notlive', t !== 'live');
  window.scrollTo({ top: 0 });
}
$$('.topbar .tt[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$$('.topnav a[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$$('.dmenu a[data-tab]').forEach(b => b.addEventListener('click', () => { setTab(b.dataset.tab); closeDrawer(); }));
$('#drawerLogin')?.addEventListener('click', () => { closeDrawer(); openLogin(); });

// ============================================================
//  앱 다운로드 / 설치 (PWA) + 고급 로딩 화면
// ============================================================
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function runProgress(done) {
  const fill = $('#dlFill'), pct = $('#dlPct'), msg = $('#dlMsg'), guide = $('#dlGuide'), close = $('#dlClose');
  guide.style.display = 'none'; close.style.display = 'none';
  $('#dlTitle').textContent = 'LIVE UP 설치 중…';
  const labels = [[0, '서버 연결 중…'], [25, '앱 리소스 받는 중…'], [55, '실시간 데이터 동기화…'], [80, '설치 구성 중…'], [97, '거의 다 됐어요!']];
  let p = 0; fill.style.width = '0%'; pct.textContent = '0%';
  const t = setInterval(() => {
    p += Math.random() * 7 + 3; if (p >= 100) p = 100;
    fill.style.width = p + '%'; pct.textContent = Math.round(p) + '%';
    const lb = labels.filter(l => p >= l[0]).pop(); if (lb) msg.textContent = lb[1];
    if (p >= 100) { clearInterval(t); setTimeout(done, 450); }
  }, 140);
}
async function isAppInstalled() {
  if (isStandalone) return true;
  if (navigator.getInstalledRelatedApps) {
    try { const apps = await navigator.getInstalledRelatedApps(); if (apps && apps.length) return true; } catch { }
  }
  try { if (localStorage.getItem('liveup_installed') === '1' && !deferredPrompt) return true; } catch { }
  return false;
}
function showAlreadyInstalled() {
  $('#dlTitle').innerHTML = '이미 설치되어 있어요 ✓';
  $('#dlFill').style.width = '100%'; $('#dlPct').textContent = '100%'; $('#dlMsg').textContent = '';
  const guide = $('#dlGuide');
  guide.innerHTML = '<b>LIVE UP</b> 앱이 이 기기에 이미 설치돼 있어요.<br>홈 화면의 <b>LIVE UP</b> 아이콘으로 실행하면 앱처럼 쓸 수 있어요. 🎉';
  guide.style.display = 'block'; $('#dlClose').style.display = 'inline-block';
}
async function openDownload() {
  const ov = $('#dlOverlay'); if (!ov) return;
  ov.classList.add('on');
  $('#dlGuide').style.display = 'none'; $('#dlClose').style.display = 'none';
  if (await isAppInstalled()) {
    $('#dlTitle').textContent = '확인 중…'; $('#dlMsg').textContent = '';
    let p = 0; $('#dlFill').style.width = '0%';
    const t = setInterval(() => { p += 14; const v = Math.min(p, 100); $('#dlFill').style.width = v + '%'; $('#dlPct').textContent = v + '%'; if (p >= 100) { clearInterval(t); setTimeout(showAlreadyInstalled, 280); } }, 60);
    return;
  }
  runProgress(finishDownload);
}
function finishDownload() {
  const guide = $('#dlGuide'), close = $('#dlClose');
  $('#dlMsg').textContent = '';
  if (deferredPrompt) {
    $('#dlTitle').textContent = '설치하기';
    guide.innerHTML = '화면에 뜨는 <b>"설치"</b> 버튼을 누르면 홈 화면에 <b>LIVE UP</b> 앱이 추가돼요.';
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(() => { deferredPrompt = null; });
  } else if (isIOS) {
    $('#dlTitle').textContent = '홈 화면에 추가';
    guide.innerHTML = 'Safari 하단 <b>공유 ⬆️</b> → <b>"홈 화면에 추가"</b> 를 누르면 앱처럼 설치돼요.';
  } else {
    $('#dlTitle').textContent = '홈 화면에 추가';
    guide.innerHTML = '주소창 오른쪽 <b>설치 ⊕</b> 아이콘, 또는 브라우저 메뉴 <b>⋮ → 앱 설치</b> 를 누르면 돼요.';
  }
  guide.style.display = 'block';
  close.style.display = 'inline-block';
}
$('#btnDownload')?.addEventListener('click', openDownload);
$('#btnDownloadM')?.addEventListener('click', openDownload);
$('#dlClose')?.addEventListener('click', () => $('#dlOverlay').classList.remove('on'));

// 설치된 앱(홈 화면)으로 실행 중이면 다운로드 버튼 숨김
function hideDownloadUI() { ['#btnDownload', '#btnDownloadM'].forEach(s => { const el = $(s); if (el) el.style.display = 'none'; }); }
if (isStandalone) hideDownloadUI();
window.addEventListener('appinstalled', () => { try { localStorage.setItem('liveup_installed', '1'); } catch { } hideDownloadUI(); $('#dlOverlay')?.classList.remove('on'); deferredPrompt = null; });
// 전경기 대화방 배너 탭 → 모바일에서 채팅방 열기 (PC는 우측에 항상 표시)
$('#chatbanBtn')?.addEventListener('click', () => { if (window.innerWidth < 960) setTab('comm'); });

// ============================================================
//  로그인 (구글 / 네이버 / 카카오) — 테스트 단계: 대화명 설정
// ============================================================
let loggedIn = false;
function openLogin() { $('#scrimL').classList.add('on'); $('#loginModal').classList.add('on'); }
function closeLogin() { $('#scrimL').classList.remove('on'); $('#loginModal').classList.remove('on'); }
$('#btnLogin')?.addEventListener('click', openLogin);
$('#lmClose')?.addEventListener('click', closeLogin);
$('#scrimL')?.addEventListener('click', closeLogin);
$$('.lgn').forEach(b => b.addEventListener('click', () => {
  const p = b.dataset.p;
  const label = { google: '구글', naver: '네이버', kakao: '카카오' }[p];
  const nick = (prompt(`${label} 로그인 · 사용할 대화명을 입력하세요`, '') || '').trim();
  const name = nick ? nick.slice(0, 20) : `${label}사용자${Math.floor(Math.random() * 900 + 100)}`;
  myName = name; loggedIn = true;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'name', name }));
  const btn = $('#btnLogin'); if (btn) btn.innerHTML = `👤 ${esc(name)}`;
  const dn = $('#drawerName'); if (dn) dn.textContent = name;
  closeLogin();
}));

// ============================================================
//  커뮤니티 게시판
// ============================================================
const BOARD_DESC = { free: '자유롭게 이야기를 나눠보세요', profit: '수익 인증글을 공유해요 💰', loss: '손실 경험을 나누고 복기해요 📉' };
let curBoard = 'free';
function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return '방금'; if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전'; return Math.floor(s / 86400) + '일 전';
}
async function loadPosts() {
  const list = $('#postList'); if (!list) return;
  list.innerHTML = `<div class="loading">불러오는 중…</div>`;
  $('#boardDesc') && ($('#boardDesc').textContent = BOARD_DESC[curBoard]);
  try {
    const d = await fetchJSON(`/api/posts?board=${curBoard}`, { tries: 12, delay: 3500, onWait: n => { list.innerHTML = `<div class="loading">⏳ 서버 깨우는 중… (${n})</div>`; } });
    const ps = d.posts || [];
    if (!ps.length) { list.innerHTML = `<div class="loading">아직 글이 없어요. 첫 글을 남겨보세요!</div>`; return; }
    list.innerHTML = ps.map(p => `<div class="post">
      <div class="post-hd"><span class="pu">${esc(p.name)}</span><span class="pt">${timeAgo(p.ts)}</span></div>
      <div class="post-title">${esc(p.title)}</div>
      ${p.text ? `<div class="post-text">${esc(p.text)}</div>` : ''}
      <div class="post-ft"><span class="like" data-id="${p.id}">👍 <b>${p.up}</b></span></div>
    </div>`).join('');
    $$('#postList .like').forEach(el => el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const r = await fetch('/api/posts/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: curBoard, id: Number(id) }) }).then(r => r.json()).catch(() => null);
      if (r && r.ok) el.querySelector('b').textContent = r.up;
    }));
  } catch (e) {
    list.innerHTML = `<div class="loading">불러오지 못했습니다.<br><button onclick="loadPosts()" style="margin-top:10px;padding:9px 18px;border:none;border-radius:8px;background:#2f6fed;color:#fff;font-weight:800">다시 시도</button></div>`;
  }
}
$$('.boardtabs .bt').forEach(b => b.addEventListener('click', () => {
  $$('.boardtabs .bt').forEach(x => x.classList.remove('on')); b.classList.add('on');
  curBoard = b.dataset.board; loadPosts();
}));
// 글쓰기
function openWrite() {
  $('#wmTitle').textContent = { free: '자유게시판', profit: '수익인증', loss: '손실인증' }[curBoard] + ' 글쓰기';
  $('#wPostTitle').value = ''; $('#wPostText').value = '';
  $('#scrimW').classList.add('on'); $('#writeModal').classList.add('on');
}
function closeWrite() { $('#scrimW').classList.remove('on'); $('#writeModal').classList.remove('on'); }
$('#btnWrite')?.addEventListener('click', openWrite);
$('#wmClose')?.addEventListener('click', closeWrite);
$('#scrimW')?.addEventListener('click', closeWrite);
$('#wSubmit')?.addEventListener('click', async () => {
  const title = $('#wPostTitle').value.trim(), text = $('#wPostText').value.trim();
  if (!title && !text) { alert('제목이나 내용을 입력하세요'); return; }
  try {
    await fetch('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: curBoard, name: myName, title, text }) });
    closeWrite(); loadPosts();
  } catch { alert('등록에 실패했어요. 잠시 후 다시 시도해주세요.'); }
});

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
//  배당 (The Odds API)
// ============================================================
let oddsSport = 'soccer_epl', oddsChipsBuilt = false, oddsHasKey = null;
async function initOdds() {
  if (!oddsChipsBuilt) {
    try {
      const d = await fetchJSON('/api/odds/sports', { tries: 12, delay: 3500 });
      oddsHasKey = d.hasKey;
      $('#oddsChips').innerHTML = (d.sports || []).map((s, i) =>
        `<div class="ochip ${i === 0 ? 'on' : ''}" data-sport="${s.key}">${s.em} ${s.ko}</div>`).join('');
      $$('#oddsChips .ochip').forEach(c => c.addEventListener('click', () => {
        $$('#oddsChips .ochip').forEach(x => x.classList.remove('on')); c.classList.add('on');
        oddsSport = c.dataset.sport; loadOdds();
      }));
      oddsChipsBuilt = true;
    } catch { }
  }
  loadOdds();
}
function oddsCell(v, hot) {
  if (v == null) return `<div class="ov dash">-</div>`;
  return `<div class="ov${hot ? ' hot' : ''}">${Number(v).toFixed(2)}</div>`;
}
async function loadOdds() {
  const board = $('#oddsBoard'); if (!board) return;
  board.innerHTML = `<div class="loading">배당 불러오는 중…</div>`;
  try {
    const d = await fetchJSON(`/api/odds?sport=${encodeURIComponent(oddsSport)}`, { tries: 12, delay: 3500, onWait: n => { board.innerHTML = `<div class="loading">⏳ 서버 깨우는 중… (${n})</div>`; } });
    if (d.needKey) {
      board.innerHTML = `<div class="oddskey">
        <div class="ok-ic">🔑</div>
        <div class="ok-t">배당 API 키가 아직 없어요</div>
        <div class="ok-s">무료로 키를 발급받아 Render 환경변수 <b>ODDS_API_KEY</b> 에 넣으면<br>여기에 <b>실제 해외 배당(bet365·Pinnacle 등)</b>이 표시됩니다.</div>
        <a class="ok-b" href="https://the-odds-api.com/" target="_blank" rel="noopener">무료 키 발급받기 (the-odds-api.com) ↗</a>
        <div class="ok-n">월 500회 무료 · 국내(Betman) 배당은 공개 API가 없어 미지원</div>
      </div>`;
      return;
    }
    const gs = d.games || [];
    if (!gs.length) { board.innerHTML = `<div class="loading">예정 경기가 없어요. 다른 리그를 선택해보세요.</div>`; return; }
    const isSoccer = oddsSport.startsWith('soccer');
    board.innerHTML = `<div class="ocols"><span>경기</span><span>승${isSoccer ? '' : '(홈)'}</span>${isSoccer ? '<span>무</span>' : ''}<span>패${isSoccer ? '' : '(원정)'}</span></div>` +
      gs.map((g, i) => {
        const lo = Math.min(...[g.homeOdds, g.awayOdds, g.drawOdds].filter(x => x));
        const d2 = new Date(g.time);
        const dt = `${d2.getMonth() + 1}/${d2.getDate()} ${String(d2.getHours()).padStart(2, '0')}:${String(d2.getMinutes()).padStart(2, '0')}`;
        return `<div class="orow2 clk" data-oid="${esc(g.id)}" data-home="${esc(g.home)}" data-away="${esc(g.away)}">
          <div class="onum">${1001 + i}</div>
          <div class="og">
            <div class="ogl">${esc(g.league)} · ${dt} · <span class="obks">${g.books}개사</span></div>
            <div class="ogt"><b>${esc(g.home)}</b> <span class="ovs">vs</span> ${esc(g.away)} <span class="odet">상세 ›</span></div>
          </div>
          <div class="oodds ${isSoccer ? 's' : 'b'}">
            ${oddsCell(g.homeOdds, g.homeOdds === lo)}
            ${isSoccer ? oddsCell(g.drawOdds, g.drawOdds === lo) : ''}
            ${oddsCell(g.awayOdds, g.awayOdds === lo)}
          </div>
        </div>`;
      }).join('') +
      `<div class="foot">배당은 The Odds API 실시간 종합값(최고 배당 기준)입니다. 참고용이며 베팅 판단의 책임은 본인에게 있습니다.</div>`;
    $$('#oddsBoard .orow2.clk').forEach(el => el.addEventListener('click', () => openOddsDetail(el.dataset.oid, el.dataset.home, el.dataset.away)));
  } catch (e) {
    board.innerHTML = `<div class="loading">배당을 불러오지 못했습니다.<br><button onclick="loadOdds()" style="margin-top:10px;padding:9px 18px;border:none;border-radius:8px;background:#24568f;color:#fff;font-weight:800">다시 시도</button></div>`;
  }
}

// ---------- 배당 경기 상세 (계산기 + 업체비교 + 최근경기) ----------
function won(n) { return Math.round(n).toLocaleString('ko-KR'); }
async function openOddsDetail(id, home, away) {
  $('#scrim').classList.add('on'); $('#modal').classList.add('on');
  $('#mTitle').textContent = '배당 상세';
  $('#mBody').innerHTML = `<div class="loading">배당 불러오는 중…</div>`;
  try {
    const d = await fetchJSON(`/api/odds/event?id=${encodeURIComponent(id)}&sport=${encodeURIComponent(oddsSport)}`, { tries: 10, delay: 3500 });
    if (d.needKey) { $('#mBody').innerHTML = `<div class="loading">배당 API 키가 필요합니다.</div>`; return; }
    const ev = d.event; if (!ev) { $('#mBody').innerHTML = `<div class="loading">상세 배당이 없어요.</div>`; return; }
    const best = d.best || {}, books = d.books || [];
    const isSoccer = oddsSport.startsWith('soccer');
    const oh = best.home || 0, od = best.draw || 0, oa = best.away || 0;
    // 핸디/오버언더 대표값
    const sp = d.sampleSpread || [], to = d.sampleTotal || [];
    const spTxt = sp.length ? sp.map(s => `${esc(s.name)} ${s.point > 0 ? '+' : ''}${s.point} <b>${s.price}</b>`).join(' / ') : '-';
    const toTxt = to.length ? to.map(t => `${t.name === 'Over' ? '오버' : '언더'} ${t.point} <b>${t.price}</b>`).join(' / ') : '-';

    $('#mBody').innerHTML = `
      <div class="odh"><b>${esc(ev.home)}</b> <span>vs</span> <b>${esc(ev.away)}</b></div>
      <div class="odsub">${esc(ev.league)} · ${new Date(ev.time).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${books.length}개 업체</div>

      <div class="calc">
        <div class="calc-hd">💰 배팅 계산기</div>
        <div class="calc-in"><input id="stake" type="number" inputmode="numeric" value="10000"> <span>원 배팅 시 예상 수령액</span></div>
        <div class="calc-row"><span class="ck">${esc(ev.home)} 승</span><span class="cod">@${oh || '-'}</span><b class="cpay" data-odd="${oh}">-</b></div>
        ${isSoccer ? `<div class="calc-row"><span class="ck">무승부</span><span class="cod">@${od || '-'}</span><b class="cpay" data-odd="${od}">-</b></div>` : ''}
        <div class="calc-row"><span class="ck">${esc(ev.away)} 승</span><span class="cod">@${oa || '-'}</span><b class="cpay" data-odd="${oa}">-</b></div>
        <div class="calc-note">수령액 = 배팅금액 × 배당 (적중 시). 순수익은 수령액−배팅금액.</div>
      </div>

      <div class="odsec">📊 핸디캡 / 오버언더</div>
      <div class="odline"><span>핸디캡</span> ${spTxt}</div>
      <div class="odline"><span>오버언더</span> ${toTxt}</div>

      <div class="odsec">🏦 업체별 배당 비교 (승${isSoccer ? '·무' : ''}·패)</div>
      <div class="bookcmp">
        <div class="bc-hd"><span>업체</span><span>${isSoccer ? '홈' : '홈'}</span>${isSoccer ? '<span>무</span>' : ''}<span>원정</span></div>
        ${books.slice(0, 12).map(b => `<div class="bc-row"><span class="bkn">${esc(b.title)}</span><span>${b.home ? b.home.toFixed(2) : '-'}</span>${isSoccer ? `<span>${b.draw ? b.draw.toFixed(2) : '-'}</span>` : ''}<span>${b.away ? b.away.toFixed(2) : '-'}</span></div>`).join('')}
      </div>

      <div class="odsec">📅 최근 경기</div>
      <div class="recent2"><div id="recH" class="recol"><div class="loading" style="padding:14px">불러오는 중…</div></div><div id="recA" class="recol"><div class="loading" style="padding:14px">불러오는 중…</div></div></div>
      <div class="foot" style="padding:12px 0 0">배당·수익은 참고용입니다. 무리한 베팅은 삼가세요.</div>
    `;
    // 계산기 작동
    const calc = () => {
      const s = Number($('#stake').value) || 0;
      $$('#mBody .cpay').forEach(el => {
        const odd = Number(el.dataset.odd) || 0;
        el.textContent = odd ? won(s * odd) + '원' : '-';
      });
    };
    $('#stake').addEventListener('input', calc); calc();
    // 최근 경기 로드
    loadRecent('#recH', ev.home); loadRecent('#recA', ev.away);
  } catch (e) {
    $('#mBody').innerHTML = `<div class="loading">상세를 불러오지 못했습니다.</div>`;
  }
}
async function loadRecent(sel, teamName) {
  const box = $(sel); if (!box) return;
  try {
    const d = await fetchJSON(`/api/team/recent?name=${encodeURIComponent(teamName)}`, { tries: 6, delay: 3000 });
    if (!d.team || !d.events.length) { box.innerHTML = `<div class="rec-hd">${esc(teamName)}</div><div class="rec-empty">최근 경기 정보 없음</div>`; return; }
    box.innerHTML = `<div class="rec-hd">${esc(d.team.name)}</div>` + d.events.map(e => {
      const isHome = e.home === d.team.name || (d.team.name && e.home.includes(d.team.name.split(' ')[0]));
      const my = isHome ? e.hs : e.as, op = isHome ? e.as : e.hs;
      let r = 'D', rk = '무'; if (my != null && op != null) { if (+my > +op) { r = 'W'; rk = '승'; } else if (+my < +op) { r = 'L'; rk = '패'; } }
      const opp = isHome ? e.away : e.home;
      return `<div class="rec-row"><span class="rb ${r}">${rk}</span><span class="ro">${esc(opp)}</span><span class="rs">${esc(e.hs ?? '-')}:${esc(e.as ?? '-')}</span></div>`;
    }).join('');
  } catch { box.innerHTML = `<div class="rec-hd">${esc(teamName)}</div><div class="rec-empty">불러오기 실패</div>`; }
}

// ============================================================
//  경기 정보방 (샘플 데이터 · 폼 미리보기)
//  ※ 라인업/선수기록/국내배당은 예시값입니다.
// ============================================================
const P = (nm, h, era, g, w, l, sv, ip) => ({ nm, h, era, g, w, l, sv, ip });   // 투수
const B = (nm, h, avg, g, ab, hit, hr) => ({ nm, h, avg, g, ab, hit, hr });      // 타자
const INFO = [
  {
    no: 7021, league: 'KBO', date: '오늘 18:30', venue: '서울잠실야구장',
    home: {
      name: 'LG 트윈스', logo: 'LG', color: '#c30452',
      lineup: ['(중)홍창기', '(우)박해민', '(지)오스틴', '(1)오지환', '(포)박동원', '(3)문보경', '(좌)문성주', '(2)신민재', '(유)구본혁'],
      pit: [P('임찬규', 'R', 3.79, 18, 8, 2, 0, 99.0), P('손주영', 'L', 2.98, 17, 7, 5, 0, 96.2), P('디트리히', 'R', 3.44, 14, 5, 4, 0, 88.0), P('조원태', 'L', 9.00, 8, 1, 0, 0, 12.0), P('김대현', 'R', 5.11, 22, 2, 1, 3, 24.1), P('정우영', 'R', 3.20, 40, 3, 2, 5, 45.0)],
      bat: [B('오스틴', 'R', .339, 85, 327, 111, 21), B('박해민', 'L', .291, 85, 282, 82, 3), B('홍창기', 'L', .259, 78, 263, 68, 2), B('오지환', 'L', .252, 78, 234, 59, 6), B('박동원', 'R', .240, 76, 217, 52, 9), B('문보경', 'L', .254, 59, 201, 51, 7), B('천성호', 'L', .281, 74, 199, 56, 1), B('구본혁', 'R', .271, 83, 188, 51, 0), B('문성주', 'L', .296, 54, 169, 50, 1)]
    },
    away: {
      name: 'KT 위즈', logo: 'KT', color: '#000',
      lineup: ['(지)최원준', '(좌)김민혁', '(우)안현민', '(1)김현수', '(3)허경민', '(2)김상수', '(중)배정대', '(포)조대현', '(유)권동진'],
      pit: [P('소형준', 'R', 2.71, 16, 9, 3, 0, 98.1), P('고영표', 'R', 3.05, 15, 7, 5, 0, 92.0), P('벤자민', 'L', 3.33, 15, 8, 4, 0, 94.2), P('전용주', 'L', 4.20, 20, 2, 1, 0, 30.0), P('박영현', 'R', 2.10, 42, 3, 2, 22, 47.0), P('스기모토', 'R', 3.90, 18, 1, 1, 1, 20.0)],
      bat: [B('최원준', 'R', .310, 80, 300, 93, 8), B('김상수', 'R', .285, 78, 270, 77, 5), B('배정대', 'R', .276, 75, 255, 70, 9), B('안현민', 'R', .299, 60, 210, 63, 6), B('김현수', 'L', .263, 82, 240, 63, 4), B('허경민', 'R', .271, 70, 220, 60, 2), B('장성우', 'R', .258, 66, 200, 52, 8), B('권동진', 'R', .240, 55, 150, 36, 1), B('조대현', 'R', .233, 40, 90, 21, 2)]
    },
    box: { home: [0, 1, 0, 2, 0, 0, 1, 0, 0], away: [0, 0, 3, 0, 0, 0, 0, 0, 0] },
    odds: { dom: { win: 1.71, lose: 1.81, handi: 'H -1.5  2.35 / 1.55', ou: 'U/O 8.5  1.90 / 1.85' }, intl: { win: 1.80, lose: 1.86, handi: 'H -1.5  2.40 / 1.58', ou: 'U/O 8.5  1.93 / 1.89' } },
    recent: { home: [['승', 'KT', '3:0'], ['승', '롯데', '4:2'], ['패', '롯데', '1:4'], ['패', '삼성', '2:5'], ['승', '한화', '7:4']], away: [['패', 'LG', '0:3'], ['승', '두산', '5:3'], ['승', 'NC', '6:2'], ['패', 'SSG', '3:4'], ['승', '키움', '8:1']] }
  },
  {
    no: 7022, league: 'KBO', date: '오늘 18:30', venue: '고척스카이돔',
    home: { name: '키움 히어로즈', logo: '키움', color: '#570514', lineup: ['(중)이주형', '(2)김혜성', '(지)최주환', '(우)이형종', '(1)최주환', '(3)송성문', '(좌)임지열', '(포)김재현', '(유)김휘집'], pit: [P('안우진', 'R', 2.31, 16, 7, 4, 0, 95.0), P('하영민', 'R', 3.55, 15, 6, 5, 0, 89.0), P('헤이수스', 'R', 3.10, 14, 7, 3, 0, 88.2), P('조영건', 'R', 4.00, 25, 2, 2, 1, 33.0)], bat: [B('김혜성', 'R', .326, 82, 310, 101, 7), B('이주형', 'L', .289, 70, 260, 75, 5), B('송성문', 'L', .340, 80, 300, 102, 12), B('최주환', 'R', .265, 78, 250, 66, 8)] },
    away: { name: '삼성 라이온즈', logo: '삼성', color: '#074ca1', lineup: ['(중)김지찬', '(2)김성윤', '(지)구자욱', '(1)맥키넌', '(우)디아즈', '(3)김영웅', '(포)강민호', '(좌)이성규', '(유)이재현'], pit: [P('원태인', 'R', 3.20, 16, 10, 4, 0, 100.0), P('레예스', 'R', 3.45, 15, 8, 5, 0, 93.0), P('후라도', 'R', 2.90, 15, 9, 3, 0, 96.0), P('김재윤', 'R', 3.10, 40, 2, 3, 20, 44.0)], bat: [B('구자욱', 'L', .341, 84, 330, 113, 18), B('디아즈', 'R', .307, 85, 320, 98, 25), B('김영웅', 'L', .258, 80, 290, 75, 20), B('강민호', 'R', .296, 75, 260, 77, 15)] },
    box: { home: [1, 0, 0, 0, 2, 0, 0, 1, 0], away: [0, 2, 0, 1, 0, 0, 0, 0, 0] },
    odds: { dom: { win: 2.05, lose: 1.72, handi: 'H +1.5  1.55 / 2.35', ou: 'U/O 9.5  1.88 / 1.90' }, intl: { win: 2.10, lose: 1.75, handi: 'H +1.5  1.58 / 2.40', ou: 'U/O 9.5  1.90 / 1.92' } },
    recent: { home: [['승', 'SSG', '5:2'], ['패', '두산', '2:6'], ['승', 'KIA', '4:1'], ['무', 'NC', '3:3'], ['패', '롯데', '1:5']], away: [['승', 'LG', '6:3'], ['승', '한화', '8:4'], ['패', 'KT', '2:5'], ['승', 'NC', '5:1'], ['승', '롯데', '7:2']] }
  }
];

let infoBuilt = false;
function initInfo() {
  const list = $('#infoList'); if (!list) return;
  list.innerHTML = INFO.map((m, i) => `<div class="infocard" data-i="${i}">
    <div class="ic-no">${m.no}</div>
    <div class="ic-mid">
      <div class="ic-lg">⚾ ${m.league} · ${m.date} · ${m.venue}</div>
      <div class="ic-tm"><span class="ic-b" style="background:${m.home.color}">${m.home.logo}</span> ${esc(m.home.name)} <span class="ic-vs">vs</span> ${esc(m.away.name)} <span class="ic-b" style="background:${m.away.color}">${m.away.logo}</span></div>
    </div>
    <div class="ic-go">상세 ›</div>
  </div>`).join('');
  $$('#infoList .infocard').forEach(c => c.addEventListener('click', () => openInfoDetail(+c.dataset.i)));
}
function pitTable(team) {
  return `<table class="stt"><thead><tr><th>투수</th><th></th><th>방어율</th><th>경기</th><th>승</th><th>패</th><th>세</th><th>이닝</th></tr></thead><tbody>${
    team.pit.map(p => `<tr><td class="nm">${esc(p.nm)}</td><td class="lr ${p.h === 'L' ? 'l' : 'r'}">${p.h}</td><td>${p.era.toFixed(2)}</td><td>${p.g}</td><td>${p.w}</td><td>${p.l}</td><td>${p.sv}</td><td>${p.ip.toFixed(1)}</td></tr>`).join('')
    }</tbody></table>`;
}
function batTable(team) {
  return `<table class="stt"><thead><tr><th>타자</th><th></th><th>타율</th><th>경기</th><th>타수</th><th>안타</th><th>홈런</th></tr></thead><tbody>${
    team.bat.map(b => `<tr><td class="nm">${esc(b.nm)}</td><td class="lr ${b.h === 'L' ? 'l' : 'r'}">${b.h}</td><td>${b.avg.toFixed(3).replace(/^0/, '')}</td><td>${b.g}</td><td>${b.ab}</td><td>${b.hit}</td><td>${b.hr}</td></tr>`).join('')
    }</tbody></table>`;
}
function recentRows(arr) {
  return arr.map(r => `<div class="rec-row"><span class="rb ${r[0] === '승' ? 'W' : r[0] === '패' ? 'L' : 'D'}">${r[0]}</span><span class="ro">${esc(r[1])}</span><span class="rs">${esc(r[2])}</span></div>`).join('');
}
function openInfoDetail(i) {
  const m = INFO[i];
  $('#scrim').classList.add('on'); $('#modal').classList.add('on');
  $('#mTitle').textContent = `경기 정보 · ${m.league}`;
  const innings = n => Array.from({ length: 9 }, (_, k) => `<td>${m.box[n][k] ?? ''}</td>`).join('');
  const sum = n => m.box[n].reduce((a, b) => a + b, 0);
  $('#mBody').innerHTML = `
    <div class="ii-hd"><span class="ii-no">${m.no}</span> <b>${esc(m.home.name)}</b> <span class="ii-vs">vs</span> <b>${esc(m.away.name)}</b></div>
    <div class="ii-sub">${m.date} · ${m.venue} · ${m.league} <span class="sample-badge">샘플</span></div>

    <div class="ii-odds">
      <div class="ii-otab"><div class="oth on" data-o="dom">🇰🇷 국내배당</div><div class="oth" data-o="intl">🌍 해외배당</div></div>
      <div class="ii-obody" id="iiOdds"></div>
    </div>

    <div class="odsec">📋 선발 라인업</div>
    <div class="lineup2">
      <div class="lu"><div class="lu-hd" style="border-color:${m.home.color}">${esc(m.home.name)}</div>${m.home.lineup.map((p, n) => `<div class="lu-row"><span class="lu-n">${n + 1}</span>${esc(p)}</div>`).join('')}</div>
      <div class="lu"><div class="lu-hd" style="border-color:${m.away.color}">${esc(m.away.name)}</div>${m.away.lineup.map((p, n) => `<div class="lu-row"><span class="lu-n">${n + 1}</span>${esc(p)}</div>`).join('')}</div>
    </div>

    <div class="odsec">🧢 선수 정보 <span class="teamtog"><span class="tg on" data-t="home">${esc(m.home.name)}</span><span class="tg" data-t="away">${esc(m.away.name)}</span></span></div>
    <div id="iiPit">${pitTable(m.home)}</div>
    <div id="iiBat" style="margin-top:8px">${batTable(m.home)}</div>

    <div class="odsec">📊 이닝별 스코어</div>
    <table class="boxsc"><thead><tr><th></th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>9</th><th class="r">R</th></tr></thead>
      <tbody><tr><td class="tn">${esc(m.home.name)}</td>${innings('home')}<td class="r">${sum('home')}</td></tr>
      <tr><td class="tn">${esc(m.away.name)}</td>${innings('away')}<td class="r">${sum('away')}</td></tr></tbody></table>

    <div class="odsec">📅 최근 경기</div>
    <div class="recent2"><div class="recol"><div class="rec-hd">${esc(m.home.name)}</div>${recentRows(m.recent.home)}</div><div class="recol"><div class="rec-hd">${esc(m.away.name)}</div>${recentRows(m.recent.away)}</div></div>
    <div class="foot" style="padding:12px 0 0">라인업·선수기록·국내배당은 <b>샘플 데이터</b>입니다. 실제 연동은 유료 스포츠데이터가 필요합니다.</div>
  `;
  // 배당 탭
  const renderOdds = (o) => {
    const d = m.odds[o];
    $('#iiOdds').innerHTML = `<div class="ii-orow"><span>승</span><b>${d.win}</b></div><div class="ii-orow"><span>패</span><b>${d.lose}</b></div><div class="ii-orow"><span>핸디캡</span><b>${esc(d.handi)}</b></div><div class="ii-orow"><span>오버언더</span><b>${esc(d.ou)}</b></div>`;
  };
  renderOdds('dom');
  $$('#mBody .ii-otab .oth').forEach(t => t.addEventListener('click', () => { $$('#mBody .ii-otab .oth').forEach(x => x.classList.remove('on')); t.classList.add('on'); renderOdds(t.dataset.o); }));
  // 팀 토글
  $$('#mBody .teamtog .tg').forEach(t => t.addEventListener('click', () => {
    $$('#mBody .teamtog .tg').forEach(x => x.classList.remove('on')); t.classList.add('on');
    const team = t.dataset.t === 'home' ? m.home : m.away;
    $('#iiPit').innerHTML = pitTable(team); $('#iiBat').innerHTML = batTable(team);
  }));
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
$('#btnUser')?.addEventListener('click', openLogin);
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
