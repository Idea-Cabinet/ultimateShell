import React, { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TabSession, PortEntry } from "../types";
import { useI18n } from "../i18n";
import {
  Search,
  RotateCw,
  X,
  Skull,
  Radio,
  Copy,
  Check,
  Maximize2,
  Minimize2,
} from "lucide-react";

interface Props {
  session: TabSession;
  onSendToTerminal?: (cmd: string) => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onClose?: () => void;
}

type SortField = "port" | "proto" | "program" | "pid";

export const PortManager: React.FC<Props> = ({
  session,
  isMaximized,
  onToggleMaximize,
  onClose,
}) => {
  const { t } = useI18n();
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [protoFilter, setProtoFilter] = useState<"all" | "tcp" | "udp">("all");
  const [sortField, setSortField] = useState<SortField>("port");
  const [sortAsc, setSortAsc] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [copiedPort, setCopiedPort] = useState<number | null>(null);

  // Kill Modal State
  const [killTarget, setKillTarget] = useState<PortEntry | null>(null);
  const [killSignal, setKillSignal] = useState<number>(15);
  const [isKilling, setIsKilling] = useState(false);
  const [killFeedback, setKillFeedback] = useState<string | null>(null);

  const activeReq = useRef(0);

  const fetchPorts = async () => {
    if (!session.id) return;
    const reqId = ++activeReq.current;
    setLoading(true);
    setErrorMsg(null);

    try {
      const list = await invoke<PortEntry[]>("get_listening_ports", {
        sessionId: session.id,
      });
      if (reqId === activeReq.current) {
        setPorts(list);
      }
    } catch (err: any) {
      if (reqId === activeReq.current) {
        setErrorMsg(typeof err === "string" ? err : err.message || "获取端口监听列表失败");
      }
    } finally {
      if (reqId === activeReq.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchPorts();
  }, [session.id]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchPorts, 3000);
    return () => clearInterval(timer);
  }, [autoRefresh, session.id]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const handleCopy = (port: number) => {
    navigator.clipboard.writeText(String(port));
    setCopiedPort(port);
    setTimeout(() => setCopiedPort(null), 1500);
  };

  const handleConfirmKill = async () => {
    if (!killTarget || !killTarget.pid) return;
    setIsKilling(true);
    setKillFeedback(null);

    try {
      await invoke("kill_process", {
        sessionId: session.id,
        pid: killTarget.pid,
        signal: killSignal,
      });
      setKillTarget(null);
      await fetchPorts();
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err.message || "终止进程失败";
      setKillFeedback(msg);
    } finally {
      setIsKilling(false);
    }
  };

  const filteredPorts = useMemo(() => {
    let result = ports;

    // Filter by protocol
    if (protoFilter !== "all") {
      result = result.filter((p) => p.proto.toLowerCase().startsWith(protoFilter));
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.port.toString().includes(q) ||
          p.program.toLowerCase().includes(q) ||
          p.local_ip.toLowerCase().includes(q) ||
          (p.pid && p.pid.toString().includes(q)) ||
          p.user.toLowerCase().includes(q)
      );
    }

    return [...result].sort((a, b) => {
      let comp = 0;
      if (sortField === "port") comp = a.port - b.port;
      else if (sortField === "proto") comp = a.proto.localeCompare(b.proto);
      else if (sortField === "program") comp = a.program.localeCompare(b.program);
      else if (sortField === "pid") comp = (a.pid ?? 0) - (b.pid ?? 0);
      return sortAsc ? comp : -comp;
    });
  }, [ports, protoFilter, searchQuery, sortField, sortAsc]);

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-app)] overflow-hidden select-none text-[12px]">
      {/* Top Controls Toolbar */}
      <div className="h-8 px-3 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between space-x-2 text-[11.5px] flex-shrink-0">
        <div className="flex items-center space-x-2 flex-1">
          {/* Search Box */}
          <div className="relative flex items-center w-52">
            <Search className="w-3 h-3 text-[var(--text-tertiary)] absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("port.searchPlaceholder")}
              className="h-6 w-full pl-6 pr-5 text-[11px] bg-[var(--bg-app)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded outline-none text-[var(--text-primary)]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>

          {/* Protocol Filter Pills */}
          <div className="flex items-center bg-[var(--bg-app)] rounded p-0.5 border border-[var(--border-subtle)] text-[10.5px]">
            <button
              onClick={() => setProtoFilter("all")}
              className={`px-2 py-0.5 rounded transition ${
                protoFilter === "all"
                  ? "bg-[#007AFF] text-white font-medium"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              全部
            </button>
            <button
              onClick={() => setProtoFilter("tcp")}
              className={`px-2 py-0.5 rounded transition ${
                protoFilter === "tcp"
                  ? "bg-[#007AFF] text-white font-medium"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              TCP
            </button>
            <button
              onClick={() => setProtoFilter("udp")}
              className={`px-2 py-0.5 rounded transition ${
                protoFilter === "udp"
                  ? "bg-[#007AFF] text-white font-medium"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              UDP
            </button>
          </div>

          <span className="text-[var(--text-tertiary)] text-[10.5px]">
            共 {filteredPorts.length} 个监听端口
          </span>
        </div>

        {/* Right Tools */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          <label className="flex items-center space-x-1.5 cursor-pointer text-[11px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded accent-[#007AFF] w-3 h-3"
            />
            <span>{t("port.autoRefresh")}</span>
          </label>

          <button
            onClick={fetchPorts}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            title={t("port.refresh")}
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#007AFF]" : ""}`} />
          </button>

          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
              title={isMaximized ? "还原抽屉大小" : "最大化抽屉"}
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
              title="关闭抽屉"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Table View */}
      <div className="flex-1 overflow-auto bg-[var(--bg-card)]">
        {errorMsg ? (
          <div className="p-8 text-center text-rose-500 space-y-2">
            <Radio className="w-8 h-8 mx-auto opacity-50 mb-2" />
            <div className="text-[13px] font-medium">获取监听端口失败</div>
            <div className="text-[11px] text-[var(--text-tertiary)]">{errorMsg}</div>
            <button
              onClick={fetchPorts}
              className="mt-3 px-3 py-1 bg-[#007AFF] text-white rounded text-[11px] hover:bg-[#0062CC] transition"
            >
              重试
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-[11.5px] text-left">
            <thead className="sticky top-0 bg-[var(--bg-app)] border-b border-[var(--border-subtle)] text-[var(--text-secondary)] shadow-xs z-10 font-medium">
              <tr>
                <th
                  onClick={() => handleSort("proto")}
                  className="py-1.5 px-3 cursor-pointer hover:text-[var(--text-primary)] w-20"
                >
                  {t("port.colProto")} {sortField === "proto" && (sortAsc ? "↑" : "↓")}
                </th>
                <th
                  onClick={() => handleSort("port")}
                  className="py-1.5 px-3 cursor-pointer hover:text-[var(--text-primary)] w-28"
                >
                  {t("port.colPort")} {sortField === "port" && (sortAsc ? "↑" : "↓")}
                </th>
                <th className="py-1.5 px-3 w-36">{t("port.colAddress")}</th>
                <th className="py-1.5 px-3 w-24">状态</th>
                <th
                  onClick={() => handleSort("program")}
                  className="py-1.5 px-3 cursor-pointer hover:text-[var(--text-primary)] min-w-[120px]"
                >
                  {t("port.colProgram")} {sortField === "program" && (sortAsc ? "↑" : "↓")}
                </th>
                <th
                  onClick={() => handleSort("pid")}
                  className="py-1.5 px-3 cursor-pointer hover:text-[var(--text-primary)] w-20"
                >
                  {t("port.colPid")} {sortField === "pid" && (sortAsc ? "↑" : "↓")}
                </th>
                <th className="py-1.5 px-3 w-24">{t("port.colUser")}</th>
                <th className="py-1.5 px-3 text-right w-24">{t("port.action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]/40 text-[var(--text-primary)] font-mono">
              {filteredPorts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[var(--text-tertiary)]">
                    {loading ? (
                      <div className="flex items-center justify-center space-x-2">
                        <RotateCw className="w-4 h-4 animate-spin text-[#007AFF]" />
                        <span>正在探测监听端口...</span>
                      </div>
                    ) : (
                      "未发现匹配的监听端口"
                    )}
                  </td>
                </tr>
              ) : (
                filteredPorts.map((p, idx) => {
                  const isTcp = p.proto.toLowerCase().startsWith("tcp");
                  return (
                    <tr
                      key={`${p.proto}-${p.local_ip}-${p.port}-${idx}`}
                      className="hover:bg-[var(--hover-item)] transition-colors group"
                    >
                      {/* Protocol */}
                      <td className="py-1.5 px-3">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                            isTcp
                              ? "bg-[#007AFF]/15 text-[#007AFF]"
                              : "bg-purple-500/15 text-purple-500"
                          }`}
                        >
                          {p.proto}
                        </span>
                      </td>

                      {/* Port */}
                      <td className="py-1.5 px-3 font-semibold text-[var(--text-primary)] flex items-center space-x-1.5">
                        <span className="text-[#007AFF] font-bold text-[12px]">{p.port}</span>
                        <button
                          onClick={() => handleCopy(p.port)}
                          title="复制端口号"
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--hover-item)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition"
                        >
                          {copiedPort === p.port ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </td>

                      {/* Local IP */}
                      <td className="py-1.5 px-3 text-[var(--text-secondary)] truncate">
                        {p.local_ip}
                      </td>

                      {/* State */}
                      <td className="py-1.5 px-3">
                        <span className="inline-flex items-center space-x-1 text-[10px] text-emerald-500 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          <span>{p.state}</span>
                        </span>
                      </td>

                      {/* Program */}
                      <td className="py-1.5 px-3 font-sans font-medium text-[var(--text-primary)] truncate max-w-[200px]">
                        {p.program}
                      </td>

                      {/* PID */}
                      <td className="py-1.5 px-3 text-[var(--text-secondary)]">
                        {p.pid ?? "-"}
                      </td>

                      {/* User */}
                      <td className="py-1.5 px-3 text-[var(--text-tertiary)] truncate">
                        {p.user}
                      </td>

                      {/* Action */}
                      <td className="py-1.5 px-3 text-right">
                        {p.pid ? (
                          <button
                            onClick={() => {
                              setKillFeedback(null);
                              setKillTarget(p);
                            }}
                            title={`终止占用该端口的进程 (PID: ${p.pid})`}
                            className="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-[10.5px] rounded bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white transition flex items-center space-x-1 ml-auto"
                          >
                            <Skull className="w-2.5 h-2.5" />
                            <span>{t("port.kill")}</span>
                          </button>
                        ) : (
                          <span className="text-[var(--text-tertiary)] text-[10px]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Kill Modal */}
      {killTarget && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          style={{ zIndex: 99999 }}
          onClick={() => !isKilling && setKillTarget(null)}
        >
          <div
            className="w-[400px] apple-card rounded-2xl p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] select-none animate-in zoom-in-95 duration-120"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start space-x-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 text-rose-500 flex items-center justify-center flex-shrink-0">
                <Skull className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold tracking-tight">
                  {t("port.confirmKill")}
                </div>
                <div className="text-[11.5px] text-[var(--text-secondary)] mt-1 truncate">
                  {t("port.confirmKillDesc", {
                    port: killTarget.port,
                    pid: killTarget.pid || "?",
                    prog: killTarget.program || "?",
                  })}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2.5">
              <div className="text-[11px] text-[var(--text-secondary)]">选择终止信号：</div>
              <div className="space-y-1.5">
                <label className="flex items-center space-x-2 text-[11.5px] p-2 rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--hover-item)] cursor-pointer">
                  <input
                    type="radio"
                    name="portKillSignal"
                    checked={killSignal === 15}
                    onChange={() => setKillSignal(15)}
                    className="accent-rose-500"
                  />
                  <div>
                    <span className="font-medium">SIGTERM (15) - 优雅退出</span>
                    <p className="text-[10px] text-[var(--text-tertiary)]">允许程序释放资源后正常退出（推荐）</p>
                  </div>
                </label>
                <label className="flex items-center space-x-2 text-[11.5px] p-2 rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--hover-item)] cursor-pointer">
                  <input
                    type="radio"
                    name="portKillSignal"
                    checked={killSignal === 9}
                    onChange={() => setKillSignal(9)}
                    className="accent-rose-500"
                  />
                  <div>
                    <span className="font-medium text-rose-500">SIGKILL (9) - 强制杀死</span>
                    <p className="text-[10px] text-[var(--text-tertiary)]">立即强制终止进程，无法被程序忽略</p>
                  </div>
                </label>
              </div>

              {killFeedback && (
                <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[11px]">
                  {killFeedback}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-5">
              <button
                type="button"
                onClick={() => setKillTarget(null)}
                disabled={isKilling}
                className="px-3.5 py-1.5 text-[12px] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-item)] transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmKill}
                disabled={isKilling}
                className="px-4 py-1.5 text-[12px] font-medium text-white rounded-lg shadow-sm transition active:scale-95 disabled:opacity-50 flex items-center space-x-1.5 bg-rose-500 hover:bg-rose-600"
              >
                {isKilling && <RotateCw className="w-3 h-3 animate-spin" />}
                <span>确认终止</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
