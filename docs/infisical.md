# 자격 증명 가이드

## 기본 인증 흐름

현재 구현의 기본값은 **서버 인증을 접속 시점에 한 번 입력하고, 앱 실행 중 메모리에만 유지**하는 방식입니다.

- UI에서 자격 증명 소스 `env`는 **「접속 시 입력(메모리)」**으로 표시됩니다.
- `CredentialSource::Env`는 세션 비밀(prompt)을 프로세스 메모리(`session_secrets`)에만 보관합니다. 접속 시 없으면 `SECRET_REQUIRED`로 프롬프트를 띄웁니다.
- 평문 비밀번호/개인키는 `store.json`에 저장하지 않습니다.
- 서버 모델에는 `envFilePath` / `envKey`가 남아 있어, 경로 추천·검증·테스트 API는 지원합니다. 현재 서버 모달은 `envFilePath`를 빈 문자열로 저장합니다.

## 서버별 .env (보조)

각 서버는 **자기 전용 `.env` 파일 경로**를 가질 수 있습니다. 전역 단일 `.env`를 공유하지 않습니다.

권장 레이아웃:

```
{앱데이터}/env/prod-api.env
{앱데이터}/env/staging.env
```

파일 내용 예시:

```env
SSH_PASSWORD=...
# 또는
SSH_PRIVATE_KEY="-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----"
```

참고:
- `defaultEnvDir`는 경로 추천용 기본 디렉터리입니다.
- 실제 비밀 사용은 기본적으로 메모리 기반이며, `.env`는 보조 연결 정보로 취급합니다.

## Infisical (선택)

서버의 자격 증명 소스를 `Infisical`로 바꾸면, 앱 전역 설정과 서버별 설정을 조합해 시크릿을 조회합니다.

### 앱 전역 설정

앱 설정에서 다음을 구성할 수 있습니다.

- Site URL
- Client ID
- Project ID / Environment 기본값
- Client Secret

Client Secret은 **OS 키체인**에만 저장됩니다.

### 서버별 설정

서버마다 아래 항목을 지정할 수 있습니다.

- `infisicalProjectId`
- `infisicalEnv`
- `infisicalSecretPath`
- `infisicalSecretName`

서버의 자격 증명 소스가 `Infisical`인 경우, 앱은 해당 서버의 시크릿 경로와 이름으로 값을 조회합니다.

### 동작 요약

1. 앱 설정의 Infisical Client Secret으로 Universal Auth 로그인
2. 서버별 프로젝트/환경/시크릿 경로 조합으로 시크릿 조회
3. 조회된 값은 현재 세션에서 사용되며, 영구 저장소에 암호를 남기지 않음
