import React, { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TabSession } from "../types";
import { ResolvedTheme } from "../hooks/useTheme";

const DARK_THEME = {
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
};

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1c1c1e",
  cursor: "#007AFF",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(0, 122, 255, 0.25)",
  black: "#24292f",
  red: "#cf222e",
  green: "#1a7f37",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#116329",
  brightYellow: "#4d2d00",
  brightBlue: "#0550ae",
  brightMagenta: "#5a32a3",
  brightCyan: "#114e53",
  brightWhite: "#24292f",
};

interface Props {
  session: TabSession;
  isActive: boolean;
  resolvedTheme: ResolvedTheme;
}

export const TerminalView: React.FC<Props> = ({ session, isActive, resolvedTheme }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const currentTheme = resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13.5,
      lineHeight: 1.25,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
      theme: currentTheme,
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

  // Update theme dynamically
  useEffect(() => {
    if (!terminalInstanceRef.current) return;
    const theme = resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME;
    terminalInstanceRef.current.options.theme = theme;
  }, [resolvedTheme]);

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
      className={`w-full h-full p-2 bg-[var(--bg-terminal)] border-none outline-none ${isActive ? "block" : "hidden"}`}
      style={{ outline: "none", border: "none" }}
    />
  );
};
