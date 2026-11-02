import React, { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "../i18n";
import { GatewayGuide } from "./GatewayGuide";
import {
  Bot,
  Shield,
  Zap,
  Trash2,
  RefreshCw,
  X,
  Terminal,
  ChevronDown,
  ChevronRight,
  FileText,
  Search,
} from "lucide-react";

export type ApprovalPolicy = "strict" | "smart" | "auto";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  agent_name: string;
  server_target: string;
  command: string;
  risk_level: "Safe" | "Mutation" | "Critical";
  policy_applied: ApprovalPolicy;
  approved_by_user: boolean;
  status: "success" | "denied" | "error" | "timeout";
  exit_code?: number;
  output_snippet?: string;
  duration_ms: number;
}

export interface GatewayStatusPayload {
  is_running: boolean;
  port: number;
  ssh_port: number;
  ssh_running: boolean;
  token: string;
  policy: ApprovalPolicy;
  active_servers_count: number;
  audit_count: number;
  pending_approvals_count: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const AgentGatewayDrawer: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<GatewayStatusPayload | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"logs" | "guide">("logs");
  const [filterRisk, setFilterRisk] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchStatus = async () => {
    try {
      const s = await invoke<GatewayStatusPayload>("agent_get_gateway_status");
      setStatus(s);
    } catch (e) {
      console.error("Failed to get gateway status:", e);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const logs = await invoke<AuditLogEntry[]>("agent_get_audit_logs");
      setAuditLogs(logs);
    } catch (e) {
      console.error("Failed to get audit logs:", e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      fetchAuditLogs();
    }
  }, [isOpen]);

