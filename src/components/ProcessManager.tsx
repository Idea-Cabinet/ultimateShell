import React, { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TabSession, ProcessEntry } from "../types";
import {
  Search,
  RotateCw,
  X,
  Skull,
  AlertTriangle,
} from "lucide-react";

interface Props {
  session: TabSession;
  onSendToTerminal?: (cmd: string) => void;
}

type SortField = "cpu" | "mem" | "pid" | "user";

export const ProcessManager: React.FC<Props> = ({ session, onSendToTerminal: _onSendToTerminal }) => {
  const [processes, setProcesses] = useState<ProcessEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("cpu");
  const [sortAsc, setSortAsc] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Kill Modal State
  const [killTarget, setKillTarget] = useState<ProcessEntry | null>(null);
  const [killSignal, setKillSignal] = useState<number>(15); // 15: SIGTERM, 9: SIGKILL
  const [isKilling, setIsKilling] = useState(false);
  const [killFeedback, setKillFeedback] = useState<string | null>(null);

  const activeReq = useRef(0);

  const fetchProcesses = async () => {
    if (!session.id) return;
    const reqId = ++activeReq.current;
    setLoading(true);
    setErrorMsg(null);

    try {
      const list = await invoke<ProcessEntry[]>("get_process_list", {
        sessionId: session.id,
      });
      if (reqId === activeReq.current) {
        setProcesses(list);
      }
    } catch (err: any) {
      if (reqId === activeReq.current) {
        setErrorMsg(typeof err === "string" ? err : err.message || "获取进程列表失败");
      }
    } finally {
      if (reqId === activeReq.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchProcesses();
  }, [session.id]);

  // Auto refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchProcesses, 3000);
    return () => clearInterval(timer);
  }, [autoRefresh, session.id]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const handleConfirmKill = async () => {
    if (!killTarget) return;
    setIsKilling(true);
    setKillFeedback(null);

    try {
      await invoke("kill_process", {
        sessionId: session.id,
        pid: killTarget.pid,
        signal: killSignal,
      });
      setKillTarget(null);
      await fetchProcesses();
    } catch (err: any) {
      setKillFeedback(typeof err === "string" ? err : err.message || "终止进程失败");
    } finally {
      setIsKilling(false);
    }
  };

  const filteredProcesses = useMemo(() => {
    let result = processes;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.command.toLowerCase().includes(q) ||
          p.user.toLowerCase().includes(q) ||
          p.pid.toString().includes(q)
      );
    }

    return [...result].sort((a, b) => {
      let comp = 0;
      if (sortField === "cpu") comp = a.cpu - b.cpu;
      else if (sortField === "mem") comp = a.mem - b.mem;
      else if (sortField === "pid") comp = a.pid - b.pid;
      else if (sortField === "user") comp = a.user.localeCompare(b.user);
      return sortAsc ? comp : -comp;
    });
  }, [processes, searchQuery, sortField, sortAsc]);

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-app)] overflow-hidden select-none text-[12px]">
      {/* Top Controls Toolbar */}
      <div className="h-8 px-3 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between space-x-2 text-[11.5px] flex-shrink-0">
        <div className="flex items-center space-x-2 flex-1">
          {/* Search Box */}
          <div className="relative flex items-center w-56">
            <Search className="w-3 h-3 text-[var(--text-tertiary)] absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 PID、进程指令或用户..."
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

          <span className="text-[var(--text-tertiary)] text-[10.5px]">
            共 {filteredProcesses.length} 个活跃进程
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
            <span>3秒自动刷新</span>
          </label>

          <button
            onClick={fetchProcesses}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            title="手动刷新进程列表"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#007AFF]" : ""}`} />
          </button>
        </div>
      </div>

      {/* Process Table Header */}
      <div className="h-7 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center text-[11px] text-[var(--text-tertiary)] font-medium px-3 select-none flex-shrink-0">
        <div
          onClick={() => handleSort("pid")}
          className="w-20 cursor-pointer hover:text-[var(--text-primary)] flex items-center space-x-1"
        >
          <span>PID</span>
          {sortField === "pid" && <span>{sortAsc ? "↑" : "↓"}</span>}
        </div>
        <div
          onClick={() => handleSort("user")}
          className="w-24 cursor-pointer hover:text-[var(--text-primary)] flex items-center space-x-1 truncate"
        >
          <span>USER</span>
          {sortField === "user" && <span>{sortAsc ? "↑" : "↓"}</span>}
        </div>
        <div
          onClick={() => handleSort("cpu")}
          className="w-20 text-right pr-3 cursor-pointer hover:text-[var(--text-primary)] flex items-center justify-end space-x-1"
        >
          <span>%CPU</span>
          {sortField === "cpu" && <span>{sortAsc ? "↑" : "↓"}</span>}
        </div>
        <div
          onClick={() => handleSort("mem")}
          className="w-20 text-right pr-3 cursor-pointer hover:text-[var(--text-primary)] flex items-center justify-end space-x-1"
        >
          <span>%MEM</span>
          {sortField === "mem" && <span>{sortAsc ? "↑" : "↓"}</span>}
        </div>
        <div className="w-16 text-center">状态</div>
        <div className="flex-1 truncate pl-2">命令行 (COMMAND)</div>
        <div className="w-20 text-center flex-shrink-0">操作</div>
      </div>

      {/* Process Rows List */}
      <div className="flex-1 overflow-y-auto">
        {loading && filteredProcesses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)]">
            <RotateCw className="w-5 h-5 animate-spin text-[#007AFF] mb-2" />
            <span>正在读取进程列表...</span>
          </div>
        ) : errorMsg ? (
          <div className="flex flex-col items-center justify-center py-12 text-rose-500">
            <AlertTriangle className="w-6 h-6 mb-2" />
            <span>{errorMsg}</span>
            <button
              onClick={fetchProcesses}
              className="mt-3 px-3 py-1 bg-[#007AFF] text-white rounded text-[11px]"
            >
              重试
            </button>
          </div>
        ) : filteredProcesses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)]">
            <span>未找到匹配的进程</span>
          </div>
        ) : (
          filteredProcesses.map((proc) => {
            const isHighCpu = proc.cpu >= 50;
            const isHighMem = proc.mem >= 50;

            return (
              <div
                key={proc.pid}
                className="h-7 px-3 flex items-center text-[11.5px] border-b border-[var(--border-subtle)]/35 hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] group font-mono transition-colors"
              >
                <div className="w-20 font-bold text-[var(--text-primary)]">{proc.pid}</div>
                <div className="w-24 truncate text-[var(--text-tertiary)]">{proc.user}</div>
                <div
                  className={`w-20 text-right pr-3 font-semibold ${
                    isHighCpu ? "text-rose-500" : proc.cpu > 10 ? "text-amber-500" : ""
                  }`}
                >
                  {proc.cpu.toFixed(1)}%
                </div>
                <div
                  className={`w-20 text-right pr-3 font-semibold ${
                    isHighMem ? "text-rose-500" : proc.mem > 10 ? "text-purple-400" : ""
                  }`}
                >
                  {proc.mem.toFixed(1)}%
                </div>
                <div className="w-16 text-center text-[10px] text-[var(--text-tertiary)]">
                  {proc.stat}
                </div>
                <div
                  className="flex-1 truncate pl-2 font-mono text-[11px] text-[var(--text-primary)]"
                  title={proc.command}
                >
                  {proc.command}
                </div>
                <div className="w-20 flex justify-center flex-shrink-0">
                  <button
                    onClick={() => {
                      setKillTarget(proc);
                      setKillSignal(15);
                      setKillFeedback(null);
                    }}
                    className="px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition active:scale-95"
                    title={`结束此进程 (PID: ${proc.pid})`}
                  >
                    结束
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Kill Process Confirmation Modal */}
      {killTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm animate-in fade-in duration-100">
          <div className="apple-card rounded-2xl w-[440px] p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] font-sans">
            <div className="flex items-start space-x-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 text-rose-500 flex items-center justify-center flex-shrink-0">
                <Skull className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-[14px]">确认终止进程？</h3>
                <div className="text-[12px] text-[var(--text-secondary)] mt-1 break-all font-mono bg-[var(--hover-item)] p-2 rounded-lg border border-[var(--border-subtle)]">
                  PID {killTarget.pid} ({killTarget.user}): {killTarget.command}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                选择终止信号方式:
              </label>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <button
                  type="button"
                  onClick={() => setKillSignal(15)}
                  className={`p-2 rounded-lg border text-left transition ${
                    killSignal === 15
                      ? "border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF] font-medium"
                      : "border-[var(--border-subtle)] hover:bg-[var(--hover-item)]"
                  }`}
                >
                  <div className="font-semibold">SIGTERM (15)</div>
                  <div className="text-[10px] text-[var(--text-tertiary)]">优雅终止，保存数据后退出</div>
                </button>
                <button
                  type="button"
                  onClick={() => setKillSignal(9)}
                  className={`p-2 rounded-lg border text-left transition ${
                    killSignal === 9
                      ? "border-rose-500 bg-rose-500/10 text-rose-500 font-medium"
                      : "border-[var(--border-subtle)] hover:bg-[var(--hover-item)]"
                  }`}
                >
                  <div className="font-semibold">SIGKILL (9)</div>
                  <div className="text-[10px] text-[var(--text-tertiary)]">强制立即杀死进程</div>
                </button>
              </div>
            </div>

            {killFeedback && (
              <div className="mt-3 text-[11.5px] text-rose-500 p-2 rounded bg-rose-500/10">
                {killFeedback}
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-4 mt-2 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setKillTarget(null)}
                className="px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--hover-item)] rounded-lg transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmKill}
                disabled={isKilling}
                className="px-4 py-1.5 text-[12px] font-medium bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white rounded-lg flex items-center space-x-1.5 transition active:scale-95 shadow-sm"
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
