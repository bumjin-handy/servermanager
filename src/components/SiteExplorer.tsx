import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { api } from "../api";
import type { RemoteTextContent } from "../types";
import { DirTree } from "./DirTree";
import { FileTable } from "./FileTable";
import { PathFavoritesBar } from "./PathFavoritesBar";
import { TextViewerModal } from "./TextViewerModal";
import {
  LOCAL_FILE_DRAG_MIME,
  REMOTE_FILE_DRAG_MIME,
  encodeLocalDrag,
  encodeRemoteDrag,
  parseDragText,
  toNativeLocalPath,
  type FileEntry,
  type RemoteDragPayload,
} from "./fileManagerShared";

type Kind = "local" | "remote";

interface Props {
  kind: Kind;
  title: string;
  serverId?: string;
  homePath: string;
  refreshNonce?: number;
  selected: FileEntry | null;
  onPathChange: (path: string) => void;
  onSelect: (entry: FileEntry | null) => void;
  onStatus: (msg: string | null, isError?: boolean) => void;
  dropEnabled?: boolean;
  dropHint?: string;
  onDropPath?: (
    path: string,
    source: "local" | "remote" | "os",
    name?: string,
  ) => void;
}

function hasTransferTypes(types: readonly string[], kind: Kind) {
  const list = Array.from(types);
  if (kind === "local") {
    // Accept remote-file drag (or OS files). Ignore same-side local drags.
    if (list.includes(LOCAL_FILE_DRAG_MIME) && !list.includes(REMOTE_FILE_DRAG_MIME)) {
      return false;
    }
    return (
      list.includes(REMOTE_FILE_DRAG_MIME) ||
      list.includes("Files") ||
      list.includes("text/plain")
    );
  }
  if (list.includes(REMOTE_FILE_DRAG_MIME) && !list.includes(LOCAL_FILE_DRAG_MIME)) {
    return false;
  }
  return (
    list.includes(LOCAL_FILE_DRAG_MIME) ||
    list.includes("Files") ||
    list.includes("text/plain")
  );
}

