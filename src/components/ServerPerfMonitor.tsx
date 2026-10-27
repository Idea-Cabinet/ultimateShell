import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TabSession, SystemPerfStats } from "../types";
import { Cpu, Layers, Network, HardDrive, Activity } from "lucide-react";

interface Props {
  activeSession?: TabSession;
  height: number;
  onHeightChange: (h: number) => void;
}

// Sparkline SVG renderer with smooth area gradient fill
const Sparkline: React.FC<{
  data: number[];
  color: string;
  fillColor?: string;
  maxVal?: number;
  height?: number;
}> = ({ data, color, fillColor, maxVal, height = 24 }) => {
  const width = 80;
  if (data.length < 2) {
    return <div style={{ height: `${height}px`, width: `${width}px` }} />;
  }

  const computedMax = maxVal || Math.max(...data, 1);
  const stepX = width / (data.length - 1);

  const points = data.map((val, idx) => {
    const x = idx * stepX;
    const clamped = Math.max(0, Math.min(val, computedMax));
    const y = height - (clamped / computedMax) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(" L ")}`;
  const areaD = `M ${points[0]} L ${points.join(" L ")} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible flex-shrink-0"
    >
      <defs>
        <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillColor || color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={fillColor || color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#grad-${color.replace("#", "")})`} />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const ServerPerfMonitor: React.FC<Props> = ({
  activeSession,
  height,
  onHeightChange,
}) => {
  const [stats, setStats] = useState<SystemPerfStats>({
    cpu_usage: 0,
    mem_percent: 0,
    mem_used_gb: 0,
    mem_total_gb: 0,
    net_rx_kbs: 0,
    net_tx_kbs: 0,
    io_read_kbs: 0,
    io_write_kbs: 0,
    load_1m: 0,
  });

  // Sparkline history buffers (keep last 16 points)
  const [cpuHistory, setCpuHistory] = useState<number[]>(() => Array(16).fill(0));
  const [ramHistory, setRamHistory] = useState<number[]>(() => Array(16).fill(0));
  const [netRxHistory, setNetRxHistory] = useState<number[]>(() => Array(16).fill(0));
  const [ioHistory, setIoHistory] = useState<number[]>(() => Array(16).fill(0));

  // Reset or initialize histories on session change
  useEffect(() => {
    setCpuHistory(Array(16).fill(0));
    setRamHistory(Array(16).fill(0));
    setNetRxHistory(Array(16).fill(0));
    setIoHistory(Array(16).fill(0));
  }, [activeSession?.id]);

  useEffect(() => {
    if (!activeSession?.id) return;

    let disposed = false;
    const fetchPerf = async () => {
      try {
        const res = await invoke<SystemPerfStats>("get_system_perf", {
          sessionId: activeSession.id,
        });
        if (disposed) return;
        setStats(res);
        setCpuHistory((prev) => [...prev.slice(1), res.cpu_usage]);
        setRamHistory((prev) => [...prev.slice(1), res.mem_percent]);
        setNetRxHistory((prev) => [...prev.slice(1), res.net_rx_kbs + res.net_tx_kbs]);
        setIoHistory((prev) => [...prev.slice(1), res.io_read_kbs + res.io_write_kbs]);
      } catch (_) {}
    };

    fetchPerf();
    const timer = setInterval(fetchPerf, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [activeSession?.id]);

  // Resizable top border handle
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;

    const onPointerMove = (ev: PointerEvent) => {
      const deltaY = startY - ev.clientY; // drag up -> increase height
      const nextH = Math.min(Math.max(120, startH + deltaY), 420);
      onHeightChange(nextH);
      localStorage.setItem("ultimateshell_sidebar_perf_height", nextH.toString());
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const formatRate = (kbs: number) => {
    if (kbs >= 1024) {
      return `${(kbs / 1024).toFixed(1)} MB/s`;
    }
    return `${kbs.toFixed(1)} KB/s`;
  };

  const isCompact = height < 190;

  return (
    <div
      style={{ height: `${height}px` }}
      className="border-t border-[var(--border-subtle)] bg-[var(--bg-card)] flex flex-col flex-shrink-0 relative select-none overflow-hidden"
    >
      {/* Draggable Top Border Handle */}
      <div
        onPointerDown={handlePointerDown}
        onDoubleClick={() => onHeightChange(200)}
        title="双击重置高度，按住上下拖拽调整性能看板高度"
        className="h-1.5 w-full cursor-row-resize hover:bg-[#007AFF] active:bg-[#007AFF] transition-colors flex items-center justify-center group flex-shrink-0 relative z-20"
      >
        <div className="w-8 h-[2px] rounded-full bg-[var(--text-tertiary)] opacity-30 group-hover:opacity-100 group-hover:bg-white transition-opacity" />
      </div>

      {/* Header with Server Title & Live Status */}
      <div className="px-3 py-1.5 flex items-center justify-between text-[11px] border-b border-[var(--border-subtle)]/50 flex-shrink-0">
        <div className="flex items-center space-x-1.5 truncate">
          <Activity className="w-3.5 h-3.5 text-[#007AFF] flex-shrink-0" />
          <span className="font-semibold text-[var(--text-primary)] tracking-tight truncate">
            {activeSession
              ? activeSession.isLocal
                ? "本地系统性能"
                : `${activeSession.title} 性能`
              : "未连接终端"}
          </span>
        </div>
        <div className="flex items-center space-x-1 flex-shrink-0 text-[10px] text-[var(--text-tertiary)] font-mono">
          <span className={`w-1.5 h-1.5 rounded-full ${activeSession?.connected ? "bg-[#30D158] animate-pulse" : "bg-zinc-400"}`} />
          <span>实时监控</span>
        </div>
      </div>

      {/* Performance Metrics & Visual Charts */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 no-scrollbar">
        {isCompact ? (
          /* Compact 2x2 Grid View */
          <div className="grid grid-cols-2 gap-1.5 h-full">
            {/* CPU */}
            <div className="p-2 rounded-lg bg-[var(--hover-item)] border border-[var(--border-subtle)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
                <span className="flex items-center space-x-1">
                  <Cpu className="w-3 h-3 text-[#007AFF]" />
                  <span>CPU</span>
                </span>
                <span className="font-mono text-[var(--text-primary)] font-semibold">
                  {stats.cpu_usage.toFixed(0)}%
                </span>
              </div>
              <div className="w-full bg-[var(--border-subtle)] h-1 rounded-full overflow-hidden mt-1.5">
                <div
                  className="bg-[#007AFF] h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, stats.cpu_usage))}%` }}
                />
              </div>
            </div>

            {/* RAM */}
            <div className="p-2 rounded-lg bg-[var(--hover-item)] border border-[var(--border-subtle)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
                <span className="flex items-center space-x-1">
                  <Layers className="w-3 h-3 text-[#BF5AF2]" />
                  <span>RAM</span>
                </span>
                <span className="font-mono text-[var(--text-primary)] font-semibold">
                  {stats.mem_percent.toFixed(0)}%
                </span>
              </div>
              <div className="w-full bg-[var(--border-subtle)] h-1 rounded-full overflow-hidden mt-1.5">
                <div
                  className="bg-[#BF5AF2] h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, stats.mem_percent))}%` }}
                />
              </div>
            </div>

            {/* Network */}
            <div className="p-2 rounded-lg bg-[var(--hover-item)] border border-[var(--border-subtle)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
                <span className="flex items-center space-x-1">
                  <Network className="w-3 h-3 text-[#30D158]" />
                  <span>网络</span>
                </span>
                <span className="font-mono text-[9px] text-[#30D158]">
                  ↓{formatRate(stats.net_rx_kbs)}
                </span>
              </div>
              <div className="font-mono text-[9px] text-[var(--text-tertiary)] text-right">
                ↑{formatRate(stats.net_tx_kbs)}
              </div>
            </div>

            {/* Disk IO */}
            <div className="p-2 rounded-lg bg-[var(--hover-item)] border border-[var(--border-subtle)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
                <span className="flex items-center space-x-1">
                  <HardDrive className="w-3 h-3 text-[#FF9500]" />
                  <span>IO</span>
                </span>
                <span className="font-mono text-[9px] text-[#FF9500]">
                  R:{formatRate(stats.io_read_kbs)}
                </span>
              </div>
              <div className="font-mono text-[9px] text-[var(--text-tertiary)] text-right">
                W:{formatRate(stats.io_write_kbs)}
              </div>
            </div>
          </div>
        ) : (
          /* Expanded Visual Charts View with Sparkline Graphs */
          <div className="space-y-1.5">
            {/* CPU Row with Sparkline */}
            <div className="p-2 rounded-lg bg-[var(--hover-item)] border border-[var(--border-subtle)] flex items-center justify-between">
              <div className="flex flex-col min-w-[70px]">
                <div className="flex items-center space-x-1 text-[11px] font-medium text-[var(--text-primary)]">
                  <Cpu className="w-3.5 h-3.5 text-[#007AFF]" />
                  <span>CPU</span>
                </div>
                <div className="font-mono text-[13px] font-bold text-[var(--text-primary)] mt-0.5">
                  {stats.cpu_usage.toFixed(1)}%
                </div>
                <div className="text-[9.5px] text-[var(--text-tertiary)] font-mono">
                  负载 {stats.load_1m.toFixed(2)}
                </div>
              </div>
              <Sparkline data={cpuHistory} color="#007AFF" maxVal={100} height={26} />
            </div>

            {/* RAM Row with Sparkline */}
            <div className="p-2 rounded-lg bg-[var(--hover-item)] border border-[var(--border-subtle)] flex items-center justify-between">
              <div className="flex flex-col min-w-[70px]">
                <div className="flex items-center space-x-1 text-[11px] font-medium text-[var(--text-primary)]">
                  <Layers className="w-3.5 h-3.5 text-[#BF5AF2]" />
                  <span>RAM</span>
                </div>
                <div className="font-mono text-[13px] font-bold text-[var(--text-primary)] mt-0.5">
                  {stats.mem_percent.toFixed(1)}%
                </div>
                <div className="text-[9.5px] text-[var(--text-tertiary)] font-mono">
                  {stats.mem_used_gb.toFixed(1)}G / {stats.mem_total_gb.toFixed(1)}G
                </div>
              </div>
              <Sparkline data={ramHistory} color="#BF5AF2" maxVal={100} height={26} />
            </div>

            {/* Network Row with Sparkline */}
            <div className="p-2 rounded-lg bg-[var(--hover-item)] border border-[var(--border-subtle)] flex items-center justify-between">
              <div className="flex flex-col min-w-[85px]">
                <div className="flex items-center space-x-1 text-[11px] font-medium text-[var(--text-primary)]">
                  <Network className="w-3.5 h-3.5 text-[#30D158]" />
                  <span>网络流量</span>
                </div>
                <div className="font-mono text-[10px] text-[#30D158] mt-1 flex items-center space-x-1">
                  <span>↓</span>
                  <span>{formatRate(stats.net_rx_kbs)}</span>
                </div>
                <div className="font-mono text-[10px] text-[#007AFF] flex items-center space-x-1">
                  <span>↑</span>
                  <span>{formatRate(stats.net_tx_kbs)}</span>
                </div>
              </div>
              <Sparkline data={netRxHistory} color="#30D158" height={26} />
            </div>

            {/* Disk IO Row with Sparkline */}
            <div className="p-2 rounded-lg bg-[var(--hover-item)] border border-[var(--border-subtle)] flex items-center justify-between">
              <div className="flex flex-col min-w-[85px]">
                <div className="flex items-center space-x-1 text-[11px] font-medium text-[var(--text-primary)]">
                  <HardDrive className="w-3.5 h-3.5 text-[#FF9500]" />
                  <span>磁盘 IO</span>
                </div>
                <div className="font-mono text-[10px] text-[var(--text-secondary)] mt-1">
                  读 {formatRate(stats.io_read_kbs)}
                </div>
                <div className="font-mono text-[10px] text-[var(--text-tertiary)]">
                  写 {formatRate(stats.io_write_kbs)}
                </div>
              </div>
              <Sparkline data={ioHistory} color="#FF9500" height={26} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
