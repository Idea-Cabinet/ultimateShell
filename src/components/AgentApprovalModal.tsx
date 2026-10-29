import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "../i18n";
import {
  ShieldAlert,
  AlertTriangle,
  Zap,
  Check,
  X,
  Server,
  Clock,
  Terminal,
} from "lucide-react";

export interface ApprovalRequest {
  id: string;
  server_target: string;
  command: string;
  risk_level: "Safe" | "Mutation" | "Critical";
  policy: "strict" | "smart" | "auto";
  timestamp: string;
}

interface Props {
  onApprovalResolved?: () => void;
}

export const AgentApprovalModal: React.FC<Props> = ({ onApprovalResolved }) => {
  const { t } = useI18n();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [countdown, setCountdown] = useState<number>(60);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Listen for agent_approval_needed Tauri events
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    listen<ApprovalRequest>("agent_approval_needed", (event) => {
      if (disposed) return;
      setRequests((prev) => {
        // Avoid duplicate by id
        if (prev.some((r) => r.id === event.payload.id)) return prev;
        return [...prev, event.payload];
      });
      setCountdown(60);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  // 60-second countdown timer for current top request
  useEffect(() => {
    if (requests.length === 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Time expired for top request, pop it
          setRequests((curr) => curr.slice(1));
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [requests.length]);

  if (requests.length === 0) return null;

  const currentReq = requests[0];

  const handleResolve = async (approved: boolean, switchToAuto = false) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await invoke("agent_resolve_approval", {
        id: currentReq.id,
        approved,
        switchToAuto,
      });
      // Pop current request
      setRequests((prev) => prev.filter((r) => r.id !== currentReq.id));
      setCountdown(60);
      onApprovalResolved?.();
    } catch (err) {
      console.error("Failed to resolve approval:", err);
      // Even if failed (e.g. timeout), remove from view
      setRequests((prev) => prev.filter((r) => r.id !== currentReq.id));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCritical = currentReq.risk_level === "Critical";
  const isMutation = currentReq.risk_level === "Mutation";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="apple-card rounded-2xl w-full max-w-lg p-5 shadow-2xl border border-[var(--border-strong)] bg-[var(--bg-app)] text-[var(--text-primary)] relative overflow-hidden">
        {/* Top risk accent line */}
        <div
          className={`absolute top-0 left-0 right-0 h-1 ${
            isCritical
              ? "bg-gradient-to-r from-red-500 via-rose-500 to-amber-500"
              : "bg-gradient-to-r from-amber-500 via-yellow-500 to-blue-500"
          }`}
        />

        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center space-x-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                isCritical
                  ? "bg-red-500/15 text-red-500 border border-red-500/30"
                  : "bg-amber-500/15 text-amber-500 border border-amber-500/30"
              }`}
            >
              {isCritical ? (
                <ShieldAlert className="w-5 h-5 animate-pulse" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-[14px] font-semibold tracking-tight">
                  AI Agent 操作请求批准
                </h3>
                {requests.length > 1 && (
                  <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-blue-500/20 text-blue-500 font-mono">
                    待办 {requests.length}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--text-tertiary)] flex items-center space-x-1.5 mt-0.5">
                <Clock className="w-3 h-3" />
                <span>{currentReq.timestamp}</span>
                <span>·</span>
                <span className="font-mono text-amber-500 font-medium">
                  {countdown}s 后自动超时拒绝
                </span>
              </p>
            </div>
          </div>

          <div
            className={`px-2 py-0.5 rounded text-[10.5px] font-medium border flex items-center space-x-1 ${
              isCritical
                ? "bg-red-500/15 text-red-500 border-red-500/30"
                : isMutation
                ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                : "bg-blue-500/15 text-blue-500 border-blue-500/30"
            }`}
          >
            <span>
              {isCritical
                ? "⚠️ 高危指令 (L2)"
                : isMutation
                ? "⚡ 增删改操作 (L1)"
                : "安全只读 (L0)"}
            </span>
          </div>
        </div>

        {/* Target Server Info */}
        <div className="mt-3.5 space-y-2">
          <div className="flex items-center justify-between text-[11.5px] text-[var(--text-secondary)]">
            <div className="flex items-center space-x-1.5 font-medium">
              <Server className="w-3.5 h-3.5 text-[#007AFF]" />
              <span>目标服务器:</span>
              <span className="px-2 py-0.5 rounded bg-[var(--hover-item)] text-[var(--text-primary)] font-mono font-semibold border border-[var(--border-subtle)]">
                {currentReq.server_target}
              </span>
            </div>
            <span className="text-[10.5px] text-[var(--text-tertiary)]">
              当前策略:{" "}
              {currentReq.policy === "strict"
                ? "🛡️ 请求批准"
                : currentReq.policy === "smart"
                ? "🤖 帮我批准"
                : "⚡ 全部批准"}
            </span>
          </div>

          {/* Command Card */}
          <div className="relative group">
            <div className="flex items-center justify-between text-[11px] text-[var(--text-tertiary)] mb-1">
              <span className="flex items-center space-x-1">
                <Terminal className="w-3 h-3" />
                <span>Agent 拟执行的命令:</span>
              </span>
            </div>
            <div className="bg-[var(--bg-terminal,rgba(0,0,0,0.4))] border border-[var(--border-subtle)] rounded-xl p-3 font-mono text-[12px] text-emerald-400 break-all select-text shadow-inner">
              <span className="text-gray-500 select-none mr-2">$</span>
              {currentReq.command}
            </div>
          </div>

          {/* Risk Explanation Notice */}
          <p className="text-[11px] text-[var(--text-secondary)] bg-[var(--hover-item)]/60 rounded-lg p-2.5 border border-[var(--border-subtle)] leading-relaxed">
            {isCritical ? (
              <span className="text-red-400 font-medium">
                此指令涉及系统关键服务、内核参数修改或不可逆删除。AI Agent
                没有您服务器的直接密码或私钥，在您点击批准前，此命令处于拦截挂起状态。
              </span>
            ) : (
              <span>
                当前安全策略下，外部 Agent 触发了写操作。您可以单次放行，或直接切换为【全部批准】免去后续弹窗打扰。
              </span>
            )}
          </p>
        </div>

        {/* Actions Button Bar */}
        <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
          {/* Reject */}
          <button
            onClick={() => handleResolve(false)}
            disabled={isSubmitting}
            className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 rounded-xl text-[12px] font-medium border border-red-500/30 text-red-500 hover:bg-red-500/10 active:scale-95 transition-all disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            <span>{t("agent.reject")}</span>
          </button>

          {/* Approve Once */}
          <button
            onClick={() => handleResolve(true, false)}
            disabled={isSubmitting}
            className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 rounded-xl text-[12px] font-medium bg-[#007AFF] text-white hover:bg-[#007AFF]/90 active:scale-95 transition-all shadow-sm disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{t("agent.approveOnce")}</span>
          </button>

          {/* Switch to Auto & Approve */}
          <button
            onClick={() => handleResolve(true, true)}
            disabled={isSubmitting}
            title="放行本次命令，并将当前策略切换为【全部批准】（后续所有指令自动放行免打扰）"
            className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 rounded-xl text-[12px] font-medium bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 transition-all shadow-sm disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{t("agent.approveAuto")}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
