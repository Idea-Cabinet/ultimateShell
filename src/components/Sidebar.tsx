import React, { useState } from "react";
import { HostProfile } from "../types";
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
} from "lucide-react";

interface Props {
  hosts: HostProfile[];
  onConnect: (host: HostProfile) => void;
  onEdit: (host: HostProfile) => void;
  onDelete: (id: string) => void;
  onNewHost: () => void;
  onImportFinalShell: () => void;
  onRunQuickCommand: (cmd: string) => void;
}

export const Sidebar: React.FC<Props> = ({
  hosts,
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

  return (
    <aside className="w-64 h-full apple-vibrancy-sidebar border-r border-white/[0.08] flex flex-col select-none text-[#e5e5ea] z-20">
      {/* macOS Unified Titlebar Drag Region & Traffic Lights clearance */}
      <div
        data-tauri-drag-region
        className="h-12 flex items-center justify-between px-3 pl-[78px] border-b border-white/[0.06] select-none"
      >
        <div className="flex items-center space-x-2">
          <Terminal className="w-3.5 h-3.5 text-white/70" strokeWidth={1.75} />
          <span className="text-[13px] font-semibold tracking-[-0.01em] text-white/90">
            UltimateShell
          </span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={onImportFinalShell}
            title="从 FinalShell 导入"
            className="p-1 rounded-md text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition active:scale-[0.95]"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          <button
            onClick={onNewHost}
            title="新建服务器连接"
            className="p-1 rounded-md text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition active:scale-[0.95]"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* macOS Search Bar */}
      <div className="px-2.5 py-2">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-white/30 pointer-events-none" strokeWidth={1.75} />
          <input
            type="text"
            placeholder="搜索连接..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1 text-[12px] bg-black/25 text-white placeholder-white/30 border border-white/[0.08] rounded-md focus:outline-none focus:border-[#007AFF]/80 focus:ring-1 focus:ring-[#007AFF]/40 transition-all font-normal"
          />
        </div>
      </div>

      {/* Server Tree List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-3">
        {Object.keys(groups).length === 0 ? (
          <div className="text-center py-12 px-4 space-y-2">
            <Server className="w-7 h-7 mx-auto text-white/20" strokeWidth={1.5} />
            <p className="text-[12px] text-white/40 font-medium">无服务器连接</p>
            <p className="text-[11px] text-white/25">点击右上角 + 或 导入按钮</p>
          </div>
        ) : (
          Object.entries(groups).map(([groupName, groupHosts]) => {
            const isCollapsed = !!collapsedGroups[groupName];
            return (
              <div key={groupName} className="space-y-0.5">
                {/* macOS Section Header */}
                <div
                  onClick={() => toggleGroup(groupName)}
                  className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold tracking-wider text-white/40 uppercase cursor-pointer rounded-md hover:bg-white/[0.04] transition group"
                >
                  <div className="flex items-center space-x-1.5">
                    <ChevronRight
                      className={`w-3 h-3 text-white/30 transition-transform duration-200 ${
                        isCollapsed ? "" : "rotate-90 text-white/50"
                      }`}
                      strokeWidth={2}
                    />
                    <Folder className="w-3 h-3 text-white/35" strokeWidth={1.5} />
                    <span className="tracking-tight normal-case text-white/60 font-medium">{groupName}</span>
                  </div>
                  <span className="text-[10px] text-white/25 font-mono">
                    {groupHosts.length}
                  </span>
                </div>

                {/* macOS Rounded Item Pill */}
                {!isCollapsed && (
                  <div className="space-y-0.5 pl-1.5">
                    {groupHosts.map((host) => (
                      <div
                        key={host.id}
                        onDoubleClick={() => onConnect(host)}
                        className="group relative flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[7px] hover:bg-white/[0.08] cursor-pointer transition active:scale-[0.98]"
                      >
                        <div
                          className="flex items-center space-x-2 truncate flex-1"
                          onClick={() => onConnect(host)}
                        >
                          <div className="relative flex-shrink-0">
                            <Server className="w-3.5 h-3.5 text-white/50 group-hover:text-blue-400 transition" strokeWidth={1.75} />
                            <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500/80 ring-1 ring-black/40"></span>
                          </div>
                          <div className="truncate">
                            <div className="text-[12.5px] font-medium text-white/85 group-hover:text-white truncate">
                              {host.name}
                            </div>
                            <div className="text-[10.5px] text-white/35 font-mono truncate tracking-tight">
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
                            className="p-1 text-white/40 hover:text-white hover:bg-white/[0.12] rounded transition"
                            title="配置连接"
                          >
                            <SlidersHorizontal className="w-3 h-3" strokeWidth={1.75} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(host.id);
                            }}
                            className="p-1 text-white/40 hover:text-rose-400 hover:bg-rose-500/10 rounded transition"
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

      {/* macOS Quick Commands Strip */}
      <div className="p-2.5 border-t border-white/[0.06] bg-black/20">
        <div className="text-[10px] font-medium tracking-wider uppercase text-white/35 mb-1.5 px-0.5">
          快捷运维指令
        </div>
        <div className="grid grid-cols-2 gap-1">
          {quickCommands.map((qc) => {
            const Icon = qc.icon;
            return (
              <button
                key={qc.label}
                onClick={() => onRunQuickCommand(qc.cmd)}
                className="flex items-center space-x-1.5 px-2 py-1 bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] rounded-[6px] text-white/70 hover:text-white text-[11px] font-medium transition active:scale-[0.96]"
              >
                <Icon className="w-3 h-3 text-white/40" strokeWidth={1.75} />
                <span>{qc.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
