import React, { useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TabSession } from "../types";
import { ResolvedTheme } from "../hooks/useTheme";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";

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
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const hasSwitchedInputRef = useRef(false);

  // Terminal Content Search States (Requirement: 终端内容搜索、匹配高亮、上下条定位)
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [searchResult, setSearchResult] = useState<{ index: number; count: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Switch macOS input method to English/ASCII on first cursor focus
  const switchToAscii = () => {
    if (!hasSwitchedInputRef.current) {
      hasSwitchedInputRef.current = true;
      invoke("switch_to_ascii_input").catch(() => {});
    }
  };

  const getSearchOptions = useCallback(() => ({
    caseSensitive,
    wholeWord,
    regex: useRegex,
    incremental: true,
    decorations: {
      matchBackground: "rgba(255, 214, 10, 0.35)",
      matchBorder: "rgba(255, 214, 10, 0.7)",
      matchOverviewRuler: "#ffd60a",
      activeMatchBackground: "#ff9f0a",
      activeMatchBorder: "#ffffff",
      activeMatchColorOverviewRuler: "#ff9f0a",
    },
  }), [caseSensitive, wholeWord, useRegex]);

  const executeSearch = useCallback((term: string, forward = true) => {
    if (!searchAddonRef.current || !term.trim()) {
      searchAddonRef.current?.clearDecorations();
      setSearchResult(null);
      return;
    }
    const opts = getSearchOptions();
    if (forward) {
      searchAddonRef.current.findNext(term, opts);
    } else {
      searchAddonRef.current.findPrevious(term, opts);
    }
  }, [getSearchOptions]);

  const handleNextMatch = () => executeSearch(searchTerm, true);
  const handlePrevMatch = () => executeSearch(searchTerm, false);

  const handleCloseSearch = () => {
    setIsSearchOpen(false);
    searchAddonRef.current?.clearDecorations();
    setSearchResult(null);
    terminalInstanceRef.current?.focus();
  };

  // Keyboard shortcut listener for Cmd+F / Ctrl+F
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.select(), 40);
      } else if (e.key === "Escape" && isSearchOpen) {
        e.preventDefault();
        handleCloseSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, isSearchOpen]);

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
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(new WebLinksAddon());

    searchAddon.onDidChangeResults((e) => {
      setSearchResult(e ? { index: e.resultIndex, count: e.resultCount } : null);
    });

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
    searchAddonRef.current = searchAddon;

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
          if (!disposed) term.write("\r\n\x1b[90m[会话已结束 - 可在标签右键点击「重新连接」或双击主机快速恢复]\x1b[0m\r\n");
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
    <div className={`relative w-full h-full ${isActive ? "block" : "hidden"}`}>
      {/* Floating Terminal Output Search Bar (Cmd+F / Ctrl+F) */}
      {isSearchOpen ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-3 right-5 z-40 apple-vibrancy-popover bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl shadow-2xl p-1.5 flex items-center space-x-1.5 text-[12px] text-[var(--text-primary)] animate-in fade-in zoom-in-95 duration-100"
        >
          <Search className="w-3.5 h-3.5 text-[var(--text-tertiary)] ml-1 flex-shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              executeSearch(e.target.value, true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (e.shiftKey) handlePrevMatch();
                else handleNextMatch();
              }
            }}
            placeholder="搜索终端内容 (回车下一处)..."
            className="w-48 bg-transparent text-[12px] font-mono outline-none placeholder-[var(--text-tertiary)] text-[var(--text-primary)]"
          />

          {/* Match counter badge */}
          {searchTerm && (
            <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-[var(--hover-item)] text-[var(--text-tertiary)] flex-shrink-0 select-none">
              {searchResult
                ? searchResult.count === 0
                  ? "无匹配"
                  : `${searchResult.index + 1}/${searchResult.count}`
                : "..."}
            </span>
          )}

          {/* Up / Down Navigation */}
          <div className="flex items-center space-x-0.5 border-l border-[var(--border-subtle)] pl-1">
            <button
              onClick={handlePrevMatch}
              title="上一处匹配 (Shift+Enter / ↑)"
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition active:scale-95"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleNextMatch}
              title="下一处匹配 (Enter / ↓)"
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition active:scale-95"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Toggles: Case, Whole Word, Regex */}
          <div className="flex items-center space-x-0.5 border-l border-[var(--border-subtle)] pl-1 text-[10.5px] font-mono">
            <button
              onClick={() => {
                const next = !caseSensitive;
                setCaseSensitive(next);
                setTimeout(() => executeSearch(searchTerm, true), 10);
              }}
              title="区分大小写 (Aa)"
              className={`px-1.5 py-0.5 rounded transition ${
                caseSensitive
                  ? "bg-[#007AFF] text-white font-bold"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--hover-item)] hover:text-[var(--text-primary)]"
              }`}
            >
              Aa
            </button>
            <button
              onClick={() => {
                const next = !wholeWord;
                setWholeWord(next);
                setTimeout(() => executeSearch(searchTerm, true), 10);
              }}
              title="全字匹配 (\b)"
              className={`px-1.5 py-0.5 rounded transition ${
                wholeWord
                  ? "bg-[#007AFF] text-white font-bold"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--hover-item)] hover:text-[var(--text-primary)]"
              }`}
            >
              \b
            </button>
            <button
              onClick={() => {
                const next = !useRegex;
                setUseRegex(next);
                setTimeout(() => executeSearch(searchTerm, true), 10);
              }}
              title="正则表达式 (.*)"
              className={`px-1.5 py-0.5 rounded transition ${
                useRegex
                  ? "bg-[#007AFF] text-white font-bold"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--hover-item)] hover:text-[var(--text-primary)]"
              }`}
            >
              .*
            </button>
          </div>

          {/* Close */}
          <button
            onClick={handleCloseSearch}
            title="关闭搜索 (Esc)"
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition active:scale-95 ml-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* Floating Search Trigger Button */
        <button
          onClick={() => {
            setIsSearchOpen(true);
            setTimeout(() => searchInputRef.current?.focus(), 40);
          }}
          className="absolute top-2.5 right-4 z-20 p-1.5 rounded-lg bg-[var(--bg-card)]/75 hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shadow-sm backdrop-blur transition active:scale-95"
          title="在终端中搜索输出内容 (Cmd+F / Ctrl+F)"
        >
          <Search className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Terminal Canvas */}
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
        className="w-full h-full bg-[var(--bg-terminal)] border-none outline-none cursor-text"
        style={{ outline: "none", border: "none" }}
      />
    </div>
  );
};
