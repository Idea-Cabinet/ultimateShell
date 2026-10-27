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
    "sidebar.collapse": "收起侧边栏 (Cmd+B)",
    "sidebar.expand": "展开侧边栏 (Cmd+B)",
    "sidebar.searchPlaceholder": "搜索主机或 IP...",
    "sidebar.noHosts": "无服务器连接",
    "sidebar.noHostsDesc": "点击上方按钮新建服务器",
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
    "sidebar.menu.editHost": "配置连接...",
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
    "perf.realtime": "实时监控",
    "perf.load": "负载",
    "perf.netTraffic": "网络流量",
    "perf.diskIO": "磁盘 IO",
    "perf.read": "读",
    "perf.write": "写",
    "perf.doubleClickToggle": "双击折叠 / 展开监控",

    // Host Modal
    "modal.host.addTitle": "添加服务器连接",
    "modal.host.editTitle": "编辑服务器连接",
    "modal.host.subtitle": "配置 SSH 远程主机连接与硬件加密凭据",
    "modal.host.name": "名称",
    "modal.host.namePlaceholder": "例如: 生产机器 / 香港主节点",
    "modal.host.address": "主机地址 / IP",
    "modal.host.port": "端口",
    "modal.host.username": "用户名",
    "modal.host.group": "分组",
    "modal.host.password": "服务器登录密码 (硬件指纹安全加密)",
    "modal.host.passwordPlaceholder": "输入密码以实现免密自动连接",
    "modal.host.showPassword": "显示密码",
    "modal.host.hidePassword": "隐藏密码",
    "modal.host.privateKey": "私钥文件 (可选)",
    "modal.host.privateKeyPlaceholder": "~/.ssh/id_rsa 或从右侧选择私钥",
    "modal.host.selectFile": "选择文件",
    "modal.host.description": "备注",
    "modal.host.descriptionPlaceholder": "可选备忘说明",

    // Command Assistant
    "cmd.smartMatch": "智能匹配:",
    "cmd.inputPlaceholder": "输入指令 (回车发送至活跃终端，↑/↓ 键历史漫游，输入关键词匹配命令模板)...",
    "cmd.clearInput": "清空输入框",
    "cmd.historyTitle": "历史命令",
    "cmd.historyTip": "查看客户端历史命令",
    "cmd.historyClear": "清空",
    "cmd.historyEmpty": "暂无历史命令",
    "cmd.runNow": "立即执行",
    "cmd.library": "参数化指令库",
    "cmd.send": "发送至终端",
    "cmd.fillParams": "填写参数并执行",
    "cmd.smartReplace": "智能参数化指令替换",
    "cmd.preview": "指令预览",
    "cmd.executeAndSend": "执行并发送",
    "cmd.searchTemplates": "搜索模板或分类...",
    "cmd.allCategories": "全部分类",

    // Process Manager
    "process.title": "进程管理",
    "process.searchPlaceholder": "过滤进程名称、PID 或用户...",
    "process.autoRefresh": "自动刷新",
    "process.refresh": "刷新列表",
    "process.colPid": "PID",
    "process.colUser": "用户",
    "process.colCpu": "CPU %",
    "process.colMem": "内存 %",
    "process.colCommand": "命令行",
    "process.action": "操作",
    "process.kill": "结束",
    "process.confirmKill": "结束进程",
    "process.confirmKillDesc": "确定向进程 PID {pid} ({cmd}) 发送终止信号吗？",
    "process.sigterm": "正常终止 (SIGTERM - 15)",
    "process.sigkill": "强制终止 (SIGKILL - 9)",
    "process.killSuccess": "进程终止信号已发送",

    // Disk Mount Manager
    "disk.title": "磁盘分区与挂载点",
    "disk.refresh": "刷新挂载点",
    "disk.colFs": "文件系统",
    "disk.colMount": "挂载点",
    "disk.colTotal": "总容量",
    "disk.colUsed": "已用",
    "disk.colAvail": "可用",
    "disk.colUsePercent": "使用率",

    // Settings Modal
    "settings.title": "首选项与设置",
    "settings.subtitle": "个性化配置 UltimateShell 终端体验与常用设置",
    "settings.tabGeneral": "通用设置",
    "settings.tabTerminal": "终端体验",
    "settings.tabSecurity": "安全与连接",
    "settings.lang": "界面语言",
    "settings.langDesc": "选择应用程序界面显示的语言",
    "settings.theme": "外观主题",
    "settings.themeDesc": "根据偏好选择明暗外观风格",
    "settings.themeSystem": "跟随系统",
    "settings.themeLight": "浅色模式",
    "settings.themeDark": "深色模式",
    "settings.trayClose": "窗口关闭行为",
    "settings.trayCloseDesc": "点击关闭按钮时最小化到系统托盘，保持后台会话连接",
    "settings.trayCloseOption": "最小化到托盘 (保持后台运行)",
    "settings.fontSize": "终端字体大小",
    "settings.fontSizeDesc": "调整终端字符显示尺寸",
    "settings.cursorStyle": "光标样式",
    "settings.cursorStyleDesc": "选择终端输入光标形状",
    "settings.cursorBlock": "方块 (Block)",
    "settings.cursorBar": "竖线 (Bar)",
    "settings.cursorUnderline": "下划线 (Underline)",
    "settings.cursorBlink": "光标闪烁",
    "settings.cursorBlinkDesc": "启用或禁用光标周期性闪烁",
    "settings.scrollback": "历史回滚行数",
    "settings.scrollbackDesc": "终端保留的最大历史输出行数",
    "settings.vaultSecurity": "安全加密标准",
    "settings.vaultDesc": "本地主机凭据使用机器硬件指纹绑定 + AES-256-GCM 保护",
    "settings.clearCache": "清除历史缓存",
    "settings.clearCacheDesc": "清空本地存储的历史命令与临时缓存",
    "settings.clearCacheBtn": "清空缓存",
    "settings.clearCacheSuccess": "已成功清空本地缓存",

    // Status Bar & Controls
    "status.settings": "常用设置",
    "status.sessionsCount": "{count} 个会话",
    "status.filesCount": "{count} 项",
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
    "sidebar.collapse": "Collapse Sidebar (Cmd+B)",
    "sidebar.expand": "Expand Sidebar (Cmd+B)",
    "sidebar.searchPlaceholder": "Search hosts or IPs...",
    "sidebar.noHosts": "No Server Connections",
    "sidebar.noHostsDesc": "Click above to add a server",
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
    "sidebar.menu.editHost": "Edit Server...",
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
    "perf.realtime": "Live Monitor",
    "perf.load": "Load",
    "perf.netTraffic": "Network Traffic",
    "perf.diskIO": "Disk I/O",
    "perf.read": "Read",
    "perf.write": "Write",
    "perf.doubleClickToggle": "Double-click to toggle monitor",

    // Host Modal
    "modal.host.addTitle": "Add Server Connection",
    "modal.host.editTitle": "Edit Server Connection",
    "modal.host.subtitle": "Configure SSH remote host & hardware-encrypted credentials",
    "modal.host.name": "Name",
    "modal.host.namePlaceholder": "e.g. Production / US-West Node",
    "modal.host.address": "Host Address / IP",
    "modal.host.port": "Port",
    "modal.host.username": "Username",
    "modal.host.group": "Group",
    "modal.host.password": "Password (Hardware Fingerprint Encrypted)",
    "modal.host.passwordPlaceholder": "Enter password for auto-login",
    "modal.host.showPassword": "Show Password",
    "modal.host.hidePassword": "Hide Password",
    "modal.host.privateKey": "Private Key (Optional)",
    "modal.host.privateKeyPlaceholder": "~/.ssh/id_rsa or browse key file",
    "modal.host.selectFile": "Browse",
    "modal.host.description": "Notes",
    "modal.host.descriptionPlaceholder": "Optional description or notes",

    // Command Assistant
    "cmd.smartMatch": "Smart Match:",
    "cmd.inputPlaceholder": "Type command (Enter to send, ↑/↓ for history, keywords to match)...",
    "cmd.clearInput": "Clear input",
    "cmd.historyTitle": "Command History",
    "cmd.historyTip": "View client command history",
    "cmd.historyClear": "Clear",
    "cmd.historyEmpty": "No command history",
    "cmd.runNow": "Run Now",
    "cmd.library": "Command Library",
    "cmd.send": "Send to Terminal",
    "cmd.fillParams": "Configure Parameters",
    "cmd.smartReplace": "Smart Parameterized Command Substitution",
    "cmd.preview": "Command Preview",
    "cmd.executeAndSend": "Execute & Send",
    "cmd.searchTemplates": "Search templates or categories...",
    "cmd.allCategories": "All Categories",

    // Process Manager
    "process.title": "Process Manager",
    "process.searchPlaceholder": "Filter by process name, PID, or user...",
    "process.autoRefresh": "Auto Refresh",
    "process.refresh": "Refresh List",
    "process.colPid": "PID",
    "process.colUser": "User",
    "process.colCpu": "CPU %",
    "process.colMem": "MEM %",
    "process.colCommand": "Command",
    "process.action": "Action",
    "process.kill": "Kill",
    "process.confirmKill": "Terminate Process",
    "process.confirmKillDesc": "Are you sure you want to send kill signal to PID {pid} ({cmd})?",
    "process.sigterm": "Graceful Termination (SIGTERM - 15)",
    "process.sigkill": "Force Kill (SIGKILL - 9)",
    "process.killSuccess": "Kill signal sent successfully",

    // Disk Mount Manager
    "disk.title": "Disk Volumes & Mounts",
    "disk.refresh": "Refresh Mounts",
    "disk.colFs": "Filesystem",
    "disk.colMount": "Mount Point",
    "disk.colTotal": "Total",
    "disk.colUsed": "Used",
    "disk.colAvail": "Avail",
    "disk.colUsePercent": "Usage %",

    // Settings Modal
    "settings.title": "Settings & Preferences",
    "settings.subtitle": "Customize your UltimateShell terminal & desktop experience",
    "settings.tabGeneral": "General",
    "settings.tabTerminal": "Terminal",
    "settings.tabSecurity": "Security & Connection",
    "settings.lang": "Language",
    "settings.langDesc": "Choose display language for the application",
    "settings.theme": "Theme",
    "settings.themeDesc": "Choose light or dark visual style",
    "settings.themeSystem": "System",
    "settings.themeLight": "Light",
    "settings.themeDark": "Dark",
    "settings.trayClose": "Window Close Behavior",
    "settings.trayCloseDesc": "Hide to system tray when closing window to keep connections active",
    "settings.trayCloseOption": "Minimize to Tray (Keep running in background)",
    "settings.fontSize": "Terminal Font Size",
    "settings.fontSizeDesc": "Adjust font size of the terminal viewport",
    "settings.cursorStyle": "Cursor Style",
    "settings.cursorStyleDesc": "Select shape of the cursor",
    "settings.cursorBlock": "Block",
    "settings.cursorBar": "Bar",
    "settings.cursorUnderline": "Underline",
    "settings.cursorBlink": "Cursor Blink",
    "settings.cursorBlinkDesc": "Enable or disable cursor blinking animation",
    "settings.scrollback": "Scrollback Buffer",
    "settings.scrollbackDesc": "Maximum number of history lines kept in buffer",
    "settings.vaultSecurity": "Credential Security Standard",
    "settings.vaultDesc": "Credentials secured with machine hardware fingerprint & AES-256-GCM",
    "settings.clearCache": "Clear Cache & History",
    "settings.clearCacheDesc": "Clear local command history and cached states",
    "settings.clearCacheBtn": "Clear Now",
    "settings.clearCacheSuccess": "Cache cleared successfully",

    // Status Bar & Controls
    "status.settings": "Preferences",
    "status.sessionsCount": "{count} sessions",
    "status.filesCount": "{count} items",
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
