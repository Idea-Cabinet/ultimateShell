import React, { useState, useRef, useEffect } from "react";
import { HostProfile, TabSession, isDefaultGroup } from "../types";
import { ServerPerfMonitor } from "./ServerPerfMonitor";
import { useI18n } from "../i18n";
import {
  Server,
  Plus,
  Search,
  ChevronRight,
  Terminal,
  Trash2,
  SlidersHorizontal,
  Folder,
  ArrowUpDown,
  Lock,
  X,
  Copy,
  FolderPlus,
  Edit3,
  RotateCw,
  FolderOpen,
} from "lucide-react";

export type SortMode = "recent" | "newest" | "oldest" | "name";

type SidebarContextMenu =
  | { type: "host"; x: number; y: number; host: HostProfile }
  | { type: "group"; x: number; y: number; groupName: string }
  | { type: "blank"; x: number; y: number };

interface Props {
  hosts: HostProfile[];
  connectedHostIds: Set<string>;
  width: number;
  isCollapsed: boolean;
  activeSession?: TabSession;
  onWidthChange: (w: number) => void;
  onCollapse: (collapsed: boolean) => void;
  onConnect: (host: HostProfile) => void;
  onEdit: (host: HostProfile) => void;
  onDelete: (id: string) => void;
  onNewHost: (initialGroup?: string) => void;
  onDuplicateHost?: (host: HostProfile) => void;
  onChangeHostGroup?: (hostId: string, newGroup: string) => void;
  onRenameGroup?: (oldGroup: string, newGroup: string) => void;
  onRefreshHosts?: () => void;
  onRunQuickCommand?: (cmd: string) => void;
  onDragChange?: (dragging: boolean) => void;
}

