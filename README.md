# Server Manager

Windows 우선 **Tauri 2 + React + TypeScript** 데스크톱 앱입니다. SSH 서버를 등록하고, 좌측 서버 목록 / 우측 멀티 터미널·즐겨찾기·SFTP 파일 관리자·로그 수집·로그 뷰어·Config·AI 채팅으로 관리합니다. 서버 전환 시에도 SSH/SFTP 세션은 유지됩니다.

자격 증명은 **서버별 최초 접속 시 암호/개인키를 한 번 입력하고, 현재 앱 실행 중 메모리에만 보관**합니다. `store.json`에 평문 비밀번호/개인키를 저장하지 않습니다.

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

데이터 저장 위치: `%APPDATA%\com.servermanager.desktop\` (`store.json` 등).

## 기능 요약

| 기능 | 설명 |
|------|------|
| 서버 CRUD | 추가·편집(우클릭)·삭제, 더블클릭 시 새 터미널 |
| 자격 증명 | 접속 시 메모리 입력 (프로세스 종료 시 소멸) |
| 세션 유지 | 서버 전환 시 워크스페이스·터미널·SFTP 유지 |
| 멀티 터미널 | 동일 서버 독립 SSH 세션 (xterm.js) |
| 즐겨찾기 | 명령 삽입·실행, 경로 `cd`, Config/파일관리자 경로 — 현재/새 터미널 대상 선택 |
| **Tool ▾** | 로컬 탐색기, 파일 관리자, SQL Bind, 결재Tool, 결재INI설명 |
| **로그 ▾** | 로그수집, 로그 뷰어 |
| Config | 원격 설정 파일 탐색·편집(SFTP), `.properties` ASCII 변환, 경로 즐겨찾기 |
| AI | OpenAI 호환 채팅(설정의 Base URL/모델), API 키는 세션 메모리, SFTP 첨부 |
| 파일 관리자 | 우측 전체 오버레이, 로컬(전체 드라이브) ↔ 원격(SFTP), DnD·경로 즐겨찾기, 원격 텍스트 보기 |
| 로그 수집 | 다중 `tail -F` 병렬(+`tee`), `grep -E` 필터·색 강조·메모(`memo.txt`), `$HOME/logs/{stamp}/`, 종료 후 SFTP 다운로드, 에디터로 열기 |
| 로그 뷰어 | `tail -F` 스트리밍·검색·레벨 필터·다운로드; **로그선택** 모드에서 줄 선택 후 체크박스~줄번호 사이 우클릭 → 복사/저장/SQL Bind |
| SQL Bind | MyBatis 로그/`?` 파라미터를 DB별 리터럴 SQL로 바인딩 (클라이언트 전용); 로그 뷰어 연동, 연결 프로그램으로 열기 (설정에서 경로 관리) |
| 결재Tool | 결재함 objectId로 원격 sancbox 경로 탐색·다운로드 |
| 결재INI설명 | 로컬 Approval INI Excel 불러오기(경로만 기억)·시트 열람·검색 |

자세한 동작·경로 규칙·제한 사항은 [docs/SPEC.md](docs/SPEC.md)를 참고하세요.
