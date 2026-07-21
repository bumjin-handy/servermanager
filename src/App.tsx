import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { v4 as uuid } from "uuid";
import { api, runWithSessionSecret, registerPromptHandler } from "./api";
import { FavoritesPanel, type FavoriteRunTarget } from "./components/FavoritesPanel";
import { SecretPromptModal } from "./components/SecretPromptModal";
import { FilesPane } from "./components/FilesPane";
import {
  LogCollectPanel,
  buildLogCollectPlan,
  type LogCollectFilter,
  type LogCollectOutput,
} from "./components/LogCollectPanel";
import { ServerModal } from "./components/ServerModal";
import { SettingsModal } from "./components/SettingsModal";
import { SqlBindPanel } from "./components/SqlBindPanel";
import { ApprovalToolPanel } from "./components/ApprovalToolPanel";
import { TerminalPane, sendCtrlC, writeToSession } from "./components/TerminalPane";
import { joinLocal, toNativeLocalPath } from "./components/fileManagerShared";
import type { AppSettingsView, Server, WorkspacePane } from "./types";
import { openPath } from "@tauri-apps/plugin-opener";
import "./App.css";

interface ServerWorkspace {
  panes: WorkspacePane[];
  activePaneId: string | null;
  fileManagerOpen: boolean;
  logCollectOpen: boolean;
  logCollecting: boolean;
  logOutputs: LogCollectOutput[];
  logCollectStatus: string | null;
  logCollectError: boolean;
  logCollectSessionIds: string[];
  logCollectDir: string | null;
  pendingDownload: LogCollectOutput[] | null;
}

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

