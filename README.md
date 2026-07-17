# Server Manager

Windows 우선 **Tauri 2 + React + TypeScript** 데스크톱 앱입니다. SSH 서버를 등록하고, 좌측 서버 목록 / 우측 멀티 터미널·즐겨찾기·SFTP 파일 관리자·로그 수집으로 관리합니다.

접속 정보는 **서버마다 별도 `.env` 파일**(기본)에서 읽습니다. Infisical은 선택입니다.

상세 기능·스펙 → [docs/SPEC.md](docs/SPEC.md)

## 실행

```bash
npm install
npm run tauri dev
```

## 서버별 .env (기본)

1. 서버마다 `.env` 파일을 만듭니다. 예:

```
env/prod-api.env
env/staging.env
```

2. 파일 내용 예 ([`.env.example`](.env.example), [`env/prod-api.env.example`](env/prod-api.env.example)):

```env
SSH_PASSWORD=your-password
```

3. 앱에서 서버 추가 → 자격 증명 소스 `.env` → **서버 전용 .env 경로** 지정 (경로 추천 / 파일 선택 가능).
4. 키 이름은 기본 `SSH_PASSWORD` 또는 `SSH_PRIVATE_KEY`.

설정에 있는 **기본 디렉터리**는 “경로 추천” 버튼이 `{디렉터리}/{서버이름}.env`를 제안할 때만 쓰입니다.

데이터 저장 위치: `%APPDATA%\com.servermanager.desktop\` (`store.json`, `env\` 등).

## Infisical (선택)

서버별로 자격 증명 소스를 Infisical로 바꿀 수 있습니다. → [docs/infisical.md](docs/infisical.md)

## 기능 요약

| 기능 | 설명 |
|------|------|
| 서버 CRUD | 추가·편집(우클릭/더블클릭)·삭제 |
| 자격 증명 | 서버별 `.env` / Infisical(선택) |
| 멀티 터미널 | 동일 서버 독립 SSH 세션 (xterm.js) |
| 즐겨찾기 | 명령 삽입·실행, 경로 `cd` (서버별) |
| 파일 관리자 | 우측 전체 오버레이, 로컬(전체 드라이브) ↔ 원격(SFTP), DnD·경로 즐겨찾기, 원격 텍스트 보기 |
| 로그 수집 | 다중 `tail -f` 병렬, `$HOME/logs/년월일시분초/`, 종료 후 확인·폴더 선택 다운로드 |

자세한 동작·경로 규칙·제한 사항은 [docs/SPEC.md](docs/SPEC.md)를 참고하세요.
