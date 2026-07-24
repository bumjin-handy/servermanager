# Server Manager — 기능·스펙

Windows 우선 **Tauri 2 + React + TypeScript** 데스크톱 앱. SSH 서버를 등록·접속하고, 터미널·파일·로그수집·SQL Bind를 한 워크스페이스에서 다룹니다.

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

- **좌측**: 서버 목록 (추가 / 선택 / 더블클릭 새 터미널 / 우클릭 편집 / 삭제), 상단 **SQL Bind**, 하단 **설정**
- **우측**: 선택한 서버의 워크스페이스 (툴바 + 패널). 서버를 바꿔도 다른 서버 워크스페이스는 **언마운트하지 않음** (숨김만)
- **설정**: Infisical·기본 `.env` 디렉터리 등 앱 전역 설정
- 다크 테마 셸 (터미널 중심)

### 툴바 (서버 선택 시)

- 새 터미널
- 로컬 탐색기 (OS 탐색기로 홈 열기)
- **Tool ▾**: 파일 관리자 / 결재Tool / 결재INI설명
- 로그수집 (수집 중 ● 표시)
- SQL Bind
- 즐겨찾기
- 서버 삭제

---

## 3. 서버·자격 증명

### 서버 CRUD

- 필드: 이름, host, port, username
- 인증: password / private key
- 자격 증명 소스:
  - **`env`(기본 UI 라벨: 접속 시 입력(메모리))** — 최초 접속 시 프롬프트, 프로세스 메모리만
  - **Infisical(선택)** — 원격 시크릿 조회
- 서버 데이터에는 `envFilePath` / `envKey`가 남아 있고, 경로 추천·검증에 사용 가능 (현재 UI는 `envFilePath`를 빈 값으로 저장)

### 서버별 `.env` 지원(보조)

- 서버마다 전용 `.env` 경로 + 키 이름 (`SSH_PASSWORD` / `SSH_PRIVATE_KEY`)를 보유할 수 있음
- **평문 비밀번호/개인키를 `store.json`에 영속화하지 않음**
- 경로 추천: `{defaultEnvDir}/{englishSlug}.env` (이름에 ASCII 없으면 호스트 기반)
- `defaultEnvDir`는 경로 추천 제안값에 사용

### Infisical (선택)

- 서버 자격 증명 소스를 `Infisical`로 바꾸면, 앱 전역 설정과 서버별 시크릿 경로/이름 조합으로 비밀을 조회합니다.
- Client Secret은 OS keyring에만 보관됩니다.
- 상세: [infisical.md](infisical.md)

---

## 4. SSH 터미널·워크스페이스

- 서버당 **멀티 터미널** (독립 세션)
- xterm.js + FitAddon, 리사이즈 시 PTY resize
- 패널 닫기 시 해당 SSH 세션 종료
- **서버 전환**: 서버별 워크스페이스 상태를 유지하고, 비활성 워크스페이스는 DOM에 마운트된 채 숨김 → 터미널·SFTP **재접속 없이** 복귀

---

## 5. 즐겨찾기 (터미널용)

| 유형 | 동작 |
|------|------|
| 명령 (`command`) | 터미널에 삽입 / 실행 |
| 경로 (`path`) | 터미널에 `cd` 실행 |

- 실행 대상: **현재 터미널** 또는 **새 터미널**
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
- Windows에서는 **OS 네이티브 경로** 표기 (`C:\...`)
- **경로 즐겨찾기** (`localPath`, PC 전역, `serverId = "__local__"`)
- 툴바 **로컬 탐색기**로 홈 폴더를 OS 탐색기에서 열기 (`plugin-opener`)

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

- 로그마다 **전용 터미널** (`로그:{이름}`)에서 **병렬** `tail -F` (+ `tee`로 화면·파일 동시)
- **필터(선택)**: `grep -E` 패턴. 있으면 매칭 줄만 터미널·저장 파일에 남김
- **색 강조(선택, 필터 있을 때 기본 on)**: 터미널에만 ANSI 색 (`grep --color=always`). 저장 파일은 무색
- **수집 메모(선택)**: 수집 목적 간단 기록. 로컬 다운로드 시 같은 폴더에 `memo.txt`로 저장
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
   - 메모가 있으면 동일 폴더에 `memo.txt` 추가
   - 미체크 또는 **닫기** → 다운로드하지 않음

### 다운로드 완료 후

- 상태줄에 로컬 경로 표시 + **경로 복사**
- 옆 아이콘 메뉴로 해당 폴더를 외부 에디터에서 열기:
  - Cursor
  - VS Code
  - EditPlus  
  (Rust `open_local_with_editor` — PATH 및 일반 설치 경로 탐색)

### 원격 생성 파일

