import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import type { Server } from "../types";
import { api, runWithSessionSecret } from "../api";
import { joinLocal, toNativeLocalPath } from "./fileManagerShared";
import {
  buildSancboxAbsolutePath,
  matchesSancboxFilePrefix,
  parseSancboxPath,
  type SancboxPathInfo,
} from "../lib/sancboxPath";

interface Props {
  server: Server;
  onClose: () => void;
}

export function ApprovalToolPanel({ server, onClose }: Props) {
  const [objectId, setObjectId] = useState("");
  const [pathInfo, setPathInfo] = useState<SancboxPathInfo | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirPath, setDirPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [downloadedLocalPath, setDownloadedLocalPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const findPath = async () => {
    setError(null);
    setStatus(null);
    setDownloadedLocalPath(null);
    setPathInfo(null);
    setFilePath(null);
    setDirPath(null);

    let parsed: SancboxPathInfo;
    try {
      parsed = parseSancboxPath(objectId);
    } catch (e) {
      setError((e as Error).message);
      return;
    }

    setBusy(true);
    try {
      await runWithSessionSecret(server.id, () => api.sftpOpen(server.id));
      const home = await api.sftpHome(server.id);
      setPathInfo(parsed);
      setDirPath(buildSancboxAbsolutePath(home, parsed.dirRelativePath));
      setFilePath(buildSancboxAbsolutePath(home, parsed.filePathPattern));
      setStatus("경로를 추출했습니다.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const downloadPath = async () => {
    if (!dirPath || !pathInfo) return;
    setError(null);
    setStatus(null);
    setDownloadedLocalPath(null);

    const selected = await open({
      directory: true,
      multiple: false,
      title: "저장 폴더 선택",
    });
    if (typeof selected !== "string") return;

    const localDir = toNativeLocalPath(selected);
    setBusy(true);
    try {
      await runWithSessionSecret(server.id, () => api.sftpOpen(server.id));
      const entries = await api.sftpList(server.id, dirPath);
      const files = entries.filter(
        (e) =>
          !e.isDir &&
          e.name !== "." &&
          e.name !== ".." &&
          matchesSancboxFilePrefix(e.name, pathInfo.filePrefix),
      );

      if (files.length === 0) {
        setError(
          `원격 폴더에 일치 파일이 없습니다.\n폴더: ${dirPath}\n패턴: ${pathInfo.filePrefix}*`,
        );
        return;
      }

      await api.localMkdir(localDir);
      const objectFolder = joinLocal(localDir, pathInfo.objectId);
      await api.localMkdir(objectFolder);

      for (const file of files) {
        const remote = `${dirPath.replace(/\/+$/, "")}/${file.name}`;
        const local = joinLocal(objectFolder, file.name);
        await api.sftpDownload(server.id, remote, local);
      }
      setDownloadedLocalPath(objectFolder);
      setStatus(`다운로드 완료 (${files.length}개) → ${objectFolder}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const openDownloadedFolder = async () => {
    if (!downloadedLocalPath) return;
    try {
      await openPath(toNativeLocalPath(downloadedLocalPath));
    } catch (e) {
      setError(`로컬 탐색기를 열 수 없습니다.\n${String(e)}`);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal approval-modal"
        role="dialog"
        aria-label="결재Tool"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>결재Tool</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="닫기">
            ×
          </button>
        </div>

        <div className="modal-body approval-body">
          <p className="approval-hint">
            OBJECTID로 전자결재 sancbox 경로를 추출합니다.
            <br />
            <span className="muted">
              $HOME/hoffice/sancbox/YYYY/M/D/폴더/OBJECTID앞18자*
            </span>
          </p>

          <label className="field-label" htmlFor="approval-objectid">
            경로찾기
          </label>
          <div className="approval-input-row">
            <span className="approval-input-prefix">OBJECTID</span>
            <input
              id="approval-objectid"
              className="approval-input"
              type="text"
              value={objectId}
              onChange={(e) => setObjectId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void findPath();
              }}
              placeholder="JHOMS260760022471000"
              spellCheck={false}
              disabled={busy}
            />
            <button
              type="button"
              className="btn primary"
              disabled={busy || !objectId.trim()}
              onClick={() => void findPath()}
            >
              경로찾기
            </button>
          </div>

          {error && <div className="msg error">{error}</div>}
          {status && !error && (
            <div className="msg ok approval-status-row">
              <span className="approval-status-text">{status}</span>
              {downloadedLocalPath && (
                <button
                  type="button"
                  className="btn"
                  title={downloadedLocalPath}
                  onClick={() => void openDownloadedFolder()}
                >
                  탐색기
                </button>
              )}
            </div>
          )}

          {filePath && pathInfo && (
            <div className="approval-result">
              <h4>추출 경로</h4>
              <code className="approval-path">{filePath}</code>
              <p className="approval-help muted">
                {pathInfo.year}/{pathInfo.month}/{pathInfo.day}/{pathInfo.folder}/
                {pathInfo.filePrefix}*
              </p>
              <div className="approval-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void downloadPath()}
                >
                  다운로드
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
