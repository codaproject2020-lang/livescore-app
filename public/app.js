// ============================================================
//  LIVE UP · Frontend  ·  BUILD: apisports-v2 (2026-07)
//  ※ LIVE 피드 = API-Sports (/api/asports/games)
// ============================================================
console.log('LIVE UP build: apisports-v2');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ============================================================
//  다국어(i18n) · 12개 언어 (기본 영어)
// ============================================================
const LANGS = ['en', 'ko', 'ja', 'zh', 'es', 'hi', 'vi', 'th', 'ru', 'de', 'fr', 'it'];
const LANG_NAMES = { en: 'English', ko: '한국어', ja: '日本語', zh: '中文', es: 'Español', hi: 'हिन्दी', vi: 'Tiếng Việt', th: 'ไทย', ru: 'Русский', de: 'Deutsch', fr: 'Français', it: 'Italiano' };
const LANG_FLAGS = { en: '🇺🇸', ko: '🇰🇷', ja: '🇯🇵', zh: '🇨🇳', es: '🇪🇸', hi: '🇮🇳', vi: '🇻🇳', th: '🇹🇭', ru: '🇷🇺', de: '🇩🇪', fr: '🇫🇷', it: '🇮🇹' };
// 값 순서: en, ko, ja, zh, es, hi, vi, th, ru, de, fr, it
const STR = {
  live: ['Live', '라이브', 'ライブ', '直播', 'En vivo', 'लाइव', 'Trực tiếp', 'สด', 'Лайв', 'Live', 'Direct', 'Live'],
  info: ['Match Info', '경기 정보방', '試合情報', '比赛信息', 'Partidos', 'मैच जानकारी', 'Thông tin', 'ข้อมูลแมตช์', 'Матчи', 'Spielinfo', 'Infos match', 'Info partite'],
  rank: ['Standings', '순위', '順位', '排名', 'Clasificación', 'रैंकिंग', 'BXH', 'อันดับ', 'Таблица', 'Tabelle', 'Classement', 'Classifica'],
  odds: ['Odds', '배당', 'オッズ', '赔率', 'Cuotas', 'ऑड्स', 'Tỷ lệ', 'อัตราต่อรอง', 'Ставки', 'Quoten', 'Cotes', 'Quote'],
  community: ['Community', '커뮤니티', 'コミュニティ', '社区', 'Comunidad', 'समुदाय', 'Cộng đồng', 'ชุมชน', 'Сообщество', 'Community', 'Communauté', 'Community'],
  chat: ['Chat', '채팅', 'チャット', '聊天', 'Chat', 'चैट', 'Trò chuyện', 'แชท', 'Чат', 'Chat', 'Chat', 'Chat'],
  login: ['Login', '로그인', 'ログイン', '登录', 'Entrar', 'लॉगिन', 'Đăng nhập', 'เข้าสู่ระบบ', 'Вход', 'Anmelden', 'Connexion', 'Accedi'],
  logout: ['Logout', '로그아웃', 'ログアウト', '登出', 'Salir', 'लॉगआउट', 'Đăng xuất', 'ออกจากระบบ', 'Выход', 'Abmelden', 'Déconnexion', 'Esci'],
  download: ['Add to Home', '바탕화면 설치', 'ホームに追加', '添加到主屏', 'Añadir a inicio', 'होम में जोड़ें', 'Thêm vào màn hình', 'เพิ่มลงหน้าจอ', 'На главный экран', 'Zum Startbildschirm', "Ajouter à l'accueil", 'Aggiungi a Home'],
  share: ['Share', '공유', '共有', '分享', 'Compartir', 'शेयर', 'Chia sẻ', 'แชร์', 'Поделиться', 'Teilen', 'Partager', 'Condividi'],
  shareText: ['LIVE UP · Real-time scores', 'LIVE UP · 실시간 스코어', 'LIVE UP · リアルタイムスコア', 'LIVE UP · 实时比分', 'LIVE UP · Marcadores en vivo', 'LIVE UP · लाइव स्कोर', 'LIVE UP · Tỷ số trực tiếp', 'LIVE UP · สกอร์สด', 'LIVE UP · Счёт в реальном времени', 'LIVE UP · Live-Ergebnisse', 'LIVE UP · Scores en direct', 'LIVE UP · Punteggi live'],
  linkCopied: ['Link copied!', '링크 복사됨!', 'リンクをコピー', '已复制链接', '¡Enlace copiado!', 'लिंक कॉपी हुआ!', 'Đã sao chép liên kết!', 'คัดลอกลิงก์แล้ว!', 'Ссылка скопирована!', 'Link kopiert!', 'Lien copié !', 'Link copiato!'],
  installTitle: ['Add to Home Screen', '바탕화면에 설치', 'ホーム画面に追加', '添加到主屏幕', 'Añadir a pantalla de inicio', 'होम स्क्रीन में जोड़ें', 'Thêm vào màn hình chính', 'เพิ่มลงหน้าจอหลัก', 'Добавить на главный экран', 'Zum Startbildschirm', "Ajouter à l'écran d'accueil", 'Aggiungi a Home'],
  installIOS: ['Tap Share ⬆️ in Safari, then "Add to Home Screen".', 'Safari 하단 <b>공유 ⬆️</b> → <b>"홈 화면에 추가"</b> 를 누르면 설치돼요.', 'Safariの<b>共有⬆️</b>→<b>「ホーム画面に追加」</b>をタップ。', '在 Safari 点<b>分享⬆️</b>→<b>"添加到主屏幕"</b>。', 'En Safari, toca Compartir ⬆️ y "Añadir a pantalla de inicio".', 'Safari में शेयर ⬆️ → "होम स्क्रीन में जोड़ें" दबाएँ।', 'Trong Safari, chạm Chia sẻ ⬆️ → "Thêm vào màn hình chính".', 'ใน Safari แตะ แชร์ ⬆️ → "เพิ่มลงหน้าจอหลัก"', 'В Safari нажмите Поделиться ⬆️ → «На экран «Домой».', 'In Safari auf Teilen ⬆️ → „Zum Home-Bildschirm".', "Dans Safari, touchez Partager ⬆️ puis « Sur l'écran d'accueil ».", 'In Safari tocca Condividi ⬆️ → "Aggiungi a Home".'],
  installAndroid: ['Tap ⋮ menu → "Install app" / "Add to Home screen".', '브라우저 메뉴 <b>⋮ → "앱 설치"</b> 또는 <b>"홈 화면에 추가"</b> 를 누르면 돼요.', 'メニュー<b>⋮→「アプリをインストール」</b>をタップ。', '浏览器菜单<b>⋮→"安装应用"</b>。', 'Menú ⋮ → "Instalar app" / "Añadir a inicio".', 'ब्राउज़र मेनू ⋮ → "ऐप इंस्टॉल करें" दबाएँ।', 'Menu ⋮ → "Cài đặt ứng dụng" / "Thêm vào màn hình".', 'เมนู ⋮ → "ติดตั้งแอป" / "เพิ่มลงหน้าจอหลัก"', 'Меню ⋮ → «Установить приложение».', 'Menü ⋮ → „App installieren".', 'Menu ⋮ → « Installer l\'application ».', 'Menu ⋮ → "Installa app".'],
  alreadyInst: ['Already installed ✓ Open LIVE UP from your home screen.', '이미 설치돼 있어요 ✓ 홈 화면의 <b>LIVE UP</b> 아이콘으로 실행하세요.', 'インストール済み ✓ ホームの<b>LIVE UP</b>から起動。', '已安装 ✓ 从主屏幕打开 <b>LIVE UP</b>。', 'Ya instalado ✓ Abre LIVE UP desde tu inicio.', 'पहले से इंस्टॉल ✓ होम स्क्रीन से LIVE UP खोलें।', 'Đã cài ✓ Mở LIVE UP từ màn hình chính.', 'ติดตั้งแล้ว ✓ เปิด LIVE UP จากหน้าจอหลัก', 'Уже установлено ✓ Откройте LIVE UP с главного экрана.', 'Bereits installiert ✓ LIVE UP über den Startbildschirm öffnen.', 'Déjà installé ✓ Ouvrez LIVE UP depuis votre accueil.', 'Già installato ✓ Apri LIVE UP dalla Home.'],
  closeBtn: ['Close', '닫기', '閉じる', '关闭', 'Cerrar', 'बंद करें', 'Đóng', 'ปิด', 'Закрыть', 'Schließen', 'Fermer', 'Chiudi'],
  inAppTitle: ['Open in a browser', '브라우저에서 열어주세요', 'ブラウザで開いてください', '请用浏览器打开', 'Abre en un navegador', 'ब्राउज़र में खोलें', 'Mở bằng trình duyệt', 'เปิดในเบราว์เซอร์', 'Откройте в браузере', 'Im Browser öffnen', 'Ouvrir dans un navigateur', 'Apri nel browser'],
  inAppAndroid: ["In-app browsers (KakaoTalk etc.) can't install apps. Tap below to open in Chrome, then install.", '카카오톡 등 <b>인앱 브라우저</b>에서는 설치가 안 돼요.<br>아래 버튼으로 <b>Chrome에서 열고</b> 다시 <b>바탕화면 설치</b>를 눌러주세요.', 'アプリ内ブラウザでは設置できません。下のボタンでChromeで開いてください。', '应用内浏览器无法安装。请点击下方用 Chrome 打开。', 'Los navegadores in-app no pueden instalar. Abre en Chrome abajo.', 'इन-ऐप ब्राउज़र इंस्टॉल नहीं कर सकते। नीचे Chrome में खोलें।', 'Trình duyệt trong ứng dụng không cài được. Mở bằng Chrome bên dưới.', 'เบราว์เซอร์ในแอปติดตั้งไม่ได้ แตะด้านล่างเพื่อเปิดใน Chrome', 'Встроенные браузеры не устанавливают приложения. Откройте в Chrome ниже.', 'In-App-Browser können nicht installieren. Unten in Chrome öffnen.', "Les navigateurs intégrés ne peuvent pas installer. Ouvrez dans Chrome ci-dessous.", "I browser in-app non installano. Apri in Chrome qui sotto."],
  inAppIOS: ["In-app browsers can't install. Tap the menu (top/bottom) → \"Open in Safari\", then install.", '카카오톡 등 <b>인앱 브라우저</b>에서는 설치가 안 돼요.<br>메뉴(우측 위/아래) → <b>"Safari로 열기"</b> 후 <b>바탕화면 설치</b>를 눌러주세요.', 'アプリ内ブラウザでは設置できません。メニュー→「Safariで開く」後に設置してください。', '应用内浏览器无法安装。菜单→"用 Safari 打开"后再安装。', 'Los navegadores in-app no pueden instalar. Menú → "Abrir en Safari".', 'इन-ऐप ब्राउज़र इंस्टॉल नहीं कर सकते। मेनू → "Safari में खोलें"।', 'Trình duyệt trong ứng dụng không cài được. Menu → "Mở bằng Safari".', 'เบราว์เซอร์ในแอปติดตั้งไม่ได้ เมนู → "เปิดใน Safari"', 'Встроенные браузеры не устанавливают. Меню → «Открыть в Safari».', 'In-App-Browser können nicht installieren. Menü → „In Safari öffnen".', 'Les navigateurs intégrés ne peuvent pas installer. Menu → « Ouvrir dans Safari ».', 'I browser in-app non installano. Menu → "Apri in Safari".'],
  openBrowser: ['Open in Chrome', 'Chrome으로 열기', 'Chromeで開く', '用 Chrome 打开', 'Abrir en Chrome', 'Chrome में खोलें', 'Mở bằng Chrome', 'เปิดใน Chrome', 'Открыть в Chrome', 'In Chrome öffnen', 'Ouvrir dans Chrome', 'Apri in Chrome'],
  copyLinkGuide: ['Or copy the link and paste it in Chrome/Safari.', '또는 링크를 복사해 Chrome·Safari 주소창에 붙여넣으세요.', 'またはリンクをコピーしてブラウザに貼り付け。', '或复制链接粘贴到浏览器。', 'O copia el enlace y pégalo en el navegador.', 'या लिंक कॉपी करके ब्राउज़र में पेस्ट करें।', 'Hoặc sao chép liên kết và dán vào trình duyệt.', 'หรือคัดลอกลิงก์ไปวางในเบราว์เซอร์', 'Или скопируйте ссылку в браузер.', 'Oder Link kopieren und im Browser einfügen.', 'Ou copiez le lien dans le navigateur.', 'Oppure copia il link nel browser.'],
  all: ['All', '전체', '全て', '全部', 'Todos', 'सभी', 'Tất cả', 'ทั้งหมด', 'Все', 'Alle', 'Tout', 'Tutti'],
  today: ['Today', '오늘', '今日', '今天', 'Hoy', 'आज', 'Hôm nay', 'วันนี้', 'Сегодня', 'Heute', "Aujourd'hui", 'Oggi'],
  refresh: ['Refresh', '새로고침', '更新', '刷新', 'Actualizar', 'रिफ्रेश', 'Làm mới', 'รีเฟรช', 'Обновить', 'Aktualisieren', 'Actualiser', 'Aggiorna'],
  allRoom: ['All-Games Chat', '전경기 대화방', '全試合チャット', '全场聊天', 'Chat general', 'सभी मैच चैट', 'Chat tất cả', 'แชทรวม', 'Общий чат', 'Alle-Spiele-Chat', 'Chat général', 'Chat generale'],
  liveChat: ['All-Games Live Chat', '전경기 실시간 채팅', '全試合ライブチャット', '全场实时聊天', 'Chat en vivo', 'लाइव चैट', 'Chat trực tiếp', 'แชทสด', 'Живой чат', 'Live-Chat', 'Chat en direct', 'Chat dal vivo'],
  online: ['online', '접속', '接続', '在线', 'en línea', 'ऑनलाइन', 'trực tuyến', 'ออนไลน์', 'онлайн', 'online', 'en ligne', 'online'],
  chatPh: ['Type a message…', '메시지 입력…', 'メッセージ入力…', '输入消息…', 'Escribe…', 'संदेश लिखें…', 'Nhập tin nhắn…', 'พิมพ์ข้อความ…', 'Сообщение…', 'Nachricht…', 'Message…', 'Messaggio…'],
  send: ['Send', '전송', '送信', '发送', 'Enviar', 'भेजें', 'Gửi', 'ส่ง', 'Отпр.', 'Senden', 'Envoyer', 'Invia'],
  finished: ['Final', '종료', '終了', '完场', 'Final', 'समाप्त', 'Kết thúc', 'จบ', 'Заверш.', 'Ende', 'Terminé', 'Finita'],
  lineup: ['Lineup', '선발 라인업', 'スタメン', '首发阵容', 'Alineación', 'लाइनअप', 'Đội hình', 'ผู้เล่นตัวจริง', 'Состав', 'Aufstellung', 'Composition', 'Formazione'],
  boxRec: ['Box Score', '경기 기록', '成績', '比赛数据', 'Estadísticas', 'रिकॉर्ड', 'Thống kê', 'สถิติ', 'Статистика', 'Statistik', 'Statistiques', 'Statistiche'],
  boxSoon: ['Available after the game', '경기 후 제공', '試合後に表示', '比赛后提供', 'Disponible tras el partido', 'मैच के बाद उपलब्ध', 'Có sau trận đấu', 'มีให้หลังจบเกม', 'Доступно после матча', 'Nach dem Spiel verfügbar', 'Disponible après le match', 'Disponibile dopo la partita'],
  probable: ['Starting Pitchers', '선발투수', '先発投手', '先发投手', 'Abridores', 'गेंदबाज', 'Ném bóng', 'พิตเชอร์', 'Питчеры', 'Starter', 'Lanceurs', 'Lanciatori'],
  recent: ['Last 10 Games', '최근 10경기', '直近10試合', '近10场', 'Últimos 10', 'पिछले 10', '10 trận gần đây', '10 นัดล่าสุด', 'Последние 10', 'Letzte 10', '10 derniers', 'Ultime 10'],
  h2h: ['Head to Head', '맞대결', '対戦成績', '交锋记录', 'Enfrentamientos', 'आमना-सामना', 'Đối đầu', 'สถิติเจอกัน', 'Очные встречи', 'Duelle', 'Confrontations', 'Scontri diretti'],
  standings: ['Standings', '팀 순위', '順位表', '积分榜', 'Clasificación', 'अंक तालिका', 'BXH', 'ตารางคะแนน', 'Таблица', 'Tabelle', 'Classement', 'Classifica'],
  highlight: ['Highlights', '경기 하이라이트', 'ハイライト', '比赛集锦', 'Resúmenes', 'हाइलाइट्स', 'Điểm nhấn', 'ไฮไลต์', 'Обзор матча', 'Highlights', 'Résumé', 'Highlights'],
  playHi: ['▶ Play Highlights', '▶ 하이라이트 재생', '▶ ハイライト再生', '▶ 播放集锦', '▶ Ver resumen', '▶ हाइलाइट चलाएं', '▶ Xem điểm nhấn', '▶ เล่นไฮไลต์', '▶ Смотреть обзор', '▶ Highlights', '▶ Voir le résumé', '▶ Guarda highlights'],
  ytWatch: ['📺 Watch on YouTube ›', '📺 YouTube에서 보기 ›', '📺 YouTubeで見る ›', '📺 在YouTube观看 ›', '📺 Ver en YouTube ›', '📺 YouTube पर देखें ›', '📺 Xem trên YouTube ›', '📺 ดูบน YouTube ›', '📺 Смотреть на YouTube ›', '📺 Auf YouTube ansehen ›', '📺 Voir sur YouTube ›', '📺 Guarda su YouTube ›'],
  ytLoading: ['Loading…', '불러오는 중…', '読み込み中…', '加载中…', 'Cargando…', 'लोड हो रहा…', 'Đang tải…', 'กำลังโหลด…', 'Загрузка…', 'Laden…', 'Chargement…', 'Caricamento…'],
  ytNeedKey: ['Highlight playback key not set yet (once configured, plays right here)', 'YouTube 재생 키가 아직 없어요 (설정하면 화면 안에서 바로 재생돼요)', 'ハイライト再生キー未設定（設定すると画面内で再生）', '尚未设置播放密钥（设置后可在页面内播放）', 'Falta la clave de reproducción (al configurarla se reproduce aquí)', 'प्लेबैक कुंजी सेट नहीं है', 'Chưa có khóa phát (cấu hình để phát tại đây)', 'ยังไม่ได้ตั้งคีย์เล่นไฮไลต์', 'Ключ воспроизведения не задан', 'Wiedergabeschlüssel fehlt noch', 'Clé de lecture non définie', 'Chiave di riproduzione non impostata'],
  ytNotFound: ['No video found', '영상을 찾지 못했어요', '動画が見つかりません', '未找到视频', 'No se encontró el video', 'वीडियो नहीं मिला', 'Không tìm thấy video', 'ไม่พบวิดีโอ', 'Видео не найдено', 'Kein Video gefunden', 'Vidéo introuvable', 'Nessun video trovato'],
  ytFail: ['Load failed — opening link', '불러오기 실패 — 링크로 열립니다', '読み込み失敗 — リンクで開きます', '加载失败 — 用链接打开', 'Error — abriendo enlace', 'लोड विफल — लिंक खुल रहा', 'Lỗi tải — mở bằng liên kết', 'โหลดล้มเหลว — เปิดลิงก์', 'Ошибка — открываю ссылку', 'Fehler — Link wird geöffnet', 'Échec — ouverture du lien', 'Errore — apro il link'],
  matchStats: ['Match Stats', '경기 스탯', '試合スタッツ', '比赛数据', 'Estadísticas', 'मैच आँकड़े', 'Thống kê trận', 'สถิติแมตช์', 'Статистика матча', 'Spielstatistik', 'Stats du match', 'Statistiche'],
  playerRatings: ['Player Ratings', '선수 평점', '選手評価', '球员评分', 'Notas jugadores', 'खिलाड़ी रेटिंग', 'Điểm cầu thủ', 'คะแนนผู้เล่น', 'Оценки игроков', 'Spielernoten', 'Notes des joueurs', 'Voti giocatori'],
  coach: ['Coach', '감독', '監督', '主教练', 'Entrenador', 'कोच', 'HLV', 'โค้ช', 'Тренер', 'Trainer', 'Entraîneur', 'Allenatore'],
  pickHub: ['Picks', '픽 제공', 'ピック', '推荐', 'Picks', 'पिक', 'Kèo', 'พิค', 'Пики', 'Tipps', 'Pronostics', 'Pick'],
  pickHubSub: ['Win% · market consensus · LIVE UP analysis', '전 경기 승률 · 시장 컨센서스 · LIVE UP 분석', '勝率・市場・LIVE UP分析', '胜率·市场共识·LIVE UP分析', '% victoria · consenso · LIVE UP', 'जीत% · बाज़ार · LIVE UP', 'Tỷ lệ thắng · thị trường · LIVE UP', '% ชนะ · ตลาด · LIVE UP', '% побед · рынок · LIVE UP', 'Sieg% · Markt · LIVE UP', '% victoire · marché · LIVE UP', '% vittoria · mercato · LIVE UP'],
  marketCons: ['Market consensus', '시장 컨센서스', '市場コンセンサス', '市场共识', 'Consenso mercado', 'मार्केट सहमति', 'Đồng thuận thị trường', 'ตลาดรวม', 'Консенсус рынка', 'Marktkonsens', 'Consensus marché', 'Consenso mercato'],
  luAnalysis: ['LIVE UP analysis', 'LIVE UP 데이터 분석', 'LIVE UP分析', 'LIVE UP分析', 'Análisis LIVE UP', 'LIVE UP विश्लेषण', 'Phân tích LIVE UP', 'วิเคราะห์ LIVE UP', 'Анализ LIVE UP', 'LIVE UP-Analyse', 'Analyse LIVE UP', 'Analisi LIVE UP'],
  finalPick: ['Final PICK', '최종 PICK', '最終ピック', '最终推荐', 'PICK final', 'अंतिम पिक', 'PICK cuối', 'พิคสุดท้าย', 'Финальный пик', 'Finaler Tipp', 'PICK final', 'PICK finale'],
  oddsAgg: ['Bookmaker consensus', '해외 배당 종합', 'ブック総合', '外盘综合', 'Consenso casas', 'बुकी सहमति', 'Tổng hợp nhà cái', 'รวมเจ้ามือ', 'Сводка букмекеров', 'Buchmacher', 'Consensus books', 'Consenso book'],
  pickSummary: ['Pick Summary', '픽 요약', 'ピック要約', '推荐摘要', 'Resumen pick', 'पिक सारांश', 'Tóm tắt pick', 'สรุปพิค', 'Сводка пика', 'Pick-Übersicht', 'Résumé pick', 'Riepilogo pick'],
  noPickGames: ['No games to pick', '픽 제공할 경기가 없어요', 'ピック対象なし', '暂无可推荐比赛', 'Sin partidos', 'कोई मैच नहीं', 'Không có trận', 'ไม่มีแมตช์', 'Нет матчей', 'Keine Spiele', 'Aucun match', 'Nessuna partita'],
  subs: ['Subs', '교체', '控え', '替补', 'Suplentes', 'सब्स', 'Dự bị', 'ตัวสำรอง', 'Запасные', 'Ersatz', 'Remplaçants', 'Riserve'],
  aiSum: ['AI Summary', 'AI 총정리', 'AI要約', 'AI总结', 'Resumen IA', 'AI सारांश', 'Tóm tắt AI', 'สรุป AI', 'AI-обзор', 'KI-Zusammenfassung', 'Résumé IA', 'Riepilogo IA'],
  liveEv: ['Live Events', '실시간 이벤트', 'ライブ速報', '实时事件', 'Eventos en vivo', 'लाइव इवेंट', 'Sự kiện trực tiếp', 'เหตุการณ์สด', 'События', 'Live-Events', 'Événements', 'Eventi live'],
  aiPred: ['AI Prediction', 'AI 승부 예측', 'AI予想', 'AI预测', 'Predicción IA', 'AI भविष्यवाणी', 'Dự đoán AI', 'ทำนายผล AI', 'AI-прогноз', 'KI-Prognose', 'Pronostic IA', 'Pronostico IA'],
  liveSit: ['Live Situation', '실시간 상황', 'ライブ状況', '实时状况', 'En directo', 'लाइव स्थिति', 'Tình huống', 'สถานการณ์สด', 'Ситуация', 'Live-Lage', 'En direct', 'Situazione live'],
  league: ['League', '리그', 'リーグ', '联赛', 'Liga', 'लीग', 'Giải', 'ลีก', 'Лига', 'Liga', 'Ligue', 'Lega'],
  dt: ['Date', '일시', '日時', '时间', 'Fecha', 'तारीख', 'Thời gian', 'เวลา', 'Дата', 'Datum', 'Date', 'Data'],
  status: ['Status', '상태', '状態', '状态', 'Estado', 'स्थिति', 'Trạng thái', 'สถานะ', 'Статус', 'Status', 'Statut', 'Stato'],
  loading: ['Loading…', '불러오는 중…', '読み込み中…', '加载中…', 'Cargando…', 'लोड हो रहा…', 'Đang tải…', 'กำลังโหลด…', 'Загрузка…', 'Lädt…', 'Chargement…', 'Caricamento…'],
  langLabel: ['Language', '언어', '言語', '语言', 'Idioma', 'भाषा', 'Ngôn ngữ', 'ภาษา', 'Язык', 'Sprache', 'Langue', 'Lingua'],
  news: ['Latest sports news', '스포츠 최신 뉴스', 'スポーツ最新ニュース', '体育最新新闻', 'Últimas noticias', 'ताज़ा खबरें', 'Tin thể thao', 'ข่าวกีฬา', 'Спортновости', 'Sport-News', 'Actus sport', 'Notizie sport'],
  interest: ['Leagues', '관심 리그', 'リーグ', '联赛', 'Ligas', 'लीग', 'Giải đấu', 'ลีก', 'Лиги', 'Ligen', 'Ligues', 'Leghe'],
  sportsHd: ['Sports', '종목', 'スポーツ', '项目', 'Deportes', 'खेल', 'Môn', 'กีฬา', 'Спорт', 'Sportart', 'Sports', 'Sport'],
  pick: ['Pick', '픽', 'ピック', '精选', 'Pick', 'पिक', 'Chọn', 'พิค', 'Пик', 'Pick', 'Pick', 'Pick'],
  newsMore: ['· via Daum Sports', '· 다음스포츠에서 보기', '· Daumスポーツで見る', '· 在Daum体育查看', '· en Daum Sports', '· Daum Sports पर देखें', '· trên Daum Sports', '· ดูที่ Daum Sports', '· на Daum Sports', '· auf Daum Sports', '· sur Daum Sports', '· su Daum Sports'],
  noGames: ['No games scheduled', '경기가 없습니다', '試合がありません', '暂无比赛', 'Sin partidos', 'कोई मैच नहीं', 'Không có trận đấu', 'ไม่มีการแข่งขัน', 'Нет матчей', 'Keine Spiele', 'Aucun match', 'Nessuna partita'],
  loadingGames: ['Loading games…', '경기 불러오는 중…', '試合を読み込み中…', '加载比赛中…', 'Cargando partidos…', 'मैच लोड हो रहे…', 'Đang tải trận…', 'กำลังโหลด…', 'Загрузка матчей…', 'Spiele laden…', 'Chargement…', 'Caricamento…'],
  retry: ['Retry', '다시 시도', '再試行', '重试', 'Reintentar', 'पुनः प्रयास', 'Thử lại', 'ลองใหม่', 'Повторить', 'Erneut', 'Réessayer', 'Riprova'],
  order: ['Order', '타순표', '打順', '打序', 'Orden', 'क्रम', 'Thứ tự đánh', 'ลำดับตี', 'Порядок', 'Reihenfolge', 'Ordre', 'Ordine'],
  fieldPos: ['Field Positions', '야구장 배치', '守備位置', '防守位置', 'Posiciones', 'फील्ड', 'Vị trí sân', 'ตำแหน่ง', 'Позиции', 'Feldpositionen', 'Positions', 'Posizioni'],
  tapPlayer: ['tap a player · last 10 games', '선수 누르면 최근 10경기', '選手をタップで直近10試合', '点击球员看近10场', 'toca un jugador · últimos 10', 'खिलाड़ी पर टैप', 'chạm cầu thủ · 10 trận', 'แตะผู้เล่น · 10 นัด', 'нажми игрока · 10 игр', 'Spieler antippen', 'toucher un joueur', 'tocca un giocatore'],
  freeReal: ['MLB · free real data', 'MLB · 무료 실데이터', 'MLB · 無料実データ', 'MLB · 免费实时数据', 'MLB · datos reales', 'MLB · मुफ्त डेटा', 'MLB · dữ liệu miễn phí', 'MLB · ข้อมูลฟรี', 'MLB · бесплатно', 'MLB · Echtdaten', 'MLB · données réelles', 'MLB · dati reali'],
  atBat: ['At bat', '타석', '打席', '打席', 'Al bate', 'बल्लेबाजी', 'Đang đánh', 'กำลังตี', 'На бите', 'Am Schlag', 'À la batte', 'Alla battuta'],
  aiAuto: ['AI auto-summary', 'AI 자동 정리', 'AI自動まとめ', 'AI自动整理', 'Resumen IA', 'AI स्वतः', 'AI tự động', 'AI อัตโนมัติ', 'AI-сводка', 'KI-Auto', 'IA auto', 'IA auto'],
  confidence: ['Confidence', '신뢰도', '信頼度', '可信度', 'Confianza', 'विश्वास', 'Độ tin cậy', 'ความมั่นใจ', 'Достоверность', 'Konfidenz', 'Confiance', 'Affidabilità'],
  win: ['Win', '승', '勝', '胜', 'Gana', 'जीत', 'Thắng', 'ชนะ', 'Победа', 'Sieg', 'Victoire', 'Vittoria'],
  draw: ['Draw', '무', '分', '平', 'Empate', 'ड्रॉ', 'Hòa', 'เสมอ', 'Ничья', 'Remis', 'Nul', 'Pareggio'],
  tapDetail: ['tap a game for details', '경기 눌러 상세', '試合をタップで詳細', '点击比赛看详情', 'toca un partido', 'मैच पर टैप', 'chạm để xem', 'แตะดูรายละเอียด', 'нажми для деталей', 'Spiel antippen', 'toucher un match', 'tocca una partita'],
  scoreDetail: ['Match Details', '경기 상세', '試合詳細', '比赛详情', 'Detalles', 'मैच विवरण', 'Chi tiết', 'รายละเอียด', 'Детали', 'Spieldetails', 'Détails', 'Dettagli'],
  goalsCards: ['goals/cards/subs', '골/퇴장/교체', 'ゴール/退場/交代', '进球/红牌/换人', 'goles/tarjetas', 'गोल/कार्ड', 'bàn/thẻ/thay', 'ประตู/ใบ/เปลี่ยน', 'голы/карты', 'Tore/Karten', 'buts/cartons', 'gol/cartellini'],
  runsHits: ['runs/hits/errors', '득점/안타/실책', '得点/安打/失策', '得分/安打/失误', 'carreras/hits', 'रन/हिट', 'điểm/hit/lỗi', 'แต้ม/ฮิต/พลาด', 'очки/хиты', 'Runs/Hits', 'points/coups', 'punti/valide'],
  halftime: ['Half Time', '하프타임', 'ハーフタイム', '中场休息', 'Descanso', 'हाफ टाइम', 'Nghỉ giữa hiệp', 'พักครึ่ง', 'Перерыв', 'Halbzeit', 'Mi-temps', 'Intervallo'],
  penalties: ['Penalties', '승부차기', 'PK戦', '点球大战', 'Penales', 'पेनल्टी', 'Luân lưu', 'ดวลจุดโทษ', 'Пенальти', 'Elfmeter', 'Tirs au but', 'Rigori'],
  extraTime: ['Extra Time', '연장', '延長', '加时', 'Prórroga', 'अतिरिक्त समय', 'Hiệp phụ', 'ต่อเวลา', 'Доп. время', 'Verläng.', 'Prolong.', 'Supplem.'],
  inplay: ['In play', '진행 중', '進行中', '进行中', 'En juego', 'जारी', 'Đang đấu', 'กำลังแข่ง', 'Идёт игра', 'Läuft', 'En cours', 'In corso'],
  fh: ['1H', '전반', '前半', '上半场', '1ª parte', 'पहला हाफ', 'Hiệp 1', 'ครึ่งแรก', '1-й тайм', '1. HZ', '1re', '1° tempo'],
  sh: ['2H', '후반', '後半', '下半场', '2ª parte', 'दूसरा हाफ', 'Hiệp 2', 'ครึ่งหลัง', '2-й тайм', '2. HZ', '2e', '2° tempo'],
  close: ['✕ Close', '✕ 닫기', '✕ 閉じる', '✕ 关闭', '✕ Cerrar', '✕ बंद', '✕ Đóng', '✕ ปิด', '✕ Закрыть', '✕ Schließen', '✕ Fermer', '✕ Chiudi'],
  loss: ['Loss', '패', '負', '负', 'Pierde', 'हार', 'Thua', 'แพ้', 'Пораж.', 'Nied.', 'Défaite', 'Sconf.'],
  inningScore: ['Line Score', '이닝별 스코어', 'イニング別スコア', '逐局比分', 'Por entrada', 'पारी स्कोर', 'Điểm từng hiệp', 'คะแนนรายอินนิ่ง', 'По иннингам', 'Inning-Score', 'Score par manche', 'Punteggio inning'],
  noEvents: ['No events yet', '아직 이벤트가 없어요', 'まだイベントなし', '暂无事件', 'Sin eventos', 'कोई इवेंट नहीं', 'Chưa có sự kiện', 'ยังไม่มีเหตุการณ์', 'Событий пока нет', 'Noch keine Events', "Pas d'événement", 'Nessun evento'],
  setWord: ['Sets', '세트', 'セット', '局', 'Sets', 'सेट', 'Set', 'เซ็ต', 'Сеты', 'Sätze', 'Sets', 'Set'],
  now: ['Now', '현재', '現在', '当前', 'Ahora', 'अभी', 'Hiện tại', 'ตอนนี้', 'Сейчас', 'Jetzt', 'Actuel', 'Ora'],
  scheduled: ['Scheduled', '예정', '予定', '预定', 'Programado', 'निर्धारित', 'Dự kiến', 'ตามกำหนด', 'По расписанию', 'Geplant', 'Prévu', 'In programma'],
  // ── AI 해설·이벤트 문장 템플릿 ({토큰} 치환) ──
  aiComm: ['AI Commentary', 'AI 해설', 'AI解説', 'AI解说', 'Comentario IA', 'AI कमेंट्री', 'Bình luận AI', 'คำบรรยาย AI', 'AI-комментарий', 'KI-Kommentar', 'Commentaire IA', 'Commento IA'],
  aiTie: ['{st}, {home} vs {away} {h}:{a} — neck and neck.', '{st}, {home} vs {away} {h}:{a} 팽팽한 접전이에요.', '{st}、{home} 対 {away} {h}:{a} の接戦です。', '{st}，{home} vs {away} {h}:{a}，势均力敌。', '{st}, {home} vs {away} {h}:{a}, muy igualado.', '{st}, {home} बनाम {away} {h}:{a} — कांटे की टक्कर।', '{st}, {home} vs {away} {h}:{a} — cân tài cân sức.', '{st}, {home} พบ {away} {h}:{a} สูสีมาก', '{st}, {home} — {away} {h}:{a}, борьба на равных.', '{st}, {home} vs {away} {h}:{a} — Kopf-an-Kopf.', '{st}, {home} vs {away} {h}:{a} — au coude à coude.', '{st}, {home} vs {away} {h}:{a} — equilibratissima.'],
  aiLead: ['{st} · {lead} leads by {d} ({h}:{a}).', '{st} · {lead} {d}점 차로 앞서는 흐름 ({h}:{a}).', '{st}・{lead} が {d} 点差でリード（{h}:{a}）。', '{st}·{lead} 领先 {d} 分（{h}:{a}）。', '{st} · {lead} gana por {d} ({h}:{a}).', '{st} · {lead} {d} से आगे ({h}:{a})।', '{st} · {lead} dẫn {d} ({h}:{a}).', '{st} · {lead} นำอยู่ {d} ({h}:{a})', '{st} · {lead} впереди на {d} ({h}:{a}).', '{st} · {lead} führt mit {d} ({h}:{a}).', '{st} · {lead} mène de {d} ({h}:{a}).', '{st} · {lead} avanti di {d} ({h}:{a}).'],
  aiHits: ['Hits {home} {hh} · {away} {ah}', '안타 {home} {hh} · {away} {ah}', '安打 {home} {hh} · {away} {ah}', '安打 {home} {hh} · {away} {ah}', 'Hits {home} {hh} · {away} {ah}', 'हिट {home} {hh} · {away} {ah}', 'Hit {home} {hh} · {away} {ah}', 'ฮิต {home} {hh} · {away} {ah}', 'Хиты {home} {hh} · {away} {ah}', 'Hits {home} {hh} · {away} {ah}', 'Coups {home} {hh} · {away} {ah}', 'Valide {home} {hh} · {away} {ah}'],
  sumSched1: ['Upcoming: {home} vs {away}.', '곧 시작하는 {home} vs {away} 경기입니다.', 'まもなく開始：{home} 対 {away}。', '即将开始：{home} vs {away}。', 'Próximo: {home} vs {away}.', 'आगामी: {home} बनाम {away}।', 'Sắp diễn ra: {home} vs {away}.', 'กำลังจะเริ่ม: {home} พบ {away}', 'Скоро: {home} — {away}.', 'Bald: {home} vs {away}.', 'À venir : {home} vs {away}.', 'In arrivo: {home} vs {away}.'],
  sumSched2: ['Odds slightly favor {side}.', '배당 기준 {side} 쪽이 근소 우위예요.', 'オッズ的には {side} がやや優勢。', '赔率略微看好 {side}。', 'Las cuotas favorecen algo a {side}.', 'ऑड्स में {side} थोड़ा आगे।', 'Tỷ lệ nghiêng nhẹ về {side}.', 'อัตราต่อรองเอียงไป {side} เล็กน้อย', 'Ставки слегка за {side}.', 'Quoten leicht für {side}.', 'Les cotes favorisent {side}.', 'Le quote favoriscono {side}.'],
  sumSched3: ['Live score & commentary will auto-update here.', '시작 후 실시간 스코어·해설이 자동 갱신됩니다.', '開始後、ライブスコアと解説が自動更新されます。', '开赛后实时比分与解说将自动更新。', 'El marcador y comentarios se actualizarán aquí.', 'शुरू होने पर लाइव स्कोर व कमेंट्री अपडेट होंगे।', 'Tỷ số & bình luận sẽ tự cập nhật ở đây.', 'สกอร์และคำบรรยายสดจะอัปเดตอัตโนมัติ', 'Счёт и комментарии обновятся автоматически.', 'Live-Score & Kommentar aktualisieren sich hier.', 'Score et commentaires se mettront à jour ici.', 'Punteggio e commento si aggiorneranno qui.'],
  sumTie: ['{st}: tied {h}:{a}, extremely close.', '{st} 현재 {h}:{a} 동점, 초박빙 승부예요.', '{st} 現在 {h}:{a} の同点、大接戦です。', '{st} 目前 {h}:{a} 平局，非常胶着。', '{st}: empate {h}:{a}, muy reñido.', '{st}: {h}:{a} बराबरी, बेहद करीबी।', '{st}: hòa {h}:{a}, cực sát nút.', '{st}: เสมอ {h}:{a} สูสีมาก', '{st}: ничья {h}:{a}, очень напряжённо.', '{st}: {h}:{a} unentschieden, sehr eng.', '{st} : égalité {h}:{a}, très serré.', '{st}: pari {h}:{a}, molto equilibrata.'],
  sumLead: ['{st}: {lead} leads {hi}:{lo}, by {d}.', '{st} 현재 {lead}이(가) {hi}:{lo}, {d}점 차로 앞섭니다.', '{st} 現在 {lead} が {hi}:{lo}、{d} 点差でリード。', '{st} {lead} 以 {hi}:{lo} 领先 {d} 分。', '{st}: {lead} gana {hi}:{lo}, por {d}.', '{st}: {lead} {hi}:{lo} से {d} आगे।', '{st}: {lead} dẫn {hi}:{lo}, cách {d}.', '{st}: {lead} นำ {hi}:{lo} ห่าง {d}', '{st}: {lead} ведёт {hi}:{lo}, на {d}.', '{st}: {lead} führt {hi}:{lo}, mit {d}.', '{st} : {lead} mène {hi}:{lo}, de {d}.', '{st}: {lead} avanti {hi}:{lo}, di {d}.'],
  sumBB: ['Hits: {home} {hh} · {away} {ah}. Errors {he}:{ae}.', '안타 {home} {hh} · {away} {ah}, 실책 {he}:{ae}.', '安打 {home} {hh} · {away} {ah}、失策 {he}:{ae}。', '安打 {home} {hh} · {away} {ah}，失误 {he}:{ae}。', 'Hits: {home} {hh} · {away} {ah}. Errores {he}:{ae}.', 'हिट: {home} {hh} · {away} {ah}. एरर {he}:{ae}.', 'Hit: {home} {hh} · {away} {ah}. Lỗi {he}:{ae}.', 'ฮิต: {home} {hh} · {away} {ah} เออเรอร์ {he}:{ae}', 'Хиты: {home} {hh} · {away} {ah}. Ошибки {he}:{ae}.', 'Hits: {home} {hh} · {away} {ah}. Fehler {he}:{ae}.', 'Coups : {home} {hh} · {away} {ah}. Erreurs {he}:{ae}.', 'Valide: {home} {hh} · {away} {ah}. Errori {he}:{ae}.'],
  sumInn: ['{x} — {tb}.', '{x} · {tb} 국면입니다.', '{x}・{tb}。', '{x}·{tb}。', '{x} — {tb}.', '{x} — {tb}।', '{x} — {tb}.', '{x} — {tb}', '{x} — {tb}.', '{x} — {tb}.', '{x} — {tb}.', '{x} — {tb}.'],
  tbTop: ['top · away batting', '초 · 원정팀 공격', '表・ビジター攻撃', '上·客队进攻', 'alta · batea visitante', 'ऊपरी · अवे बल्लेबाजी', 'đầu · đội khách đánh', 'ครึ่งบน · ทีมเยือนตี', 'верх · бьёт гость', 'oben · Gäste am Schlag', 'haute · visiteurs à la batte', 'alta · battono gli ospiti'],
  tbBot: ['bottom · home batting', '말 · 홈팀 공격', '裏・ホーム攻撃', '下·主队进攻', 'baja · batea local', 'निचली · होम बल्लेबाजी', 'cuối · đội nhà đánh', 'ครึ่งล่าง · ทีมเหย้าตี', 'низ · бьёт хозяин', 'unten · Heim am Schlag', 'basse · domicile à la batte', 'bassa · battono i padroni'],
  topShort: ['Top', '초', '表', '上', 'Alta', 'ऊपर', 'Đầu', 'บน', 'Верх', 'Oben', 'Haut', 'Alta'],
  botShort: ['Bot', '말', '裏', '下', 'Baja', 'नीचे', 'Cuối', 'ล่าง', 'Низ', 'Unten', 'Bas', 'Bassa'],
  batNow: ['batting', '공격', '攻撃中', '进攻', 'al bate', 'बल्लेबाजी', 'đang đánh', 'กำลังตี', 'атакует', 'am Schlag', 'à la batte', 'alla battuta'],
  finishedSec: ['Finished', '종료 경기', '終了', '已结束', 'Finalizados', 'समाप्त', 'Đã kết thúc', 'จบแล้ว', 'Завершённые', 'Beendet', 'Terminés', 'Terminate'],
  last10: ['Last 10', '최근 10경기', '直近10', '近10场', 'Últimos 10', 'पिछले 10', '10 trận gần nhất', '10 นัดล่าสุด', 'Последние 10', 'Letzte 10', '10 derniers', 'Ultime 10'],
  pickReco: ['Pick', '추천', '推奨', '推荐', 'Recom.', 'सुझाव', 'Gợi ý', 'แนะนำ', 'Совет', 'Tipp', 'Reco', 'Consiglio'],
  loginToUse: ['Login required', '로그인 후 이용 가능합니다', 'ログイン後にご利用いただけます', '登录后可用', 'Inicia sesión para usar', 'उपयोग के लिए लॉगिन करें', 'Đăng nhập để sử dụng', 'เข้าสู่ระบบเพื่อใช้งาน', 'Требуется вход', 'Anmeldung erforderlich', 'Connexion requise', 'Accesso richiesto'],
  gateSub: ['Sign in with Google to view match info', '구글 로그인하면 경기 정보방을 볼 수 있어요', 'Googleログインで試合情報を見られます', '登录后即可查看比赛信息', 'Inicia sesión con Google para ver', 'मैच जानकारी देखने के लिए Google से लॉगिन करें', 'Đăng nhập Google để xem thông tin', 'ล็อกอิน Google เพื่อดูข้อมูล', 'Войдите через Google, чтобы просмотреть', 'Mit Google anmelden, um Infos zu sehen', 'Connectez-vous avec Google pour voir', 'Accedi con Google per vedere'],
  pickIndex: ['LIVE UP Index', 'LIVE UP 종합 지표', 'LIVE UP 総合指標', 'LIVE UP 综合指标', 'Índice LIVE UP', 'LIVE UP सूचकांक', 'Chỉ số LIVE UP', 'ดัชนี LIVE UP', 'Индекс LIVE UP', 'LIVE UP Index', 'Indice LIVE UP', 'Indice LIVE UP'],
  pickIndexNote: ['Combines recent form, H2H, injuries and odds.', '최근 전적·상대전적·부상·배당 흐름을 종합한 결과예요.', '最近の成績・対戦・故障・オッズを総合。', '综合近期战绩·交锋·伤病·赔率。', 'Combina forma, H2H, lesiones y cuotas.', 'हालिया फॉर्म, H2H, चोट और ऑड्स का मिश्रण।', 'Kết hợp phong độ, đối đầu, chấn thương, tỷ lệ.', 'รวมฟอร์ม สถิติเจอกัน อาการเจ็บ และราคา', 'Учитывает форму, очные встречи, травмы и коэффициенты.', 'Kombiniert Form, H2H, Ausfälle und Quoten.', 'Combine forme, confrontations, blessures et cotes.', 'Combina forma, scontri, infortuni e quote.'],
  pickData: ['Key Data', '경기 주요 데이터', '主要データ', '关键数据', 'Datos clave', 'मुख्य डेटा', 'Dữ liệu chính', 'ข้อมูลสำคัญ', 'Ключевые данные', 'Kerndaten', 'Données clés', 'Dati chiave'],
  pickWarn: ['Betting is your own responsibility. This info is for reference only.', '도박은 개인의 책임이며, 이 정보는 참고용입니다. 과도한 배팅을 지양하세요.', '賭けは自己責任です。参考情報です。', '博彩为个人责任，此信息仅供参考。', 'Apostar es su responsabilidad. Solo referencia.', 'सट्टा आपकी ज़िम्मेदारी है, यह जानकारी केवल संदर्भ के लिए है।', 'Cá cược là trách nhiệm của bạn. Chỉ để tham khảo.', 'การพนันเป็นความรับผิดชอบส่วนบุคคล ข้อมูลนี้เพื่ออ้างอิงเท่านั้น', 'Ставки — ваша ответственность. Только для справки.', 'Wetten auf eigene Verantwortung. Nur zur Info.', 'Les paris relèvent de votre responsabilité. À titre indicatif.', 'Le scommesse sono una tua responsabilità. Solo a scopo informativo.'],
  recoHome: ['Home edge', '홈 우세', 'ホーム優勢', '主队占优', 'Ventaja local', 'होम बढ़त', 'Đội nhà nhỉnh hơn', 'เจ้าบ้านได้เปรียบ', 'Перевес хозяев', 'Heimvorteil', 'Avantage domicile', 'Favorita in casa'],
  recoAway: ['Away edge', '원정 우세', 'アウェイ優勢', '客队占优', 'Ventaja visitante', 'अवे बढ़त', 'Đội khách nhỉnh hơn', 'ทีมเยือนได้เปรียบ', 'Перевес гостей', 'Auswärtsvorteil', 'Avantage extérieur', 'Favorita in trasferta'],
  recoDraw: ['Even', '팽팽한 접전', '互角', '势均力敌', 'Parejo', 'बराबरी', 'Cân bằng', 'สูสี', 'Равны', 'Ausgeglichen', 'Équilibré', 'Equilibrata'],
  oddsNote: ['Consensus odds (multiple books).', '여러 업체 종합 배당이에요.', '複数社の総合オッズ。', '多家综合赔率。', 'Cuotas de consenso.', 'सर्वसम्मत ऑड्स।', 'Tỷ lệ tổng hợp.', 'ราคาเฉลี่ยจากหลายเจ้า', 'Сводные коэффициенты.', 'Konsens-Quoten.', 'Cotes consensus.', 'Quote di consenso.'],
  oddsSoon: ['Odds coming soon', '배당 준비중', 'オッズ準備中', '赔率待更新', 'Cuotas próximamente', 'ऑड्स जल्द', 'Tỷ lệ sắp có', 'ราคากำลังมา', 'Коэффициенты скоро', 'Quoten folgen', 'Cotes à venir', 'Quote in arrivo'],
  stPostponed: ['Postponed', '연기', '延期', '延期', 'Aplazado', 'स्थगित', 'Hoãn', 'เลื่อน', 'Отложен', 'Verschoben', 'Reporté', 'Rinviata'],
  stCanceled: ['Canceled', '취소', '中止', '取消', 'Cancelado', 'रद्द', 'Hủy', 'ยกเลิก', 'Отменён', 'Abgesagt', 'Annulé', 'Annullata'],
  stDelayed: ['Delayed', '지연', '中断', '延误', 'Retrasado', 'विलंबित', 'Trì hoãn', 'ล่าช้า', 'Задержан', 'Verzögert', 'Retardé', 'Ritardata'],
  stSuspended: ['Rain Suspended', '우천 중단', '雨天中断', '雨天中断', 'Susp. lluvia', 'वर्षा निलंबन', 'Hoãn vì mưa', 'พักฝนตก', 'Дождь', 'Regen-Unterbr.', 'Susp. pluie', 'Sosp. pioggia'],
  stAbnormal: ['—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—'],
  stHalved: ['Called (half)', '콜드', 'コールド', '提前结束', 'Acortado', 'संक्षिप्त', 'Rút gọn', 'จบก่อนกำหนด', 'Сокращён', 'Verkürzt', 'Écourté', 'Ridotta'],
  stTbd: ['TBD', '미정', '未定', '待定', 'Por definir', 'तय नहीं', 'Chưa xác định', 'ยังไม่กำหนด', 'Не определено', 'Offen', 'À définir', 'Da definire'],
  vibeLoaded: ['Bases loaded!', '만루 찬스!', '満塁のチャンス！', '满垒机会！', '¡Bases llenas!', 'बेस लोडेड!', 'Đầy gôn!', 'เต็มเบส!', 'Базы загружены!', 'Bases voll!', 'Bases pleines !', 'Basi piene!'],
  vibeRISP: ['Runner in scoring position!', '득점권 주자!', '得点圏に走者！', '得分位有跑者！', '¡Corredor en posición de anotar!', 'स्कोरिंग पोजिशन में रनर!', 'Runner ở vị trí ghi điểm!', 'มีรันเนอร์ลุ้นทำแต้ม!', 'Раннер в позиции для очка!', 'Läufer in Scoring Position!', 'Coureur en position de marquer !', 'Corridore in posizione punto!'],
  vibe2out: ['Two down, full tension!', '투아웃, 벼랑 끝!', '2アウト、崖っぷち！', '两出局，命悬一线！', '¡Dos outs, máxima tensión!', 'दो आउट, पूरा दबाव!', 'Hai out, cực căng!', 'สองเอาต์ ลุ้นสุด!', 'Два аута, предел!', 'Zwei Aus, volle Spannung!', 'Deux retraits, tension max !', 'Due out, tensione alle stelle!'],
  sumSet: ['Sets {h}:{a}, current set {sh}:{sa}. {leader} leads this set.', '세트 {h}:{a}, 현재 세트 {sh}:{sa}. {leader}이(가) 이 세트 리드 중.', 'セット {h}:{a}、現在のセット {sh}:{sa}。{leader} がリード。', '局分 {h}:{a}，当前局 {sh}:{sa}。{leader} 领先本局。', 'Sets {h}:{a}, set actual {sh}:{sa}. {leader} domina.', 'सेट {h}:{a}, वर्तमान सेट {sh}:{sa}. {leader} आगे।', 'Set {h}:{a}, set hiện tại {sh}:{sa}. {leader} dẫn.', 'เซ็ต {h}:{a} เซ็ตปัจจุบัน {sh}:{sa} {leader} นำ', 'Сеты {h}:{a}, текущий {sh}:{sa}. {leader} ведёт.', 'Sätze {h}:{a}, aktueller Satz {sh}:{sa}. {leader} führt.', 'Sets {h}:{a}, set actuel {sh}:{sa}. {leader} mène.', 'Set {h}:{a}, set attuale {sh}:{sa}. {leader} avanti.'],
  sumOdds: ['Odds: win {oh} / lose {oa}; market favors {side}.', '배당 승 {oh} / 패 {oa}, 시장은 {side} 우세를 반영.', 'オッズ 勝 {oh} / 負 {oa}、市場は {side} 優勢。', '赔率 胜 {oh} / 负 {oa}，市场看好 {side}。', 'Cuotas: gana {oh} / pierde {oa}; el mercado favorece a {side}.', 'ऑड्स: जीत {oh} / हार {oa}; बाज़ार {side} के पक्ष में।', 'Tỷ lệ: thắng {oh} / thua {oa}; thị trường nghiêng về {side}.', 'อัตราต่อรอง: ชนะ {oh} / แพ้ {oa} ตลาดเอียงไป {side}', 'Ставки: победа {oh} / поражение {oa}; рынок за {side}.', 'Quoten: Sieg {oh} / Niederlage {oa}; Markt für {side}.', 'Cotes : victoire {oh} / défaite {oa} ; marché pour {side}.', 'Quote: vittoria {oh} / sconfitta {oa}; mercato per {side}.'],
  sumFinal: ['Final {h}:{a} — {result}.', '최종 {h}:{a}, {result}.', '最終 {h}:{a}、{result}。', '终场 {h}:{a}，{result}。', 'Final {h}:{a} — {result}.', 'अंतिम {h}:{a} — {result}।', 'Chung cuộc {h}:{a} — {result}.', 'จบเกม {h}:{a} — {result}', 'Итог {h}:{a} — {result}.', 'Endstand {h}:{a} — {result}.', 'Score final {h}:{a} — {result}.', 'Finale {h}:{a} — {result}.'],
  resultDraw: ['draw', '무승부', '引き分け', '平局', 'empate', 'ड्रॉ', 'hòa', 'เสมอ', 'ничья', 'Unentschieden', 'match nul', 'pareggio'],
  resultWin: ['{lead} win', '{lead} 승리', '{lead} の勝利', '{lead} 获胜', 'victoria de {lead}', '{lead} की जीत', '{lead} thắng', '{lead} ชนะ', 'победа {lead}', '{lead} Sieg', 'victoire de {lead}', 'vittoria di {lead}'],
  sumCont: ['Still anyone’s game — worth watching. (auto-updates ~15s)', '남은 시간 변수로 흐름이 바뀔 수 있어 끝까지 볼 만해요. (약 15초 자동 갱신)', '残り時間で流れは変わり得ます。最後まで注目。（約15秒更新）', '剩余时间仍有变数，值得看到最后。（约15秒更新）', 'Aún puede cambiar; vale la pena verlo. (~15s)', 'अभी कुछ भी हो सकता है, अंत तक देखें। (~15s)', 'Vẫn khó lường, đáng xem đến cuối. (~15s)', 'ยังพลิกได้ ควรดูจนจบ (~15 วิ)', 'Всё ещё может измениться. (~15с)', 'Noch offen — dranbleiben. (~15s)', 'Tout reste possible, à suivre. (~15s)', 'Ancora tutto aperto, da seguire. (~15s)'],
  evScore: ['Score! {team} ({h}:{a})', '득점! {team} ({h}:{a})', '得点！{team}（{h}:{a}）', '得分！{team}（{h}:{a}）', '¡Anota! {team} ({h}:{a})', 'स्कोर! {team} ({h}:{a})', 'Ghi điểm! {team} ({h}:{a})', 'ได้แต้ม! {team} ({h}:{a})', 'Очко! {team} ({h}:{a})', 'Punkt! {team} ({h}:{a})', 'But ! {team} ({h}:{a})', 'Punto! {team} ({h}:{a})'],
  evHit: ['Hit! {team} (total {n})', '안타! {team} (누적 {n})', '安打！{team}（計 {n}）', '安打！{team}（累计 {n}）', '¡Hit! {team} (total {n})', 'हिट! {team} (कुल {n})', 'Hit! {team} (tổng {n})', 'ฮิต! {team} (รวม {n})', 'Хит! {team} (всего {n})', 'Hit! {team} (gesamt {n})', 'Coup ! {team} (total {n})', 'Valida! {team} (tot {n})'],
  evError: ['Error {team} ({n})', '실책 {team} ({n})', '失策 {team}（{n}）', '失误 {team}（{n}）', 'Error {team} ({n})', 'एरर {team} ({n})', 'Lỗi {team} ({n})', 'เออเรอร์ {team} ({n})', 'Ошибка {team} ({n})', 'Fehler {team} ({n})', 'Erreur {team} ({n})', 'Errore {team} ({n})'],
  evInnStart: ['Start of {x}', '{x} 시작', '{x} 開始', '{x} 开始', 'Comienza {x}', '{x} शुरू', 'Bắt đầu {x}', 'เริ่ม {x}', 'Начало {x}', '{x} beginnt', 'Début {x}', 'Inizio {x}'],
  evOut: ['Out — {team} {n} out(s)', '아웃! {team} 공격 · {n}아웃', 'アウト！{team} {n}アウト', '出局！{team} {n}出局', 'Out — {team} {n}', 'आउट! {team} {n}', 'Out! {team} {n}', 'เอาต์! {team} {n}', 'Аут! {team} {n}', 'Aus! {team} {n}', 'Retrait ! {team} {n}', 'Out! {team} {n}'],
  evRun: ['Runner on base — {team}', '출루! {team}', '出塁！{team}', '上垒！{team}', 'En base — {team}', 'बेस पर {team}', 'Lên base {team}', 'ขึ้นเบส {team}', 'На базе {team}', 'Auf Base {team}', 'Sur base {team}', 'In base {team}'],
  battingNow: ['batting', '공격 중', '攻撃中', '进攻中', 'al bate', 'बल्लेबाजी', 'đang tấn công', 'กำลังรุก', 'атакует', 'am Schlag', 'à l’attaque', 'in attacco'],
  liveSitu: ['Live situation', '현재 상황', '現在の状況', '当前局面', 'Situación', 'लाइव स्थिति', 'Tình huống', 'สถานการณ์', 'Ситуация', 'Situation', 'Situation', 'Situazione'],
  liveCast: ['LIVE UP Cast', 'LIVE UP 중계', 'LIVE UP実況', 'LIVE UP解说', 'Narración LIVE UP', 'LIVE UP कमेंट्री', 'Tường thuật LIVE UP', 'ถ่ายทอด LIVE UP', 'Трансляция LIVE UP', 'LIVE UP-Ticker', 'Live LIVE UP', 'Cronaca LIVE UP'],
  fbFirst: ['1st Half', '전반', '前半', '上半场'],
  fbSecond: ['2nd Half', '후반', '後半', '下半场'],
  fbET: ['Extra Time', '연장', '延長', '加时'],
  recRuns: ['{team} scored {n}', '{team} {n}득점', '{team} {n}得点', '{team} {n}得分'],
  recZero: ['No runs', '무득점', '無得点', '无得分'],
  recWait: ['No records for this inning yet', '이 이닝 기록이 아직 없어요', 'この回の記録はまだありません', '暂无本局记录'],
  castIntro: ['Live cast recap — {h} vs {a}', '실시간 중계 요약 — {h} vs {a}', '実況まとめ — {h} vs {a}', '解说回顾 — {h} vs {a}'],
  castInn: ['{x} · {team} scored {n}', '{x} · {team} {n}득점', '{x} · {team} {n}得点', '{x} · {team} {n}得分'],
  castCurBB: ['Now {x} · {h} {hs}:{as} {a}', '현재 {x} · {h} {hs}:{as} {a}', '現在 {x} · {h} {hs}:{as} {a}', '当前 {x} · {h} {hs}:{as} {a}'],
  castCurFB: ['Now {min} · {h} {hs}:{as} {a}', '현재 {min} · {h} {hs}:{as} {a}', '現在 {min} · {h} {hs}:{as} {a}', '当前 {min} · {h} {hs}:{as} {a}'],
  pitchU: [' P', '구', '球', '球'],
  starter: ['SP', '선발', '先発', '先发'],
  starterTBD: ['SP TBD', '선발 미정', '先発未定', '先发未定'],
  eraShort: ['ERA', '방어율', '防御率', '防御率'],
  pbLegend: ['B=Ball  S=Strike  F=Foul  ●=In play', 'B=볼  S=스트라이크  F=파울  ●=인플레이', 'B=ボール S=ストライク F=ファウル ●=インプレー', 'B=坏球 S=好球 F=界外 ●=击球'],
  nowBatting: ['Now batting', '타격 중', '攻撃中', '进攻中', 'Al bate', 'बल्लेबाजी', 'Đang tấn công', 'กำลังตี', 'Атака', 'Am Schlag', 'À la batte', 'In battuta'],
  homeTab: ['Home', '홈', 'ホーム', '主页', 'Inicio', 'होम', 'Trang chủ', 'หน้าแรก', 'Главная', 'Start', 'Accueil', 'Home'],
  myTeams: ['My Teams', '내 관심팀', 'マイチーム', '我的球队', 'Mis equipos', 'मेरी टीमें', 'Đội của tôi', 'ทีมของฉัน', 'Мои команды', 'Meine Teams', 'Mes équipes', 'Le mie squadre'],
  hotGames: ['Hot now', '지금 뜨거운 경기', '注目の試合', '热门比赛', 'En directo', 'हॉट मैच', 'Trận nóng', 'แมตช์ร้อน', 'Топ матчи', 'Heiße Spiele', 'Matchs chauds', 'Match caldi'],
  todayPick: ["Today's PICK", '오늘의 PICK', '今日のPICK', '今日推荐', 'PICK de hoy', 'आज का PICK', 'PICK hôm nay', 'PICK วันนี้', 'PICK дня', 'PICK heute', 'PICK du jour', 'PICK di oggi'],
  keyGames: ["Today's games", '오늘의 주요 경기', '今日の主な試合', '今日主要比赛', 'Partidos de hoy', 'आज के मैच', 'Trận hôm nay', 'แมตช์วันนี้', 'Матчи дня', 'Spiele heute', 'Matchs du jour', 'Partite di oggi'],
  aiOneLine: ['AI LIVE', 'AI LIVE 한줄 해설', 'AI LIVE 速報', 'AI LIVE 解说', 'AI LIVE', 'AI LIVE', 'AI LIVE', 'AI LIVE', 'AI LIVE', 'AI LIVE', 'AI LIVE', 'AI LIVE'],
  noFavHint: ['Tap the 🔔 bell on a game to add favorites', '경기의 🔔 종을 눌러 관심팀을 추가하세요', '試合の🔔でお気に入り追加', '点击🔔添加关注', 'Toca 🔔 para añadir', '🔔 दबाकर जोड़ें', 'Nhấn 🔔 để thêm', 'แตะ 🔔 เพื่อเพิ่ม', 'Нажмите 🔔', 'Mit 🔔 hinzufügen', 'Touchez 🔔', 'Tocca 🔔'],
  pickDetail: ['View analysis', '상세 분석 보기', '詳細分析', '查看分析', 'Ver análisis', 'विश्लेषण देखें', 'Xem phân tích', 'ดูวิเคราะห์', 'Смотреть анализ', 'Analyse ansehen', "Voir l'analyse", 'Vedi analisi'],
  showMore: ['Show earlier', '이전 이벤트 더보기', '前の速報', '查看更早', 'Ver más', 'और देखें', 'Xem thêm', 'ดูเพิ่ม', 'Ещё', 'Mehr anzeigen', 'Voir plus', 'Mostra altro'],
  showLess: ['Collapse', '접기', '閉じる', '收起', 'Contraer', 'छिपाएं', 'Thu gọn', 'ย่อ', 'Свернуть', 'Einklappen', 'Réduire', 'Comprimi'],
  evSet: ['Current set {s}', '현재 세트 {s}', '現在のセット {s}', '当前局 {s}', 'Set actual {s}', 'वर्तमान सेट {s}', 'Set hiện tại {s}', 'เซ็ตปัจจุบัน {s}', 'Текущий сет {s}', 'Aktueller Satz {s}', 'Set actuel {s}', 'Set attuale {s}'],
  fbGoal: ['Goal!', '골!', 'ゴール！', '进球！', '¡Gol!', 'गोल!', 'Bàn thắng!', 'ประตู!', 'Гол!', 'Tor!', 'But !', 'Gol!'],
  fbOwn: ['Own goal', '자책골', 'オウンゴール', '乌龙球', 'Autogol', 'आत्मघाती गोल', 'Phản lưới', 'ทำเข้าประตูตัวเอง', 'Автогол', 'Eigentor', 'But c.s.c.', 'Autogol'],
  fbPk: ['Penalty goal!', 'PK 골!', 'PKゴール！', '点球得分！', '¡Gol de penalti!', 'पेनल्टी गोल!', 'Bàn phạt đền!', 'จุดโทษ!', 'Гол с пенальти!', 'Elfmetertor!', 'But sur penalty !', 'Gol su rigore!'],
  fbRed: ['Red card!', '퇴장!', '退場！', '红牌！', '¡Roja!', 'लाल कार्ड!', 'Thẻ đỏ!', 'ใบแดง!', 'Красная!', 'Rote Karte!', 'Carton rouge !', 'Rosso!'],
  fbYellow: ['Yellow card', '경고', '警告', '黄牌', 'Amarilla', 'पीला कार्ड', 'Thẻ vàng', 'ใบเหลือง', 'Жёлтая', 'Gelbe Karte', 'Carton jaune', 'Giallo'],
  fbSub: ['Substitution', '교체', '交代', '换人', 'Cambio', 'बदलाव', 'Thay người', 'เปลี่ยนตัว', 'Замена', 'Wechsel', 'Remplacement', 'Sostituzione'],
  fbAssist: ['assist', '도움', 'アシスト', '助攻', 'asist.', 'असिस्ट', 'kiến tạo', 'แอสซิสต์', 'пас', 'Vorlage', 'passe déc.', 'assist'],
  ansTag: ['Pick', '답', '予想', '推荐', 'Pick', 'पिक', 'Chọn', 'พิค', 'Прогноз', 'Tipp', 'Pari', 'Scelta'],
  over: ['Over', '오버', 'オーバー', '大', 'Over', 'ओवर', 'Tài', 'สูง', 'Больше', 'Über', 'Plus', 'Over'],
  under: ['Under', '언더', 'アンダー', '小', 'Under', 'अंडर', 'Xỉu', 'ต่ำ', 'Меньше', 'Unter', 'Moins', 'Under'],
  handi: ['Handicap', '핸디', 'ハンデ', '让分', 'Hándicap', 'हैंडिकैप', 'Chấp', 'แฮนดิแคป', 'Фора', 'Handicap', 'Handicap', 'Handicap'],
  // ── 알림/즐겨찾기 ──
  notifTitle: ['Notifications', '알림 설정', '通知設定', '通知设置', 'Notificaciones', 'सूचनाएं', 'Thông báo', 'การแจ้งเตือน', 'Уведомления', 'Benachrichtigungen', 'Notifications', 'Notifiche'],
  notifBtn: ['Alerts', '알림', '通知', '通知', 'Alertas', 'अलर्ट', 'Thông báo', 'แจ้งเตือน', 'Уведомл.', 'Alarme', 'Alertes', 'Avvisi'],
  notifEnable: ['Enable notifications', '알림 켜기', '通知をオン', '开启通知', 'Activar notificaciones', 'सूचनाएं चालू करें', 'Bật thông báo', 'เปิดการแจ้งเตือน', 'Включить', 'Aktivieren', 'Activer', 'Attiva'],
  notifPerm: ['Allow browser notifications to get alerts.', '알림을 받으려면 브라우저 권한을 허용하세요.', '通知許可が必要です。', '需要浏览器通知权限。', 'Permite las notificaciones del navegador.', 'ब्राउज़र सूचना अनुमति दें।', 'Cần cấp quyền thông báo trình duyệt.', 'ต้องอนุญาตการแจ้งเตือนเบราว์เซอร์', 'Разрешите уведомления браузера.', 'Browser-Benachrichtigungen erlauben.', 'Autorisez les notifications du navigateur.', 'Consenti le notifiche del browser.'],
  favTeams: ['Favorite teams', '관심팀', 'お気に入りチーム', '关注球队', 'Equipos favoritos', 'पसंदीदा टीमें', 'Đội yêu thích', 'ทีมโปรด', 'Избранные', 'Lieblingsteams', 'Équipes favorites', 'Squadre preferite'],
  noFav: ['No favorites yet — tap ☆ on a match.', '관심팀이 없어요. 경기의 ☆를 눌러 추가하세요.', 'お気に入りなし。試合の☆をタップ。', '暂无关注，点击比赛的☆添加。', 'Sin favoritos — toca ☆ en un partido.', 'कोई पसंदीदा नहीं — मैच पर ☆ दबाएं।', 'Chưa có — chạm ☆ trên trận đấu.', 'ยังไม่มี — แตะ ☆ ที่แมตช์', 'Пока пусто — нажмите ☆.', 'Noch keine — ☆ antippen.', 'Aucun — touchez ☆.', 'Nessuna — tocca ☆.'],
  evtStart: ['Match start', '경기 시작', '試合開始', '比赛开始', 'Inicio del partido', 'मैच शुरू', 'Bắt đầu trận', 'เริ่มแข่ง', 'Начало матча', 'Spielbeginn', 'Coup d’envoi', 'Inizio partita'],
  evtLineup: ['Lineups announced', '라인업 발표', 'スタメン発表', '首发公布', 'Alineaciones', 'लाइनअप घोषित', 'Đội hình ra sân', 'ประกาศตัวจริง', 'Составы', 'Aufstellungen', 'Compositions', 'Formazioni'],
  evtScore: ['Score', '득점', '得点', '得分', 'Gol/Anotación', 'स्कोर', 'Ghi điểm', 'ทำแต้ม', 'Гол/очко', 'Tor/Punkt', 'But/point', 'Gol/punto'],
  evtHR: ['Home run', '홈런', '本塁打', '全垒打', 'Home run', 'होम रन', 'Home run', 'โฮมรัน', 'Хоумран', 'Homerun', 'Home run', 'Fuoricampo'],
  evtRed: ['Red card / Ejection', '퇴장', '退場', '罚下', 'Expulsión', 'रेड कार्ड', 'Thẻ đỏ', 'ใบแดง', 'Удаление', 'Platzverweis', 'Expulsion', 'Espulsione'],
  evtFinish: ['Full time', '경기 종료', '試合終了', '比赛结束', 'Final', 'समाप्त', 'Kết thúc', 'จบเกม', 'Матч окончен', 'Spielende', 'Fin du match', 'Fine partita'],
  notifClosedNote: ['Alerts work while the app is open. Push when fully closed needs a paid server setup.', '알림은 앱이 열려 있을 때 동작해요. 완전히 닫힌 상태의 푸시는 별도 서버 작업이 필요해요.', 'アプリ起動中に動作します。完全終了時のプッシュは別途サーバーが必要。', '应用打开时有效。完全关闭的推送需服务器配置。', 'Funcionan con la app abierta. Push cerrada requiere servidor.', 'ऐप खुली होने पर काम करता है।', 'Hoạt động khi mở app. Push khi đóng cần máy chủ.', 'ทำงานเมื่อเปิดแอป', 'Работает при открытом приложении.', 'Funktioniert bei geöffneter App.', 'Fonctionne app ouverte.', 'Funziona ad app aperta.'],
  save: ['Save', '저장', '保存', '保存', 'Guardar', 'सहेजें', 'Lưu', 'บันทึก', 'Сохранить', 'Speichern', 'Enregistrer', 'Salva'],
  // 종목명 (키 = SPORTS.key)
  football: ['Soccer', '축구', 'サッカー', '足球', 'Fútbol', 'फुटबॉल', 'Bóng đá', 'ฟุตบอล', 'Футбол', 'Fußball', 'Football', 'Calcio'],
  baseball: ['Baseball', '야구', '野球', '棒球', 'Béisbol', 'बेसबॉल', 'Bóng chày', 'เบสบอล', 'Бейсбол', 'Baseball', 'Baseball', 'Baseball'],
  basketball: ['Basketball', '농구', 'バスケ', '篮球', 'Baloncesto', 'बास्केटबॉल', 'Bóng rổ', 'บาสเกตบอล', 'Баскетбол', 'Basketball', 'Basket', 'Basket'],
  volleyball: ['Volleyball', '배구', 'バレー', '排球', 'Voleibol', 'वॉलीबॉल', 'Bóng chuyền', 'วอลเลย์บอล', 'Волейбол', 'Volleyball', 'Volley', 'Pallavolo'],
  hockey: ['Hockey', '하키', 'ホッケー', '冰球', 'Hockey', 'हॉकी', 'Khúc côn cầu', 'ฮอกกี้', 'Хоккей', 'Hockey', 'Hockey', 'Hockey'],
  handball: ['Handball', '핸드볼', 'ハンド', '手球', 'Balonmano', 'हैंडबॉल', 'Bóng ném', 'แฮนด์บอล', 'Гандбол', 'Handball', 'Handball', 'Pallamano'],
  rugby: ['Rugby', '럭비', 'ラグビー', '橄榄球', 'Rugby', 'रग्बी', 'Bóng bầu dục', 'รักบี้', 'Регби', 'Rugby', 'Rugby', 'Rugby']
};
let LANG = (function () { try { return localStorage.getItem('liveup_lang') || 'en'; } catch (e) { return 'en'; } })();
function t(key) { const a = STR[key]; if (!a) return key; const i = LANGS.indexOf(LANG); return a[i] || a[0]; }
// 템플릿 문장 치환: ai('aiLead', {st,lead,d,h,a}) → 선택 언어 문장
function ai(key, v) { let s = t(key); if (v) for (const k in v) s = s.split('{' + k + '}').join(v[k]); return s; }
function applyI18n() {
  document.documentElement.lang = LANG;
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
}
function setLang(l) {
  LANG = l; try { localStorage.setItem('liveup_lang', l); } catch (e) {}
  applyI18n();
  if (typeof buildSportNav === 'function') buildSportNav();
  if (typeof loadEvents === 'function' && $('#view-live') && !$('#view-live').classList.contains('hidden')) loadEvents();
  if (typeof renderInfoList === 'function' && $('#view-info') && !$('#view-info').classList.contains('hidden')) renderInfoList();
  if (typeof refreshDateLabel === 'function') refreshDateLabel();
  if (typeof initGIS === 'function') { try { initGIS(); } catch { } }   // 구글 버튼 언어 다시 반영
  if (typeof renderAuthUI === 'function') renderAuthUI();   // 로그인/로그아웃 라벨 언어 반영
}

