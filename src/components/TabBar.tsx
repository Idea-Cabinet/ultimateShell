import React from "react";
import { TabSession } from "../types";
import { Terminal, Server, Plus, X, PanelLeft } from "lucide-react";

interface Props {
  tabs: TabSession[];
  activeTabId: string;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewLocalTab: () => void;
}

export const TabBar: React.FC<Props> = ({
  tabs,
  activeTabId,
  isSidebarCollapsed,
  onToggleSidebar,
  onSelectTab,
  onCloseTab,
  onNewLocalTab,
}) => {
  return (
    <div
      data-tauri-drag-region
      className={`h-12 apple-vibrancy-toolbar border-b border-[var(--border-subtle)] flex items-center px-3 space-x-1.5 overflow-x-auto select-none z-10 transition-all ${
        isSidebarCollapsed ? "pl-[78px]" : ""
      }`}
    >
      {/* Sidebar Toggle Button (shows always, especially handy when collapsed) */}
      <button
        onClick={onToggleSidebar}
        title={isSidebarCollapsed ? "展开侧边栏 (Cmd+B)" : "收起侧边栏 (Cmd+B)"}
        className="h-7 w-7 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] rounded-[6px] transition active:scale-[0.95] flex-shrink-0 mr-1"
      >
        <PanelLeft className="w-4 h-4" strokeWidth={1.75} />
      </button>

      {/* Tabs List */}
      <div className="flex items-center space-x-1 flex-1 overflow-x-auto py-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group h-8 px-2.5 flex items-center space-x-2 text-[12px] rounded-[7px] cursor-pointer transition max-w-[200px] min-w-[120px] ${
                isActive
                  ? "bg-[var(--active-tab-bg)] text-[var(--text-primary)] shadow-[var(--active-tab-shadow)] border border-[var(--border-subtle)] font-medium"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] border border-transparent font-normal"
              }`}
            >
              {tab.isLocal ? (
                <Terminal className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-[#30D158]" : "text-[var(--text-tertiary)]"}`} strokeWidth={1.75} />
              ) : (
                <Server className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-[#007AFF]" : "text-[var(--text-tertiary)]"}`} strokeWidth={1.75} />
              )}
              <span className="truncate flex-1 tracking-tight">{tab.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className={`p-0.5 rounded-full hover:bg-[var(--hover-item)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition ${
                  isActive ? "opacity-80 hover:opacity-100" : "opacity-0 group-hover:opacity-80"
                }`}
              >
                <X className="w-3 h-3" strokeWidth={2} />
              </button>
            </div>
          );
        })}

        <button
          onClick={onNewLocalTab}
          title="新建本地终端"
          className="h-7 w-7 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] rounded-[6px] transition active:scale-[0.95]"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
};
