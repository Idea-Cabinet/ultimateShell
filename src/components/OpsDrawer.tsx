import React from "react";
import { TabSession } from "../types";
import { FileExplorer } from "./FileExplorer";
import { ProcessManager } from "./ProcessManager";
import { DiskMountManager } from "./DiskMountManager";

export type DrawerTab = "files" | "processes" | "disks";

interface Props {
  session: TabSession;
  height: number;
  isOpen: boolean;
  activeTab: DrawerTab;
  onTabChange?: (tab: DrawerTab) => void;
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
      {/* Main Content Area without duplicate top tab button strip */}
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
          />
        )}

        {activeTab === "processes" && (
          <ProcessManager
            session={session}
            onSendToTerminal={onSendToTerminal}
            isMaximized={isMaximized}
            onToggleMaximize={onToggleMaximize}
            onClose={onClose}
          />
        )}

        {activeTab === "disks" && (
          <DiskMountManager
            session={session}
            isMaximized={isMaximized}
            onToggleMaximize={onToggleMaximize}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
};