// ============================================================
//  팀 이름 번역 (MLB·NPB·KBO·LMB · CJK) · 그 외 언어/리그는 영문 원문 유지
//  key = 닉네임(마지막 단어, Sox/Jays 예외) → { ko, ja, zh }  · 리그별 사전으로 충돌 방지
// ============================================================
const MLB_TEAMS = {
  'diamondbacks': { ko: '애리조나', ja: 'アリゾナ', zh: '亚利桑那' },
  'braves': { ko: '애틀랜타', ja: 'アトランタ', zh: '亚特兰大' },
  'orioles': { ko: '볼티모어', ja: 'ボルチモア', zh: '巴尔的摩' },
  'red sox': { ko: '보스턴', ja: 'ボストン', zh: '波士顿红袜' },
  'cubs': { ko: '시카고 컵스', ja: 'カブス', zh: '芝加哥小熊' },
  'white sox': { ko: '시카고 화이트삭스', ja: 'ホワイトソックス', zh: '芝加哥白袜' },
  'reds': { ko: '신시내티', ja: 'シンシナティ', zh: '辛辛那提' },
  'guardians': { ko: '클리블랜드', ja: 'クリーブランド', zh: '克利夫兰' },
  'rockies': { ko: '콜로라도', ja: 'コロラド', zh: '科罗拉多' },
  'tigers': { ko: '디트로이트', ja: 'デトロイト', zh: '底特律' },
  'astros': { ko: '휴스턴', ja: 'ヒューストン', zh: '休斯顿' },
  'royals': { ko: '캔자스시티', ja: 'カンザスシティ', zh: '堪萨斯城' },
  'angels': { ko: 'LA 에인절스', ja: 'エンゼルス', zh: '洛杉矶天使' },
  'dodgers': { ko: 'LA 다저스', ja: 'ドジャース', zh: '洛杉矶道奇' },
  'marlins': { ko: '마이애미', ja: 'マイアミ', zh: '迈阿密' },
  'brewers': { ko: '밀워키', ja: 'ミルウォーキー', zh: '密尔沃基' },
  'twins': { ko: '미네소타', ja: 'ミネソタ', zh: '明尼苏达' },
  'mets': { ko: '뉴욕 메츠', ja: 'メッツ', zh: '纽约大都会' },
  'yankees': { ko: '뉴욕 양키스', ja: 'ヤンキース', zh: '纽约洋基' },
  'athletics': { ko: '애슬레틱스', ja: 'アスレチックス', zh: '运动家' },
  'phillies': { ko: '필라델피아', ja: 'フィリーズ', zh: '费城' },
  'pirates': { ko: '피츠버그', ja: 'パイレーツ', zh: '匹兹堡' },
  'padres': { ko: '샌디에이고', ja: 'パドレス', zh: '圣地亚哥' },
  'giants': { ko: '샌프란시스코', ja: 'ジャイアンツ', zh: '旧金山巨人' },
  'mariners': { ko: '시애틀', ja: 'マリナーズ', zh: '西雅图水手' },
  'cardinals': { ko: '세인트루이스', ja: 'カージナルス', zh: '圣路易斯红雀' },
  'rays': { ko: '탬파베이', ja: 'レイズ', zh: '坦帕湾光芒' },
  'rangers': { ko: '텍사스', ja: 'レンジャーズ', zh: '德州游骑兵' },
  'blue jays': { ko: '토론토', ja: 'ブルージェイズ', zh: '多伦多蓝鸟' },
  'nationals': { ko: '워싱턴', ja: 'ナショナルズ', zh: '华盛顿国民' }
};
// 일본프로야구(NPB) 12팀 — key = 닉네임(마지막 단어)
const NPB_TEAMS = {
  'eagles': { ko: '라쿠텐', ja: '楽天', zh: '乐天' },
  'buffaloes': { ko: '오릭스', ja: 'オリックス', zh: '欧力士' },
  'giants': { ko: '요미우리', ja: '巨人', zh: '读卖巨人' },
  'tigers': { ko: '한신', ja: '阪神', zh: '阪神' },
  'carp': { ko: '히로시마', ja: '広島', zh: '广岛' },
  'swallows': { ko: '야쿠르트', ja: 'ヤクルト', zh: '养乐多' },
  'baystars': { ko: '요코하마', ja: '横浜', zh: '横滨' },
  'dragons': { ko: '주니치', ja: '中日', zh: '中日' },
  'hawks': { ko: '소프트뱅크', ja: 'ソフトバンク', zh: '软银' },
  'lions': { ko: '세이부', ja: '西武', zh: '西武' },
  'marines': { ko: '롯데', ja: 'ロッテ', zh: '罗德' },
  'fighters': { ko: '니혼햄', ja: '日本ハム', zh: '日本火腿' }
};
// 한국프로야구(KBO) 10팀
const KBO_TEAMS = {
  'bears': { ko: '두산', ja: '斗山', zh: '斗山' },
  'twins': { ko: 'LG', ja: 'LG', zh: 'LG' },
  'tigers': { ko: 'KIA', ja: 'KIA', zh: '起亚' },
  'lions': { ko: '삼성', ja: 'サムスン', zh: '三星' },
  'giants': { ko: '롯데', ja: 'ロッテ', zh: '乐天巨人' },
  'eagles': { ko: '한화', ja: 'ハンファ', zh: '韩华' },
  'landers': { ko: 'SSG', ja: 'SSG', zh: 'SSG' },
  'wiz': { ko: 'KT', ja: 'KT', zh: 'KT' },
  'heroes': { ko: '키움', ja: 'キウム', zh: '英雄' },
  'dinos': { ko: 'NC', ja: 'NC', zh: 'NC' }
};
// 멕시코리그(LMB) — 도시/닉네임 표기 혼용 → 둘 다 키로 (음차)
const LMB_TEAMS = {
  'rojos': { ko: '디아블로스', ja: 'ディアブロス', zh: '红魔' },
  'diablos': { ko: '디아블로스', ja: 'ディアブロス', zh: '红魔' },
  'oaxaca': { ko: '오아하카', ja: 'オアハカ', zh: '瓦哈卡' },
  'guerreros': { ko: '오아하카', ja: 'オアハカ', zh: '瓦哈卡' },
  'campeche': { ko: '캄페체', ja: 'カンペチェ', zh: '坎佩切' },
  'queretaro': { ko: '케레타로', ja: 'ケレタロ', zh: '克雷塔罗' },
  'sultanes': { ko: '몬테레이', ja: 'モンテレイ', zh: '蒙特雷' },
  'monterrey': { ko: '몬테레이', ja: 'モンテレイ', zh: '蒙特雷' },
  'acereros': { ko: '몬클로바', ja: 'モンクロバ', zh: '蒙克洛瓦' },
  'toros': { ko: '티후아나', ja: 'ティフアナ', zh: '蒂华纳' },
  'tijuana': { ko: '티후아나', ja: 'ティフアナ', zh: '蒂华纳' },
  'pericos': { ko: '푸에블라', ja: 'プエブラ', zh: '普埃布拉' },
  'leones': { ko: '유카탄', ja: 'ユカタン', zh: '尤卡坦' },
  'tigres': { ko: '킨타나로오', ja: 'キンタナロー', zh: '金塔纳罗奥' },
  'rieleros': { ko: '아과스칼리엔테스', ja: 'アグアスカリエンテス', zh: '阿瓜斯卡连特斯' },
  'saraperos': { ko: '살티요', ja: 'サルティージョ', zh: '萨尔蒂略' },
  'algodoneros': { ko: '우니온라구나', ja: 'ウニオンラグナ', zh: '拉古纳联合' },
  'olmecas': { ko: '타바스코', ja: 'タバスコ', zh: '塔巴斯科' },
  'generales': { ko: '두랑고', ja: 'ドゥランゴ', zh: '杜兰戈' },
  'mariachis': { ko: '과달라하라', ja: 'グアダラハラ', zh: '瓜达拉哈拉' },
  'dorados': { ko: '치와와', ja: 'チワワ', zh: '奇瓦瓦' },
  'bravos': { ko: '레온', ja: 'レオン', zh: '莱昂' }
};
function tmNick(s) {
  const w = String(s || '').toLowerCase().replace(/[.]/g, '').trim().split(/\s+/);
  const last2 = w.slice(-2).join(' ');
  if (['red sox', 'white sox', 'blue jays'].includes(last2)) return last2;
  return w[w.length - 1] || '';
}
function leagueDict(league) {
  if (league === 'NPB') return NPB_TEAMS;
  if (league === 'KBO') return KBO_TEAMS;
  if (league === 'LMB') return LMB_TEAMS;
  return MLB_TEAMS;   // MLB·IL·PCL(미국) 및 기본
}
// 표시용 팀명: CJK 언어에서만, 리그별 사전 매칭 → 없으면 원문 유지
function TN(name, league) {
  if (!name || (LANG !== 'ko' && LANG !== 'ja' && LANG !== 'zh')) return name;
  const d = leagueDict(league);
  const nick = tmNick(name);
  let e = d[nick] || d[String(name).toLowerCase()];
  if (!e && d !== MLB_TEAMS) e = MLB_TEAMS[nick];   // 미국팀 섞여 나올 때 대비
  return (e && e[LANG]) ? e[LANG] : name;
}
// MLB StatsAPI 선수 얼굴 (없으면 generic 실루엣 자동 반환)
function mlbFace(id) {
  return id ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${encodeURIComponent(id)}/headshot/67/current` : '';
}
// API-Football 선수 얼굴 (media.api-sports.io) — 없으면 onerror로 등번호 폴백
function footFace(id) {
  return id ? `https://media.api-sports.io/football/players/${encodeURIComponent(id)}.png` : '';
}
// 야구 기록 표 헤더 라벨 — CJK는 현지어, 그 외 언어는 국제 표준 약어(AB/H/HR…)
const STAT_LBL = {
  batter: { en: 'Batter', ko: '타자', ja: '打者', zh: '打者' },
  pitcher: { en: 'Pitcher', ko: '투수', ja: '投手', zh: '投手' },
  ab: { en: 'AB', ko: '타수', ja: '打数', zh: '打数' },
  h: { en: 'H', ko: '안타', ja: '安打', zh: '安打' },
  bb: { en: 'BB', ko: 'BB', ja: '四球', zh: '保送' },
  rbi: { en: 'RBI', ko: '타점', ja: '打点', zh: '打点' },
  hr: { en: 'HR', ko: 'HR', ja: '本塁打', zh: '全垒打' },
  k: { en: 'K', ko: 'K', ja: '三振', zh: '三振' },
  ip: { en: 'IP', ko: '이닝', ja: '回', zh: '局' },
  np: { en: 'NP', ko: '투구', ja: '球数', zh: '投球' },
  ha: { en: 'H', ko: '피안타', ja: '被安打', zh: '被安打' },
  er: { en: 'ER', ko: '자책', ja: '自責', zh: '自责' },
  era: { en: 'ERA', ko: '방어율', ja: '防御率', zh: '防御率' },
  avg: { en: 'AVG', ko: '타율', ja: '打率', zh: '打率' },
  g: { en: 'G', ko: '경기', ja: '試合', zh: '场次' },
  w: { en: 'W', ko: '승', ja: '勝', zh: '胜' },
  l: { en: 'L', ko: '패', ja: '負', zh: '负' },
  sv: { en: 'SV', ko: '세', ja: 'S', zh: '救' },
  pos: { en: 'Pos', ko: '포지션', ja: '守備', zh: '位置' },
  team: { en: 'Team', ko: '팀', ja: 'チーム', zh: '球队' },
  pct: { en: 'PCT', ko: '승률', ja: '勝率', zh: '胜率' },
  rs: { en: 'RS', ko: '득점', ja: '得点', zh: '得分' },
  ra: { en: 'RA', ko: '실점', ja: '失点', zh: '失分' },
  streak: { en: 'STRK', ko: '연속', ja: '連続', zh: '连续' },
  date: { en: 'Date', ko: '날짜', ja: '日付', zh: '日期' },
  opp: { en: 'Opp', ko: '상대', ja: '相手', zh: '对手' }
};
function sl(key) { const e = STAT_LBL[key]; if (!e) return key; return (LANG === 'ko' || LANG === 'ja' || LANG === 'zh') ? (e[LANG] || e.en) : e.en; }
// 이닝 표기 (3회초 / Top 3 / 3回表 / 3局上)
function inningLabel(inn, half) {
  const top = half === 'top', bot = half === 'bottom';
  if (LANG === 'ko') return `${inn}회${top ? '초' : bot ? '말' : ''}`;
  if (LANG === 'ja') return `${inn}回${top ? '表' : bot ? '裏' : ''}`;
  if (LANG === 'zh') return `${inn}局${top ? '上' : bot ? '下' : ''}`;
  return `${top ? 'Top ' : bot ? 'Bot ' : ''}${inn}`;
}
// 쿼터/세트/피리어드 표기
function periodLabel(n, kind) {
  if (LANG === 'ko') return `${n}${kind === 'set' ? '세트' : kind === 'period' ? '피리어드' : '쿼터'}`;
  if (LANG === 'ja') return `${n}${kind === 'set' ? 'セット' : kind === 'period' ? 'ピリオド' : 'Q'}`;
  if (LANG === 'zh') return `第${n}${kind === 'set' ? '局' : kind === 'period' ? '节' : '节'}`;
  return `${kind === 'set' ? 'Set ' : kind === 'period' ? 'P' : 'Q'}${n}`;
}

