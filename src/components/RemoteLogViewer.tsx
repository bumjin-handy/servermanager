/**
 * RemoteLogViewer — Hermes-style log viewer
 *
 * Features:
 *  - Browse server's logCollectPaths (+ manual path input)
 *  - Stream via `tail -F` over SSH, rendered as plain text lines
 *  - Search (highlight + jump), log-level filter, timestamp toggle
 *  - Line-count badge, auto-scroll toggle, clear, fullscreen, download
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { v4 as uuid } from "uuid";
import { api, runWithSessionSecret } from "../api";
import type { Server, SshClosedEvent, SshOutputEvent } from "../types";
import { toNativeLocalPath } from "./fileManagerShared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type LogLevel = "ALL" | "ERROR" | "WARN" | "INFO" | "DEBUG";

interface LogLine {
  id: number;
  raw: string;       // original text from SSH
  text: string;      // cleaned (ANSI stripped)
  ts: string | null; // extracted timestamp or null
  level: LogLevel;
  matchesSearch: boolean;
}

interface Props {
  server: Server;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let _lineId = 0;
function nextId() { return ++_lineId; }

/** Strip basic ANSI escape codes */
function stripAnsi(s: string) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[mGKHF]/g, "").replace(/\x1b\[\?[0-9]+[hl]/g, "");
}

/** Detect log level from a line */
function detectLevel(text: string): LogLevel {
  const t = text.toUpperCase();
  if (/\bERROR\b|\bFATAL\b|\bSEVERE\b/.test(t)) return "ERROR";
  if (/\bWARN(?:ING)?\b/.test(t)) return "WARN";
  if (/\bINFO\b/.test(t)) return "INFO";
  if (/\bDEBUG\b|\bTRACE\b/.test(t)) return "DEBUG";
  return "ALL";
}

/** Level rendering */
const LEVEL_COLORS: Record<LogLevel, string> = {
  ERROR: "#f85149",
  WARN:  "#e3b341",
  INFO:  "#3fb950",
  DEBUG: "#8b9bb0",
  ALL:   "#e6edf3",
};

/** Try to extract leading timestamp (ISO, log4j, common patterns) */
const TS_RE = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}[/:]\d{2}[/:]\d{4}\s+\d{2}:\d{2}:\d{2}|\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2})/;

function extractTs(text: string): { ts: string | null; rest: string } {
  const m = TS_RE.exec(text);
  if (!m) return { ts: null, rest: text };
  return { ts: m[1], rest: text.slice(m[1].length).trimStart() };
}

const MAX_LINES = 5000;
const LEVEL_ORDER: Record<LogLevel, number> = { ALL: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 };

