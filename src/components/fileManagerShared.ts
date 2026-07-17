export const LOCAL_FILE_DRAG_MIME = "application/x-servermanager-local-file";
export const REMOTE_FILE_DRAG_MIME = "application/x-servermanager-remote-file";

const LOCAL_PREFIX = "sm-local:";
const REMOTE_PREFIX = "sm-remote:";

export type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
};

export type RemoteDragPayload = {
  serverId: string;
  path: string;
  name: string;
};

export type ParsedDrag =
  | { source: "local"; path: string }
  | { source: "remote"; path: string; name: string; serverId: string }
  | { source: "os"; path: string };

export function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fileNameFromPath(p: string) {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "file";
}

export function joinRemote(dir: string, name: string) {
  if (!dir || dir === "/") return `/${name}`;
  return `${dir.replace(/\/$/, "")}/${name}`;
}

/** True when running on Windows (Tauri / browser UA). */
export function isWindowsOs() {
  if (typeof navigator === "undefined") return false;
  return /Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent);
}

/** Normalize a local filesystem path to the current OS style. */
export function toNativeLocalPath(path: string) {
  if (!path) return path;
  if (isWindowsOs()) {
    let p = path.replace(/\//g, "\\");
    // `C:` → `C:\`
    if (/^[A-Za-z]:$/.test(p)) p = `${p}\\`;
    return p;
  }
  return path.replace(/\\/g, "/");
}

export function joinLocal(dir: string, name: string) {
  const base = toNativeLocalPath(dir).replace(/[/\\]+$/, "");
  const sep = isWindowsOs() ? "\\" : "/";
  return `${base}${sep}${name}`;
}

export function encodeLocalDrag(path: string) {
  return `${LOCAL_PREFIX}${path}`;
}

export function encodeRemoteDrag(payload: RemoteDragPayload) {
  return `${REMOTE_PREFIX}${JSON.stringify(payload)}`;
}

export function parseDragText(text: string): ParsedDrag | null {
  if (text.startsWith(LOCAL_PREFIX)) {
    const path = text.slice(LOCAL_PREFIX.length);
    return path ? { source: "local", path } : null;
  }
  if (text.startsWith(REMOTE_PREFIX)) {
    try {
      const payload = JSON.parse(text.slice(REMOTE_PREFIX.length)) as RemoteDragPayload;
      if (payload?.path) {
        return {
          source: "remote",
          path: payload.path,
          name: payload.name || fileNameFromPath(payload.path),
          serverId: payload.serverId,
        };
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Short label for a path bookmark (last segment, or drive / root). */
export function pathBookmarkLabel(path: string) {
  if (!path) return "내 PC";
  const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:$/.test(norm)) return `${norm}/`;
  const parts = norm.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}
