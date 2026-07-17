import { useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { api } from "../api";
import { SiteExplorer } from "./SiteExplorer";
import type { FileEntry } from "./fileManagerShared";
import { fileNameFromPath, joinLocal, joinRemote } from "./fileManagerShared";

interface Props {
  serverId: string;
}

export function FilesPane({ serverId }: Props) {
  const [localHome, setLocalHome] = useState<string | null>(null);
  const [remoteHome, setRemoteHome] = useState<string | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [localSelected, setLocalSelected] = useState<FileEntry | null>(null);
  const [remoteSelected, setRemoteSelected] = useState<FileEntry | null>(null);
  const [localNonce, setLocalNonce] = useState(0);
  const [remoteNonce, setRemoteNonce] = useState(0);
  const [status, setStatus] = useState<string | null>("연결 중…");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setBusy(true);
      setError(false);
      setStatus("사이트 연결 중…");
      try {
        const homeLocal = await api.localHome();
        if (cancelled) return;
        setLocalHome(homeLocal);
        setLocalPath(homeLocal);

        await api.sftpOpen(serverId);
        if (cancelled) return;
        const homeRemote = await api.sftpHome(serverId);
        if (cancelled) return;
        setRemoteHome(homeRemote);
        setRemotePath(homeRemote);
        setStatus(null);
      } catch (e) {
        if (!cancelled) {
          setError(true);
          setStatus(String(e));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      void api.sftpClose(serverId).catch(() => undefined);
    };
  }, [serverId]);

  const report = (msg: string | null, isError = false) => {
    setStatus(msg);
    setError(isError);
  };

  const uploadLocalToRemote = async (localFilePath: string) => {
    if (!remotePath) return;
    const name = fileNameFromPath(localFilePath);
    const remote = joinRemote(remotePath, name);
    setBusy(true);
    report(`업로드: ${name} → ${remotePath}`);
    try {
      await api.sftpUpload(serverId, localFilePath, remote);
      report(`업로드 완료: ${name}`);
      setRemoteNonce((n) => n + 1);
    } catch (e) {
      report(String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const downloadRemoteToLocal = async (remoteFilePath: string, name: string) => {
    if (!localPath) {
      report("다운로드할 로컬 폴더를 선택하세요 (내 PC 제외)", true);
      return;
    }
    const local = joinLocal(localPath, name);
    setBusy(true);
    report(`다운로드: ${name} → ${localPath}`);
    try {
      await api.sftpDownload(serverId, remoteFilePath, local);
      report(`다운로드 완료: ${name}`);
      setLocalNonce((n) => n + 1);
    } catch (e) {
      report(String(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fm-root">
      <div className="fm-topbar">
        <div className="fm-topbar-side">로컬 사이트</div>
        <div className="fm-transfer-btns">
          <button
            type="button"
            className="btn primary"
            disabled={busy || !localSelected || localSelected.isDir}
            title="선택 파일을 원격 현재 폴더로 업로드"
            onClick={() => {
              if (localSelected) void uploadLocalToRemote(localSelected.path);
            }}
          >
            업로드 →
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !remoteSelected || remoteSelected.isDir}
            title="선택 파일을 로컬 현재 폴더로 다운로드"
            onClick={() => {
              if (remoteSelected) {
                void downloadRemoteToLocal(remoteSelected.path, remoteSelected.name);
              }
            }}
          >
            ← 다운로드
          </button>
        </div>
        <div className="fm-topbar-side right">원격 사이트</div>
      </div>

      <div className="fm-panes">
        <Group orientation="horizontal" id={`fm-${serverId}`}>
          <Panel id="local" defaultSize="50" minSize="28">
            {localHome ? (
              <SiteExplorer
                kind="local"
                title="로컬"
                homePath={localHome}
                refreshNonce={localNonce}
                selected={localSelected}
                onPathChange={setLocalPath}
                onSelect={setLocalSelected}
                onStatus={report}
                dropEnabled
                dropHint={`로컬에 저장: ${localPath || "(폴더 선택 필요)"}`}
                onDropPath={(p, source, name) => {
                  if (source === "remote") {
                    void downloadRemoteToLocal(p, name || fileNameFromPath(p));
                  }
                }}
              />
            ) : (
              <div className="fm-loading">로컬 사이트 준비 중…</div>
            )}
          </Panel>
          <Separator className="resize-handle fm-main-sep" />
          <Panel id="remote" defaultSize="50" minSize="28">
            {remoteHome ? (
              <SiteExplorer
                kind="remote"
                title="원격"
                serverId={serverId}
                homePath={remoteHome}
                refreshNonce={remoteNonce}
                selected={remoteSelected}
                onPathChange={setRemotePath}
                onSelect={setRemoteSelected}
                onStatus={report}
                dropEnabled
                dropHint={`원격에 업로드: ${remotePath}`}
                onDropPath={(p, source) => {
                  if (source === "local" || source === "os") {
                    void uploadLocalToRemote(p);
                  }
                }}
              />
            ) : (
              <div className="fm-loading">원격 사이트 연결 중…</div>
            )}
          </Panel>
        </Group>
      </div>

      <div className={`fm-statusbar${error ? " error" : ""}`}>
        {status ||
          `로컬 ${localPath || "—"}  ↔  원격 ${remotePath || "—"}  ·  파일을 반대쪽으로 드래그하여 전송`}
      </div>
    </div>
  );
}
