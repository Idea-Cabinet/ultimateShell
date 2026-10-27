import React from "react";
import { TabSession } from "../types";
import { Terminal, Server, Plus, X } from "lucide-react";

interface Props {
  tabs: TabSession[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewLocalTab: () => void;
}

export const TabBar: React.FC<Props> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewLocalTab,
}) => {
  return (
    <div
      data-tauri-drag-region
      className="h-12 apple-vibrancy-toolbar border-b border-white/[0.08] flex items-center px-3 space-x-1.5 overflow-x-auto select-none z-10"
    >
      <div className="flex items-center space-x-1 flex-1 overflow-x-auto py-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group h-8 px-2.5 flex items-center space-x-2 text-[12px] rounded-[7px] cursor-pointer transition max-w-[200px] min-w-[120px] ${
                isActive
                  ? "bg-[#25252a] text-white shadow-[0_2px_6px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] border border-white/[0.1] font-medium"
                  : "text-white/50 hover:text-white/80 hover:bg-white/[0.05] border border-transparent font-normal"
              }`}
            >
              {tab.isLocal ? (
                <Terminal className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-[#30D158]" : "text-white/40"}`} strokeWidth={1.75} />
              ) : (
                <Server className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-[#0A84FF]" : "text-white/40"}`} strokeWidth={1.75} />
              )}
              <span className="truncate flex-1 tracking-tight">{tab.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className={`p-0.5 rounded-full hover:bg-white/[0.15] text-white/40 hover:text-white transition ${
                  isActive ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70"
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
          className="h-7 w-7 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] rounded-[6px] transition active:scale-[0.95]"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
};