// API-Sports 종목 (키 = 서버 /api/asports/games?sport=)
const SPORTS = [
  { key: 'football', ko: '축구', em: '⚽' },
  { key: 'baseball', ko: '야구', em: '⚾' },
  { key: 'basketball', ko: '농구', em: '🏀' },
  { key: 'volleyball', ko: '배구', em: '🏐' },
  { key: 'hockey', ko: '하키', em: '🏒' },
  { key: 'handball', ko: '핸드볼', em: '🤾' },
  { key: 'rugby', ko: '럭비', em: '🏉' }
];
// 주요 리그 우선 정렬 (이 리그들을 상단에)
const TOP_LEAGUES = ['KBO', 'MLB', 'NPB', 'K League 1', 'K League 2', 'J1 League', 'J League', 'J2 League', 'WK-League', 'AFC Champions League', 'AFC Champions League Elite', 'Korea Cup', "Emperor's Cup", 'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'NBA', 'WNBA', 'KBL', 'CPBL', 'NHL', 'UEFA Champions League', 'UEFA Europa League'];
// MLB StatsAPI(무료)로 라인업·투수/타자·최근경기까지 되는 야구 리그
const STATS_LEAGUES = ['MLB', 'LMB', 'IL', 'PCL'];
function statsLeague(lg) { return STATS_LEAGUES.includes(lg); }

// 로컬(브라우저 시간대) 기준 YYYY-MM-DD — UTC 날짜 버그 방지
function localYMD(d = new Date()) { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 10); }
// 사용자 시간대 (예: Asia/Seoul, Asia/Ho_Chi_Minh, America/New_York)
const USER_TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'; } catch (e) { return 'Asia/Seoul'; } })();
const state = {
  date: localYMD(),
  dateAuto: true,      // '오늘'을 자동으로 따라감(자정 지나면 새 날짜로 롤오버). 사용자가 특정 날짜 고르면 false
  sport: 'baseball',   // 여름철 진행 종목 기본
  leagues: [],
  leagueFilter: 'all'  // 상단 리그 선택 필터
};
// 🗓️ 자정 지나면 '오늘' 날짜로 자동 전환 (앱을 열어둔 채 날짜가 바뀌어도 오늘 경기가 보이도록)
function autoRollDate() {
  if (!state.dateAuto) return false;
  const today = localYMD();
  if (state.date !== today) {
    state.date = today;
    const dp = $('#datePick'); if (dp) dp.value = today;
    if (typeof refreshDateLabel === 'function') refreshDateLabel();
    return true;
  }
  return false;
}

// ---------- 팀 뱃지/엠블럼 ----------
function badge(url, fallback) {
  return url
    ? `<img src="${esc(url)}" onerror="this.replaceWith(document.createTextNode('${fallback}'))" alt="">`
    : fallback;
}

