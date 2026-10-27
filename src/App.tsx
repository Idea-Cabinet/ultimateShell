import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HostProfile, TabSession } from "./types";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { TerminalView } from "./components/TerminalView";
import { HostModal } from "./components/HostModal";
import "./App.css";

export function App() {
  const [hosts, setHosts] = useState<HostProfile[]>([]);
  const [tabs, setTabs] = useState<TabSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<HostProfile | null>(null);

  const refreshHosts = async () => {
    try {
      const data = await invoke<HostProfile[]>("get_hosts");
      setHosts(data);
    } catch (err) {
      console.error("Failed to load hosts:", err);
    }
  };

  useEffect(() => {
    refreshHosts();
    createNewLocalTab();
  }, []);

  const createNewLocalTab = () => {
    const newId = `local-${Date.now()}`;
    const newTab: TabSession = {
      id: newId,
      title: "本地终端",
      isLocal: true,
      connected: true,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const handleConnect = (host: HostProfile) => {
    const newId = `ssh-${host.id}-${Date.now()}`;
    const newTab: TabSession = {
      id: newId,
      title: `${host.name}`,
      isLocal: false,
      hostProfile: host,
      connected: true,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (id: string) => {
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (activeTabId === id && filtered.length > 0) {
        setActiveTabId(filtered[filtered.length - 1].id);
      } else if (filtered.length === 0) {
        const nextId = `local-${Date.now()}`;
        setActiveTabId(nextId);
        return [{ id: nextId, title: "本地终端", isLocal: true, connected: true }];
      }
      return filtered;
    });
  };

  const handleSaveHost = async (host: HostProfile) => {
    try {
      await invoke("save_host", { host });
      await refreshHosts();
    } catch (err) {
      console.error(`保存失败: ${err}`);
    }
  };

  const handleDeleteHost = async (id: string) => {
    try {
      await invoke("delete_host", { id });
      await refreshHosts();
    } catch (err) {
      console.error(`删除失败: ${err}`);
    }
  };

  const handleImportFinalShell = async () => {
    try {
      const imported = await invoke<HostProfile[]>("import_finalshell");
      await refreshHosts();
      console.log(`成功导入 ${imported.length} 个 FinalShell 服务器配置`);
    } catch (err) {
      console.error(`导入失败: ${err}`);
    }
  };

  const handleRunQuickCommand = (cmd: string) => {
    if (!activeTabId) return;
    invoke("pty_write", { sessionId: activeTabId, data: cmd }).catch(console.error);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#121214] text-[#f5f5f7]">
      {/* macOS Sidebar */}
      <Sidebar
        hosts={hosts}
        onConnect={handleConnect}
        onEdit={(host) => {
          setEditingHost(host);
          setIsModalOpen(true);
        }}
        onDelete={handleDeleteHost}
        onNewHost={() => {
          setEditingHost(null);
          setIsModalOpen(true);
        }}
        onImportFinalShell={handleImportFinalShell}
        onRunQuickCommand={handleRunQuickCommand}
      />

      {/* Main Terminal Viewport */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Safari/macOS Styled Tab Bar with Drag Region */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onCloseTab={handleCloseTab}
          onNewLocalTab={createNewLocalTab}
        />

        {/* Terminals Container */}
        <div className="flex-1 relative overflow-hidden bg-[#121214]">
          {tabs.map((tab) => (
            <TerminalView
              key={tab.id}
              session={tab}
              isActive={tab.id === activeTabId}
            />
          ))}
        </div>

        {/* Subtle macOS Status Strip */}
        <div className="h-6 apple-vibrancy-toolbar border-t border-white/[0.06] px-3 flex items-center justify-between text-[11px] text-white/40 select-none">
          <div className="flex items-center space-x-2.5">
            <span className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]"></span>
              <span className="text-white/70 font-medium">
                {activeTab ? activeTab.title : "就绪"}
              </span>
            </span>
            {activeTab?.hostProfile && (
              <span className="text-white/30 font-mono text-[10.5px]">
                {activeTab.hostProfile.username}@{activeTab.hostProfile.host}:{activeTab.hostProfile.port}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3 text-[10.5px]">
            <span>{tabs.length} 个会话</span>
            <span className="text-white/20 font-mono">UTF-8 / xterm</span>
          </div>
        </div>
      </div>

      {/* macOS Sheet Modal */}
      <HostModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveHost}
        initialHost={editingHost}
      />
    </div>
  );
}

export default App;
