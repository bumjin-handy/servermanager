import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "../api";
import type { SshClosedEvent, SshOutputEvent } from "../types";

interface Props {
  serverId: string;
  sessionId: string;
  active: boolean;
  onStatus?: (status: "connecting" | "ready" | "closed" | "error", detail?: string) => void;
}

export function TerminalPane({ serverId, sessionId, active, onStatus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [banner, setBanner] = useState<string | null>("연결 중…");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#3db9e8",
        selectionBackground: "rgba(61,185,232,0.35)",
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    let unlistenOutput: UnlistenFn | undefined;
    let unlistenClosed: UnlistenFn | undefined;
    let disposed = false;

    const start = async () => {
      onStatus?.("connecting");
      setBanner("연결 중…");
      setError(false);
      try {
        const cols = term.cols;
        const rows = term.rows;
        await api.sshOpen(serverId, sessionId, cols, rows);
        if (disposed) return;
        setBanner(null);
        onStatus?.("ready");
        term.focus();
      } catch (e) {
        if (disposed) return;
        const msg = String(e);
        setBanner(msg);
        setError(true);
        onStatus?.("error", msg);
      }
    };

    const onData = term.onData((data) => {
      void api.sshWrite(sessionId, data).catch(() => undefined);
    });

    void (async () => {
      unlistenOutput = await listen<SshOutputEvent>("ssh-output", (event) => {
        if (event.payload.sessionId !== sessionId) return;
        term.write(event.payload.data);
      });
      unlistenClosed = await listen<SshClosedEvent>("ssh-closed", (event) => {
        if (event.payload.sessionId !== sessionId) return;
        setBanner(`연결 종료: ${event.payload.reason}`);
        setError(event.payload.reason !== "closed");
        onStatus?.("closed", event.payload.reason);
      });
      await start();
    })();

    const ro = new ResizeObserver(() => {
      fit.fit();
      void api.sshResize(sessionId, term.cols, term.rows).catch(() => undefined);
    });
    ro.observe(hostRef.current);

    return () => {
      disposed = true;
      onData.dispose();
      ro.disconnect();
      void unlistenOutput?.();
      void unlistenClosed?.();
      void api.sshClose(sessionId).catch(() => undefined);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [serverId, sessionId, onStatus]);

  useEffect(() => {
    if (active) {
      fitRef.current?.fit();
      termRef.current?.focus();
    }
  }, [active]);

  return (
    <div className="pane-body">
      <div className="terminal-host" ref={hostRef} />
      {banner && (
        <div className={`status-banner${error ? " error" : ""}`}>{banner}</div>
      )}
    </div>
  );
}

export function writeToSession(sessionId: string, text: string, sendEnter = false) {
  const payload = sendEnter ? `${text}\n` : text;
  return api.sshWrite(sessionId, payload);
}

/** Send Ctrl+C (SIGINT) to the remote PTY. */
export function sendCtrlC(sessionId: string) {
  return api.sshWrite(sessionId, "\x03");
}
