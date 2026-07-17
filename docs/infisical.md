# 자격 증명 가이드

## 서버별 .env (기본)

각 서버는 **자기 전용 `.env` 파일 경로**를 가집니다. 전역 단일 `.env`를 공유하지 않습니다.

권장 레이아웃:

```
{앱데이터}/env/prod-api.env
{앱데이터}/env/staging.env
```

파일 내용:

```env
SSH_PASSWORD=...
# 또는
SSH_PRIVATE_KEY="-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----"
```

서버 등록 UI에서:
1. 자격 증명 소스 = `.env (서버별 파일)`
2. `.env` 경로 = 해당 서버 파일
3. 키 이름 = `SSH_PASSWORD` / `SSH_PRIVATE_KEY`

## Infisical (선택)

서버의 자격 증명 소스를 Infisical로 설정한 경우에만 사용합니다.

1. Machine Identity + Universal Auth
2. 앱 설정 → Infisical (선택)
3. 서버에 시크릿 경로·이름 지정

Client Secret은 OS 키체인에만 보관됩니다.
