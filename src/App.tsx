import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { v4 as uuid } from "uuid";
import { api } from "./api";
import { FavoritesPanel, type FavoriteRunTarget } from "./components/FavoritesPanel";
import { FilesPane } from "./components/FilesPane";
import {
  LogCollectPanel,
  buildLogCollectPlan,
  type LogCollectOutput,
} from "./components/LogCollectPanel";
import { ServerModal } from "./components/ServerModal";
import { SettingsModal } from "./components/SettingsModal";
import { TerminalPane, sendCtrlC, writeToSession } from "./components/TerminalPane";
import { joinLocal, toNativeLocalPath } from "./components/fileManagerShared";
import type { AppSettingsView, Server, WorkspacePane } from "./types";
import { openPath } from "@tauri-apps/plugin-opener";
import "./App.css";

function isLogCollectPane(pane: WorkspacePane) {
  return pane.kind === "terminal" && (pane.title === "로그수집" || pane.title.startsWith("로그:"));
}

function createTerminalPane(index: number, title?: string): WorkspacePane {
  const sessionId = uuid();
  return {
    id: uuid(),
    kind: "terminal",
    sessionId,
    title: title ?? `터미널 ${index}`,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function App() {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panes, setPanes] = useState<WorkspacePane[]>([]);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [showServerModal, setShowServerModal] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettingsView | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const [logCollectOpen, setLogCollectOpen] = useState(false);
  const [logCollecting, setLogCollecting] = useState(false);
  const [logOutputs, setLogOutputs] = useState<LogCollectOutput[]>([]);
  const [logCollectStatus, setLogCollectStatus] = useState<string | null>(null);
  const [logCollectError, setLogCollectError] = useState(false);
  const [logCollectSessionIds, setLogCollectSessionIds] = useState<string[]>([]);
  const [logCollectDir, setLogCollectDir] = useState<string | null>(null);
  const [pendingDownload, setPendingDownload] = useState<LogCollectOutput[] | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    server: Server;
  } | null>(null);

  const selected = useMemo(
    () => servers.find((s) => s.id === selectedId) ?? null,
    [servers, selectedId],
  );

  const activeTerminalSessionId = useMemo(() => {
    const pane = panes.find((p) => p.id === activePaneId);
    if (pane?.kind === "terminal" && pane.sessionId) return pane.sessionId;
    const first = panes.find((p) => p.kind === "terminal" && p.sessionId);
    return first?.sessionId ?? null;
  }, [panes, activePaneId]);

  const reloadServers = useCallback(async () => {
    const list = await api.listServers();
    setServers(list);
    return list;
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const openEditServer = (server: Server) => {
    setEditingServer(server);
    setShowServerModal(true);
    setContextMenu(null);
  };

  useEffect(() => {
    void (async () => {
      try {
        const [list, cfg] = await Promise.all([
          api.listServers(),
          api.getAppSettings(),
        ]);
        setServers(list);
        setSettings(cfg);
        if (list[0]) {
          setSelectedId(list[0].id);
        }
      } catch (e) {
        setBootError(String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setPanes([]);
      setActivePaneId(null);
      setFileManagerOpen(false);
      setLogCollectOpen(false);
      setLogCollecting(false);
      setLogOutputs([]);
      setLogCollectSessionIds([]);
      setLogCollectDir(null);
      setPendingDownload(null);
      return;
    }
    const term = createTerminalPane(1);
    setPanes([term]);
    setActivePaneId(term.id);
    setFileManagerOpen(false);
    setLogCollectOpen(false);
    setLogCollecting(false);
    setLogOutputs([]);
    setLogCollectSessionIds([]);
    setLogCollectDir(null);
    setPendingDownload(null);
    setLogCollectStatus(null);
  }, [selectedId]);

  const openWorkspaceFor = (server: Server) => {
    setSelectedId(server.id);
  };

  const addTerminal = () => {
    setFileManagerOpen(false);
    const count = panes.filter((p) => p.kind === "terminal").length + 1;
    const pane = createTerminalPane(count);
    setPanes((prev) => [...prev, pane]);
    setActivePaneId(pane.id);
  };

  const toggleFileManager = () => {
    setFileManagerOpen((open) => !open);
  };

  const addFavoritesPane = () => {
    setFileManagerOpen(false);
    if (panes.some((p) => p.kind === "favorites")) {
      const existing = panes.find((p) => p.kind === "favorites");
      if (existing) setActivePaneId(existing.id);
      return;
    }
    const pane: WorkspacePane = {
      id: uuid(),
      kind: "favorites",
      title: "즐겨찾기",
    };
    setPanes((prev) => [...prev, pane]);
    setActivePaneId(pane.id);
  };

  const ensureParallelLogTerminals = (titles: string[]): string[] => {
    const panesToAdd = titles.map((title) => createTerminalPane(0, title));
    const sessionIds = panesToAdd.map((p) => p.sessionId!);
    setPanes((prev) => {
      const kept = prev.filter((p) => !isLogCollectPane(p));
      return [...kept, ...panesToAdd];
    });
    if (panesToAdd[0]) setActivePaneId(panesToAdd[0].id);
    setLogCollectSessionIds(sessionIds);
    return sessionIds;
  };

  const saveLogPaths = async (paths: string[]) => {
    if (!selected) return;
    const server = await api.saveLogCollectPaths(selected.id, paths);
    setServers((prev) => prev.map((s) => (s.id === server.id ? server : s)));
    setLogCollectStatus("로그 경로를 저장했습니다");
    setLogCollectError(false);
  };

  const startLogCollect = async (paths: string[]) => {
    if (!selected) return;
    if (paths.length === 0) {
      setLogCollectStatus("로그 경로를 입력하세요");
      setLogCollectError(true);
      return;
    }
    setFileManagerOpen(false);
    await saveLogPaths(paths);

    const stamp = new Date();
    const { plan, collectDir, stamp: stampStr } = buildLogCollectPlan(paths, stamp);
    const sessionIds = ensureParallelLogTerminals(plan.map((p) => p.paneTitle));

    // Wait for all SSH sessions to connect, then start all tails in parallel
    await sleep(1500 + sessionIds.length * 250);
    await Promise.all(
      plan.map((p, i) => writeToSession(sessionIds[i]!, p.command, true)),
    );

    const outputs: LogCollectOutput[] = plan.map((p) => ({
      source: p.source,
      outputFile: p.outputFile,
      fileName: p.fileName,
      stamp: stampStr,
    }));
    setLogOutputs(outputs);
    setLogCollectDir(collectDir);
    setLogCollecting(true);
    setLogCollectStatus(
      `${outputs.length}개 로그 병렬 수집 시작 · 저장: ${collectDir}`,
    );
    setLogCollectError(false);
  };

  const closeLogCollectPanes = () => {
    setPanes((prev) => {
      const next = prev.filter((p) => !isLogCollectPane(p));
      setActivePaneId((cur) => {
        if (next.some((p) => p.id === cur)) return cur;
        return next[0]?.id ?? null;
      });
      return next;
    });
    setLogCollectSessionIds([]);
  };

  const downloadCollectedLogs = async (
    outputs: LogCollectOutput[],
    localDir: string,
  ) => {
    if (!selected || outputs.length === 0 || !localDir.trim()) return;
    const stamp = outputs[0]!.stamp;
    setLogCollectStatus("로그 파일 다운로드 중…");
    setLogCollectError(false);
    try {
      await api.sftpOpen(selected.id);
      const remoteHome = await api.sftpHome(selected.id);
      const dir = toNativeLocalPath(localDir).replace(/[/\\]+$/, "");
      await api.localMkdir(dir);

      for (const o of outputs) {
        const remotePath = `${remoteHome.replace(/\/$/, "")}/logs/${stamp}/${o.fileName}`;
        const localPath = joinLocal(dir, o.fileName);
        await api.sftpDownload(selected.id, remotePath, localPath);
      }

      setLogCollectStatus(`다운로드 완료 (${outputs.length}개) → ${dir}`);
    } catch (e) {
      setLogCollectStatus(String(e));
      setLogCollectError(true);
    }
  };

  const stopLogCollect = async (): Promise<LogCollectOutput[]> => {
    const sessionIds =
      logCollectSessionIds.length > 0
        ? logCollectSessionIds
        : panes.filter(isLogCollectPane).map((p) => p.sessionId!).filter(Boolean);

    if (sessionIds.length === 0) {
      setLogCollectStatus("로그수집 터미널을 찾을 수 없습니다");
      setLogCollectError(true);
      return [];
    }

    const outputsSnapshot = [...logOutputs];

    // Ctrl+C to every collect session in parallel
    await Promise.all(sessionIds.map((id) => sendCtrlC(id)));
    await sleep(120);
    await Promise.all(sessionIds.map((id) => sendCtrlC(id)));
    await sleep(300);

    setLogCollecting(false);
    closeLogCollectPanes();

    setLogCollectStatus(
      outputsSnapshot.length > 0
        ? `수집 종료 · 생성 파일: ${outputsSnapshot.map((o) => o.outputFile).join(", ")}`
        : "수집 종료",
    );
    setLogCollectError(false);
    // Download only after explicit user confirmation in LogCollectPanel
    return outputsSnapshot;
  };

  const closePane = (id: string) => {
    const closing = panes.find((p) => p.id === id);
    if (closing && isLogCollectPane(closing) && logCollecting) {
      void (async () => {
        const outs = await stopLogCollect();
        if (outs.length > 0) {
          setPendingDownload(outs);
          setLogCollectOpen(true);
        }
      })();
      return;
    }
    setPanes((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (activePaneId === id) {
        setActivePaneId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const openNewTerminalSession = async (): Promise<string | null> => {
    setFileManagerOpen(false);
    const count = panes.filter((p) => p.kind === "terminal").length + 1;
    const pane = createTerminalPane(count);
    setPanes((prev) => [...prev, pane]);
    setActivePaneId(pane.id);
    // Allow SSH session to connect before sending commands
    await sleep(1500);
    return pane.sessionId ?? null;
  };

  const onRunCommand = (
    value: string,
    run: boolean,
    target: FavoriteRunTarget = "current",
  ) => {
    void (async () => {
      if (target === "new") {
        const sessionId = await openNewTerminalSession();
        if (!sessionId) return;
        await writeToSession(sessionId, value, run);
        return;
      }
      if (!activeTerminalSessionId) return;
      await writeToSession(activeTerminalSessionId, value, run);
    })();
  };

  const onGoPath = (path: string, target: FavoriteRunTarget = "current") => {
    const escaped = path.replace(/"/g, '\\"');
    const cmd = `cd "${escaped}"`;
    void (async () => {
      if (target === "new") {
        const sessionId = await openNewTerminalSession();
        if (!sessionId) return;
        await writeToSession(sessionId, cmd, true);
        return;
      }
      if (!activeTerminalSessionId) return;
      await writeToSession(activeTerminalSessionId, cmd, true);
    })();
  };

  const openLocalExplorer = async () => {
    try {
      const home = await api.localHome();
      await openPath(toNativeLocalPath(home));
    } catch (e) {
      window.alert(`로컬 탐색기를 열 수 없습니다.\n${String(e)}`);
    }
  };

  const deleteSelectedServer = async () => {
    if (!selected) return;
    if (!window.confirm(`"${selected.name}" 서버를 삭제할까요?`)) return;
    await api.deleteServer(selected.id);
    const list = await reloadServers();
    setSelectedId(list[0]?.id ?? null);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Workspace</h1>
          <button
            className="icon-btn"
            type="button"
            title="서버 추가"
            onClick={() => {
              setEditingServer(null);
              setShowServerModal(true);
            }}
          >
            +
          </button>
        </div>
        <div className="server-list">
          {servers.length === 0 && (
            <div className="empty-state" style={{ height: "auto", paddingTop: 32 }}>
              <p>등록된 서버가 없습니다.</p>
            </div>
          )}
          {servers.map((server) => (
            <button
              key={server.id}
              type="button"
              className={`server-item${selectedId === server.id ? " active" : ""}`}
              onClick={() => openWorkspaceFor(server)}
              onDoubleClick={() => openEditServer(server)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, server });
              }}
            >
              <span className="name">{server.name}</span>
              <span className="meta">
                {server.username}@{server.host}:{server.port}
              </span>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button className="btn" type="button" onClick={() => void openLocalExplorer()}>
            로컬 탐색기
          </button>
          <button className="btn" type="button" onClick={() => setShowSettings(true)}>
            설정
          </button>
        </div>
      </aside>

      <main className="main">
        {bootError && (
          <div className="msg error" style={{ padding: 12 }}>
            {bootError}
          </div>
        )}
        {!selected ? (
          <div className="empty-state">
            <div>
              <h3>Server Manager</h3>
              <p>좌측에서 서버를 추가하거나 선택하세요.</p>
              <p className="sub">접속 정보는 서버별 .env 파일(기본) 또는 Infisical(선택)에서 가져옵니다.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <h2>
                {selected.name}
                <span className="muted">
                  {selected.username}@{selected.host}:{selected.port}
                </span>
              </h2>
              <button className="btn" type="button" onClick={addTerminal}>
                새 터미널
              </button>
              <button className="btn" type="button" onClick={() => void openLocalExplorer()}>
                로컬 탐색기
              </button>
              <button
                className={`btn${fileManagerOpen ? " primary" : ""}`}
                type="button"
                onClick={toggleFileManager}
              >
                {fileManagerOpen ? "파일 관리자 숨김" : "파일 관리자"}
              </button>
              <button
                className={`btn${logCollectOpen || logCollecting ? " primary" : ""}`}
                type="button"
                onClick={() => setLogCollectOpen(true)}
              >
                로그수집{logCollecting ? " ●" : ""}
              </button>
              <button className="btn" type="button" onClick={addFavoritesPane}>
                즐겨찾기
              </button>
              <button className="btn danger" type="button" onClick={() => void deleteSelectedServer()}>
                서버 삭제
              </button>
            </div>
            <div className="main-body">
              <div
                className={`workspace${fileManagerOpen ? " is-obscured" : ""}`}
                aria-hidden={fileManagerOpen}
              >
                {panes.length === 0 ? (
                  <div className="empty-state">
                    <p>패널이 없습니다. 새 터미널을 열어보세요.</p>
                  </div>
                ) : (
                  <Group orientation="horizontal" id="workspace-h">
                    {panes
                      .filter((p) => p.kind !== "files")
                      .map((pane, index) => (
                        <Fragment key={pane.id}>
                          {index > 0 && <Separator className="resize-handle" />}
                          <Panel
                            id={pane.id}
                            defaultSize={`${Math.max(20, Math.floor(100 / Math.max(1, panes.filter((p) => p.kind !== "files").length)))}`}
                            minSize="15"
                          >
                            <div
                              className={`pane-shell${activePaneId === pane.id ? " active" : ""}`}
                              onMouseDown={() => setActivePaneId(pane.id)}
                            >
                              <div className="pane-header">
                                <span className="title">{pane.title}</span>
                                <button
                                  className="icon-btn"
                                  type="button"
                                  title="닫기"
                                  onClick={() => closePane(pane.id)}
                                >
                                  ×
                                </button>
                              </div>
                              {pane.kind === "terminal" && pane.sessionId && (
                                <TerminalPane
                                  serverId={selected.id}
                                  sessionId={pane.sessionId}
                                  active={!fileManagerOpen && activePaneId === pane.id}
                                />
                              )}
                              {pane.kind === "favorites" && (
                                <FavoritesPanel
                                  serverId={selected.id}
                                  onRunCommand={onRunCommand}
                                  onGoPath={onGoPath}
                                />
                              )}
                            </div>
                          </Panel>
                        </Fragment>
                      ))}
                  </Group>
                )}
              </div>

              {fileManagerOpen && (
                <div className="file-manager-layer">
                  <div className="file-manager-layer-bar">
                    <strong>파일 관리자</strong>
                    <span className="muted">터미널 세션은 백그라운드에서 유지됩니다</span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setFileManagerOpen(false)}
                    >
                      숨김 (터미널로)
                    </button>
                  </div>
                  <div className="file-manager-layer-body">
                    <FilesPane serverId={selected.id} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {showServerModal && (
        <ServerModal
          initial={editingServer}
          defaults={{
            projectId: settings?.projectId ?? "",
            environment: settings?.environment ?? "dev",
          }}
          onClose={() => setShowServerModal(false)}
          onSaved={async (server) => {
            setShowServerModal(false);
            await reloadServers();
            setSelectedId(server.id);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={(cfg) => setSettings(cfg)}
        />
      )}

      {logCollectOpen && selected && (
        <LogCollectPanel
          server={selected}
          collecting={logCollecting}
          outputs={logOutputs}
          workingDirHint={logCollectDir}
          status={logCollectStatus}
          error={logCollectError}
          onClose={() => setLogCollectOpen(false)}
          onSavePaths={saveLogPaths}
          onStart={startLogCollect}
          onStop={stopLogCollect}
          onDownload={downloadCollectedLogs}
          pendingDownload={pendingDownload}
          onClearPendingDownload={() => setPendingDownload(null)}
        />
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            onClick={() => openEditServer(contextMenu.server)}
          >
            서버 편집
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
