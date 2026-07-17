import { useEffect, useState, type DragEvent, type MouseEvent } from "react";
import type { FileEntry } from "./fileManagerShared";
import { formatSize } from "./fileManagerShared";

interface Props {
  entries: FileEntry[];
  selectedPath: string | null;
  busy?: boolean;
  dragOver?: boolean;
  dropHint?: string;
  emptyHint?: string;
  /** Show context menu "열기" for files (remote text view). */
  enableOpenMenu?: boolean;
  onSelect: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
  /** Context-menu open as text (files only). */
  onOpenAsText?: (entry: FileEntry) => void;
  onDragStart?: (e: DragEvent, entry: FileEntry) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent) => void;
}

export function FileTable({
  entries,
  selectedPath,
  busy,
  dragOver,
  dropHint,
  emptyHint,
  enableOpenMenu,
  onSelect,
  onOpen,
  onOpenAsText,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: Props) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const onContextMenu = (e: MouseEvent, entry: FileEntry) => {
    if (!enableOpenMenu || entry.isDir || !onOpenAsText) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(entry);
    setMenu({ x: e.clientX, y: e.clientY, entry });
  };

  return (
    <div
      className={`fm-table-wrap${dragOver ? " drag-over" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragOver && dropHint && <div className="drop-overlay">{dropHint}</div>}
      <table className="fm-table">
        <thead>
          <tr>
            <th className="col-name">이름</th>
            <th className="col-size">크기</th>
            <th className="col-type">종류</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && !busy && (
            <tr>
              <td colSpan={3} className="fm-empty">
                {emptyHint || "항목이 없습니다"}
              </td>
            </tr>
          )}
          {entries.map((entry) => (
            <tr
              key={entry.path}
              className={selectedPath === entry.path ? "selected" : ""}
              draggable={!entry.isDir && !!onDragStart}
              onDragStart={(e) => onDragStart?.(e, entry)}
              onClick={() => onSelect(entry)}
              onDoubleClick={() => onOpen(entry)}
              onContextMenu={(e) => onContextMenu(e, entry)}
            >
              <td className="col-name">
                <span className={`fm-file-icon${entry.isDir ? " dir" : ""}`}>
                  {entry.isDir ? "[D]" : "[F]"}
                </span>
                {entry.name}
              </td>
              <td className="col-size">{entry.isDir ? "" : formatSize(entry.size)}</td>
              <td className="col-type">{entry.isDir ? "폴더" : "파일"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              const entry = menu.entry;
              setMenu(null);
              onOpenAsText?.(entry);
            }}
          >
            열기 (텍스트)
          </button>
        </div>
      )}
    </div>
  );
}
