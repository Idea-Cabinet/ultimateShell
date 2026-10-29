import React, { useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TabSession } from "../types";
import { ResolvedTheme } from "../hooks/useTheme";
import { AppSettings } from "../hooks/useAppSettings";
import { useTransferManager } from "../context/TransferContext";
import {
  Search,
  ChevronUp,
  ChevronDown,
  X,
  Upload,
} from "lucide-react";

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
  settings?: AppSettings;
  onBroadcastData?: (data: string) => void;
}

export const TerminalView: React.FC<Props> = ({
  session,
  isActive,
  resolvedTheme,
  settings,
  onBroadcastData,
}) => {
  const transferManager = useTransferManager();

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const onBroadcastDataRef = useRef(onBroadcastData);

  // Drag and Drop Files handling: Directly upload to terminal cwd (FinalShell style, no prompt)
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const recentDropRef = useRef(0);

  const resolveTargetCwd = useCallback(async (): Promise<string> => {
    try {
      const cwd = await invoke<string>("fs_get_terminal_cwd", { sessionId: session.id });
      if (cwd && cwd.trim() && cwd.trim() !== "/") {
        return cwd.trim();
      }
    } catch {
      // ignore
    }
    return session.isLocal ? "~" : "/root";
  }, [session.id, session.isLocal]);

  const handleTriggerDrop = useCallback(async (rawPaths: string[]) => {
    if (!rawPaths || rawPaths.length === 0) return;
    const now = Date.now();
    if (now - recentDropRef.current < 600) return;
    recentDropRef.current = now;

    const targetCwd = await resolveTargetCwd();
    for (const localPath of rawPaths) {
      transferManager.startUpload(
        session.id,
        session.title || (session.isLocal ? "本地终端" : "远程服务器"),
        localPath,
        targetCwd
      );
    }
  }, [resolveTargetCwd, session.id, session.title, session.isLocal, transferManager]);

  // HTML5 Drag Events for visual feedback
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setIsDragOver(false);
      dragCounterRef.current = 0;
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    const extractedPaths: string[] = [];
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const p = (file as any).path;
        if (p) {
          extractedPaths.push(p);
        }
      }
    }
    if (extractedPaths.length > 0) {
      handleTriggerDrop(extractedPaths);
    }
  };

  // Tauri native drag-drop listener for macOS WebKit
  useEffect(() => {
    if (!isActive) return;
    let unlisten: (() => void) | null = null;
    listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      const paths = event.payload?.paths;
      if (paths && paths.length > 0) {
        handleTriggerDrop(paths);
      }
    }).then((un) => {
      unlisten = un;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [isActive, handleTriggerDrop]);

  useEffect(() => {
    onBroadcastDataRef.current = onBroadcastData;
  }, [onBroadcastData]);

  // Terminal Content Search States (Requirement: 终端内容搜索、匹配高亮、上下条定位)
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [searchResult, setSearchResult] = useState<{ index: number; count: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      scrollback: settings?.scrollback ?? 5000,
      cursorBlink: settings?.cursorBlink ?? false,
      cursorStyle: settings?.cursorStyle ?? "block",
      cursorInactiveStyle: "outline",
      fontSize: settings?.fontSize ?? 13.5,
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

    // Enable hardware-accelerated WebGL rendering for 60/120fps smooth log streaming
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch (e) {
      console.warn("[TerminalView] WebGL GPU 加速未能加载，回退至 DOM 渲染:", e);
    }

    // Optimize xterm helper textarea for English terminal interaction
    if (term.textarea) {
      term.textarea.setAttribute("autocapitalize", "off");
      term.textarea.setAttribute("autocomplete", "off");
      term.textarea.setAttribute("autocorrect", "off");
      term.textarea.setAttribute("spellcheck", "false");
      term.textarea.setAttribute("lang", "en");
    }

    if (isActive) {
      term.focus();
    }

    terminalInstanceRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // High-performance display buffer aligned with display refresh rate
    let pendingChunks: string[] = [];
    let pendingBytes = 0;
    let rafId: number | null = null;

    const flushBuffer = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (disposed || pendingChunks.length === 0) return;

      const data = pendingChunks.join("");
      pendingChunks = [];
      pendingBytes = 0;

      term.write(data);
    };

    const onDataDisposable = term.onData((data) => {
      invoke("pty_write", { sessionId: session.id, data }).catch(console.error);
      if (onBroadcastDataRef.current) {
        onBroadcastDataRef.current(data);
      }
      // If user typed something (e.g. Ctrl+C or Enter), flush pending output immediately
      if (pendingChunks.length > 0) {
        flushBuffer();
      }
    });

    let disposed = false;
    let spawned = false;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    const startSession = async () => {
      try {
        const offData = await listen<string>(`pty-data-${session.id}`, (event) => {
          if (disposed) return;
          pendingChunks.push(event.payload);
          pendingBytes += event.payload.length;

          // Flood protection: if accumulated pending chunks exceed 1MB, keep latest 256KB with O(1) buffer tracking
          if (pendingBytes > 1024 * 1024) {
            let kept: string[] = [];
            let keptBytes = 0;
            for (let i = pendingChunks.length - 1; i >= 0; i--) {
              kept.unshift(pendingChunks[i]);
              keptBytes += pendingChunks[i].length;
              if (keptBytes >= 256 * 1024) break;
            }
            pendingChunks = kept;
            pendingBytes = keptBytes;
          }

          if (rafId === null) {
            rafId = requestAnimationFrame(flushBuffer);
          }
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
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingChunks = [];
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      onDataDisposable.dispose();
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      if (spawned) invoke("pty_close", { sessionId: session.id }).catch(() => {});
      term.clear();
      searchAddon.dispose();
      fitAddon.dispose();
      term.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [session.id]);

  // Update theme dynamically
  useEffect(() => {
    if (!terminalInstanceRef.current) return;
    const theme = resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME;
    terminalInstanceRef.current.options.theme = theme;
  }, [resolvedTheme]);

  // Update terminal settings dynamically
  useEffect(() => {
    if (!terminalInstanceRef.current || !settings) return;
    terminalInstanceRef.current.options.fontSize = settings.fontSize;
    terminalInstanceRef.current.options.cursorStyle = settings.cursorStyle;
    terminalInstanceRef.current.options.cursorBlink = settings.cursorBlink;
    terminalInstanceRef.current.options.scrollback = settings.scrollback;
    try {
      fitAddonRef.current?.fit();
    } catch (_) {}
  }, [settings?.fontSize, settings?.cursorStyle, settings?.cursorBlink, settings?.scrollback]);

  useEffect(() => {
    if (isActive && fitAddonRef.current && terminalInstanceRef.current) {
      const raf = requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
          terminalInstanceRef.current?.focus();
        } catch (_) {}
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [isActive]);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative w-full h-full ${isActive ? "block" : "hidden"}`}
    >
      {/* Drag & Drop File Upload Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-40 bg-[#007AFF]/12 backdrop-blur-[2px] border-2 border-dashed border-[#007AFF] rounded-lg m-2 flex flex-col items-center justify-center space-y-2 pointer-events-none animate-in fade-in duration-100 select-none">
          <div className="w-12 h-12 rounded-2xl bg-[#007AFF] text-white flex items-center justify-center shadow-lg animate-bounce">
            <Upload className="w-6 h-6" />
          </div>
          <div className="text-[14px] font-semibold text-[#007AFF]">
            松开鼠标立即上传至终端工作目录
          </div>
        </div>
      )}

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
          terminalInstanceRef.current?.focus();
        }}
        onFocus={() => {
          terminalInstanceRef.current?.focus();
        }}
        className="w-full h-full bg-[var(--bg-terminal)] border-none outline-none cursor-text"
        style={{ outline: "none", border: "none" }}
      />
    </div>
  );
};
