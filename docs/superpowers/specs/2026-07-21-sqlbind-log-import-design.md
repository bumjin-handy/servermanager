# SQL Bind 로그 불러오기

날짜: 2026-07-21

## 요약

SQL Bind 통합 입력에 **불러오기**를 추가한다. dao 로그 파일을 열어 `Executing Statement` 단위로 나열하고, 라디오로 고르면 통합 입력에 넣은 뒤 자동 적용(파싱·바인딩)한다. 목록은 유지한다.

## 결정

| 항목 | 선택 |
|------|------|
| 선택 후 동작 | 통합 입력 채움 + 자동 적용, 라디오 목록 유지 |
| 목록 위치 | 통합 입력 textarea 바로 아래 |
| 라벨 | 메서드명 — SQL 앞부분 |
| 구현 | `sqlBinder.ts` 파서 + `SqlBindPanel` UI, `<input type="file">` (Rust 없음) |

## 파싱

- `splitLogStatements(text)` → `{ id, label, raw }[]`
- 단위 시작: `Executing Statement:`
- 단위에 `Parameters:` / `Types:` 포함 (멀티라인 배열 허용)
- `Preparing` / `Connection` / `ResultSet` 제외
- `raw`는 기존 `parseLogText` / `applyFromLog`와 호환

## UI

- 버튼: 적용 · 예제 로그 · **불러오기** · 모두 지우기
- 불러온 뒤에만 라디오 패널 표시 (`불러온 로그 (N건)` + 파일명)
- 모두 지우기 시 목록·선택 초기화

## 경계

- 파일 취소: no-op
- 0건 / 읽기 실패: 에러 메시지
- Parameters 없는 단위도 목록에 포함, 적용 시 기존 검증 사용
