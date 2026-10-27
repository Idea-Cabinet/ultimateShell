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
    <div className="h-9 bg-[#161b22] border-b border-[#30363d] flex items-center px-1.5 space-x-1 overflow-x-auto select-none">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`group h-7 px-3 flex items-center space-x-2 text-xs rounded-md cursor-pointer transition max-w-[200px] border ${
              isActive
                ? "bg-[#0d1117] text-white border-[#30363d] shadow-sm"
                : "bg-transparent text-gray-400 hover:text-gray-200 hover:bg-[#21262d] border-transparent"
            }`}
          >
            {tab.isLocal ? (
              <Terminal className={`w-3.5 h-3.5 ${isActive ? "text-green-400" : "text-gray-500"}`} />
            ) : (
              <Server className={`w-3.5 h-3.5 ${isActive ? "text-blue-400" : "text-gray-500"}`} />
            )}
            <span className="truncate font-medium">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className={`p-0.5 rounded hover:bg-[#30363d] text-gray-500 hover:text-gray-200 transition ${
                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}

      <button
        onClick={onNewLocalTab}
        title="新建本地终端标签页"
        className="h-7 w-7 flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-[#21262d] rounded-md transition"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
};
