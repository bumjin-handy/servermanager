# 결재 INI 설명 뷰어

날짜: 2026-07-21

## 요약

Tool ▾ → **결재INI설명**. 사용자가 HANDY HSO Approval INI Excel을 **불러오기**로 선택하고, **경로만** `store.json`에 저장해 재사용한다. Excel/변환 JSON은 **git에 커밋하지 않는다.**

## 결정

| 항목 | 선택 |
|------|------|
| 데이터 | 로컬 xlsx 경로 기억 → 열 때마다 파싱 (`xlsx` + `read_local_file_base64`) |
| 영속 | `AppData.approvalIniDocsPath` only |
| gitignore | `reference/**/*.xlsx`, `src/data/approvalIniDocs.json` |
| 검색 | 현재 시트 기본 + ☐ 전체 시트 토글 |

## UI

- 모달 상단 **불러오기** + 기억된 파일명
- 시트 탭 / 검색 / 전체 시트 토글 (기존과 동일)

## 비범위

- Excel을 리포에 번들, 옵션 편집·저장
