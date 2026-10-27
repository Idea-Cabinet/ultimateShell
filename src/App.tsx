import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HostProfile, TabSession, isDefaultGroup } from "./types";
import { useTheme } from "./hooks/useTheme";
import { useAppSettings } from "./hooks/useAppSettings";
import { useI18n } from "./i18n";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { TerminalView } from "./components/TerminalView";
import { HostModal } from "./components/HostModal";
import { SettingsModal } from "./components/SettingsModal";
import { OpsDrawer, DrawerTab } from "./components/OpsDrawer";
import { CommandAssistant } from "./components/CommandAssistant";
import { Folder, KeyRound, ShieldCheck, Sun, Moon, Monitor, Activity, HardDrive, Terminal, Globe, Settings } from "lucide-react";
import "./App.css";

interface PasswordUpdateEvent {
  host_id: string;
  host_name: string;
  new_password: string;
}

export function App() {
  const { themeMode, setThemeMode, resolvedTheme } = useTheme();
  const { settings, updateSettings } = useAppSettings();
  const { t, lang, setLang, toggleLang } = useI18n();

  const [hosts, setHosts] = useState<HostProfile[]>([]);
  const [tabs, setTabs] = useState<TabSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const initialTabCreatedRef = useRef(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<HostProfile | null>(null);

  // Status bar stats for active tab
  const [dirStats, setDirStats] = useState<{ path: string; fileCount: number }>({
    path: "/",
    fileCount: 0,
  });

  // Dynamic user detection (supports real-time prompt parsing, e.g. sudo -iu xxx)
  const [activeUser, setActiveUser] = useState<string>("root");

  // Ops Drawer state (default collapsed for zero lag on connection, tabs: files | processes | disks)
  const [isOpsDrawerOpen, setIsOpsDrawerOpen] = useState<boolean>(() => {
    return localStorage.getItem("ultimateshell_drawer_open") === "true" || localStorage.getItem("ultimateshell_explorer_open") === "true";
  });
  const [drawerActiveTab, setDrawerActiveTab] = useState<DrawerTab>(() => {
    const saved = localStorage.getItem("ultimateshell_drawer_tab");
    return (saved as DrawerTab) || "files";
  });
  const [drawerHeight, setDrawerHeight] = useState<number>(() => {
    const saved = localStorage.getItem("ultimateshell_drawer_height") || localStorage.getItem("ultimateshell_explorer_height");
    return saved ? parseInt(saved, 10) : 300;
  });
  const [isDrawerMaximized, setIsDrawerMaximized] = useState<boolean>(false);

  // Command Assistant strip state
  const [isCommandAssistantOpen, setIsCommandAssistantOpen] = useState<boolean>(() => {
    return localStorage.getItem("ultimateshell_cmd_assistant_open") === "true";
  });

  // Password update confirmation prompt
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordUpdateEvent | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let unlistenTray: (() => void) | null = null;

    listen<PasswordUpdateEvent>("ssh-password-update-prompt", (event) => {
      if (!disposed) setPasswordPrompt(event.payload);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    listen("tray-new-local-tab", () => {
      if (!disposed) createNewLocalTab();
    }).then((fn) => {
      if (disposed) fn();
      else unlistenTray = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) unlisten();
      if (unlistenTray) unlistenTray();
    };
  }, []);

  const handleAcceptPasswordUpdate = async () => {
    if (!passwordPrompt) return;
    try {
      await invoke("save_host_password", {
        hostId: passwordPrompt.host_id,
        password: passwordPrompt.new_password,
      });
      await refreshHosts();
      setPasswordPrompt(null);
    } catch (err) {
      console.error("更新密码失败:", err);
    }
  };

  const handleDeclinePasswordUpdate = () => {
    setPasswordPrompt(null);
  };

  // Vertical resize handle between terminal and Ops Drawer
  const handleStartDrawerResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = drawerHeight;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const newHeight = Math.min(Math.max(160, startH + delta), window.innerHeight - 140);
      setDrawerHeight(newHeight);
      localStorage.setItem("ultimateshell_drawer_height", newHeight.toString());
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

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
    if (!initialTabCreatedRef.current) {
      initialTabCreatedRef.current = true;
      createNewLocalTab();
    }
  }, []);

  // Poll current directory & file count stats for active tab (Requirement 5)
  useEffect(() => {
    if (!activeTabId) return;

    const fetchStats = () => {
      invoke<[string, number]>("get_session_stats", { sessionId: activeTabId })
        .then(([path, fileCount]) => {
          setDirStats({ path, fileCount });
        })
        .catch(() => {});
    };

    const timer = setTimeout(fetchStats, 150);
    const interval = setInterval(fetchStats, 10000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [activeTabId]);

  // Dynamically track username for the active tab (sudo -iu xxx or su - detection)
  useEffect(() => {
    if (!activeTabId) return;

    // 1. Initial query from PTY manager
    invoke<string>("get_session_user", { sessionId: activeTabId })
      .then((user) => {
        if (user) setActiveUser(user);
      })
      .catch(() => {});

    // 2. Real-time prompt listener
    let unlisten: (() => void) | null = null;
    listen<string>(`pty-user-${activeTabId}`, (event) => {
      if (event.payload) {
        setActiveUser(event.payload);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [activeTabId]);

  const createNewLocalTab = () => {
    const newId = `local-${Date.now()}`;
    const newTab: TabSession = {
      id: newId,
      title: t("tab.localTerminal"),
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

    // Update access time for sorting
    invoke("update_host_access_time", { hostId: host.id })
      .then(refreshHosts)
      .catch(() => {});
  };

  // Close single tab (Requirement 1: closes server connection on backend)
  const handleCloseTab = (id: string) => {
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (activeTabId === id && filtered.length > 0) {
        setActiveTabId(filtered[filtered.length - 1].id);
      } else if (filtered.length === 0) {
        const nextId = `local-${Date.now()}`;
        setActiveTabId(nextId);
        return [{ id: nextId, title: t("tab.localTerminal"), isLocal: true, connected: true }];
      }
      return filtered;
    });
  };

  // Close other tabs
  const handleCloseOtherTabs = (id: string) => {
    setTabs((prev) => prev.filter((t) => t.id === id));
    setActiveTabId(id);
  };

  // Close tabs to the right
  const handleCloseRightTabs = (id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const retained = prev.slice(0, idx + 1);
      if (!retained.some((t) => t.id === activeTabId)) {
        setActiveTabId(id);
      }
      return retained;
    });
  };

  // Duplicate tab
  const handleDuplicateTab = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.isLocal) {
      createNewLocalTab();
    } else if (tab.hostProfile) {
      handleConnect(tab.hostProfile);
    }
  };

  // Rename tab
  const handleRenameTab = (id: string, newTitle: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title: newTitle } : t))
    );
  };

  // Reconnect tab
  const handleReconnectTab = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    // Replace with fresh sessionId to reconnect
    const newId = `${tab.isLocal ? "local" : "ssh"}-${Date.now()}`;
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, id: newId } : t))
    );
    setActiveTabId(newId);
  };

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const isSidebarCollapsedRef = useRef(isSidebarCollapsed);
  isSidebarCollapsedRef.current = isSidebarCollapsed;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Native macOS Application Menu Bar action dispatcher
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    listen<string>("menu-action", (event) => {
      if (disposed) return;
      const action = event.payload;
      switch (action) {
        case "menu-settings":
          setIsSettingsOpen(true);
          break;
        case "menu-new-local-tab":
          createNewLocalTab();
          break;
        case "menu-new-host":
          setEditingHost(null);
          setIsModalOpen(true);
          break;
        case "menu-close-tab":
          if (activeTabIdRef.current) {
            handleCloseTab(activeTabIdRef.current);
          }
          break;
        case "menu-close-other-tabs":
          if (activeTabIdRef.current) {
            handleCloseOtherTabs(activeTabIdRef.current);
          }
          break;
        case "menu-clear-terminal":
          if (activeTabIdRef.current) {
            invoke("pty_write", { sessionId: activeTabIdRef.current, data: "\x0c" }).catch(console.error);
          }
          break;
        case "menu-toggle-sidebar":
          handleCollapse(!isSidebarCollapsedRef.current);
          break;
        case "menu-toggle-cmd-assistant":
          setIsCommandAssistantOpen((prev) => {
            const next = !prev;
            localStorage.setItem("ultimateshell_cmd_assistant_open", next ? "true" : "false");
            return next;
          });
          break;
        case "menu-toggle-ops-drawer":
          setIsOpsDrawerOpen((prev) => {
            const next = !prev;
            localStorage.setItem("ultimateshell_drawer_open", next ? "true" : "false");
            return next;
          });
          break;
        case "menu-zoom-in":
          updateSettings({ fontSize: Math.min(28, (settingsRef.current.fontSize || 13.5) + 1) });
          break;
        case "menu-zoom-out":
          updateSettings({ fontSize: Math.max(9, (settingsRef.current.fontSize || 13.5) - 1) });
          break;
        case "menu-zoom-reset":
          updateSettings({ fontSize: 13.5 });
          break;
        case "menu-duplicate-tab":
          if (activeTabIdRef.current) {
            handleDuplicateTab(activeTabIdRef.current);
          }
          break;
        case "menu-reconnect-session":
          if (activeTabIdRef.current) {
            handleReconnectTab(activeTabIdRef.current);
          }
          break;
        case "menu-prev-tab":
          setTabs((currentTabs) => {
            if (currentTabs.length <= 1) return currentTabs;
            const curIdx = currentTabs.findIndex((t) => t.id === activeTabIdRef.current);
            const prevIdx = (curIdx - 1 + currentTabs.length) % currentTabs.length;
            setActiveTabId(currentTabs[prevIdx].id);
            return currentTabs;
          });
          break;
        case "menu-next-tab":
          setTabs((currentTabs) => {
            if (currentTabs.length <= 1) return currentTabs;
            const curIdx = currentTabs.findIndex((t) => t.id === activeTabIdRef.current);
            const nextIdx = (curIdx + 1) % currentTabs.length;
            setActiveTabId(currentTabs[nextIdx].id);
            return currentTabs;
          });
          break;
        case "menu-help-shortcuts":
          setIsSettingsOpen(true);
          break;
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  const handleSaveHost = async (host: HostProfile, password?: string) => {
    try {
      const normalizedHost: HostProfile = {
        ...host,
        group: isDefaultGroup(host.group) ? undefined : host.group?.trim(),
      };
      await invoke("save_host", { host: normalizedHost, password });
      await refreshHosts();
    } catch (err) {
      console.error(`保存失败: ${err}`);
    }
  };

  const handleDuplicateHost = async (host: HostProfile) => {
    try {
      const newHost: HostProfile = {
        ...host,
        id: `host-${Date.now()}`,
        name: `${host.name} (副本)`,
        create_time: Date.now(),
        access_time: Date.now(),
      };
      let pwd: string | undefined = undefined;
      if (host.has_password) {
        pwd = (await invoke<string | null>("get_host_password", { hostId: host.id })) || undefined;
      }
      await invoke("save_host", { host: newHost, password: pwd });
      await refreshHosts();
    } catch (err) {
      console.error(`复制主机失败: ${err}`);
    }
  };

  const handleChangeHostGroup = async (hostId: string, newGroup: string) => {
    const target = hosts.find((h) => h.id === hostId);
    if (!target) return;
    const isDef = isDefaultGroup(newGroup);
    const updated = { ...target, group: isDef ? undefined : newGroup.trim() };
    await invoke("save_host", { host: updated });
    await refreshHosts();
  };

  const handleRenameGroup = async (oldGroup: string, newGroup: string) => {
    const trimmed = newGroup.trim();
    if (!trimmed || trimmed === oldGroup) return;
    const isOldDef = isDefaultGroup(oldGroup);
    const isNewDef = isDefaultGroup(trimmed);
    for (const h of hosts) {
      const match = isOldDef ? isDefaultGroup(h.group) : h.group === oldGroup;
      if (match) {
        await invoke("save_host", {
          host: { ...h, group: isNewDef ? undefined : trimmed },
        });
      }
    }
    await refreshHosts();
  };

  const handleDeleteHost = async (id: string) => {
    try {
      await invoke("delete_host", { id });
      await refreshHosts();
    } catch (err) {
      console.error(`删除失败: ${err}`);
    }
  };

  const handleRunQuickCommand = (cmd: string) => {
    if (!activeTabId) return;
    invoke("pty_write", { sessionId: activeTabId, data: cmd }).catch(console.error);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Requirement 3: Only servers that currently have an active tab show the green dot!
  const connectedHostIds = new Set<string>(
    tabs
      .filter((t) => !t.isLocal && t.hostProfile)
      .map((t) => t.hostProfile!.id)
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)]">
      {/* Resizable / Collapsible macOS Sidebar with Active Status & Sorting */}
      <Sidebar
        hosts={hosts}
        connectedHostIds={connectedHostIds}
        width={sidebarWidth}
        isCollapsed={isSidebarCollapsed}
        onWidthChange={handleWidthChange}
        onCollapse={handleCollapse}
        onConnect={handleConnect}
        onEdit={(host) => {
          setEditingHost(host);
          setIsModalOpen(true);
        }}
        onDelete={handleDeleteHost}
        onNewHost={(initialGroup?: string) => {
          const group = isDefaultGroup(initialGroup) ? undefined : initialGroup?.trim();
          setEditingHost(group ? {
            id: "",
            name: "",
            host: "",
            port: 22,
            username: "root",
            group,
          } : null);
          setIsModalOpen(true);
        }}
        onDuplicateHost={handleDuplicateHost}
        onChangeHostGroup={handleChangeHostGroup}
        onRenameGroup={handleRenameGroup}
        onRefreshHosts={refreshHosts}
        onRunQuickCommand={handleRunQuickCommand}
        activeSession={activeTab}
      />

      {/* Main Terminal Viewport */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Safari/macOS Styled Tab Bar with Auto-scroll and Right-click Context Menu */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => handleCollapse(!isSidebarCollapsed)}
          onSelectTab={setActiveTabId}
          onCloseTab={handleCloseTab}
          onCloseOtherTabs={handleCloseOtherTabs}
          onCloseRightTabs={handleCloseRightTabs}
          onDuplicateTab={handleDuplicateTab}
          onRenameTab={handleRenameTab}
          onReconnectTab={handleReconnectTab}
          onNewLocalTab={createNewLocalTab}
          onReorderTabs={setTabs}
        />

        {/* Terminals Container */}
        <div
          className={`relative overflow-hidden bg-[var(--bg-terminal)] border-none outline-none ${
            isOpsDrawerOpen && isDrawerMaximized ? "hidden" : "flex-1"
          }`}
        >
          {tabs.map((tab) => (
            <TerminalView
              key={tab.id}
              session={tab}
              isActive={tab.id === activeTabId}
              resolvedTheme={resolvedTheme}
              settings={settings}
            />
          ))}
        </div>

        {/* Command Assistant Bar (High priority feature: quick parameterized cmds, history, run) */}
        {activeTab && isCommandAssistantOpen && (
          <CommandAssistant
            session={activeTab}
            onSendToTerminal={handleRunQuickCommand}
            onClose={() => {
              setIsCommandAssistantOpen(false);
              localStorage.setItem("ultimateshell_cmd_assistant_open", "false");
            }}
          />
        )}

        {/* Resizer Handle between Terminal and Ops Drawer */}
        {isOpsDrawerOpen && !isDrawerMaximized && (
          <div
            onMouseDown={handleStartDrawerResize}
            onDoubleClick={() => setDrawerHeight(300)}
            className="h-1 bg-[var(--border-subtle)] hover:bg-[#007AFF] cursor-row-resize transition-colors flex items-center justify-center group select-none relative z-30"
            title="双击重置高度，拖拽调整抽屉高度"
          >
            <div className="w-8 h-0.5 rounded-full bg-[var(--text-tertiary)] group-hover:bg-[#007AFF] opacity-40 group-hover:opacity-100 transition-opacity" />
          </div>
        )}

        {/* Integrated Ops Drawer: Files SFTP, Process Manager, Disk Mounts */}
        {activeTab && (
          <OpsDrawer
            session={activeTab}
            height={drawerHeight}
            isOpen={isOpsDrawerOpen}
            isMaximized={isDrawerMaximized}
            activeTab={drawerActiveTab}
            onTabChange={(tab) => {
              setDrawerActiveTab(tab);
              localStorage.setItem("ultimateshell_drawer_tab", tab);
            }}
            onToggleMaximize={() => setIsDrawerMaximized(!isDrawerMaximized)}
            onClose={() => {
              setIsOpsDrawerOpen(false);
              localStorage.setItem("ultimateshell_drawer_open", "false");
            }}
            currentUser={activeUser}
            onSendToTerminal={handleRunQuickCommand}
          />
        )}

        {/* Bottom Status Bar with Current Path, Ops Drawer Shortcuts & Command Assistant */}
        <div className="h-6 apple-vibrancy-toolbar border-t border-[var(--border-subtle)] px-3 flex items-center justify-between text-[11px] text-[var(--text-tertiary)] select-none">
          <div className="flex items-center space-x-2 truncate">
            <span
              title={activeTab?.connected ? "会话状态：已正常连接并就绪" : "会话状态：已断开或已退出"}
              className="flex items-center space-x-1.5 flex-shrink-0 cursor-default mr-1"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${activeTab?.connected ? "bg-[#30D158]" : "bg-zinc-400"}`}></span>
              <span className="text-[var(--text-secondary)] font-medium">
                {activeTab ? activeTab.title : "就绪"}
              </span>
            </span>
            {activeTab?.hostProfile && (
              <span
                title={`远程连接目标: ${activeTab.hostProfile.username}@${activeTab.hostProfile.host}:${activeTab.hostProfile.port}`}
                className="text-[var(--text-tertiary)] font-mono text-[10.5px] truncate cursor-default pr-1 hidden sm:inline"
              >
                {activeTab.hostProfile.username}@{activeTab.hostProfile.host}:{activeTab.hostProfile.port}
              </span>
            )}

            {/* Toggle File Explorer Tab */}
            <button
              onClick={() => {
                if (isOpsDrawerOpen && drawerActiveTab === "files") {
                  setIsOpsDrawerOpen(false);
                  localStorage.setItem("ultimateshell_drawer_open", "false");
                } else {
                  setIsOpsDrawerOpen(true);
                  setDrawerActiveTab("files");
                  localStorage.setItem("ultimateshell_drawer_open", "true");
                  localStorage.setItem("ultimateshell_drawer_tab", "files");
                }
              }}
              className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[10px] font-mono border transition-all ${
                isOpsDrawerOpen && drawerActiveTab === "files"
                  ? "bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/40 font-medium"
                  : "bg-[var(--hover-item)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
              }`}
              title="切换/展开可视化文件树 (Windows/SFTP 风格按需懒加载)"
            >
              <Folder className="w-3 h-3 text-[#007AFF]" />
              <span>{dirStats.path}</span>
              <span className="text-[var(--text-tertiary)]">·</span>
              <span>{dirStats.fileCount} 项</span>
              {activeUser && (
                <>
                  <span className="text-[var(--text-tertiary)]">·</span>
                  <span
                    title={
                      activeUser === "root"
                        ? "当前终端身份: root (超级管理员特权)"
                        : `当前终端身份: ${activeUser} (普通权限用户)`
                    }
                    className={`px-1 rounded text-[9.5px] font-mono font-medium border flex items-center space-x-1 ${
                      activeUser === "root"
                        ? "bg-rose-500/15 text-rose-500 border-rose-500/30"
                        : "bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/30"
                    }`}
                  >
                    <span
                      className={`w-1 h-1 rounded-full ${
                        activeUser === "root" ? "bg-rose-500" : "bg-[#007AFF]"
                      }`}
                    />
                    <span>{activeUser}</span>
                  </span>
                </>
              )}
            </button>

            {/* Toggle Process Manager Tab */}
            <button
              onClick={() => {
                if (isOpsDrawerOpen && drawerActiveTab === "processes") {
                  setIsOpsDrawerOpen(false);
                  localStorage.setItem("ultimateshell_drawer_open", "false");
                } else {
                  setIsOpsDrawerOpen(true);
                  setDrawerActiveTab("processes");
                  localStorage.setItem("ultimateshell_drawer_open", "true");
                  localStorage.setItem("ultimateshell_drawer_tab", "processes");
                }
              }}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] border transition-all ${
                isOpsDrawerOpen && drawerActiveTab === "processes"
                  ? "bg-[#30D158]/15 text-[#30D158] border-[#30D158]/40 font-medium"
                  : "bg-[var(--hover-item)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
              }`}
              title="查看与管理进程（支持按 CPU / 内存排序、结束进程）"
            >
              <Activity className="w-3 h-3 text-[#30D158]" />
              <span>{t("status.processes")}</span>
            </button>

            {/* Toggle Disk Partitions Tab */}
            <button
              onClick={() => {
                if (isOpsDrawerOpen && drawerActiveTab === "disks") {
                  setIsOpsDrawerOpen(false);
                  localStorage.setItem("ultimateshell_drawer_open", "false");
                } else {
                  setIsOpsDrawerOpen(true);
                  setDrawerActiveTab("disks");
                  localStorage.setItem("ultimateshell_drawer_open", "true");
                  localStorage.setItem("ultimateshell_drawer_tab", "disks");
                }
              }}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] border transition-all ${
                isOpsDrawerOpen && drawerActiveTab === "disks"
                  ? "bg-amber-500/15 text-amber-500 border-amber-500/40 font-medium"
                  : "bg-[var(--hover-item)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
              }`}
              title="查看各挂载点磁盘容量、可用空间及占比"
            >
              <HardDrive className="w-3 h-3 text-amber-500" />
              <span>{t("status.disks")}</span>
            </button>

            {/* Toggle Command Assistant Bar */}
            <button
              onClick={() => {
                const next = !isCommandAssistantOpen;
                setIsCommandAssistantOpen(next);
                localStorage.setItem("ultimateshell_cmd_assistant_open", next ? "true" : "false");
              }}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] border transition-all ${
                isCommandAssistantOpen
                  ? "bg-purple-500/15 text-purple-500 border-purple-500/40 font-medium"
                  : "bg-[var(--hover-item)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
              }`}
              title="独立命令输入辅助栏（智能模版、参数填写、历史记录）"
            >
              <Terminal className="w-3 h-3 text-purple-500" />
              <span>{t("status.commands")}</span>
            </button>
          </div>

          <div className="flex items-center space-x-2 text-[10.5px] flex-shrink-0">
            <span title="当前标签栏中打开的所有终端会话总数" className="cursor-default pr-1">
              {tabs.length} {lang === "zh-CN" ? "个会话" : "tabs"}
            </span>

            {/* Language Switcher Button */}
            <button
              onClick={toggleLang}
              title={t("status.lang")}
              className="px-1.5 py-0.5 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all active:scale-95 flex items-center space-x-1 font-mono text-[10px] font-semibold border border-[var(--border-subtle)]"
            >
              <Globe className="w-3 h-3 text-[#007AFF]" />
              <span>{lang === "zh-CN" ? "中" : "EN"}</span>
            </button>

            {/* Theme Toggle Button: Cycles System -> Light -> Dark -> System */}
            <button
              onClick={() => {
                if (themeMode === "system") {
                  setThemeMode("light");
                } else if (themeMode === "light") {
                  setThemeMode("dark");
                } else {
                  setThemeMode("system");
                }
              }}
              title={
                themeMode === "system"
                  ? `外观模式：跟随系统自动 (当前呈现${resolvedTheme === "dark" ? "深色" : "浅色"}，点击切换为浅色)`
                  : themeMode === "light"
                  ? "外观模式：浅色明亮 (点击切换为深色)"
                  : "外观模式：深色暗黑 (点击切换为跟随系统自动)"
              }
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all active:scale-95 flex items-center justify-center relative"
            >
              {themeMode === "system" ? (
                <div className="relative flex items-center justify-center">
                  <Monitor className="w-3.5 h-3.5 text-[#007AFF]" />
                  <span className="absolute -bottom-0.5 -right-0.5 text-[7px] font-bold font-mono text-[#007AFF] leading-none">
                    A
                  </span>
                </div>
              ) : themeMode === "light" ? (
                <Sun className="w-3.5 h-3.5 text-amber-500" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-indigo-400" />
              )}
            </button>

            {/* Quick Settings Button */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              title={t("status.settings")}
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all active:scale-95 flex items-center justify-center"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Floating Password Update Sheet Prompt */}
      {passwordPrompt && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/35 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="apple-card rounded-2xl w-[440px] p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)]">
            <div className="flex items-start space-x-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#007AFF]/15 text-[#007AFF] flex items-center justify-center flex-shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold tracking-tight">更新服务器登录密码？</div>
                <div className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                  检测到你已通过新密码成功登录「
                  <span className="font-medium text-[var(--text-primary)]">{passwordPrompt.host_name}</span>
                  」。是否将新密码加密更新到本地硬件保险库（AES-256-GCM 加密），以便下次免密自动连接？
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-5">
              <button
                type="button"
                onClick={handleDeclinePasswordUpdate}
                className="px-4 py-1.5 text-[12.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--active-item)] hover:bg-[var(--hover-item)] rounded-[8px] active:scale-[0.97] transition-all"
              >
                暂不更新
              </button>
              <button
                type="button"
                onClick={handleAcceptPasswordUpdate}
                className="px-4 py-1.5 text-[12.5px] font-medium text-white bg-[#007AFF] hover:bg-[#0A84FF] rounded-[8px] shadow-[0_1px_3px_rgba(0,122,255,0.4)] active:scale-[0.97] transition-all flex items-center space-x-1.5"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>更新密码</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* macOS Sheet Modal with Hardware Fingerprint Password Vault */}
      <HostModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveHost}
        initialHost={editingHost}
      />

      {/* Preferences & Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={updateSettings}
        themeMode={themeMode}
        onThemeChange={setThemeMode}
        lang={lang}
        onLangChange={setLang}
      />
    </div>
  );
}

export default App;
