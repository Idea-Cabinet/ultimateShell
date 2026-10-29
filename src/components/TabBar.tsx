import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePointerReorder } from "../hooks/usePointerReorder";
import { useI18n } from "../i18n";
import { TabSession } from "../types";
import {
  Terminal,
  Server,
  Plus,
  X,
  RotateCw,
  Copy,
  Edit3,
  XCircle,
  ArrowRightCircle,
  Radio,
} from "lucide-react";

interface Props {
  tabs: TabSession[];
  activeTabId: string;
  isSidebarCollapsed: boolean;
  isBroadcastActive?: boolean;
  onToggleBroadcast?: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseRightTabs: (id: string) => void;
  onDuplicateTab: (id: string) => void;
  onRenameTab: (id: string, newTitle: string) => void;
  onReconnectTab: (id: string) => void;
  onNewLocalTab: () => void;
  onReorderTabs?: (newTabs: TabSession[]) => void;
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
  isBroadcastActive = false,
  onToggleBroadcast,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseRightTabs,
  onDuplicateTab,
  onRenameTab,
  onReconnectTab,
  onNewLocalTab,
  onReorderTabs,
}) => {
  const { t } = useI18n();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevTabsLengthRef = useRef(tabs.length);

  const reorder = usePointerReorder(tabs, (next) => onReorderTabs?.(next), scrollContainerRef);

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
    const defaultTitle = tab.isLocal && !tab.isRenamed ? t("tab.localTerminal") : tab.title;
    const newName = prompt(t("tab.renamePrompt"), defaultTitle);
    if (newName && newName.trim()) {
      onRenameTab(contextMenu.tabId, newName.trim());
    }
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  return (
    <>
      <div
        className={`app-titlebar apple-vibrancy-toolbar border-b border-[var(--border-subtle)] flex items-center px-3 space-x-1.5 select-none z-10 transition-[padding] duration-160 ease-[var(--ease-drawer)] ${
          isSidebarCollapsed ? "pl-[118px]" : ""
        }`}
      >
        {/* Tabs List (Supports drag-and-drop reordering, auto-scrolls on add/remove) */}
        <div
          ref={scrollContainerRef}
          data-tauri-drag-region="false"
          className="flex items-center space-x-1 max-w-full overflow-x-auto py-1 scroll-smooth"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const isDragging = reorder.draggedId === tab.id;
            const isDragOver = reorder.dropTarget?.id === tab.id;

            return (
              <div
                key={tab.id}
                draggable={false}
                data-tauri-drag-region="false"
                data-reorder-id={tab.id}
                style={{ touchAction: "none" }}
                onPointerDown={(e) => reorder.onPointerDown(e, tab.id)}
                onClick={() => {
                  if (reorder.suppressClick()) return;
                  onSelectTab(tab.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                title={tab.isLocal ? t("tab.tooltipLocal") : t("tab.tooltipRemote", { dest: `${tab.hostProfile?.username}@${tab.hostProfile?.host}` })}
                className={`group h-8 px-2.5 flex items-center space-x-2 text-[12px] rounded-[7px] cursor-grab active:cursor-grabbing transition max-w-[200px] min-w-[120px] relative select-none ${
                  isActive
                    ? "bg-[var(--active-tab-bg)] text-[var(--text-primary)] shadow-[var(--active-tab-shadow)] border border-[var(--border-subtle)] font-medium"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] border border-transparent font-normal"
                } ${isDragging ? "opacity-35 scale-[0.98]" : ""} ${
                  isDragOver
                    ? reorder.dropTarget?.position === "left"
                      ? "before:content-[''] before:absolute before:left-[-2px] before:top-1.5 before:bottom-1.5 before:w-1 before:bg-[#007AFF] before:rounded-full before:z-30 bg-[#007AFF]/10"
                      : "after:content-[''] after:absolute after:right-[-2px] after:top-1.5 after:bottom-1.5 after:w-1 after:bg-[#007AFF] after:rounded-full after:z-30 bg-[#007AFF]/10"
                    : ""
                }`}
              >
                {tab.isLocal ? (
                  <span title={t("tab.localTerminal")} className="inline-flex items-center pointer-events-none">
                    <Terminal className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-[#30D158]" : "text-[var(--text-tertiary)]"}`} strokeWidth={1.75} />
                  </span>
                ) : (
                  <span title={t("tab.remoteTerminal")} className="inline-flex items-center pointer-events-none">
                    <Server className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-[#007AFF]" : "text-[var(--text-tertiary)]"}`} strokeWidth={1.75} />
                  </span>
                )}
                <span className="truncate flex-1 tracking-tight pointer-events-none">
                  {tab.isLocal && !tab.isRenamed ? t("tab.localTerminal") : tab.title}
                </span>
                <button
                  draggable={false}
                  data-tauri-drag-region="false"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  title={t("tab.close")}
                  className={`p-0.5 rounded-full hover:bg-[var(--hover-item)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition ${
                    isActive ? "opacity-80 hover:opacity-100" : "opacity-0 group-hover:opacity-80"
                  }`}
                >
                  <X className="w-3 h-3 pointer-events-none" strokeWidth={2} />
                </button>
              </div>
            );
          })}

          <button
            draggable={false}
            data-tauri-drag-region="false"
            onClick={onNewLocalTab}
            title={t("tab.newLocal")}
            className="h-7 w-7 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] rounded-[6px] transition active:scale-[0.95] flex-shrink-0"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          </button>

          {tabs.length > 1 && onToggleBroadcast && (
            <button
              draggable={false}
              data-tauri-drag-region="false"
              onClick={onToggleBroadcast}
              title={
                isBroadcastActive
                  ? t("tab.broadcastTooltipOn")
                  : t("tab.broadcastTooltipOff")
              }
              className={`h-7 flex items-center rounded-[6px] transition-all duration-300 ease-out flex-shrink-0 select-none ml-1 overflow-hidden group ${
                isBroadcastActive
                  ? "bg-rose-500 text-white px-2 shadow-sm shadow-rose-500/25 active:scale-[0.98]"
                  : "w-7 justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] active:scale-[0.95]"
              }`}
            >
              <Radio
                className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200 ${
                  isBroadcastActive ? "animate-pulse scale-105" : "group-hover:scale-110"
                }`}
              />

              {/* Status display expanding smoothly to the right */}
              <div
                className={`flex items-center space-x-1.5 overflow-hidden transition-all duration-300 ease-out ${
                  isBroadcastActive
                    ? "max-w-[150px] opacity-100 ml-1.5 pointer-events-auto"
                    : "max-w-0 opacity-0 ml-0 pointer-events-none"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping flex-shrink-0" />
                <span className="text-[11px] font-medium tracking-tight whitespace-nowrap">
                  {t("tab.broadcastStatus", { count: tabs.length })}
                </span>
                <X className="w-3 h-3 opacity-60 hover:opacity-100 flex-shrink-0 transition-opacity ml-0.5" />
              </div>
            </button>
          )}
        </div>

        {/* Trailing Draggable Area for Window Dragging */}
        <div data-tauri-drag-region className="flex-1 h-full min-w-[20px]" />
      </div>

      {/* Right-click Context Menu Popover (macOS Styled, Portaled to document.body at top z-index) */}
      {contextMenu.visible &&
        createPortal(
          <div
            style={{
              top: `${Math.max(10, Math.min(contextMenu.y, window.innerHeight - 240))}px`,
              left: `${Math.max(10, Math.min(contextMenu.x, window.innerWidth - 190))}px`,
              zIndex: 9999,
            }}
            className="fixed apple-card rounded-xl py-1.5 w-44 shadow-2xl text-[12px] text-[var(--text-primary)] animate-in fade-in zoom-in-95 duration-100 select-none border border-[var(--border-subtle)]"
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
            <span>{t("tab.reconnect")}</span>
          </button>

          <button
            onClick={() => {
              onDuplicateTab(contextMenu.tabId);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
          >
            <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>{t("tab.duplicate")}</span>
          </button>

          <button
            onClick={handleRename}
            className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
          >
            <Edit3 className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>{t("tab.rename")}</span>
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
            <span>{t("tab.close")}</span>
          </button>

          <button
            onClick={() => {
              onCloseOtherTabs(contextMenu.tabId);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
          >
            <XCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>{t("tab.closeOther")}</span>
          </button>

          <button
            onClick={() => {
              onCloseRightTabs(contextMenu.tabId);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#007AFF] hover:text-white text-left transition"
          >
            <ArrowRightCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>{t("tab.closeRight")}</span>
          </button>
        </div>,
        document.body
      )}
    </>
  );
};