- 목록에서 우클릭/더블클릭 → 원격 로그 **텍스트 보기** (SFTP 읽기)

---

## 8. SQL Bind

클라이언트 전용 MyBatis/JDBC 디버그 유틸. 서버·네트워크 호출 없음.

### 진입

- 사이드바 상단 **SQL Bind** 또는 서버 툴바 **SQL Bind**

### 기능

- 통합 로그 붙여넣기 → `Executing Statement` / `Parameters` / `Types` 추출 (붙여넣기 시 자동 적용)
- 수동 SQL + 파라미터 + (선택) Java 타입
- `?` 개수·파라미터 개수 검증 후 바인딩
- DB별 날짜 리터럴: Oracle `TO_DATE`, MySQL `STR_TO_DATE`, PostgreSQL `TIMESTAMP`/`DATE`
- 파라미터 표에서 값·타입 수정 후 재바인딩, 결과 클립보드 복사

### 소스

- 로직: `src/lib/sqlBinder.ts`
- UI: `src/components/SqlBindPanel.tsx`

---

## 9. 결재 INI 설명

Tool ▾ → **결재INI설명**. 전자결재 INI/설정 옵션 레퍼런스 뷰어 (클라이언트 전용).

- **불러오기**로 로컬 Excel(`.xlsx`) 선택 → 경로만 `store.json` (`approvalIniDocsPath`)에 저장, 다음 실행 시 재로드
- Excel 파일·변환 JSON은 **git에 포함하지 않음** (`reference/**/*.xlsx` gitignore)
- 파싱: `src/lib/approvalIniDocs.ts` (SheetJS)
- 검색: 현재 시트 기본, ☐ 전체 시트 토글 시 전 시트 검색·행 클릭으로 이동
- 시트 예: globals.properties, jhomscfg.xml, handydef.ini, 기타설정및가이드, 권한별역할, 서식Guide, 결재알림, ErrorCode설명

---

## 10. 데이터 모델 요약

| 항목 | 설명 |
|------|------|
| `Server` | 접속 정보, 자격 증명 설정, `logCollectPaths` |
| `Favorite` | `command` / `path` / `localPath` / `remotePath` |
| `AppData` | servers, favorites, Infisical, `defaultEnvDir` |
| 워크스페이스(프론트) | 서버별 panes·파일관리자·로그수집 상태 (앱 메모리, 전환 시 유지) |

영속화: `store.json`. 로컬 경로 즐겨찾기는 `serverId = "__local__"`.

---

## 11. 주요 UX 규칙

- 파일 관리자 ↔ 터미널: SSH 세션 **유지**
- 서버 목록 전환: 다른 서버의 터미널·SFTP **유지**
- 로그수집 터미널: 수집 종료 후 **자동 닫힘**
- 로그 로컬 저장: **사용자 확인 + 폴더 선택** 후에만 수행
- 자격 증명: 기본은 접속 시 입력 후 세션 메모리에만 보관, Infisical은 옵션
- SQL Bind: 입력·결과는 앱 안에서만 처리

---

## 12. 알려진 제한·개선 여지

- 한글 서버명 → `.env` 파일명 슬러그가 약할 수 있음 (예: `server.env`)
- 일부 서버는 password 외 **keyboard-interactive** 인증이 필요할 수 있음
- 텍스트 뷰어는 원격 파일 기준, 대용량은 2MB 앞부분만 표시
- 로그 수집은 원격 셸의 `$HOME`·현재 권한에 의존 (`tail -F`, `grep`, `tee`, 디렉터리 생성)
- SQL Bind의 `?` 치환은 문자열/주석을 구분하지 않음 (디버그 로그용)
- EditPlus 등 미설치 에디터는 실행 실패 알림

---

## 13. 주요 소스 경로

| 영역 | 경로 |
|------|------|
| UI 셸 | `src/App.tsx`, `src/App.css` |
| 터미널 | `src/components/TerminalPane.tsx` |
| 파일 관리자 | `src/components/FilesPane.tsx`, `SiteExplorer.tsx`, `DirTree.tsx`, `FileTable.tsx` |
| 로그 수집 | `src/components/LogCollectPanel.tsx` |
| SQL Bind | `src/components/SqlBindPanel.tsx`, `src/lib/sqlBinder.ts` |
| 결재 INI 설명 | `src/components/ApprovalIniDocsPanel.tsx`, `src/lib/approvalIniDocs.ts` |
| 텍스트 뷰어 | `src/components/TextViewerModal.tsx` |
| API 바인딩 | `src/api.ts`, `src/types.ts` |
| Rust | `src-tauri/src/lib.rs`, `ssh.rs`, `sftp.rs`, `local_fs.rs`, `store.rs`, `env_secrets.rs`, `infisical.rs` |
