import React, { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TabSession } from "../types";

interface Props {
  session: TabSession;
  isActive: boolean;
}

export const TerminalView: React.FC<Props> = ({ session, isActive }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 14,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "#1f6feb44",
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fitAddon.fit();

    terminalInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    // Send user keystrokes to Rust PTY
    const onDataDisposable = term.onData((data) => {
      invoke("pty_write", { sessionId: session.id, data }).catch(console.error);
    });

    // Listen to PTY output from Rust
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    listen<string>(`pty-data-${session.id}`, (event) => {
      term.write(event.payload);
    }).then((unlisten) => {
      unlistenData = unlisten;
    });

    listen(`pty-exit-${session.id}`, () => {
      term.write("\r\n\x1b[90m[会话已结束]\x1b[0m\r\n");
    }).then((unlisten) => {
      unlistenExit = unlisten;
    });

    // Spawn the PTY session
    const cols = term.cols || 80;
    const rows = term.rows || 24;

    invoke("pty_spawn", {
      opts: {
        session_id: session.id,
        is_local: session.isLocal,
        host: session.hostProfile?.host,
        port: session.hostProfile?.port,
        username: session.hostProfile?.username,
        identity_file: session.hostProfile?.identity_file,
        cols,
        rows,
      },
    }).catch((err) => {
      term.write(`\r\n\x1b[31m连接失败: ${err}\x1b[0m\r\n`);
    });

    // Handle resize
    const handleResize = () => {
      if (!fitAddonRef.current || !terminalInstanceRef.current) return;
      try {
        fitAddonRef.current.fit();
        const newCols = terminalInstanceRef.current.cols;
        const newRows = terminalInstanceRef.current.rows;
        invoke("pty_resize", {
          sessionId: session.id,
          cols: newCols,
          rows: newRows,
        }).catch(() => {});
      } catch (_) {}
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      onDataDisposable.dispose();
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      invoke("pty_close", { sessionId: session.id }).catch(() => {});
      term.dispose();
    };
  }, [session.id]);

  useEffect(() => {
    if (isActive && fitAddonRef.current && terminalInstanceRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          terminalInstanceRef.current?.focus();
        } catch (_) {}
      }, 50);
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full p-2 bg-[#0d1117] ${isActive ? "block" : "hidden"}`}
      style={{ outline: "none" }}
    />
  );
};
