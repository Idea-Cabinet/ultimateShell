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
      fontSize: 13.5,
      lineHeight: 1.25,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
      theme: {
        background: "#121214",
        foreground: "#f5f5f7",
        cursor: "#0A84FF",
        cursorAccent: "#121214",
        selectionBackground: "rgba(10, 132, 255, 0.3)",
        black: "#1e1e24",
        red: "#ff453a",
        green: "#32d74b",
        yellow: "#ffd60a",
        blue: "#0a84ff",
        magenta: "#bf5af2",
        cyan: "#5ac8fa",
        white: "#f5f5f7",
        brightBlack: "#636366",
        brightRed: "#ff6961",
        brightGreen: "#30d158",
        brightYellow: "#ffd60a",
        brightBlue: "#409cff",
        brightMagenta: "#da8fff",
        brightCyan: "#70d7ff",
        brightWhite: "#ffffff",
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

    const onDataDisposable = term.onData((data) => {
      invoke("pty_write", { sessionId: session.id, data }).catch(console.error);
    });

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
      className={`w-full h-full p-2 bg-[#121214] ${isActive ? "block" : "hidden"}`}
      style={{ outline: "none" }}
    />
  );
};
