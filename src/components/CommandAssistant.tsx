import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Terminal,
  Clock,
  BookOpen,
  Send,
  Sparkles,
  X,
  Play,
  ChevronDown,
  Search,
  Trash2,
  Copy,
  Check,
} from "lucide-react";
import { TabSession } from "../types";
import { useI18n } from "../i18n";

export interface ParametricCommand {
  id: string;
  category_zh: string;
  category_en: string;
  name_zh: string;
  name_en: string;
  template: string;
  desc_zh: string;
  desc_en: string;
}

const DEFAULT_TEMPLATES: ParametricCommand[] = [
  {
    id: "docker-logs",
    category_zh: "Docker 容器",
    category_en: "Docker",
    name_zh: "容器实时日志",
    name_en: "Container Live Logs",
    template: "docker logs -f --tail {lines:100} {container:app}",
    desc_zh: "持续跟踪查看容器最新输出日志",
    desc_en: "Follow and stream recent container logs",
  },
  {
    id: "docker-exec",
    category_zh: "Docker 容器",
    category_en: "Docker",
    name_zh: "进入容器终端",
    name_en: "Enter Container Shell",
    template: "docker exec -it {container:app} /bin/sh",
    desc_zh: "在运行中的容器内启动交互式终端",
    desc_en: "Open an interactive shell inside a running container",
  },
  {
    id: "docker-restart",
    category_zh: "Docker 容器",
    category_en: "Docker",
    name_zh: "重启指定容器",
    name_en: "Restart Container",
    template: "docker restart {container:app}",
    desc_zh: "重新启动服务容器实例",
    desc_en: "Restart a running container instance",
  },
  {
    id: "find-file",
    category_zh: "文件检索",
    category_en: "Files & Search",
    name_zh: "文件名深度查找",
    name_en: "Find Files by Name",
    template: 'find {path:/} -name "{pattern:*.log}" 2>/dev/null',
    desc_zh: "在指定目录树下递归查找匹配文件",
    desc_en: "Recursively find files matching pattern under path",
  },
  {
    id: "grep-text",
    category_zh: "文件检索",
    category_en: "Files & Search",
    name_zh: "全文关键词搜索",
    name_en: "Grep Text in Files",
    template: 'grep -rn "{keyword:error}" {path:./} --color=auto',
    desc_zh: "递归搜索包含特定字符串的文件与行号",
    desc_en: "Search recursively for keyword with line numbers",
  },
  {
    id: "tar-pack",
    category_zh: "压缩解压",
    category_en: "Archive & Zip",
    name_zh: "打包压缩目录",
    name_en: "Compress Tar Archive",
    template: "tar -czvf {archive:backup.tar.gz} {target:./data}",
    desc_zh: "使用 gzip 算法创建归档压缩包",
    desc_en: "Create gzip-compressed tar archive from target",
  },
  {
    id: "tar-unpack",
    category_zh: "压缩解压",
    category_en: "Archive & Zip",
    name_zh: "解压 tar.gz 压缩包",
    name_en: "Extract Tar Archive",
    template: "tar -xzvf {archive:backup.tar.gz} -C {dest:./}",
    desc_zh: "解压缩归档文件至目标目录",
    desc_en: "Extract tar.gz archive to destination directory",
  },
  {
    id: "net-port",
    category_zh: "网络端口",
    category_en: "Networking",
    name_zh: "端口占用过滤",
    name_en: "Check Port Listeners",
    template: "ss -tulnp | grep {port:8080}",
    desc_zh: "查询指定端口由哪个服务监听",
    desc_en: "Check which process is listening on the given port",
  },
  {
    id: "curl-inspect",
    category_zh: "网络诊断",
    category_en: "Networking",
    name_zh: "HTTP 响应头检测",
    name_en: "Inspect HTTP Headers",
    template: "curl -IL {url:https://google.com} --connect-timeout 5",
    desc_zh: "检查网站 HTTP 重定向及响应头状态",
    desc_en: "Inspect HTTP response headers and redirects",
  },
  {
    id: "service-log",
    category_zh: "系统运维",
    category_en: "System Ops",
    name_zh: "Systemd 服务日志",
    name_en: "Systemd Service Logs",
    template: "journalctl -u {service:nginx} -n {lines:50} -f",
    desc_zh: "追踪系统守护服务日志输出",
    desc_en: "Stream systemd unit journal logs in real-time",
  },
  {
    id: "dir-size",
    category_zh: "系统运维",
    category_en: "System Ops",
    name_zh: "目录大小排行",
    name_en: "Top Directory Sizes",
    template: "du -sh {path:./}* | sort -hr | head -n {count:10}",
    desc_zh: "统计当前目录下占用最大的文件夹",
    desc_en: "List largest directories sorted by disk usage",
  },
];

