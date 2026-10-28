import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useTransferManager } from "../context/TransferContext";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowUpDown,
  X,
  ChevronDown,
  ChevronUp,
  RotateCw,
  FolderOpen,
  Trash2,
  CheckCircle2,
  XCircle,
  Layers,
} from "lucide-react";

export const TransferManagerModal: React.FC = () => {
  const {
    tasks,
    isOpen,
    setIsOpen,
    isCollapsed,
    setIsCollapsed,
    cancelTransfer,
    retryTransfer,
    clearCompleted,
    removeTask,
    activeCount,
  } = useTransferManager();

  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "completed" | "error">("all");

  if (!isOpen) return null;

  const formatBytes = (bytes: number) => {
    if (bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec <= 0) return "0 B/s";
    return `${formatBytes(bytesPerSec)}/s`;
  };

  const formatDuration = (start: number, end?: number) => {
    const elapsed = Math.max(1, Math.round(((end || Date.now()) - start) / 1000));
    if (elapsed < 60) return `${elapsed}s`;
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    return `${m}m ${s}s`;
  };

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (activeFilter === "active") return t.status === "transferring" || t.status === "pending";
    if (activeFilter === "completed") return t.status === "completed";
    if (activeFilter === "error") return t.status === "error" || t.status === "cancelled";
    return true;
  });

  const activeTasks = tasks.filter((t) => t.status === "transferring" || t.status === "pending");
  const totalSpeed = activeTasks.reduce((sum, t) => sum + t.speed, 0);

  // Minimized Floating Pill docked at bottom-right
  if (isCollapsed) {
    return createPortal(
      <div
        style={{ zIndex: 9990 }}
        onClick={() => setIsCollapsed(false)}
        className="fixed bottom-9 right-6 flex items-center space-x-2.5 px-3.5 py-1.5 apple-card rounded-full shadow-2xl border border-[var(--border-subtle)] text-[12px] cursor-pointer hover:border-[#007AFF]/50 transition-all select-none animate-in fade-in slide-in-from-bottom-2 duration-120 group"
      >
        <div className="flex items-center space-x-1.5">
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center ${
              activeCount > 0 ? "bg-[#007AFF] text-white animate-pulse" : "bg-[var(--hover-item)] text-emerald-500"
            }`}
          >
            {activeCount > 0 ? (
              <ArrowUpDown className="w-3 h-3 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3 h-3" />
            )}
          </div>
          <span className="font-medium text-[var(--text-primary)]">
            {activeCount > 0
              ? `${activeCount} 项传输中 · ${formatSpeed(totalSpeed)}`
              : `传输任务 (${tasks.length})`}
          </span>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsCollapsed(false);
          }}
          title="展开传输管理器"
          className="p-0.5 rounded text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] transition"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>,
      document.body
    );
  }

  // Expanded Window Modal
  return createPortal(
    <div
      style={{ zIndex: 9990 }}
      className="fixed bottom-9 right-6 w-[520px] max-w-[92vw] max-h-[460px] apple-card rounded-2xl shadow-2xl border border-[var(--border-subtle)] text-[12px] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-120 select-none text-[var(--text-primary)]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-[#007AFF]/15 text-[#007AFF] flex items-center justify-center">
            <ArrowUpDown className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-[13px] flex items-center space-x-2">
              <span>文件传输管理</span>
              {activeCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#007AFF]/20 text-[#007AFF] font-medium animate-pulse">
                  {activeCount} 进行中
                </span>
              )}
            </div>
            <div className="text-[10.5px] text-[var(--text-tertiary)]">
              {activeCount > 0
                ? `总实时传输速率: ${formatSpeed(totalSpeed)}`
                : tasks.length === 0
                ? "暂无正在进行的任务"
                : `共记录 ${tasks.length} 项传输`}
            </div>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center space-x-1">
          {tasks.some((t) => t.status === "completed" || t.status === "cancelled" || t.status === "error") && (
            <button
              type="button"
              onClick={clearCompleted}
              title="清除已完成与已停止的任务记录"
              className="px-2 py-1 text-[11px] text-[var(--text-tertiary)] hover:text-rose-500 hover:bg-rose-500/10 rounded-md transition flex items-center space-x-1 mr-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>清空完成</span>
            </button>
          )}

          {/* Minimize / Collapse */}
          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            title="收起为底部浮动标签"
            className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition"
          >
            <ChevronDown className="w-4 h-4" />
          </button>

          {/* Close */}
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            title="关闭窗口"
            className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="px-3 py-1.5 bg-[var(--bg-app)] border-b border-[var(--border-subtle)] flex items-center space-x-1 text-[11px]">
        <button
          type="button"
          onClick={() => setActiveFilter("all")}
          className={`px-2.5 py-0.8 rounded-md transition ${
            activeFilter === "all"
              ? "bg-[var(--hover-item)] text-[var(--text-primary)] font-semibold shadow-xs"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          }`}
        >
          全部 ({tasks.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter("active")}
          className={`px-2.5 py-0.8 rounded-md transition ${
            activeFilter === "active"
              ? "bg-[var(--hover-item)] text-[#007AFF] font-semibold shadow-xs"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          }`}
        >
          传输中 ({tasks.filter((t) => t.status === "transferring" || t.status === "pending").length})
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter("completed")}
          className={`px-2.5 py-0.8 rounded-md transition ${
            activeFilter === "completed"
              ? "bg-[var(--hover-item)] text-emerald-500 font-semibold shadow-xs"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          }`}
        >
          已完成 ({tasks.filter((t) => t.status === "completed").length})
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter("error")}
          className={`px-2.5 py-0.8 rounded-md transition ${
            activeFilter === "error"
              ? "bg-[var(--hover-item)] text-rose-500 font-semibold shadow-xs"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          }`}
        >
          失败/取消 ({tasks.filter((t) => t.status === "error" || t.status === "cancelled").length})
        </button>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 divide-y divide-[var(--border-subtle)]/40 min-h-48 max-h-72">
        {filteredTasks.length === 0 ? (
          <div className="py-14 text-center text-[var(--text-tertiary)] flex flex-col items-center justify-center space-y-2">
            <Layers className="w-6 h-6 opacity-40" />
            <div className="text-[12px] font-medium">没有对应的文件传输记录</div>
            <div className="text-[10.5px] max-w-[320px] text-[var(--text-tertiary)] leading-relaxed">
              在文件树右键点击「下载」或将本地文件直接拖拽进窗口即可发起传输。
            </div>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const isDownload = task.type === "download";
            const isTransferring = task.status === "transferring" || task.status === "pending";
            const isCompleted = task.status === "completed";
            const isError = task.status === "error";
            const isCancelled = task.status === "cancelled";

            return (
              <div key={task.id} className="pt-2 first:pt-0">
                <div className="p-2.5 rounded-xl bg-[var(--bg-app)] hover:bg-[var(--hover-item)]/70 border border-[var(--border-subtle)] transition">
                  <div className="flex items-start justify-between space-x-2.5">
                    {/* Icon */}
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-white ${
                        isDownload ? "bg-emerald-500/90" : "bg-[#007AFF]"
                      }`}
                    >
                      {isDownload ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>

                    {/* Middle Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span
                          className="font-medium text-[12.5px] truncate max-w-[280px]"
                          title={task.fileName}
                        >
                          {task.fileName}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                          {isTransferring
                            ? formatSpeed(task.speed)
                            : isCompleted
                            ? `已完成 · ${formatDuration(task.startTime, task.endTime)}`
                            : isCancelled
                            ? "已取消"
                            : "失败"}
                        </span>
                      </div>

                      {/* Path tooltip */}
                      <div
                        className="text-[10px] font-mono text-[var(--text-tertiary)] truncate mt-0.5"
                        title={`${task.srcPath} -> ${task.destPath}`}
                      >
                        {isDownload ? `来自: ${task.hostName}` : `发往: ${task.hostName}`} ·{" "}
                        <span className="opacity-75">{task.destPath.split("/").pop()}</span>
                      </div>

                      {/* Progress Bar */}
                      <div className="mt-2 flex items-center space-x-2">
                        <div className="flex-1 h-1.5 rounded-full bg-[var(--hover-item)] overflow-hidden">
                          <div
                            style={{ width: `${task.progress}%` }}
                            className={`h-full rounded-full transition-all duration-150 ${
                              isCompleted
                                ? "bg-emerald-500"
                                : isError || isCancelled
                                ? "bg-rose-500"
                                : "bg-[#007AFF]"
                            }`}
                          />
                        </div>
                        <span className="text-[10px] font-mono font-medium text-[var(--text-secondary)] min-w-[32px] text-right">
                          {task.progress}%
                        </span>
                      </div>

                      {/* Status / Error description */}
                      <div className="flex items-center justify-between mt-1 text-[10px] text-[var(--text-tertiary)]">
                        <span>
                          {task.totalSize > 0
                            ? `${formatBytes(task.transferredSize)} / ${formatBytes(task.totalSize)}`
                            : formatBytes(task.transferredSize)}
                        </span>
                        {task.errorMsg && (
                          <span className="text-rose-500 truncate max-w-[200px]" title={task.errorMsg}>
                            {task.errorMsg}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-1 flex-shrink-0 self-center">
                      {isTransferring && (
                        <button
                          type="button"
                          onClick={() => cancelTransfer(task.id)}
                          title="取消传输"
                          className="p-1 rounded text-[var(--text-tertiary)] hover:text-rose-500 hover:bg-rose-500/10 transition"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}

                      {isCompleted && isDownload && (
                        <button
                          type="button"
                          onClick={() => {
                            revealItemInDir(task.destPath).catch(() => {
                              openPath(task.destPath.substring(0, task.destPath.lastIndexOf("/")));
                            });
                          }}
                          title="在访达 (Finder) 中显示此下载文件"
                          className="p-1 rounded text-[var(--text-tertiary)] hover:text-[#007AFF] hover:bg-[#007AFF]/10 transition"
                        >
                          <FolderOpen className="w-4 h-4" />
                        </button>
                      )}

                      {(isError || isCancelled) && (
                        <button
                          type="button"
                          onClick={() => retryTransfer(task.id)}
                          title="重试此传输"
                          className="p-1 rounded text-[var(--text-tertiary)] hover:text-[#007AFF] hover:bg-[#007AFF]/10 transition"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {!isTransferring && (
                        <button
                          type="button"
                          onClick={() => removeTask(task.id)}
                          title="删除此记录"
                          className="p-1 rounded text-[var(--text-tertiary)] hover:text-rose-500 hover:bg-rose-500/10 transition"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>,
    document.body
  );
};
