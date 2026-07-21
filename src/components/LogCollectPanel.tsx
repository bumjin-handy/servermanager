import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { RemoteTextContent, Server } from "../types";
import { api, runWithSessionSecret } from "../api";
import { toNativeLocalPath } from "./fileManagerShared";
import { TextViewerModal } from "./TextViewerModal";

export type LogCollectOutput = {
  source: string;
  /** Display path e.g. `$HOME/logs/20260717145322/bms.log` */
  outputFile: string;
  fileName: string;
  stamp: string;
};

interface Props {
  server: Server;
  collecting: boolean;
  outputs: LogCollectOutput[];
  workingDirHint: string | null;
  status: string | null;
  error?: boolean;
  onClose: () => void;
  onSavePaths: (paths: string[]) => Promise<void>;
  onStart: (paths: string[], filter: LogCollectFilter) => Promise<void>;
  /** Stops collection and returns generated output files (for download prompt). */
  onStop: () => Promise<LogCollectOutput[]>;
  onDownload: (outputs: LogCollectOutput[], localDir: string) => Promise<void>;
  /** When stop was triggered outside the panel (e.g. closing a log pane). */
  pendingDownload?: LogCollectOutput[] | null;
  onClearPendingDownload?: () => void;
}

const PLACEHOLDER = `tomcat/logs/bms.log
jhoms/logs/jhoms.log
jhoms./logs/dao.log`;