function createEmptyWorkspace(): ServerWorkspace {
  const term = createTerminalPane(1);
  return {
    panes: [term],
    activePaneId: term.id,
    fileManagerOpen: false,
    logCollectOpen: false,
    logCollecting: false,
    logOutputs: [],
    logCollectStatus: null,
    logCollectError: false,
    logCollectSessionIds: [],
    logCollectDir: null,
    pendingDownload: null,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function App() {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Record<string, ServerWorkspace>>({});
  const [showServerModal, setShowServerModal] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSqlBind, setShowSqlBind] = useState(false);
  const [showApprovalTool, setShowApprovalTool] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettingsView | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    server: Server;
  } | null>(null);

  const [secretPrompt, setSecretPrompt] = useState<{
    label: string;
    resolve: (val: string) => void;
    reject: (err: Error) => void;
  } | null>(null);

  useEffect(() => {
    registerPromptHandler((label) => {
      return new Promise<string>((resolve, reject) => {
        setSecretPrompt({ label, resolve, reject });
      });
    });
  }, []);

  const selected = useMemo(
    () => servers.find((s) => s.id === selectedId) ?? null,
    [servers, selectedId],
  );

  const ws = selectedId ? workspaces[selectedId] : undefined;
  const panes = ws?.panes ?? [];
  const activePaneId = ws?.activePaneId ?? null;
  const fileManagerOpen = ws?.fileManagerOpen ?? false;
  const logCollectOpen = ws?.logCollectOpen ?? false;
  const logCollecting = ws?.logCollecting ?? false;
  const logOutputs = ws?.logOutputs ?? [];
  const logCollectStatus = ws?.logCollectStatus ?? null;
  const logCollectError = ws?.logCollectError ?? false;
  const logCollectDir = ws?.logCollectDir ?? null;
  const pendingDownload = ws?.pendingDownload ?? null;

  const patchWorkspace = useCallback(
    (serverId: string, updater: (current: ServerWorkspace) => ServerWorkspace) => {
      setWorkspaces((prev) => {
        const current = prev[serverId] ?? createEmptyWorkspace();
        return { ...prev, [serverId]: updater(current) };
      });
    },
    [],
  );

  const patchSelected = useCallback(
    (updater: (current: ServerWorkspace) => ServerWorkspace) => {
      if (!selectedId) return;
      patchWorkspace(selectedId, updater);
    },
    [selectedId, patchWorkspace],
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

  // Lazily create a workspace on first visit; never reset on switch.
  useEffect(() => {
    if (!selectedId) return;
    setWorkspaces((prev) => {
      if (prev[selectedId]) return prev;
      return { ...prev, [selectedId]: createEmptyWorkspace() };
    });
  }, [selectedId]);

  const openWorkspaceFor = (server: Server) => {
    setWorkspaces((prev) =>
      prev[server.id] ? prev : { ...prev, [server.id]: createEmptyWorkspace() },
    );
    setSelectedId(server.id);
  };

  const addTerminal = () => {
    patchSelected((current) => {
      const count = current.panes.filter((p) => p.kind === "terminal").length + 1;
      const pane = createTerminalPane(count);
      return {
        ...current,
        fileManagerOpen: false,
        panes: [...current.panes, pane],
        activePaneId: pane.id,
      };
    });
  };

  const toggleFileManager = () => {
    patchSelected((current) => ({
      ...current,
      fileManagerOpen: !current.fileManagerOpen,
    }));
  };

  const addFavoritesPane = () => {
    patchSelected((current) => {
      const existing = current.panes.find((p) => p.kind === "favorites");
      if (existing) {
        return { ...current, fileManagerOpen: false, activePaneId: existing.id };
      }
      const pane: WorkspacePane = {
        id: uuid(),
        kind: "favorites",
        title: "즐겨찾기",
      };
      return {
        ...current,
        fileManagerOpen: false,
        panes: [...current.panes, pane],
        activePaneId: pane.id,
      };
    });
  };

  const ensureParallelLogTerminals = (titles: string[]): string[] => {
    const panesToAdd = titles.map((title) => createTerminalPane(0, title));
    const sessionIds = panesToAdd.map((p) => p.sessionId!);
    patchSelected((current) => {
      const kept = current.panes.filter((p) => !isLogCollectPane(p));
      return {
        ...current,
        panes: [...kept, ...panesToAdd],
        activePaneId: panesToAdd[0]?.id ?? current.activePaneId,
        logCollectSessionIds: sessionIds,
      };
    });
    return sessionIds;
  };

  const saveLogPaths = async (paths: string[]) => {
    if (!selected) return;
    const server = await api.saveLogCollectPaths(selected.id, paths);
    setServers((prev) => prev.map((s) => (s.id === server.id ? server : s)));
    patchSelected((current) => ({
      ...current,
      logCollectStatus: "로그 경로를 저장했습니다",
      logCollectError: false,
    }));
  };

  const startLogCollect = async (paths: string[], filter: LogCollectFilter) => {
    if (!selected) return;
    if (paths.length === 0) {
      patchSelected((current) => ({
        ...current,
        logCollectStatus: "로그 경로를 입력하세요",
        logCollectError: true,
      }));
      return;
    }
    patchSelected((current) => ({ ...current, fileManagerOpen: false }));
    await saveLogPaths(paths);

    const stamp = new Date();
    const { plan, collectDir, stamp: stampStr } = buildLogCollectPlan(
      paths,
      stamp,
      filter,
    );
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
    const filterNote = filter.pattern.trim()
      ? ` · 필터: ${filter.pattern.trim()}${filter.color ? " (색)" : ""}`
      : "";
    patchSelected((current) => ({
      ...current,
      logOutputs: outputs,
      logCollectDir: collectDir,
      logCollecting: true,
      logCollectStatus: `${outputs.length}개 로그 병렬 수집 시작 · 저장: ${collectDir}${filterNote}`,
      logCollectError: false,
    }));
  };

  const closeLogCollectPanes = () => {
    patchSelected((current) => {
      const next = current.panes.filter((p) => !isLogCollectPane(p));
      const activeStillThere = next.some((p) => p.id === current.activePaneId);
      return {
        ...current,
        panes: next,
        activePaneId: activeStillThere ? current.activePaneId : (next[0]?.id ?? null),
        logCollectSessionIds: [],
      };
    });
  };

  const downloadCollectedLogs = async (
    outputs: LogCollectOutput[],
    localDir: string,
  ) => {
    if (!selected || outputs.length === 0 || !localDir.trim()) return;
    const stamp = outputs[0]!.stamp;
    patchSelected((current) => ({
      ...current,
      logCollectStatus: "로그 파일 다운로드 중…",
      logCollectError: false,
    }));
    try {
      await runWithSessionSecret(selected.id, () => api.sftpOpen(selected.id));
      const remoteHome = await api.sftpHome(selected.id);
      const dir = toNativeLocalPath(localDir).replace(/[/\\]+$/, "");
      await api.localMkdir(dir);

      for (const o of outputs) {
        const remotePath = `${remoteHome.replace(/\/$/, "")}/logs/${stamp}/${o.fileName}`;
        const localPath = joinLocal(dir, o.fileName);
        await api.sftpDownload(selected.id, remotePath, localPath);
      }

      patchSelected((current) => ({
        ...current,
        logCollectStatus: `다운로드 완료 (${outputs.length}개) → ${dir}`,
      }));
    } catch (e) {
      patchSelected((current) => ({
        ...current,
        logCollectStatus: String(e),
        logCollectError: true,
      }));
    }
  };

  const stopLogCollect = async (): Promise<LogCollectOutput[]> => {
    if (!selectedId) return [];
    const current = workspaces[selectedId];
    if (!current) return [];

    const sessionIds =
      current.logCollectSessionIds.length > 0
        ? current.logCollectSessionIds
        : current.panes.filter(isLogCollectPane).map((p) => p.sessionId!).filter(Boolean);

    if (sessionIds.length === 0) {
      patchSelected((wsState) => ({
        ...wsState,
        logCollectStatus: "로그수집 터미널을 찾을 수 없습니다",
        logCollectError: true,
      }));
      return [];
    }

    const outputsSnapshot = [...current.logOutputs];

    // Ctrl+C to every collect session in parallel
    await Promise.all(sessionIds.map((id) => sendCtrlC(id)));
    await sleep(120);
    await Promise.all(sessionIds.map((id) => sendCtrlC(id)));
    await sleep(300);

    closeLogCollectPanes();
    patchSelected((wsState) => ({
      ...wsState,
      logCollecting: false,
      logCollectStatus:
        outputsSnapshot.length > 0
          ? `수집 종료 · 생성 파일: ${outputsSnapshot.map((o) => o.outputFile).join(", ")}`
          : "수집 종료",
      logCollectError: false,
    }));
    // Download only after explicit user confirmation in LogCollectPanel
    return outputsSnapshot;
  };

  const closePane = (id: string) => {
    if (!selectedId) return;
    const current = workspaces[selectedId];
    const closing = current?.panes.find((p) => p.id === id);
    if (closing && isLogCollectPane(closing) && current?.logCollecting) {
      void (async () => {
        const outs = await stopLogCollect();
        if (outs.length > 0) {
          patchSelected((wsState) => ({
            ...wsState,
            pendingDownload: outs,
            logCollectOpen: true,
          }));
        }
      })();
      return;
    }
    patchSelected((wsState) => {
      const next = wsState.panes.filter((p) => p.id !== id);
      return {
        ...wsState,
        panes: next,
        activePaneId:
          wsState.activePaneId === id ? (next[0]?.id ?? null) : wsState.activePaneId,
      };
    });
  };

  const openNewTerminalSession = async (): Promise<string | null> => {
    if (!selectedId) return null;
    const count =
      (workspaces[selectedId]?.panes.filter((p) => p.kind === "terminal").length ?? 0) + 1;
    const pane = createTerminalPane(count);
    patchSelected((current) => ({
      ...current,
      fileManagerOpen: false,
      panes: [...current.panes, pane],
      activePaneId: pane.id,
    }));
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

  const closeServerWorkspace = async (serverId: string) => {
    const closing = workspaces[serverId];
    if (closing) {
      await Promise.all(
        closing.panes
          .filter((p) => p.sessionId)
          .map((p) => api.sshClose(p.sessionId!).catch(() => undefined)),
      );
      await api.sftpClose(serverId).catch(() => undefined);
      await api.clearSessionSecret(serverId).catch(() => undefined);
    }
    setWorkspaces((prev) => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });
  };

  const deleteSelectedServer = async () => {
    if (!selected) return;
    if (!window.confirm(`"${selected.name}" 서버를 삭제할까요?`)) return;
    const serverId = selected.id;
    await closeServerWorkspace(serverId);
    await api.deleteServer(serverId);
    const list = await reloadServers();
    setSelectedId(list[0]?.id ?? null);
  };

  const renderServerWorkspace = (server: Server, workspace: ServerWorkspace, visible: boolean) => {
    const visiblePanes = workspace.panes.filter((p) => p.kind !== "files");
    return (
      <div
        key={server.id}
        className={`server-workspace${visible ? "" : " is-hidden"}`}
        aria-hidden={!visible}
      >
        <div
          className={`workspace${workspace.fileManagerOpen ? " is-obscured" : ""}`}
          aria-hidden={workspace.fileManagerOpen}
        >
          {workspace.panes.length === 0 ? (
            <div className="empty-state">
              <p>패널이 없습니다. 새 터미널을 열어보세요.</p>
            </div>
          ) : (
            <Group orientation="horizontal" id={`workspace-h-${server.id}`}>
              {visiblePanes.map((pane, index) => (
                <Fragment key={pane.id}>
                  {index > 0 && <Separator className="resize-handle" />}
                  <Panel
                    id={pane.id}
                    defaultSize={`${Math.max(20, Math.floor(100 / Math.max(1, visiblePanes.length)))}`}
                    minSize="15"
                  >
                    <div
                      className={`pane-shell${workspace.activePaneId === pane.id ? " active" : ""}`}
                      onMouseDown={() => {
                        if (!visible) return;
                        patchWorkspace(server.id, (current) => ({
                          ...current,
                          activePaneId: pane.id,
                        }));
                      }}
                    >
                      <div className="pane-header">
                        <span className="title">{pane.title}</span>
                        <button
                          className="icon-btn"
                          type="button"
                          title="닫기"
                          onClick={() => {
                            if (visible) closePane(pane.id);
                          }}
                        >
                          ×
                        </button>
                      </div>
                      {pane.kind === "terminal" && pane.sessionId && (
                        <TerminalPane
                          serverId={server.id}
                          sessionId={pane.sessionId}
                          active={
                            visible &&
                            !workspace.fileManagerOpen &&
                            workspace.activePaneId === pane.id
                          }
                        />
                      )}
                      {pane.kind === "favorites" && (
                        <FavoritesPanel
                          serverId={server.id}
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

        {workspace.fileManagerOpen && (
          <div className="file-manager-layer">
            <div className="file-manager-layer-bar">
              <strong>파일 관리자</strong>
              <span className="muted">터미널 세션은 백그라운드에서 유지됩니다</span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (!visible) return;
                  patchWorkspace(server.id, (current) => ({
                    ...current,
                    fileManagerOpen: false,
                  }));
                }}
              >
                숨김 (터미널로)
              </button>
            </div>
            <div className="file-manager-layer-body">
              <FilesPane serverId={server.id} />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Workspace</h1>
          <div className="sidebar-header-actions">
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
              <p className="sub">암호/개인키는 접속 시 한 번만 입력받아 메모리에 보관하고, Infisical은 선택적으로 사용할 수 있습니다.</p>
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
              <div className="toolbar-menu">
                <button
                  className={`btn${fileManagerOpen || showApprovalTool || toolMenuOpen ? " primary" : ""}`}
                  type="button"
                  aria-expanded={toolMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setToolMenuOpen((open) => !open)}
                >
                  Tool ▾
                </button>
                {toolMenuOpen && (
                  <>
                    <button
                      type="button"
                      className="toolbar-menu-backdrop"
                      aria-label="메뉴 닫기"
                      onClick={() => setToolMenuOpen(false)}
                    />
                    <div className="toolbar-menu-dropdown" role="menu">
                      <button
                        type="button"
                        className="toolbar-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setToolMenuOpen(false);
                          toggleFileManager();
                        }}
                      >
                        {fileManagerOpen ? "파일 관리자 숨김" : "파일 관리자"}
                      </button>
                      <button
                        type="button"
                        className="toolbar-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setToolMenuOpen(false);
                          setShowApprovalTool(true);
                        }}
                      >
                        결재Tool
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                className={`btn${logCollectOpen || logCollecting ? " primary" : ""}`}
                type="button"
                onClick={() =>
                  patchSelected((current) => ({ ...current, logCollectOpen: true }))
                }
              >
                로그수집{logCollecting ? " ●" : ""}
              </button>
              <button
                className={`btn${showSqlBind ? " primary" : ""}`}
                type="button"
                onClick={() => setShowSqlBind(true)}
              >
                SQL Bind
              </button>
              <button className="btn" type="button" onClick={addFavoritesPane}>
                즐겨찾기
              </button>
              <button className="btn danger" type="button" onClick={() => void deleteSelectedServer()}>
                서버 삭제
              </button>
            </div>
            <div className="main-body">
              {Object.entries(workspaces).map(([serverId, workspace]) => {
                const server = servers.find((s) => s.id === serverId);
                if (!server) return null;
                return renderServerWorkspace(server, workspace, serverId === selectedId);
              })}
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

      {showSqlBind && <SqlBindPanel onClose={() => setShowSqlBind(false)} />}

      {showApprovalTool && selected && (
        <ApprovalToolPanel
          server={selected}
          onClose={() => setShowApprovalTool(false)}
        />
      )}

      {secretPrompt && (
        <SecretPromptModal
          label={secretPrompt.label}
          onSubmit={(value) => {
            secretPrompt.resolve(value);
            setSecretPrompt(null);
          }}
          onCancel={() => {
            secretPrompt.reject(new Error("cancel"));
            setSecretPrompt(null);
          }}
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
          onClose={() =>
            patchSelected((current) => ({ ...current, logCollectOpen: false }))
          }
          onSavePaths={saveLogPaths}
          onStart={startLogCollect}
          onStop={stopLogCollect}
          onDownload={downloadCollectedLogs}
          pendingDownload={pendingDownload}
          onClearPendingDownload={() =>
            patchSelected((current) => ({ ...current, pendingDownload: null }))
          }
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
