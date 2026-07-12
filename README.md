# ⚽ LiveScore AI

실시간 라이브스코어 + AI 분석 + 실시간 채팅/접속인원 웹앱.
livescore.co.kr 스타일 구조 · PC/모바일 반응형 · **실제 API 데이터 연동**.

## 구성

- **프론트엔드** (`public/`) — HTML/CSS/JS 단일 구성, 빌드 불필요
  - PC: 좌측 종목·리그 네비 + 중앙 경기 피드 + 우측 실시간 채팅 (3단)
  - 모바일: 상단 탭바 + 종목 아이콘 + 앱형 경기 카드 + 하단 네비
- **백엔드** (`server.js`) — Node + Express + WebSocket
  - `TheSportsDB` API 프록시 (실시간 스코어·순위·상세, 캐싱 내장)
  - WebSocket 실시간 채팅 + 접속인원(presence) 집계

## 실제로 동작하는 것

- 날짜·종목별 **실제 경기/스코어/엠블럼** (TheSportsDB)
- 경기 클릭 → **상세**(경기장·라운드·박스스코어·하이라이트 영상 링크) + AI 승부예측 바
- 리그 **순위표** 실데이터
- **실시간 채팅** + **현재 접속 인원** (WebSocket, 새로고침 없이 갱신)
- 30초마다 라이브 자동 갱신

> 배당·AI 예측 수치는 스코어 기반 계산값(참고용)입니다. 유료 API 키를 넣으면 인플레이 실시간성이 좋아집니다.

## 로컬 실행

```bash
cd livescore-app
npm install
npm start
# 브라우저에서 http://localhost:3000
```

Node 18 이상 필요(내장 fetch 사용).

## 클라우드 배포 (무료)

### Render
1. 이 폴더를 GitHub 저장소에 올림
2. render.com → New → Web Service → 저장소 연결
3. `render.yaml`이 자동 인식됨 (Build: `npm install`, Start: `npm start`)
4. 배포되면 `https://<이름>.onrender.com` 주소로 휴대폰에서도 접속 가능

### Railway
1. railway.app → New Project → Deploy from GitHub
2. 자동으로 `npm start` 실행, `PORT` 환경변수 주입됨

## API 키 교체 (선택)

무료 테스트 키(`3`)는 호출수·인플레이에 제한이 있습니다.
[TheSportsDB Patreon](https://www.thesportsdb.com/) 유료 키가 있으면
환경변수 `THESPORTSDB_KEY` 값만 교체하면 됩니다.

## 엔드포인트

| 경로 | 설명 |
|---|---|
| `GET /api/events?date=YYYY-MM-DD&sport=Soccer` | 날짜·종목별 경기 |
| `GET /api/table?id=4328&season=2025-2026` | 리그 순위 |
| `GET /api/event?id=...` | 경기 상세 |
| `GET /api/leagues` | 관심 리그 목록 |
| `WS /ws` | 채팅 + 접속인원 |