export function SiteExplorer({
  kind,
  title,
  serverId,
  homePath,
  refreshNonce = 0,
  selected,
  onPathChange,
  onSelect,
  onStatus,
  dropEnabled,
  dropHint,
  onDropPath,
}: Props) {
  const [path, setPath] = useState(homePath);
  const [pathInput, setPathInput] = useState(homePath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [localRoots, setLocalRoots] = useState<{ path: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [textView, setTextView] = useState<RemoteTextContent | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const dragDepth = useRef(0);

  const load = useCallback(
    async (p: string) => {
      setBusy(true);
      try {
        const list =
          kind === "local"
            ? p === ""
              ? await api.localDrives()
              : await api.localList(p)
            : await api.sftpList(serverId!, p);
        setEntries(list);
        const displayPath =
          kind === "local" && p !== "" ? toNativeLocalPath(p) : p;
        setPath(displayPath);
        setPathInput(p === "" ? "내 PC" : displayPath);
        onPathChange(displayPath);
        onSelect(null);
      } catch (e) {
        onStatus(String(e), true);
      } finally {
        setBusy(false);
      }
    },
    [kind, serverId, onPathChange, onSelect, onStatus],
  );

  useEffect(() => {
    if (kind !== "local") return;
    let cancelled = false;
    void (async () => {
      try {
        const drives = await api.localDrives();
        if (cancelled) return;
        setLocalRoots(drives.map((d) => ({ path: d.path, name: d.name })));
      } catch (e) {
        if (!cancelled) onStatus(String(e), true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, onStatus]);

  useEffect(() => {
    void load(homePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / home change only
  }, [homePath]);

  useEffect(() => {
    if (refreshNonce === 0) return;
    void load(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  const goHome = () => void load(homePath);

  const goComputer = () => {
    if (kind === "local") void load("");
  };

  const goUp = async () => {
    if (kind === "local") {
      if (path === "") return;
      const parent = await api.localParent(path);
      await load(parent);
      return;
    }
    if (path === homePath) return;
    const parent = await api.parentRemotePath(path);
    if (parent && parent !== path) await load(parent);
  };

  const onDragStart = (e: DragEvent, entry: FileEntry) => {
    if (entry.isDir) {
      e.preventDefault();
      return;
    }
    if (kind === "local") {
      e.dataTransfer.setData(LOCAL_FILE_DRAG_MIME, entry.path);
      e.dataTransfer.setData("text/plain", encodeLocalDrag(entry.path));
    } else if (serverId) {
      const payload: RemoteDragPayload = {
        serverId,
        path: entry.path,
        name: entry.name,
      };
      e.dataTransfer.setData(REMOTE_FILE_DRAG_MIME, JSON.stringify(payload));
      e.dataTransfer.setData("text/plain", encodeRemoteDrag(payload));
    }
    e.dataTransfer.effectAllowed = "copy";
  };

  const clearDragOver = () => {
    dragDepth.current = 0;
    setDragOver(false);
  };

  const onDragEnter = (e: DragEvent) => {
    if (!dropEnabled) return;
    if (!hasTransferTypes(e.dataTransfer.types, kind)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  };

  const onDragOver = (e: DragEvent) => {
    if (!dropEnabled) return;
    if (!hasTransferTypes(e.dataTransfer.types, kind)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  };

  const onDragLeave = (e: DragEvent) => {
    if (!dropEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  const onDrop = (e: DragEvent) => {
    if (!dropEnabled || !onDropPath) return;
    e.preventDefault();
    e.stopPropagation();
    clearDragOver();

    const customLocal = e.dataTransfer.getData(LOCAL_FILE_DRAG_MIME);
    if (customLocal && kind === "remote") {
      onDropPath(customLocal, "local");
      return;
    }

    const remoteRaw = e.dataTransfer.getData(REMOTE_FILE_DRAG_MIME);
    if (remoteRaw && kind === "local") {
      try {
        const payload = JSON.parse(remoteRaw) as RemoteDragPayload;
        onDropPath(payload.path, "remote", payload.name);
      } catch {
        onStatus("원격 드래그 데이터를 해석할 수 없습니다", true);
      }
      return;
    }

    const plain = e.dataTransfer.getData("text/plain");
    if (plain) {
      const parsed = parseDragText(plain);
      if (parsed) {
        if (parsed.source === "local" && kind === "remote") {
          onDropPath(parsed.path, "local");
          return;
        }
        if (parsed.source === "remote" && kind === "local") {
          onDropPath(parsed.path, "remote", parsed.name);
          return;
        }
        // Same-side drop ignored
        return;
      }
    }

    const file = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
    if (file?.path && kind === "remote") {
      onDropPath(file.path, "os");
    }
  };

  const submitPath = () => {
    const raw = pathInput.trim();
    if (kind === "local" && (raw === "" || raw === "내 PC")) {
      void load("");
      return;
    }
    void load(kind === "local" ? toNativeLocalPath(raw) : raw);
  };

  const openRemoteAsText = async (entry: FileEntry) => {
    if (kind !== "remote" || !serverId || entry.isDir) return;
    setTextLoading(true);
    try {
      const content = await api.sftpReadText(serverId, entry.path);
      setTextView(content);
    } catch (e) {
      onStatus(String(e), true);
    } finally {
      setTextLoading(false);
    }
  };

  return (
    <div className={`fm-site fm-site-${kind}`}>
      <div className="fm-site-header">
        <strong>{title}</strong>
        <span className="fm-site-sub">
          {kind === "local" ? "Local site · 전체 드라이브" : "Remote site (SFTP)"}
        </span>
      </div>
      <div className="fm-toolbar">
        {kind === "local" && (
          <button className="btn" type="button" disabled={busy} onClick={goComputer}>
            내 PC
          </button>
        )}
        <button className="btn" type="button" disabled={busy} onClick={goHome}>
          홈
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => void goUp()}>
          상위
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => void load(path)}>
          새로고침
        </button>
        <input
          className="path-bar"
          value={pathInput}
          placeholder={kind === "local" ? "C:/ 또는 경로 입력" : undefined}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitPath();
          }}
        />
      </div>
      <PathFavoritesBar
        kind={kind}
        serverId={serverId}
        currentPath={path}
        onNavigate={(p) => void load(p)}
        onStatus={onStatus}
      />
      <div
        className={`fm-site-body${dragOver ? " drag-over" : ""}`}
        onDragEnter={dropEnabled ? onDragEnter : undefined}
        onDragOver={dropEnabled ? onDragOver : undefined}
        onDragLeave={dropEnabled ? onDragLeave : undefined}
        onDrop={dropEnabled ? onDrop : undefined}
      >
        {dragOver && dropHint && <div className="drop-overlay">{dropHint}</div>}
        <Group orientation="horizontal" id={`site-${kind}-${serverId || "local"}`}>
          <Panel id="tree" defaultSize="30" minSize="16">
            <DirTree
              kind={kind}
              serverId={serverId}
              rootPath={kind === "remote" ? homePath : undefined}
              roots={kind === "local" ? localRoots : undefined}
              currentPath={path}
              onNavigate={(p) => void load(p)}
            />
          </Panel>
          <Separator className="resize-handle" />
          <Panel id="files" defaultSize="70" minSize="40">
            <FileTable
              entries={entries}
              selectedPath={selected?.path ?? null}
              busy={busy || textLoading}
              emptyHint={
                textLoading
                  ? "파일 여는 중…"
                  : busy
                    ? "불러오는 중…"
                    : "폴더가 비어 있습니다"
              }
              enableOpenMenu={kind === "remote"}
              onSelect={onSelect}
              onOpen={(entry) => {
                if (entry.isDir) void load(entry.path);
                else if (kind === "remote") void openRemoteAsText(entry);
                else onSelect(entry);
              }}
              onOpenAsText={(entry) => void openRemoteAsText(entry)}
              onDragStart={onDragStart}
            />
          </Panel>
        </Group>
      </div>

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
  );
}
