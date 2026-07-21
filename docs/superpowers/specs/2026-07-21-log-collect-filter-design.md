# 로그수집: tail -F + 실시간 필터 + 색강조

날짜: 2026-07-21  
범위: 추천 도입 순서 **1번만** (프리셋·문맥·알림·SQL Bind 연계는 제외)

## 목표

로그수집 시 로테이트에 강하고, 선택적으로 패턴만 터미널·저장 파일에 남기며, 터미널에서는 색으로 강조한다.

## 동작

| 필터 | 색강조 | 원격 명령 (개념) |
|------|--------|------------------|
| 없음 | — | `mkdir -p "$HOME/logs/…" && tail -F src \| tee out` |
| 있음 | off | `… \| grep --line-buffered -E pat \| tee out` |
| 있음 | on (기본) | 위 + `\| grep --color=always -E pat` (tee **이후**라 저장본 무색, 터미널만 ANSI) |

- 소스 경로·grep 패턴: 작은따옴표 (`shellQuote`)
- `$HOME/...` 출력 경로: 큰따옴표 (`shellDoubleQuote`)로 변수 확장 유지
- `tail -f` → **`tail -F`**

## UI

- 로그 경로 아래 **필터** 한 줄 (`ERROR|WARN|Exception` 등 `-E` 문법)
- **색 강조** 체크 (기본 on, 필터 비어 있으면 비활성)
- 수집 중·다운로드 확인 중에는 필터/색 비활성 (다음 수집부터 적용)
- 시작 상태 메시지에 필터 요약 포함 (있을 때)

## 비범위

- 프리셋, -A/-B, 알림, 매칭 카운트, SQL Bind 연계
- 필터 서버별 영속화

## 파일

- `LogCollectPanel.tsx` — UI + `buildLogCollectPlan` 옵션
- `App.tsx` — `onStart`에 필터 전달
- `docs/SPEC.md`, `README.md` — 한 줄 동기화
