import React, { useState, useEffect, useRef } from "react";
import { TabSession } from "../types";
import {
  Terminal,
  Server,
  Plus,
  X,
  PanelLeft,
  RotateCw,
  Copy,
  Edit3,
  XCircle,
  ArrowRightCircle,
} from "lucide-react";

interface Props {
  tabs: TabSession[];
  activeTabId: string;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseRightTabs: (id: string) => void;
  onDuplicateTab: (id: string) => void;
  onRenameTab: (id: string, newTitle: string) => void;
  onReconnectTab: (id: string) => void;
  onNewLocalTab: () => void;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  tabId: string;
}

export const TabBar: React.FC<Props> = ({
  tabs,
  activeTabId,
  isSidebarCollapsed,
  onToggleSidebar,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseRightTabs,
  onDuplicateTab,
  onRenameTab,
  onReconnectTab,
  onNewLocalTab,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevTabsLengthRef = useRef(tabs.length);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    tabId: "",
  });

  // Auto scroll to latest tab ONLY when tabs are added or removed
  useEffect(() => {
    if (tabs.length > prevTabsLengthRef.current) {
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            left: scrollContainerRef.current.scrollWidth,
            behavior: "smooth",
          });
        }
      }, 50);
    }
    prevTabsLengthRef.current = tabs.length;
  }, [tabs.length]);

  // Close context menu on global click or Escape
  useEffect(() => {
    const handleGlobalClick = () => {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu.visible]);

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  };

  const handleRename = () => {
    const tab = tabs.find((t) => t.id === contextMenu.tabId);
    if (!tab) return;
    const newName = prompt("重命名标签页:", tab.title);
    if (newName && newName.trim()) {
      onRenameTab(contextMenu.tabId, newName.trim());
    }
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  return (
    <>
      <div
        data-tauri-drag-region
        className={`h-12 apple-vibrancy-toolbar border-b border-[var(--border-subtle)] flex items-center px-3 space-x-1.5 select-none z-10 transition-[padding] duration-[180ms] ${
          isSidebarCollapsed ? "pl-[78px]" : ""
        }`}
      >
        {/* Sidebar Toggle Button */}
        <button
          onClick={onToggleSidebar}
          title={isSidebarCollapsed ? "展开侧边栏 (Cmd+B)" : "收起侧边栏 (Cmd+B)"}
          className="h-7 w-7 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] rounded-[6px] transition active:scale-[0.95] flex-shrink-0 mr-1"
        >
          <PanelLeft className="w-4 h-4" strokeWidth={1.75} />
        </button>

        {/* Tabs List (Auto-scrolls on add/remove, supports manual dragging/scrolling) */}
        <div
          ref={scrollContainerRef}
          className="flex items-center space-x-1 flex-1 overflow-x-auto py-1 scroll-smooth"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
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

      {/* Right-click Context Menu Popover (macOS Styled) */}
      {contextMenu.visible && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 apple-card rounded-xl py-1.5 w-44 shadow-2xl text-[12px] text-[var(--text-primary)] animate-in fade-in zoom-in-95 duration-100 select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onReconnectTab(contextMenu.tabId);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
          >
            <RotateCw className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>重新连接</span>
          </button>

          <button
            onClick={() => {
              onDuplicateTab(contextMenu.tabId);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
          >
            <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>复制标签页</span>
          </button>

          <button
            onClick={handleRename}
            className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
          >
            <Edit3 className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>重命名...</span>
          </button>

          <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

          <button
            onClick={() => {
              onCloseTab(contextMenu.tabId);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>关闭标签页</span>
          </button>

          <button
            onClick={() => {
              onCloseOtherTabs(contextMenu.tabId);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
          >
            <XCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>关闭其他标签页</span>
          </button>

          <button
            onClick={() => {
              onCloseRightTabs(contextMenu.tabId);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
          >
            <ArrowRightCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>关闭右侧标签页</span>
          </button>
        </div>
      )}
    </>
  );
};
