import React from "react";
import { TabSession } from "../types";
import { FileExplorer } from "./FileExplorer";
import { ProcessManager } from "./ProcessManager";
import { DiskMountManager } from "./DiskMountManager";
import { PortManager } from "./PortManager";
import { ServiceManager } from "./ServiceManager";

export type DrawerTab = "files" | "processes" | "disks" | "ports" | "services";

interface Props {
  session: TabSession;
  height: number;
  isOpen: boolean;
  activeTab: DrawerTab;
  onTabChange?: (tab: DrawerTab) => void;
  isMaximized: boolean;
  currentUser?: string;
  isDragging?: boolean;
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
  isDragging,
  onToggleMaximize,
  onClose,
  onSendToTerminal,
}) => {
  return (
    <div
      style={{ height: isOpen ? (isMaximized ? "100%" : `${height}px`) : 0 }}
      className={`w-full flex flex-col bg-[var(--bg-app)] select-none overflow-hidden relative z-20 ${
        isDragging ? "" : "transition-[height,opacity] duration-160 ease-[var(--ease-drawer)]"
      } ${
        isOpen
          ? "border-t border-[var(--border-subtle)] opacity-100"
          : "border-t-0 opacity-0 pointer-events-none"
      }`}
    >
      {/* Main Content Area without duplicate top tab button strip */}
      <div style={{ height: isMaximized ? "100%" : `${height}px` }} className="flex-1 overflow-hidden flex flex-col min-h-0">
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

        {activeTab === "ports" && (
          <PortManager
            session={session}
            onSendToTerminal={onSendToTerminal}
            isMaximized={isMaximized}
            onToggleMaximize={onToggleMaximize}
            onClose={onClose}
          />
        )}

        {activeTab === "services" && (
          <ServiceManager
            session={session}
            onSendToTerminal={onSendToTerminal}
            isMaximized={isMaximized}
            onToggleMaximize={onToggleMaximize}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
};
