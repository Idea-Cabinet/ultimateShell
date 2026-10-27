import React, { createContext, useContext, useState, ReactNode } from "react";

export type Lang = "zh-CN" | "en-US";

export const translations = {
  "zh-CN": {
    // App Title & Brand
    "app.title": "UltimateShell",
    "app.slogan": "轻量级高性能终端",

    // Common
    "common.cancel": "取消",
    "common.confirm": "确认",
    "common.save": "保存",
    "common.delete": "删除",
    "common.edit": "编辑",
    "common.copy": "复制",
    "common.close": "关闭",
    "common.refresh": "刷新",
    "common.search": "搜索...",
    "common.loading": "加载中...",

    // Sidebar
    "sidebar.hosts": "服务器",
    "sidebar.newHost": "新建服务器",
    "sidebar.importFinalShell": "导入 FinalShell",
    "sidebar.collapse": "收起侧边栏 (Cmd+B)",
    "sidebar.expand": "展开侧边栏 (Cmd+B)",
    "sidebar.searchPlaceholder": "搜索主机或 IP...",
    "sidebar.noHosts": "无服务器连接",
    "sidebar.noHostsDesc": "点击上方按钮新建或从 FinalShell 导入",
    "sidebar.defaultGroup": "默认分组",
    "sidebar.connectedBadge": "当前处于活跃连接状态",
    "sidebar.passwordSaved": "已加密记住密码 (AES-256-GCM 硬件锁保护)",
    "sidebar.sort.recent": "最近连接",
    "sidebar.sort.newest": "最新创建",
    "sidebar.sort.oldest": "最早创建",
    "sidebar.sort.name": "按名称 A-Z",
    "sidebar.resizeWidth": "左右拖拽调整侧边栏宽度",

    // Sidebar Context Menus
    "sidebar.menu.connect": "快速连接",
    "sidebar.menu.editHost": "配置连接 (修改主机及密码)...",
    "sidebar.menu.duplicateHost": "复制连接配置",
    "sidebar.menu.changeGroup": "移动到分组...",
    "sidebar.menu.deleteHost": "移除服务器",
    "sidebar.menu.confirmDeleteHost": "确定要移除服务器 \"{name}\" 吗？",
    "sidebar.menu.newHostInGroup": "在此分组新建服务器...",
    "sidebar.menu.expandGroup": "展开此分组",
    "sidebar.menu.collapseGroup": "折叠此分组",
    "sidebar.menu.expandAllGroups": "展开全部分组",
    "sidebar.menu.collapseAllGroups": "折叠全部分组",
    "sidebar.menu.renameGroup": "重命名此分组...",
    "sidebar.menu.refreshList": "刷新服务器列表",
    "sidebar.menu.promptNewGroup": "请输入分组名称:",
    "sidebar.menu.promptRenameGroup": "重命名分组 \"{group}\" 为:",

    // TabBar
    "tab.localTerminal": "本地终端",
    "tab.remoteTerminal": "SSH 远程主机",
    "tab.newLocal": "新建本地终端",
    "tab.reconnect": "重新连接",
    "tab.duplicate": "复制标签页",
    "tab.rename": "重命名...",
    "tab.renamePrompt": "重命名标签页:",
    "tab.close": "关闭标签页",
    "tab.closeOther": "关闭其他标签页",
    "tab.closeRight": "关闭右侧标签页",
    "tab.tooltipLocal": "本地 Shell 会话 (按住可拖拽调整顺序 / 右键打开菜单)",
    "tab.tooltipRemote": "远程主机: {dest} (按住可拖拽调整顺序 / 右键打开菜单)",

    // StatusBar
    "status.ready": "就绪",
    "status.connected": "会话状态：已正常连接",
    "status.disconnected": "会话状态：已断开",
    "status.user": "用户:",
    "status.rootUser": "超级管理员特权",
    "status.normalUser": "普通权限用户",
    "status.files": "文件管理",
    "status.processes": "进程管理",
    "status.disks": "磁盘容量",
    "status.commands": "指令库",
    "status.toggleTheme": "切换外观主题",
    "status.themeDark": "当前: 深色",
    "status.themeLight": "当前: 浅色",
    "status.themeAuto": "当前: 自动跟随系统",
    "status.lang": "切换语言 (Switch Language)",

    // FileExplorer
    "files.title": "文件系统",
    "files.emptyTitle": "此目录暂无可显示项",
    "files.emptySubtitle": "当前目录为空或暂无读取权限",
    "files.goUp": "返回上一级",
    "files.goRoot": "返回根目录 (/)",
    "files.col.name": "名称",
    "files.col.mtime": "修改时间",
    "files.col.type": "类型",
    "files.col.size": "大小",
    "files.col.permissions": "权限",
    "files.col.owner": "所有者",
    "files.tree.outermost": "目录树 (最外层懒加载)",
    "files.tree.loading": "正在自动载入外层目录...",
    "files.tree.empty": "未获取到外层目录",
    "files.tree.reload": "重新载入",
    "files.filter": "快速筛选...",
    "files.showHidden": "显示隐藏文件 (查看 .bashrc/.ssh 等隐藏项)",
    "files.hideHidden": "隐藏以点开头的文件 (隐藏 .dotfiles)",
    "files.folderEmpty": "此文件夹为空",
    "files.noMatch": "未匹配到任何文件",
    "files.itemsCount": "共 {total} 项 ({dirs} 个文件夹, {files} 个文件)",
    "files.toggleTree": "展开/收起目录树",
    "files.close": "关闭文件管理器",

    // Performance
    "perf.title": "实时系统指标",
    "perf.cpu": "CPU",
    "perf.ram": "内存",
    "perf.net": "网络",
    "perf.disk": "磁盘",
    "perf.cores": "{cores} 核",
  },
  "en-US": {
    // App Title & Brand
    "app.title": "UltimateShell",
    "app.slogan": "Lightweight High-performance Terminal",

    // Common
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.copy": "Copy",
    "common.close": "Close",
    "common.refresh": "Refresh",
    "common.search": "Search...",
    "common.loading": "Loading...",

    // Sidebar
    "sidebar.hosts": "Servers",
    "sidebar.newHost": "New Server",
    "sidebar.importFinalShell": "Import FinalShell",
    "sidebar.collapse": "Collapse Sidebar (Cmd+B)",
    "sidebar.expand": "Expand Sidebar (Cmd+B)",
    "sidebar.searchPlaceholder": "Search hosts or IPs...",
    "sidebar.noHosts": "No Server Connections",
    "sidebar.noHostsDesc": "Click above to add a server or import from FinalShell",
    "sidebar.defaultGroup": "Default Group",
    "sidebar.connectedBadge": "Active connection established",
    "sidebar.passwordSaved": "Encrypted password saved (Hardware vault)",
    "sidebar.sort.recent": "Recently Connected",
    "sidebar.sort.newest": "Newest Created",
    "sidebar.sort.oldest": "Oldest Created",
    "sidebar.sort.name": "Name A-Z",
    "sidebar.resizeWidth": "Drag to resize sidebar width",

    // Sidebar Context Menus
    "sidebar.menu.connect": "Connect",
    "sidebar.menu.editHost": "Edit Server Configuration...",
    "sidebar.menu.duplicateHost": "Duplicate Server",
    "sidebar.menu.changeGroup": "Move to Group...",
    "sidebar.menu.deleteHost": "Delete Server",
    "sidebar.menu.confirmDeleteHost": "Are you sure you want to delete server \"{name}\"?",
    "sidebar.menu.newHostInGroup": "New Server in Group...",
    "sidebar.menu.expandGroup": "Expand Group",
    "sidebar.menu.collapseGroup": "Collapse Group",
    "sidebar.menu.expandAllGroups": "Expand All Groups",
    "sidebar.menu.collapseAllGroups": "Collapse All Groups",
    "sidebar.menu.renameGroup": "Rename Group...",
    "sidebar.menu.refreshList": "Refresh Server List",
    "sidebar.menu.promptNewGroup": "Enter group name:",
    "sidebar.menu.promptRenameGroup": "Rename group \"{group}\" to:",

    // TabBar
    "tab.localTerminal": "Local Terminal",
    "tab.remoteTerminal": "SSH Server",
    "tab.newLocal": "New Local Tab",
    "tab.reconnect": "Reconnect",
    "tab.duplicate": "Duplicate Tab",
    "tab.rename": "Rename...",
    "tab.renamePrompt": "Rename tab:",
    "tab.close": "Close Tab",
    "tab.closeOther": "Close Other Tabs",
    "tab.closeRight": "Close Tabs to Right",
    "tab.tooltipLocal": "Local Shell Session (Drag to reorder / Right-click for menu)",
    "tab.tooltipRemote": "Remote Server: {dest} (Drag to reorder / Right-click for menu)",

    // StatusBar
    "status.ready": "Ready",
    "status.connected": "Session status: Connected",
    "status.disconnected": "Session status: Disconnected",
    "status.user": "User:",
    "status.rootUser": "Superuser privileges",
    "status.normalUser": "Standard user privileges",
    "status.files": "Files",
    "status.processes": "Processes",
    "status.disks": "Disks",
    "status.commands": "Command Library",
    "status.toggleTheme": "Toggle Theme",
    "status.themeDark": "Current: Dark",
    "status.themeLight": "Current: Light",
    "status.themeAuto": "Current: Follow System",
    "status.lang": "Switch Language (切换语言)",

    // FileExplorer
    "files.title": "File System",
    "files.emptyTitle": "Nothing to Display",
    "files.emptySubtitle": "This folder is empty or access is restricted",
    "files.goUp": "Up",
    "files.goRoot": "Root (/)",
    "files.col.name": "Name",
    "files.col.mtime": "Date Modified",
    "files.col.type": "Type",
    "files.col.size": "Size",
    "files.col.permissions": "Permissions",
    "files.col.owner": "Owner",
    "files.tree.outermost": "Tree (Lazy Loaded)",
    "files.tree.loading": "Loading root directory...",
    "files.tree.empty": "No directories found",
    "files.tree.reload": "Reload",
    "files.filter": "Filter items...",
    "files.showHidden": "Show Hidden Files",
    "files.hideHidden": "Hide Hidden Files",
    "files.folderEmpty": "This folder is empty",
    "files.noMatch": "No matching files",
    "files.itemsCount": "{total} items ({dirs} folders, {files} files)",
    "files.toggleTree": "Toggle Directory Tree",
    "files.close": "Close File Explorer",

    // Performance
    "perf.title": "System Metrics",
    "perf.cpu": "CPU",
    "perf.ram": "Memory",
    "perf.net": "Network",
    "perf.disk": "Disk",
    "perf.cores": "{cores} Cores",
  },
} as const;

export type TranslationKey = keyof typeof translations["zh-CN"];

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem("ultimateshell_lang");
    if (saved === "zh-CN" || saved === "en-US") return saved;
    return typeof navigator !== "undefined" && navigator.language.startsWith("zh")
      ? "zh-CN"
      : "en-US";
  });

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem("ultimateshell_lang", newLang);
  };

  const toggleLang = () => {
    const next = lang === "zh-CN" ? "en-US" : "zh-CN";
    setLang(next);
  };

  const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
    const dict = translations[lang] || translations["zh-CN"];
    let text: string = dict[key] || translations["zh-CN"][key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      });
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextType => {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
};