// ============================================================
//  탭 전환
// ============================================================
const views = { home: 'view-home', live: 'view-live', table: 'view-table', odds: 'view-odds', info: 'view-info', comm: 'view-comm', board: 'view-board' };
function setTab(t) {
  Object.values(views).forEach(id => $('#' + id)?.classList.add('hidden'));
  $('#' + views[t])?.classList.remove('hidden');
  $$('.topbar .tt[data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  $$('.topnav a[data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  $$('.dmenu a[data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  if (t === 'table' && !$('#tblLeague').options.length) buildTableControls();
  if (t === 'board') loadPosts();
  if (t === 'odds') initOdds();
  if (t === 'info') { initInfo(); updateInfoGate(); }
  if (t === 'home') renderHome();
  // 홈/라이브가 아닌 화면에선 상단 날짜·종목바 등을 숨김 처리(notlive)
  $('.center')?.classList.toggle('notlive', t !== 'live');
  $('.center')?.classList.toggle('homeview', t === 'home');
  window.scrollTo({ top: 0 });
}
// 🔒 경기 정보방 로그인 게이트: 비로그인 시 목록 블러 + 안내 오버레이
function updateInfoGate() {
  const wrap = $('#view-info'); const gate = $('#infoGate'); if (!wrap || !gate) return;
  if (loggedIn) { wrap.classList.remove('gated'); gate.classList.add('hidden'); }
  else { wrap.classList.add('gated'); gate.classList.remove('hidden'); }
}
// ============================================================
//  🏠 홈(추천) 화면 — 관심팀·뜨거운 경기·오늘의 PICK·주요 경기·AI 한줄
// ============================================================
function homeHot(g) {
  const sc = (g.hs == null && g.as == null) ? 'VS' : `${g.hs ?? 0} - ${g.as ?? 0}`;
  return `<div class="hhot-card" data-ev="${esc(g.id)}">
    <div class="hh-top"><span class="hh-live">LIVE</span>${heatHtml(g)}<span class="hh-st">${esc(koStatus(g))}</span></div>
    <div class="hh-teams">
      <span class="hh-t"><span class="hh-ph">${badge(g.homeLogo, '🏟')}</span><b>${esc(teamShort(TN(g.home, g.league)))}</b></span>
      <span class="hh-sc">${esc(sc)}</span>
      <span class="hh-t"><span class="hh-ph">${badge(g.awayLogo, '🏟')}</span><b>${esc(teamShort(TN(g.away, g.league)))}</b></span>
    </div></div>`;
}
function homePick(g) {
  const lu = luProb(g), m = marketProb(g);
  const name = lu.side === 'home' ? TN(g.home, g.league) : lu.side === 'away' ? TN(g.away, g.league) : t('draw');
  const pct = lu.side === 'home' ? lu.home : lu.side === 'away' ? lu.away : lu.draw;
  return `<div class="hpick" data-pick="${esc(g.id)}" data-psport="${esc(g.__sport || '')}">
    <div class="hp-lg">${esc(g.league)}${g.date ? ' · ' + esc(hhmm(g.date)) : ''}</div>
    <div class="hp-row">
      <div class="hp-teams">${esc(TN(g.home, g.league))} <span>vs</span> ${esc(TN(g.away, g.league))}</div>
      <div class="hp-pickbox"><span class="hp-badge">LIVE UP PICK</span><div class="hp-name">${esc(name)}</div><div class="hp-pct">${pct}<i>%</i></div></div>
    </div>
    <div class="hp-bars">
      ${m ? `<div class="hpb"><span>${esc(t('marketCons'))}</span>${phbBar(m.home, m.away)}<b>${m.home}%</b></div>` : ''}
      <div class="hpb"><span>LIVE UP AI</span>${phbBar(lu.home, lu.away)}<b>${lu.home}%</b></div>
    </div>
    <div class="hp-more">${esc(t('pickDetail'))} ›</div>
  </div>`;
}
function homeKeyRow(g) {
  const tm = g.date ? hhmm(g.date) : '';
  const st = g.state === 'live' ? `<span class="hk-live">● ${esc(koStatus(g))}</span>` : g.state === 'finished' ? esc(t('finished')) : `<span class="hk-tm">${esc(tm)}</span>`;
  return `<div class="hk-row" data-ev="${esc(g.id)}">
    <span class="hk-lg">${esc(g.league)}</span>
    <span class="hk-tt"><span class="hk-ph">${badge(g.homeLogo, '🏟')}</span>${esc(teamShort(TN(g.home, g.league)))}</span>
    <span class="hk-vs">vs</span>
    <span class="hk-tt"><span class="hk-ph">${badge(g.awayLogo, '🏟')}</span>${esc(teamShort(TN(g.away, g.league)))}</span>
    <span class="hk-st">${st}</span></div>`;
}
let homeBusy = false;
async function renderHome() {
  const box = $('#homeBody'); if (!box) return;
  if (homeBusy) return; homeBusy = true;
  if (!box.dataset.loaded) box.innerHTML = `<div class="loading">${esc(t('loading'))}</div>`;
  const sports = ['baseball', 'football', 'basketball'];
  let all = [];
  try {
    const res = await Promise.all(sports.map(sp => fetchJSON(`/api/asports/games?sport=${sp}&date=${state.date}&tz=${encodeURIComponent(USER_TZ)}`, { tries: 1 }).catch(() => ({ games: [] }))));
    res.forEach((d, i) => (d.games || []).forEach(g => { g.__sport = sports[i]; feedGames[g.id] = g; all.push(g); }));
  } catch { }
  const favChips = FAV.length
    ? FAV.map(nm => `<span class="hchip">${esc(TN(nm, ''))}</span>`).join('')
    : `<span class="hfav-empty">${esc(t('noFavHint'))}</span>`;
  const live = all.filter(g => g.state === 'live');
  const favLive = live.filter(g => isFav(g.home) || isFav(g.away));
  const hot = [...new Set([...favLive, ...live])].slice(0, 3);
  const cand = all.filter(g => g.state !== 'finished');
  const favCand = cand.filter(g => isFav(g.home) || isFav(g.away));
  const pool = favCand.length ? favCand : cand;
  let pickG = null, best = -1;
  pool.forEach(g => { const lu = luProb(g); const top = Math.max(lu.home, lu.away); if (top > best) { best = top; pickG = g; } });
  const key = cand.slice().sort((a, b) => {
    const rk = x => { const i = TOP_LEAGUES.indexOf(x); return i < 0 ? 999 : i; };
    const ra = rk(a.league), rb = rk(b.league); if (ra !== rb) return ra - rb;
    return (a.date ? new Date(a.date).getTime() : 0) - (b.date ? new Date(b.date).getTime() : 0);
  }).slice(0, 6);
  const aiG = live[0];
  box.dataset.loaded = '1';
  box.innerHTML = `
    <div class="home-sec"><div class="home-hd">💛 ${esc(t('myTeams'))}</div><div class="hfav">${favChips}</div></div>
    ${hot.length ? `<div class="home-sec"><div class="home-hd">🔥 ${esc(t('hotGames'))}</div><div class="hhot">${hot.map(homeHot).join('')}</div></div>` : ''}
    ${pickG ? `<div class="home-sec"><div class="home-hd">🎯 ${esc(t('todayPick'))}</div>${homePick(pickG)}</div>` : ''}
    ${key.length ? `<div class="home-sec"><div class="home-hd">📅 ${esc(t('keyGames'))}</div><div class="hkey">${key.map(homeKeyRow).join('')}</div></div>` : ''}
    ${aiG ? `<div class="home-sec"><div class="home-hd">🤖 ${esc(t('aiOneLine'))}</div><div class="haione" data-ev="${esc(aiG.id)}">${aiLive(aiG)}</div></div>` : ''}
    <div class="home-empty ${all.length ? 'hidden' : ''}">${esc(t('noGames'))}</div>`;
  $$('#homeBody [data-pick]').forEach(el => el.addEventListener('click', () => { state.sport = el.dataset.psport || state.sport; openPick(el.dataset.pick); }));
  $$('#homeBody [data-ev]').forEach(el => el.addEventListener('click', () => openEvent(el.dataset.ev)));
  homeBusy = false;
}
$('#igLogin')?.addEventListener('click', openLogin);
$$('.topbar .tt[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$$('.topnav a[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$$('.dmenu a[data-tab]').forEach(b => b.addEventListener('click', () => { setTab(b.dataset.tab); closeDrawer(); }));
$('#drawerLogin')?.addEventListener('click', () => { closeDrawer(); openLogin(); });

// ============================================================
//  앱 다운로드 / 설치 (PWA) + 고급 로딩 화면
// ============================================================
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
const UA = navigator.userAgent || '';
const isIOS = /iphone|ipad|ipod/i.test(UA);
const isAndroid = /android/i.test(UA);
// 카카오톡·인스타·페북·라인·네이버·다음 등 "인앱 브라우저"(PWA 설치 불가) 감지
const isInApp = /KAKAOTALK|Instagram|FBAN|FBAV|FB_IAB|Line\/|NAVER|DaumApps|Snapchat|Twitter|everytimeApp|; wv\)/i.test(UA);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
// 인앱 브라우저 → 실제 Chrome으로 다시 열기 (안드로이드 intent)
window.openInChrome = function () {
  const target = location.host + location.pathname + location.search;
  if (isAndroid) {
    location.href = 'intent://' + target + '#Intent;scheme=https;package=com.android.chrome;end';
    setTimeout(() => { try { location.href = 'https://' + target; } catch { } }, 1200);
  } else { shareApp(); }
};

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
  $('#dlTitle').innerHTML = t('alreadyInst').split('.')[0].split('<')[0] + ' ✓';
  $('#dlFill').style.width = '100%'; $('#dlPct').textContent = '100%'; $('#dlMsg').textContent = '';
  const guide = $('#dlGuide');
  guide.innerHTML = t('alreadyInst');
  guide.style.display = 'block'; $('#dlClose').style.display = 'inline-block'; $('#dlClose').textContent = t('closeBtn');
}
async function openDownload() {
  const ov = $('#dlOverlay'); if (!ov) return;
  // 📵 인앱 브라우저(카톡 등)면 설치 불가 → 실제 브라우저로 열기 안내
  if (isInApp && !isStandalone) {
    ov.classList.add('on');
    $('#dlTitle').textContent = t('inAppTitle'); $('#dlMsg').textContent = '';
    $('#dlFill').style.width = '100%'; $('#dlPct').textContent = '100%';
    let g = isIOS ? t('inAppIOS') : t('inAppAndroid');
    if (isAndroid) g += `<br><br><button class="dl-openbtn" onclick="openInChrome()">🌐 ${t('openBrowser')}</button>`;
    g += `<br><br><span class="dl-sub">${t('copyLinkGuide')}</span> <button class="dl-copybtn" onclick="shareApp()">🔗</button>`;
    $('#dlGuide').innerHTML = g; $('#dlGuide').style.display = 'block';
    $('#dlClose').style.display = 'inline-block'; $('#dlClose').textContent = t('closeBtn');
    return;
  }
  // ✅ 네이티브 설치 프롬프트는 반드시 "클릭 제스처 안에서 즉시" 호출해야 함
  //    (애니메이션 뒤에 부르면 일부 폰에서 브라우저가 차단해 '눌러도 안됨' 발생)
  if (deferredPrompt) {
    ov.classList.add('on');
    $('#dlTitle').textContent = t('installTitle'); $('#dlMsg').textContent = '';
    $('#dlFill').style.width = '100%'; $('#dlPct').textContent = '100%';
    $('#dlGuide').innerHTML = t('installAndroid'); $('#dlGuide').style.display = 'block';
    $('#dlClose').style.display = 'inline-block'; $('#dlClose').textContent = t('closeBtn');
    try {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(() => { deferredPrompt = null; });
    } catch { }
    return;
  }
  ov.classList.add('on');
  $('#dlGuide').style.display = 'none'; $('#dlClose').style.display = 'none';
  if (await isAppInstalled()) {
    $('#dlTitle').textContent = '…'; $('#dlMsg').textContent = '';
    let p = 0; $('#dlFill').style.width = '0%';
    const t2 = setInterval(() => { p += 20; const v = Math.min(p, 100); $('#dlFill').style.width = v + '%'; $('#dlPct').textContent = v + '%'; if (p >= 100) { clearInterval(t2); setTimeout(showAlreadyInstalled, 200); } }, 50);
    return;
  }
  runProgress(finishDownload);
}
function finishDownload() {
  const guide = $('#dlGuide'), close = $('#dlClose');
  $('#dlMsg').textContent = '';
  $('#dlTitle').textContent = t('installTitle');
  if (deferredPrompt) {
    guide.innerHTML = t('installAndroid');
    try {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(() => { deferredPrompt = null; });
    } catch { }
  } else if (isIOS) {
    guide.innerHTML = t('installIOS');
  } else {
    guide.innerHTML = t('installAndroid');
  }
  guide.style.display = 'block';
  close.style.display = 'inline-block'; close.textContent = t('closeBtn');
}
$('#btnDownload')?.addEventListener('click', openDownload);
$('#btnDownloadM')?.addEventListener('click', openDownload);
$('#dlClose')?.addEventListener('click', () => $('#dlOverlay').classList.remove('on'));

// ============================================================
//  📤 공유 (카톡·메시지 등 — Web Share API, 폴백: 링크 복사)
// ============================================================
async function shareApp(customUrl, customText) {
  const url = customUrl || (location.origin + '/');
  const text = customText || t('shareText');
  if (navigator.share) {
    try { await navigator.share({ title: 'LIVE UP', text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  // 폴백: 클립보드 복사
  try {
    await navigator.clipboard.writeText(url);
    toast(t('linkCopied'));
  } catch {
    // 최후 폴백: 프롬프트
    try { prompt(t('share'), url); } catch { }
  }
}
function toast(msg) {
  let el = document.getElementById('liveupToast');
  if (!el) { el = document.createElement('div'); el.id = 'liveupToast'; el.className = 'lu-toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), 1800);
}
// 🅿️ 포지션 뱃지 탭 → 뜻 말풍선 (2B = 2루수 …)
const POS_GLOSS = {
  P:{ko:'투수',en:'Pitcher',ja:'投手',zh:'投手'}, SP:{ko:'선발투수',en:'Starting pitcher',ja:'先発投手',zh:'先发投手'}, RP:{ko:'구원투수',en:'Relief pitcher',ja:'救援投手',zh:'后援投手'},
  C:{ko:'포수',en:'Catcher',ja:'捕手',zh:'捕手'},
  '1B':{ko:'1루수',en:'First baseman',ja:'一塁手',zh:'一垒手'}, '2B':{ko:'2루수',en:'Second baseman',ja:'二塁手',zh:'二垒手'}, '3B':{ko:'3루수',en:'Third baseman',ja:'三塁手',zh:'三垒手'},
  SS:{ko:'유격수',en:'Shortstop',ja:'遊撃手',zh:'游击手'},
  LF:{ko:'좌익수',en:'Left fielder',ja:'左翼手',zh:'左外野手'}, CF:{ko:'중견수',en:'Center fielder',ja:'中堅手',zh:'中外野手'}, RF:{ko:'우익수',en:'Right fielder',ja:'右翼手',zh:'右外野手'},
  OF:{ko:'외야수',en:'Outfielder',ja:'外野手',zh:'外野手'}, IF:{ko:'내야수',en:'Infielder',ja:'内野手',zh:'内野手'},
  DH:{ko:'지명타자',en:'Designated hitter',ja:'指名打者',zh:'指定打击'}, PH:{ko:'대타',en:'Pinch hitter',ja:'代打',zh:'代打'}, PR:{ko:'대주자',en:'Pinch runner',ja:'代走',zh:'代跑'},
  UT:{ko:'유틸리티',en:'Utility',ja:'ユーティリティ',zh:'工具人'}
};
function posExplain(code){ const g = POS_GLOSS[(code || '').toUpperCase().trim()]; return g ? (g[LANG] || g.en || g.ko) : null; }
function showPosPop(el){
  const code = (el.textContent || '').trim();
  const desc = posExplain(code); if (!desc) return;
  let p = document.getElementById('posPop');
  if (!p){ p = document.createElement('div'); p.id = 'posPop'; p.className = 'pos-pop'; document.body.appendChild(p); }
  p.innerHTML = `<b>${esc(code)}</b> = ${esc(desc)}`;
  const r = el.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
  let left = r.left + r.width / 2 - pw / 2 + scrollX;
  left = Math.max(8, Math.min(left, innerWidth - pw - 8));
  let top = r.top - ph - 9 + scrollY;
  if (r.top - ph - 9 < 4){ top = r.bottom + 9 + scrollY; p.classList.add('below'); } else p.classList.remove('below');
  p.style.left = left + 'px'; p.style.top = top + 'px'; p.classList.add('on');
  clearTimeout(showPosPop._t); showPosPop._t = setTimeout(() => p.classList.remove('on'), 2600);
}
document.addEventListener('click', e => {
  const b = e.target.closest('.abc-pos:not(.abc-pos-empty), .ab-pos, .stt td.lr');
  if (b && (b.textContent || '').trim() && posExplain(b.textContent)){ e.preventDefault(); e.stopPropagation(); showPosPop(b); }
}, true);
document.addEventListener('click', e => {
  if (!e.target.closest('#posPop, .abc-pos, .ab-pos, .stt td.lr')){ const p = document.getElementById('posPop'); if (p) p.classList.remove('on'); }
});
addEventListener('scroll', () => { const p = document.getElementById('posPop'); if (p) p.classList.remove('on'); }, true);
$('#btnShare')?.addEventListener('click', () => shareApp());
$('#btnShareM')?.addEventListener('click', () => shareApp());
// 상세화면 공유: 해당 경기 딥링크 + 팀·스코어 문구
$('#mShare')?.addEventListener('click', () => {
  const e = (typeof feedGames !== 'undefined' && modalEventId) ? feedGames[modalEventId] : null;
  if (!e) return shareApp();
  const url = location.origin + '/?ev=' + encodeURIComponent(e.id);
  const score = (e.hs != null && e.as != null) ? ` ${e.hs}:${e.as}` : '';
  const text = `${TN(e.home, e.league)} vs ${TN(e.away, e.league)}${score} · LIVE UP`;
  shareApp(url, text);
});

// 설치된 앱(홈 화면)으로 실행 중이면 다운로드 버튼 숨김
function hideDownloadUI() { ['#btnDownload', '#btnDownloadM'].forEach(s => { const el = $(s); if (el) el.style.display = 'none'; }); }
if (isStandalone) hideDownloadUI();
window.addEventListener('appinstalled', () => { try { localStorage.setItem('liveup_installed', '1'); } catch { } hideDownloadUI(); $('#dlOverlay')?.classList.remove('on'); deferredPrompt = null; });
// 전경기 대화방 배너 탭 → 모바일에서 채팅방 열기 (PC는 우측에 항상 표시)
$('#chatbanBtn')?.addEventListener('click', () => { if (window.innerWidth < 960) setTab('comm'); });

// ============================================================
//  로그인 (구글 / 네이버 / 카카오) — 테스트 단계: 대화명 설정
// ============================================================
let loggedIn = false, myUser = null, GOOGLE_CID = '';
function openLogin() {
  if (loggedIn) { if (confirm(`${myName} 님 · 로그아웃 할까요?`)) logoutUser(); return; }
  $('#scrimL').classList.add('on'); $('#loginModal').classList.add('on');
}
function closeLogin() { $('#scrimL').classList.remove('on'); $('#loginModal').classList.remove('on'); }
$('#btnLogin')?.addEventListener('click', openLogin);
$('#lmClose')?.addEventListener('click', closeLogin);
$('#scrimL')?.addEventListener('click', closeLogin);
// ⚡ 실제 구글 로그인 (Google Identity Services)
(async function initAuth() {
  try { const c = await fetch('/api/config').then(r => r.json()); GOOGLE_CID = c.googleClientId || ''; } catch { }
  try { const s = JSON.parse(localStorage.getItem('liveup_user') || 'null'); if (s && s.name) applyUser(s); } catch { }
  loadGIS();
})();
function loadGIS() {
  if (!GOOGLE_CID) { const n = $('#lmNote'); if (n) n.innerHTML = '⚠️ 구글 로그인 설정 준비중 (관리자: GOOGLE_CLIENT_ID 설정 필요)'; return; }
  if (window.google && google.accounts && google.accounts.id) return initGIS();
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true; s.onload = initGIS; document.head.appendChild(s);
}
// LANG 코드 → 구글 GIS 버튼 로케일 매핑 (한국어면 '로그인' 버튼이 한글로 나옴)
function gisLocale() { const m = { en: 'en', ko: 'ko', ja: 'ja', zh: 'zh_CN', es: 'es', hi: 'hi', vi: 'vi', th: 'th', ru: 'ru', de: 'de', fr: 'fr', it: 'it' }; return m[LANG] || 'en'; }
function initGIS() {
  if (!GOOGLE_CID || !(window.google && google.accounts && google.accounts.id)) return;
  try { google.accounts.id.initialize({ client_id: GOOGLE_CID, callback: onGoogleCred, auto_select: false }); } catch { }
  const c = $('#gSignIn');
  if (c) { c.innerHTML = ''; try { google.accounts.id.renderButton(c, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 260, locale: gisLocale() }); } catch { } }
}
async function onGoogleCred(resp) {
  if (!resp || !resp.credential) return;
  try {
    const d = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: resp.credential }) }).then(r => r.json());
    if (!d.ok) { toast('로그인 실패: ' + (d.error || '')); return; }
    applyUser(d.user); try { localStorage.setItem('liveup_user', JSON.stringify(d.user)); } catch { }
    toast(d.isNew ? '가입 완료! 환영해요 🎉' : '로그인 완료 ✓');
    closeLogin();
  } catch { toast('로그인 실패'); }
}
function applyUser(u) {
  myUser = u; myName = u.name; loggedIn = true;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'name', name: myName }));
  renderAuthUI();
  if (typeof updateInfoGate === 'function') updateInfoGate();   // 로그인 시 경기정보방 잠금 해제
}
// 로그인/로그아웃 상태에 맞춰 모든 로그인 버튼(PC·모바일·드로어) 갱신
function renderAuthUI() {
  const pic = myUser && myUser.picture ? `<img class="uav" src="${esc(myUser.picture)}" referrerpolicy="no-referrer">` : '👤';
  const nm = myUser ? esc((myUser.name || '').slice(0, 10)) : '';
  const btn = $('#btnLogin');
  if (btn) btn.innerHTML = loggedIn ? `${pic} ${nm} · ${esc(t('logout'))}` : `🔑 <span data-i18n="login">${esc(t('login'))}</span>`;
  const du = $('#drawerLogin');
  if (du) du.innerHTML = loggedIn ? `<span class="em">🚪</span><span>${esc(t('logout'))}</span>` : `<span class="em">🔑</span><span data-i18n="login">${esc(t('login'))}</span>`;
  const bu = $('#btnUser'); if (bu) bu.innerHTML = loggedIn ? pic : '👤';
  const dn = $('#drawerName'); if (dn) dn.textContent = loggedIn && myUser ? myUser.name : '손님';
}
function logoutUser() {
  myUser = null; loggedIn = false; myName = null;
  try { localStorage.removeItem('liveup_user'); } catch { }
  try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch { }
  renderAuthUI();
  if (typeof updateInfoGate === 'function') updateInfoGate();   // 로그아웃 시 다시 잠금
}
// 커스텀 "구글로 로그인" 버튼 → GIS One Tap 트리거 (폴백)
$('#gFallback')?.addEventListener('click', () => {
  if (!GOOGLE_CID) { toast('구글 로그인 설정 준비중'); return; }
  if (window.google && google.accounts && google.accounts.id) { try { google.accounts.id.prompt(); } catch { } }
  else loadGIS();
});

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
  const list = SPORTS.map(s => `<a data-sport="${s.key}" class="${s.key === state.sport ? 'on' : ''}"><span class="em">${s.em}</span>${esc(t(s.key))}</a>`).join('');
  $('#sportNav').innerHTML = list;
  $('#sportNavD').innerHTML = list;
  $$('[data-sport]').forEach(el => el.addEventListener('click', () => { state.sport = el.dataset.sport; state.leagueFilter = 'all'; buildSportNav(); loadEvents(); closeDrawer(); }));
}
function buildLeagueNav() {
  // API-Sports는 종목 단위로 조회 → 리그 네비는 현재 종목의 리그로 동적 표시(렌더 후 갱신)
  $('#leagueNav').innerHTML = '<div class="side-note" style="padding:8px 16px">경기를 불러오면 리그가 표시됩니다</div>';
  $('#leagueNavD').innerHTML = '';
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
let feedGames = {};   // id -> game (상세 모달용)
let allFeedGames = [];   // 필터 전 전체 경기
function filterGames() { return state.leagueFilter === 'all' ? allFeedGames : allFeedGames.filter(g => g.league === state.leagueFilter); }
// 상단 리그 선택 바 (전체 / KBO / MLB / … · 모든 종목 공통)
function buildLeagueRow(games) {
  const row = $('#leagueRow'); if (!row) return;
  const counts = {};
  games.forEach(g => { const k = g.league || '기타'; counts[k] = (counts[k] || 0) + 1; });
  const leagues = Object.entries(counts).sort((a, b) => {
    const ra = TOP_LEAGUES.indexOf(a[0]), rb = TOP_LEAGUES.indexOf(b[0]);
    const ia = ra < 0 ? 999 : ra, ib = rb < 0 ? 999 : rb;
    if (ia !== ib) return ia - ib;
    return b[1] - a[1];
  });
  if (!leagues.length) { row.style.display = 'none'; row.innerHTML = ''; return; }
  row.style.display = 'flex';
  row.innerHTML = `<div class="lgchip ${state.leagueFilter === 'all' ? 'on' : ''}" data-lg="all">${esc(t('all'))} <b>${games.length}</b></div>`
    + leagues.map(([nm, n]) => `<div class="lgchip ${state.leagueFilter === nm ? 'on' : ''}" data-lg="${esc(nm)}">${esc(nm)} <b>${n}</b></div>`).join('');
  $$('#leagueRow .lgchip').forEach(c => c.addEventListener('click', () => {
    state.leagueFilter = c.dataset.lg;
    $$('#leagueRow .lgchip').forEach(x => x.classList.remove('on')); c.classList.add('on');
    // 활성 화면에 필터 적용 (픽 제공 / 경기 정보방 / 라이브)
    if ($('#view-odds') && !$('#view-odds').classList.contains('hidden') && typeof renderPickHubList === 'function') renderPickHubList();
    else if ($('#view-info') && !$('#view-info').classList.contains('hidden')) renderInfoList();
    else renderFeed(filterGames());
  }));
}
// silent=true → 자동 10초 갱신: 로딩 표시(깜빡임) 없이, 스크롤 위치 그대로 유지
async function loadEvents(silent) {
  const feed = $('#feed');
  if (!silent) feed.innerHTML = `<div class="loading">${esc(t('loadingGames'))}</div>`;
  try {
    const d = await fetchJSON(`/api/asports/games?sport=${encodeURIComponent(state.sport)}&date=${state.date}&tz=${encodeURIComponent(USER_TZ)}`, {
      onWait: silent ? undefined : (n) => { feed.innerHTML = `<div class="loading">⏳ 무료 서버를 깨우는 중이에요…<br>최초 접속은 최대 1분 정도 걸릴 수 있어요.<br><span style="color:#aeb6c0">(자동 재시도 ${n})</span></div>`; }
    });
    if (d.needKey) { if (!silent) feed.innerHTML = `<div class="loading">경기 데이터 API 키가 설정되지 않았어요.</div>`; return; }
    const games = d.games || [];
    allFeedGames = games;
    feedGames = {}; games.forEach(g => feedGames[g.id] = g);
    // (알림 감지는 서버 웹푸시가 담당 — 앱이 꺼져 있어도 동작)
    // 현재 리그 필터가 이번 데이터에 없으면 전체로 리셋
    if (state.leagueFilter !== 'all' && !games.some(g => g.league === state.leagueFilter)) state.leagueFilter = 'all';
    // ▼ 화면이 위로 튀지 않도록: 재렌더 전 스크롤 위치 저장 → 후(레이아웃 반영까지) 복원
    const sy = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const modalEl = $('#modal'); const moy = modalEl ? modalEl.scrollTop : 0;
    buildLeagueRow(games);
    renderFeed(filterGames());
    // 상세 모달이 열려 있으면 해당 경기 상세도 실시간 갱신 (채팅·스크롤 유지)
    if (modalEventId && feedGames[modalEventId] && modalPredict) {
      logChanges(modalEventId, feedGames[modalEventId]);   // 변화 감지 → 이벤트 로그 적립
      renderDetail(feedGames[modalEventId], modalPredict);
    }
    if (silent) {
      const restore = () => {
        window.scrollTo(0, sy);
        if (document.scrollingElement) document.scrollingElement.scrollTop = sy;
        if (modalEl && modalEl.classList.contains('on')) modalEl.scrollTop = moy;
      };
      restore();                       // 즉시
      requestAnimationFrame(restore);  // 레이아웃 반영 직후 한 번 더 (브라우저 자동 스크롤 보정 무력화)
    }
  } catch (e) {
    if (!silent) feed.innerHTML = `<div class="loading">${esc(t('loading'))}<br><button onclick="loadEvents()" style="margin-top:10px;padding:9px 18px;border:none;border-radius:8px;background:#24568f;color:#fff;font-weight:800;cursor:pointer">${esc(t('retry'))}</button></div>`;
  }
}
function hhmm(dateStr) {
  const dd = dateStr ? new Date(dateStr) : null;
  return dd ? `${String(dd.getHours()).padStart(2, '0')}:${String(dd.getMinutes()).padStart(2, '0')}` : t('scheduled');
}
// 라이브 상태를 선택 언어로 (회차/쿼터/분) · 함수명은 호환 위해 koStatus 유지
const ABN_KEY = { postponed: 'stPostponed', canceled: 'stCanceled', delayed: 'stDelayed', suspended: 'stSuspended', abnormal: 'stAbnormal', halved: 'stHalved', tbd: 'stTbd' };
function abnLabel(e) {
  if (e && e.abnStatus) return t(ABN_KEY[e.abnStatus] || 'stAbnormal');
  const s = String(e && e.status || '').toUpperCase(), L = String(e && e.statusLong || '').toLowerCase();
  if (s === 'PST' || /postpon/.test(L)) return t('stPostponed');
  if (s === 'CANC' || /cancel/.test(L)) return t('stCanceled');
  if (s === 'SUSP' || /suspend/.test(L)) return t('stSuspended');
  if (s === 'ABD' || s === 'AWD' || /abandon/.test(L)) return t('stCanceled');
  if (s === 'INT' || /interrupt/.test(L)) return t('stSuspended');
  return '';
}
function koStatus(e) {
  const ab = abnLabel(e); if (ab && ab !== '—') return ab;
  const sp = state.sport;
  const s = String(e.status || '').toUpperCase();
  const long = String(e.statusLong || '');
  const L = long.toLowerCase();
  if (sp === 'football') {
    if (s === 'HT') return t('halftime');
    if (s === '1H') return `${t('fh')} ${e.elapsed || ''}'`;
    if (s === '2H') return `${t('sh')} ${e.elapsed || ''}'`;
    if (s === 'ET') return `${t('extraTime')} ${e.elapsed || ''}'`;
    if (s === 'P' || s === 'PEN') return t('penalties');
    if (e.elapsed != null) return `${e.elapsed}'`;
    return long || t('inplay');
  }
  if (sp === 'baseball') {
    const inn = e.curInning || e.period || (long.match(/(\d+)/) || [])[1] || (s.match(/(\d+)/) || [])[1];
    let half = '';
    if (e.inningHalf === 'top' || /top/.test(L) || /^T/.test(s)) half = 'top';
    else if (e.inningHalf === 'bottom' || /bot/.test(L) || /^B/.test(s)) half = 'bottom';
    if (inn) return inningLabel(inn, half);
    return long || t('inplay');
  }
  if (sp === 'basketball') {
    if (s === 'HT') return t('halftime');
    const q = (s.match(/Q?(\d)/) || [])[1];
    if (q) return periodLabel(q, 'quarter');
    return long || t('inplay');
  }
  const p = e.period || (s.match(/(\d+)/) || [])[1];
  if (p) return periodLabel(p, sp === 'volleyball' ? 'set' : sp === 'hockey' ? 'period' : 'quarter');
  return long || e.status || t('inplay');
}
function stateBadge(e) {
  const ab = abnLabel(e); if (ab && ab !== '—') return `<span class="badge-state abn">${esc(ab)}</span>`;
  if (e.state === 'live') return `<span class="badge-state live">● ${esc(koStatus(e))}</span>`;
  if (e.state === 'finished') return `<span class="badge-state ft">${esc(t('finished'))}</span>`;
  return `<span class="badge-state sched">${hhmm(e.date)}</span>`;
}
// ⚡ 생동감 있는 상황별 해설 문구 풀 (12개 언어 · 매번 조금씩 다르게)
const VIBE = {
  tie: [
    ['A nerve-jangling deadlock!', '한 치도 못 물러서는 팽팽한 승부!', '一歩も譲らぬ緊迫の展開!', '势均力敌，一分必争！', '¡Empate de infarto!', 'कांटे की टक्कर!', 'Căng như dây đàn!', 'สูสีลุ้นระทึก!', 'Нервная ничья!', 'Ein nervenaufreibendes Remis!', 'Un nul à couper le souffle !', 'Un pari da batticuore!'],
    ['Neither side blinking here.', '서로 한 점이 아쉬운 초접전이에요.', '互いに譲らぬ接戦。', '互不相让，胶着难分！', 'Nadie cede un palmo.', 'कोई झुकने को तैयार नहीं!', 'Không ai chịu nhường!', 'ไม่มีใครยอมใคร!', 'Никто не уступает!', 'Keiner gibt nach!', 'Personne ne lâche rien !', 'Nessuno molla di un centimetro!']
  ],
  leadSmall: [
    ['A one-swing game — buckle up!', '한 방이면 뒤집히는 살얼음 리드!', '一発で覆る薄氷のリード！', '一击就能翻盘的微弱领先！', '¡Una sola jugada lo cambia todo!', 'एक झटके में पलट सकता है!', 'Chỉ một cú là lật kèo!', 'พลิกได้ในหนึ่งช็อต!', 'Один удар решает всё!', 'Ein Schlag, alles dreht sich!', 'Un coup et tout bascule !', 'Un colpo e si ribalta!'],
    ['Slim edge, hearts pounding.', '아슬아슬한 리드, 심장이 쫄깃해요.', 'わずかなリード、ハラハラの展開。', '微弱优势，扣人心弦。', 'Ventaja mínima, pura tensión.', 'मामूली बढ़त, दिल थामे रखिए।', 'Dẫn mong manh, hồi hộp!', 'นำแบบเฉียดฉิว ลุ้นสุดๆ', 'Минимальный отрыв, нервы на пределе.', 'Knappe Führung, Herzklopfen.', 'Avance mince, tension à fond.', 'Vantaggio sottile, che tensione!']
  ],
  leadBig: [
    ['Momentum has clearly swung!', '분위기가 확 기울었어요!', '流れが完全に傾いた！', '气势彻底倒向一边！', '¡El impulso cambió de bando!', 'पासा पूरी तरह पलट गया!', 'Thế trận đã nghiêng hẳn!', 'โมเมนตัมเทไปฝั่งเดียว!', 'Инициатива резко сместилась!', 'Das Momentum hat klar gedreht!', 'La dynamique a basculé !', 'L’inerzia è tutta da una parte!'],
    ['Pulling away in style.', '점점 승부가 굳어지는 흐름이에요.', '徐々に試合を決めにいく展開。', '正逐渐把比赛拿下。', 'Se escapan en el marcador.', 'धीरे-धीरे पकड़ मजबूत।', 'Đang dần định đoạt trận đấu.', 'กำลังทิ้งห่างอย่างมั่นใจ', 'Уверенно уходят в отрыв.', 'Sie ziehen souverän davon.', 'Ils prennent le large.', 'Stanno prendendo il largo.']
  ],
  lateClose: [
    ['Crunch time — every pitch is gold!', '종반 승부처! 공 하나하나가 손에 땀을 쥐게 해요.', '終盤の勝負所！一球一球が痺れる。', '决胜时刻！每一球都惊心动魄。', '¡Momento decisivo, cada lanzamiento cuenta!', 'निर्णायक पल, हर गेंद कीमती!', 'Thời khắc quyết định, nghẹt thở!', 'ช่วงชี้ชะตา ทุกลูกลุ้นระทึก!', 'Решающие иннинги — на нервах!', 'Die heiße Phase — jeder Wurf zählt!', 'Money time, chaque lancer compte !', 'Momento decisivo, ogni lancio pesa!'],
    ['Late and tight — anyone’s game!', '막판까지 한 점 싸움, 누구도 모릅니다!', '終盤まで1点差、まだ分からない！', '末段一分之差，胜负难料！', '¡Recta final apretadísima!', 'आखिरी पलों में कड़ी टक्कर!', 'Cuối trận sít sao, khó lường!', 'ท้ายเกมสูสี ตัดสินยาก!', 'Концовка вплотную — всё решится!', 'Enges Finish — offen wie nie!', 'Fin serrée, tout est possible !', 'Finale tiratissimo, tutto aperto!']
  ]
};
function vibeStr(e) {
  const h = Number(e.hs) || 0, a = Number(e.as) || 0, diff = Math.abs(h - a);
  const inn = Number(e.curInning) || 0;
  const seed = inn + h + a + (e.bso ? (e.bso.outs || 0) : 0);
  let key = 'leadSmall';
  if (inn >= 7 && diff <= 2 && e.state === 'live') key = 'lateClose';
  else if (diff === 0) key = 'tie';
  else if (diff >= 4) key = 'leadBig';
  const pool = VIBE[key], row = pool[Math.abs(seed) % pool.length];
  const i = LANGS.indexOf(LANG);
  return row[i >= 0 ? i : 0];
}
// 라이브 긴장 태그 (만루/득점권/투아웃)
function vibeTag(e) {
  if (e.state !== 'live' || state.sport !== 'baseball' || !e.bso) return '';
  const b = e.bso.bases || {};
  if (b.first && b.second && b.third) return t('vibeLoaded');
  if (b.second || b.third) return t('vibeRISP');
  if (e.bso.outs === 2) return t('vibe2out');
  return '';
}
// 🔥 실시간 열기 레벨 (0~3) — 후반·접전·만루/득점권 등이 겹칠수록 높음. 막 시작한 경기는 0
function heatLevel(e) {
  if (!e || e.state !== 'live') return 0;
  const hs = Number(e.hs) || 0, as = Number(e.as) || 0, margin = Math.abs(hs - as);
  let s = 0;
  const baseball = (e.sport === 'baseball') || tsLeague(e.league) || statsLeague(e.league) || (e.curInning != null);
  if (baseball) {
    const inn = Number(e.curInning) || 0;
    if (inn >= 7) s++;                                  // 후반(7회~)
    if (inn >= 9) s++;                                  // 9회·연장
    if (margin <= 1) s++;                               // 접전
    const b = e.bso && e.bso.bases;
    if (b && b.first && b.second && b.third) s += 2;    // 만루
    else if (b && (b.second || b.third)) s++;           // 득점권(2·3루)
  } else {
    const mn = Number(e.elapsed || e.minute || 0);
    if (mn >= 70) s++;                                  // 후반 막판
    if (mn >= 85) s++;                                  // 종료 임박
    if (margin <= 1) s++;                               // 접전
    if (margin === 0 && mn >= 80) s++;                  // 막판 동점
  }
  return s >= 2 ? Math.min(3, s - 1) : 0;               // 2요소 이상 겹칠 때만 불 표시
}
function heatHtml(e) {
  const lv = heatLevel(e);
  if (lv <= 0) return '';
  let f = ''; for (let i = 0; i < lv; i++) f += `<i class="fl" style="animation-delay:${(i * 0.19).toFixed(2)}s">🔥</i>`;
  return `<span class="heat heat${lv}" title="🔥 HOT">${f}</span>`;
}
// AI 실시간 해설 (라이브 경기)
function aiLive(e) {
  if (e.state !== 'live') return '';
  const setSports = (state.sport === 'volleyball' || state.sport === 'hockey');
  let h, a;
  if (setSports && e.livePts) { h = Number(e.livePts.home); a = Number(e.livePts.away); }
  else { h = Number(e.hs); a = Number(e.as); }
  if (isNaN(h) || isNaN(a)) return '';
  const st = koStatus(e), diff = h - a;
  const HM = `<b>${esc(TN(e.home, e.league))}</b>`, AW = `<b>${esc(TN(e.away, e.league))}</b>`;
  let msg;
  if (diff === 0) msg = ai('aiTie', { st, home: HM, away: AW, h, a });
  else {
    const lead = `<b>${esc(TN(diff > 0 ? e.home : e.away, e.league))}</b>`, ld = Math.abs(diff);
    msg = ai('aiLead', { st, lead, d: ld, h, a });
  }
  // 야구: 안타 흐름 한 줄 추가
  if (state.sport === 'baseball' && e.box) {
    const bh = e.box.home, ba = e.box.away;
    if (bh && ba && (bh.h != null || ba.h != null)) {
      msg += ` <span class="aihit">${ai('aiHits', { home: esc(TN(e.home, e.league)), hh: bh.h ?? 0, away: esc(TN(e.away, e.league)), ah: ba.h ?? 0 })}</span>`;
    }
  }
  // ⚡ 생동감: 상황별 문구 앞에 + 긴장 태그(만루/득점권/투아웃) 뒤에
  if (state.sport === 'baseball') {
    const vb = vibeStr(e), tg = vibeTag(e);
    msg = `<span class="aivibe">${esc(vb)}</span> ${msg}${tg ? ` <span class="aitag">🔥 ${esc(tg)}</span>` : ''}`;
  }
  return `<div class="ailive">🤖 <b>${esc(t('aiComm'))}</b> ${msg}</div>`;
}
// AI 총정리 (상세보기 · 여러 문장)
function aiSummary(e) {
  const sp = state.sport;
  const h = Number(e.hs), a = Number(e.as);
  const lines = [];
  const st = e.state === 'live' ? koStatus(e) : (e.state === 'finished' ? t('finished') : t('scheduled'));
  const HM = esc(TN(e.home, e.league)), AW = esc(TN(e.away, e.league));
  if (e.state === 'scheduled') {
    lines.push(ai('sumSched1', { home: `<b>${HM}</b>`, away: `<b>${AW}</b>` }));
    if (e.odds) lines.push(ai('sumSched2', { side: (Number(e.odds.home) || 9) < (Number(e.odds.away) || 9) ? HM : AW }));
    lines.push(ai('sumSched3'));
    return lines;
  }
  const diff = (!isNaN(h) && !isNaN(a)) ? h - a : 0;
  const leadName = esc(TN(diff > 0 ? e.home : e.away, e.league)), ld = Math.abs(diff);
  // ⚡ 야구 라이브: 생동감 있는 상황 문구를 맨 앞에
  if (sp === 'baseball' && e.state === 'live') { const vb = vibeStr(e), tg = vibeTag(e); lines.push(`<b>${esc(vb)}</b>${tg ? ` 🔥 ${esc(tg)}` : ''}`); }
  // 1) 현재 상황
  if (diff === 0) lines.push(ai('sumTie', { st, h, a }));
  else lines.push(ai('sumLead', { st, lead: `<b>${leadName}</b>`, hi: Math.max(h, a), lo: Math.min(h, a), d: ld }));
  // 2) 종목별 디테일
  if (sp === 'baseball' && e.box) {
    const bh = e.box.home, ba = e.box.away;
    const hh = bh?.h ?? 0, ah = ba?.h ?? 0, he = bh?.e ?? 0, ae = ba?.e ?? 0;
    lines.push(ai('sumBB', { home: HM, hh, away: AW, ah, he, ae }));
    if (e.inningHalf) lines.push(ai('sumInn', { x: inningLabel(e.curInning || '', e.inningHalf), tb: e.inningHalf === 'top' ? t('tbTop') : t('tbBot') }));
  } else if ((sp === 'volleyball' || sp === 'hockey') && e.livePts) {
    const lh = Number(e.livePts.home), la = Number(e.livePts.away);
    lines.push(ai('sumSet', { h, a, sh: e.livePts.home ?? 0, sa: e.livePts.away ?? 0, leader: lh > la ? HM : la > lh ? AW : '—' }));
  }
  // 3) 배당/전망
  if (e.odds) {
    const oh = Number(e.odds.home), oa = Number(e.odds.away);
    if (oh && oa) lines.push(ai('sumOdds', { oh: oh.toFixed(2), oa: oa.toFixed(2), side: oh < oa ? HM : AW }));
  }
  if (e.state === 'finished') lines.push(ai('sumFinal', { h, a, result: diff === 0 ? t('resultDraw') : ai('resultWin', { lead: leadName }) }));
  else lines.push(ai('sumCont'));
  return lines;
}
function scoreBlock(e) {
  const hasScore = e.hs != null || e.as != null;
  if (!hasScore) {
    return `<div class="mid">${stateBadge(e)}<div class="vs">VS</div></div>`;
  }
  const cls = e.state === 'live' ? 'score live' : 'score';
  // 세트제 종목(배구/하키)은 현재 세트 실시간 점수 추가 표시
  const setSports = (state.sport === 'volleyball' || state.sport === 'hockey');
  const sub = (setSports && e.livePts && e.state === 'live') ? `<div class="setpts">${esc(t('now'))} ${esc(e.livePts.home ?? 0)}:${esc(e.livePts.away ?? 0)}</div>` : '';
  const mainLbl = setSports ? `<div class="scorelbl">${esc(t('setWord'))}</div>` : '';
  // 이기는 쪽(높은 점수) 빨강 / 지는 쪽 검정 (동점은 기본색)
  const h = Number(e.hs) || 0, a = Number(e.as) || 0;
  const hCls = h > a ? ' win' : h < a ? ' lose' : '';
  const aCls = a > h ? ' win' : a < h ? ' lose' : '';
  return `<div class="mid">${stateBadge(e)}<div class="scores"><span class="${cls}${hCls}">${esc(e.hs ?? 0)}</span><span class="vs">:</span><span class="${cls}${aCls}">${esc(e.as ?? 0)}</span></div>${mainLbl}${sub}</div>`;
}
function oddsLine(e) {
  if (!e.odds) return '';
  const o = e.odds, c = (v, l) => v ? `<span>${l} <b>${Number(v).toFixed(2)}</b></span>` : '';
  const parts = [c(o.home, t('win')), o.draw ? c(o.draw, t('draw')) : '', c(o.away, t('loss'))].filter(Boolean).join('');
  return parts ? `<div class="modds">💰 ${esc(t('odds'))} ${parts}</div>` : '';
}
function predictBanner(e) {
  const h = Number(e.hs), a = Number(e.as);
  let side = e.home, pct = 50;
  if (!isNaN(h) && !isNaN(a) && h !== a) { side = h > a ? e.home : e.away; pct = 55 + Math.min(35, Math.abs(h - a) * 9); }
  const ou = (!isNaN(h) && !isNaN(a) && (h + a) >= 5) ? t('over') : t('under');
  return `<div class="ansban" data-ev="${esc(e.id)}"><span class="badge">${esc(t('ansTag'))}</span><span class="t"><b>${esc(TN(side, e.league))} ${pct}%</b> <span class="g">/ ${esc(t('handi'))} / ${esc(ou)}</span></span><span class="go">›</span></div>`;
}
// 야구 R·H·E 미니 스코어보드 (득점·안타·실책)
function rheMini(e) {
  if (state.sport !== 'baseball' || !e.box) return '';
  const h = e.box.home || {}, a = e.box.away || {};
  if ([h.h, h.e, a.h, a.e].every(v => v == null)) return '';
  const nm = x => { const s = TN(x, e.league); const p = String(s || '').trim().split(' '); return (LANG === 'en' || LANG === 'es' || LANG === 'de' || LANG === 'fr' || LANG === 'it' || LANG === 'vi') && p.length > 1 ? p[p.length - 1] : s; };
  const showBB = true;   // BB 칸 항상 표시 (데이터 없으면 "-") — 생겼다 사라지는 혼란 방지
  return `<div class="rhemini"><table>
    <thead><tr><th></th><th>R</th><th>H</th><th>E</th>${showBB ? '<th>BB</th>' : ''}</tr></thead>
    <tbody>
      <tr><td class="tn">${esc(nm(e.away))}</td><td class="r">${esc(a.r ?? e.as ?? 0)}</td><td>${esc(a.h ?? 0)}</td><td>${esc(a.e ?? 0)}</td>${showBB ? `<td>${esc(a.bb ?? '-')}</td>` : ''}</tr>
      <tr><td class="tn">${esc(nm(e.home))}</td><td class="r">${esc(h.r ?? e.hs ?? 0)}</td><td>${esc(h.h ?? 0)}</td><td>${esc(h.e ?? 0)}</td>${showBB ? `<td>${esc(h.bb ?? '-')}</td>` : ''}</tr>
    </tbody></table></div>`;
}
// 🏏 피드 카드: 타격 중 타자 3명(좌) + R/H/E/BB 표(우) 나란히
function atbatCard(e) {
  if (state.sport !== 'baseball' || e.state !== 'live' || !e.atbat || !(e.atbat.players || []).length) return '';
  const rows = e.atbat.players.slice(0, 3).map(p => {
    const nm = (LANG === 'ko' && p.name_ko) ? p.name_ko : (p.name || '-');
    const face = p.photo ? `<img class="abc-face" src="${esc(p.photo)}" referrerpolicy="no-referrer" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'abc-face noimg',textContent:'🏏'}))">` : '<span class="abc-face noimg">🏏</span>';
    const pos = p.pos ? `<span class="abc-pos">${esc(p.pos)}</span>` : '<span class="abc-pos abc-pos-empty"></span>';
    return `<div class="abc-row">${pos}${face}<span class="abc-nm">${esc(nm)}</span><span class="abc-line">${esc(p.h == null ? 0 : p.h)}<i>/</i>${esc(p.ab == null ? 0 : p.ab)}</span></div>`;
  }).join('');
  return `<div class="abcard"><div class="abc-hd">🏏 ${esc(t('nowBatting'))}</div>${rows}</div>`;
}
function rheRow(e) {
  const rhe = rheMini(e); if (!rhe) return '';
  return `<div class="rhemini-row">${atbatCard(e)}${rhe}</div>`;
}
// 홈/원정 배지 (이모지 대신 또렷한 아이콘 칩)
const HA_HOME = '<span class="haic home" title="HOME" aria-label="HOME"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6 1.5 11.2l1.5 1.9L5 11.9V21h5.2v-5.6h3.6V21H19v-9.1l2 1.2 1.5-1.9z"/></svg></span>';
const HA_AWAY = '<span class="haic away" title="AWAY" aria-label="AWAY"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.5 15.6 14 11.2V4.9a2 2 0 0 0-4 0v6.3l-7.5 4.4v1.9L10 15.4v3.9l-2.3 1.6V22L12 20.8 16.3 22v-1.1L14 19.3v-3.9l7.5 2.1z"/></svg></span>';
// ⚾ 예상 선발투수 (팀 이름 아래 표시 · MLB 등 StatsAPI 리그 · 며칠 전부터 제공)
function teamSP(e, side) {
  if (state.sport !== 'baseball' || !e.pitchers) return '';
  const p = e.pitchers[side] || {};
  if (!p.name) return `<div class="sp-p sp-tbd"><span class="sp-face ic">⚾</span><span class="sp-nm">${esc(t('starterTBD'))}</span></div>`;
  const face = p.id ? `<img class="sp-face" src="${esc(mlbFace(p.id))}" referrerpolicy="no-referrer" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'sp-face ic',textContent:'⚾'}))">` : `<span class="sp-face ic">⚾</span>`;
  const stat = [];
  if (p.era) stat.push(`${t('eraShort')} ${p.era}`);
  if (p.w != null && p.l != null) stat.push(LANG === 'ko' ? `${p.w}승 ${p.l}패` : `${p.w}-${p.l}`);
  const statLine = stat.length ? `<div class="sp-stat">${esc(stat.join(' · '))}</div>` : '';
  return `<div class="sp-p" title="${esc(p.name)}">${face}<span class="sp-nm">${esc(p.name)}</span>${statLine}</div>`;
}
function matchCard(e) {
  return `<div class="match" data-ev="${esc(e.id)}">
    <span class="cardlead"><span class="bell favbell${isMatchFav(e) ? ' on' : ''}" data-favmatch="${esc(e.id)}" title="${esc(t('favTeams'))}">${isMatchFav(e) ? '🔔' : '🔕'}</span>${heatHtml(e)}</span>
    <div class="mrow">
      <div class="side">${HA_HOME}<div class="ph">${badge(e.homeLogo, '🏟')}</div><div class="team">${esc(TN(e.home, e.league))}</div>${teamSP(e, 'home')}</div>
      ${scoreBlock(e)}
      <div class="side">${HA_AWAY}<div class="ph">${badge(e.awayLogo, '🏟')}</div><div class="team">${esc(TN(e.away, e.league))}</div>${teamSP(e, 'away')}</div>
    </div>
    ${aiLive(e)}
    ${bsoMini(e)}
    ${rheRow(e)}
    ${oddsLine(e)}
    <span class="pick">${esc(t('pick'))}</span>
  </div>`;
}
function renderFeed(games) {
  const feed = $('#feed');
  if (!games.length) {
    feed.innerHTML = `<div class="loading">${esc(state.date)} · ${esc(t(state.sport))} · ${esc(t('noGames'))}</div>`;
    return;
  }
  // 정렬: 라이브(진행) → 예정(시작 임박순) → 종료(아래로)
  const stateRank = s => s === 'live' ? 0 : s === 'finished' ? 2 : 1;
  const feedSort = (a, b) => {
    const ra = stateRank(a.state), rb = stateRank(b.state);
    if (ra !== rb) return ra - rb;
    const ta = a.date ? new Date(a.date).getTime() : 0, tb = b.date ? new Date(b.date).getTime() : 0;
    return ra === 2 ? tb - ta : ta - tb;   // 예정=빠른 시간 위, 종료=최근 위
  };
  // 리그별 그룹핑 + 정렬 헬퍼
  const groupBy = list => {
    const gr = {};
    list.forEach(e => { const k = e.league || '기타'; (gr[k] = gr[k] || { league: e, name: k, items: [] }).items.push(e); });
    Object.values(gr).forEach(g => g.items.sort(feedSort));
    const groupTier = items => items.some(x => x.state === 'live') ? 0 : items.some(x => x.state === 'scheduled') ? 1 : 2;
    return Object.values(gr).sort((a, b) => {
      const ta = groupTier(a.items), tb = groupTier(b.items);
      if (ta !== tb) return ta - tb;
      const ra = TOP_LEAGUES.indexOf(a.name) < 0 ? 999 : TOP_LEAGUES.indexOf(a.name);
      const rb = TOP_LEAGUES.indexOf(b.name) < 0 ? 999 : TOP_LEAGUES.indexOf(b.name);
      if (ra !== rb) return ra - rb;
      return b.items.length - a.items.length;
    });
  };
  const groupHtml = g => {
    const live = g.items.filter(x => x.state === 'live').length;
    const head = `<div class="lghd"><span class="flag">${badge(g.league.leagueLogo, '🏆')}</span><span class="nm">${esc(g.name)}</span><span class="cnt">(${g.items.length})</span>${live ? `<span class="live-dot" style="color:#e2231a;font-weight:800">🔴 ${live} LIVE</span>` : ''}<span class="up">∧</span></div>`;
    return `<div class="lg">${head}${g.items.map(e => matchCard(e)).join('')}</div>`;
  };
  // ⭐ 즐겨찾기(종) → 리그별 그룹(각 리그 안에서 진행→예정→종료 순, 종료는 아래로)
  const favGames = games.filter(e => isMatchFav(e)); favGames.sort(feedSort);
  const rest = games.filter(e => !isMatchFav(e));
  const allG = groupBy(rest);   // 진행·예정·종료를 한 리그 그룹으로 합침 (라이브스코어 방식)
  let html = '';
  if (favGames.length) {
    const live = favGames.filter(x => x.state === 'live').length;
    const head = `<div class="lghd favhd"><span class="flag">⭐</span><span class="nm">${esc(t('favTeams'))}</span><span class="cnt">(${favGames.length})</span>${live ? `<span class="live-dot" style="color:#e2231a;font-weight:800">🔴 ${live} LIVE</span>` : ''}<span class="up">∧</span></div>`;
    html += `<div class="lg lg-fav">${head}${favGames.map(e => matchCard(e)).join('')}</div>`;
  }
  html += allG.map(groupHtml).join('');
  feed.innerHTML = html;
  $$('#feed .lghd').forEach(h => h.addEventListener('click', () => {
    let el = h.nextElementSibling; const arr = h.querySelector('.up'); const col = arr.textContent === '∨';
    while (el && !el.classList.contains('lghd')) { el.style.display = col ? '' : 'none'; el = el.nextElementSibling; }
    arr.textContent = col ? '∧' : '∨';
  }));
  $$('#feed [data-ev]').forEach(el => el.addEventListener('click', () => openEvent(el.dataset.ev)));
}

// ============================================================
//  경기 상세 모달 (메모리 데이터 사용 · 추가 호출 없음)
// ============================================================
let modalChatUI = null, modalEventId = null, modalPredict = null;
// ===== 실시간 이벤트 피드 (축구=실제 이벤트 / 야구·기타=변화감지 AI 로그) =====
const eventLogs = {};   // id -> [{t, icon, text}]
const snapForLog = {};  // id -> 직전 스냅샷
function nowHM() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function pushLog(id, icon, text, meta) {
  const arr = (eventLogs[id] = eventLogs[id] || []);
  const last = arr[arr.length - 1];
  if (last && last.text === text) return;         // 연속 중복 방지
  const m = (meta && typeof meta === 'object') ? meta : {};
  arr.push({ t: nowHM(), icon, text, inn: m.inn != null ? m.inn : null, half: m.half || null });
  if (arr.length > 120) arr.shift();              // 회차 탭 위해 캡 상향(이른 이닝 유지)
  // (채팅방 중계봇은 서버에서 구동 → 히스토리에 저장되어 유지됨. 여기서는 상단 이벤트 피드만 적립)
}
function logChanges(id, e) {
  const p = snapForLog[id];
  const snap = {
    hs: Number(e.hs) || 0, as: Number(e.as) || 0,
    hh: e.box && e.box.home ? e.box.home.h : null, ah: e.box && e.box.away ? e.box.away.h : null,
    he: e.box && e.box.home ? e.box.home.e : null, ae: e.box && e.box.away ? e.box.away.e : null,
    inn: e.curInning != null ? e.curInning : null, half: e.inningHalf || null,
    out: (e.bso && e.bso.outs != null) ? e.bso.outs : null,
    batTeam: e.batting || null,
    sp: e.livePts ? `${e.livePts.home}:${e.livePts.away}` : null
  };
  const HM = `<b>${esc(TN(e.home, e.league))}</b>`, AW = `<b>${esc(TN(e.away, e.league))}</b>`;
  const BAT = snap.batTeam === 'home' ? HM : snap.batTeam === 'away' ? AW : '';
  if (p) {
    if (state.sport === 'baseball') {
      const IM = { inn: snap.inn, half: snap.half };
      if (snap.hs > p.hs) pushLog(id, '🔴', ai('evScore', { team: HM, h: snap.hs, a: snap.as }), IM);
      if (snap.as > p.as) pushLog(id, '🔴', ai('evScore', { team: AW, h: snap.hs, a: snap.as }), IM);
      if (snap.hh != null && p.hh != null && snap.hh > p.hh) pushLog(id, '🏏', ai('evHit', { team: HM, n: snap.hh }), IM);
      if (snap.ah != null && p.ah != null && snap.ah > p.ah) pushLog(id, '🏏', ai('evHit', { team: AW, n: snap.ah }), IM);
      if (snap.he != null && p.he != null && snap.he > p.he) pushLog(id, '⚠️', ai('evError', { team: HM, n: snap.he }), IM);
      if (snap.ae != null && p.ae != null && snap.ae > p.ae) pushLog(id, '⚠️', ai('evError', { team: AW, n: snap.ae }), IM);
      if (snap.out != null && p.out != null && snap.out > p.out && snap.inn === p.inn && snap.half === p.half && BAT) pushLog(id, '🙅', ai('evOut', { team: BAT, n: snap.out }), IM);
      if (snap.inn !== p.inn || snap.half !== p.half) { if (snap.inn) pushLog(id, '🔄', ai('evInnStart', { x: inningLabel(snap.inn, snap.half) }), IM); }
    } else {
      if (snap.hs > p.hs) pushLog(id, '🔴', ai('evScore', { team: HM, h: snap.hs, a: snap.as }));
      if (snap.as > p.as) pushLog(id, '🔴', ai('evScore', { team: AW, h: snap.hs, a: snap.as }));
      if (snap.sp && snap.sp !== p.sp) pushLog(id, '🏐', ai('evSet', { s: snap.sp }));
    }
  }
  snapForLog[id] = snap;
}
function eventEmpty() {
  return `<div class="ev-empty">🤖 ${esc(t('noEvents'))}</div>`;
}
// 회차 탭 상태: id -> 선택 탭 키 / 사용자가 직접 눌렀는지
const evTab = {}, evTabPin = {};
const evRow = x => `<div class="evrow"><span class="evm">${esc(x.t || '')}</span><span class="evi">${x.icon || '•'}</span><span class="evt">${x.text}</span></div>`;
function numOrNull(v) { const n = Number(v); return (v == null || v === '' || isNaN(n)) ? null : n; }
// 탭바 렌더 + 클릭 배선(공통)
function wireEvTabs(box, id, tabs, curKey, renderBody) {
  if (evTab[id] == null || !evTabPin[id]) evTab[id] = curKey;
  if (!tabs.some(tb => tb.key === evTab[id])) evTab[id] = curKey;
  const draw = () => {
    const bar = tabs.map(tb => `<button class="ev-tab${tb.key === evTab[id] ? ' on' : ''}" data-tk="${esc(String(tb.key))}">${esc(tb.label)}</button>`).join('');
    box.innerHTML = `<div class="ev-tabs" id="evTabs">${bar}</div><div class="ev-body">${renderBody(evTab[id])}</div>`;
    $$('#evTabs .ev-tab', box).forEach(btn => btn.addEventListener('click', () => {
      evTab[id] = btn.dataset.tk; evTabPin[id] = true; draw();
      const cur = $('#evTabs .ev-tab.on', box); if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
    }));
    const on = $('#evTabs .ev-tab.on', box); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  };
  draw();
}
// ⚾ MLB 타석 결과 → 한국어(그 외 언어는 영문 원문)
const MLB_EV = {
  'Strikeout': '삼진', 'strikeout': '삼진', 'Walk': '볼넷', 'Intent Walk': '고의4구', 'Single': '1루타', 'Double': '2루타',
  'Triple': '3루타', 'Home Run': '홈런', 'Groundout': '땅볼 아웃', 'Grounded Into DP': '병살타', 'Bunt Groundout': '번트 땅볼',
  'Flyout': '뜬공 아웃', 'Lineout': '직선타 아웃', 'Pop Out': '내야 뜬공', 'Sac Fly': '희생플라이', 'Sac Bunt': '희생번트',
  'Hit By Pitch': '몸에 맞는 공', 'Field Error': '실책 출루', 'Forceout': '포스아웃', 'Double Play': '병살', 'Triple Play': '삼중살',
  'Fielders Choice': '야수선택', 'Fielders Choice Out': '야수선택 아웃', 'Catcher Interference': '포수 방해', 'Strikeout Double Play': '삼진+병살'
};
function mlbEvName(ev) { return (LANG === 'ko' && MLB_EV[ev]) ? MLB_EV[ev] : (ev || '-'); }
function pitchBadge(p) {
  const c = p.c || ''; let cls = 'pb-b', lab = 'B';
  if ('CSTKLMQW'.indexOf(c) >= 0) { cls = 'pb-s'; lab = 'S'; }
  else if (c === 'F') { cls = 'pb-f'; lab = 'F'; }
  else if ('XDE'.indexOf(c) >= 0) { cls = 'pb-x'; lab = '●'; }
  else if (c === 'H') { cls = 'pb-h'; lab = 'H'; }
  const cnt = (p.b != null && p.s != null) ? `${p.b}-${p.s}` : '';
  const tip = cnt + (p.spd ? ` · ${p.spd}mph` : '');
  return `<span class="pbadge ${cls}"${tip ? ` title="${esc(tip)}"` : ''}>${lab}</span>`;
}
function mlbAbRow(ab) {
  const rbi = ab.rbi > 0 ? ` <span class="ab-rbi">+${ab.rbi}</span>` : '';
  const seq = (ab.pitches || []).map(pitchBadge).join('');
  return `<div class="ab-item"><div class="ab-hd"><b>${esc(ab.batter)}</b> <span class="ab-res">${esc(mlbEvName(ab.event))}</span>${rbi}<span class="ab-np">${ab.np || 0}${t('pitchU')}</span></div>${seq ? `<div class="ab-seq">${seq}</div>` : ''}</div>`;
}
const pbpCache = {};   // id -> { ts, innings }
async function fetchPbp(e) {
  const c = pbpCache[e.id];
  if (c && Date.now() - c.ts < 12000) return c;
  try {
    const d = await fetchJSON(`/api/mlb/pbp?home=${encodeURIComponent(e.home)}&away=${encodeURIComponent(e.away)}&date=${state.date}`, { tries: 1 });
    const rec = { ts: Date.now(), innings: (d.found && d.innings) ? d.innings : null };
    pbpCache[e.id] = rec; return rec;
  } catch { pbpCache[e.id] = { ts: Date.now(), innings: null }; return pbpCache[e.id]; }
}
async function updateEvents(e) {
  const box = $('#mEvents'); if (!box) return;
  if (state.sport === 'football') {
    let evs = [];
    try { const d = await fetchJSON(`/api/asports/events?fixture=${encodeURIComponent(e.id)}`, { tries: 1 }); evs = d.events || []; }
    catch { box.innerHTML = eventEmpty(); return; }
    if (!evs.length) { box.innerHTML = eventEmpty(); return; }
    const half = ev => { const mn = ev.minute == null ? 0 : ev.minute; return mn > 90 ? 'ET' : mn > 45 ? '2H' : '1H'; };
    const fmt = ev => {
      let icon = '•', label = ev.detail || ev.type;
      if (ev.type === 'Goal') { icon = '⚽'; label = /own/i.test(ev.detail) ? t('fbOwn') : /penalty/i.test(ev.detail) ? t('fbPk') : t('fbGoal'); }
      else if (ev.type === 'Card' && /red/i.test(ev.detail)) { icon = '🟥'; label = t('fbRed'); }
      else if (ev.type === 'Card') { icon = '🟨'; label = t('fbYellow'); }
      else if (/subst/i.test(ev.type)) { icon = '🔄'; label = t('fbSub'); }
      else if (/var/i.test(ev.type)) { icon = '📺'; label = 'VAR'; }
      const mm = ev.minute != null ? `${ev.minute}${ev.extra ? '+' + ev.extra : ''}'` : '';
      const who = /subst/i.test(ev.type) ? `${esc(ev.assist)} → ${esc(ev.player)}` : `${esc(ev.player)}${ev.assist ? ` (${esc(t('fbAssist'))} ${esc(ev.assist)})` : ''}`;
      return { t: mm, icon, text: `<b>${esc(label)}</b> ${who} · ${esc(ev.team)}` };
    };
    const order = ['1H', '2H', 'ET'], lbl = { '1H': t('fbFirst'), '2H': t('fbSecond'), 'ET': t('fbET') };
    const present = order.filter(k => evs.some(ev => half(ev) === k));
    const tabs = present.map(k => ({ key: k, label: lbl[k] }));
    const curKey = half(evs[evs.length - 1]) || present[present.length - 1] || '1H';
    wireEvTabs(box, e.id, tabs, curKey, key => {
      const list = evs.filter(ev => half(ev) === key).slice().reverse();
      return list.length ? list.map(fmt).map(evRow).join('') : eventEmpty();
    });
    return;
  }
  // ⚾ 야구: 이닝 탭 (라이브 적립 + 이닝별 득점 재구성)
  const situ = (state.sport === 'baseball') ? bsoSituation(e) : '';
  const log = eventLogs[e.id] || [];
  if (state.sport !== 'baseball') {
    box.innerHTML = situ + (log.length ? log.slice().reverse().map(evRow).join('') : eventEmpty());
    return;
  }
  // MLB/LMB 등 StatsAPI 리그면 투구 단위 플레이별 데이터 시도
  const pb = statsLeague(e.league) ? await fetchPbp(e) : null;
  const pbInn = (pb && pb.innings) ? pb.innings : null;
  const bx = e.box || {}, hIn = (bx.home && bx.home.innings) || {}, aIn = (bx.away && bx.away.innings) || {};
  const keys = [...Object.keys(hIn), ...Object.keys(aIn)].map(Number).filter(n => n > 0);
  const pbMax = pbInn ? Math.max(0, ...pbInn.map(x => x.inn)) : 0;
  const maxInn = Math.max(e.curInning || 0, keys.length ? Math.max(...keys) : 0, pbMax, 1);
  const HM = `<b>${esc(TN(e.home, e.league))}</b>`, AW = `<b>${esc(TN(e.away, e.league))}</b>`;
  const tabs = []; for (let i = 1; i <= maxInn; i++) tabs.push({ key: String(i), label: inningLabel(i, null) });
  const curKey = String(e.curInning || maxInn);
  const cur = e.curInning || maxInn;
  const bodyFor = key => {
    const i = Number(key);
    // 1) MLB 투구 단위 플레이별 (있으면 최우선)
    if (pbInn) {
      const parts = [];
      for (const hf of ['top', 'bottom']) {
        const seg = pbInn.find(x => x.inn === i && x.half === hf);
        if (seg && seg.plays.length) parts.push(`<div class="ab-half">${esc(inningLabel(i, hf))}</div>` + seg.plays.map(mlbAbRow).join(''));
      }
      if (parts.length) return `<div class="ab-legend">${esc(t('pbLegend'))}</div>` + parts.join('');
    }
    // 2) 라이브 적립분
    const live = log.filter(x => x.inn === i);
    if (live.length) return live.slice().reverse().map(evRow).join('');
    // 3) 이닝별 득점 요약 재구성
    const ar = numOrNull(aIn[i]), hr = numOrNull(hIn[i]);
    const rows = [];
    const line = (half, team, r) => ({ icon: r > 0 ? '🔴' : '▪️', text: `${inningLabel(i, half)} · ${r > 0 ? ai('recRuns', { team, n: r }) : t('recZero')}` });
    if (i <= cur) rows.push(line('top', AW, ar));
    if (i < cur || (i === cur && e.inningHalf === 'bottom') || hr != null) rows.push(line('bottom', HM, hr));
    return rows.length ? rows.map(evRow).join('') : `<div class="ev-empty">🤖 ${esc(t('recWait'))}</div>`;
  };
  box.innerHTML = situ + '<div id="evTabWrap"></div>';
  wireEvTabs($('#evTabWrap', box), e.id, tabs, curKey, bodyFor);
}
// ⚾ 실시간 문자중계 상단: 현재 이닝·공격팀·B-S-O·주자 (매 갱신마다 새로고침)
function bsoSituation(e) {
  if (e.state !== 'live' || !e.bso) return '';
  const b = e.bso, dot = (n, max) => { let s = ''; for (let i = 0; i < max; i++) s += `<span class="cdm${i < (n || 0) ? ' on' : ''}"></span>`; return s; };
  const bat = e.batting === 'home' ? TN(e.home, e.league) : e.batting === 'away' ? TN(e.away, e.league) : '';
  const inn = e.curInning ? inningLabel(e.curInning, e.inningHalf) : '';
  return `<div class="ev-situ">
    <div class="es-top"><span class="es-inn">🔴 ${esc(inn)}</span>${bat ? `<span class="es-bat">🏏 ${esc(bat)} ${esc(t('battingNow'))}</span>` : ''}</div>
    <div class="es-line"><span class="bsomini"><span class="bl">B</span>${dot(b.balls, 3)}<span class="bl">S</span>${dot(b.strikes, 2)}<span class="bl o">O</span>${dot(b.outs, 2)}<span class="bso-dia">${basesSvg(b.bases)}</span></span></div>
  </div>`;
}
// ===== 선발 라인업 (축구=포메이션 배치도 / MLB=타순·선수 최근경기) =====
function shortName(n) { const p = String(n || '').trim().split(' '); return p.length > 1 ? p[p.length - 1] : n; }
function teamShort(n) { return shortName(n); }
// 포메이션 좌표(grid)가 없을 때: 선발 명단을 사진+이름 리스트로 표시 (좌표 미제공 리그/시점 대응)
function renderLineupList(t) {
  const all = t.startXI || [];
  const hd = `<div class="pitch-hd">${esc(t.team)}${t.formation ? ` · <b>${esc(t.formation)}</b>` : ''}${t.coach ? ` · ${esc(t('coach'))} ${esc(t.coach)}` : ''}</div>`;
  if (!all.length) return `<div class="pitch">${hd}<div class="lu-note">-</div></div>`;
  const rows = all.map(p => {
    const face = footFace(p.id), num = esc(p.number == null ? '' : String(p.number));
    const av = face
      ? `<span class="lulist-av has-face"><img src="${face}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove('has-face');this.parentNode.textContent='${num || '·'}'"></span>`
      : `<span class="lulist-av">${num || '·'}</span>`;
    return `<div class="lulist-row lu-dot" data-pid="${esc(p.id)}" data-name="${esc(p.name)}" data-pos="${esc(p.pos || '')}" data-num="${num}">${av}<span class="lulist-num">${num}</span><span class="lulist-nm">${esc(p.name)}</span>${p.pos ? `<span class="lulist-pos">${esc(p.pos)}</span>` : ''}</div>`;
  }).join('');
  const subs = (t.subs || []).length ? `<div class="lulist-sub-hd">${esc(t('subs') || '교체')}</div>` + (t.subs || []).map(p => `<div class="lulist-row lu-dot sub" data-pid="${esc(p.id)}" data-name="${esc(p.name)}" data-pos="${esc(p.pos || '')}" data-num="${esc(p.number == null ? '' : String(p.number))}"><span class="lulist-av sm">${esc(p.number == null ? '' : String(p.number))}</span><span class="lulist-nm">${esc(p.name)}</span></div>`).join('') : '';
  return `<div class="pitch">${hd}<div class="lulist">${rows}${subs}</div></div>`;
}
function renderPitch(t) {
  const xi = (t.startXI || []).filter(p => p.grid);
  if (!xi.length) return renderLineupList(t);   // 좌표 없으면 명단 리스트로 폴백
  const rows = {};
  xi.forEach(p => { const g = String(p.grid).split(':'); const r = +g[0], c = +g[1]; (rows[r] = rows[r] || []).push({ ...p, c }); });
  const rk = Object.keys(rows).map(Number).sort((a, b) => a - b);
  const R = rk.length || 1;
  const dots = [];
  rk.forEach((r, ri) => {
    const line = rows[r].sort((a, b) => a.c - b.c), n = line.length;
    line.forEach((p, ci) => {
      const top = ((ri + 1) / (R + 1)) * 100, left = ((ci + 1) / (n + 1)) * 100;
      const face = footFace(p.id), num = esc(p.number || '');
      const av = face
        ? `<span class="lu-av has-face"><img src="${face}" alt="" loading="lazy" onerror="this.parentNode.classList.remove('has-face');this.parentNode.innerHTML='${num}'"><b class="lu-badge">${num}</b></span>`
        : `<span class="lu-av">${num}</span>`;
      dots.push(`<div class="lu-dot" data-pid="${esc(p.id)}" data-name="${esc(p.name)}" data-pos="${esc(p.pos || '')}" data-num="${esc(p.number || '')}" style="top:${top}%;left:${left}%">${av}<span class="lu-nm">${esc(shortName(p.name))}</span></div>`);
    });
  });
  return `<div class="pitch"><div class="pitch-hd">${esc(t.team)} · <b>${esc(t.formation)}</b>${t.coach ? ` · 감독 ${esc(t.coach)}` : ''}</div><div class="pitch-field">${dots.join('')}</div></div>`;
}
// 야구장 수비 배치도 (포지션별 좌표) — 얼굴 대신 포지션 캐릭터 원
const BB_POS = { P: [50, 60], C: [50, 87], '1B': [72, 52], '2B': [61, 39], SS: [39, 39], '3B': [28, 52], LF: [21, 25], CF: [50, 13], RF: [79, 25] };
function fieldDot(p, x, y) {
  const face = mlbFace(p.id);
  const badgeTxt = esc((p.number != null && p.number !== '') ? p.number : (p.pos || ''));
  const av = face
    ? `<div class="fd-av has-face"><img src="${face}" alt="" loading="lazy" onerror="this.parentNode.classList.remove('has-face');this.parentNode.innerHTML='${esc(p.pos || '')}'"><b class="fd-badge">${badgeTxt}</b></div>`
    : `<div class="fd-av">${esc(p.pos || '')}</div>`;
  return `<div class="fd" data-pid="${esc(p.id)}" data-name="${esc(p.name)}" data-group="${p.pos === 'P' ? 'pitching' : 'hitting'}" style="left:${x}%;top:${y}%">${av}<div class="fd-nm">${esc(shortName(p.name))}</div></div>`;
}
function mlbField(side, teamName) {
  const dots = [];
  (side.lineup || []).forEach(p => { if (p.pos && p.pos !== 'DH' && BB_POS[p.pos]) { const [x, y] = BB_POS[p.pos]; dots.push(fieldDot(p, x, y)); } });
  if (side.pitcher) { const [x, y] = BB_POS.P; dots.push(fieldDot({ ...side.pitcher, pos: 'P' }, x, y)); }
  const dh = (side.lineup || []).find(p => p.pos === 'DH');
  if (!dots.length) return `<div class="lu-note">라인업 미확정</div>`;
  return `<div class="bfield">${dots.join('')}</div>${dh ? `<div class="bfield-dh">🏏 DH <b>${esc(dh.name)}</b></div>` : ''}`;
}
function wireFieldClicks() { $$('#mLineupWrap .fd').forEach(el => el.addEventListener('click', () => showMlbPlayer(el.dataset.pid, el.dataset.name, el.dataset.group || 'hitting'))); }
function mlbFaceEl(id) {
  const f = mlbFace(id);
  return f ? `<span class="mlb-face"><img src="${f}" alt="" loading="lazy" onerror="this.parentNode.style.display='none'"></span>` : '';
}
function mlbCol(side, teamName, league) {
  const rows = (side.lineup || []).map(p => `<div class="mlb-p" data-pid="${esc(p.id)}" data-name="${esc(p.name)}" data-group="hitting"><span class="mlb-o">${esc(p.order)}</span>${mlbFaceEl(p.id)}<span class="mlb-pos">${esc(p.pos)}</span><span class="mlb-nm">${esc(p.name)}</span></div>`).join('');
  const pit = side.pitcher ? `<div class="mlb-p pit" data-pid="${esc(side.pitcher.id)}" data-name="${esc(side.pitcher.name)}" data-group="pitching"><span class="mlb-o">P</span>${mlbFaceEl(side.pitcher.id)}<span class="mlb-pos">${esc(t('probable'))}</span><span class="mlb-nm">${esc(side.pitcher.name)}</span></div>` : '';
  return `<div class="mlb-side"><div class="mlb-hd">${esc(TN(teamName, league))}</div>${rows || '<div class="lu-note">-</div>'}${pit}</div>`;
}
async function showMlbPlayer(id, name, group) {
  const box = $('#mPlayer'); if (!box) return;
  box.innerHTML = `<div class="pl-card"><div class="pl-hd">${esc(name)} · ${esc(t('recent'))}</div><div class="loading" style="padding:10px">${esc(t('loading'))}</div></div>`;
  try {
    const d = await fetchJSON(`/api/mlb/player?id=${encodeURIComponent(id)}&group=${group || 'hitting'}`, { tries: 1 });
    const gs = d.games || [];
    if (!gs.length) { box.innerHTML = `<div class="pl-card"><div class="pl-hd">${esc(name)}</div><div class="lu-note">-</div></div>`; return; }
    const isPit = (group === 'pitching');
    const head = isPit ? `<th>${sl('date')}</th><th>${sl('opp')}</th><th>${sl('ip')}</th><th>${sl('er')}</th><th>${sl('k')}</th><th>${sl('era')}</th>` : `<th>${sl('date')}</th><th>${sl('opp')}</th><th>${sl('ab')}</th><th>${sl('h')}</th><th>${sl('hr')}</th><th>${sl('rbi')}</th>`;
    const rows = gs.map(g => {
      const s = g.stat || {}, md = (g.date || '').slice(5);
      if (isPit) return `<tr><td>${esc(md)}</td><td>${esc(teamShort(g.opp))}</td><td>${esc(s.inningsPitched ?? '-')}</td><td>${esc(s.earnedRuns ?? '-')}</td><td>${esc(s.strikeOuts ?? '-')}</td><td>${esc(s.era ?? '-')}</td></tr>`;
      return `<tr><td>${esc(md)}</td><td>${esc(teamShort(g.opp))}</td><td>${esc(s.atBats ?? '-')}</td><td>${esc(s.hits ?? '-')}</td><td>${esc(s.homeRuns ?? '-')}</td><td>${esc(s.rbi ?? '-')}</td></tr>`;
    }).join('');
    box.innerHTML = `<div class="pl-card"><div class="pl-hd">🧢 ${esc(name)} · ${esc(t('recent'))}</div><table class="pllog"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch { box.innerHTML = `<div class="pl-card"><div class="lu-note">-</div></div>`; }
}
function wirePlayerClicks(kind) {
  if (kind === 'mlb') {
    $$('#mLineupWrap .mlb-p').forEach(el => el.addEventListener('click', () => showMlbPlayer(el.dataset.pid, el.dataset.name, el.dataset.group || 'hitting')));
  } else {
    $$('#mLineupWrap .lu-dot').forEach(el => el.addEventListener('click', () => {
      const box = $('#mPlayer'); if (!box) return;
      box.innerHTML = `<div class="pl-card"><div class="pl-hd">⚽ ${esc(el.dataset.name)}</div><div class="pl-meta">등번호 <b>${esc(el.dataset.num || '-')}</b> · 포지션 <b>${esc(el.dataset.pos || '-')}</b></div><div class="lu-note">축구는 선수별 최근 경기 로그를 데이터 소스가 제공하지 않아, 이름·등번호·포지션까지 표시돼요.</div></div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
  }
}
// MLB 실시간 상황 (볼·스트라이크·아웃 · 주자 · 타자/투수 · R/H/E/BB)
function basesSvg(b) {
  const on = '#e2231a', off = '#c3c9d2';
  return `<svg class="diamond" viewBox="0 0 46 50" width="46" height="50" aria-hidden="true">
    <rect x="18" y="5" width="10" height="10" transform="rotate(45 23 10)" fill="${b && b.second ? on : off}"/>
    <rect x="30" y="17" width="10" height="10" transform="rotate(45 35 22)" fill="${b && b.first ? on : off}"/>
    <rect x="6" y="17" width="10" height="10" transform="rotate(45 11 22)" fill="${b && b.third ? on : off}"/>
    <rect x="16" y="33" width="14" height="14" transform="rotate(45 23 40)" fill="#fff" stroke="#16243d" stroke-width="3.5"/>
  </svg>`;
}
// 카드용 B/S/O + 주자 다이아몬드 (라이브 MLB만)
// ⚾ 공격팀 표시 (초=원정공격 ▲ / 말=홈공격 ▼)
function batLine(e) {
  if (state.sport !== 'baseball' || e.state !== 'live' || !e.batting || !e.inningHalf) return '';
  const nm = e.batting === 'home' ? TN(e.home, e.league) : TN(e.away, e.league);
  const arrow = e.inningHalf === 'top' ? '▲' : '▼';
  const half = e.inningHalf === 'top' ? t('topShort') : t('botShort');
  return `<div class="batline"><span class="bat-ar ${e.inningHalf}">${arrow} ${esc(half)}</span> 🏏 <b>${esc(nm)}</b> ${esc(t('batNow'))}</div>`;
}
function bsoMini(e) {
  if (state.sport !== 'baseball' || e.state !== 'live' || !e.bso) return batLine(e);
  const b = e.bso, dot = (n, max) => { let s = ''; for (let i = 0; i < max; i++) s += `<span class="cdm${i < (n || 0) ? ' on' : ''}"></span>`; return s; };
  return `${batLine(e)}<div class="bsomini"><span class="bl">B</span>${dot(b.balls, 3)}<span class="bl">S</span>${dot(b.strikes, 2)}<span class="bl o">O</span>${dot(b.outs, 2)}<span class="bso-dia">${basesSvg(b.bases)}</span></div>`;
}
async function updateMlbLive(e) {
  const box = $('#mMlbLive'); if (!box) return;
  try {
    const d = await fetchJSON(`/api/mlb/live?home=${encodeURIComponent(e.home)}&away=${encodeURIComponent(e.away)}&date=${state.date}`, { tries: 1 });
    if (!d.found || (d.inning == null && d.balls == null && d.outs == null)) { box.innerHTML = ''; return; }
    const halfEn = d.half === 'Top' ? 'top' : d.half === 'Bottom' ? 'bottom' : '';
    const innTxt = d.inning != null ? inningLabel(d.inning, halfEn) : '-';
    const dot = (n, max) => { let s = ''; for (let i = 0; i < max; i++) s += `<span class="cd${i < (n || 0) ? ' on' : ''}"></span>`; return s; };
    const bh = d.box.home || {}, ba = d.box.away || {};
    box.innerHTML = `
      <div class="odsec">⚾ ${esc(t('liveSit'))} <span class="rhe">${esc(t('freeReal'))}</span></div>
      <div class="mlbstate">
        <div class="ms-top">
          <span class="ms-inn">${esc(innTxt)}</span>
          <div class="bso"><span class="bso-l">B</span>${dot(d.balls, 3)}<span class="bso-l">S</span>${dot(d.strikes, 2)}<span class="bso-l o">O</span>${dot(d.outs, 2)}</div>
          ${basesSvg(d.bases)}
        </div>
        <div class="ms-players">
          <div>🏏 ${esc(t('atBat'))} <b>${esc(d.batter || '-')}</b>${d.batterLine ? ` <span class="ms-stat">${d.batterLine.h}/${d.batterLine.ab} · K${d.batterLine.k} · ${d.batterLine.bb}BB</span>` : ''}</div>
          <div>⚾ ${sl('pitcher')} <b>${esc(d.pitcher || '-')}</b>${d.pitcherLine ? ` <span class="ms-stat">${d.pitcherLine.ip}${sl('ip')}${d.pitcherLine.np != null ? ' · ' + d.pitcherLine.np + 'P' : ''} · ${d.pitcherLine.k}K · ${d.pitcherLine.er}${sl('er')}</span>` : ''}</div>
        </div>
        <table class="rhe-tbl"><thead><tr><th></th><th>R</th><th>H</th><th>E</th><th>BB</th></tr></thead><tbody>
          <tr><td class="tn">${esc(TN(e.away, e.league))}</td><td>${esc(ba.r ?? 0)}</td><td>${esc(ba.h ?? 0)}</td><td>${esc(ba.e ?? 0)}</td><td>${esc(ba.bb ?? '-')}</td></tr>
          <tr><td class="tn">${esc(TN(e.home, e.league))}</td><td>${esc(bh.r ?? 0)}</td><td>${esc(bh.h ?? 0)}</td><td>${esc(bh.e ?? 0)}</td><td>${esc(bh.bb ?? '-')}</td></tr>
        </tbody></table>
      </div>`;
  } catch { box.innerHTML = ''; }
}
// ⚾ KBO/NPB/CPBL 여부 (TheSports 박스스코어 대상)
function tsLeague(l) { return /KBO|NPB|CPBL|Korea|Nippon|Japan|일본|한국|대만|Taiwan|Chinese Professional/i.test(l || ''); }
// ⚾ TheSports 야구 필드 배치도 (수비 포지션 + 선수 사진) — MLB와 동일 비주얼
// 선수 표시 이름 — 한국어 UI면 한글명(있을 때) 우선
function pName(p) { return (LANG === 'ko' && p && p.name_ko) ? p.name_ko : (p && p.name) || ''; }
function tsFieldDot(p, x, y, side) {
  const face = p.photo;
  const av = face
    ? `<div class="fd-av has-face"><img src="${esc(face)}" alt="" loading="lazy" onerror="this.parentNode.classList.remove('has-face');this.parentNode.innerHTML='${esc(p.position || '')}'"><b class="fd-badge">${esc(p.position || '')}</b></div>`
    : `<div class="fd-av">${esc(p.position || '')}</div>`;
  const dnm = LANG === 'ko' && p.name_ko ? p.name_ko : shortName(p.name || p.position || '');
  return `<div class="fd tsp" data-pid="${esc(p.id)}" data-side="${esc(side || '')}" style="left:${x}%;top:${y}%">${av}<div class="fd-nm">${esc(dnm)}</div></div>`;
}
function tsField(players, side) {
  const list = players || [];
  const bat = list.filter(p => !p.pitcher), pit = list.filter(p => p.pitcher);
  const dots = [], used = {};
  ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'].forEach(pos => {
    const pl = bat.find(p => p.position === pos && !used[p.id]);
    if (pl && BB_POS[pos]) { used[pl.id] = 1; const [x, y] = BB_POS[pos]; dots.push(tsFieldDot(pl, x, y, side)); }
  });
  const starter = pit.find(p => p.position === 'SP') || pit[0];
  if (starter) { const [x, y] = BB_POS.P; dots.push(tsFieldDot(Object.assign({}, starter, { position: 'P' }), x, y, side)); }
  const dh = bat.find(p => p.position === 'DH');
  if (!dots.length) return '';
  return `<div class="bfield">${dots.join('')}</div>${dh ? `<div class="bfield-dh">🏏 DH <b>${esc(pName(dh))}</b></div>` : ''}`;
}
// ⚾ TheSports 경기별 박스스코어 한쪽(타자+투수) 렌더 (선수 사진 포함)
function tsBoxSide(players, side) {
  const list = players || [];
  const bat = list.filter(p => !p.pitcher), pit = list.filter(p => p.pitcher);
  const face = p => p.photo ? `<img class="bx-face" src="${esc(p.photo)}" loading="lazy" onerror="this.style.display='none'">` : '';
  const v = x => (x == null ? '-' : esc(x));
  const sd = esc(side || '');
  const bt = `<table class="stt"><thead><tr><th>${sl('batter')}</th><th></th><th>${sl('ab')}</th><th>${sl('h')}</th><th>${sl('bb')}</th><th>${sl('rbi')}</th><th>${sl('hr')}</th><th>${sl('k')}</th></tr></thead><tbody>${
    bat.map(b => `<tr class="tsp" data-pid="${esc(b.id)}" data-side="${sd}"><td class="nm">${face(b)}${esc(pName(b) || '-')}</td><td class="lr">${esc(b.position || '')}</td><td>${v(b.ab)}</td><td>${v(b.h)}</td><td>${v(b.bb)}</td><td>${v(b.rbi)}</td><td>${v(b.hr)}</td><td>${v(b.k)}</td></tr>`).join('') || `<tr><td colspan="8">-</td></tr>`
    }</tbody></table>`;
  const pt = `<table class="stt" style="margin-top:8px"><thead><tr><th>${sl('pitcher')}</th><th>${sl('ip')}</th><th>${sl('ha')}</th><th>${sl('er')}</th><th>${sl('k')}</th><th>${sl('bb')}</th></tr></thead><tbody>${
    pit.map(p => `<tr class="tsp" data-pid="${esc(p.id)}" data-side="${sd}"><td class="nm">${face(p)}${esc(pName(p) || '-')}</td><td>${v(p.ip)}</td><td>${v(p.ph)}</td><td>${v(p.er)}</td><td>${v(p.pk)}</td><td>${v(p.pbb)}</td></tr>`).join('') || `<tr><td colspan="6">-</td></tr>`
    }</tbody></table>`;
  return bt + pt;
}
// 🏏 타격 중인 팀의 타자 3명 (사진 + 오늘 성적) — 경기 시작 후 박스에 등장한 타자 기준
function atbatPanel(d, e) {
  const side = d.battingTeam === 1 ? 'home' : d.battingTeam === 2 ? 'away' : (e.inningHalf === 'top' ? 'away' : 'home');
  const arr = ((d.players && d.players[side]) || []).filter(p => !p.pitcher).slice(0, 3);
  if (!arr.length) return '';
  const teamNm = side === 'home' ? TN(e.home, e.league) : TN(e.away, e.league);
  const rows = arr.map(p => {
    const nm = pName(p) || p.name || '-';
    const face = p.photo ? `<img class="ab-face" src="${esc(p.photo)}" referrerpolicy="no-referrer" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ab-face noimg',textContent:'🏏'}))">` : '<span class="ab-face noimg">🏏</span>';
    return `<div class="ab-row tsp" data-pid="${esc(p.id)}" data-side="${esc(side)}">${face}<span class="ab-nm">${esc(nm)}</span><span class="ab-pos">${esc(p.position || '')}</span><span class="ab-line">${esc(p.h == null ? 0 : p.h)}<i>/</i>${esc(p.ab == null ? 0 : p.ab)}</span></div>`;
  }).join('');
  return `<div class="odsec">🏏 ${esc(t('nowBatting'))} <span class="rhe">${esc(teamNm)}</span></div><div class="atbat">${rows}</div>`;
}
// ⚾ KBO/NPB 선수 클릭 → 최근 경기 기록 (서버가 그 팀 최근 완료경기에서 추출)
async function showTsPlayer(pid, side) {
  const box = $('#mPlayer'); if (!box || !pid) return;
  const e = feedGames[modalEventId]; if (!e) return;
  box.innerHTML = `<div class="pl-card"><div class="loading" style="padding:10px">${esc(t('loading'))}</div></div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const d = await fetchJSON(`/api/baseball/playerlog?pid=${encodeURIComponent(pid)}&match=${encodeURIComponent(e.id)}&side=${encodeURIComponent(side || '')}&date=${state.date}`, { tries: 1 });
    if (!d.found || !(d.games || []).length) { box.innerHTML = `<div class="pl-card"><div class="lu-note">${esc(t('boxSoon'))}</div></div>`; return; }
    const nm = (LANG === 'ko' && d.name_ko) ? d.name_ko : (d.name || '');
    const isPit = d.role === 'pitcher';
    const head = isPit
      ? `<th>${sl('date')}</th><th>${sl('opp')}</th><th>${sl('ip')}</th><th>${sl('er')}</th><th>${sl('k')}</th><th>BB</th>`
      : `<th>${sl('date')}</th><th>${sl('opp')}</th><th>${sl('ab')}</th><th>${sl('h')}</th><th>${sl('hr')}</th><th>${sl('rbi')}</th>`;
    const rows = d.games.map(g => {
      const s = g.stat || {}, md = (g.date || '').slice(5, 10), opp = teamShort(TN(g.opp, e.league));
      if (isPit) return `<tr><td>${esc(md)}</td><td>${esc(opp)}</td><td>${esc(s.ip ?? '-')}</td><td>${esc(s.er ?? '-')}</td><td>${esc(s.pk ?? '-')}</td><td>${esc(s.pbb ?? '-')}</td></tr>`;
      return `<tr><td>${esc(md)}</td><td>${esc(opp)}</td><td>${esc(s.ab ?? '-')}</td><td>${esc(s.h ?? '-')}</td><td>${esc(s.hr ?? '-')}</td><td>${esc(s.rbi ?? '-')}</td></tr>`;
    }).join('');
    const pic = d.photo ? `<img class="pl-face" src="${esc(d.photo)}" onerror="this.style.display='none'">` : '';
    box.innerHTML = `<div class="pl-card"><div class="pl-hd">${pic}🧢 ${esc(nm)} · ${esc(t('recent'))}</div><table class="pllog"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch { box.innerHTML = `<div class="pl-card"><div class="lu-note">-</div></div>`; }
}
function wireTsPlayers() { $$('#mLineupWrap .tsp').forEach(el => el.addEventListener('click', () => showTsPlayer(el.dataset.pid, el.dataset.side))); }
// ⚽ 축구 팀 경기 스탯 라벨 (ko/ja/zh, 그 외 언어는 영문 원문)
const FB_STAT_LBL = {
  'Ball Possession': { ko: '점유율', ja: 'ポゼッション', zh: '控球率' },
  'Total Shots': { ko: '슈팅', ja: 'シュート', zh: '射门' },
  'Shots on Goal': { ko: '유효슈팅', ja: '枠内シュート', zh: '射正' },
  'Shots off Goal': { ko: '유효슈팅 외', ja: '枠外シュート', zh: '射偏' },
  'Blocked Shots': { ko: '막힌 슈팅', ja: 'ブロック', zh: '被封堵' },
  'Shots insidebox': { ko: '박스 안 슈팅', ja: 'ボックス内', zh: '禁区内射门' },
  'Shots outsidebox': { ko: '박스 밖 슈팅', ja: 'ボックス外', zh: '禁区外射门' },
  'Corner Kicks': { ko: '코너킥', ja: 'CK', zh: '角球' },
  'Fouls': { ko: '파울', ja: 'ファウル', zh: '犯规' },
  'Offsides': { ko: '오프사이드', ja: 'オフサイド', zh: '越位' },
  'Yellow Cards': { ko: '경고', ja: 'イエロー', zh: '黄牌' },
  'Red Cards': { ko: '퇴장', ja: 'レッド', zh: '红牌' },
  'Goalkeeper Saves': { ko: '선방', ja: 'セーブ', zh: '扑救' },
  'Total passes': { ko: '패스', ja: 'パス', zh: '传球' },
  'Passes accurate': { ko: '정확한 패스', ja: '成功パス', zh: '成功传球' },
  'Passes %': { ko: '패스 성공률', ja: 'パス成功率', zh: '传球成功率' },
  'expected_goals': { ko: '기대득점 xG', ja: 'xG', zh: '预期进球' }
};
function fbStatLabel(type) { const m = FB_STAT_LBL[type]; if (m && (LANG === 'ko' || LANG === 'ja' || LANG === 'zh')) return m[LANG] || type; return type; }
function renderFbStats(teams, e) {
  const [h, a] = teams; const map = {};
  (h.stats || []).forEach(s => { map[s.type] = { home: s.value, away: null }; });
  (a.stats || []).forEach(s => { map[s.type] = Object.assign(map[s.type] || { home: null }, { away: s.value }); });
  const order = ['Ball Possession', 'Total Shots', 'Shots on Goal', 'Shots off Goal', 'Blocked Shots', 'Corner Kicks', 'Fouls', 'Offsides', 'Yellow Cards', 'Red Cards', 'Goalkeeper Saves', 'Total passes', 'Passes accurate', 'Passes %', 'expected_goals'];
  const types = order.filter(o => map[o]).concat(Object.keys(map).filter(k => !order.includes(k)));
  if (!types.length) return '';
  const num = v => { if (v == null) return 0; const n = parseFloat(String(v).replace('%', '')); return isNaN(n) ? 0 : n; };
  const rows = types.map(ty => {
    const hv = map[ty].home, av = map[ty].away, hn = num(hv), an = num(av), tot = hn + an || 1;
    const hp = Math.round(hn / tot * 100), ap = 100 - hp;
    return `<div class="fbs-row"><span class="fbs-v">${esc(hv == null ? '-' : String(hv))}</span><span class="fbs-lbl">${esc(fbStatLabel(ty))}</span><span class="fbs-v">${esc(av == null ? '-' : String(av))}</span></div><div class="fbs-bar"><span class="fbs-bh" style="width:${hp}%"></span><span class="fbs-ba" style="width:${ap}%"></span></div>`;
  }).join('');
  return `<div class="odsec">📊 ${esc(t('matchStats'))} <span class="rhe">${esc(TN(e.home, e.league))} · ${esc(TN(e.away, e.league))}</span></div><div class="fbstats">${rows}</div>`;
}
function fbpListHtml(tm) {
  if (!tm || !(tm.players || []).length) return `<div class="lu-note">-</div>`;
  const sorted = tm.players.slice().sort((x, y) => (parseFloat(y.rating) || 0) - (parseFloat(x.rating) || 0));
  return sorted.map(p => {
    const r = p.rating ? Number(p.rating).toFixed(1) : '-';
    const badges = [];
    if (p.goals) badges.push('⚽' + p.goals);
    if (p.assists) badges.push('🅰' + p.assists);
    if (p.yellow) badges.push('🟨'); if (p.red) badges.push('🟥');
    return `<div class="fbp-row"><span class="fbp-num">${p.number == null ? '' : esc(String(p.number))}</span>${p.photo ? `<img class="fbp-ph" src="${esc(p.photo)}" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : '<span class="fbp-ph noimg">👤</span>'}<span class="fbp-nm">${esc(p.name)}</span><span class="fbp-meta">${esc(p.pos || '')} ${badges.join(' ')}</span><span class="fbp-rt ${(parseFloat(p.rating) || 0) >= 7.5 ? 'hi' : ((parseFloat(p.rating) || 0) && (parseFloat(p.rating) < 6) ? 'lo' : '')}">${r}</span></div>`;
  }).join('');
}
function renderFbPlayers(teams, e) {
  if (teams.length < 1 || !(teams[0].players || []).length) return '';
  return `<div class="odsec">⭐ ${esc(t('playerRatings'))}</div><div class="bfield-tabs fbp-tabs"><span class="bft on" data-fp="0">${esc(TN(e.home, e.league))}</span><span class="bft" data-fp="1">${esc(TN(e.away, e.league))}</span></div><div id="fbpBox" class="fbplist">${fbpListHtml(teams[0])}</div>`;
}
async function loadFbStats(e) {
  const box = $('#mFbStats'); if (!box) return;
  box.innerHTML = `<div class="odsec">📊 ${esc(t('matchStats'))}</div><div class="lu-note" style="padding:8px">${esc(t('loading'))}</div>`;
  try {
    const [st, pl] = await Promise.all([
      fetchJSON(`/api/asports/fbstats?fixture=${encodeURIComponent(e.id)}`, { tries: 1 }).catch(() => ({ teams: [] })),
      fetchJSON(`/api/asports/fbplayers?fixture=${encodeURIComponent(e.id)}`, { tries: 1 }).catch(() => ({ teams: [] }))
    ]);
    let html = '';
    if (st.teams && st.teams.length === 2) html += renderFbStats(st.teams, e);
    if (pl.teams && pl.teams.length) html += renderFbPlayers(pl.teams, e);
    box.innerHTML = html || '';
    const plTeams = pl.teams || [];
    $$('#mFbStats .fbp-tabs .bft').forEach(tab => tab.addEventListener('click', () => {
      $$('#mFbStats .fbp-tabs .bft').forEach(x => x.classList.remove('on')); tab.classList.add('on');
      const b = $('#fbpBox'); if (b) b.innerHTML = fbpListHtml(plTeams[Number(tab.dataset.fp) || 0]);
    }));
  } catch { box.innerHTML = ''; }
}
async function updateLineup(e) {
  const box = $('#mLineupWrap'); if (!box) return;
  const sp = state.sport;
  if (sp === 'football') {
    box.innerHTML = `<div class="odsec">📋 ${esc(t('lineup'))}</div><div class="lineupbox"><div class="loading" style="padding:12px">${esc(t('loading'))}</div></div>`;
    try {
      const d = await fetchJSON(`/api/asports/lineups?fixture=${encodeURIComponent(e.id)}`, { tries: 1 });
      const teams = d.teams || [];
      if (teams.length < 2 || !(teams[0].startXI || []).length) { box.innerHTML = `<div class="odsec">📋 ${esc(t('lineup'))}</div><div class="lu-note">-</div><div id="mFbStats"></div>`; loadFbStats(e); return; }
      box.innerHTML = `<div class="odsec">📋 ${esc(t('lineup'))} <span class="rhe">${esc(teams[0].formation)} · ${esc(teams[1].formation)}</span></div>${teams.map(renderPitch).join('')}<div id="mPlayer"></div><div id="mFbStats"></div>`;
      wirePlayerClicks('football');
      loadFbStats(e);
    } catch { box.innerHTML = `<div class="odsec">📋 ${esc(t('lineup'))}</div><div class="lu-note">-</div>`; }
  } else if (statsLeague(e.league)) {
    box.innerHTML = `<div class="odsec">📋 ${esc(t('lineup'))}</div><div class="lineupbox"><div class="loading" style="padding:12px">${esc(t('loading'))}</div></div>`;
    try {
      const d = await fetchJSON(`/api/mlb/game?home=${encodeURIComponent(e.home)}&away=${encodeURIComponent(e.away)}&date=${state.date}`, { tries: 1 });
      if (!d.found || (!(d.home.lineup || []).length && !(d.away.lineup || []).length)) { box.innerHTML = `<div class="odsec">📋 ${esc(t('lineup'))}</div><div class="lu-note">-</div>`; return; }
      box.innerHTML = `
        <div class="odsec">📋 ${esc(t('lineup'))} <span class="rhe">${esc(t('fieldPos'))} · ${esc(t('tapPlayer'))}</span></div>
        <div class="bfield-tabs"><span class="bft on" data-t="home">${esc(TN(e.home, e.league))}</span><span class="bft" data-t="away">${esc(TN(e.away, e.league))}</span></div>
        <div id="bfieldBox">${mlbField(d.home, e.home)}</div>
        <div class="odsec">${esc(t('order'))}</div>
        <div class="mlb-lu">${mlbCol(d.home, e.home, e.league)}${mlbCol(d.away, e.away, e.league)}</div>
        <div id="mPlayer"></div>`;
      $$('#mLineupWrap .bft').forEach(t => t.addEventListener('click', () => {
        $$('#mLineupWrap .bft').forEach(x => x.classList.remove('on')); t.classList.add('on');
        const side = t.dataset.t === 'home' ? d.home : d.away, nm = t.dataset.t === 'home' ? e.home : e.away;
        $('#bfieldBox').innerHTML = mlbField(side, nm); wireFieldClicks();
      }));
      wirePlayerClicks('mlb'); wireFieldClicks();
    } catch { box.innerHTML = `<div class="odsec">📋 ${esc(t('lineup'))}</div><div class="lu-note">-</div>`; }
  } else if (sp === 'baseball' && tsLeague(e.league)) {
    box.innerHTML = `<div class="odsec">📋 ${esc(t('boxRec'))}</div><div class="lineupbox"><div class="loading" style="padding:12px">${esc(t('loading'))}</div></div>`;
    try {
      const d = await fetchJSON(`/api/baseball/box?id=${encodeURIComponent(e.id)}&live=${e.state === 'live' ? 1 : 0}`, { tries: 1 });
      if (!d.available || (!(d.players && d.players.home || []).length && !(d.players && d.players.away || []).length)) {
        box.innerHTML = `<div class="odsec">📋 ${esc(t('boxRec'))}</div><div class="lu-note">${esc(t('boxSoon'))}</div>`; return;
      }
      const render = t => { const side = t === 'home' ? 'home' : 'away'; const arr = side === 'home' ? d.players.home : d.players.away; $('#tsFieldBox').innerHTML = tsField(arr, side); $('#tsBoxBody').innerHTML = tsBoxSide(arr, side); wireTsPlayers(); };
      box.innerHTML = `${e.state === 'live' ? atbatPanel(d, e) : ''}
        <div class="odsec">📋 ${esc(t('lineup'))} <span class="rhe">${esc(t('fieldPos'))} · ${esc(t('tapPlayer'))}</span></div>
        <div class="bfield-tabs"><span class="bft on" data-t="home">${esc(TN(e.home, e.league))}</span><span class="bft" data-t="away">${esc(TN(e.away, e.league))}</span></div>
        <div id="tsFieldBox">${tsField(d.players.home, 'home')}</div>
        <div id="tsBoxBody">${tsBoxSide(d.players.home, 'home')}</div>
        <div id="mPlayer"></div>`;
      $$('#mLineupWrap .bft').forEach(tb => tb.addEventListener('click', () => {
        $$('#mLineupWrap .bft').forEach(x => x.classList.remove('on')); tb.classList.add('on');
        render(tb.dataset.t);
      }));
      wireTsPlayers();
    } catch { box.innerHTML = `<div class="odsec">📋 ${esc(t('boxRec'))}</div><div class="lu-note">-</div>`; }
  } else {
    box.innerHTML = `<div class="odsec">📋 ${esc(t('lineup'))}</div><div class="lu-note">${esc(t('lineup'))} — ${esc(t(sp))} · N/A</div>`;
  }
}
// 경기정보방: 투수·타자 기록 (박스스코어) — MLB·LMB
function boxTables(side) {
  const pit = `<table class="stt"><thead><tr><th>${sl('pitcher')}</th><th>${sl('ip')}</th><th>${sl('np')}</th><th>${sl('ha')}</th><th>${sl('er')}</th><th>${sl('k')}</th><th>${sl('bb')}</th></tr></thead><tbody>${
    (side.pitchers || []).map(p => `<tr><td class="nm">${esc(p.name)}</td><td>${esc(p.ip)}</td><td>${esc(p.np)}</td><td>${esc(p.h)}</td><td>${esc(p.er)}</td><td>${esc(p.k)}</td><td>${esc(p.bb)}</td></tr>`).join('') || '<tr><td colspan="7">-</td></tr>'
    }</tbody></table>`;
  const bat = `<table class="stt" style="margin-top:8px"><thead><tr><th>${sl('batter')}</th><th></th><th>${sl('ab')}</th><th>${sl('h')}</th><th>${sl('bb')}</th><th>${sl('rbi')}</th><th>${sl('hr')}</th><th>${sl('k')}</th></tr></thead><tbody>${
    (side.batters || []).map(b => `<tr><td class="nm">${esc(b.name)}</td><td class="lr">${esc(b.pos)}</td><td>${esc(b.ab)}</td><td>${esc(b.h)}</td><td>${esc(b.bb)}</td><td>${esc(b.rbi)}</td><td>${esc(b.hr)}</td><td>${esc(b.k)}</td></tr>`).join('') || '<tr><td colspan="8">-</td></tr>'
    }</tbody></table>`;
  return pit + bat;
}
async function updateBox(e) {
  const box = $('#mBoxWrap'); if (!box) return;
  if (!statsLeague(e.league)) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="odsec">📋 ${esc(t('boxRec'))}</div><div class="lu-note">${esc(t('loading'))}</div>`;
  try {
    const d = await fetchJSON(`/api/mlb/boxscore?home=${encodeURIComponent(e.home)}&away=${encodeURIComponent(e.away)}&date=${state.date}`, { tries: 1 });
    if (!d.found || (!(d.home.batters || []).length && !(d.away.batters || []).length)) { box.innerHTML = `<div class="odsec">📋 ${esc(t('boxRec'))}</div><div class="lu-note">-</div>`; return; }
    box.innerHTML = `<div class="odsec">📋 ${esc(t('boxRec'))} <span class="rhe">${sl('pitcher')}·${sl('batter')}</span></div>
      <div class="bfield-tabs"><span class="bft on" data-t="home">${esc(TN(e.home, e.league))}</span><span class="bft" data-t="away">${esc(TN(e.away, e.league))}</span></div>
      <div id="boxBody">${boxTables(d.home)}</div>`;
    $$('#mBoxWrap .bft').forEach(t => t.addEventListener('click', () => {
      $$('#mBoxWrap .bft').forEach(x => x.classList.remove('on')); t.classList.add('on');
      $('#boxBody').innerHTML = boxTables(t.dataset.t === 'home' ? d.home : d.away);
    }));
  } catch { box.innerHTML = `<div class="odsec">📋 ${esc(t('boxRec'))}</div><div class="lu-note">-</div>`; }
}
// 경기정보방: 예상 선발투수 + 양팀 최근 10경기 (MLB·LMB)
async function updateInfo(e) {
  const box = $('#mInfoWrap'); if (!box) return;
  // ⚾ KBO/NPB: 양팀 최근 10경기 (TheSports diary 기반)
  if (!statsLeague(e.league) && state.sport === 'baseball' && tsLeague(e.league)) {
    box.innerHTML = '';
    try {
      const d = await fetchJSON(`/api/baseball/teamrecent?match=${encodeURIComponent(e.id)}&date=${state.date}`, { tries: 1 });
      if (!d.found) return;
      const col = (nm, arr) => `<div class="recol"><div class="rec-hd">${esc(nm)}</div>${(arr || []).map(g => `<div class="rec-row"><span class="rb ${g.win ? 'W' : (g.draw ? 'D' : 'L')}">${g.win ? 'W' : (g.draw ? 'D' : 'L')}</span><span class="ro">${esc(teamShort(TN(g.opp, e.league)))}</span><span class="rs">${esc(g.ts)}:${esc(g.os)}</span></div>`).join('') || `<div class="rec-empty">-</div>`}</div>`;
      const h = d.home && d.home.games || [], a = d.away && d.away.games || [];
      let html = '';
      if (h.length || a.length) html += `<div class="odsec">📅 ${esc(t('recent'))} <span class="rhe">${esc(t('last10'))}</span></div><div class="recent2">${col(TN(e.away, e.league), a)}${col(TN(e.home, e.league), h)}</div>`;
      // 🆚 상대전적(H2H)
      const hh = d.h2h || [];
      if (hh.length) {
        html += `<div class="odsec">⚔️ ${esc(t('h2h'))}</div><div class="h2hbox">${hh.map(g => {
          const md = (g.date ? new Date(g.date).toISOString() : '').slice(5, 10);
          return `<div class="h2h-row"><span class="h2h-d">${esc(md)}</span><span class="h2h-t">${esc(teamShort(TN(g.aName, e.league)))}</span><span class="h2h-s">${esc(g.as)}:${esc(g.hs)}</span><span class="h2h-t r">${esc(teamShort(TN(g.hName, e.league)))}</span></div>`;
        }).join('')}</div>`;
      }
      box.innerHTML = html;
    } catch { }
    return;
  }
  if (!statsLeague(e.league)) { box.innerHTML = ''; return; }
  box.innerHTML = '';
  try {
    const d = await fetchJSON(`/api/mlb/info?home=${encodeURIComponent(e.home)}&away=${encodeURIComponent(e.away)}&date=${state.date}`, { tries: 1 });
    if (!d.found) return;
    let html = '';
    const p = d.probable || {};
    if (p.home || p.away) {
      const row = (nm, pp) => pp ? `<tr><td class="tn">${esc(nm)}</td><td class="nm">${esc(pp.name)}</td><td><b>${esc(pp.w)}${sl('w')} ${esc(pp.l)}${sl('l')}</b> ${esc(pp.era)}</td><td>${esc(pp.ip)}${sl('ip')} ${esc(pp.k)}K ${esc(pp.bb)}BB</td></tr>` : '';
      html += `<div class="odsec">🎯 ${esc(t('probable'))}</div><table class="stt inf"><tbody>${row(TN(e.home, e.league), p.home)}${row(TN(e.away, e.league), p.away)}</tbody></table>`;
    }
    const rc = d.recent || {};
    const col = (nm, arr) => `<div class="recol"><div class="rec-hd">${esc(nm)}</div>${(arr || []).map(g => `<div class="rec-row clik" data-gp="${esc(g.gamePk || '')}"><span class="rb ${g.win ? 'W' : 'L'}">${g.win ? 'W' : 'L'}</span><span class="ro">${esc(teamShort(g.opp))}</span><span class="rs">${esc(g.ts)}:${esc(g.os)}</span></div>`).join('') || '<div class="rec-empty">-</div>'}</div>`;
    if ((rc.home && rc.home.length) || (rc.away && rc.away.length)) {
      html += `<div class="odsec">📅 ${esc(t('recent'))}</div><div class="recent2">${col(TN(e.home, e.league), rc.home)}${col(TN(e.away, e.league), rc.away)}</div>`;
    }
    // 맞대결(H2H)
    const h = d.h2h || [];
    if (h.length) {
      html += `<div class="odsec">⚔️ ${esc(t('h2h'))} <span class="rhe">${esc(t('tapDetail'))}</span></div><div class="h2hbox">${h.map(g => {
        const md = (g.date || '').slice(5);
        return `<div class="h2h-row clik" data-gp="${esc(g.gamePk || '')}"><span class="h2h-d">${esc(md)}</span><span class="h2h-t">${esc(teamShort(g.home))}</span><span class="h2h-s">${esc(g.hs)}:${esc(g.as)}</span><span class="h2h-t r">${esc(teamShort(g.away))}</span></div>`;
      }).join('')}</div>`;
    }
    // 팀 순위표
    const st = d.standings || [];
    if (st.length) {
      html += `<div class="odsec">🏆 ${esc(t('standings'))}</div><table class="stt stdtbl"><thead><tr><th>#</th><th>${sl('team')}</th><th>${sl('w')}</th><th>${sl('l')}</th><th>${sl('pct')}</th><th>${sl('rs')}</th><th>${sl('ra')}</th><th>${sl('streak')}</th></tr></thead><tbody>${
        st.map(r => `<tr class="${r.hl ? 'hl' : ''}"><td>${esc(r.rank)}</td><td class="nm">${esc(teamShort(r.name))}</td><td>${esc(r.w)}</td><td>${esc(r.l)}</td><td>${esc(String(r.pct).replace(/^0/, ''))}</td><td>${esc(r.rs)}</td><td>${esc(r.ra)}</td><td>${esc(r.streak)}</td></tr>`).join('')
        }</tbody></table>`;
    }
    html += `<div id="mMini"></div>`;
    box.innerHTML = html;
    // 최근경기·맞대결 행 클릭 → 그 경기 상세(이닝스코어+투수/타자) 펼쳐보기
    $$('#mInfoWrap .clik[data-gp]').forEach(el => el.addEventListener('click', () => showMini(el.dataset.gp)));
  } catch {}
}
async function showMini(gp) {
  const box = $('#mMini'); if (!box || !gp) return;
  box.innerHTML = `<div class="minigame"><div class="lu-note">${esc(t('loading'))}</div></div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const d = await fetchJSON('/api/mlb/gamebox?gamePk=' + encodeURIComponent(gp), { tries: 1 });
    const nInn = Math.max(9, ...((d.innings || []).map(i => i.num)));
    const head = Array.from({ length: nInn }, (_, k) => `<th>${k + 1}</th>`).join('');
    const cell = who => Array.from({ length: nInn }, (_, k) => { const i = (d.innings || []).find(x => x.num === k + 1); const v = i ? i[who] : null; return `<td>${v == null ? '' : esc(v)}</td>`; }).join('');
    const ls = `<table class="boxsc"><thead><tr><th></th>${head}<th class="r">R</th><th class="he">H</th><th class="he">E</th></tr></thead><tbody>
      <tr><td class="tn">${esc(teamShort(d.away.name))}</td>${cell('away')}<td class="r">${esc(d.away.r ?? 0)}</td><td class="he">${esc(d.away.h ?? 0)}</td><td class="he">${esc(d.away.e ?? 0)}</td></tr>
      <tr><td class="tn">${esc(teamShort(d.home.name))}</td>${cell('home')}<td class="r">${esc(d.home.r ?? 0)}</td><td class="he">${esc(d.home.h ?? 0)}</td><td class="he">${esc(d.home.e ?? 0)}</td></tr>
    </tbody></table>`;
    const pit = s => `<table class="stt"><thead><tr><th>${sl('pitcher')}</th><th>${sl('ip')}</th><th>${sl('h')}</th><th>${sl('er')}</th><th>${sl('k')}</th></tr></thead><tbody>${(s.pitchers || []).map(p => `<tr><td class="nm">${esc(p.name)}</td><td>${esc(p.ip)}</td><td>${esc(p.h)}</td><td>${esc(p.er)}</td><td>${esc(p.k)}</td></tr>`).join('')}</tbody></table>`;
    const bat = s => `<table class="stt" style="margin-top:6px"><thead><tr><th>${sl('batter')}</th><th></th><th>${sl('ab')}</th><th>${sl('h')}</th><th>${sl('rbi')}</th></tr></thead><tbody>${(s.batters || []).map(b => `<tr><td class="nm">${esc(b.name)}</td><td class="lr">${esc(b.pos)}</td><td>${esc(b.ab)}</td><td>${esc(b.h)}</td><td>${esc(b.rbi)}</td></tr>`).join('')}</tbody></table>`;
    box.innerHTML = `<div class="minigame">
      <div class="mini-hd">📋 ${esc(teamShort(d.away.name))} ${esc(d.away.r ?? 0)} : ${esc(d.home.r ?? 0)} ${esc(teamShort(d.home.name))} <span class="mini-x" id="miniX">${esc(t('close'))}</span></div>
      ${ls}
      <div class="bfield-tabs"><span class="mgt on" data-s="away">${esc(teamShort(d.away.name))}</span><span class="mgt" data-s="home">${esc(teamShort(d.home.name))}</span></div>
      <div id="mgBody">${pit(d.away)}${bat(d.away)}</div></div>`;
    $('#miniX')?.addEventListener('click', () => { box.innerHTML = ''; });
    $$('#mMini .mgt').forEach(t => t.addEventListener('click', () => {
      $$('#mMini .mgt').forEach(x => x.classList.remove('on')); t.classList.add('on');
      const s = t.dataset.s === 'home' ? d.home : d.away;
      $('#mgBody').innerHTML = pit(s) + bat(s);
    }));
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch { box.innerHTML = `<div class="minigame"><div class="lu-note">불러오기 실패</div></div>`; }
}
// 야구 이닝별 라인스코어(R·H·E) 표
function lineScoreTable(e) {
  if (state.sport !== 'baseball' || !e.box) return '';
  const bh = e.box.home, ba = e.box.away;
  const hi = bh.innings || {}, ai = ba.innings || {};
  const nums = Object.keys(hi).concat(Object.keys(ai)).map(Number).filter(Boolean);
  const nInn = Math.min(Math.max(nums.length ? Math.max.apply(null, nums) : 9, 9), 12);
  const head = Array.from({ length: nInn }, (_, k) => `<th>${k + 1}</th>`).join('');
  const cells = inn => Array.from({ length: nInn }, (_, k) => {
    const v = inn[k + 1] ?? inn[String(k + 1)];
    return `<td>${v == null || v === '' ? '' : esc(v)}</td>`;
  }).join('');
  const showBB = true;
  return `<div class="odsec">📊 ${esc(t('inningScore'))} <span class="rhe">R · H · E${showBB ? ' · BB' : ''}</span></div>
    <table class="boxsc"><thead><tr><th></th>${head}<th class="r">R</th><th class="he">H</th><th class="he">E</th>${showBB ? '<th class="he">BB</th>' : ''}</tr></thead>
    <tbody>
      <tr><td class="tn">${esc(TN(e.away, e.league))}</td>${cells(ai)}<td class="r">${esc(ba.r ?? 0)}</td><td class="he">${esc(ba.h ?? 0)}</td><td class="he">${esc(ba.e ?? 0)}</td>${showBB ? `<td class="he">${esc(ba.bb ?? '-')}</td>` : ''}</tr>
      <tr><td class="tn">${esc(TN(e.home, e.league))}</td>${cells(hi)}<td class="r">${esc(bh.r ?? 0)}</td><td class="he">${esc(bh.h ?? 0)}</td><td class="he">${esc(bh.e ?? 0)}</td>${showBB ? `<td class="he">${esc(bh.bb ?? '-')}</td>` : ''}</tr>
    </tbody></table>`;
}
function renderDetail(e, pr) {
  const el = $('#mDetail'); if (!el) return;
  const st = e.state === 'live' ? ('● ' + koStatus(e)) : (e.state === 'finished' ? t('finished') : hhmm(e.date));
  const scoreTxt = (e.state === 'scheduled' || (e.hs == null && e.as == null)) ? 'VS' : `${esc(e.hs ?? 0)} : ${esc(e.as ?? 0)}`;
  const setSports = (state.sport === 'volleyball' || state.sport === 'hockey');
  const setpts = (setSports && e.livePts && e.state === 'live') ? `<div class="msc-set">${esc(t('now'))} ${esc(t('setWord'))} ${esc(e.livePts.home ?? 0)}:${esc(e.livePts.away ?? 0)}</div>` : '';
  const dd = e.date ? new Date(e.date) : null;
  const when = dd ? `${dd.getMonth() + 1}/${dd.getDate()} ${hhmm(e.date)}` : '';
  const odds = e.odds ? `<div class="odsec">💰 ${esc(t('odds'))}</div><div class="modds-detail">${esc(t('win'))} <b>${e.odds.home ? Number(e.odds.home).toFixed(2) : '-'}</b>${e.odds.draw ? ` · ${esc(t('draw'))} <b>${Number(e.odds.draw).toFixed(2)}</b>` : ''} · ${esc(t('loss'))} <b>${e.odds.away ? Number(e.odds.away).toFixed(2) : '-'}</b></div>` : '';
  // 점수판은 별도 영역(#mScore)에 — 그 바로 밑에 하이라이트(#mYtWrap)가 오도록
  const sc = $('#mScore');
  // 팀 이름 바로 아래 AI 해설 (라이브=생동감 한 줄 / 그 외=요약 첫 줄)
  const topAI = e.state === 'live' ? aiLive(e) : `<div class="ailive">🤖 <b>${esc(t('aiComm'))}</b> ${aiSummary(e)[0] || ''}</div>`;
  if (sc) sc.innerHTML = `
    <div class="mteams">
      <div class="mt">${HA_HOME}<div class="ph">${badge(e.homeLogo, '🏟')}</div><div class="nm">${esc(TN(e.home, e.league))}</div></div>
      <div class="msc"><div class="n">${scoreTxt}</div><div class="st" style="color:${e.state === 'live' ? '#e2231a' : '#8b93a0'}">${esc(st)}</div>${setpts}</div>
      <div class="mt">${HA_AWAY}<div class="ph">${badge(e.awayLogo, '🏟')}</div><div class="nm">${esc(TN(e.away, e.league))}</div></div>
    </div>
    ${topAI}`;
  el.innerHTML = `
    <div id="mMlbLive"></div>
    ${lineScoreTable(e)}
    ${odds}
    <div class="aisum">
      <div class="aisum-hd">🤖 ${esc(t('aiSum'))} ${e.state === 'live' ? '<span class="aisum-live">● LIVE</span>' : ''}</div>
      ${aiSummary(e).map(l => `<p>${l}</p>`).join('')}
    </div>
    <div class="odsec">📻 ${esc(t('liveEv'))} <span class="rhe">${esc(t('aiAuto'))}${state.sport === 'football' ? ' · ' + esc(t('goalsCards')) : ' · ' + esc(t('runsHits'))}</span></div>
    <div id="mEvents" class="evfeed">${eventEmpty()}</div>
    <div class="probwrap">
      <div class="probttl"><span>🤖 ${esc(t('aiPred'))}</span><span>${esc(t('confidence'))} ${pr.confidence}%</span></div>
      <div class="probbar"><div class="pw" style="width:${pr.home}%">${pr.home}%</div><div class="pd" style="width:${pr.draw}%">${pr.draw}%</div><div class="pl" style="width:${pr.away}%">${pr.away}%</div></div>
      <div class="problbl"><span>${esc(TN(e.home, e.league))} ${esc(t('win'))}</span><span>${esc(t('draw'))}</span><span>${esc(TN(e.away, e.league))} ${esc(t('win'))}</span></div>
    </div>
    <div class="minfo">
      <div><span class="k">${esc(t('league'))}</span> ${esc(e.league)}</div>
      <div><span class="k">${esc(t('dt'))}</span> ${esc(when)}</div>
      <div><span class="k">${esc(t('status'))}</span> ${esc(koStatus(e))}</div>
    </div>`;
  updateEvents(e);   // 실시간 이벤트 피드 채우기 (축구=API / 그외=변화감지 로그)
  if (statsLeague(e.league)) updateMlbLive(e);   // MLB·LMB·IL·PCL 실시간 볼카운트·주자·타자/투수 (10초 갱신)
}
async function openEvent(id) {
  const e = feedGames[id]; if (!e) return;
  modalEventId = id;
  evTabPin[id] = false;   // 재입장 시 현재 이닝/전반후반 자동 선택
  $('#scrim').classList.add('on'); $('#modal').classList.add('on');
  $('#mTitle').textContent = e.league || '경기 상세';
  $('#mBody').innerHTML = `
    <div id="mScore"></div>
    <div id="mYtWrap"></div>
    <div id="mDetail"><div class="loading">${esc(t('loading'))}</div></div>
    <div id="mBoxWrap"></div>
    <div id="mInfoWrap"></div>
    <div id="mLineupWrap"></div>
    <div class="mchat-embed">
      <div class="mce-hd">💬 <b>${esc(TN(e.home, e.league))} vs ${esc(TN(e.away, e.league))}</b> 대화방 <span class="mce-tag">보면서 채팅</span> <span class="mce-on">🟢 <b id="onlineM">0</b></span></div>
      <div id="mChatPane" class="chatpane embed"></div>
    </div>`;
  // 상세를 보면서 채팅 — 별도 입장 없이 이 경기 방에 바로 연결
  modalChatUI = buildChatUI($('#mChatPane'));
  joinRoom(`event:${e.id}`, `${e.home} vs ${e.away}`);
  const pr = await fetch(`/api/predict?h=${e.hs ?? ''}&a=${e.as ?? ''}`).then(r => r.json()).catch(() => ({ home: 40, draw: 25, away: 35, confidence: 60 }));
  modalPredict = pr;
  logChanges(id, feedGames[id] || e);   // 스냅샷 시드 (이후 변화만 이벤트로 기록)
  renderDetail(feedGames[id] || e, pr);
  updateLineup(feedGames[id] || e);     // 라인업은 한 번만 로드 (10초 갱신 때 초기화 방지)
  updateBox(feedGames[id] || e);        // 경기정보방: 투수·타자 기록
  updateInfo(feedGames[id] || e);       // 예상 선발투수 + 최근 10경기
  buildYt(feedGames[id] || e);          // 하이라이트 재생 버튼 (한 번만 · 재생 유지)
}
// YouTube 하이라이트 — 화면 안에서 ▶ 재생 (키 있으면 인라인, 없으면 링크 폴백)
function ytFallback(q, msg) {
  return `<div class="odsec">📺 ${esc(t('highlight'))}</div>${msg ? `<div class="lu-note">${esc(msg)}</div>` : ''}<a class="ythl" href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}" target="_blank" rel="noopener">${esc(t('ytWatch'))}</a>`;
}
function buildYt(e) {
  const box = $('#mYtWrap'); if (!box) return;
  const q = e.away + ' vs ' + e.home + ' ' + (e.league || '') + ' highlights';
  box.innerHTML = `<div class="odsec">📺 ${esc(t('highlight'))}</div><button class="ythl-play" id="ytPlay">${esc(t('playHi'))}</button>`;
  $('#ytPlay')?.addEventListener('click', async () => {
    const btn = $('#ytPlay'); if (btn) { btn.textContent = t('ytLoading'); btn.disabled = true; }
    try {
      const d = await fetchJSON('/api/youtube?q=' + encodeURIComponent(q), { tries: 1 });
      if (d.needKey) { box.innerHTML = ytFallback(q, t('ytNeedKey')); return; }
      if (!d.videoId) { box.innerHTML = ytFallback(q, t('ytNotFound')); return; }
      box.innerHTML = `<div class="odsec">📺 ${esc(t('highlight'))} <span class="rhe">${esc((d.title || '').slice(0, 40))}</span></div><div class="ytembed"><iframe src="https://www.youtube.com/embed/${encodeURIComponent(d.videoId)}?autoplay=1&rel=0" title="highlights" allow="autoplay; encrypted-media; fullscreen" allowfullscreen frameborder="0"></iframe></div>`;
    } catch { box.innerHTML = ytFallback(q, t('ytFail')); }
  });
}
function closeModal() {
  $('#scrim').classList.remove('on'); $('#modal').classList.remove('on');
  if (modalChatUI) {
    const i = chatUIs.indexOf(modalChatUI); if (i >= 0) chatUIs.splice(i, 1);
    modalChatUI = null; joinRoom('all', '전경기 대화방');
  }
  modalEventId = null; modalPredict = null;
}
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
let oddsSport = 'soccer_epl';   // (레거시 · 배당 상세 계산기에서만 사용)
// ============================================================
//  🎯 픽 제공 (구 배당 메뉴) — 전 경기 승률·시장 컨센서스·LIVE UP 분석
// ============================================================
const SPORT_EN = { football: 'Football', baseball: 'Baseball', basketball: 'Basketball', volleyball: 'Volleyball', hockey: 'Hockey', handball: 'Handball', rugby: 'Rugby' };
function sportLabel(s) { return LANG === 'ko' ? s.ko : (SPORT_EN[s.key] || s.key); }
let pickHubSport = 'football', pickHubGames = [];
function initOdds() { pickHubSport = state.sport || 'football'; buildPickHubNav(); loadPickHub(); }
function buildPickHubNav() {
  const box = $('#oddsChips'); if (!box) return;
  box.innerHTML = SPORTS.map(s => `<div class="ochip ${s.key === pickHubSport ? 'on' : ''}" data-psport="${s.key}">${s.em} ${esc(sportLabel(s))}</div>`).join('');
  $$('#oddsChips .ochip').forEach(c => c.addEventListener('click', () => {
    pickHubSport = c.dataset.psport;
    state.leagueFilter = 'all';   // 종목 바꾸면 리그 필터 초기화 (이전 종목 리그 잔존 방지)
    $$('#oddsChips .ochip').forEach(x => x.classList.toggle('on', x.dataset.psport === pickHubSport));
    $$('#leagueRow .lgchip').forEach(x => x.classList.toggle('on', x.dataset.lg === 'all'));
    loadPickHub();
  }));
}
// 시장 컨센서스 = 배당 내재확률(마진 제거). 배당 없으면 null
function marketProb(e) {
  const o = e.odds || {}; if (!(o.home && o.away)) return null;
  const ih = 1 / o.home, id = o.draw ? 1 / o.draw : 0, ia = 1 / o.away, s = ih + id + ia;
  const home = Math.round(ih / s * 100), draw = Math.round(id / s * 100);
  return { home, draw, away: 100 - home - draw };
}
// LIVE UP 데이터 분석 = 시장(있으면) 기반 + 홈 어드밴티지 + 최근폼(선택) 반영
function luProb(e, fh, fa) {
  const m = marketProb(e);
  let home, draw, away;
  if (m) { home = m.home; draw = m.draw; away = m.away; }
  else { const p = pickProb(e); home = p.home; draw = p.draw; away = p.away; }
  home += 3; away -= 1;   // 홈 어드밴티지
  const wr = arr => { const s = (arr || []).slice(0, 5); return s.length ? s.filter(g => g.win).length / s.length : null; };
  const wh = wr(fh), wa = wr(fa);
  if (wh != null && wa != null) { const dd = Math.round((wh - wa) * 10); home += dd; away -= dd; }
  home = Math.max(3, Math.min(94, home)); away = Math.max(3, Math.min(94, away));
  draw = Math.max(1, 100 - home - away); const s = home + draw + away;
  home = Math.round(home / s * 100); draw = Math.round(draw / s * 100); away = 100 - home - draw;
  const side = (home >= away && home >= draw) ? 'home' : (away >= draw ? 'away' : 'draw');
  return { home, draw, away, side };
}
function phbBar(h, a) { return `<span class="phb-bar"><i class="phb-h" style="width:${h}%"></i><i class="phb-a" style="width:${a}%"></i></span>`; }
function pickCard(e) {
  const lu = luProb(e), m = marketProb(e);
  const pickName = lu.side === 'home' ? TN(e.home, e.league) : lu.side === 'away' ? TN(e.away, e.league) : t('draw');
  const pct = lu.side === 'home' ? lu.home : lu.side === 'away' ? lu.away : lu.draw;
  const stx = e.state === 'live' ? `<span style="color:var(--red);font-weight:800">● ${esc(koStatus(e))}</span>` : e.state === 'finished' ? esc(t('finished')) : (e.date ? hhmm(e.date) : '');
  return `<div class="pickcard phub" data-pick="${esc(e.id)}">
    <div class="pk-top"><span class="pk-lg">${esc(e.league)}</span><span class="pk-t">${stx}</span></div>
    <div class="pk-mid">
      <div class="pk-team"><div class="pk-ph">${badge(e.homeLogo, '🏟')}</div><div class="pk-nm">${esc(TN(e.home, e.league))}</div></div>
      <div class="pk-vs">VS</div>
      <div class="pk-team"><div class="pk-ph">${badge(e.awayLogo, '🏟')}</div><div class="pk-nm">${esc(TN(e.away, e.league))}</div></div>
    </div>
    <div class="phub-bars">
      ${m ? `<div class="phb-row"><span class="phb-l">${esc(t('marketCons'))}</span>${phbBar(m.home, m.away)}<span class="phb-v">${m.home}·${m.away}</span></div>` : ''}
      <div class="phb-row lu"><span class="phb-l">LIVE UP</span>${phbBar(lu.home, lu.away)}<span class="phb-v">${lu.home}·${lu.away}</span></div>
    </div>
    <div class="pk-rec phub-pick"><span class="pk-recl">🎯 ${esc(t('finalPick'))}</span> <b>${esc(pickName)} ${pct}%</b></div>
  </div>`;
}
async function loadPickHub() {
  const board = $('#oddsBoard'); if (!board) return;
  board.innerHTML = `<div class="loading">${esc(t('loadingGames'))}</div>`;
  try {
    const d = await fetchJSON(`/api/asports/games?sport=${encodeURIComponent(pickHubSport)}&date=${state.date}&tz=${encodeURIComponent(USER_TZ)}`, { tries: 2, delay: 3000, onWait: n => { board.innerHTML = `<div class="loading">⏳ (${n})</div>`; } });
    let games = d.games || [];
    games.forEach(g => { feedGames[g.id] = g; });
    games.sort((a, b) => (b.state === 'live') - (a.state === 'live'));
    pickHubGames = games;
    renderPickHubList();
  } catch { board.innerHTML = `<div class="loading">-</div>`; }
}
// 픽 목록 렌더 (상단 리그칩 필터 적용) — 리그칩 클릭 시에도 이걸로 다시 그림
function renderPickHubList() {
  const board = $('#oddsBoard'); if (!board) return;
  const games = state.leagueFilter === 'all' ? pickHubGames : (pickHubGames || []).filter(g => g.league === state.leagueFilter);
  if (!games || !games.length) { board.innerHTML = `<div class="loading">${esc(t('noPickGames'))}</div>`; return; }
  board.innerHTML = games.map(pickCard).join('') + `<div class="foot">${esc(t('pickWarn'))}</div>`;
  $$('#oddsBoard .pickcard').forEach(c => c.addEventListener('click', () => { state.sport = pickHubSport; openPick(c.dataset.pick); }));
}
// 📌 픽 요약 블록 (시장 컨센서스 + LIVE UP 분석 + 최종 PICK) — 폼 로드 후 갱신됨
function pickSummaryHtml(e, fh, fa) {
  const m = marketProb(e), lu = luProb(e, fh, fa);
  const pickName = lu.side === 'home' ? TN(e.home, e.league) : lu.side === 'away' ? TN(e.away, e.league) : t('draw');
  const pct = lu.side === 'home' ? lu.home : lu.side === 'away' ? lu.away : lu.draw;
  const marketRow = m
    ? `<div class="psum-row"><span class="psum-l">${esc(t('marketCons'))} <small>${esc(t('oddsAgg'))}</small></span>${phbBar(m.home, m.away)}<span class="psum-v">${m.home}% · ${m.away}%</span></div>`
    : `<div class="psum-row"><span class="psum-l">${esc(t('marketCons'))}</span><span class="psum-none">${esc(t('oddsSoon'))}</span></div>`;
  return `<div class="ps-hd">📌 ${esc(t('pickSummary'))}</div>
    <div class="psum">
      ${marketRow}
      <div class="psum-row"><span class="psum-l">${esc(t('luAnalysis'))}</span>${phbBar(lu.home, lu.away)}<span class="psum-v">${lu.home}% · ${lu.away}%</span></div>
      <div class="psum-final">🎯 ${esc(t('finalPick'))} → <b>${esc(pickName)}</b> <span class="psum-fp">${pct}%</span></div>
    </div>`;
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
let infoGames = [];   // 정보방 전체 경기(필터 전)
// 경기 정보방: 현재 종목의 실제 경기 목록 → 클릭 시 실제 상세(라인업·투수/타자 기록 포함)
async function initInfo() {
  const list = $('#infoList'); if (!list) return;
  list.innerHTML = `<div class="loading">${esc(t('loadingGames'))}</div>`;
  try {
    const d = await fetchJSON(`/api/asports/games?sport=${encodeURIComponent(state.sport)}&date=${state.date}&tz=${encodeURIComponent(USER_TZ)}`, { tries: 2, delay: 3000 });
    const games = d.games || [];
    games.forEach(g => { feedGames[g.id] = g; });   // openEvent가 사용
    games.sort((a, b) => (b.state === 'live') - (a.state === 'live'));
    infoGames = games;
    renderInfoList();
  } catch { list.innerHTML = `<div class="loading">불러오지 못했습니다.</div>`; }
}
// 정보방 목록 렌더 (상단 리그 칩 필터 적용) → 클릭 시 PICK 상세
function renderInfoList() {
  const list = $('#infoList'); if (!list) return;
  const games = state.leagueFilter === 'all' ? infoGames : infoGames.filter(g => g.league === state.leagueFilter);
  if (!games.length) { list.innerHTML = `<div class="loading">${esc(t('noGames'))}</div>`; return; }
  list.innerHTML = games.map(g => {
    const stx = g.state === 'live' ? `<span style="color:var(--red);font-weight:800">● ${esc(koStatus(g))}</span>` : g.state === 'finished' ? esc(t('finished')) : hhmm(g.date);
    const p = pickProb(g), rec = p.home >= p.away ? TN(g.home, g.league) : TN(g.away, g.league);
    return `<div class="pickcard" data-pick="${esc(g.id)}">
      <div class="pk-top"><span class="pk-lg">${esc(g.league)}</span><span class="pk-t">${stx}</span></div>
      <div class="pk-mid">
        <div class="pk-team"><div class="pk-ph">${badge(g.homeLogo, '🏟')}</div><div class="pk-nm">${esc(TN(g.home, g.league))}</div></div>
        <div class="pk-vs">VS</div>
        <div class="pk-team"><div class="pk-ph">${badge(g.awayLogo, '🏟')}</div><div class="pk-nm">${esc(TN(g.away, g.league))}</div></div>
      </div>
      <div class="pk-rec"><span class="pk-recl">🎯 ${esc(t('pickReco'))}</span> <b>${esc(rec)} ${p.home >= p.away ? p.home : p.away}%</b></div>
    </div>`;
  }).join('');
  $$('#infoList .pickcard').forEach(c => c.addEventListener('click', () => openPick(c.dataset.pick)));
}
// 승률 계산 — 배당(내재확률) 우선, 없으면 스코어 기반
function pickProb(e) {
  const o = e.odds || {};
  if (o.home && o.away) {
    const ih = 1 / o.home, id = o.draw ? 1 / o.draw : 0, ia = 1 / o.away, s = ih + id + ia;
    let home = Math.round(ih / s * 100), draw = Math.round(id / s * 100), away = 100 - home - draw;
    return { home, draw, away, conf: Math.min(92, 55 + Math.abs(home - away)), src: 'odds' };
  }
  const h = Number(e.hs), a = Number(e.as), diff = (!isNaN(h) && !isNaN(a)) ? h - a : 0;
  let home = Math.max(8, Math.min(85, 42 + diff * 11)), away = Math.max(8, Math.min(85, 42 - diff * 11));
  let draw = Math.max(6, 100 - home - away); const s = home + draw + away;
  home = Math.round(home / s * 100); draw = Math.round(draw / s * 100); away = 100 - home - draw;
  return { home, draw, away, conf: Math.min(90, 58 + Math.abs(diff) * 8), src: 'form' };
}
// 종합지표 도넛 (홈/무/원정)
function pickDonut(p) {
  const R = 52, C = 2 * Math.PI * R;
  const seg = (val, off, cls) => `<circle class="dn ${cls}" cx="70" cy="70" r="${R}" stroke-dasharray="${(val / 100 * C).toFixed(1)} ${C}" stroke-dashoffset="${(-off / 100 * C).toFixed(1)}"/>`;
  const lead = Math.max(p.home, p.draw, p.away);
  return `<svg viewBox="0 0 140 140" class="donut">
    <circle cx="70" cy="70" r="${R}" class="dn-bg"/>
    ${seg(p.home, 0, 'h')}${seg(p.draw, p.home, 'd')}${seg(p.away, p.home + p.draw, 'a')}
    <text x="70" y="66" class="dn-big">${lead}%</text>
    <text x="70" y="86" class="dn-sub">${esc(t('confidence'))}</text>
  </svg>`;
}
// ⭐ PICK 상세 화면 (종합지표 + 배당 + 경기데이터 + AI)
async function openPick(id) {
  if (!loggedIn) { openLogin(); return; }   // 🔒 로그인 후에만 PICK 상세 열람
  const e = feedGames[id] || infoGames.find(g => g.id === id); if (!e) return;
  feedGames[id] = e; modalEventId = id;
  $('#scrim').classList.add('on'); $('#modal').classList.add('on');
  $('#mTitle').textContent = 'PICK · ' + (e.league || '');
  const p = pickProb(e);
  const recoSide = (p.home >= p.away && p.home >= p.draw) ? 'home' : (p.away >= p.draw ? 'away' : 'draw');
  const recoName = recoSide === 'home' ? TN(e.home, e.league) : recoSide === 'away' ? TN(e.away, e.league) : t('draw');
  const recoLbl = recoSide === 'home' ? t('recoHome') : recoSide === 'away' ? t('recoAway') : t('recoDraw');
  const stars = Math.max(1, Math.min(5, Math.round(p.conf / 20)));
  const od = e.odds || {};
  const oddsRow = (od.home || od.away)
    ? `<div class="pick-odds"><div class="po-c win"><span>${esc(t('win'))}</span><b>${od.home ? Number(od.home).toFixed(2) : '-'}</b></div>${od.draw ? `<div class="po-c draw"><span>${esc(t('draw'))}</span><b>${Number(od.draw).toFixed(2)}</b></div>` : ''}<div class="po-c loss"><span>${esc(t('loss'))}</span><b>${od.away ? Number(od.away).toFixed(2) : '-'}</b></div></div><div class="pi-note">${esc(t('oddsNote'))}</div>`
    : `<div class="lu-note">${esc(t('oddsSoon'))}</div>`;
  $('#mBody').innerHTML = `
    <div class="pick-hero">
      <div class="ph-team"><div class="ph-logo">${badge(e.homeLogo, '🏟')}</div><div class="ph-nm">${esc(TN(e.home, e.league))}</div></div>
      <div class="ph-vs"><div class="ph-vst">VS</div><div class="ph-time">${e.state === 'live' ? '● ' + esc(koStatus(e)) : e.date ? hhmm(e.date) : ''}</div></div>
      <div class="ph-team"><div class="ph-logo">${badge(e.awayLogo, '🏟')}</div><div class="ph-nm">${esc(TN(e.away, e.league))}</div></div>
    </div>
    <div class="pick-sec pick-summary" id="pickSummary">${pickSummaryHtml(e)}</div>
    <div class="pick-sec">
      <div class="ps-hd">📊 ${esc(t('pickIndex'))}</div>
      <div class="pick-index">
        ${pickDonut(p)}
        <div class="pi-right">
          <div class="pi-reco">${esc(recoLbl)} <span class="pi-recn">${esc(recoName)}</span></div>
          <div class="pi-stars">${'★'.repeat(stars)}<span class="pi-star-o">${'★'.repeat(5 - stars)}</span> <span class="pi-conf">${esc(t('confidence'))} ${p.conf}%</span></div>
          <div class="pi-legend">
            <span><i class="lg-h"></i>${esc(TN(e.home, e.league))} <b>${p.home}%</b></span>
            <span><i class="lg-d"></i>${esc(t('draw'))} <b>${p.draw}%</b></span>
            <span><i class="lg-a"></i>${esc(TN(e.away, e.league))} <b>${p.away}%</b></span>
          </div>
        </div>
      </div>
      <div class="pi-note">${esc(t('pickIndexNote'))}</div>
    </div>
    <div class="pick-sec"><div class="ps-hd">💰 ${esc(t('odds'))}</div>${oddsRow}</div>
    <div class="pick-sec"><div class="ps-hd">📈 ${esc(t('pickData'))}</div><div id="pickData"><div class="loading" style="padding:8px">${esc(t('loading'))}</div></div></div>
    <div class="pick-sec"><div class="ps-hd">🤖 ${esc(t('aiSum'))}</div><div class="pick-ai">${aiSummary(e).map(l => `<p>${l}</p>`).join('')}</div></div>
    <div class="pick-warn">⚠️ ${esc(t('pickWarn'))}</div>`;
  loadPickData(e);
}
async function loadPickData(e) {
  const box = $('#pickData'); if (!box) return;
  try {
    const refineSummary = (homeArr, awayArr) => { const ps = $('#pickSummary'); if (ps) ps.innerHTML = pickSummaryHtml(e, homeArr, awayArr); };
    if (tsLeague(e.league)) {
      const d = await fetchJSON(`/api/baseball/teamrecent?match=${encodeURIComponent(e.id)}&date=${state.date}`, { tries: 1 });
      box.innerHTML = pickDataHtml(e, d.away && d.away.games, d.home && d.home.games, d.h2h);
      refineSummary(d.home && d.home.games, d.away && d.away.games);
    } else if (statsLeague(e.league)) {
      const d = await fetchJSON(`/api/mlb/info?home=${encodeURIComponent(e.home)}&away=${encodeURIComponent(e.away)}&date=${state.date}`, { tries: 1 });
      box.innerHTML = pickDataHtml(e, d.recent && d.recent.away, d.recent && d.recent.home, d.h2h);
      refineSummary(d.recent && d.recent.home, d.recent && d.recent.away);
    } else {
      box.innerHTML = `<div class="lu-note">${esc(t('oddsSoon'))}</div>`;
    }
  } catch { box.innerHTML = `<div class="lu-note">-</div>`; }
}
function pickDataHtml(e, awayArr, homeArr, h2h) {
  const form = arr => (arr || []).slice(0, 5).map(g => { const w = g.win ? 'W' : (g.draw ? 'D' : 'L'); return `<span class="fm ${w}">${w}</span>`; }).join('') || '<span class="lu-note">-</span>';
  let html = `<div class="ps-sub">📅 ${esc(t('recent'))} 5</div><div class="pick-form">
    <div class="pf-row"><span class="pf-nm">${esc(TN(e.away, e.league))}</span><span class="pf-b">${form(awayArr)}</span></div>
    <div class="pf-row"><span class="pf-nm">${esc(TN(e.home, e.league))}</span><span class="pf-b">${form(homeArr)}</span></div></div>`;
  if (h2h && h2h.length) {
    html += `<div class="ps-sub">⚔️ ${esc(t('h2h'))} (${h2h.length})</div><div class="h2hbox">` + h2h.slice(0, 10).map(g => {
      const md = (g.date ? new Date(g.date).toISOString() : '').slice(5, 10);
      const an = g.aName != null ? g.aName : g.away, hn = g.hName != null ? g.hName : g.home;
      const as = g.as != null ? g.as : g.aScore, hs = g.hs != null ? g.hs : g.hScore;
      return `<div class="h2h-row"><span class="h2h-d">${esc(md)}</span><span class="h2h-t">${esc(teamShort(TN(an, e.league)))}</span><span class="h2h-s">${esc(as)}:${esc(hs)}</span><span class="h2h-t r">${esc(teamShort(TN(hn, e.league)))}</span></div>`;
    }).join('') + `</div>`;
  }
  return html;
}
function pitTable(team) {
  return `<table class="stt"><thead><tr><th>${sl('pitcher')}</th><th></th><th>${sl('era')}</th><th>${sl('g')}</th><th>${sl('w')}</th><th>${sl('l')}</th><th>${sl('sv')}</th><th>${sl('ip')}</th></tr></thead><tbody>${
    team.pit.map(p => `<tr><td class="nm">${esc(p.nm)}</td><td class="lr ${p.h === 'L' ? 'l' : 'r'}">${p.h}</td><td>${p.era.toFixed(2)}</td><td>${p.g}</td><td>${p.w}</td><td>${p.l}</td><td>${p.sv}</td><td>${p.ip.toFixed(1)}</td></tr>`).join('')
    }</tbody></table>`;
}
function batTable(team) {
  return `<table class="stt"><thead><tr><th>${sl('batter')}</th><th></th><th>${sl('avg')}</th><th>${sl('g')}</th><th>${sl('ab')}</th><th>${sl('h')}</th><th>${sl('hr')}</th></tr></thead><tbody>${
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

    <div class="odsec">🧢 ${esc(t('boxRec'))} <span class="teamtog"><span class="tg on" data-t="home">${esc(TN(m.home.name, m.league))}</span><span class="tg" data-t="away">${esc(TN(m.away.name, m.league))}</span></span></div>
    <div id="iiPit">${pitTable(m.home)}</div>
    <div id="iiBat" style="margin-top:8px">${batTable(m.home)}</div>

    <div class="odsec">📊 ${esc(t('inningScore'))}</div>
    <table class="boxsc"><thead><tr><th></th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>9</th><th class="r">R</th></tr></thead>
      <tbody><tr><td class="tn">${esc(m.home.name)}</td>${innings('home')}<td class="r">${sum('home')}</td></tr>
      <tr><td class="tn">${esc(m.away.name)}</td>${innings('away')}<td class="r">${sum('away')}</td></tr></tbody></table>

    <div class="odsec">📅 ${esc(t('recent'))}</div>
    <div class="recent2"><div class="recol"><div class="rec-hd">${esc(TN(m.home.name, m.league))}</div>${recentRows(m.recent.home)}</div><div class="recol"><div class="rec-hd">${esc(TN(m.away.name, m.league))}</div>${recentRows(m.recent.away)}</div></div>
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
  input.placeholder = t('chatPh'); send.textContent = t('send');
  const doSend = () => { const v = input.value.trim(); if (!v || !ws || ws.readyState !== 1) return; ws.send(JSON.stringify({ type: 'chat', text: v })); input.value = ''; };
  send.addEventListener('click', doSend);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
  const ui = { msgs, input };
  chatUIs.push(ui);
  return ui;
}
// 🎙️ 서버 중계봇(구조화 이벤트)을 현재 언어로 렌더링 → {icon,text,avatar}
function botFormat(m) {
  if (!m.kind) return { icon: m.icon || '⚾', text: m.text || '', avatar: m.avatar };
  const HM = `<b>${esc(TN(m.home, m.league))}</b>`, AW = `<b>${esc(TN(m.away, m.league))}</b>`;
  const team = m.side === 'home' ? HM : AW, logo = m.side === 'home' ? m.homeLogo : m.awayLogo;
  switch (m.kind) {
    case 'score': return { icon: '🔴', text: ai('evScore', { team, h: m.hs, a: m.as }), avatar: logo };
    case 'goal': return { icon: '⚽', text: ai('evScore', { team, h: m.hs, a: m.as }), avatar: logo };
    case 'hit': return { icon: '🏏', text: ai('evHit', { team, n: m.n }), avatar: logo };
    case 'out': return { icon: '🙅', text: ai('evOut', { team, n: m.n }), avatar: logo };
    case 'inn': return { icon: '🔄', text: ai('evInnStart', { x: inningLabel(m.inn, m.half) }), avatar: null };
    case 'intro': return { icon: '🎙️', text: ai('castIntro', { h: HM, a: AW }), avatar: null };
    case 'innsum': return { icon: '🔴', text: ai('castInn', { x: inningLabel(m.inn, m.half), team, n: m.n }), avatar: logo };
    case 'curbb': return { icon: '📍', text: ai('castCurBB', { x: inningLabel(m.inn, m.half), h: HM, a: AW, hs: m.hs, as: m.as }), avatar: null };
    case 'curfb': return { icon: '📍', text: ai('castCurFB', { min: (m.min != null ? m.min + "'" : ''), h: HM, a: AW, hs: m.hs, as: m.as }), avatar: null };
    default: return { icon: m.icon || '⚾', text: m.text || '', avatar: m.avatar };
  }
}
const seenMsgs = new Set();
function addMsg(m) {
  // 중복 방지(소켓 재연결·히스토리 재수신 등으로 같은 메시지가 두 번 오는 것 차단)
  if (m.type === 'chat') {
    const key = (m.ts || '') + '|' + m.name + '|' + m.text;
    if (seenMsgs.has(key)) return;
    seenMsgs.add(key);
  } else if (m.type === 'bot') {
    const key = 'bot|' + (m.ts || '') + '|' + (m.kind || '') + '|' + (m.side || '') + '|' + (m.n || '') + '|' + (m.hs || '') + '|' + (m.as || '');
    if (seenMsgs.has(key)) return;
    seenMsgs.add(key);
  }
  chatUIs.forEach(ui => {
    const div = document.createElement('div');
    if (m.type === 'sys') { div.className = 'cmsg'; div.innerHTML = `<span class="sys">${esc(m.text)}</span>`; }
    else if (m.type === 'bot') {
      const f = botFormat(m);   // m.text 는 앱 생성 안전 HTML
      div.className = 'cmsg bot';
      const av = f.avatar
        ? `<img class="bot-av" src="${esc(f.avatar)}" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'bot-av ic',textContent:'${f.icon || '⚾'}'}))">`
        : `<span class="bot-av ic">${f.icon || '⚾'}</span>`;
      div.innerHTML = `${av}<div class="bot-body"><span class="bot-nm">🎙️ ${esc(t('liveCast'))}</span><span class="bot-tx">${f.icon || ''} ${f.text}</span></div>`;
    }
    else { div.className = 'cmsg' + (m.name === myName ? ' me' : ''); div.innerHTML = `<span class="u">${esc(m.name)}</span>${esc(m.text)}`; }
    ui.msgs.appendChild(div);
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
  });
}
function clearMsgs() { chatUIs.forEach(ui => ui.msgs.innerHTML = ''); seenMsgs.clear(); }
function setOnline(total) { ['#onlineAll', '#onlineR', '#onlineD', '#onlineM'].forEach(s => { const el = $(s); if (el) el.textContent = total; }); }

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
    else if (m.type === 'bot') addMsg(m);
    else if (m.type === 'presence') setOnline(m.total);
  };
  ws.onclose = () => { addMsg({ type: 'sys', text: '연결이 끊겼습니다. 재접속 중…' }); setTimeout(connectWS, 2500); };
}

