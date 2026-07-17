# Server Manager — 기능·스펙

Windows 우선 **Tauri 2 + React + TypeScript** 데스크톱 앱. SSH 서버를 등록·접속하고, 터미널·파일·로그수집을 한 워크스페이스에서 다룹니다.

앱 ID: `com.servermanager.desktop`

관련 문서: [README.md](../README.md), [infisical.md](infisical.md)

---

## 1. 기술 스택

| 구분 | 기술 |
|------|------|
| 데스크톱 | Tauri 2 |
| UI | React 19, Vite, xterm.js, react-resizable-panels |
| 백엔드 | Rust — russh, russh-sftp, dotenvy, keyring, reqwest |
| 데이터 | `%APPDATA%\com.servermanager.desktop\store.json` + 서버별 `env\` |

---

## 2. 레이아웃·셸

- **좌측**: 서버 목록 (추가 / 선택 / 더블클릭·우클릭 편집 / 삭제)
- **우측**: 선택한 서버의 워크스페이스 (툴바 + 패널)
- **설정**: Infisical·기본 `.env` 디렉터리 등 앱 전역 설정
- 다크 테마 셸 (터미널 중심)

### 툴바 (서버 선택 시)

- 새 터미널
- 파일 관리자 (숨김/펼침)
- 로그수집 (수집 중 ● 표시)
- 즐겨찾기
- 서버 삭제

---

## 3. 서버·자격 증명

### 서버 CRUD

- 필드: 이름, host, port, username
- 인증: password / private key
- 자격 증명 소스: **`.env`(기본)** 또는 **Infisical(선택)**

### 서버별 `.env` (기본)

- 서버마다 전용 `.env` 경로 + 키 이름 (`SSH_PASSWORD` / `SSH_PRIVATE_KEY`)
- 저장 시 파일 없으면 템플릿 자동 생성
- 경로 추천: `{defaultEnvDir}/{sanitizedName}.env`
- 파일 선택 다이얼로그·연결 테스트 지원

### Infisical (선택)

- Universal Auth, 프로젝트/환경/시크릿 경로
- Client secret은 OS keyring 저장
- 상세: [infisical.md](infisical.md)

---

## 4. SSH 터미널

- 서버당 **멀티 터미널** (독립 세션)
- xterm.js + FitAddon, 리사이즈 시 PTY resize
- 패널 닫기 시 해당 SSH 세션 종료
- 서버 전환 시 워크스페이스 재구성

---

## 5. 즐겨찾기 (터미널용)

| 유형 | 동작 |
|------|------|
| 명령 (`command`) | 활성 터미널에 삽입 / 실행 |
| 경로 (`path`) | 활성 터미널에 `cd` 실행 |

- 서버별 저장 (`store.json` favorites)

---

## 6. 파일 관리자

### UI

- 툴바 **파일 관리자** → 우측 영역 **전체 오버레이** (숨김/펼침)
- 열어도 터미널 **언마운트·접속 유지** (가리기만 함)

### 구성 (FileZilla / WinSCP 스타일)

| 영역 | 내용 |
|------|------|
| 로컬 | 전체 드라이브(내 PC) + 디렉터리 트리 + 파일 테이블 |
| 중앙 | 업로드 / 다운로드 버튼 |
| 원격 | SFTP 홈 기준 트리 + 파일 테이블 |

### 로컬

- 드라이브 루트 탐색, 경로 직접 입력, 홈 / 상위 / 새로고침
- **경로 즐겨찾기** (`localPath`, PC 전역, `serverId = "__local__"`)

### 원격

- SFTP 목록·업로드·다운로드
- **경로 즐겨찾기** (`remotePath`, 서버별)
- 파일 **우클릭 → 열기(텍스트)** / 더블클릭 → 텍스트 뷰어
  - 최대 약 2MB, 초과 시 앞부분만 표시 (lossy UTF-8)

### 전송

- 드래그앤드롭 (로컬 ↔ 원격)
- 선택 후 중앙 버튼으로 업/다운로드
- 로컬이 「내 PC」(드라이브 목록)일 때는 다운로드 대상으로 사용 불가

---

## 7. 로그 수집

### 진입

- 툴바 **로그수집**

### 설정

- 로그 경로를 한 줄에 하나씩 입력·서버별 저장 (`Server.logCollectPaths`)
- 예: `tomcat/logs/bms.log`, `jhoms/logs/jhoms.log`

### 수집 시작

- 로그마다 **전용 터미널** (`로그:{이름}`)에서 **병렬** `tail -f`
- 원격 저장 규칙:
  - 디렉터리: `$HOME/logs/{년월일시분초}/`
  - 파일: `{원본명}{년월일시분초}.log`
  - 예: `$HOME/logs/20260717145322/bms20260717145322.log`

### 수집 끝

1. 각 수집 세션에 Ctrl+C
2. 로그수집용 터미널 창 **자동 닫기**
3. **다운로드 확인 UI**
   - ☐ 로컬로 다운로드 체크
   - **저장 폴더** + **찾아보기…** (탐색기 폴더 선택)
   - **확인** 시(체크된 경우만) SFTP로 로컬 저장
   - 미체크 또는 **닫기** → 다운로드하지 않음

---

## 8. 데이터 모델 요약

| 항목 | 설명 |
|------|------|
| `Server` | 접속 정보, 자격 증명 설정, `logCollectPaths` |
| `Favorite` | `command` / `path` / `localPath` / `remotePath` |
| `AppData` | servers, favorites, Infisical, `defaultEnvDir` |

영속화: `store.json`. 로컬 경로 즐겨찾기는 `serverId = "__local__"`.

---

## 9. 주요 UX 규칙

- 파일 관리자 ↔ 터미널: SSH 세션 **유지**
- 로그수집 터미널: 수집 종료 후 **자동 닫힘**
- 로그 로컬 저장: **사용자 확인 + 폴더 선택** 후에만 수행
- 자격 증명: 기본은 서버별 `.env`, Infisical은 옵션

---

## 10. 알려진 제한·개선 여지

- 한글 서버명 → `.env` 파일명 슬러그가 약할 수 있음 (예: `server.env`)
- 일부 서버는 password 외 **keyboard-interactive** 인증이 필요할 수 있음
- 텍스트 뷰어는 원격 파일 기준, 대용량은 2MB 앞부분만 표시
- 로그 수집은 원격 셸의 `$HOME`·현재 권한에 의존 (`tail -f`, 디렉터리 생성)

---

## 11. 주요 소스 경로

| 영역 | 경로 |
|------|------|
| UI 셸 | `src/App.tsx`, `src/App.css` |
| 터미널 | `src/components/TerminalPane.tsx` |
| 파일 관리자 | `src/components/FilesPane.tsx`, `SiteExplorer.tsx`, `DirTree.tsx`, `FileTable.tsx` |
| 로그 수집 | `src/components/LogCollectPanel.tsx` |
| 텍스트 뷰어 | `src/components/TextViewerModal.tsx` |
| API 바인딩 | `src/api.ts`, `src/types.ts` |
| Rust | `src-tauri/src/lib.rs`, `ssh.rs`, `sftp.rs`, `local_fs.rs`, `store.rs`, `env_secrets.rs`, `infisical.rs` |