interface Props {
  session?: TabSession;
  isOpen?: boolean;
  onClose: () => void;
  onSendToTerminal: (cmd: string) => void;
}

export const CommandAssistant: React.FC<Props> = ({ session: _session, isOpen = true, onClose, onSendToTerminal }) => {
  const { t, lang } = useI18n();
  const isZh = lang === "zh-CN";

  const getTemplateName = (item: ParametricCommand) => (isZh ? item.name_zh : item.name_en);
  const getTemplateCategory = (item: ParametricCommand) => (isZh ? item.category_zh : item.category_en);
  const getTemplateDesc = (item: ParametricCommand) => (isZh ? item.desc_zh : item.desc_en);

  const [inputCmd, setInputCmd] = useState("");
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("ultimateshell_cmd_history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [historyPopupPos, setHistoryPopupPos] = useState<{
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  }>({});

  const historyBtnRef = useRef<HTMLButtonElement>(null);
  const historyDropdownRef = useRef<HTMLDivElement>(null);

  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [modalFilter, setModalFilter] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");

  // Parameter Fill Modal State
  const [activeParamCmd, setActiveParamCmd] = useState<ParametricCommand | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const inputRef = useRef<HTMLInputElement>(null);

  const updateHistoryPosition = () => {
    if (!historyBtnRef.current) return;
    const rect = historyBtnRef.current.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;

    if (spaceAbove >= 240 || spaceAbove >= spaceBelow) {
      setHistoryPopupPos({
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
        right: Math.max(12, window.innerWidth - rect.right),
      });
    } else {
      setHistoryPopupPos({
        top: Math.max(8, rect.bottom + 8),
        right: Math.max(12, window.innerWidth - rect.right),
      });
    }
  };

  const toggleHistoryDropdown = () => {
    if (!showHistoryDropdown) {
      updateHistoryPosition();
      setHistorySearch("");
      setShowHistoryDropdown(true);
    } else {
      setShowHistoryDropdown(false);
    }
  };

  // Close history on click outside, Esc key, and handle resize/scroll
  useEffect(() => {
    if (!showHistoryDropdown) return;
    updateHistoryPosition();

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        historyDropdownRef.current &&
        !historyDropdownRef.current.contains(target) &&
        historyBtnRef.current &&
        !historyBtnRef.current.contains(target)
      ) {
        setShowHistoryDropdown(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowHistoryDropdown(false);
      }
    };

    const handleResizeOrScroll = () => {
      updateHistoryPosition();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResizeOrScroll);
    window.addEventListener("scroll", handleResizeOrScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResizeOrScroll);
      window.removeEventListener("scroll", handleResizeOrScroll, true);
    };
  }, [showHistoryDropdown]);

  const filteredHistory = useMemo(() => {
    return history
      .map((cmd, originalIndex) => ({ cmd, originalIndex }))
      .filter(({ cmd }) =>
        !historySearch.trim() || cmd.toLowerCase().includes(historySearch.toLowerCase().trim())
      );
  }, [history, historySearch]);

  const handleDeleteHistoryItem = (indexToDelete: number) => {
    setHistory((prev) => {
      const updated = prev.filter((_, idx) => idx !== indexToDelete);
      localStorage.setItem("ultimateshell_cmd_history", JSON.stringify(updated));
      return updated;
    });
  };

  const handleCopyHistoryItem = (cmd: string, idx: number) => {
    navigator.clipboard.writeText(cmd);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Execute a command into the active terminal
  const executeCommand = (cmdText: string) => {
    const trimmed = cmdText.trim();
    if (!trimmed) return;

    // Save to history (deduplicate and keep last 60)
    setHistory((prev) => {
      const filtered = prev.filter((c) => c !== trimmed);
      const updated = [trimmed, ...filtered].slice(0, 60);
      localStorage.setItem("ultimateshell_cmd_history", JSON.stringify(updated));
      return updated;
    });

    onSendToTerminal(trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`);
    setInputCmd("");
    setHistoryIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeCommand(inputCmd);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIdx = historyIdx + 1;
      if (nextIdx < history.length) {
        setHistoryIdx(nextIdx);
        setInputCmd(history[nextIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = historyIdx - 1;
      if (nextIdx >= 0) {
        setHistoryIdx(nextIdx);
        setInputCmd(history[nextIdx]);
      } else if (nextIdx === -1) {
        setHistoryIdx(-1);
        setInputCmd("");
      }
    }
  };

  // Open parameter config modal for a command template
  const openParamDialog = (cmd: ParametricCommand) => {
    const params: Record<string, string> = {};
    const regex = /\{([^:}]+)(?::([^}]+))?\}/g;
    let match;
    while ((match = regex.exec(cmd.template)) !== null) {
      const paramName = match[1];
      const defaultVal = match[2] || "";
      params[paramName] = defaultVal;
    }
    setParamValues(params);
    setActiveParamCmd(cmd);
  };

  // Generate resolved command with replaced parameters
  const getResolvedCommand = () => {
    if (!activeParamCmd) return "";
    let resolved = activeParamCmd.template;
    for (const [key, val] of Object.entries(paramValues)) {
      const pattern = new RegExp(`\\{${key}(?::[^}]+)?\\}`, "g");
      resolved = resolved.replace(pattern, val || "");
    }
    return resolved;
  };

  const handleApplyParamCommand = () => {
    const finalCmd = getResolvedCommand();
    setActiveParamCmd(null);
    setShowTemplatesModal(false);
    setInputCmd(finalCmd);
    executeCommand(finalCmd);
  };

  // Smart template suggestions matching current input
  const suggestions = DEFAULT_TEMPLATES.filter((t) => {
    if (!inputCmd.trim()) return false;
    const q = inputCmd.toLowerCase();
    const name = getTemplateName(t).toLowerCase();
    const cat = getTemplateCategory(t).toLowerCase();
    return name.includes(q) || t.template.toLowerCase().includes(q) || cat.includes(q);
  }).slice(0, 4);

  // Filtered templates inside the library modal
  const categories = Array.from(new Set(DEFAULT_TEMPLATES.map((t) => getTemplateCategory(t))));

  const filteredModalTemplates = DEFAULT_TEMPLATES.filter((t) => {
    const catMatch = selectedCategory === "ALL" || getTemplateCategory(t) === selectedCategory;
    if (!catMatch) return false;
    if (!modalFilter.trim()) return true;
    const q = modalFilter.toLowerCase();
    return (
      getTemplateName(t).toLowerCase().includes(q) ||
      getTemplateDesc(t).toLowerCase().includes(q) ||
      t.template.toLowerCase().includes(q) ||
      getTemplateCategory(t).toLowerCase().includes(q)
    );
  });

  if (!isOpen) return null;

  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-1.5 flex flex-col space-y-1.5 relative z-30 select-none shadow-md">
      {/* Suggestions Row */}
      {suggestions.length > 0 && (
        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar py-0.5 text-[11px]">
          <span className="text-[10px] text-[var(--text-tertiary)] flex items-center space-x-1 flex-shrink-0">
            <Sparkles className="w-3 h-3 text-amber-500" />
            <span>{t("cmd.smartMatch")}</span>
          </span>
          {suggestions.map((item) => (
            <button
              key={item.id}
              onClick={() => openParamDialog(item)}
              className="px-2 py-0.5 rounded bg-[var(--hover-item)] hover:bg-[#007AFF]/15 hover:text-[#007AFF] text-[var(--text-secondary)] border border-[var(--border-subtle)] flex items-center space-x-1 flex-shrink-0 font-mono transition active:scale-95"
            >
              <span className="font-sans font-medium">{getTemplateName(item)}</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">·</span>
              <span className="text-[10.5px] truncate max-w-[140px]">{item.template}</span>
            </button>
          ))}
        </div>
      )}

      {/* Main Command Input Strip */}
      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-1.5 flex-1 bg-[var(--input-bg)] border border-[var(--border-subtle)] focus-within:border-[#007AFF] rounded-lg px-2.5 py-1 text-[12px] transition-all">
          <Terminal className="w-3.5 h-3.5 text-[#007AFF] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={inputCmd}
            onChange={(e) => {
              setInputCmd(e.target.value);
              setHistoryIdx(-1);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("cmd.inputPlaceholder")}
            className="flex-1 bg-transparent font-mono text-[12.5px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none"
          />

          {inputCmd && (
            <button
              onClick={() => setInputCmd("")}
              className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              title={t("cmd.clearInput")}
            >
              <X className="w-3 h-3" />
            </button>
          )}

          {/* History Button */}
          <button
            ref={historyBtnRef}
            type="button"
            onClick={toggleHistoryDropdown}
            className={`p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition flex items-center space-x-0.5 cursor-pointer ${
              showHistoryDropdown ? "bg-[var(--hover-item)] text-[#007AFF]" : ""
            }`}
            title={t("cmd.historyTip")}
          >
            <Clock className="w-3.5 h-3.5" />
            <ChevronDown
              className={`w-2.5 h-2.5 transition-transform duration-150 ${
                showHistoryDropdown ? "rotate-180" : ""
              }`}
            />
          </button>
        </div>

        {/* Templates Library Button */}
        <button
          onClick={() => {
            setShowTemplatesModal(true);
            setModalFilter("");
            setSelectedCategory("ALL");
          }}
          className="px-2.5 py-1.5 rounded-lg bg-[var(--hover-item)] hover:bg-[#007AFF]/15 hover:text-[#007AFF] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-[11.5px] font-medium flex items-center space-x-1.5 transition active:scale-95 flex-shrink-0"
          title={t("cmd.library")}
        >
          <BookOpen className="w-3.5 h-3.5 text-amber-500" />
          <span>{t("cmd.library")}</span>
        </button>

        {/* Send Button */}
        <button
          onClick={() => executeCommand(inputCmd)}
          disabled={!inputCmd.trim()}
          className="px-3 py-1.5 rounded-lg bg-[#007AFF] hover:bg-[#0A84FF] disabled:opacity-40 text-white text-[11.5px] font-medium flex items-center space-x-1.5 shadow-sm transition active:scale-95 flex-shrink-0"
          title={t("cmd.send")}
        >
          <Send className="w-3 h-3" />
          <span>{t("cmd.send")}</span>
        </button>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition active:scale-95"
          title={t("common.close")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* History Dropdown Menu (Rendered to document.body to prevent height collapse & z-index clipping) */}
      {showHistoryDropdown &&
        createPortal(
          <div
            ref={historyDropdownRef}
            style={{
              position: "fixed",
              bottom: historyPopupPos.bottom,
              top: historyPopupPos.top,
              right: historyPopupPos.right,
              zIndex: 99999,
            }}
            className="w-80 sm:w-96 max-h-[380px] min-h-[140px] flex flex-col bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl shadow-2xl p-2 text-[11.5px] font-mono apple-vibrancy-popover animate-in fade-in zoom-in-95 duration-100 select-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-2 py-1.5 text-[11px] font-sans font-semibold text-[var(--text-tertiary)] flex justify-between items-center border-b border-[var(--border-subtle)]/60 flex-shrink-0">
              <div className="flex items-center space-x-1.5">
                <Clock className="w-3.5 h-3.5 text-[#007AFF]" />
                <span className="text-[var(--text-primary)] font-medium">
                  {t("cmd.historyTitle")}
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--hover-item)] text-[var(--text-secondary)] font-mono">
                  {history.length}
                </span>
              </div>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setHistory([]);
                    localStorage.removeItem("ultimateshell_cmd_history");
                    setShowHistoryDropdown(false);
                  }}
                  className="text-rose-500 hover:text-rose-600 hover:underline flex items-center space-x-1 text-[11px] transition cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t("cmd.historyClear")}</span>
                </button>
              )}
            </div>

            {/* Filter / Search input if history has items */}
            {history.length > 3 && (
              <div className="pt-2 px-1 pb-1 flex-shrink-0">
                <div className="relative flex items-center">
                  <Search className="w-3 h-3 text-[var(--text-tertiary)] absolute left-2 pointer-events-none" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="搜索历史命令..."
                    className="w-full pl-6 pr-2 py-1 bg-[var(--input-bg)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-md text-[11px] font-mono text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none"
                  />
                  {historySearch && (
                    <button
                      type="button"
                      onClick={() => setHistorySearch("")}
                      className="absolute right-1.5 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* History Items List */}
            <div className="flex-1 overflow-y-auto min-h-0 py-1 space-y-0.5 no-scrollbar">
              {filteredHistory.length === 0 ? (
                <div className="py-7 text-center text-[var(--text-tertiary)] font-sans flex flex-col items-center justify-center space-y-1">
                  <Clock className="w-6 h-6 opacity-30" />
                  <span>{historySearch ? "无匹配的历史命令" : t("cmd.historyEmpty")}</span>
                </div>
              ) : (
                filteredHistory.map(({ cmd, originalIndex }) => (
                  <div
                    key={originalIndex}
                    onClick={() => {
                      setInputCmd(cmd);
                      setShowHistoryDropdown(false);
                      inputRef.current?.focus();
                    }}
                    title="点击填充到输入框"
                    className="px-2 py-1.5 rounded-lg hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer flex items-center justify-between group transition-colors"
                  >
                    <span
                      className="truncate flex-1 font-mono text-[11px] pr-2 select-text"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {cmd}
                    </span>
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyHistoryItem(cmd, originalIndex);
                        }}
                        className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition cursor-pointer"
                        title="复制命令"
                      >
                        {copiedIdx === originalIndex ? (
                          <Check className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteHistoryItem(originalIndex);
                        }}
                        className="p-1 rounded text-[var(--text-tertiary)] hover:text-rose-500 hover:bg-[var(--bg-card)] transition cursor-pointer"
                        title="删除此条记录"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          executeCommand(cmd);
                          setShowHistoryDropdown(false);
                        }}
                        className="p-1 rounded bg-[#007AFF] text-white hover:bg-[#0062CC] transition flex items-center space-x-0.5 cursor-pointer"
                        title={t("cmd.runNow")}
                      >
                        <Play className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}

      {/* Templates Library Modal (Rendered to document.body to avoid being covered by sidebar) */}
      {showTemplatesModal &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 backdrop-blur-sm animate-in fade-in duration-100 select-none">
            <div className="apple-card rounded-2xl w-[680px] max-h-[540px] flex flex-col p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)]">
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
                <div className="flex items-center space-x-2">
                  <BookOpen className="w-4 h-4 text-amber-500" />
                  <h3 className="font-semibold text-[14px]">{t("cmd.library")}</h3>
                </div>
                <button
                  onClick={() => setShowTemplatesModal(false)}
                  className="p-1 rounded-full hover:bg-[var(--hover-item)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search & Categories Bar */}
              <div className="pt-3 pb-2 space-y-2">
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 text-[var(--text-tertiary)] absolute left-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={modalFilter}
                    onChange={(e) => setModalFilter(e.target.value)}
                    placeholder={t("cmd.searchTemplates")}
                    className="w-full pl-8 pr-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-lg text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none"
                  />
                  {modalFilter && (
                    <button
                      onClick={() => setModalFilter("")}
                      className="absolute right-2 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Category Pills */}
                <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar py-0.5 text-[11px]">
                  <button
                    onClick={() => setSelectedCategory("ALL")}
                    className={`px-2.5 py-0.5 rounded-full transition ${
                      selectedCategory === "ALL"
                        ? "bg-[#007AFF] text-white font-medium shadow-sm"
                        : "bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {t("cmd.allCategories")}
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-2.5 py-0.5 rounded-full transition ${
                        selectedCategory === cat
                          ? "bg-[#007AFF] text-white font-medium shadow-sm"
                          : "bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Template Items List */}
              <div className="flex-1 overflow-y-auto py-2 space-y-2 no-scrollbar">
                {filteredModalTemplates.length === 0 ? (
                  <div className="py-12 text-center text-[var(--text-tertiary)] text-[12px]">
                    {t("files.noMatch")}
                  </div>
                ) : (
                  filteredModalTemplates.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => openParamDialog(item)}
                      className="p-3 rounded-xl bg-[var(--hover-item)]/60 hover:bg-[var(--hover-item)] border border-[var(--border-subtle)] cursor-pointer transition flex items-center justify-between group"
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-[12.5px] text-[var(--text-primary)]">
                            {getTemplateName(item)}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#007AFF]/15 text-[#007AFF] font-medium">
                            {getTemplateCategory(item)}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-[var(--text-secondary)] mt-1 truncate">
                          {item.template}
                        </div>
                        <div className="text-[10.5px] text-[var(--text-tertiary)] mt-0.5">
                          {getTemplateDesc(item)}
                        </div>
                      </div>
                      <button className="px-2.5 py-1 rounded-lg bg-[#007AFF] text-white text-[11px] font-medium opacity-0 group-hover:opacity-100 transition active:scale-95 flex items-center space-x-1 flex-shrink-0">
                        <Sparkles className="w-3 h-3" />
                        <span>{t("cmd.fillParams")}</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Parameter Filling Modal (Rendered to document.body to avoid being covered by sidebar) */}
      {activeParamCmd &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 backdrop-blur-sm animate-in fade-in duration-100 select-none">
            <div className="apple-card rounded-2xl w-[480px] p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)]">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
                <div>
                  <h3 className="font-semibold text-[14px]">{getTemplateName(activeParamCmd)}</h3>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    {t("cmd.paramPrompt")}
                  </p>
                </div>
                <button
                  onClick={() => setActiveParamCmd(null)}
                  className="p-1 rounded-full hover:bg-[var(--hover-item)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="py-4 space-y-3">
                {Object.keys(paramValues).map((key) => (
                  <div key={key}>
                    <label className="block text-[11px] font-mono font-medium text-[var(--text-secondary)] mb-1">
                      {key}
                    </label>
                    <input
                      type="text"
                      value={paramValues[key]}
                      onChange={(e) =>
                        setParamValues((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-lg text-[12.5px] font-mono text-[var(--text-primary)] outline-none"
                    />
                  </div>
                ))}

                <div className="p-2.5 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] mt-2">
                  <div className="text-[10px] text-[var(--text-tertiary)] uppercase font-semibold mb-1">
                    {t("cmd.preview")}:
                  </div>
                  <div className="font-mono text-[11.5px] text-[#007AFF] break-all">
                    {getResolvedCommand()}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[var(--border-subtle)]">
                <button
                  onClick={() => setActiveParamCmd(null)}
                  className="px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--hover-item)] rounded-lg transition"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleApplyParamCommand}
                  className="px-4 py-1.5 text-[12px] font-medium bg-[#007AFF] hover:bg-[#0A84FF] text-white rounded-lg flex items-center space-x-1.5 transition active:scale-95 shadow-sm"
                >
                  <Send className="w-3 h-3" />
                  <span>{t("cmd.executeAndSend")}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
