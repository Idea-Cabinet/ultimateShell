import React, { useState } from "react";
import { HostProfile, TabSession } from "../types";
import { ThemeMode } from "../hooks/useTheme";
import { ThemeSelector } from "./ThemeSelector";
import { ServerPerfMonitor } from "./ServerPerfMonitor";
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
  PanelLeftClose,
  ArrowUpDown,
  Lock,
  X,
} from "lucide-react";

export type SortMode = "recent" | "newest" | "oldest" | "name";

interface Props {
  hosts: HostProfile[];
  connectedHostIds: Set<string>;
  width: number;
  isCollapsed: boolean;
  themeMode: ThemeMode;
  activeSession?: TabSession;
  onWidthChange: (w: number) => void;
  onCollapse: (collapsed: boolean) => void;
  onThemeChange: (mode: ThemeMode) => void;
  onConnect: (host: HostProfile) => void;
  onEdit: (host: HostProfile) => void;
  onDelete: (id: string) => void;
  onNewHost: () => void;
  onImportFinalShell: () => void;
  onRunQuickCommand?: (cmd: string) => void;
}

export const Sidebar: React.FC<Props> = ({
  hosts,
  connectedHostIds,
  width,
  isCollapsed,
  themeMode,
  activeSession,
  onWidthChange,
  onCollapse,
  onThemeChange,
  onConnect,
  onEdit,
  onDelete,
  onNewHost,
  onImportFinalShell,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    return (localStorage.getItem("ultimateshell_sort_mode") as SortMode) || "recent";
  });
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Resizable Performance Monitor Height
  const [perfHeight, setPerfHeight] = useState<number>(() => {
    const saved = localStorage.getItem("ultimateshell_sidebar_perf_height");
    return saved ? parseInt(saved, 10) : 210;
  });

  const handleSortChange = (mode: SortMode) => {
    setSortMode(mode);
    localStorage.setItem("ultimateshell_sort_mode", mode);
    setShowSortMenu(false);
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
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
      setIsDragging(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // Filter hosts
  let filteredHosts = hosts.filter(
    (h) =>
      h.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      h.host.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (h.group && h.group.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Sort hosts
  filteredHosts.sort((a, b) => {
    if (sortMode === "recent") {
      return (b.access_time || 0) - (a.access_time || 0);
    } else if (sortMode === "newest") {
      return (b.create_time || 0) - (a.create_time || 0);
    } else if (sortMode === "oldest") {
      return (a.create_time || 0) - (b.create_time || 0);
    } else {
      return a.name.localeCompare(b.name, "zh-CN");
    }
  });

  const groups: Record<string, HostProfile[]> = {};
  filteredHosts.forEach((h) => {
    const g = h.group || "默认分组";
    if (!groups[g]) groups[g] = [];
    groups[g].push(h);
  });

  if (isCollapsed) return null;

  return (
    <aside
      style={{ width: `${width}px` }}
      className={`relative h-full apple-vibrancy-sidebar border-r border-[var(--border-subtle)] flex flex-col select-none text-[var(--text-primary)] z-20 flex-shrink-0 ${
        isDragging ? "" : "transition-[width] duration-150 ease-[var(--ease-drawer)]"
      }`}
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
            title="导入 FinalShell (一键解密导入历史配置与密码)"
            className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition active:scale-[0.95]"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          <button
            onClick={onNewHost}
            title="新建服务器 (配置新主机及密码)"
            className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition active:scale-[0.95]"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
          <button
            onClick={() => onCollapse(true)}
            title="收起侧边栏 (快捷键: Cmd+B)"
            className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition active:scale-[0.95]"
          >
            <PanelLeftClose className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Search Bar & Sort Dropdown */}
      <div className="px-2.5 py-2 flex-shrink-0 flex items-center space-x-1.5">
        <div className="relative flex-1 flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-[var(--text-tertiary)] pointer-events-none" strokeWidth={1.75} />
          <input
            type="text"
            placeholder="搜索主机或 IP..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-7 py-1 text-[12px] bg-[var(--input-bg)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] border border-[var(--border-subtle)] rounded-md focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 transition-all font-normal"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              title="清除搜索关键字"
              className="absolute right-2 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Sort Button */}
        <div className="relative">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            title="切换排序方式 (最近连接/最新创建/名称)"
            className={`p-1.5 rounded-md border border-[var(--border-subtle)] transition active:scale-[0.95] ${
              showSortMenu
                ? "bg-[#007AFF] text-white"
                : "bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)]"
            }`}
          >
            <ArrowUpDown className="w-3 h-3" strokeWidth={1.75} />
          </button>

          {/* Sort Menu Popover */}
          {showSortMenu && (
            <div className="absolute right-0 top-8 z-50 w-32 apple-card rounded-xl py-1 text-[11px] shadow-2xl border border-[var(--border-subtle)]">
              {[
                { id: "recent", label: "最近连接" },
                { id: "newest", label: "最新创建" },
                { id: "oldest", label: "最早创建" },
                { id: "name", label: "按名称 A-Z" },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSortChange(item.id as SortMode)}
                  className={`w-full text-left px-3 py-1.5 transition ${
                    sortMode === item.id
                      ? "text-[#007AFF] font-medium bg-[var(--hover-item)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Server Tree List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-3">
        {Object.keys(groups).length === 0 ? (
          <div className="text-center py-12 px-4 space-y-2">
            <Server className="w-7 h-7 mx-auto text-[var(--text-tertiary)]" strokeWidth={1.5} />
            <p className="text-[12px] text-[var(--text-secondary)] font-medium">无服务器连接</p>
            <p className="text-[11px] text-[var(--text-tertiary)]">点击上方按钮新建或从 FinalShell 导入</p>
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
                    {groupHosts.map((host) => {
                      const isConnected = connectedHostIds.has(host.id);
                      return (
                        <div
                          key={host.id}
                          onDoubleClick={() => onConnect(host)}
                          className="group relative flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[7px] hover:bg-[var(--hover-item)] cursor-pointer transition active:scale-[0.98]"
                        >
                          <div
                            className="flex items-center space-x-2 truncate flex-1"
                            onClick={() => onConnect(host)}
                          >
                            <div
                              title={isConnected ? "已建立连接 (双击重新打开会话)" : "双击打开终端连接"}
                              className="relative flex-shrink-0"
                            >
                              <Server
                                className={`w-3.5 h-3.5 transition ${
                                  isConnected ? "text-[#007AFF]" : "text-[var(--text-secondary)]"
                                }`}
                                strokeWidth={1.75}
                              />
                              {/* Requirement 3: Only display green dot on actively connected servers! */}
                              {isConnected && (
                                <span title="当前处于活跃连接状态" className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ring-1 ring-[var(--bg-app)]" />
                              )}
                            </div>
                            <div className="truncate flex-1">
                              <div className="flex items-center space-x-1 truncate">
                                <span className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                                  {host.name}
                                </span>
                                {host.has_password && (
                                  <span title="已加密记住密码 (AES-256-GCM 硬件锁保护)" className="inline-flex items-center">
                                    <Lock className="w-2.5 h-2.5 text-[var(--text-tertiary)] flex-shrink-0" />
                                  </span>
                                )}
                              </div>
                              <div className="text-[10.5px] text-[var(--text-tertiary)] font-mono truncate tracking-tight">
                                {host.username}@{host.host}
                              </div>
                            </div>
                          </div>

                          {/* Action Hover Icons */}
                          <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-0.5 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onEdit(host);
                              }}
                              className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--active-item)] rounded transition"
                              title="配置连接 (修改主机、端口及密码)"
                            >
                              <SlidersHorizontal className="w-3 h-3" strokeWidth={1.75} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDelete(host.id);
                              }}
                              className="p-1 text-[var(--text-secondary)] hover:text-rose-500 hover:bg-rose-500/10 rounded transition"
                              title="移除服务器 (从侧边栏删除主机)"
                            >
                              <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Real-time Server Performance Monitor with Resizable Height */}
      <ServerPerfMonitor
        activeSession={activeSession}
        height={perfHeight}
        onHeightChange={setPerfHeight}
      />

      {/* Sidebar Footer: Theme Selector */}
      <div className="p-2 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)] flex-shrink-0">
        <ThemeSelector themeMode={themeMode} onChange={onThemeChange} />
      </div>

      {/* Resizer Divider Handle */}
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