// ============================================================
//  날짜 네비 / 드로어 / 기타
// ============================================================
function refreshDateLabel() {
  const el = $('#dateToday'); if (!el) return;
  el.textContent = (state.date === localYMD()) ? t('today') : state.date.slice(5);
}
function shiftDate(days) {
  const d = new Date(state.date + 'T12:00:00'); d.setDate(d.getDate() + days);
  state.date = localYMD(d); $('#datePick').value = state.date;
  state.dateAuto = (state.date === localYMD());
  refreshDateLabel();
  loadEvents();
}
$('#datePrev').addEventListener('click', () => shiftDate(-1));
$('#dateNext').addEventListener('click', () => shiftDate(1));
$('#dateToday').addEventListener('click', () => { state.date = localYMD(); state.dateAuto = true; $('#datePick').value = state.date; refreshDateLabel(); loadEvents(); });
$('#datePick').addEventListener('change', e => { state.date = e.target.value; state.dateAuto = (state.date === localYMD()); refreshDateLabel(); loadEvents(); });
$('#btnRefresh').addEventListener('click', () => loadEvents());
$('#btnUser')?.addEventListener('click', openLogin);
$('#btnMenu').addEventListener('click', openDrawer);
function openDrawer() { $('#drawer').classList.add('on'); $('#scrimD').classList.add('on'); }
function closeDrawer() { $('#drawer').classList.remove('on'); $('#scrimD').classList.remove('on'); }
$('#scrimD').addEventListener('click', closeDrawer);

