import React, { useState } from "react";
import { HostProfile } from "../types";
import { ThemeMode } from "../hooks/useTheme";
import { ThemeSelector } from "./ThemeSelector";
import {
  Server,
  Plus,
  Search,
  ArrowDownToLine,
  ChevronRight,
  Terminal,
  Trash2,
  SlidersHorizontal,
  Folder,
  Activity,
  HardDrive,
  Cpu,
  Layers,
  Network,
  PanelLeftClose,
} from "lucide-react";

interface Props {
  hosts: HostProfile[];
  width: number;
  isCollapsed: boolean;
  themeMode: ThemeMode;
  onWidthChange: (w: number) => void;
  onCollapse: (collapsed: boolean) => void;
  onThemeChange: (mode: ThemeMode) => void;
  onConnect: (host: HostProfile) => void;
  onEdit: (host: HostProfile) => void;
  onDelete: (id: string) => void;
  onNewHost: () => void;
  onImportFinalShell: () => void;
  onRunQuickCommand: (cmd: string) => void;
}

export const Sidebar: React.FC<Props> = ({
  hosts,
  width,
  isCollapsed,
  themeMode,
  onWidthChange,
  onCollapse,
  onThemeChange,
  onConnect,
  onEdit,
  onDelete,
  onNewHost,
  onImportFinalShell,
  onRunQuickCommand,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onPointerMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      let newWidth = startWidth + delta;
      if (newWidth < 160) {
        onCollapse(true);
        return;
      }
      onCollapse(false);
      if (newWidth < 200) newWidth = 200;
      if (newWidth > 420) newWidth = 420;
      onWidthChange(newWidth);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const filteredHosts = hosts.filter(
    (h) =>
      h.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      h.host.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (h.group && h.group.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const groups: Record<string, HostProfile[]> = {};
  filteredHosts.forEach((h) => {
    const g = h.group || "默认分组";
    if (!groups[g]) groups[g] = [];
    groups[g].push(h);
  });

  const quickCommands = [
    { label: "性能", icon: Activity, cmd: "htop\n" },
    { label: "磁盘", icon: HardDrive, cmd: "df -h\n" },
    { label: "内存", icon: Cpu, cmd: "free -m\n" },
    { label: "容器", icon: Layers, cmd: "docker ps\n" },
    { label: "端口", icon: Network, cmd: "ss -tuln\n" },
  ];

  if (isCollapsed) return null;

  return (
    <aside
      style={{ width: `${width}px` }}
      className="relative h-full apple-vibrancy-sidebar border-r border-[var(--border-subtle)] flex flex-col select-none text-[var(--text-primary)] z-20 flex-shrink-0 transition-[width] duration-75"
    >
      {/* macOS Unified Titlebar Drag Region & Traffic Lights clearance */}
      <div
        data-tauri-drag-region
        className="h-12 flex items-center justify-between px-3 pl-[78px] border-b border-[var(--border-subtle)] select-none flex-shrink-0"
      >
        <div className="flex items-center space-x-2 truncate">
          <Terminal className="w-3.5 h-3.5 text-[var(--text-secondary)]" strokeWidth={1.75} />
          <span className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--text-primary)] truncate">
            UltimateShell
          </span>
        </div>

        <div className="flex items-center space-x-0.5">
          <button
            onClick={onImportFinalShell}
            title="从 FinalShell 导入主机"
            className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition active:scale-[0.95]"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          <button
            onClick={onNewHost}
            title="新建服务器连接"
            className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition active:scale-[0.95]"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
          <button
            onClick={() => onCollapse(true)}
            title="收起侧边栏 (Cmd+B)"
            className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition active:scale-[0.95]"
          >
            <PanelLeftClose className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* macOS Search Bar */}
      <div className="px-2.5 py-2 flex-shrink-0">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-[var(--text-tertiary)] pointer-events-none" strokeWidth={1.75} />
          <input
            type="text"
            placeholder="搜索连接..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1 text-[12px] bg-[var(--input-bg)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] border border-[var(--border-subtle)] rounded-md focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 transition-all font-normal"
          />
        </div>
      </div>

      {/* Server Tree List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-3">
        {Object.keys(groups).length === 0 ? (
          <div className="text-center py-12 px-4 space-y-2">
            <Server className="w-7 h-7 mx-auto text-[var(--text-tertiary)]" strokeWidth={1.5} />
            <p className="text-[12px] text-[var(--text-secondary)] font-medium">无服务器连接</p>
            <p className="text-[11px] text-[var(--text-tertiary)]">点击右上角 + 或 导入按钮</p>
          </div>
        ) : (
          Object.entries(groups).map(([groupName, groupHosts]) => {
            const isGroupCollapsed = !!collapsedGroups[groupName];
            return (
              <div key={groupName} className="space-y-0.5">
                {/* macOS Section Header */}
                <div
                  onClick={() => toggleGroup(groupName)}
                  className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold tracking-wider text-[var(--text-tertiary)] uppercase cursor-pointer rounded-md hover:bg-[var(--hover-item)] transition group"
                >
                  <div className="flex items-center space-x-1.5 truncate">
                    <ChevronRight
                      className={`w-3 h-3 text-[var(--text-tertiary)] transition-transform duration-200 ${
                        isGroupCollapsed ? "" : "rotate-90 text-[var(--text-secondary)]"
                      }`}
                      strokeWidth={2}
                    />
                    <Folder className="w-3 h-3 text-[var(--text-tertiary)]" strokeWidth={1.5} />
                    <span className="tracking-tight normal-case text-[var(--text-secondary)] font-medium truncate">{groupName}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-tertiary)] font-mono ml-1">
                    {groupHosts.length}
                  </span>
                </div>

                {/* macOS Rounded Item Pill */}
                {!isGroupCollapsed && (
                  <div className="space-y-0.5 pl-1.5">
                    {groupHosts.map((host) => (
                      <div
                        key={host.id}
                        onDoubleClick={() => onConnect(host)}
                        className="group relative flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[7px] hover:bg-[var(--hover-item)] cursor-pointer transition active:scale-[0.98]"
                      >
                        <div
                          className="flex items-center space-x-2 truncate flex-1"
                          onClick={() => onConnect(host)}
                        >
                          <div className="relative flex-shrink-0">
                            <Server className="w-3.5 h-3.5 text-[var(--text-secondary)] group-hover:text-[#007AFF] transition" strokeWidth={1.75} />
                            <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-1 ring-[var(--bg-app)]"></span>
                          </div>
                          <div className="truncate">
                            <div className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                              {host.name}
                            </div>
                            <div className="text-[10.5px] text-[var(--text-tertiary)] font-mono truncate tracking-tight">
                              {host.username}@{host.host}
                            </div>
                          </div>
                        </div>

                        {/* Subtle Action Hover Icons */}
                        <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-0.5 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(host);
                            }}
                            className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--active-item)] rounded transition"
                            title="配置连接"
                          >
                            <SlidersHorizontal className="w-3 h-3" strokeWidth={1.75} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(host.id);
                            }}
                            className="p-1 text-[var(--text-secondary)] hover:text-rose-500 hover:bg-rose-500/10 rounded transition"
                            title="移除"
                          >
                            <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Quick Commands Strip */}
      <div className="p-2.5 border-t border-[var(--border-subtle)] bg-[var(--input-bg)] flex-shrink-0 space-y-2">
        <div className="text-[10px] font-medium tracking-wider uppercase text-[var(--text-tertiary)] px-0.5">
          快捷指令
        </div>
        <div className="grid grid-cols-2 gap-1">
          {quickCommands.map((qc) => {
            const Icon = qc.icon;
            return (
              <button
                key={qc.label}
                onClick={() => onRunQuickCommand(qc.cmd)}
                className="flex items-center space-x-1.5 px-2 py-1 bg-[var(--active-tab-bg)] hover:bg-[var(--hover-item)] border border-[var(--border-subtle)] rounded-[6px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-[11px] font-medium transition active:scale-[0.96]"
              >
                <Icon className="w-3 h-3 text-[var(--text-tertiary)]" strokeWidth={1.75} />
                <span>{qc.label}</span>
              </button>
            );
          })}
        </div>

        {/* Theme Selector */}
        <div className="pt-1.5 border-t border-[var(--border-subtle)]">
          <ThemeSelector themeMode={themeMode} onChange={onThemeChange} />
        </div>
      </div>

      {/* Resizer Divider Handle (Hover to drag width, with min/max constraint) */}
      <div
        onPointerDown={handlePointerDown}
        title="按住左右拖拽调整侧边栏宽度"
        className="absolute top-0 right-0 w-2 h-full cursor-col-resize hover:bg-[#007AFF]/40 active:bg-[#007AFF] transition-colors z-30 select-none group flex justify-end"
      >
        <div className="w-[1px] h-full bg-[var(--border-subtle)] group-hover:bg-[#007AFF] transition-colors" />
      </div>
    </aside>
  );
};