  // Listen for audit updates
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    listen("agent_audit_updated", () => {
      if (disposed) return;
      fetchAuditLogs();
      fetchStatus();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  const handlePolicyChange = async (newPolicy: ApprovalPolicy) => {
    try {
      await invoke("agent_set_gateway_policy", { policy: newPolicy });
      setStatus((prev) => (prev ? { ...prev, policy: newPolicy } : null));
    } catch (e) {
      console.error("Failed to update policy:", e);
    }
  };

  const handleToggleRunning = async () => {
    if (!status) return;
    try {
      const nextState = !status.is_running;
      await invoke("agent_toggle_gateway", { enabled: nextState });
      setStatus((prev) => (prev ? { ...prev, is_running: nextState } : null));
    } catch (e) {
      console.error("Failed to toggle gateway:", e);
    }
  };

  const handleClearLogs = async () => {
    try {
      await invoke("agent_clear_audit_logs");
      setAuditLogs([]);
    } catch (e) {
      console.error("Failed to clear logs:", e);
    }
  };

  const filteredLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      if (filterRisk !== "all" && log.risk_level.toLowerCase() !== filterRisk) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          log.command.toLowerCase().includes(q) ||
          log.server_target.toLowerCase().includes(q) ||
          log.agent_name.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [auditLogs, filterRisk, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-2xl h-full bg-[var(--bg-app)] border-l border-[var(--border-subtle)] shadow-2xl flex flex-col text-[var(--text-primary)]">
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/15 text-purple-500 border border-purple-500/30 flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-[14px] font-semibold tracking-tight">
                  {t("agent.title")}
                </h2>
                {status?.is_running ? (
                  <div className="flex items-center space-x-1.5">
                    <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>HTTP :{status.port}</span>
                    </span>
                    <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] bg-blue-500/15 text-blue-500 border border-blue-500/30 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <span>SSH :{status.ssh_port || 2222}</span>
                    </span>
                  </div>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-red-500/15 text-red-500 border border-red-500/30">
                    {t("agent.stopped")}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                AI Agent Proxy · Zero Password Leakage · Approval Gate
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleToggleRunning}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                status?.is_running
                  ? "bg-red-500/10 text-red-500 border-red-500/30 hover:bg-red-500/20"
                  : "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20"
              }`}
            >
              {status?.is_running ? t("service.stop") : t("service.start")}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Policy Selector Banner */}
        <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--hover-item)]/30">
          <div className="text-[11.5px] font-medium text-[var(--text-secondary)] mb-2 flex items-center justify-between">
            <span>🛡️ {t("agent.policy")}:</span>
            <span className="text-[10.5px] text-[var(--text-tertiary)]">
              {status?.policy === "strict"
                ? t("agent.policyStrict")
                : status?.policy === "auto"
                ? t("agent.policyAuto")
                : t("agent.policySmart")}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Strict */}
            <button
              onClick={() => handlePolicyChange("strict")}
              className={`p-2.5 rounded-xl border text-left transition-all relative ${
                status?.policy === "strict"
                  ? "bg-[#007AFF]/15 border-[#007AFF] text-[#007AFF] shadow-xs"
                  : "border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]"
              }`}
            >
              <div className="flex items-center space-x-1.5 font-semibold text-[11.5px]">
                <Shield className="w-3.5 h-3.5" />
                <span>{t("agent.policyStrict")}</span>
              </div>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-tight">
                {t("agent.policyStrictDesc")}
              </p>
            </button>

            {/* Smart */}
            <button
              onClick={() => handlePolicyChange("smart")}
              className={`p-2.5 rounded-xl border text-left transition-all relative ${
                status?.policy === "smart"
                  ? "bg-purple-500/15 border-purple-500 text-purple-500 shadow-xs"
                  : "border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]"
              }`}
            >
              <div className="flex items-center space-x-1.5 font-semibold text-[11.5px]">
                <Bot className="w-3.5 h-3.5" />
                <span>{t("agent.policySmart")}</span>
              </div>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-tight">
                {t("agent.policySmartDesc")}
              </p>
            </button>

            {/* Auto */}
            <button
              onClick={() => handlePolicyChange("auto")}
              className={`p-2.5 rounded-xl border text-left transition-all relative ${
                status?.policy === "auto"
                  ? "bg-emerald-500/15 border-emerald-500 text-emerald-500 shadow-xs"
                  : "border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]"
              }`}
            >
              <div className="flex items-center space-x-1.5 font-semibold text-[11.5px]">
                <Zap className="w-3.5 h-3.5" />
                <span>{t("agent.policyAuto")}</span>
              </div>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-tight">
                {t("agent.policyAutoDesc")}
              </p>
            </button>
          </div>
        </div>

        {/* Tab Switcher: Audit Logs vs Skill / MCP Guide */}
        <div className="flex items-center px-4 pt-2 border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
          <button
            onClick={() => setActiveTab("logs")}
            className={`pb-2 px-3 text-[12px] font-medium border-b-2 transition-all flex items-center space-x-1.5 ${
              activeTab === "logs"
                ? "border-[#007AFF] text-[#007AFF]"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>{t("agent.auditLogs")}</span>
            {auditLogs.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--hover-item)] font-mono text-[var(--text-secondary)]">
                {auditLogs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("guide")}
            className={`pb-2 px-3 text-[12px] font-medium border-b-2 transition-all flex items-center space-x-1.5 ${
              activeTab === "guide"
                ? "border-[#007AFF] text-[#007AFF]"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>接入 Skill 文档与配置</span>
          </button>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          {activeTab === "logs" ? (
            <div className="space-y-3">
              {/* Filter bar */}
              <div className="flex items-center justify-between gap-2 pb-1">
                <div className="relative flex-1 max-w-xs">
                  <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索命令 / 服务器..."
                    className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg pl-7 pr-2 py-1 text-[11px] focus:outline-hidden focus:border-[#007AFF]"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <select
                    value={filterRisk}
                    onChange={(e) => setFilterRisk(e.target.value)}
                    className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg px-2 py-1 text-[11px] focus:outline-hidden text-[var(--text-secondary)]"
                  >
                    <option value="all">所有风险等级</option>
                    <option value="critical">仅高危 (Critical)</option>
                    <option value="mutation">增删改 (Mutation)</option>
                    <option value="safe">安全只读 (Safe)</option>
                  </select>

                  <button
                    onClick={fetchAuditLogs}
                    title="刷新日志"
                    className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)]"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={handleClearLogs}
                    title="清空审计日志"
                    className="p-1 rounded hover:bg-[var(--hover-item)] text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Logs List */}
              {filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-[var(--text-tertiary)]">
                  <Bot className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-[12px]">暂无 AI Agent 审计执行记录</p>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                    当外部 Agent 连接本网关并执行命令时，将在此处保留完整记录与脱敏输出。
                  </p>
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const isCrit = log.risk_level === "Critical";
                  const isMut = log.risk_level === "Mutation";

                  return (
                    <div
                      key={log.id}
                      className="border border-[var(--border-subtle)] rounded-xl bg-[var(--bg-card)] overflow-hidden transition-all text-[11.5px]"
                    >
                      {/* Log Header Row */}
                      <div
                        onClick={() =>
                          setExpandedLogId(isExpanded ? null : log.id)
                        }
                        className="p-3 flex items-start justify-between cursor-pointer hover:bg-[var(--hover-item)]/50 transition-colors"
                      >
                        <div className="flex items-start space-x-2.5 flex-1 min-w-0 pr-2">
                          <div className="mt-0.5">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="px-1.5 py-0.2 rounded bg-[var(--hover-item)] font-mono text-[10px] text-[var(--text-primary)] border border-[var(--border-subtle)]">
                                {log.server_target}
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-medium border ${
                                  isCrit
                                    ? "bg-red-500/15 text-red-500 border-red-500/30"
                                    : isMut
                                    ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                                    : "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                                }`}
                              >
                                {log.risk_level}
                              </span>
                              <span className="text-[10px] text-[var(--text-tertiary)]">
                                {log.agent_name}
                              </span>
                            </div>

                            {/* Command */}
                            <div className="font-mono text-[11px] text-emerald-400 mt-1 truncate">
                              $ {log.command}
                            </div>
                          </div>
                        </div>

                        {/* Status & Timing */}
                        <div className="text-right flex-shrink-0">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              log.status === "success"
                                ? "text-emerald-500 bg-emerald-500/10"
                                : log.status === "denied"
                                ? "text-red-500 bg-red-500/10"
                                : "text-amber-500 bg-amber-500/10"
                            }`}
                          >
                            {log.status === "success"
                              ? "成功"
                              : log.status === "denied"
                              ? "已拒绝"
                              : "错误"}
                          </span>
                          <div className="text-[10px] text-[var(--text-tertiary)] mt-1">
                            {log.timestamp} · {log.duration_ms}ms
                          </div>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t border-[var(--border-subtle)] bg-[var(--bg-app)]/50">
                          <div className="flex items-center justify-between text-[10.5px] text-[var(--text-tertiary)] mb-1">
                            <span>执行输出脱敏摘要 (敏感密码/Key已抹除):</span>
                            {log.exit_code !== undefined && (
                              <span>退出码: {log.exit_code}</span>
                            )}
                          </div>
                          <pre className="bg-[var(--bg-terminal,rgba(0,0,0,0.5))] rounded-lg p-2.5 font-mono text-[11px] text-gray-300 max-h-48 overflow-y-auto whitespace-pre-wrap select-text border border-[var(--border-subtle)]">
                            {log.output_snippet || "（无输出）"}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* Guide Tab */
            <GatewayGuide status={status} />
          )}
        </div>
      </div>
    </div>
  );
};