// ============================================================
//  뒤로가기(휴대폰/브라우저) → 앱 종료 대신 "열린 팝업만" 닫기
// ============================================================
const OVERLAY_IDS = ['modal', 'loginModal', 'writeModal', 'drawer'];
function anyOverlayOpen() { return OVERLAY_IDS.some(id => { const el = document.getElementById(id); return el && el.classList.contains('on'); }); }
function closeAllOverlays() {
  if ($('#modal') && $('#modal').classList.contains('on')) closeModal();
  if ($('#loginModal') && $('#loginModal').classList.contains('on')) closeLogin();
  if ($('#writeModal') && $('#writeModal').classList.contains('on')) closeWrite();
  if ($('#drawer') && $('#drawer').classList.contains('on')) closeDrawer();
}
function pushOverlayState() { try { if (!(history.state && history.state.liveupOverlay)) history.pushState({ liveupOverlay: true }, ''); } catch (e) {} }
function initBackButtonHandling() {
  // 팝업/드로어가 열리면 히스토리 상태를 하나 쌓아둠 → 뒤로가기가 그걸 먼저 소비
  const mo = new MutationObserver(() => { if (anyOverlayOpen()) pushOverlayState(); });
  OVERLAY_IDS.forEach(id => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] }); });
  // 뒤로가기 → 열린 게 있으면 그것만 닫음 (앱은 안 꺼짐)
  window.addEventListener('popstate', () => { if (anyOverlayOpen()) closeAllOverlays(); });
}

