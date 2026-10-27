import React, { useState } from "react";
import { HostProfile } from "../types";
import {
  Server,
  Plus,
  Search,
  DownloadCloud,
  ChevronDown,
  ChevronRight,
  Terminal as TerminalIcon,
  Trash2,
  Edit2,
  Zap,
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

  // Group hosts
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
    { label: "资源监控", cmd: "htop\n" },
    { label: "磁盘空间", cmd: "df -h\n" },
    { label: "内存概况", cmd: "free -m\n" },
    { label: "容器列表", cmd: "docker ps\n" },
    { label: "网络端口", cmd: "ss -tuln\n" },
  ];

  return (
    <div className="w-64 h-full bg-[#161b22] border-r border-[#30363d] flex flex-col select-none text-gray-200">
      {/* App Header */}
      <div className="p-3.5 border-b border-[#30363d] flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
            <TerminalIcon className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
              UltimateShell
              <span className="text-[10px] px-1 py-0.2 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded font-normal">
                v0.1
              </span>
            </h1>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="p-2.5 space-y-2 border-b border-[#30363d] bg-[#0d1117]/40">
        <div className="flex gap-1.5">
          <button
            onClick={onNewHost}
            className="flex-1 flex items-center justify-center space-x-1 py-1.5 px-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新建连接</span>
          </button>
          <button
            onClick={onImportFinalShell}
            title="一键从本地 FinalShell 导入全部主机"
            className="flex items-center justify-center px-2 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-gray-200 text-xs rounded-lg transition border border-[#30363d]"
          >
            <DownloadCloud className="w-3.5 h-3.5 text-blue-400" />
          </button>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
          <input
            type="text"
            placeholder="搜索主机或 IP..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Server Tree List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {Object.keys(groups).length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-500 space-y-2">
            <Server className="w-8 h-8 mx-auto text-gray-600 opacity-60" />
            <p>暂无服务器连接</p>
            <p className="text-[11px] text-gray-600">点击上方按钮新建或从 FinalShell 导入</p>
          </div>
        ) : (
          Object.entries(groups).map(([groupName, groupHosts]) => {
            const isCollapsed = !!collapsedGroups[groupName];
            return (
              <div key={groupName} className="space-y-1">
                {/* Group Header */}
                <div
                  onClick={() => toggleGroup(groupName)}
                  className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-gray-400 hover:text-gray-200 cursor-pointer rounded hover:bg-[#21262d] transition"
                >
                  <div className="flex items-center space-x-1.5">
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                    )}
                    <span>{groupName}</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.2 bg-[#21262d] text-gray-400 rounded-full">
                    {groupHosts.length}
                  </span>
                </div>

                {/* Group Items */}
                {!isCollapsed && (
                  <div className="space-y-0.5 pl-2">
                    {groupHosts.map((host) => (
                      <div
                        key={host.id}
                        onDoubleClick={() => onConnect(host)}
                        className="group flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg hover:bg-[#21262d] cursor-pointer transition border border-transparent hover:border-[#30363d]/60"
                      >
                        <div
                          className="flex items-center space-x-2 truncate flex-1"
                          onClick={() => onConnect(host)}
                        >
                          <Server className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-400 transition flex-shrink-0" />
                          <div className="truncate">
                            <div className="font-medium text-gray-200 truncate">{host.name}</div>
                            <div className="text-[10px] text-gray-500 truncate font-mono">
                              {host.username}@{host.host}:{host.port}
                            </div>
                          </div>
                        </div>

                        {/* Hover Actions */}
                        <div className="hidden group-hover:flex items-center space-x-1 flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(host);
                            }}
                            className="p-1 text-gray-400 hover:text-gray-200 hover:bg-[#30363d] rounded"
                            title="编辑"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(host.id);
                            }}
                            className="p-1 text-gray-400 hover:text-red-400 hover:bg-[#30363d] rounded"
                            title="删除"
                          >
                            <Trash2 className="w-3 h-3" />
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

      {/* Quick Commands Bar (FinalShell feature) */}
      <div className="p-2.5 border-t border-[#30363d] bg-[#0d1117]/60">
        <div className="flex items-center space-x-1.5 mb-2 text-[11px] font-semibold text-gray-400">
          <Zap className="w-3.5 h-3.5 text-yellow-400" />
          <span>快捷命令</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {quickCommands.map((qc) => (
            <button
              key={qc.label}
              onClick={() => onRunQuickCommand(qc.cmd)}
              className="text-[10px] px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-gray-300 rounded border border-[#30363d] transition active:scale-95"
            >
              {qc.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