export const Sidebar: React.FC<Props> = ({
  hosts,
  connectedHostIds,
  width,
  isCollapsed,
  activeSession,
  onWidthChange,
  onCollapse,
  onConnect,
  onEdit,
  onDelete,
  onNewHost,
  onDuplicateHost,
  onChangeHostGroup,
  onRenameGroup,
  onRefreshHosts,
  onDragChange,
}) => {
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    return (localStorage.getItem("ultimateshell_sort_mode") as SortMode) || "recent";
  });
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(null);

  // Defer re-sorting when user is hovering inside the sidebar (prevents jumping under cursor!)
  const [displayHosts, setDisplayHosts] = useState<HostProfile[]>(hosts);
  const pendingHostsRef = useRef<HostProfile[] | null>(null);
  const isHoveringRef = useRef<boolean>(false);

  // Synchronize hosts when not hovering or when server count changes (e.g. added/deleted)
  useEffect(() => {
    const countChanged = hosts.length !== displayHosts.length;
    if (!isHoveringRef.current || countChanged) {
      setDisplayHosts(hosts);
      pendingHostsRef.current = null;
    } else {
      pendingHostsRef.current = hosts;
    }
  }, [hosts, displayHosts.length]);

  // Global click / Escape listener to dismiss context menu
  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleSidebarMouseEnter = () => {
    isHoveringRef.current = true;
  };

  const handleSidebarMouseLeave = () => {
    isHoveringRef.current = false;
    // When cursor leaves sidebar, apply any deferred re-sort!
    if (pendingHostsRef.current) {
      setDisplayHosts(pendingHostsRef.current);
      pendingHostsRef.current = null;
    }
  };

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

  const handleExpandAllGroups = () => {
    setCollapsedGroups({});
    setContextMenu(null);
  };

  const handleCollapseAllGroups = () => {
    const allCollapsed: Record<string, boolean> = {};
    Object.keys(groups).forEach((g) => (allCollapsed[g] = true));
    setCollapsedGroups(allCollapsed);
    setContextMenu(null);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    onDragChange?.(true);
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
      onDragChange?.(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // Context Menu Triggers
  const handleHostContextMenu = (e: React.MouseEvent, host: HostProfile) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      type: "host",
      x: Math.min(e.clientX, window.innerWidth - 210),
      y: Math.min(e.clientY, window.innerHeight - 250),
      host,
    });
  };

  const handleGroupContextMenu = (e: React.MouseEvent, groupName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      type: "group",
      x: Math.min(e.clientX, window.innerWidth - 210),
      y: Math.min(e.clientY, window.innerHeight - 250),
      groupName,
    });
  };

  const handleBlankContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      type: "blank",
      x: Math.min(e.clientX, window.innerWidth - 210),
      y: Math.min(e.clientY, window.innerHeight - 220),
    });
  };

  const defaultGroupLabel = t("sidebar.defaultGroup");

  // Filter hosts from displayHosts snapshot
  let filteredHosts = displayHosts.filter((h) => {
    const term = searchTerm.toLowerCase();
    const groupName = isDefaultGroup(h.group) ? defaultGroupLabel : h.group!;
    return (
      h.name.toLowerCase().includes(term) ||
      h.host.toLowerCase().includes(term) ||
      groupName.toLowerCase().includes(term)
    );
  });

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
    const g = isDefaultGroup(h.group) ? defaultGroupLabel : h.group!.trim();
    if (!groups[g]) groups[g] = [];
    groups[g].push(h);
  });

  return (
    <aside
      onMouseEnter={handleSidebarMouseEnter}
      onMouseLeave={handleSidebarMouseLeave}
      style={{ width: isCollapsed ? 0 : `${width}px` }}
      className={`relative h-full apple-vibrancy-sidebar flex flex-col select-none text-[var(--text-primary)] z-20 flex-shrink-0 overflow-hidden ${
        isCollapsed
          ? "border-r-0 opacity-0 pointer-events-none"
          : "border-r border-[var(--border-subtle)] opacity-100"
      } ${
        isDragging
          ? ""
          : "transition-[width,opacity] duration-160 ease-[var(--ease-drawer)]"
      }`}
    >
      <div style={{ width: `${width}px` }} className="h-full flex flex-col flex-shrink-0 min-w-[200px]">
      {/* macOS Unified Titlebar Drag Region & Traffic Lights clearance */}
      <div
        data-tauri-drag-region
        className="app-titlebar app-titlebar-controls flex items-center justify-between px-3 border-b border-[var(--border-subtle)] select-none flex-shrink-0"
      >
        <div className="flex min-w-0 items-center truncate">
          <span className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--text-primary)] truncate leading-none">
            {t("app.title")}
          </span>
        </div>

        <div className="flex items-center space-x-0.5 pr-8">
          <button
            onClick={() => onNewHost()}
            title={t("sidebar.newHost")}
            className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition active:scale-[0.95]"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Search Bar & Sort Dropdown */}
      <div className="px-2.5 py-2 flex-shrink-0 flex items-center space-x-1.5">
        <div className="relative flex-1 flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-[var(--text-tertiary)] pointer-events-none" strokeWidth={1.75} />
          <input
            type="text"
            placeholder={t("sidebar.searchPlaceholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-7 py-1 text-[12px] bg-[var(--input-bg)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] border border-[var(--border-subtle)] rounded-md focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 transition-all font-normal"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              title="Clear"
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
            title="Sort hosts"
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
                { id: "recent", label: t("sidebar.sort.recent") },
                { id: "newest", label: t("sidebar.sort.newest") },
                { id: "oldest", label: t("sidebar.sort.oldest") },
                { id: "name", label: t("sidebar.sort.name") },
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

      {/* Server Tree List - Blank Area Right-Clickable */}
      <div
        onContextMenu={handleBlankContextMenu}
        className="flex-1 overflow-y-auto px-2 py-1 space-y-3"
      >
        {Object.keys(groups).length === 0 ? (
          <div className="text-center py-12 px-4 space-y-2">
            <Server className="w-7 h-7 mx-auto text-[var(--text-tertiary)]" strokeWidth={1.5} />
            <p className="text-[12px] text-[var(--text-secondary)] font-medium">{t("sidebar.noHosts")}</p>
            <p className="text-[11px] text-[var(--text-tertiary)]">{t("sidebar.noHostsDesc")}</p>
          </div>
        ) : (
          Object.entries(groups).map(([groupName, groupHosts]) => {
            const isGroupCollapsed = !!collapsedGroups[groupName];
            return (
              <div key={groupName} className="space-y-0.5">
                {/* macOS Section Header - Right-Clickable */}
                <div
                  onClick={() => toggleGroup(groupName)}
                  onContextMenu={(e) => handleGroupContextMenu(e, groupName)}
                  title="点击展开/收起 (右键打开分组操作菜单)"
                  className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold tracking-wider text-[var(--text-tertiary)] uppercase cursor-pointer rounded-md hover:bg-[var(--hover-item)] transition group"
                >
                  <div className="flex items-center space-x-1.5 truncate">
                    <ChevronRight
                      className={`w-3 h-3 text-[var(--text-tertiary)] transition-transform duration-150 ease-[var(--ease-drawer)] ${
                        isGroupCollapsed ? "" : "rotate-90 text-[var(--text-secondary)]"
                      }`}
                      strokeWidth={2}
                    />
                    {isGroupCollapsed ? (
                      <Folder className="w-3 h-3 text-[var(--text-tertiary)]" strokeWidth={1.5} />
                    ) : (
                      <FolderOpen className="w-3 h-3 text-[#F2B93B]" strokeWidth={1.5} />
                    )}
                    <span className="tracking-tight normal-case text-[var(--text-secondary)] font-medium truncate">{groupName}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-tertiary)] font-mono ml-1">
                    {groupHosts.length}
                  </span>
                </div>

                {/* macOS Rounded Item Pill - Animated Accordion */}
                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-150 ease-[var(--ease-drawer)] ${
                    isGroupCollapsed
                      ? "grid-rows-[0fr] opacity-0 pointer-events-none"
                      : "grid-rows-[1fr] opacity-100"
                  }`}
                >
                  <div className="overflow-hidden space-y-0.5 pl-1.5">
                    {groupHosts.map((host) => {
                      const isConnected = connectedHostIds.has(host.id);
                      return (
                        <div
                          key={host.id}
                          onContextMenu={(e) => handleHostContextMenu(e, host)}
                          className="group relative flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[7px] hover:bg-[var(--hover-item)] cursor-pointer transition active:scale-[0.98]"
                        >
                          <div
                            className="flex items-center space-x-2 truncate flex-1"
                            onClick={() => onConnect(host)}
                          >
                            <div
                              title={isConnected ? t("sidebar.connectedBadge") : t("sidebar.menu.connect")}
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
                                <span title={t("sidebar.connectedBadge")} className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ring-1 ring-[var(--bg-app)]" />
                              )}
                            </div>
                            <div className="truncate flex-1">
                              <div className="flex items-center space-x-1 truncate">
                                <span className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                                  {host.name}
                                </span>
                                {host.has_password && (
                                  <span title={t("sidebar.passwordSaved")} className="inline-flex items-center">
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
                              title={t("sidebar.menu.editHost")}
                            >
                              <SlidersHorizontal className="w-3 h-3" strokeWidth={1.75} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(t("sidebar.menu.confirmDeleteHost", { name: host.name }))) {
                                  onDelete(host.id);
                                }
                              }}
                              className="p-1 text-[var(--text-secondary)] hover:text-rose-500 hover:bg-rose-500/10 rounded transition"
                              title={t("sidebar.menu.deleteHost")}
                            >
                              <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
      </div>

      {/* Resizer Divider Handle */}
      {!isCollapsed && (
        <div
          onPointerDown={handlePointerDown}
          title={t("sidebar.resizeWidth")}
          className="absolute top-0 right-0 w-2 h-full cursor-col-resize hover:bg-[#007AFF]/40 active:bg-[#007AFF] transition-colors z-30 select-none group flex justify-end"
        >
          <div className="w-[1px] h-full bg-[var(--border-subtle)] group-hover:bg-[#007AFF] transition-colors" />
        </div>
      )}

      {/* Context Menus Popover (Host / Group / Blank) */}
      {contextMenu && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 apple-card rounded-xl py-1.5 w-48 shadow-2xl text-[12px] text-[var(--text-primary)] animate-in fade-in zoom-in-95 duration-100 select-none border border-[var(--border-subtle)]"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "host" && (
            <>
              <button
                onClick={() => {
                  onConnect(contextMenu.host);
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <Terminal className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{t("sidebar.menu.connect")}</span>
              </button>

              <button
                onClick={() => {
                  onEdit(contextMenu.host);
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{t("sidebar.menu.editHost")}</span>
              </button>

              <button
                onClick={() => {
                  onDuplicateHost?.(contextMenu.host);
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{t("sidebar.menu.duplicateHost")}</span>
              </button>

              <button
                onClick={() => {
                  const g = prompt(t("sidebar.menu.promptNewGroup"), contextMenu.host.group || "");
                  if (g !== null) {
                    onChangeHostGroup?.(contextMenu.host.id, g);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <FolderPlus className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{t("sidebar.menu.changeGroup")}</span>
              </button>

              <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

              <button
                onClick={() => {
                  if (confirm(t("sidebar.menu.confirmDeleteHost", { name: contextMenu.host.name }))) {
                    onDelete(contextMenu.host.id);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-rose-500 hover:text-white text-rose-500 text-left transition"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{t("sidebar.menu.deleteHost")}</span>
              </button>
            </>
          )}

          {contextMenu.type === "group" && (
            <>
              <button
                onClick={() => {
                  toggleGroup(contextMenu.groupName);
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                {collapsedGroups[contextMenu.groupName] ? (
                  <>
                    <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
                    <span>{t("sidebar.menu.expandGroup")}</span>
                  </>
                ) : (
                  <>
                    <Folder className="w-3.5 h-3.5" strokeWidth={1.75} />
                    <span>{t("sidebar.menu.collapseGroup")}</span>
                  </>
                )}
              </button>

              <button
                onClick={() => {
                  onNewHost(isDefaultGroup(contextMenu.groupName) ? undefined : contextMenu.groupName);
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                <span>{t("sidebar.menu.newHostInGroup")}</span>
              </button>

              <button
                onClick={() => {
                  const newName = prompt(
                    t("sidebar.menu.promptRenameGroup", { group: contextMenu.groupName }),
                    contextMenu.groupName
                  );
                  if (newName && newName.trim() && newName.trim() !== contextMenu.groupName) {
                    onRenameGroup?.(contextMenu.groupName, newName.trim());
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <Edit3 className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{t("sidebar.menu.renameGroup")}</span>
              </button>

              <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

              <button
                onClick={handleExpandAllGroups}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{t("sidebar.menu.expandAllGroups")}</span>
              </button>

              <button
                onClick={handleCollapseAllGroups}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <Folder className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{t("sidebar.menu.collapseAllGroups")}</span>
              </button>
            </>
          )}

          {contextMenu.type === "blank" && (
            <>
              <button
                onClick={() => {
                  onNewHost();
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                <span>{t("sidebar.newHost")}</span>
              </button>

              <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

              <button
                onClick={handleExpandAllGroups}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{t("sidebar.menu.expandAllGroups")}</span>
              </button>

              <button
                onClick={handleCollapseAllGroups}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <Folder className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{t("sidebar.menu.collapseAllGroups")}</span>
              </button>

              <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

              <button
                onClick={() => {
                  onRefreshHosts?.();
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
              >
                <RotateCw className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{t("sidebar.menu.refreshList")}</span>
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
};