// ============================================================
//  INIT
// ============================================================
function initLangSelectors() {
  const opts = LANGS.map(l => `<option value="${l}"${l === LANG ? ' selected' : ''}>${LANG_FLAGS[l]} ${LANG_NAMES[l]}</option>`).join('');
  ['#langSel', '#langSelD', '#langSelM'].forEach(sel => { const el = $(sel); if (el) { el.innerHTML = opts; el.value = LANG; el.addEventListener('change', () => setLang(el.value)); } });
  applyI18n();
  refreshDateLabel();
}
// ============================================================
//  ⭐ 즐겨찾기(관심팀) + 🔔 알림 (앱 열림/PWA 활성 시 브라우저 알림)
// ============================================================
let FAV = (function () { try { return JSON.parse(localStorage.getItem('liveup_fav') || '[]'); } catch (e) { return []; } })();
const NOTIF_DEF = { on: false, start: true, lineup: true, score: true, hr: true, red: true, finish: true };
let NOTIF = (function () { try { return Object.assign({}, NOTIF_DEF, JSON.parse(localStorage.getItem('liveup_notif') || '{}')); } catch (e) { return { ...NOTIF_DEF }; } })();
function saveFav() { try { localStorage.setItem('liveup_fav', JSON.stringify(FAV)); } catch (e) {} }
function saveNotif() { try { localStorage.setItem('liveup_notif', JSON.stringify(NOTIF)); } catch (e) {} }
function isFav(name) { return FAV.includes(String(name || '')); }
function favStar(name) { return `<span class="favstar${isFav(name) ? ' on' : ''}" data-fav="${esc(name)}">${isFav(name) ? '★' : '☆'}</span>`; }
function toggleFav(name) { name = String(name || ''); const i = FAV.indexOf(name); if (i >= 0) FAV.splice(i, 1); else FAV.push(name); saveFav(); if (NOTIF.on) syncPush(); if ($('#view-live') && !$('#view-live').classList.contains('hidden')) renderFeed(filterGames()); }
// 경기 단위 즐겨찾기 (종 아이콘) — 양 팀을 관심팀에 등록/해제
function isMatchFav(e) { return isFav(e.home) && isFav(e.away); }
function toggleMatchFav(id) {
  const e = feedGames[id]; if (!e) return;
  if (isMatchFav(e)) { FAV = FAV.filter(x => x !== e.home && x !== e.away); }
  else { if (!isFav(e.home)) FAV.push(e.home); if (!isFav(e.away)) FAV.push(e.away); if (!NOTIF.on) autoEnableNotif(); }
  saveFav(); if (NOTIF.on) syncPush();
  if ($('#view-live') && !$('#view-live').classList.contains('hidden')) renderFeed(filterGames());
}
// 종을 처음 누르면 알림 자동 활성화(권한 요청) → 앱 꺼도 푸시
async function autoEnableNotif() {
  try { if ('Notification' in window && Notification.permission !== 'denied') { const p = await Notification.requestPermission(); if (p === 'granted') { NOTIF.on = true; saveNotif(); syncPush(); } } } catch (e) {}
}
// 종/별 클릭은 경기 상세로 안 넘어가게 (캡처 단계에서 가로챔)
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('.favbell');
  if (b) { ev.stopPropagation(); ev.preventDefault(); toggleMatchFav(b.dataset.favmatch); return; }
  const s = ev.target.closest && ev.target.closest('.favstar');
  if (s) { ev.stopPropagation(); ev.preventDefault(); toggleFav(s.dataset.fav); }
}, true);

