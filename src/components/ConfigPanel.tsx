/**
 * ConfigPanel — remote config file browser + editor
 *
 * - Top: recent / favorite config paths with Edit menu
 * - Bottom-left: collapsible remote file explorer
 * - Edit (chip menu or explorer context menu) → modal editor
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { api, runWithSessionSecret } from "../api";
import type { Favorite, Server } from "../types";
import { fileNameFromPath, formatSize, type FileEntry } from "./fileManagerShared";
import {
  asciiToNative,
  draftToRaw,
  isPropertiesFile,
  nativeToAscii,
  rawToDraft,
} from "../lib/propertiesNativeAscii";

interface Props {
  server: Server;
  onClose: () => void;
}

interface EditorState {
  path: string;
  content: string;
  original: string;
  size: number;
  truncated: boolean;
}

const RECENT_KEY = (serverId: string) => `sm-config-recent:${serverId}`;
const MAX_RECENT = 12;

function loadRecent(serverId: string): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY(serverId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string" && p.length > 0);
  } catch {
    return [];
  }
}

function saveRecent(serverId: string, paths: string[]) {
  localStorage.setItem(RECENT_KEY(serverId), JSON.stringify(paths.slice(0, MAX_RECENT)));
}

function pushRecent(serverId: string, path: string): string[] {
  const next = [path, ...loadRecent(serverId).filter((p) => p !== path)].slice(0, MAX_RECENT);
  saveRecent(serverId, next);
  return next;
}

function removeRecent(serverId: string, path: string): string[] {
  const next = loadRecent(serverId).filter((p) => p !== path);
  saveRecent(serverId, next);
  return next;
}

export function ConfigPanel({ server, onClose }: Props) {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [recent, setRecent] = useState<string[]>(() => loadRecent(server.id));
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [homePath, setHomePath] = useState("/");
  const [path, setPath] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState(false);
  const [chipMenu, setChipMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ entry: FileEntry; x: number; y: number } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSearch, setEditSearch] = useState("");
  const [nativeDisplay, setNativeDisplay] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineGutterRef = useRef<HTMLDivElement>(null);
  const sftpReady = useRef(false);

  const reloadFavorites = useCallback(async () => {
    try {
      const all = await api.listFavorites(server.id);
      setFavorites(all.filter((f) => f.type === "configPath"));
    } catch (e) {
      setStatus(String(e));
      setStatusErr(true);
    }
  }, [server.id]);

  const ensureSftp = useCallback(async () => {
    if (sftpReady.current) return;
    await runWithSessionSecret(server.id, () => api.sftpOpen(server.id), "SFTP");
    sftpReady.current = true;
  }, [server.id]);

  const loadDir = useCallback(
    async (p: string) => {
      setBusy(true);
      setStatusErr(false);
      try {
        await ensureSftp();
        const list = await api.sftpList(server.id, p);
        setEntries(list);
        setPath(p);
        setPathInput(p);
        setSelected(null);
        setStatus(`${list.length}개 항목`);
      } catch (e) {
        setStatus(String(e));
        setStatusErr(true);
      } finally {
        setBusy(false);
      }
    },
    [ensureSftp, server.id],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureSftp();
        if (cancelled) return;
        const home = await api.sftpHome(server.id);
        if (cancelled) return;
        setHomePath(home);
        await loadDir(home);
      } catch (e) {
        if (!cancelled) {
          setStatus(String(e));
          setStatusErr(true);
        }
      }
    })();
    void reloadFavorites();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per server
  }, [server.id]);

  useEffect(() => {
    if (!chipMenu && !ctxMenu) return;
    const close = () => {
      setChipMenu(null);
      setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [chipMenu, ctxMenu]);

  const openEditor = async (remotePath: string) => {
    setLoadingEdit(true);
    setStatusErr(false);
    setChipMenu(null);
    setCtxMenu(null);
    try {
      await ensureSftp();
      const content = await api.sftpReadText(server.id, remotePath);
      setEditor({
        path: content.path,
        content: content.content,
        original: content.content,
        size: content.size,
        truncated: content.truncated,
      });
      const props = isPropertiesFile(content.path);
      setNativeDisplay(props);
      setEditDraft(rawToDraft(content.content, props, content.path));
      setEditSearch("");
      setRecent(pushRecent(server.id, content.path));
      setStatus(`열림: ${content.path}`);
    } catch (e) {
      setStatus(String(e));
      setStatusErr(true);
    } finally {
      setLoadingEdit(false);
    }
  };

  const dirty = editor
    ? draftToRaw(editDraft, nativeDisplay, editor.path) !== editor.original
    : false;

  const setNativeDisplayMode = (enabled: boolean) => {
    if (enabled === nativeDisplay) return;
    setEditDraft((draft) => (enabled ? asciiToNative(draft) : nativeToAscii(draft)));
    setNativeDisplay(enabled);
  };

  const closeEditor = () => {
    if (dirty && !window.confirm("저장하지 않은 변경이 있습니다. 닫을까요?")) return;
    setEditor(null);
    setEditDraft("");
    setNativeDisplay(false);
  };

  const saveEditor = async () => {
    if (!editor) return;
    if (editor.truncated) {
      window.alert("파일이 잘린 상태(최대 2MB)라 저장할 수 없습니다.");
      return;
    }
    const raw = draftToRaw(editDraft, nativeDisplay, editor.path);
    setSaving(true);
    setStatusErr(false);
    try {
      await ensureSftp();
      await api.sftpWriteText(server.id, editor.path, raw);
      setEditor({
        ...editor,
        content: raw,
        original: raw,
        size: new TextEncoder().encode(raw).length,
        truncated: false,
      });
      setEditDraft(rawToDraft(raw, nativeDisplay, editor.path));
      setRecent(pushRecent(server.id, editor.path));
      setStatus(`저장됨: ${editor.path}`);
    } catch (e) {
      setStatus(String(e));
      setStatusErr(true);
    } finally {
      setSaving(false);
    }
  };

  const toggleFavorite = async (remotePath: string) => {
    const existing = favorites.find((f) => f.value === remotePath);
    try {
      if (existing) {
        await api.deleteFavorite(existing.id);
      } else {
        await api.upsertFavorite({
          serverId: server.id,
          type: "configPath",
          label: fileNameFromPath(remotePath),
          value: remotePath,
          sortOrder: favorites.length,
        });
      }
      await reloadFavorites();
    } catch (e) {
      setStatus(String(e));
      setStatusErr(true);
    }
  };

  const goUp = async () => {
    try {
      const parent = await api.parentRemotePath(path);
      await loadDir(parent);
    } catch (e) {
      setStatus(String(e));
      setStatusErr(true);
    }
  };

  const onOpenEntry = (entry: FileEntry) => {
    if (entry.isDir) void loadDir(entry.path);
    else void openEditor(entry.path);
  };

  const onCtx = (e: MouseEvent, entry: FileEntry) => {
    if (entry.isDir) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(entry);
    setChipMenu(null);
    setCtxMenu({ entry, x: e.clientX, y: e.clientY });
  };

  const onChipMenu = (e: MouseEvent, remotePath: string) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCtxMenu(null);
    setChipMenu({ path: remotePath, x: rect.left, y: rect.bottom + 2 });
  };

  const lineCount = useMemo(() => editDraft.split("\n").length, [editDraft]);

  const syncScroll = () => {
    const ta = textareaRef.current;
    const gutter = lineGutterRef.current;
    if (ta && gutter) gutter.scrollTop = ta.scrollTop;
  };

  const findInEditor = (dir: 1 | -1) => {
    const q = editSearch.trim();
    if (!q || !textareaRef.current) return;
    const ta = textareaRef.current;
    const from = dir === 1 ? ta.selectionEnd : Math.max(0, ta.selectionStart - 1);
    const hay = editDraft.toLowerCase();
    const needle = q.toLowerCase();
    let idx = -1;
    if (dir === 1) {
      idx = hay.indexOf(needle, from);
      if (idx < 0) idx = hay.indexOf(needle, 0);
    } else {
      idx = hay.lastIndexOf(needle, from);
      if (idx < 0) idx = hay.lastIndexOf(needle);
    }
    if (idx < 0) return;
    ta.focus();
    ta.setSelectionRange(idx, idx + q.length);
    const before = editDraft.slice(0, idx);
    const line = before.split("\n").length;
    const lineHeight = 18;
    ta.scrollTop = Math.max(0, (line - 4) * lineHeight);
    syncScroll();
  };

  const favoritePaths = useMemo(() => new Set(favorites.map((f) => f.value)), [favorites]);

  const topItems = useMemo(() => {
    const favSet = new Set(favorites.map((f) => f.value));
    const items: { path: string; kind: "favorite" | "recent" }[] = [];
    for (const f of favorites) {
      items.push({ path: f.value, kind: "favorite" });
    }
    for (const p of recent) {
      if (!favSet.has(p)) items.push({ path: p, kind: "recent" });
    }
    return items;
  }, [favorites, recent]);

  return (
    <div className="cfg-wrap">
      <div className="cfg-header">
        <span className="cfg-title">Config — {server.name}</span>
        <span className="muted cfg-header-hint">원격 설정 파일 편집</span>
        <div className="cfg-header-actions">
          <button type="button" className="btn cfg-btn" onClick={onClose}>
            ×
          </button>
        </div>
      </div>

      <div className="cfg-pins">
        <div className="cfg-pins-label">즐겨찾기 / 최근</div>
        <div className="cfg-pins-list">
          {topItems.length === 0 && (
            <span className="muted cfg-pins-empty">
              탐색기에서 파일을 열거나 즐겨찾기에 추가하세요
            </span>
          )}
          {topItems.map((item) => (
            <div key={item.path} className={`cfg-pin${item.kind === "favorite" ? " is-fav" : ""}`}>
              <button
                type="button"
                className="cfg-pin-name"
                title={item.path}
                onClick={() => void openEditor(item.path)}
              >
                {item.kind === "favorite" ? "★ " : ""}
                {fileNameFromPath(item.path)}
              </button>
              <button
                type="button"
                className="cfg-pin-menu-btn"
                title="수정 메뉴"
                aria-label="수정 메뉴"
                onClick={(e) => onChipMenu(e, item.path)}
              >
                수정 ▾
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="cfg-body">
        <div className={`cfg-explorer${explorerOpen ? "" : " is-collapsed"}`}>
          <div className="cfg-explorer-bar">
            <button
              type="button"
              className="btn cfg-btn"
              onClick={() => setExplorerOpen((v) => !v)}
              title={explorerOpen ? "탐색기 접기" : "탐색기 펼치기"}
            >
              {explorerOpen ? "◀" : "▶"}
            </button>
            {explorerOpen && (
              <>
                <strong className="cfg-explorer-title">서버 탐색기</strong>
                <button type="button" className="icon-btn" title="홈" onClick={() => void loadDir(homePath)}>
                  ⌂
                </button>
                <button type="button" className="icon-btn" title="상위" onClick={() => void goUp()}>
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="새로고침"
                  onClick={() => void loadDir(path)}
                >
                  ↻
                </button>
              </>
            )}
          </div>
          {explorerOpen && (
            <>
              <form
                className="cfg-path-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadDir(pathInput.trim() || "/");
                }}
              >
                <input
                  className="cfg-path-input"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  spellCheck={false}
                />
                <button type="submit" className="btn cfg-btn">
                  이동
                </button>
              </form>
              <div className="cfg-file-list">
                {busy && <div className="cfg-empty">불러오는 중…</div>}
                {!busy && entries.length === 0 && <div className="cfg-empty">항목이 없습니다</div>}
                {!busy &&
                  entries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      className={`cfg-file-row${selected?.path === entry.path ? " selected" : ""}`}
                      onClick={() => setSelected(entry)}
                      onDoubleClick={() => onOpenEntry(entry)}
                      onContextMenu={(e) => onCtx(e, entry)}
                    >
                      <span className={`fm-file-icon${entry.isDir ? " dir" : ""}`}>
                        {entry.isDir ? "[D]" : "[F]"}
                      </span>
                      <span className="cfg-file-name" title={entry.path}>
                        {entry.name}
                      </span>
                      {!entry.isDir && (
                        <span className="cfg-file-size">{formatSize(entry.size)}</span>
                      )}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>

        <div className="cfg-main">
          {loadingEdit ? (
            <div className="cfg-empty">파일 여는 중…</div>
          ) : (
            <div className="cfg-empty cfg-main-hint">
              <p>왼쪽 탐색기에서 파일을 더블클릭하거나</p>
              <p>우클릭 → <strong>수정</strong>으로 편집기를 엽니다.</p>
              <p className="muted">상단 즐겨찾기/최근 파일의 「수정」 메뉴도 사용할 수 있습니다.</p>
            </div>
          )}
        </div>
      </div>

      <div className={`cfg-status${statusErr ? " cfg-status-err" : ""}`}>
        {status || "준비됨"}
      </div>

      {chipMenu && (
        <div
          className="context-menu"
          style={{ left: chipMenu.x, top: chipMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            onClick={() => void openEditor(chipMenu.path)}
          >
            수정
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              const p = chipMenu.path;
              setChipMenu(null);
              void toggleFavorite(p);
            }}
          >
            {favoritePaths.has(chipMenu.path) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          </button>
          {!favoritePaths.has(chipMenu.path) && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                setRecent(removeRecent(server.id, chipMenu.path));
                setChipMenu(null);
              }}
            >
              최근에서 제거
            </button>
          )}
        </div>
      )}

      {ctxMenu && (
        <div
          className="context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            onClick={() => void openEditor(ctxMenu.entry.path)}
          >
            수정
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              const p = ctxMenu.entry.path;
              setCtxMenu(null);
              void toggleFavorite(p);
            }}
          >
            {favoritePaths.has(ctxMenu.entry.path) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          </button>
        </div>
      )}

      {editor && (
        <div className="modal-backdrop" onClick={closeEditor}>
          <div
            className="modal cfg-edit-modal"
            role="dialog"
            aria-label="설정 파일 수정"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="text-viewer-title">
                <h3>Edit {fileNameFromPath(editor.path)}</h3>
                <span className="muted" title={editor.path}>
                  {editor.path}
                  {" · "}
                  {formatSize(editor.size)}
                  {editor.truncated ? " · 앞부분만 로드됨 (저장 불가)" : ""}
                  {dirty ? " · 수정됨" : ""}
                </span>
              </div>
              <button type="button" className="icon-btn" onClick={closeEditor} title="닫기">
                ×
              </button>
            </div>

            <div className="cfg-edit-toolbar">
              <span className="rlv-line-badge">
                Lines: <strong>{lineCount}</strong>
              </span>
              <div className="rlv-search-wrap">
                <input
                  className="rlv-search"
                  placeholder="Find in file…"
                  value={editSearch}
                  onChange={(e) => setEditSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      findInEditor(e.shiftKey ? -1 : 1);
                    }
                  }}
                />
              </div>
              <button type="button" className="icon-btn rlv-icon-btn" title="이전" onClick={() => findInEditor(-1)}>
                ↑
              </button>
              <button type="button" className="icon-btn rlv-icon-btn" title="다음" onClick={() => findInEditor(1)}>
                ↓
              </button>
              <button
                type="button"
                className="icon-btn rlv-icon-btn"
                title="다시 불러오기"
                onClick={() => void openEditor(editor.path)}
              >
                ↻
              </button>
              {isPropertiesFile(editor.path) && (
                <label
                  className="cfg-native-toggle"
                  title="편집 시 \\uXXXX 를 한글 등으로 표시하고, 저장 시 다시 ASCII로 변환"
                >
                  <input
                    type="checkbox"
                    checked={nativeDisplay}
                    onChange={(e) => setNativeDisplayMode(e.target.checked)}
                  />
                  Native 표시
                </label>
              )}
            </div>

            <div className="cfg-edit-body">
              <div className="cfg-edit-gutter" ref={lineGutterRef} aria-hidden>
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i + 1}>{i + 1}</div>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                className="cfg-edit-textarea"
                value={editDraft}
                spellCheck={false}
                onChange={(e) => setEditDraft(e.target.value)}
                onScroll={syncScroll}
              />
            </div>

            <div className="cfg-edit-footer">
              <button
                type="button"
                className="btn"
                onClick={() => void toggleFavorite(editor.path)}
              >
                {favoritePaths.has(editor.path) ? "★ 즐겨찾기됨" : "☆ 즐겨찾기"}
              </button>
              <div className="cfg-edit-footer-right">
                <button type="button" className="btn" onClick={closeEditor} disabled={saving}>
                  취소
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void saveEditor()}
                  disabled={saving || !dirty || editor.truncated}
                >
                  {saving ? "저장 중…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
