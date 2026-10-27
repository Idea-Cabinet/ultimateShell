import React, { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import { TabSession } from "../types";
import { useI18n } from "../i18n";

export interface ParametricCommand {
  id: string;
  category: string;
  name: string;
  template: string; // e.g. "docker logs -f --tail {lines:100} {container:web}"
  description: string;
}

const DEFAULT_TEMPLATES: ParametricCommand[] = [
  {
    id: "docker-logs",
    category: "Docker",
    name: "容器实时日志",
    template: "docker logs -f --tail {lines:100} {container:app}",
    description: "跟踪查看容器最新的输出日志",
  },
  {
    id: "docker-exec",
    category: "Docker",
    name: "进入容器终端",
    template: "docker exec -it {container:app} /bin/sh",
    description: "在运行的容器内启动交互式终端",
  },
  {
    id: "docker-restart",
    category: "Docker",
    name: "重启指定容器",
    template: "docker restart {container:app}",
    description: "重新启动服务容器",
  },
  {
    id: "find-file",
    category: "文件检索",
    name: "文件名深度查找",
    template: 'find {path:/} -name "{pattern:*.log}" 2>/dev/null',
    description: "在指定目录树下查找匹配文件",
  },
  {
    id: "grep-text",
    category: "文件检索",
    name: "全文关键词搜索",
    template: 'grep -rn "{keyword:error}" {path:./} --color=auto',
    description: "递归搜索包含特定字符串的文件与行号",
  },
  {
    id: "tar-pack",
    category: "压缩解压",
    name: "打包压缩目录",
    template: "tar -czvf {archive:backup.tar.gz} {target:./data}",
    description: "使用 gzip 算法创建压缩包",
  },
  {
    id: "tar-unpack",
    category: "压缩解压",
    name: "解压 tar.gz 压缩包",
    template: "tar -xzvf {archive:backup.tar.gz} -C {dest:./}",
    description: "解压缩归档文件至目标目录",
  },
  {
    id: "net-port",
    category: "网络端口",
    name: "端口占用过滤",
    template: "ss -tulnp | grep {port:8080}",
    description: "查询指定端口由哪个服务监听",
  },
  {
    id: "curl-inspect",
    category: "网络诊断",
    name: "HTTP 响应头检测",
    template: "curl -IL {url:https://google.com} --connect-timeout 5",
    description: "检查网站 HTTP 重定向及响应头状态",
  },
  {
    id: "service-log",
    category: "系统运维",
    name: "Systemd 服务日志",
    template: "journalctl -u {service:nginx} -n {lines:50} -f",
    description: "追踪系统守护服务日志输出",
  },
  {
    id: "dir-size",
    category: "系统运维",
    name: "目录大小排行",
    template: "du -sh {path:./}* | sort -hr | head -n {count:10}",
    description: "统计当前目录下占用最大的文件夹",
  },
];

interface Props {
  session?: TabSession;
  isOpen?: boolean;
  onClose: () => void;
  onSendToTerminal: (cmd: string) => void;
}

export const CommandAssistant: React.FC<Props> = ({ session: _session, isOpen = true, onClose, onSendToTerminal }) => {
  const { t } = useI18n();
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
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);

  // Parameter Fill Modal State
  const [activeParamCmd, setActiveParamCmd] = useState<ParametricCommand | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const inputRef = useRef<HTMLInputElement>(null);

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

    onSendToTerminal(`${trimmed}\n`);
    setInputCmd("");
    setHistoryIdx(-1);
    setShowHistoryDropdown(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeCommand(inputCmd);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(nextIdx);
      setInputCmd(history[nextIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInputCmd(history[nextIdx]);
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        setInputCmd("");
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  // Parse parameters from template string: "{name:default}"
  const openParamDialog = (item: ParametricCommand) => {
    const regex = /\{([a-zA-Z0-9_-]+)(?::([^}]+))?\}/g;
    const initialVals: Record<string, string> = {};
    let match;
    while ((match = regex.exec(item.template)) !== null) {
      const key = match[1];
      const defaultVal = match[2] || "";
      initialVals[key] = defaultVal;
    }
    setActiveParamCmd(item);
    setParamValues(initialVals);
  };

  // Generate resolved command with parameters substituted
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
  const suggestions = DEFAULT_TEMPLATES.filter(
    (t) =>
      inputCmd.trim() &&
      (t.name.toLowerCase().includes(inputCmd.toLowerCase()) ||
        t.template.toLowerCase().includes(inputCmd.toLowerCase()) ||
        t.category.toLowerCase().includes(inputCmd.toLowerCase()))
  ).slice(0, 4);

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
              <span className="font-sans font-medium">{item.name}</span>
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
          <div className="relative">
            <button
              onClick={() => setShowHistoryDropdown(!showHistoryDropdown)}
              className={`p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition flex items-center space-x-0.5 ${
                showHistoryDropdown ? "bg-[var(--hover-item)] text-[#007AFF]" : ""
              }`}
              title={t("cmd.historyTip")}
            >
              <Clock className="w-3 h-3" />
              <ChevronDown className="w-2.5 h-2.5" />
            </button>

            {/* History Dropdown Menu */}
            {showHistoryDropdown && (
              <div
                className="absolute right-0 bottom-7 z-50 w-72 max-h-56 overflow-y-auto bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl shadow-2xl p-1 text-[11.5px] font-mono apple-vibrancy-popover animate-in fade-in zoom-in-95 duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-2 py-1 text-[10px] font-sans font-semibold text-[var(--text-tertiary)] uppercase flex justify-between items-center border-b border-[var(--border-subtle)]/50">
                  <span>{t("cmd.historyTitle")} ({history.length})</span>
                  <button
                    onClick={() => {
                      setHistory([]);
                      localStorage.removeItem("ultimateshell_cmd_history");
                      setShowHistoryDropdown(false);
                    }}
                    className="text-rose-500 hover:underline"
                  >
                    {t("cmd.historyClear")}
                  </button>
                </div>
                {history.length === 0 ? (
                  <div className="p-3 text-center text-[var(--text-tertiary)] font-sans">
                    {t("cmd.historyEmpty")}
                  </div>
                ) : (
                  history.map((cmd, i) => (
                    <div
                      key={i}
                      onClick={() => {
                        setInputCmd(cmd);
                        setShowHistoryDropdown(false);
                        inputRef.current?.focus();
                      }}
                      className="px-2 py-1.5 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer truncate flex items-center justify-between group"
                    >
                      <span className="truncate">{cmd}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          executeCommand(cmd);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded bg-[#007AFF] text-white hover:bg-[#0062CC] ml-1 flex-shrink-0"
                        title={t("cmd.runNow")}
                      >
                        <Play className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Templates Library Button */}
        <button
          onClick={() => setShowTemplatesModal(true)}
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
          title="关闭命令辅助栏"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Templates Library Modal (Rendered to document.body to avoid being covered by sidebar) */}
      {showTemplatesModal &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 backdrop-blur-sm animate-in fade-in duration-100">
            <div className="apple-card rounded-2xl w-[640px] max-h-[500px] flex flex-col p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)]">
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

              <div className="flex-1 overflow-y-auto py-3 space-y-2 no-scrollbar">
                {DEFAULT_TEMPLATES.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => openParamDialog(item)}
                    className="p-3 rounded-xl bg-[var(--hover-item)]/60 hover:bg-[var(--hover-item)] border border-[var(--border-subtle)] cursor-pointer transition flex items-center justify-between group"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-[12.5px] text-[var(--text-primary)]">
                          {item.name}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#007AFF]/15 text-[#007AFF] font-medium">
                          {item.category}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-[var(--text-secondary)] mt-1 truncate">
                        {item.template}
                      </div>
                      <div className="text-[10.5px] text-[var(--text-tertiary)] mt-0.5">
                        {item.description}
                      </div>
                    </div>
                    <button className="px-2.5 py-1 rounded-lg bg-[#007AFF] text-white text-[11px] font-medium opacity-0 group-hover:opacity-100 transition active:scale-95 flex items-center space-x-1 flex-shrink-0">
                      <Sparkles className="w-3 h-3" />
                      <span>{t("cmd.fillParams")}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Parameter Filling Modal (Rendered to document.body to avoid being covered by sidebar) */}
      {activeParamCmd &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 backdrop-blur-sm animate-in fade-in duration-100">
            <div className="apple-card rounded-2xl w-[480px] p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)]">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
                <div>
                  <h3 className="font-semibold text-[14px]">{activeParamCmd.name}</h3>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    {t("cmd.smartReplace")}
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
