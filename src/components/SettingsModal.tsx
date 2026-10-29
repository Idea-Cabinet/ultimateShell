import React, { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { useI18n, Lang, SUPPORTED_LANGS } from "../i18n";
import { AppSettings } from "../hooks/useAppSettings";
import { ThemeMode } from "../hooks/useTheme";
import { GatewayStatusPayload } from "./AgentGatewayDrawer";
import {
  X,
  SlidersHorizontal,
  Terminal,
  ShieldCheck,
  Globe,
  Sun,
  Moon,
  Monitor,
  Trash2,
  Check,
  Lock,
  FolderOpen,
  Bot,
  Copy,
  Code,
  FileText,
  ExternalLink,
} from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (partial: Partial<AppSettings>) => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  onClearCache?: () => void;
  onOpenAgentDrawer?: () => void;
}

type SettingsTab = "general" | "terminal" | "security" | "skill";

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  themeMode,
  onThemeChange,
  lang,
  onLangChange,
  onClearCache,
  onOpenAgentDrawer,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [showClearSuccess, setShowClearSuccess] = useState(false);

  // Gateway status for Skill documentation
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusPayload | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedSkill, setCopiedSkill] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);
  const [copiedSshCmd, setCopiedSshCmd] = useState(false);
  const [copiedSshConfig, setCopiedSshConfig] = useState(false);

  useEffect(() => {
    if (isOpen) {
      invoke<GatewayStatusPayload>("agent_get_gateway_status")
        .then(setGatewayStatus)
        .catch(() => {});
    }
  }, [isOpen]);

  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const skillMarkdown = useMemo(() => {
    const port = gatewayStatus?.port || 39281;
    const sshPort = gatewayStatus?.ssh_port || 2222;
    const token = gatewayStatus?.token || "<YOUR_TOKEN>";
    return `# UltimateShell AI Agent Security Gateway Skill (双轨制)

## 概述
你已连接到用户的本地 UltimateShell AI 安全代理双轨网关。
你可以安全地代表用户对服务器执行巡检、状态读取和维护操作。
**所有服务器密码和 SSH 私钥均严格保存在用户本地 Rust 安全保险库中，外部 Agent 完全无需也无法读取密码或密钥。**

## 双轨连接规范

### 轨道 1：原生 SSH 协议直接连接 (适用于 Claude Code CLI, 终端脚本与命令行 Agent)
- 本地地址: \`127.0.0.1\`
- SSH 端口: \`${sshPort}\`
- 命令行直接执行示例:
  \`\`\`bash
  ssh -p ${sshPort} <目标服务器名称或Host>@127.0.0.1 "<command>"
  \`\`\`
- 说明:
  - 回环本地连接无需输入真实服务器私钥或密码。
  - 遇到高危或写操作时，SSH 终端将实时提示 \`Waiting for user approval...\`，并在桌面弹窗批准后自动继续执行。

### 轨道 2：HTTP / MCP API 工具调用 (适用于 Claude Desktop, Cursor, Web Agents)
- 本地接口: \`http://127.0.0.1:${port}\`
- 鉴权头: \`Authorization: Bearer ${token}\`
- 可用工具接口:
  - 获取主机: \`GET /api/servers\`
  - 执行命令: \`POST /api/exec\` (参数: \`server\`, \`command\`, \`agent_name\`)
  - 读取文件: \`POST /api/read_file\` (参数: \`server\`, \`path\`)
`;
  }, [gatewayStatus?.port, gatewayStatus?.ssh_port, gatewayStatus?.token]);

  const mcpConfigJson = useMemo(() => {
    const port = gatewayStatus?.port || 39281;
    const token = gatewayStatus?.token || "<YOUR_TOKEN>";
    return JSON.stringify(
      {
        mcpServers: {
          ultimateShell: {
            command: "npx",
            args: [
              "-y",
              "mcp-remote",
              `http://127.0.0.1:${port}/mcp?token=${token}`,
            ],
          },
        },
      },
      null,
      2
    );
  }, [gatewayStatus?.port, gatewayStatus?.token]);

  if (!isOpen) return null;

  const handleClearCache = () => {
    localStorage.removeItem("ultimateshell_cmd_history");
    onClearCache?.();
    setShowClearSuccess(true);
    setTimeout(() => setShowClearSuccess(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-md animate-in fade-in duration-100 select-none">
      <div className="apple-card rounded-2xl w-[680px] h-[520px] max-w-[95vw] max-h-[90vh] shadow-2xl border border-[var(--border-subtle)] flex flex-col overflow-hidden text-[var(--text-primary)]">
        {/* Modal Header */}
        <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between flex-shrink-0 bg-[var(--hover-item)]/30">
          <div className="flex items-center space-x-2">
            <SlidersHorizontal className="w-4 h-4 text-[#007AFF]" />
            <h2 className="font-semibold text-[14px]">{t("settings.title")}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] active:scale-95 transition"
            title={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body with Sidebar & Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Settings Left Tab Menu */}
          <div className="w-44 border-r border-[var(--border-subtle)] bg-[var(--hover-item)]/15 p-2 space-y-1 flex-shrink-0">
            <button
              onClick={() => setActiveTab("general")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-xl text-[12px] font-medium transition ${
                activeTab === "general"
                  ? "bg-[#007AFF] text-white shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)]"
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{t("settings.tabGeneral")}</span>
            </button>

            <button
              onClick={() => setActiveTab("terminal")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-xl text-[12px] font-medium transition ${
                activeTab === "terminal"
                  ? "bg-[#007AFF] text-white shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)]"
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>{t("settings.tabTerminal")}</span>
            </button>

            <button
              onClick={() => setActiveTab("security")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-xl text-[12px] font-medium transition ${
                activeTab === "security"
                  ? "bg-[#007AFF] text-white shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)]"
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{t("settings.tabSecurity")}</span>
            </button>

            <button
              onClick={() => setActiveTab("skill")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-xl text-[12px] font-medium transition ${
                activeTab === "skill"
                  ? "bg-[#007AFF] text-white shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)]"
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>{t("settings.tabSkill")}</span>
            </button>
          </div>

          {/* Settings Right Content View */}
          <div className="flex-1 p-5 overflow-y-auto space-y-5 text-[12.5px]">
            {activeTab === "general" && (
              <>
                {/* Language */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-[13px]">{t("settings.lang")}</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {t("settings.langDesc")}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-1">
                    {SUPPORTED_LANGS.map((item) => (
                      <button
                        key={item.code}
                        onClick={() => onLangChange(item.code)}
                        className={`p-2 rounded-xl border flex items-center justify-between text-[11.5px] transition ${
                          lang === item.code
                            ? "border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF] font-medium"
                            : "border-[var(--border-subtle)] hover:bg-[var(--hover-item)] text-[var(--text-primary)]"
                        }`}
                      >
                        <span className="flex items-center space-x-1.5 truncate">
                          <span>{item.flag}</span>
                          <span className="truncate">{item.label}</span>
                        </span>
                        {lang === item.code && <Check className="w-3.5 h-3.5 text-[#007AFF] flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-[1px] bg-[var(--border-subtle)]" />

                {/* Theme Mode */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-[13px]">{t("settings.theme")}</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {t("settings.themeDesc")}
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <button
                      onClick={() => onThemeChange("system")}
                      className={`p-2 rounded-xl border flex flex-col items-center justify-center space-y-1 transition ${
                        themeMode === "system"
                          ? "border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF] font-medium"
                          : "border-[var(--border-subtle)] hover:bg-[var(--hover-item)]"
                      }`}
                    >
                      <Monitor className="w-4 h-4" />
                      <span className="text-[11.5px]">{t("settings.themeSystem")}</span>
                    </button>
                    <button
                      onClick={() => onThemeChange("light")}
                      className={`p-2 rounded-xl border flex flex-col items-center justify-center space-y-1 transition ${
                        themeMode === "light"
                          ? "border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF] font-medium"
                          : "border-[var(--border-subtle)] hover:bg-[var(--hover-item)]"
                      }`}
                    >
                      <Sun className="w-4 h-4 text-amber-500" />
                      <span className="text-[11.5px]">{t("settings.themeLight")}</span>
                    </button>
                    <button
                      onClick={() => onThemeChange("dark")}
                      className={`p-2 rounded-xl border flex flex-col items-center justify-center space-y-1 transition ${
                        themeMode === "dark"
                          ? "border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF] font-medium"
                          : "border-[var(--border-subtle)] hover:bg-[var(--hover-item)]"
                      }`}
                    >
                      <Moon className="w-4 h-4 text-indigo-400" />
                      <span className="text-[11.5px]">{t("settings.themeDark")}</span>
                    </button>
                  </div>
                </div>

                <div className="h-[1px] bg-[var(--border-subtle)]" />

                {/* Close to Tray */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="font-semibold text-[13px]">{t("settings.trayClose")}</div>
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {t("settings.trayCloseDesc")}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.minimizeToTray}
                    onChange={(e) => onUpdateSettings({ minimizeToTray: e.target.checked })}
                    className="w-4 h-4 accent-[#007AFF] rounded cursor-pointer"
                  />
                </div>

                <div className="h-[1px] bg-[var(--border-subtle)]" />

                {/* Default Download Directory */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-[13px]">文件默认下载路径</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    从服务器快速下载文件时的默认本地存储目录（未指定时保存至系统 Downloads 目录）
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    <input
                      type="text"
                      readOnly
                      value={settings.downloadDir || "系统默认下载目录 (Downloads)"}
                      placeholder="系统默认下载目录 (Downloads)"
                      className="flex-1 px-3 py-1.5 text-[11.5px] bg-[var(--bg-app)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-lg outline-none font-mono truncate cursor-default"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const selected = await open({
                          directory: true,
                          multiple: false,
                          title: "选择文件默认下载目录",
                        });
                        if (selected && typeof selected === "string") {
                          onUpdateSettings({ downloadDir: selected });
                        }
                      }}
                      className="px-3 py-1.5 text-[11.5px] rounded-lg bg-[var(--hover-item)] hover:bg-[#007AFF] hover:text-white transition border border-[var(--border-subtle)] flex items-center space-x-1 flex-shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>浏览...</span>
                    </button>
                    {settings.downloadDir && (
                      <button
                        type="button"
                        onClick={() => onUpdateSettings({ downloadDir: "" })}
                        title="重置恢复为系统默认 Downloads 目录"
                        className="px-2.5 py-1.5 text-[11.5px] rounded-lg text-[var(--text-tertiary)] hover:text-rose-500 hover:bg-rose-500/10 transition border border-[var(--border-subtle)] flex-shrink-0"
                      >
                        重置
                      </button>
                    )}
                  </div>
                </div>

                <div className="h-[1px] bg-[var(--border-subtle)]" />

                {/* Recycle Bin / Trash Settings */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5 pr-4">
                      <div className="font-semibold text-[13px]">删除时先备份至本地回收站</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        开启后，删除文件/文件夹前将自动下载备份至本地回收站 (~/.ultimateshell/trash)；关闭则直接永久删除
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.deleteToTrash}
                      onChange={(e) => onUpdateSettings({ deleteToTrash: e.target.checked })}
                      className="w-4 h-4 accent-[#007AFF] rounded cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center space-x-2 pt-0.5">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const trashDir = await invoke<string>("fs_get_trash_dir");
                          openPath(trashDir);
                        } catch (err) {
                          console.error("打开回收站目录失败:", err);
                        }
                      }}
                      className="px-2.5 py-1 text-[11px] rounded-lg bg-[var(--hover-item)] hover:text-[#007AFF] transition border border-[var(--border-subtle)] flex items-center space-x-1 text-[var(--text-secondary)]"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>查看回收站目录</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (confirm("确定要清空程序本地回收站吗？已备份的文件将被彻底清除。")) {
                          try {
                            await invoke("fs_clear_trash");
                            alert("本地回收站已清空");
                          } catch (err) {
                            alert("清空回收站失败: " + err);
                          }
                        }
                      }}
                      className="px-2.5 py-1 text-[11px] rounded-lg hover:bg-rose-500/10 hover:text-rose-500 transition border border-[var(--border-subtle)] flex items-center space-x-1 text-[var(--text-tertiary)]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>清空回收站</span>
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeTab === "terminal" && (
              <>
                {/* Font Size */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-[13px]">{t("settings.fontSize")}</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {t("settings.fontSizeDesc")}
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    {[12, 13, 13.5, 14, 15, 16].map((sz) => (
                      <button
                        key={sz}
                        onClick={() => onUpdateSettings({ fontSize: sz })}
                        className={`px-3 py-1 rounded-lg border text-[11.5px] font-mono transition ${
                          settings.fontSize === sz
                            ? "border-[#007AFF] bg-[#007AFF] text-white font-semibold"
                            : "border-[var(--border-subtle)] hover:bg-[var(--hover-item)] text-[var(--text-secondary)]"
                        }`}
                      >
                        {sz}px
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-[1px] bg-[var(--border-subtle)]" />

                {/* Cursor Style */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-[13px]">{t("settings.cursorStyle")}</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {t("settings.cursorStyleDesc")}
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {[
                      { id: "block", label: t("settings.cursorBlock") },
                      { id: "bar", label: t("settings.cursorBar") },
                      { id: "underline", label: t("settings.cursorUnderline") },
                    ].map((item) => (
                      <button
                        key={item.id}
                        onClick={() =>
                          onUpdateSettings({ cursorStyle: item.id as AppSettings["cursorStyle"] })
                        }
                        className={`p-2 rounded-xl border text-[11.5px] transition ${
                          settings.cursorStyle === item.id
                            ? "border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF] font-medium"
                            : "border-[var(--border-subtle)] hover:bg-[var(--hover-item)] text-[var(--text-secondary)]"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-[1px] bg-[var(--border-subtle)]" />

                {/* Cursor Blink */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="font-semibold text-[13px]">{t("settings.cursorBlink")}</div>
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {t("settings.cursorBlinkDesc")}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.cursorBlink}
                    onChange={(e) => onUpdateSettings({ cursorBlink: e.target.checked })}
                    className="w-4 h-4 accent-[#007AFF] rounded cursor-pointer"
                  />
                </div>

                <div className="h-[1px] bg-[var(--border-subtle)]" />

                {/* Scrollback */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-[13px]">{t("settings.scrollback")}</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {t("settings.scrollbackDesc")}
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    {[3000, 5000, 10000, 30000].map((lines) => (
                      <button
                        key={lines}
                        onClick={() => onUpdateSettings({ scrollback: lines })}
                        className={`px-3 py-1 rounded-lg border text-[11.5px] font-mono transition ${
                          settings.scrollback === lines
                            ? "border-[#007AFF] bg-[#007AFF] text-white font-semibold"
                            : "border-[var(--border-subtle)] hover:bg-[var(--hover-item)] text-[var(--text-secondary)]"
                        }`}
                      >
                        {lines.toLocaleString()} lines
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === "security" && (
              <>
                {/* Vault Security Info */}
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-start space-x-3">
                  <Lock className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold text-[12.5px] text-emerald-600 dark:text-emerald-400">
                      {t("settings.vaultSecurity")}
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {t("settings.vaultDesc")}
                    </div>
                  </div>
                </div>

                <div className="h-[1px] bg-[var(--border-subtle)]" />

                {/* Clear Cache */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-[13px]">{t("settings.clearCache")}</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {t("settings.clearCacheDesc")}
                  </div>
                  <div className="pt-2 flex items-center space-x-3">
                    <button
                      onClick={handleClearCache}
                      className="px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-500 hover:bg-rose-500 hover:text-white transition active:scale-95 text-[11.5px] flex items-center space-x-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t("settings.clearCacheBtn")}</span>
                    </button>
                    {showClearSuccess && (
                      <span className="text-[11px] text-emerald-500 flex items-center space-x-1 animate-in fade-in">
                        <Check className="w-3.5 h-3.5" />
                        <span>{t("settings.clearCacheSuccess")}</span>
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

            {activeTab === "skill" && (
              <div className="space-y-4">
                {/* Header card with status and open drawer button */}
                <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/25 flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-[13px] text-purple-400">
                          {t("settings.skillTitle")}
                        </span>
                        {gatewayStatus?.is_running ? (
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-medium">
                            HTTP :{gatewayStatus.port} | SSH :{gatewayStatus.ssh_port || 2222}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-red-500/15 text-red-500 border border-red-500/30">
                            {t("agent.stopped")}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                        {t("settings.skillDesc")}
                      </p>
                    </div>
                  </div>
                  {onOpenAgentDrawer && (
                    <button
                      onClick={onOpenAgentDrawer}
                      className="px-2.5 py-1 text-[11px] rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 flex items-center space-x-1 flex-shrink-0 ml-2 transition"
                    >
                      <span>{t("settings.openGateway")}</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Track 1: Native SSH Direct Connect (CLI) */}
                <div className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-500/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[12px] flex items-center space-x-1.5 text-blue-400">
                      <Terminal className="w-3.5 h-3.5" />
                      <span>轨道 1：原生 SSH 命令行直连 (Claude Code / CLI)</span>
                    </span>
                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `ssh -p ${gatewayStatus?.ssh_port || 2222} <server>@127.0.0.1 "<command>"`,
                            setCopiedSshCmd
                          )
                        }
                        className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition"
                      >
                        {copiedSshCmd ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedSshCmd ? t("common.success") : t("agent.copySsh")}</span>
                      </button>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `# UltimateShell 本地 AI 原生 SSH 堡垒配置 (~/.ssh/config)\nHost ai-*\n  HostName 127.0.0.1\n  Port ${gatewayStatus?.ssh_port || 2222}\n  UserKnownHostsFile /dev/null\n  StrictHostKeyChecking no\n`,
                            setCopiedSshConfig
                          )
                        }
                        className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] bg-[var(--hover-item)] hover:border-[var(--border-strong)] border border-[var(--border-subtle)] transition"
                      >
                        {copiedSshConfig ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedSshConfig ? t("common.success") : "复制 .ssh/config"}</span>
                      </button>
                    </div>
                  </div>
                  <div className="bg-[var(--bg-terminal,rgba(0,0,0,0.5))] rounded-lg p-2 font-mono text-[10.5px] text-emerald-400 border border-[var(--border-subtle)]">
                    $ ssh -p {gatewayStatus?.ssh_port || 2222} 目标服务器@127.0.0.1 "systemctl status nginx"
                  </div>
                </div>

                {/* Track 2: HTTP / MCP API Calling (Claude Desktop / Cursor) */}
                <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[12px] flex items-center space-x-1.5 text-purple-400">
                      <Code className="w-3.5 h-3.5" />
                      <span>轨道 2：HTTP / MCP API 接口凭证与配置</span>
                    </span>
                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => copyToClipboard(gatewayStatus?.token || "", setCopiedToken)}
                        className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] bg-[#007AFF]/15 text-[#007AFF] hover:bg-[#007AFF]/25 transition"
                      >
                        {copiedToken ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedToken ? t("common.success") : t("agent.copyToken")}</span>
                      </button>
                      <button
                        onClick={() => copyToClipboard(mcpConfigJson, setCopiedMcp)}
                        className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] bg-[var(--hover-item)] hover:border-[var(--border-strong)] border border-[var(--border-subtle)] transition"
                      >
                        {copiedMcp ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedMcp ? t("common.success") : t("agent.copyMcp")}</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-[10.5px] text-[var(--text-tertiary)]">
                    本地回环: <code className="font-mono text-purple-300">http://127.0.0.1:{gatewayStatus?.port || 39281}</code> · 鉴权: <code className="font-mono text-purple-300">Bearer {gatewayStatus?.token ? `${gatewayStatus.token.slice(0, 16)}...` : ""}</code>
                  </p>
                </div>

                {/* SKILL.md Full Specification Document */}
                <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[12px] flex items-center space-x-1.5">
                      <FileText className="w-3.5 h-3.5 text-blue-400" />
                      <span>外部 Agent SKILL.md 规范文档</span>
                    </span>
                    <button
                      onClick={() => copyToClipboard(skillMarkdown, setCopiedSkill)}
                      className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] bg-[#007AFF] text-white hover:bg-[#0062CC] transition shadow-xs"
                    >
                      {copiedSkill ? <Check className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedSkill ? t("common.success") : t("agent.copySkill")}</span>
                    </button>
                  </div>
                  <pre className="bg-[var(--bg-terminal,rgba(0,0,0,0.5))] rounded-lg p-2.5 font-mono text-[10.5px] text-gray-300 max-h-44 overflow-y-auto whitespace-pre-wrap select-text border border-[var(--border-subtle)] leading-relaxed">
                    {skillMarkdown}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-2.5 border-t border-[var(--border-subtle)] flex items-center justify-end bg-[var(--hover-item)]/30 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#007AFF] hover:bg-[#0A84FF] text-white text-[12px] font-medium transition active:scale-95 shadow-sm"
          >
            {t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
