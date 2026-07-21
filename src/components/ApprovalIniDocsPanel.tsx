import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import {
  base64ToUint8Array,
  parseApprovalIniWorkbook,
  type IniDocs,
  type IniRow,
  type IniSheet,
} from "../lib/approvalIniDocs";

interface Props {
  onClose: () => void;
}

function rowMatches(row: IniRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return Object.values(row).some((v) => v.toLowerCase().includes(q));
}

function rowKey(sheetId: string, index: number): string {
  return `${sheetId}:${index}`;
}

function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function ApprovalIniDocsPanel({ onClose }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [docs, setDocs] = useState<IniDocs | null>(null);
  const [sheetId, setSheetId] = useState("");
  const [query, setQuery] = useState("");
  const [searchAll, setSearchAll] = useState(false);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  const loadFromPath = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const b64 = await api.readLocalFileBase64(path);
      const parsed = parseApprovalIniWorkbook(
        base64ToUint8Array(b64),
        fileNameFromPath(path),
      );
      if (parsed.sheets.length === 0) {
        throw new Error("인식 가능한 시트가 없습니다. HANDY HSO Approval INI 형식인지 확인하세요.");
      }
      await api.setApprovalIniDocsPath(path);
      setFilePath(path);
      setDocs(parsed);
      setSheetId(parsed.sheets[0]?.id ?? "");
      setHighlightKey(null);
    } catch (e) {
      setDocs(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
      title: "결재 INI 설명 Excel 선택",
    });
    if (typeof selected !== "string") return;
    await loadFromPath(selected);
  };

  useEffect(() => {
    void (async () => {
      try {
        const saved = (await api.getApprovalIniDocsPath()).trim();
        if (saved) await loadFromPath(saved);
      } catch (e) {
        setError(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSheet = useMemo(
    () => docs?.sheets.find((s) => s.id === sheetId) ?? docs?.sheets[0],
    [docs, sheetId],
  );

  const sectionAt = useMemo(() => {
    const map = new Map<number, string>();
    for (const sec of activeSheet?.sections ?? []) {
      map.set(sec.rowIndex, sec.title);
    }
    return map;
  }, [activeSheet]);

  const filteredLocal = useMemo(() => {
    if (!activeSheet) return [];
    return activeSheet.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => rowMatches(row, query));
  }, [activeSheet, query]);

  const filteredGlobal = useMemo(() => {
    if (!docs || !searchAll || !query.trim()) return [];
    const out: { sheet: IniSheet; row: IniRow; index: number }[] = [];
    for (const sheet of docs.sheets) {
      sheet.rows.forEach((row, index) => {
        if (rowMatches(row, query)) out.push({ sheet, row, index });
      });
    }
    return out;
  }, [docs, query, searchAll]);

  useEffect(() => {
    if (!highlightKey || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightKey, sheetId, searchAll]);

  const jumpTo = (targetSheetId: string, index: number) => {
    setSearchAll(false);
    setSheetId(targetSheetId);
    setHighlightKey(rowKey(targetSheetId, index));
  };

  const showGlobal = searchAll && Boolean(query.trim());

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal ini-docs-modal"
        role="dialog"
        aria-label="결재INI설명"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>결재 INI 설명</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="닫기">
            ×
          </button>
        </div>

        <div className="modal-body ini-docs-body">
          <div className="ini-docs-file-row">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void pickFile()}
            >
              불러오기
            </button>
            {filePath ? (
              <span className="ini-docs-path" title={filePath}>
                {fileNameFromPath(filePath)}
              </span>
            ) : (
              <span className="muted">Excel(.xlsx) 경로를 선택하면 다음에 다시 사용합니다.</span>
            )}
            {busy && <span className="muted">읽는 중…</span>}
          </div>

          {error && <div className="msg error">{error}</div>}

          {!docs && !busy && !error && (
            <p className="ini-docs-empty">
              HANDY HSO Approval INI Excel 파일을 <strong>불러오기</strong>로 선택하세요.
              경로는 앱 설정에만 저장되며 git에 포함되지 않습니다.
            </p>
          )}

          {docs && (
            <>
              <p className="ini-docs-source muted">출처: {docs.source}</p>

              <div className="ini-docs-toolbar">
                <input
                  className="ini-docs-search"
                  type="search"
                  value={query}
                  placeholder="옵션명, 설명 검색…"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlightKey(null);
                  }}
                  spellCheck={false}
                  aria-label="검색"
                />
                <label className="ini-docs-all-toggle">
                  <input
                    type="checkbox"
                    checked={searchAll}
                    onChange={(e) => {
                      setSearchAll(e.target.checked);
                      setHighlightKey(null);
                    }}
                  />
                  전체 시트
                </label>
              </div>

              {!showGlobal && (
                <div className="ini-docs-tabs" role="tablist" aria-label="시트">
                  {docs.sheets.map((sheet) => (
                    <button
                      key={sheet.id}
                      type="button"
                      role="tab"
                      aria-selected={sheet.id === activeSheet?.id}
                      className={`ini-docs-tab${sheet.id === activeSheet?.id ? " active" : ""}`}
                      onClick={() => {
                        setSheetId(sheet.id);
                        setHighlightKey(null);
                      }}
                    >
                      {sheet.name}
                    </button>
                  ))}
                </div>
              )}

              {showGlobal ? (
                <div className="ini-docs-table-wrap">
                  <p className="ini-docs-count">전체 검색 결과 {filteredGlobal.length}건</p>
                  {filteredGlobal.length === 0 ? (
                    <p className="ini-docs-empty">일치하는 항목이 없습니다.</p>
                  ) : (
                    <table className="ini-docs-table">
                      <thead>
                        <tr>
                          <th>시트</th>
                          <th>요약</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredGlobal.map(({ sheet, row, index }) => {
                          const summary =
                            row["옵션명"] ||
                            row["알림종류"] ||
                            row["서식셀명"] ||
                            row["심볼릭값"] ||
                            row["권한"] ||
                            row["오류번호"] ||
                            Object.values(row).find(Boolean) ||
                            "";
                          const desc =
                            row["설명"] ||
                            row["의미및조치"] ||
                            row["알림내용"] ||
                            row["권한에 따른 역할"] ||
                            "";
                          return (
                            <tr
                              key={rowKey(sheet.id, index)}
                              className="ini-docs-clickable"
                              onClick={() => jumpTo(sheet.id, index)}
                            >
                              <td className="ini-docs-sheet-cell">{sheet.name}</td>
                              <td>
                                <div className="ini-docs-summary-title">{summary}</div>
                                {desc && (
                                  <div className="ini-docs-summary-desc">{desc}</div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : activeSheet ? (
                <>
                  <div className="ini-docs-sheet-meta">
                    <h4>{activeSheet.title}</h4>
                    {activeSheet.intro.map((line, i) => (
                      <p key={i} className="ini-docs-intro">
                        {line}
                      </p>
                    ))}
                    <p className="ini-docs-count">
                      {query.trim()
                        ? `검색 결과 ${filteredLocal.length} / ${activeSheet.rows.length}건`
                        : `${activeSheet.rows.length}건`}
                    </p>
                  </div>

                  <div className="ini-docs-table-wrap">
                    {filteredLocal.length === 0 ? (
                      <p className="ini-docs-empty">일치하는 항목이 없습니다.</p>
                    ) : (
                      <table className="ini-docs-table">
                        <thead>
                          <tr>
                            {activeSheet.columns.map((col) => (
                              <th key={col}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLocal.map(({ row, index }) => {
                            const key = rowKey(activeSheet.id, index);
                            const section = sectionAt.get(index);
                            const isHi = highlightKey === key;
                            return (
                              <FragmentRow
                                key={key}
                                section={query.trim() ? undefined : section}
                                columns={activeSheet.columns}
                                row={row}
                                highlighted={isHi}
                                rowRef={isHi ? highlightRef : undefined}
                              />
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FragmentRow({
  section,
  columns,
  row,
  highlighted,
  rowRef,
}: {
  section?: string;
  columns: string[];
  row: IniRow;
  highlighted: boolean;
  rowRef?: RefObject<HTMLTableRowElement | null>;
}) {
  return (
    <>
      {section && (
        <tr className="ini-docs-section">
          <td colSpan={columns.length}>{section}</td>
        </tr>
      )}
      <tr ref={rowRef} className={highlighted ? "ini-docs-highlight" : undefined}>
        {columns.map((col) => (
          <td key={col}>
            <span className="ini-docs-cell">{row[col] ?? ""}</span>
          </td>
        ))}
      </tr>
    </>
  );
}
