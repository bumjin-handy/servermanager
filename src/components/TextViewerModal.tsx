import { formatSize } from "./fileManagerShared";

interface Props {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  onClose: () => void;
}

export function TextViewerModal({ path, content, size, truncated, onClose }: Props) {
  const name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal text-viewer-modal"
        role="dialog"
        aria-label="텍스트 보기"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="text-viewer-title">
            <h3 title={path}>{name}</h3>
            <span className="muted">
              {formatSize(size)}
              {truncated ? " · 앞부분만 표시 (최대 2MB)" : ""}
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="닫기">
            ×
          </button>
        </div>
        <pre className="text-viewer-body">{content}</pre>
      </div>
    </div>
  );
}