// ── 서버 웹 푸시 구독 (앱 꺼져도 알림) ──
let swReg = null, vapidKey = null;
async function getSW() { if (swReg) return swReg; if ('serviceWorker' in navigator) { try { swReg = await navigator.serviceWorker.ready; } catch (e) {} } return swReg; }
function urlB64ToU8(b64) { const pad = '='.repeat((4 - b64.length % 4) % 4); const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(s); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); }
async function syncPush() {
  try {
    if (!NOTIF.on || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await getSW(); if (!reg) return;
    if (!vapidKey) { const r = await fetch('/api/push/key').then(x => x.json()).catch(() => null); if (!r || !r.enabled) return; vapidKey = r.key; }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(vapidKey) });
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub, fav: FAV, prefs: NOTIF, lang: LANG }) });
  } catch (e) { console.log('push sync fail', e && e.message); }
}
async function unsyncPush() {
  try { const reg = await getSW(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) { await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } } catch (e) {}
}
// 알림 클릭 → 해당 경기 상세 열기 (SW 메시지 / URL 파라미터)
function openEventWhenReady(id, sport) {
  if (!id) return;
  if (sport && sport !== state.sport) { state.sport = sport; if (typeof buildSportNav === 'function') buildSportNav(); loadEvents(); }
  let tries = 0; const tm = setInterval(() => { if (feedGames[id]) { clearInterval(tm); openEvent(id); } else if (++tries > 24) clearInterval(tm); }, 500);
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'openEvent') openEventWhenReady(e.data.gameId, e.data.sport); });

const notifSeen = {};   // gameId -> {state,total,lineup,reds}
function fireNotif(title, body, gameId) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: 'liveup-' + gameId, icon: '/logo-t.png', badge: '/logo-t.png', renotify: true });
    n.onclick = () => { window.focus(); try { n.close(); } catch (e) {} if (gameId && feedGames[gameId]) openEvent(gameId); };
  } catch (e) {}
}
function checkNotifs(games) {
  if (!NOTIF.on || !('Notification' in window) || Notification.permission !== 'granted') return;
  (games || []).forEach(g => {
    if (!(isFav(g.home) || isFav(g.away))) return;
    const id = g.id, prev = notifSeen[id] || {}, total = (Number(g.hs) || 0) + (Number(g.as) || 0);
    const HM = TN(g.home, g.league), AW = TN(g.away, g.league), sc = `${HM} ${g.hs ?? 0}:${g.as ?? 0} ${AW}`;
    if (prev.state) {
      if (NOTIF.start && prev.state === 'scheduled' && g.state === 'live') fireNotif('⚽ ' + t('evtStart'), `${HM} vs ${AW}`, id);
      if (NOTIF.finish && prev.state !== 'finished' && g.state === 'finished') fireNotif('🏁 ' + t('evtFinish'), sc, id);
      if ((NOTIF.score || NOTIF.hr) && prev.total != null && total > prev.total && g.state === 'live') fireNotif((state.sport === 'football' ? '⚽ ' : '🔴 ') + t('evtScore'), sc, id);
    }
    notifSeen[id] = Object.assign({}, prev, { state: g.state, total });
    // 라인업 발표 (경기 3시간 전~라이브 구간에서 1회)
    if (NOTIF.lineup && !prev.lineup) {
      const dt = g.date ? (new Date(g.date) - Date.now()) : null;
      const near = g.state === 'live' || (dt != null && dt < 3 * 3600e3 && dt > -6 * 3600e3);
      if (near) checkLineupNotif(g);
    }
    // 퇴장 (축구 라이브)
    if (NOTIF.red && state.sport === 'football' && g.state === 'live') checkRedNotif(g, prev.reds || 0);
  });
}
async function checkLineupNotif(g) {
  try {
    let has = false;
    if (state.sport === 'football') { const d = await fetchJSON(`/api/asports/lineups?fixture=${encodeURIComponent(g.id)}`, { tries: 1 }); has = !!(d.teams && d.teams[0] && (d.teams[0].startXI || []).length >= 11); }
    else if (statsLeague(g.league)) { const d = await fetchJSON(`/api/mlb/game?home=${encodeURIComponent(g.home)}&away=${encodeURIComponent(g.away)}&date=${state.date}`, { tries: 1 }); has = !!(d.found && ((d.home.lineup || []).length || (d.away.lineup || []).length)); }
    if (has && !(notifSeen[g.id] || {}).lineup) { notifSeen[g.id] = Object.assign({}, notifSeen[g.id], { lineup: true }); fireNotif('📋 ' + t('evtLineup'), `${TN(g.home, g.league)} vs ${TN(g.away, g.league)}`, g.id); }
  } catch (e) {}
}
async function checkRedNotif(g, prevReds) {
  try {
    const d = await fetchJSON(`/api/asports/events?fixture=${encodeURIComponent(g.id)}`, { tries: 1 });
    const reds = (d.events || []).filter(x => x.type === 'Card' && /red/i.test(x.detail || '')).length;
    if (reds > prevReds) fireNotif('🟥 ' + t('evtRed'), `${TN(g.home, g.league)} vs ${TN(g.away, g.league)}`, g.id);
    notifSeen[g.id] = Object.assign({}, notifSeen[g.id], { reds });
  } catch (e) {}
}
// 알림 설정 모달
function closeNotifSettings() { $('#notifScrim')?.classList.remove('on'); $('#notifModal')?.classList.remove('on'); }
function openNotifSettings() {
  if (!$('#notifScrim')) {
    const scrim = document.createElement('div'); scrim.id = 'notifScrim'; scrim.className = 'scrim';
    const m = document.createElement('div'); m.id = 'notifModal'; m.className = 'modal';
    document.body.appendChild(scrim); document.body.appendChild(m);
    scrim.addEventListener('click', closeNotifSettings);
  }
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  const chk = (k, label) => `<label class="ntf-row"><span>${esc(label)}</span><input type="checkbox" data-nk="${k}" ${NOTIF[k] ? 'checked' : ''}></label>`;
  const favList = FAV.length ? FAV.map(f => `<span class="favchip" data-favrm="${esc(f)}">${esc(f)} ✕</span>`).join('') : `<div class="lu-note">${esc(t('noFav'))}</div>`;
  $('#notifModal').innerHTML = `
    <div class="mhd"><span>🔔 ${esc(t('notifTitle'))}</span><span class="x" id="ntfClose">✕</span></div>
    <div class="mbody">
      <label class="ntf-row master"><span><b>${esc(t('notifEnable'))}</b></span><input type="checkbox" id="ntfOn" ${NOTIF.on ? 'checked' : ''}></label>
      ${perm !== 'granted' ? `<div class="lu-note">${esc(t('notifPerm'))}</div>` : ''}
      ${chk('start', t('evtStart'))}
      ${chk('lineup', t('evtLineup'))}
      ${chk('score', t('evtScore'))}
      ${chk('hr', t('evtHR'))}
      ${chk('red', t('evtRed'))}
      ${chk('finish', t('evtFinish'))}
      <div class="odsec">⭐ ${esc(t('favTeams'))}</div>
      <div class="favchips">${favList}</div>
      <div class="lu-note" style="margin-top:10px">${esc(t('notifClosedNote'))}</div>
    </div>`;
  $('#notifScrim').classList.add('on'); $('#notifModal').classList.add('on');
  $('#ntfClose').onclick = closeNotifSettings;
  $('#ntfOn').onchange = async e => {
    if (e.target.checked && 'Notification' in window) { const p = await Notification.requestPermission(); if (p !== 'granted') { e.target.checked = false; NOTIF.on = false; saveNotif(); openNotifSettings(); return; } }
    NOTIF.on = e.target.checked; saveNotif();
    if (NOTIF.on) { await syncPush(); } else { await unsyncPush(); }
    openNotifSettings();
  };
  $$('#notifModal [data-nk]').forEach(c => c.onchange = () => { NOTIF[c.dataset.nk] = c.checked; saveNotif(); if (NOTIF.on) syncPush(); });
  $$('#notifModal [data-favrm]').forEach(x => x.onclick = () => { toggleFav(x.dataset.favrm); openNotifSettings(); });
}
// 알림 진입 버튼 (항상 보이는 FAB)
(function addNotifFab() {
  const b = document.createElement('button'); b.id = 'notifFab'; b.className = 'notif-fab'; b.innerHTML = '🔔';
  b.addEventListener('click', openNotifSettings); document.body.appendChild(b);
})();

async function init() {
  $('#datePick').value = state.date;
  initLangSelectors();       // 언어 선택기 + 초기 번역 적용
  buildChatUI($('#chatDesk'));
  buildChatUI($('#chatMobile'));
  connectWS();
  buildSportNav();          // 종목 메뉴 즉시 표시(네트워크 불필요)
  initBackButtonHandling(); // 휴대폰 뒤로가기 = 팝업만 닫기
  setTab('live');           // 첫 화면 = 라이브
  loadEvents();             // 경기 즉시 로드(자체 자동 재시도 내장)
  // 관심 리그는 백그라운드로, 서버 깰 때까지 재시도
  fetchJSON('/api/leagues', { tries: 15, delay: 4000 })
    .then(d => { state.leagues = d.leagues || []; buildLeagueNav(); })
    .catch(() => {});
  // 라이브 자동 갱신 (7초) · 상세/채팅 열려 있어도 스코어·해설 계속 갱신 · 자정 지나면 날짜 자동 롤오버
  setInterval(() => { autoRollDate(); if (!$('#view-live').classList.contains('hidden') || modalEventId) loadEvents(true); }, 7000);
  // 앱을 다시 볼 때(백그라운드 → 포그라운드) 날짜가 바뀌었으면 오늘로 전환 후 새로고침
  document.addEventListener('visibilitychange', () => { if (!document.hidden && autoRollDate()) loadEvents(); });
  window.addEventListener('focus', () => { if (autoRollDate()) loadEvents(); });
  // 🏠 홈 화면 자동 갱신 (보일 때만, 20초)
  setInterval(() => { if ($('#view-home') && !$('#view-home').classList.contains('hidden')) renderHome(); }, 20000);
  // 🔔 이전에 알림 켰던 사용자는 재구독 (재시작·재접속 대비)
  if (NOTIF.on && 'Notification' in window && Notification.permission === 'granted') setTimeout(syncPush, 1500);
  // 알림 클릭으로 열린 경우 (?ev=) 해당 경기 상세 자동 오픈
  try { const ev = new URLSearchParams(location.search).get('ev'), sp = new URLSearchParams(location.search).get('sp'); if (ev) openEventWhenReady(ev, sp); } catch (e) {}
}
init();
