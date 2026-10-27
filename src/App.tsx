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

  // Load saved hosts on launch
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
    // Open a default local terminal tab on launch
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
        // If all closed, spawn a new local tab
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
      alert(`保存失败: ${err}`);
    }
  };

  const handleDeleteHost = async (id: string) => {
    if (!confirm("确定要删除此服务器连接吗？")) return;
    try {
      await invoke("delete_host", { id });
      await refreshHosts();
    } catch (err) {
      alert(`删除失败: ${err}`);
    }
  };

  const handleImportFinalShell = async () => {
    try {
      const imported = await invoke<HostProfile[]>("import_finalshell");
      await refreshHosts();
      alert(`成功导入 ${imported.length} 个 FinalShell 服务器配置！`);
    } catch (err) {
      alert(`导入失败: ${err}`);
    }
  };

  const handleRunQuickCommand = (cmd: string) => {
    if (!activeTabId) return;
    invoke("pty_write", { sessionId: activeTabId, data: cmd }).catch(console.error);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d1117] text-gray-200">
      {/* Left Sidebar */}
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
        {/* Top Tab Bar */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onCloseTab={handleCloseTab}
          onNewLocalTab={createNewLocalTab}
        />

        {/* Terminals Container */}
        <div className="flex-1 relative overflow-hidden bg-[#0d1117]">
          {tabs.map((tab) => (
            <TerminalView
              key={tab.id}
              session={tab}
              isActive={tab.id === activeTabId}
            />
          ))}
        </div>

        {/* Bottom Status Bar */}
        <div className="h-6 bg-[#161b22] border-t border-[#30363d] px-3 flex items-center justify-between text-[11px] text-gray-400 select-none">
          <div className="flex items-center space-x-3">
            <span className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              <span className="text-gray-300 font-mono">
                {activeTab ? activeTab.title : "就绪"}
              </span>
            </span>
            {activeTab?.hostProfile && (
              <span className="text-gray-500 font-mono">
                {activeTab.hostProfile.username}@{activeTab.hostProfile.host}:{activeTab.hostProfile.port}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <span>活跃会话: {tabs.length}</span>
            <span className="text-gray-500">UTF-8 / xterm-256color</span>
          </div>
        </div>
      </div>

      {/* New / Edit Host Modal */}
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
