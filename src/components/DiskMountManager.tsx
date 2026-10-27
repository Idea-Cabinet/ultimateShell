import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TabSession, DiskPartition } from "../types";
import { useI18n } from "../i18n";
import { HardDrive, RotateCw, AlertTriangle, Database, Maximize2, Minimize2, X } from "lucide-react";

interface Props {
  session: TabSession;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onClose?: () => void;
}

export const DiskMountManager: React.FC<Props> = ({
  session,
  isMaximized,
  onToggleMaximize,
  onClose,
}) => {
  const { t } = useI18n();
  const [partitions, setPartitions] = useState<DiskPartition[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchDisks = async () => {
    if (!session.id) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const list = await invoke<DiskPartition[]>("get_disk_partitions", {
        sessionId: session.id,
      });
      setPartitions(list);
    } catch (err: any) {
      setErrorMsg(typeof err === "string" ? err : err.message || "获取磁盘容量失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDisks();
  }, [session.id]);

  const getBarColor = (pct: number) => {
    if (pct >= 85) return "bg-[#FF3B30]";
    if (pct >= 70) return "bg-[#FF9500]";
    return "bg-[#30D158]";
  };

  const getTextColor = (pct: number) => {
    if (pct >= 85) return "text-[#FF3B30]";
    if (pct >= 70) return "text-[#FF9500]";
    return "text-[#30D158]";
  };

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-app)] overflow-hidden select-none text-[12px]">
      {/* Top Controls Toolbar */}
      <div className="h-8 px-3 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between space-x-2 text-[11.5px] flex-shrink-0">
        <div className="flex items-center space-x-2">
          <HardDrive className="w-3.5 h-3.5 text-[#007AFF]" />
          <span className="font-semibold text-[var(--text-primary)]">
            {t("disk.title")}
          </span>
          <span className="text-[var(--text-tertiary)] text-[10.5px]">
            ({partitions.length} {t("status.filesCount", { count: partitions.length })})
          </span>
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          <button
            onClick={fetchDisks}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            title={t("disk.refresh")}
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#007AFF]" : ""}`} />
          </button>

          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
              title={isMaximized ? "还原视口高度" : "最大化面板"}
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
              title={t("common.close")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && partitions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
            <RotateCw className="w-6 h-6 animate-spin text-[#007AFF] mb-2" />
            <span>正在读取磁盘挂载点容量信息...</span>
          </div>
        ) : errorMsg ? (
          <div className="flex flex-col items-center justify-center py-16 text-rose-500">
            <AlertTriangle className="w-6 h-6 mb-2" />
            <span>{errorMsg}</span>
            <button
              onClick={fetchDisks}
              className="mt-3 px-3 py-1 bg-[#007AFF] text-white rounded text-[11px]"
            >
              重试
            </button>
          </div>
        ) : partitions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
            <span>未探测到存储挂载分区</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {partitions.map((part, idx) => {
              const isDanger = part.use_percent >= 85;

              return (
                <div
                  key={`${part.filesystem}-${idx}`}
                  className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition shadow-sm flex flex-col justify-between space-y-2.5"
                >
                  {/* Mount Point Header */}
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center space-x-1.5 font-bold text-[13px] text-[var(--text-primary)] truncate font-mono">
                        <Database className="w-3.5 h-3.5 text-[#007AFF] flex-shrink-0" />
                        <span className="truncate">{part.mount_point}</span>
                      </div>
                      <div className="text-[10.5px] text-[var(--text-tertiary)] font-mono truncate mt-0.5">
                        {part.filesystem}
                      </div>
                    </div>

                    <div className={`font-mono text-[14px] font-bold ${getTextColor(part.use_percent)}`}>
                      {part.use_percent.toFixed(0)}%
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="w-full bg-[var(--hover-item)] h-2 rounded-full overflow-hidden border border-[var(--border-subtle)]/50">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${getBarColor(part.use_percent)}`}
                      style={{ width: `${Math.min(100, Math.max(2, part.use_percent))}%` }}
                    />
                  </div>

                  {/* Capacity Numbers (Total, Used, Avail) */}
                  <div className="grid grid-cols-3 gap-1 pt-1 border-t border-[var(--border-subtle)]/40 text-[11px] font-mono">
                    <div>
                      <div className="text-[9.5px] text-[var(--text-tertiary)] font-sans">{t("disk.colTotal")}</div>
                      <div className="font-semibold text-[var(--text-primary)] mt-0.5">{part.total}</div>
                    </div>
                    <div>
                      <div className="text-[9.5px] text-[var(--text-tertiary)] font-sans">{t("disk.colUsed")}</div>
                      <div className="font-semibold text-[var(--text-secondary)] mt-0.5">{part.used}</div>
                    </div>
                    <div>
                      <div className="text-[9.5px] text-[var(--text-tertiary)] font-sans">{t("disk.colAvail")}</div>
                      <div className={`font-semibold mt-0.5 ${isDanger ? "text-rose-500" : "text-[var(--text-primary)]"}`}>
                        {part.avail}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
