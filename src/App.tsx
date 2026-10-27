import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HostProfile, TabSession } from "./types";
import { useTheme } from "./hooks/useTheme";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { TerminalView } from "./components/TerminalView";
import { HostModal } from "./components/HostModal";
import "./App.css";

export function App() {
  const { themeMode, setThemeMode, resolvedTheme } = useTheme();

  const [hosts, setHosts] = useState<HostProfile[]>([]);
  const [tabs, setTabs] = useState<TabSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<HostProfile | null>(null);

  // Sidebar width & collapse state
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("ultimateshell_sidebar_width");
    return saved ? parseInt(saved, 10) : 256;
  });

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("ultimateshell_sidebar_collapsed") === "true";
  });

  const handleWidthChange = (w: number) => {
    setSidebarWidth(w);
    localStorage.setItem("ultimateshell_sidebar_width", w.toString());
  };

  const handleCollapse = (collapsed: boolean) => {
    setIsSidebarCollapsed(collapsed);
    localStorage.setItem("ultimateshell_sidebar_collapsed", collapsed ? "true" : "false");
  };

  // Keyboard shortcut: Cmd+B / Ctrl+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        handleCollapse(!isSidebarCollapsed);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSidebarCollapsed]);

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
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)]">
      {/* Resizable / Collapsible macOS Sidebar */}
      <Sidebar
        hosts={hosts}
        width={sidebarWidth}
        isCollapsed={isSidebarCollapsed}
        themeMode={themeMode}
        onWidthChange={handleWidthChange}
        onCollapse={handleCollapse}
        onThemeChange={setThemeMode}
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
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Safari/macOS Styled Tab Bar with Drag Region and Sidebar Toggle */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => handleCollapse(!isSidebarCollapsed)}
          onSelectTab={setActiveTabId}
          onCloseTab={handleCloseTab}
          onNewLocalTab={createNewLocalTab}
        />

        {/* Terminals Container */}
        <div className="flex-1 relative overflow-hidden bg-[var(--bg-terminal)]">
          {tabs.map((tab) => (
            <TerminalView
              key={tab.id}
              session={tab}
              isActive={tab.id === activeTabId}
              resolvedTheme={resolvedTheme}
            />
          ))}
        </div>

        {/* Subtle macOS Status Strip */}
        <div className="h-6 apple-vibrancy-toolbar border-t border-[var(--border-subtle)] px-3 flex items-center justify-between text-[11px] text-[var(--text-tertiary)] select-none">
          <div className="flex items-center space-x-2.5 truncate">
            <span className="flex items-center space-x-1.5 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]"></span>
              <span className="text-[var(--text-secondary)] font-medium">
                {activeTab ? activeTab.title : "就绪"}
              </span>
            </span>
            {activeTab?.hostProfile && (
              <span className="text-[var(--text-tertiary)] font-mono text-[10.5px] truncate">
                {activeTab.hostProfile.username}@{activeTab.hostProfile.host}:{activeTab.hostProfile.port}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3 text-[10.5px] flex-shrink-0">
            <span>{tabs.length} 个会话</span>
            <span className="text-[var(--text-tertiary)] font-mono">
              {resolvedTheme === "dark" ? "深色外观" : "浅色外观"}
            </span>
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