function levelPassesFilter(lineLevel: LogLevel, filter: LogLevel): boolean {
  if (filter === "ALL") return true;
  return LEVEL_ORDER[lineLevel] >= LEVEL_ORDER[filter];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function RemoteLogViewer({ server, onClose }: Props) {
  // ── state ──────────────────────────────────────────────────────────────
  const [selectedPath, setSelectedPath] = useState<string>(() =>
    server.logCollectPaths?.[0] ?? ""
  );
  const [customPath, setCustomPath] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LogLevel>("ALL");
  const [showTs, setShowTs] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);

  // SSH session id for streaming
  const sessionIdRef = useRef<string | null>(null);
  const bufRef = useRef("");          // partial-line buffer
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── computed ────────────────────────────────────────────────────────────
  const activePath = customPath.trim() || selectedPath;

  const searchLower = search.toLowerCase();
  const filteredLines = useMemo(() => {
    return lines.filter(
      (l) =>
        levelPassesFilter(l.level, levelFilter) &&
        (searchLower === "" || l.matchesSearch)
    );
  }, [lines, levelFilter, searchLower]);

  const matchCount = useMemo(
    () => (searchLower ? filteredLines.filter((l) => l.matchesSearch).length : 0),
    [filteredLines, searchLower]
  );

  // ── auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filteredLines, autoScroll]);

  // ── parse incoming SSH data ──────────────────────────────────────────────
  // (inline in startStream; kept as closure for searchLower dependency)

  // Recompute matchesSearch when search term changes
  useEffect(() => {
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        matchesSearch: searchLower ? l.text.toLowerCase().includes(searchLower) : false,
      }))
    );
    setMatchIdx(0);
  }, [searchLower]);

  // ── stream controls ──────────────────────────────────────────────────────
  const stopStream = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      await api.sshWrite(sid, "\x03").catch(() => undefined); // Ctrl+C
      await new Promise((r) => setTimeout(r, 120));
      await api.sshClose(sid).catch(() => undefined);
      sessionIdRef.current = null;
    }
    bufRef.current = "";
    setStreaming(false);
  }, []);

  const startStream = useCallback(async () => {
    if (!activePath.trim()) {
      setStatus("로그 경로를 입력하세요");
      setStatusErr(true);
      return;
    }
    await stopStream();
    setLines([]);
    setStatus("연결 중…");
    setStatusErr(false);

    const sid = uuid();
    sessionIdRef.current = sid;
    setStreaming(true);

    let unlistenOutput: UnlistenFn | undefined;
    let unlistenClosed: UnlistenFn | undefined;

    try {
      unlistenOutput = await listen<SshOutputEvent>("ssh-output", (ev) => {
        if (ev.payload.sessionId !== sid) return;
        bufRef.current += ev.payload.data;
        // Split on newlines, keep partial tail in buffer
        const parts = bufRef.current.split(/\r?\n/);
        bufRef.current = parts.pop() ?? "";
        if (parts.length === 0) return;
        setLines((prev) => {
          const next = [
            ...prev,
            ...parts
              .filter((p) => p.length > 0)
              .map((p) => ({
                id: nextId(),
                raw: p,
                text: stripAnsi(p),
                ts: extractTs(stripAnsi(p)).ts,
                level: detectLevel(stripAnsi(p)),
                matchesSearch: searchLower
                  ? stripAnsi(p).toLowerCase().includes(searchLower)
                  : false,
              } satisfies LogLine)),
          ];
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
        });
      });

      unlistenClosed = await listen<SshClosedEvent>("ssh-closed", (ev) => {
        if (ev.payload.sessionId !== sid) return;
        setStatus(`연결 종료: ${ev.payload.reason}`);
        setStatusErr(ev.payload.reason !== "closed");
        setStreaming(false);
      });

      await runWithSessionSecret(server.id, () =>
        api.sshOpen(server.id, sid, 220, 50)
      );

      // Send tail -F command
      const path = activePath.trim();
      const cmd = `tail -F '${path.replace(/'/g, `'\\''`)}'\n`;
      await api.sshWrite(sid, cmd);
      setStatus(`스트리밍: ${path}`);
      setStatusErr(false);
    } catch (e) {
      setStatus(String(e));
      setStatusErr(true);
      setStreaming(false);
      await unlistenOutput?.();
      await unlistenClosed?.();
      sessionIdRef.current = null;
    }

    return () => {
      void unlistenOutput?.();
      void unlistenClosed?.();
    };
  }, [activePath, server.id, stopStream, searchLower]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void stopStream();
    };
  }, [stopStream]);

  // ── download ──────────────────────────────────────────────────────────────
  const downloadLog = async () => {
    if (lines.length === 0) return;
    const content = filteredLines.map((l) => l.text).join("\n");
    const savePath = await dialogOpen({
      directory: false,
      multiple: false,
      filters: [{ name: "Log", extensions: ["log", "txt"] }],
      title: "로그 저장",
    });
    if (typeof savePath !== "string") return;
    try {
      await api.localWriteText(toNativeLocalPath(savePath), content);
    } catch (e) {
      window.alert(String(e));
    }
  };

  // ── search navigation ────────────────────────────────────────────────────
  const matchLines = filteredLines
    .map((l, i) => ({ i, l }))
    .filter(({ l }) => l.matchesSearch);

  const jumpToMatch = (dir: 1 | -1) => {
    if (matchLines.length === 0) return;
    const next = (matchIdx + dir + matchLines.length) % matchLines.length;
    setMatchIdx(next);
    const targetIdx = matchLines[next]?.i ?? 0;
    const el = listRef.current?.children[targetIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "center" });
  };

  // ── render helpers ────────────────────────────────────────────────────────
  const highlightText = (text: string) => {
    if (!searchLower) return text;
    const idx = text.toLowerCase().indexOf(searchLower);
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="log-highlight">{text.slice(idx, idx + searchLower.length)}</mark>
        {text.slice(idx + searchLower.length)}
      </>
    );
  };

  const renderLine = (line: LogLine) => {
    const isCurrentMatch =
      searchLower &&
      line.matchesSearch &&
      matchLines[matchIdx]?.i === filteredLines.indexOf(line);

    const display = showTs && line.ts
      ? line.text
      : line.ts
        ? line.text.slice(line.ts.length).trimStart()
        : line.text;

    return (
      <div
        key={line.id}
        className={`rlv-line${isCurrentMatch ? " rlv-line-current" : ""}`}
        style={{ color: LEVEL_COLORS[line.level] }}
        title={line.raw !== line.text ? line.raw : undefined}
      >
        <span className="rlv-line-num">{filteredLines.indexOf(line) + 1}</span>
        <span className="rlv-line-text">{highlightText(display)}</span>
      </div>
    );
  };

  // ── layout ────────────────────────────────────────────────────────────────
  const wrapClass = fullscreen ? "rlv-wrap rlv-fullscreen" : "rlv-wrap";

  return (
    <div className={wrapClass}>
      {/* ── header bar ───────────────────────────────────────────────── */}
      <div className="rlv-header">
        <span className="rlv-title">로그 뷰어 — {server.name}</span>

        {/* path selector */}
        <div className="rlv-path-row">
          {server.logCollectPaths?.length > 0 && (
            <select
              className="rlv-select"
              value={selectedPath}
              onChange={(e) => {
                setSelectedPath(e.target.value);
                setCustomPath("");
              }}
              disabled={streaming}
            >
              {server.logCollectPaths.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          <input
            className="rlv-path-input"
            type="text"
            placeholder="직접 입력 (예: /var/log/app.log)"
            value={customPath}
            disabled={streaming}
            onChange={(e) => setCustomPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !streaming) void startStream();
            }}
          />
        </div>

        <div className="rlv-header-actions">
          {!streaming ? (
            <button className="btn primary rlv-btn" onClick={() => void startStream()}>
              ▶ 스트림
            </button>
          ) : (
            <button className="btn danger rlv-btn" onClick={() => void stopStream()}>
              ■ 중지
            </button>
          )}
          <button
            className="icon-btn rlv-btn"
            title="닫기"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      {/* ── log area ─────────────────────────────────────────────────── */}
      <div className="rlv-log-section">
        {/* toolbar */}
        <div className="rlv-toolbar">
          <span className="rlv-line-badge">
            Lines: <strong>{filteredLines.length}</strong>
            {lines.length !== filteredLines.length && (
              <span className="muted"> / {lines.length}</span>
            )}
          </span>

          {/* search */}
          <div className="rlv-search-wrap">
            <input
              ref={searchRef}
              className="rlv-search"
              type="text"
              placeholder="Find in logs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") jumpToMatch(e.shiftKey ? -1 : 1);
              }}
            />
            {searchLower && (
              <span className="rlv-match-count">
                {matchCount > 0 ? `${(matchIdx % matchCount) + 1}/${matchCount}` : "0"}
              </span>
            )}
          </div>
          <button className="icon-btn rlv-icon-btn" title="이전 결과 (Shift+Enter)" onClick={() => jumpToMatch(-1)}>
            ↑
          </button>
          <button className="icon-btn rlv-icon-btn" title="다음 결과 (Enter)" onClick={() => jumpToMatch(1)}>
            ↓
          </button>

          {/* refresh (restart stream) */}
          <button
            className="icon-btn rlv-icon-btn"
            title="재시작"
            disabled={!activePath.trim()}
            onClick={() => void startStream()}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M13.65 2.35A8 8 0 1 0 15 8h-1.5a6.5 6.5 0 1 1-1.4-4.05l-1.6 1.6H15V1l-1.35 1.35z"/>
            </svg>
          </button>

          {/* play/stop */}
          {streaming ? (
            <button className="icon-btn rlv-icon-btn" title="중지" onClick={() => void stopStream()}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                <rect x="3" y="3" width="10" height="10"/>
              </svg>
            </button>
          ) : (
            <button className="icon-btn rlv-icon-btn" title="스트림 시작" onClick={() => void startStream()}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                <path d="M4 2l10 6-10 6V2z"/>
              </svg>
            </button>
          )}

          {/* download */}
          <button
            className="icon-btn rlv-icon-btn"
            title="로그 다운로드"
            disabled={filteredLines.length === 0}
            onClick={() => void downloadLog()}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M8 12l-4-4h2.5V3h3v5H12L8 12zm-5 2h10v1.5H3V14z"/>
            </svg>
          </button>

          <div className="rlv-toolbar-sep" />

          {/* level filter */}
          <select
            className="rlv-level-select"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as LogLevel)}
            title="레벨 필터"
          >
            <option value="ALL">ALL</option>
            <option value="DEBUG">DEBUG+</option>
            <option value="INFO">INFO+</option>
            <option value="WARN">WARN+</option>
            <option value="ERROR">ERROR</option>
          </select>

          {/* timestamp toggle */}
          <button
            className={`icon-btn rlv-icon-btn${showTs ? " rlv-icon-btn-active" : ""}`}
            title={showTs ? "타임스탬프 숨기기" : "타임스탬프 표시"}
            onClick={() => setShowTs((v) => !v)}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11A5.5 5.5 0 0 1 8 2.5zM7.25 5v3.31l2.22 2.22.97-.97L8.75 8V5h-1.5z"/>
            </svg>
          </button>

          {/* auto-scroll toggle */}
          <button
            className={`icon-btn rlv-icon-btn${autoScroll ? " rlv-icon-btn-active" : ""}`}
            title={autoScroll ? "자동 스크롤 OFF" : "자동 스크롤 ON"}
            onClick={() => setAutoScroll((v) => !v)}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M8 11l-4-4h8l-4 4zM4 5h8v1.5H4V5z"/>
            </svg>
          </button>

          <label className="rlv-word-wrap-toggle" title="체크 시 긴 줄을 줄바꿈, 해제 시 가로 스크롤">
            <input
              type="checkbox"
              checked={wordWrap}
              onChange={(e) => setWordWrap(e.target.checked)}
            />
            Word wrap
          </label>

          {/* clear */}
          <button
            className="icon-btn rlv-icon-btn"
            title="로그 지우기"
            onClick={() => { setLines([]); }}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M2 4h1l1 9h8l1-9h1V3H2v1zm3 0h6l-.9 8H5.9L5 4zm2-3h2v1H7V1z"/>
            </svg>
          </button>

          {/* fullscreen */}
          <button
            className={`icon-btn rlv-icon-btn${fullscreen ? " rlv-icon-btn-active" : ""}`}
            title={fullscreen ? "전체화면 종료" : "전체화면"}
            onClick={() => setFullscreen((v) => !v)}
          >
            {fullscreen ? (
              <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                <path d="M5.5 1v3.5H2v1.5h5V1H5.5zm5 0H9v5h5V4.5h-3.5V1zM2 10v1.5h3.5V15H7v-5H2zm7 4.5V15h1.5v-3.5H14V10H9v5z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                <path d="M1 1h5v1.5H2.5V5H1V1zm9 0h5v4h-1.5V2.5H10V1zM1 11h1.5v2.5H5V15H1v-4zm13 2.5H11.5V15H15v-4h-1.5v2.5z"/>
              </svg>
            )}
          </button>
        </div>

        {/* log lines */}
        <div
          className={`rlv-lines${wordWrap ? " is-word-wrap" : " is-no-wrap"}`}
          ref={listRef}
          onScroll={() => {
            if (!listRef.current) return;
            const { scrollTop, scrollHeight, clientHeight } = listRef.current;
            const atBottom = scrollHeight - scrollTop - clientHeight < 40;
            if (!atBottom && autoScroll) setAutoScroll(false);
          }}
        >
          <div className="rlv-lines-body">
            {filteredLines.length === 0 ? (
              <div className="rlv-empty">
                {streaming
                  ? "로그 대기 중…"
                  : activePath
                    ? "▶ 스트림을 시작하세요"
                    : "로그 경로를 선택하거나 입력하세요"}
              </div>
            ) : (
              filteredLines.map((l) => renderLine(l))
            )}
          </div>
        </div>

        {/* status bar */}
        {status && (
          <div className={`rlv-status${statusErr ? " rlv-status-err" : ""}`}>
            {streaming && <span className="rlv-dot" />}
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
