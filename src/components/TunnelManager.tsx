import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TabSession, TunnelEntry, TunnelType } from "../types";
import {
  RotateCw,
  Plus,
  Play,
  Square,
  X,
  Maximize2,
  Minimize2,
  Workflow,
  ArrowRight,
} from "lucide-react";

interface Props {
  session: TabSession;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onClose?: () => void;
}

export const TunnelManager: React.FC<Props> = ({
  session,
  isMaximized,
  onToggleMaximize,
  onClose,
}) => {
  const [tunnels, setTunnels] = useState<TunnelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New Tunnel Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTunnelType, setNewTunnelType] = useState<TunnelType>("local");
  const [newLocalPort, setNewLocalPort] = useState<string>("13306");
  const [newRemoteHost, setNewRemoteHost] = useState<string>("127.0.0.1");
  const [newRemotePort, setNewRemotePort] = useState<string>("3306");
  const [newDescription, setNewDescription] = useState<string>("MySQL 端口转发");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const activeReq = useRef(0);

  const fetchTunnels = async () => {
    if (!session.id) return;
    const reqId = ++activeReq.current;
    setLoading(true);
    setErrorMsg(null);

    try {
      const list = await invoke<TunnelEntry[]>("tunnel_list", {
        sessionId: session.id,
      });
      if (reqId === activeReq.current) {
        setTunnels(list);
      }
    } catch (err: any) {
      if (reqId === activeReq.current) {
        setErrorMsg(typeof err === "string" ? err : err.message || "获取隧道列表失败");
      }
    } finally {
      if (reqId === activeReq.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchTunnels();
  }, [session.id]);

  const handleStartTunnel = async (t: TunnelEntry) => {
    try {
      await invoke("tunnel_start", {
        sessionId: session.id,
        entry: t,
      });
      await fetchTunnels();
    } catch (err: any) {
      alert(`启动隧道失败: ${typeof err === "string" ? err : err.message || err}`);
    }
  };

  const handleStopTunnel = async (tunnelId: string) => {
    try {
      await invoke("tunnel_stop", {
        tunnelId,
      });
      await fetchTunnels();
    } catch (err: any) {
      alert(`停止隧道失败: ${typeof err === "string" ? err : err.message || err}`);
    }
  };

  const handleCreateTunnel = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    const localPortNum = parseInt(newLocalPort, 10);
    const remotePortNum = parseInt(newRemotePort, 10);

    if (isNaN(localPortNum) || localPortNum <= 0 || localPortNum > 65535) {
      setSubmitError("本地端口格式无效 (1-65535)");
      setIsSubmitting(false);
      return;
    }

    if (newTunnelType !== "dynamic") {
      if (isNaN(remotePortNum) || remotePortNum <= 0 || remotePortNum > 65535) {
        setSubmitError("远端端口格式无效 (1-65535)");
        setIsSubmitting(false);
        return;
      }
    }

    const entry: TunnelEntry = {
      id: "tun_" + Math.random().toString(36).substring(2, 9),
      session_id: session.id,
      tunnel_type: newTunnelType,
      local_port: localPortNum,
      remote_host: newTunnelType === "dynamic" ? "127.0.0.1" : newRemoteHost.trim() || "127.0.0.1",
      remote_port: newTunnelType === "dynamic" ? 0 : remotePortNum,
      status: "stopped",
      description: newDescription.trim() || `${newTunnelType} 转发 :${localPortNum}`,
    };

    try {
      await invoke("tunnel_start", {
        sessionId: session.id,
        entry,
      });
      setIsCreateModalOpen(false);
      await fetchTunnels();
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err.message || "创建并启动隧道失败";
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-app)] overflow-hidden select-none text-[12px]">
      {/* Top Controls Toolbar */}
      <div className="h-8 px-3 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between space-x-2 text-[11.5px] flex-shrink-0">
        <div className="flex items-center space-x-2 flex-1">
          <div className="flex items-center space-x-1.5 text-[var(--text-primary)] font-medium">
            <Workflow className="w-3.5 h-3.5 text-[#007AFF]" />
            <span>SSH 端口转发与隧道 (Port Forwarding & SOCKS5)</span>
          </div>

          <span className="text-[var(--text-tertiary)] text-[10.5px]">
            当前 {tunnels.filter((t) => t.status === "active").length} 条活动隧道
          </span>
        </div>

        {/* Right Tools */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          <button
            onClick={() => {
              setSubmitError(null);
              setIsCreateModalOpen(true);
            }}
            className="px-2.5 py-1 bg-[#007AFF] hover:bg-[#0062CC] text-white rounded text-[11px] font-medium flex items-center space-x-1 transition active:scale-95 shadow-xs"
          >
            <Plus className="w-3 h-3" />
            <span>新建隧道</span>
          </button>

          <button
            onClick={fetchTunnels}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            title="刷新隧道列表"
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
            <Workflow className="w-8 h-8 mx-auto opacity-50 mb-2" />
            <div className="text-[13px] font-medium">获取隧道状态异常</div>
            <div className="text-[11px] text-[var(--text-tertiary)]">{errorMsg}</div>
            <button
              onClick={fetchTunnels}
              className="mt-3 px-3 py-1 bg-[#007AFF] text-white rounded text-[11px] hover:bg-[#0062CC] transition"
            >
              重试
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-[11.5px] text-left">
            <thead className="sticky top-0 bg-[var(--bg-app)] border-b border-[var(--border-subtle)] text-[var(--text-secondary)] shadow-xs z-10 font-medium">
              <tr>
                <th className="py-1.5 px-3 w-32">隧道类型</th>
                <th className="py-1.5 px-3 w-40">本地端口 (Local)</th>
                <th className="py-1.5 px-3 w-10 text-center"></th>
                <th className="py-1.5 px-3 min-w-[160px]">远端目标 (Remote)</th>
                <th className="py-1.5 px-3 w-28">运行状态</th>
                <th className="py-1.5 px-3">描述说明</th>
                <th className="py-1.5 px-3 text-right w-28">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]/40 text-[var(--text-primary)]">
              {tunnels.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[var(--text-tertiary)]">
                    <div className="space-y-2 max-w-sm mx-auto">
                      <Workflow className="w-7 h-7 mx-auto opacity-40 text-[#007AFF]" />
                      <div className="text-[12px] font-medium text-[var(--text-secondary)]">
                        暂无配置中的 SSH 端口转发隧道
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        支持将本地端口打洞连接到远端私网数据库（-L）、反向暴露本地调试服务（-R）或开启一键动态 SOCKS5 代理（-D）。
                      </p>
                      <button
                        onClick={() => {
                          setSubmitError(null);
                          setIsCreateModalOpen(true);
                        }}
                        className="mt-2 px-3 py-1 bg-[#007AFF] text-white rounded text-[11px] hover:bg-[#0062CC] transition font-medium"
                      >
                        + 立即新建第一条隧道
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                tunnels.map((t) => {
                  const isActive = t.status === "active";
                  const isError = t.status === "error";

                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-[var(--hover-item)] transition-colors group font-mono"
                    >
                      {/* Type */}
                      <td className="py-2 px-3">
                        {t.tunnel_type === "local" ? (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#007AFF]/15 text-[#007AFF]">
                            本地转发 (-L)
                          </span>
                        ) : t.tunnel_type === "remote" ? (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-500">
                            远程转发 (-R)
                          </span>
                        ) : (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-500">
                            动态代理 (-D)
                          </span>
                        )}
                      </td>

                      {/* Local Port */}
                      <td className="py-2 px-3 font-semibold text-[var(--text-primary)]">
                        127.0.0.1:<span className="text-[#007AFF] font-bold">{t.local_port}</span>
                      </td>

                      {/* Arrow indicator */}
                      <td className="py-2 px-3 text-center text-[var(--text-tertiary)] font-sans">
                        <ArrowRight className="w-3.5 h-3.5 mx-auto opacity-70" />
                      </td>

                      {/* Remote Target */}
                      <td className="py-2 px-3 text-[var(--text-secondary)]">
                        {t.tunnel_type === "dynamic" ? (
                          <span className="text-emerald-500 font-sans font-medium">
                            本地 SOCKS5 加密代理出口
                          </span>
                        ) : (
                          <span>
                            {t.remote_host}:{t.remote_port}
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-2 px-3 font-sans">
                        {isActive ? (
                          <span className="inline-flex items-center space-x-1.5 text-[10.5px] text-emerald-500 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span>活跃运行中</span>
                          </span>
                        ) : isError ? (
                          <span
                            title={t.error_msg || "隧道异常退出"}
                            className="inline-flex items-center space-x-1.5 text-[10.5px] text-rose-500 font-medium cursor-help"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            <span>启动失败</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1.5 text-[10.5px] text-gray-400 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                            <span>已停止</span>
                          </span>
                        )}
                      </td>

                      {/* Description */}
                      <td className="py-2 px-3 font-sans text-[var(--text-secondary)] truncate max-w-[200px]">
                        {t.description || "-"}
                      </td>

                      {/* Action */}
                      <td className="py-2 px-3 text-right font-sans">
                        <div className="flex items-center justify-end space-x-1">
                          {isActive ? (
                            <button
                              onClick={() => handleStopTunnel(t.id)}
                              title="停止该隧道"
                              className="p-1 rounded text-[10.5px] hover:bg-rose-500/10 text-rose-500 hover:text-rose-600 transition"
                            >
                              <Square className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleStartTunnel(t)}
                              title="重新开启该隧道"
                              className="p-1 rounded text-[10.5px] hover:bg-emerald-500/10 text-emerald-500 hover:text-emerald-600 transition"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}
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

      {/* Create Tunnel Modal */}
      {isCreateModalOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          style={{ zIndex: 99999 }}
          onClick={() => !isSubmitting && setIsCreateModalOpen(false)}
        >
          <div
            className="w-[450px] max-w-full apple-card rounded-2xl p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] select-none animate-in zoom-in-95 duration-120"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start space-x-3">
              <div className="w-9 h-9 rounded-xl bg-[#007AFF]/15 text-[#007AFF] flex items-center justify-center flex-shrink-0">
                <Workflow className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold tracking-tight">
                  新建 SSH 端口转发隧道
                </div>
                <div className="text-[11.5px] text-[var(--text-secondary)] mt-1 truncate">
                  当前会话：<span className="font-mono text-[#007AFF]">{session.title}</span>
                </div>
              </div>
            </div>

            <form onSubmit={handleCreateTunnel} className="mt-4 space-y-3">
              {/* Type Switcher */}
              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">
                  隧道模式
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-[var(--bg-app)] rounded-lg border border-[var(--border-subtle)] text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setNewTunnelType("local");
                      setNewLocalPort("13306");
                      setNewRemoteHost("127.0.0.1");
                      setNewRemotePort("3306");
                      setNewDescription("MySQL 端口转发");
                    }}
                    className={`py-1 rounded-[6px] transition font-medium ${
                      newTunnelType === "local"
                        ? "bg-[#007AFF] text-white shadow-xs"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    本地转发 (-L)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewTunnelType("remote");
                      setNewLocalPort("8080");
                      setNewRemoteHost("127.0.0.1");
                      setNewRemotePort("8080");
                      setNewDescription("内网 Web 调试穿透");
                    }}
                    className={`py-1 rounded-[6px] transition font-medium ${
                      newTunnelType === "remote"
                        ? "bg-[#007AFF] text-white shadow-xs"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    远程转发 (-R)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewTunnelType("dynamic");
                      setNewLocalPort("1080");
                      setNewDescription("SOCKS5 动态代理出口");
                    }}
                    className={`py-1 rounded-[6px] transition font-medium ${
                      newTunnelType === "dynamic"
                        ? "bg-[#007AFF] text-white shadow-xs"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    动态代理 (-D)
                  </button>
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)] mt-1.5 leading-normal">
                  {newTunnelType === "local" &&
                    "本地打洞：在本地监听端口，通过 SSH 加密隧道直接连接远端内网的服务（如内网数据库、Redis、私有 Web）。"}
                  {newTunnelType === "remote" &&
                    "内网穿透：在服务器上监听端口，将外部请求反向转发回本地开发调试端口（如本地 Webhook 联调）。"}
                  {newTunnelType === "dynamic" &&
                    "SOCKS5 出口：在本地开启 SOCKS5 代理端口，本地浏览器或应用可通过该端口借道服务器出口访问外网。"}
                </div>
              </div>

              {/* Local Port */}
              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">
                  本地监听端口 (Local Port)
                </label>
                <input
                  type="number"
                  required
                  value={newLocalPort}
                  onChange={(e) => setNewLocalPort(e.target.value)}
                  placeholder="如: 13306 或 1080"
                  className="w-full h-7 px-2.5 text-[12px] font-mono bg-[var(--bg-app)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-lg focus:outline-none"
                />
              </div>

              {/* Remote Target (Hidden if dynamic) */}
              {newTunnelType !== "dynamic" && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">
                      目标主机地址 (Target IP)
                    </label>
                    <input
                      type="text"
                      required
                      value={newRemoteHost}
                      onChange={(e) => setNewRemoteHost(e.target.value)}
                      placeholder="127.0.0.1 或内网 IP"
                      className="w-full h-7 px-2.5 text-[12px] font-mono bg-[var(--bg-app)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-lg focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">
                      目标端口
                    </label>
                    <input
                      type="number"
                      required
                      value={newRemotePort}
                      onChange={(e) => setNewRemotePort(e.target.value)}
                      placeholder="3306"
                      className="w-full h-7 px-2.5 text-[12px] font-mono bg-[var(--bg-app)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-lg focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">
                  备注说明
                </label>
                <input
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="如: 本地直连远端 MySQL 数据库"
                  className="w-full h-7 px-2.5 text-[12px] bg-[var(--bg-app)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-lg focus:outline-none"
                />
              </div>

              {submitError && (
                <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[11px]">
                  {submitError}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-3.5 py-1.5 text-[12px] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-item)] transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 text-[12px] font-medium text-white rounded-lg shadow-sm transition active:scale-95 disabled:opacity-50 flex items-center space-x-1.5 bg-[#007AFF] hover:bg-[#0062CC]"
                >
                  {isSubmitting && <RotateCw className="w-3 h-3 animate-spin" />}
                  <span>立即启动隧道</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
