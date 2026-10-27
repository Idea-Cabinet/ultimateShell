import React from "react";
import { TabSession } from "../types";
import { FileExplorer } from "./FileExplorer";
import { ProcessManager } from "./ProcessManager";
import { DiskMountManager } from "./DiskMountManager";
import {
  Folder,
  Activity,
  HardDrive,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";

export type DrawerTab = "files" | "processes" | "disks";

interface Props {
  session: TabSession;
  height: number;
  isOpen: boolean;
  activeTab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  isMaximized: boolean;
  currentUser?: string;
  onToggleMaximize: () => void;
  onClose: () => void;
  onSendToTerminal: (cmd: string) => void;
}

export const OpsDrawer: React.FC<Props> = ({
  session,
  height,
  isOpen,
  activeTab,
  onTabChange,
  isMaximized,
  currentUser,
  onToggleMaximize,
  onClose,
  onSendToTerminal,
}) => {
  if (!isOpen) return null;

  return (
    <div
      style={{ height: isMaximized ? "100%" : `${height}px` }}
      className="w-full flex flex-col bg-[var(--bg-app)] border-t border-[var(--border-subtle)] select-none overflow-hidden relative z-20"
    >
      {/* Drawer Mode Tabs Strip */}
      <div className="h-8 px-2.5 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between text-[11.5px] flex-shrink-0">
        {/* Left: Mode Segmented Switcher */}
        <div className="flex items-center space-x-1 p-0.5 rounded-lg bg-[var(--hover-item)] border border-[var(--border-subtle)]/60">
          <button
            onClick={() => onTabChange("files")}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
              activeTab === "files"
                ? "bg-[var(--bg-card)] text-[#007AFF] shadow-sm font-semibold"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>可视化文件树</span>
          </button>

          <button
            onClick={() => onTabChange("processes")}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
              activeTab === "processes"
                ? "bg-[var(--bg-card)] text-[#007AFF] shadow-sm font-semibold"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-purple-400" />
            <span>进程管理</span>
          </button>

          <button
            onClick={() => onTabChange("disks")}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
              activeTab === "disks"
                ? "bg-[var(--bg-card)] text-[#007AFF] shadow-sm font-semibold"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <HardDrive className="w-3.5 h-3.5 text-amber-500" />
            <span>磁盘容量监控</span>
          </button>
        </div>

        {/* Right: Window Controls */}
        <div className="flex items-center space-x-1 flex-shrink-0">
          <button
            onClick={onToggleMaximize}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            title={isMaximized ? "还原视口高度" : "最大化面板"}
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            title="关闭下方抽屉"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "files" && (
          <FileExplorer
            session={session}
            height={height}
            isOpen={isOpen}
            isMaximized={isMaximized}
            currentUser={currentUser}
            onToggleMaximize={onToggleMaximize}
            onClose={onClose}
            onSendToTerminal={onSendToTerminal}
            hideHeaderControls
          />
        )}

        {activeTab === "processes" && (
          <ProcessManager session={session} onSendToTerminal={onSendToTerminal} />
        )}

        {activeTab === "disks" && <DiskMountManager session={session} />}
      </div>
    </div>
  );
};
