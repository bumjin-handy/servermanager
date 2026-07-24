# Server Manager

Windows 우선 **Tauri 2 + React + TypeScript** 데스크톱 앱입니다. SSH 서버를 등록하고, 좌측 서버 목록 / 우측 멀티 터미널·즐겨찾기·SFTP 파일 관리자·로그 수집으로 관리합니다. 서버 전환 시에도 SSH/SFTP 세션은 유지됩니다.

기본 인증은 **서버별 최초 접속 때 암호/개인키를 한 번 입력하고, 현재 앱 실행 중 메모리에만 보관**하는 방식입니다. Infisical은 서버별로 선택합니다. 서버별 `.env` 경로(`envFilePath`)는 모델·추천용으로 남아 있으나, UI 기본 경로는 메모리 입력입니다.

상세 기능·스펙 → [docs/SPEC.md](docs/SPEC.md)

## 실행

```bash
npm install
npm run tauri dev
```

## 자격 증명

| 소스 | 동작 |
|------|------|
| 접속 시 입력(메모리) — 기본 | 최초 접속 시 1회 입력, 프로세스 메모리에만 보관. `store.json`에 평문 비밀 없음 |
| Infisical — 선택 | 앱 전역 설정 + 서버별 시크릿 경로로 조회. Client Secret은 OS keyring |

서버 모델의 `envFilePath` / `envKey`는 경로 추천·검증용으로 남아 있습니다. 서버마다 전용 `.env` 경로를 쓰며, 전역 단일 secrets 파일은 사용하지 않습니다.

데이터 저장 위치: `%APPDATA%\com.servermanager.desktop\` (`store.json`, `env\` 등).

Infisical 설정 → [docs/infisical.md](docs/infisical.md)

## 기능 요약

| 기능 | 설명 |
|------|------|
| 서버 CRUD | 추가·편집(우클릭)·삭제, 더블클릭 시 새 터미널 |
| 자격 증명 | 기본: 접속 시 메모리 입력 / Infisical(선택) |
| 세션 유지 | 서버 전환 시 워크스페이스·터미널·SFTP 유지 (선택만 바꿈) |
| 멀티 터미널 | 동일 서버 독립 SSH 세션 (xterm.js) |
| 즐겨찾기 | 명령 삽입·실행, 경로 `cd` — 현재/새 터미널 대상 선택 |
| 로컬 탐색기 | OS 파일 탐색기로 홈 폴더 열기 |
| 파일 관리자 | 우측 전체 오버레이, 로컬(전체 드라이브) ↔ 원격(SFTP), DnD·경로 즐겨찾기, 원격 텍스트 보기 |
| 로그 수집 | 다중 `tail -F` 병렬(+`tee`), 선택적 `grep -E` 필터·터미널 색 강조·수집 메모(`memo.txt`), `$HOME/logs/년월일시분초/`, 종료 후 확인·폴더 선택 다운로드, 경로 복사·에디터로 열기(Cursor/VS Code/EditPlus) |
| SQL Bind | MyBatis 로그/`?` 파라미터를 DB별 리터럴 SQL로 바인딩 (클라이언트 전용, 사이드바·툴바) |
| 결재INI설명 | Tool 메뉴 — 로컬 Approval INI Excel 불러오기(경로만 기억)·시트 열람·검색 |

자세한 동작·경로 규칙·제한 사항은 [docs/SPEC.md](docs/SPEC.md)를 참고하세요.