export function LogCollectPanel({
  server,
  collecting,
  outputs,
  workingDirHint,
  status,
  error,
  onClose,
  onSavePaths,
  onStart,
  onStop,
  onDownload,
  pendingDownload = null,
  onClearPendingDownload,
}: Props) {
  const [text, setText] = useState(server.logCollectPaths?.join("\n") ?? "");
  const [filterPattern, setFilterPattern] = useState("");
  const [filterColor, setFilterColor] = useState(true);
  const [busy, setBusy] = useState(false);
  const [downloadAsk, setDownloadAsk] = useState<LogCollectOutput[] | null>(null);
  const [wantDownload, setWantDownload] = useState(true);
  const [localSaveDir, setLocalSaveDir] = useState("");
  const [copiedPath, setCopiedPath] = useState(false);
  const [textView, setTextView] = useState<RemoteTextContent | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    item: LogCollectOutput;
  } | null>(null);

  const downloadPathFromStatus = useMemo(() => {
    if (!status || !status.includes("다운로드 완료")) return null;
    const idx = status.lastIndexOf("→");
    if (idx < 0) return null;
    const path = status.slice(idx + 1).trim();
    return path || null;
  }, [status]);

  const statusLabel = useMemo(() => {
    if (!status || !downloadPathFromStatus) return status;
    const idx = status.lastIndexOf("→");
    return status.slice(0, idx).trim();
  }, [status, downloadPathFromStatus]);

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const openWithEditor = async (
    path: string,
    editor: "cursor" | "vscode" | "editplus",
  ) => {
    setEditorMenuOpen(false);
    try {
      await api.openLocalWithEditor(toNativeLocalPath(path), editor);
    } catch (e) {
      window.alert(String(e));
    }
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (!editorMenuOpen) return;
    const close = () => setEditorMenuOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [editorMenuOpen]);

  useEffect(() => {
    if (!downloadPathFromStatus) setEditorMenuOpen(false);
  }, [downloadPathFromStatus]);

  const openOutputAsText = async (item: LogCollectOutput) => {
    setCtxMenu(null);
    setTextLoading(true);
    try {
      await runWithSessionSecret(server.id, () => api.sftpOpen(server.id));
      const home = await api.sftpHome(server.id);
      const remotePath = `${home.replace(/\/$/, "")}/logs/${item.stamp}/${item.fileName}`;
      const content = await api.sftpReadText(server.id, remotePath);
      setTextView(content);
    } catch (e) {
      window.alert(String(e));
    } finally {
      setTextLoading(false);
    }
  };

  const onOutputContextMenu = (e: MouseEvent, item: LogCollectOutput) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, item });
  };

  useEffect(() => {
    setText(server.logCollectPaths?.join("\n") ?? "");
  }, [server.id, server.logCollectPaths]);

  useEffect(() => {
    if (pendingDownload && pendingDownload.length > 0) {
      setWantDownload(true);
      setDownloadAsk(pendingDownload);
      onClearPendingDownload?.();
    }
  }, [pendingDownload, onClearPendingDownload]);

  useEffect(() => {
    if (!downloadAsk) return;
    let cancelled = false;
    void (async () => {
      try {
        const home = await api.localHome();
        if (!cancelled && !localSaveDir) {
          setLocalSaveDir(
            toNativeLocalPath(`${home.replace(/[/\\]+$/, "")}/logs/${downloadAsk[0]?.stamp ?? ""}`),
          );
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when prompt opens
  }, [downloadAsk]);

  const paths = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    [text],
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      const outs = await onStop();
      if (outs.length > 0) {
        setWantDownload(true);
        setLocalSaveDir("");
        setDownloadAsk(outs);
      }
    } finally {
      setBusy(false);
    }
  };

  const pickLocalDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "로그 저장 폴더 선택",
      defaultPath: localSaveDir || undefined,
    });
    if (typeof selected === "string") {
      setLocalSaveDir(toNativeLocalPath(selected));
    }
  };

  const confirmDownloadAsk = async () => {
    if (!downloadAsk) return;
    const outs = downloadAsk;
    if (!wantDownload) {
      setDownloadAsk(null);
      return;
    }

    let dir = localSaveDir.trim();
    if (!dir) {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "로그 저장 폴더 선택",
      });
      if (typeof selected !== "string") return;
      dir = toNativeLocalPath(selected);
      setLocalSaveDir(dir);
    } else {
      dir = toNativeLocalPath(dir);
    }

    setDownloadAsk(null);
    setBusy(true);
    try {
      await onDownload(outs, dir);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal log-collect-modal"
        role="dialog"
        aria-label="로그수집"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>로그수집 — {server.name}</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="닫기">
            ×
          </button>
        </div>

        <div className="modal-body log-collect-body">
          <p className="log-collect-help">
            수집할 로그 경로를 한 줄에 하나씩 입력하세요. 수집 시작 시 로그마다 전용 터미널에서
            <code> tail -F </code>가 <strong>동시에</strong> 실행되며, 결과는
            <code> $HOME/logs/년월일시분초/&lt;파일명&gt;년월일시분초.log </code>에 저장됩니다.
            선택적으로 필터(<code>grep -E</code>)를 걸면 매칭 줄만 터미널·저장 파일에 남고, 색 강조는
            터미널에만 적용됩니다. 수집 끝은 각 세션에 Ctrl+C를 보냅니다. 완료 후 로컬 다운로드
            여부를 확인할 수 있습니다.
          </p>

          <label className="field-label" htmlFor="log-paths">
            로그 경로
          </label>
          <textarea
            id="log-paths"
            className="log-paths-input"
            rows={8}
            value={text}
            placeholder={PLACEHOLDER}
            disabled={collecting || busy || !!downloadAsk}
            onChange={(e) => setText(e.target.value)}
          />

          <label className="field-label" htmlFor="log-filter">
            필터 (선택)
          </label>
          <div className="log-filter-row">
            <input
              id="log-filter"
              className="log-filter-input"
              type="text"
              value={filterPattern}
              placeholder={'예: ERROR|WARN|Exception'}
              disabled={collecting || busy || !!downloadAsk}
              onChange={(e) => setFilterPattern(e.target.value)}
              spellCheck={false}
            />
            <label
              className={`log-filter-color${filterPattern.trim() ? "" : " is-disabled"}`}
              title={
                filterPattern.trim()
                  ? "터미널에만 ANSI 색 적용 (저장 파일은 무색)"
                  : "필터를 입력하면 사용할 수 있습니다"
              }
            >
              <input
                type="checkbox"
                checked={filterColor}
                disabled={!filterPattern.trim() || collecting || busy || !!downloadAsk}
                onChange={(e) => setFilterColor(e.target.checked)}
              />
              색 강조
            </label>
          </div>
          <p className="log-filter-hint">
            비우면 전체 줄을 저장합니다. 채우면 <code>grep -E</code> 패턴으로 필터합니다.
          </p>

          <div className="log-collect-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || collecting || !!downloadAsk}
              onClick={() => void run(() => onSavePaths(paths))}
            >
              경로 저장
            </button>
            {!collecting ? (
              <button
                type="button"
                className="btn primary"
                disabled={busy || paths.length === 0 || !!downloadAsk}
                onClick={() =>
                  void run(() =>
                    onStart(paths, {
                      pattern: filterPattern.trim(),
                      color: filterColor,
                    }),
                  )
                }
              >
                수집 시작
              </button>
            ) : (
              <button
                type="button"
                className="btn danger"
                disabled={busy || !!downloadAsk}
                onClick={() => void handleStop()}
              >
                수집 끝
              </button>
            )}
            <span className={`log-collect-state${collecting ? " on" : ""}`}>
              {collecting ? "● 수집 중" : "○ 대기"}
            </span>
          </div>

          {downloadAsk && (
            <div className="log-download-ask">
              <p>
                수집이 완료되었습니다. 로컬로 다운로드할까요?
                <br />
                <span className="muted">
                  원격: $HOME/logs/{downloadAsk[0]?.stamp}/ ·{" "}
                  {downloadAsk.map((o) => o.fileName).join(", ")}
                </span>
              </p>
              <label className="log-download-check">
                <input
                  type="checkbox"
                  checked={wantDownload}
                  onChange={(e) => setWantDownload(e.target.checked)}
                />
                로컬로 다운로드
              </label>
              {wantDownload && (
                <div className="log-download-path">
                  <label className="field-label" htmlFor="local-save-dir">
                    저장 폴더
                  </label>
                  <div className="log-download-path-row">
                    <input
                      id="local-save-dir"
                      className="path-bar"
                      value={localSaveDir}
                      placeholder="탐색기에서 폴더를 선택하세요"
                      onChange={(e) => setLocalSaveDir(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void pickLocalDir()}
                    >
                      찾아보기…
                    </button>
                  </div>
                </div>
              )}
              <div className="log-download-ask-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void confirmDownloadAsk()}
                >
                  확인
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setDownloadAsk(null)}
                >
                  닫기
                </button>
              </div>
            </div>
          )}

          {(status || error) && (
            <div className={`msg${error ? " error" : ""} log-status-row`}>
              <span className="log-status-text">
                {downloadPathFromStatus ? (
                  <>
                    {statusLabel}{" "}
                    <code className="log-status-path" title={downloadPathFromStatus}>
                      {downloadPathFromStatus}
                    </code>
                  </>
                ) : (
                  status
                )}
              </span>
              {downloadPathFromStatus && (
                <div className="log-status-actions">
                  <button
                    type="button"
                    className="btn log-copy-path-btn"
                    title="경로 복사"
                    onClick={() => void copyPath(downloadPathFromStatus)}
                  >
                    {copiedPath ? "복사됨" : "경로 복사"}
                  </button>
                  <div className="log-editor-menu-wrap">
                    <button
                      type="button"
                      className="icon-btn log-open-editor-btn"
                      title="에디터로 열기"
                      aria-label="에디터로 열기"
                      aria-expanded={editorMenuOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditorMenuOpen((v) => !v);
                      }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <line x1="10" y1="9" x2="8" y2="9" />
                      </svg>
                    </button>
                    {editorMenuOpen && (
                      <div
                        className="context-menu log-editor-menu"
                        role="menu"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="context-menu-item"
                          role="menuitem"
                          onClick={() =>
                            void openWithEditor(downloadPathFromStatus, "cursor")
                          }
                        >
                          Cursor로 열기
                        </button>
                        <button
                          type="button"
                          className="context-menu-item"
                          role="menuitem"
                          onClick={() =>
                            void openWithEditor(downloadPathFromStatus, "vscode")
                          }
                        >
                          VS Code로 열기
                        </button>
                        <button
                          type="button"
                          className="context-menu-item"
                          role="menuitem"
                          onClick={() =>
                            void openWithEditor(downloadPathFromStatus, "editplus")
                          }
                        >
                          EditPlus로 열기
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="log-collect-outputs">
            <h4>생성 파일</h4>
            {workingDirHint && (
              <p className="log-collect-cwd">
                저장 디렉터리: <code>{workingDirHint}</code>
              </p>
            )}
            {textLoading && <p className="muted">파일 여는 중…</p>}
            {outputs.length === 0 ? (
              <p className="muted">수집을 시작하면 여기에 출력 파일 경로가 표시됩니다.</p>
            ) : (
              <ul className="log-output-list">
                {outputs.map((o) => (
                  <li
                    key={o.outputFile}
                    className="log-output-item"
                    onContextMenu={(e) => onOutputContextMenu(e, o)}
                    onDoubleClick={() => void openOutputAsText(o)}
                    title="우클릭 또는 더블클릭으로 텍스트 보기"
                  >
                    <code className="log-out-file">{o.outputFile}</code>
                    <span className="muted"> ← {o.source}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {ctxMenu && (
          <div
            className="context-menu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="context-menu-item"
              onClick={() => void openOutputAsText(ctxMenu.item)}
            >
              열기 (텍스트)
            </button>
          </div>
        )}

        {textView && (
          <TextViewerModal
            path={textView.path}
            content={textView.content}
            size={textView.size}
            truncated={textView.truncated}
            onClose={() => setTextView(null)}
          />
        )}
      </div>
    </div>
  );
}

/** `20260717145322` */
export function formatLogStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}${hh}${mm}${ss}`;
}

export function logStemFromPath(logPath: string) {
  const base =
    logPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "log";
  return base.replace(/\.log$/i, "") || "log";
}

export function shellQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Double-quote for paths that must expand shell vars (e.g. `$HOME/...`). */
export function shellDoubleQuote(s: string) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export type LogCollectPlan = {
  source: string;
  /** Display / remote path e.g. `$HOME/logs/20260717145322/bms.log` */
  outputFile: string;
  fileName: string;
  stamp: string;
  collectDir: string;
  command: string;
  paneTitle: string;
};

export type LogCollectFilter = {
  /** Extended regex for grep -E; empty = no filter */
  pattern: string;
  /** ANSI color in the terminal only (saved file stays plain) */
  color: boolean;
};

/** Build remote shell command for one log path. */
export function buildLogCollectCommand(
  source: string,
  outputFile: string,
  collectDir: string,
  filter: LogCollectFilter = { pattern: "", color: true },
): string {
  const src = shellQuote(source);
  const out = shellDoubleQuote(outputFile);
  const dir = shellDoubleQuote(collectDir);
  const pat = filter.pattern.trim();
  const mkdir = `mkdir -p ${dir}`;

  if (!pat) {
    return `${mkdir} && tail -F ${src} | tee ${out}`;
  }

  const grepped = `tail -F ${src} | grep --line-buffered -E ${shellQuote(pat)} | tee ${out}`;
  if (filter.color) {
    return `${mkdir} && ${grepped} | grep --color=always -E ${shellQuote(pat)}`;
  }
  return `${mkdir} && ${grepped}`;
}

/** Build parallel collect plan. Output → `$HOME/logs/<년월일시분초>/<name>.log` */
export function buildLogCollectPlan(
  paths: string[],
  date = new Date(),
  filter: LogCollectFilter = { pattern: "", color: true },
): { plan: LogCollectPlan[]; collectDir: string; stamp: string } {
  const stamp = formatLogStamp(date);
  const collectDir = `$HOME/logs/${stamp}`;
  const plan = paths.map((source) => {
    const stem = logStemFromPath(source);
    const fileName = `${stem}${stamp}.log`;
    const outputFile = `${collectDir}/${fileName}`;
    return {
      source,
      outputFile,
      fileName,
      stamp,
      collectDir,
      command: buildLogCollectCommand(source, outputFile, collectDir, filter),
      paneTitle: `로그:${stem}`,
    };
  });
  return { plan, collectDir, stamp };
}

export function buildLogCollectStartScript(
  paths: string[],
  date = new Date(),
): { script: string; outputs: LogCollectOutput[]; collectDir: string } {
  const { plan, collectDir, stamp } = buildLogCollectPlan(paths, date);
  const outputs = plan.map((p) => ({
    source: p.source,
    outputFile: p.outputFile,
    fileName: p.fileName,
    stamp,
  }));
  const startAll = plan.map((p) => `(${p.command}) &`).join(" ");
  const lines = [
    "echo '=== log collect start (parallel) ==='",
    `mkdir -p "${collectDir}"`,
    startAll,
    "sleep 0.2",
    ...plan.map((p) => `echo \"CREATED:${p.outputFile}\"`),
    "jobs -l",
    "echo '=== tails running in background ==='",
  ];
  return { script: lines.join("\n"), outputs, collectDir };
}

export function buildLogCollectStopScript() {
  return [
    "echo '=== log collect stop ==='",
    "kill $(jobs -p) 2>/dev/null || true",
    "wait 2>/dev/null || true",
    "echo '=== stopped ==='",
  ].join("\n");
}
