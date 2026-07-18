# Server Manager

Windows 우선 **Tauri 2 + React + TypeScript** 데스크톱 앱입니다. SSH 서버를 등록하고, 좌측 서버 목록 / 우측 멀티 터미널·즐겨찾기·SFTP 파일 관리자·로그 수집으로 관리합니다.

기본 인증 흐름은 **서버 추가 후 최초 접속 때 암호/개인키를 한 번 입력하고, 현재 앱 실행 중 메모리에만 보관**하는 방식입니다. Infisical은 선택적으로 사용할 수 있습니다. 서버별 `.env` 경로는 설정 데이터로 남아 있지만, 현재 UX는 기본적으로 메모리 입력을 사용합니다.

상세 기능·스펙 → [docs/SPEC.md](docs/SPEC.md)

## 실행

```bash
npm install
npm run tauri dev
```

## 서버별 `.env` 지원(선택/보조)

현재 구현은 기본적으로 **접속 시 입력된 자격 증명을 메모리에만 보관**합니다. 따라서 서버 추가 화면에서 암호를 `.env`에 바로 저장해 두는 플로우는 기본 경로가 아닙니다.

다만, 서버 모델에는 여전히 `envFilePath` / `envKey` 필드가 남아 있어, 서버별 `.env` 경로를 연결하거나 경로 추천을 받을 수는 있습니다.

- `.env` 경로는 `defaultEnvDir` 기준으로 추천 가능
- 키 이름 기본값은 `SSH_PASSWORD` 또는 `SSH_PRIVATE_KEY`
- 파일 존재 여부와 경로 검증은 앱에서 지원
- **평문 비밀번호/개인키는 `store.json`에 저장하지 않음**

데이터 저장 위치: `%APPDATA%\com.servermanager.desktop\` (`store.json`, `env\` 등). 서버 비밀은 세션 메모리와 OS keyring에만 유지됩니다.

## Infisical (선택)

서버별로 자격 증명 소스를 Infisical로 바꿀 수 있습니다. → [docs/infisical.md](docs/infisical.md)

## 기능 요약

| 기능 | 설명 |
|------|------|
| 서버 CRUD | 추가·편집(우클릭/더블클릭)·삭제 |
| 자격 증명 | 기본은 접속 시 한 번 입력 후 메모리 유지 / Infisical(선택) |
| 멀티 터미널 | 동일 서버 독립 SSH 세션 (xterm.js) |
| 즐겨찾기 | 명령 삽입·실행, 경로 `cd` (서버별) |
| 파일 관리자 | 우측 전체 오버레이, 로컬(전체 드라이브) ↔ 원격(SFTP), DnD·경로 즐겨찾기, 원격 텍스트 보기 |
| 로그 수집 | 다중 `tail -f` 병렬, `$HOME/logs/년월일시분초/`, 종료 후 확인·폴더 선택 다운로드 |

자세한 동작·경로 규칙·제한 사항은 [docs/SPEC.md](docs/SPEC.md)를 참고하세요.
