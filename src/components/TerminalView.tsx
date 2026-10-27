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
  cursor: "#f5f5f7",
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
  cursor: "#1c1c1e",
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
  const hasSwitchedInputRef = useRef(false);

  // Switch macOS input method to English/ASCII on first cursor focus
  const switchToAscii = () => {
    if (!hasSwitchedInputRef.current) {
      hasSwitchedInputRef.current = true;
      invoke("switch_to_ascii_input").catch(() => {});
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const currentTheme = resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME;

    const term = new Terminal({
      cursorBlink: false,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      fontSize: 13.5,
      lineHeight: 1.25,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
      theme: currentTheme,
      convertEol: true,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fitAddon.fit();

    // Optimize xterm helper textarea for English terminal interaction
    if (term.textarea) {
      term.textarea.setAttribute("autocapitalize", "off");
      term.textarea.setAttribute("autocomplete", "off");
      term.textarea.setAttribute("autocorrect", "off");
      term.textarea.setAttribute("spellcheck", "false");
      term.textarea.setAttribute("lang", "en");
      term.textarea.addEventListener("focus", switchToAscii, { once: true });
    }

    if (isActive) {
      term.focus();
      switchToAscii();
    }

    terminalInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    const onDataDisposable = term.onData((data) => {
      invoke("pty_write", { sessionId: session.id, data }).catch(console.error);
    });

    let disposed = false;
    let spawned = false;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    const startSession = async () => {
      try {
        const offData = await listen<string>(`pty-data-${session.id}`, (event) => {
          if (!disposed) term.write(event.payload);
        });
        if (disposed) { offData(); return; }
        unlistenData = offData;
        const offExit = await listen(`pty-exit-${session.id}`, () => {
          if (!disposed) term.write("\r\n\x1b[90m[会话已结束]\x1b[0m\r\n");
        });
        if (disposed) { offExit(); return; }
        unlistenExit = offExit;

        const cols = term.cols || 80;
        const rows = term.rows || 24;

        await invoke("pty_spawn", {
          opts: {
            session_id: session.id,
            is_local: session.isLocal,
            host_id: session.hostProfile?.id,
            host_name: session.hostProfile?.name || session.title,
            host: session.hostProfile?.host,
            port: session.hostProfile?.port,
            username: session.hostProfile?.username,
            identity_file: session.hostProfile?.identity_file,
            cols,
            rows,
          },
        });
        spawned = true;
        if (disposed) await invoke("pty_close", { sessionId: session.id });
      } catch (err) {
        if (!disposed) term.write(`\r\n\x1b[31m连接失败: ${err}\x1b[0m\r\n`);
      }
    };
    void startSession();

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

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current?.getClientRects().length) handleResize();
    });
    resizeObserver.observe(containerRef.current);
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      onDataDisposable.dispose();
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      if (spawned) invoke("pty_close", { sessionId: session.id }).catch(() => {});
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
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
      switchToAscii();
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          terminalInstanceRef.current?.focus();
        } catch (_) {}
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onClick={() => {
        switchToAscii();
        terminalInstanceRef.current?.focus();
      }}
      onFocus={() => {
        switchToAscii();
        terminalInstanceRef.current?.focus();
      }}
      className={`w-full h-full bg-[var(--bg-terminal)] border-none outline-none cursor-text ${isActive ? "block" : "hidden"}`}
      style={{ outline: "none", border: "none" }}
    />
  );
};
