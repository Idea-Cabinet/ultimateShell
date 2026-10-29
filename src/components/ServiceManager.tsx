import React, { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TabSession, SystemdService } from "../types";
import { useI18n } from "../i18n";
import {
  Search,
  RotateCw,
  X,
  Play,
  Square,
  RefreshCw,
  FileText,
  Server,
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

type StatusFilter = "all" | "active" | "inactive" | "failed";

export const ServiceManager: React.FC<Props> = ({
  session,
  isMaximized,
  onToggleMaximize,
  onClose,
}) => {
  const { t } = useI18n();
  const [services, setServices] = useState<SystemdService[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Action Loading state per service
  const [actionLoading, setActionLoading] = useState<{ [name: string]: string }>({});

  // Status Log Modal
  const [statusModal, setStatusModal] = useState<{
    serviceName: string;
    output: string;
    loading: boolean;
  } | null>(null);

  const activeReq = useRef(0);

  const fetchServices = async () => {
    if (!session.id) return;
    const reqId = ++activeReq.current;
    setLoading(true);
    setErrorMsg(null);

    try {
      const list = await invoke<SystemdService[]>("get_systemd_services", {
        sessionId: session.id,
      });
      if (reqId === activeReq.current) {
        setServices(list);
      }
    } catch (err: any) {
      if (reqId === activeReq.current) {
        setErrorMsg(typeof err === "string" ? err : err.message || t("service.unavailable"));
      }
    } finally {
      if (reqId === activeReq.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchServices();
  }, [session.id]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchServices, 4000);
    return () => clearInterval(timer);
  }, [autoRefresh, session.id]);

  const handleServiceAction = async (serviceName: string, action: "start" | "stop" | "restart") => {
    setActionLoading((prev) => ({ ...prev, [serviceName]: action }));
    try {
      await invoke("systemd_control_service", {
        sessionId: session.id,
        name: serviceName,
        action,
      });
      await fetchServices();
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err.message || t("common.failed");
      alert(`${t("common.failed")}: ${msg}`);
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[serviceName];
        return next;
      });
    }
  };

  const handleViewStatus = async (serviceName: string) => {
    setStatusModal({ serviceName, output: "", loading: true });
    try {
      const output = await invoke<string>("systemd_service_status", {
        sessionId: session.id,
        name: serviceName,
      });
      setStatusModal({ serviceName, output, loading: false });
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err.message || t("common.failed");
      setStatusModal({ serviceName, output: `${t("common.failed")}: ${msg}`, loading: false });
    }
  };

  const filteredServices = useMemo(() => {
    let result = services;

    // Filter by status tab
    if (statusFilter === "active") {
      result = result.filter((s) => s.active === "active");
    } else if (statusFilter === "inactive") {
      result = result.filter((s) => s.active === "inactive");
    } else if (statusFilter === "failed") {
      result = result.filter((s) => s.active === "failed");
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
    }

    return result;
  }, [services, statusFilter, searchQuery]);

  const counts = useMemo(() => {
    let active = 0;
    let failed = 0;
    let inactive = 0;
    services.forEach((s) => {
      if (s.active === "active") active++;
      else if (s.active === "failed") failed++;
      else inactive++;
    });
    return { all: services.length, active, failed, inactive };
  }, [services]);

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
              placeholder={t("service.searchPlaceholder")}
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

          {/* Status Filter Tabs */}
          <div className="flex items-center bg-[var(--bg-app)] rounded p-0.5 border border-[var(--border-subtle)] text-[10.5px]">
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-2 py-0.5 rounded transition ${
                statusFilter === "all"
                  ? "bg-[#007AFF] text-white font-medium"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t("common.all")} ({counts.all})
            </button>
            <button
              onClick={() => setStatusFilter("active")}
              className={`px-2 py-0.5 rounded transition flex items-center space-x-1 ${
                statusFilter === "active"
                  ? "bg-emerald-500 text-white font-medium"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span>{t("service.running")} ({counts.active})</span>
            </button>
            <button
              onClick={() => setStatusFilter("inactive")}
              className={`px-2 py-0.5 rounded transition ${
                statusFilter === "inactive"
                  ? "bg-gray-500 text-white font-medium"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t("service.stopped")} ({counts.inactive})
            </button>
            {counts.failed > 0 && (
              <button
                onClick={() => setStatusFilter("failed")}
                className={`px-2 py-0.5 rounded transition flex items-center space-x-1 ${
                  statusFilter === "failed"
                    ? "bg-rose-500 text-white font-medium"
                    : "text-rose-500 hover:bg-rose-500/10"
                }`}
              >
                <span>{t("service.failedStatus")} ({counts.failed})</span>
              </button>
            )}
          </div>
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
            <span>{t("process.autoRefresh")} (4s)</span>
          </label>

          <button
            onClick={fetchServices}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            title={t("service.refresh")}
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#007AFF]" : ""}`} />
          </button>

          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
              title={isMaximized ? t("common.restore") : t("common.maximize")}
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

      {/* Main Table View */}
      <div className="flex-1 overflow-auto bg-[var(--bg-card)]">
        {errorMsg ? (
          <div className="p-8 text-center text-[var(--text-secondary)] space-y-2">
            <Server className="w-8 h-8 mx-auto opacity-50 mb-2 text-amber-500" />
            <div className="text-[13px] font-medium text-[var(--text-primary)]">{t("service.unavailable")}</div>
            <div className="text-[11px] text-[var(--text-tertiary)] max-w-md mx-auto">{errorMsg}</div>
            <button
              onClick={fetchServices}
              className="mt-3 px-3 py-1 bg-[#007AFF] text-white rounded text-[11px] hover:bg-[#0062CC] transition"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-[11.5px] text-left">
            <thead className="sticky top-0 bg-[var(--bg-app)] border-b border-[var(--border-subtle)] text-[var(--text-secondary)] shadow-xs z-10 font-medium">
              <tr>
                <th className="py-1.5 px-3 min-w-[200px]">{t("service.colName")}</th>
                <th className="py-1.5 px-3 w-28">{t("service.colStatus")}</th>
                <th className="py-1.5 px-3 w-24">{t("service.colEnable")}</th>
                <th className="py-1.5 px-3">{t("service.colDesc")}</th>
                <th className="py-1.5 px-3 text-right w-44">{t("service.action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]/40 text-[var(--text-primary)]">
              {filteredServices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[var(--text-tertiary)]">
                    {loading ? (
                      <div className="flex items-center justify-center space-x-2">
                        <RotateCw className="w-4 h-4 animate-spin text-[#007AFF]" />
                        <span>{t("service.querying")}</span>
                      </div>
                    ) : (
                      t("service.empty")
                    )}
                  </td>
                </tr>
              ) : (
                filteredServices.map((s) => {
                  const isActive = s.active === "active";
                  const isFailed = s.active === "failed";
                  const isBusy = !!actionLoading[s.name];

                  return (
                    <tr
                      key={s.name}
                      className="hover:bg-[var(--hover-item)] transition-colors group"
                    >
                      {/* Name */}
                      <td className="py-1.5 px-3 font-mono font-medium text-[var(--text-primary)]">
                        <span className="text-[#007AFF]">{s.name}</span>
                      </td>

                      {/* Active Status Badge */}
                      <td className="py-1.5 px-3">
                        {isActive ? (
                          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-500 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span>running</span>
                          </span>
                        ) : isFailed ? (
                          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-rose-500/15 text-rose-500 font-medium animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            <span>failed</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-500/15 text-gray-500 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                            <span>inactive</span>
                          </span>
                        )}
                      </td>

                      {/* Sub state */}
                      <td className="py-1.5 px-3 font-mono text-[10.5px] text-[var(--text-secondary)]">
                        {s.sub}
                      </td>

                      {/* Description */}
                      <td className="py-1.5 px-3 text-[var(--text-secondary)] truncate max-w-[320px]">
                        {s.description || "-"}
                      </td>

                      {/* Control Actions */}
                      <td className="py-1.5 px-3 text-right">
                        <div className="flex items-center justify-end space-x-1 opacity-90 group-hover:opacity-100">
                          {isActive ? (
                            <>
                              <button
                                onClick={() => handleServiceAction(s.name, "restart")}
                                disabled={isBusy}
                                title={t("service.restart")}
                                className="p-1 rounded text-[10.5px] hover:bg-[var(--hover-item)] text-[#007AFF] hover:text-[#0062CC] transition disabled:opacity-40"
                              >
                                {isBusy && actionLoading[s.name] === "restart" ? (
                                   <RotateCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-3 h-3" />
                                )}
                              </button>
                              <button
                                onClick={() => handleServiceAction(s.name, "stop")}
                                disabled={isBusy}
                                title={t("service.stop")}
                                className="p-1 rounded text-[10.5px] hover:bg-rose-500/10 text-rose-500 hover:text-rose-600 transition disabled:opacity-40"
                              >
                                {isBusy && actionLoading[s.name] === "stop" ? (
                                  <RotateCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Square className="w-3 h-3" />
                                )}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleServiceAction(s.name, "start")}
                              disabled={isBusy}
                              title={t("service.start")}
                              className="p-1 rounded text-[10.5px] hover:bg-emerald-500/10 text-emerald-500 hover:text-emerald-600 transition disabled:opacity-40"
                            >
                              {isBusy && actionLoading[s.name] === "start" ? (
                                <RotateCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Play className="w-3 h-3" />
                              )}
                            </button>
                          )}

                          <button
                            onClick={() => handleViewStatus(s.name)}
                            title={t("service.logsTitle", { name: s.name })}
                            className="p-1 rounded text-[10.5px] hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
                          >
                            <FileText className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Service Status & Logs Detail Modal */}
      {statusModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          style={{ zIndex: 99999 }}
          onClick={() => setStatusModal(null)}
        >
          <div
            className="w-[680px] max-w-full apple-card rounded-2xl p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] select-none animate-in zoom-in-95 duration-120 flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
              <div className="flex items-center space-x-2">
                <Server className="w-4 h-4 text-[#007AFF]" />
                <span className="font-semibold text-[13px] font-mono">
                  {t("service.logsTitle", { name: statusModal.serviceName })}
                </span>
              </div>
              <button
                onClick={() => setStatusModal(null)}
                className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto mt-3 p-3 bg-black/90 text-emerald-400 font-mono text-[11px] rounded-xl border border-white/10 whitespace-pre-wrap leading-relaxed select-text">
              {statusModal.loading ? (
                <div className="flex items-center justify-center py-10 space-x-2 text-white/70">
                  <RotateCw className="w-4 h-4 animate-spin text-[#007AFF]" />
                  <span>{t("service.fetchingLogs")}</span>
                </div>
              ) : (
                statusModal.output || t("service.noOutput")
              )}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-4">
              <button
                type="button"
                onClick={() => handleViewStatus(statusModal.serviceName)}
                className="px-3 py-1.5 text-[11.5px] rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--hover-item)] transition flex items-center space-x-1"
              >
                <RotateCw className="w-3 h-3" />
                <span>{t("service.refreshStatus")}</span>
              </button>
              <button
                type="button"
                onClick={() => setStatusModal(null)}
                className="px-4 py-1.5 text-[11.5px] font-medium text-white rounded-lg bg-[#007AFF] hover:bg-[#0062CC] transition"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
