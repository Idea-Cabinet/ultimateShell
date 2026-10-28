import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { HostProfile, ServerUser } from "../types";
import {
  User,
  Users,
  Shield,
  Key,
  KeyRound,
  Check,
  Search,
  RotateCw,
  X,
  ChevronDown,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from "lucide-react";

interface Props {
  sessionId: string;
  hostProfile?: HostProfile;
  isLocal: boolean;
  currentUser: string;
}

export const ServerUserMenu: React.FC<Props> = ({
  sessionId,
  hostProfile,
  isLocal,
  currentUser,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [users, setUsers] = useState<ServerUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTabFilter, setActiveTabFilter] = useState<"login" | "all">("login");
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ bottom: number; left: number }>({
    bottom: 32,
    left: 16,
  });

  const effectiveUser =
    !currentUser || currentUser === "unknown"
      ? hostProfile?.username || (isLocal ? "local" : "root")
      : currentUser;
  const isRoot = effectiveUser === "root";

  // Password Input / Switch Modal state
  const [passwordModal, setPasswordModal] = useState<{
    targetUser: string;
    hasSavedPassword: boolean;
    savedPassword?: string;
  } | null>(null);
  const [inputPassword, setInputPassword] = useState("");
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(true);

  // Password Management Popover for a specific user
  const [managingPasswordUser, setManagingPasswordUser] = useState<ServerUser | null>(null);
  const [newManagedPassword, setNewManagedPassword] = useState("");
  const [showManagedPassword, setShowManagedPassword] = useState(false);

  // Custom User Input state
  const [showCustomUserInput, setShowCustomUserInput] = useState(false);
  const [customUserName, setCustomUserName] = useState("");

  const hostId = hostProfile?.id || (isLocal ? "local" : "");

  const fetchUsers = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const data = await invoke<ServerUser[]>("get_server_users", { sessionId });
      setUsers(data);
    } catch (err) {
      console.error("获取服务器用户列表失败:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleOpen = () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        bottom: window.innerHeight - rect.top + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 340)),
      });
    }
    setIsOpen(!isOpen);
  };

  // Fetch users when popover opens or session changes
  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    }
  }, [isOpen, sessionId]);

  // Click outside listener to dismiss popover
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Escape key listener to close menu or modals
  useEffect(() => {
    if (!isOpen && !passwordModal && !managingPasswordUser) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (passwordModal) setPasswordModal(null);
        else if (managingPasswordUser) setManagingPasswordUser(null);
        else if (isOpen) setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, passwordModal, managingPasswordUser]);

  const handleStartSwitch = async (targetUser: string) => {
    if (targetUser === effectiveUser) {
      setIsOpen(false);
      return;
    }

    const baseUser = hostProfile?.username || (isLocal ? "local" : "root");
    const isBaseRoot = !isLocal && (!hostProfile?.username || hostProfile.username === "root");

    // Check if session has root capabilities (e.g. started as root or had root in session stack)
    let isRootCapable = isBaseRoot || effectiveUser === "root";
    if (!isRootCapable && sessionId) {
      isRootCapable = await invoke<boolean>("is_session_root_capable", { sessionId }).catch(() => false);
    }

    // If session is root-capable OR returning to the base connection user:
    // The switch is completely passwordless via root privilege or subshell exit (e.g. root -> user1 -> user2)!
    if (isRootCapable || targetUser === baseUser) {
      try {
        await invoke("switch_session_user", {
          sessionId,
          targetUser,
          password: null,
        });
      } catch (err) {
        console.error("切换用户失败:", err);
      }
      setIsOpen(false);
      return;
    }

    // Check if we have a saved password in the vault for (hostId, targetUser)
    let savedPwd: string | null = null;
    if (hostId) {
      savedPwd = await invoke<string | null>("get_server_user_password", {
        hostId,
        username: targetUser,
      });
      // If targetUser matches hostProfile's default username, fallback to host password
      if (!savedPwd && hostProfile && hostProfile.username === targetUser) {
        savedPwd = await invoke<string | null>("get_host_password", {
          hostId,
        });
      }
    }

    if (savedPwd) {
      // Password already saved in vault! Prompt user for one-click switch or modify
      setPasswordModal({
        targetUser,
        hasSavedPassword: true,
        savedPassword: savedPwd,
      });
      setInputPassword(savedPwd);
    } else {
      // Need password input
      setPasswordModal({
        targetUser,
        hasSavedPassword: false,
      });
      setInputPassword("");
    }
    setShowPasswordText(false);
    setRememberPassword(true);
  };

  const handleConfirmSwitch = async () => {
    if (!passwordModal) return;
    const { targetUser } = passwordModal;
    const pwd = inputPassword.trim();

    try {
      // Save password if requested and host is valid
      if (rememberPassword && hostId && pwd) {
        await invoke("save_server_user_password", {
          hostId,
          username: targetUser,
          password: pwd,
        });
      }

      await invoke("switch_session_user", {
        sessionId,
        targetUser,
        password: pwd ? pwd : null,
      });
    } catch (err) {
      console.error("执行用户切换失败:", err);
    } finally {
      setPasswordModal(null);
      setIsOpen(false);
      fetchUsers();
    }
  };

  const handleSaveUserPassword = async (username: string, password: string) => {
    if (!hostId || !password.trim()) return;
    try {
      await invoke("save_server_user_password", {
        hostId,
        username,
        password: password.trim(),
      });
      setManagingPasswordUser(null);
      fetchUsers();
    } catch (err) {
      console.error("保存用户密码失败:", err);
    }
  };

  const handleDeleteUserPassword = async (username: string) => {
    if (!hostId) return;
    try {
      await invoke("delete_server_user_password", {
        hostId,
        username,
      });
      setManagingPasswordUser(null);
      fetchUsers();
    } catch (err) {
      console.error("清除用户密码失败:", err);
    }
  };

  // Filter users based on tab and search
  const filteredUsers = users.filter((u) => {
    if (activeTabFilter === "login" && !u.is_login_user) return false;
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      u.username.toLowerCase().includes(term) ||
      u.uid.toString().includes(term) ||
      u.home.toLowerCase().includes(term) ||
      u.shell.toLowerCase().includes(term)
    );
  });

  return (
    <div className="relative inline-flex items-center flex-shrink-0">
      {/* Interactive Status Bar User Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        title={
          isRoot
            ? "当前终端用户: root (超级管理员) - 点击查看与切换服务器用户"
            : `当前终端用户: ${effectiveUser} - 点击查看与切换服务器用户`
        }
        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border flex items-center space-x-1.5 transition active:scale-95 select-none ${
          isRoot
            ? "bg-rose-500/10 text-rose-500 border-rose-500/30 hover:bg-rose-500/20"
            : "bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/30 hover:bg-[#007AFF]/20"
        } ${isOpen ? "ring-1 ring-[#007AFF]/50" : ""}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isRoot ? "bg-rose-500" : "bg-[#007AFF]"
          }`}
        />
        <User className="w-3 h-3 flex-shrink-0" />
        <span className="font-semibold tracking-tight">{effectiveUser}</span>
        <ChevronDown
          className={`w-2.5 h-2.5 opacity-70 transition-transform duration-150 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu Popover (Portaled to document.body with top z-index) */}
      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              bottom: `${menuPosition.bottom}px`,
              left: `${menuPosition.left}px`,
              zIndex: 9999,
            }}
            className="w-84 max-w-[90vw] apple-card rounded-xl shadow-2xl border border-[var(--border-subtle)] text-[12px] text-[var(--text-primary)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-120 select-none"
            onClick={(e) => e.stopPropagation()}
          >
          {/* Header */}
          <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] flex items-center justify-between">
            <div className="flex items-center space-x-1.5 truncate">
              <Users className="w-3.5 h-3.5 text-[#007AFF]" />
              <span className="font-semibold text-[12px]">服务器用户切换</span>
              {hostProfile && (
                <span className="text-[10.5px] text-[var(--text-tertiary)] truncate max-w-[120px]">
                  ({hostProfile.name})
                </span>
              )}
            </div>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={fetchUsers}
                title="刷新用户列表"
                className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition"
              >
                <RotateCw
                  className={`w-3 h-3 ${loading ? "animate-spin text-[#007AFF]" : ""}`}
                />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)] transition"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Search Bar & Filters */}
          <div className="p-2 space-y-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
            <div className="relative flex items-center">
              <Search className="w-3 h-3 absolute left-2 text-[var(--text-tertiary)] pointer-events-none" />
              <input
                type="text"
                placeholder="搜索用户名、UID、Shell..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-7 pr-6 py-1 text-[11px] bg-[var(--input-bg)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] border border-[var(--border-subtle)] rounded-md focus:outline-none focus:border-[#007AFF] transition font-mono"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>

            {/* Filter Toggle Pills */}
            <div className="flex items-center space-x-1 text-[10px]">
              <button
                type="button"
                onClick={() => setActiveTabFilter("login")}
                className={`px-2 py-0.5 rounded-full transition font-medium ${
                  activeTabFilter === "login"
                    ? "bg-[#007AFF] text-white"
                    : "bg-[var(--hover-item)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                }`}
              >
                登录用户 ({users.filter((u) => u.is_login_user).length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTabFilter("all")}
                className={`px-2 py-0.5 rounded-full transition font-medium ${
                  activeTabFilter === "all"
                    ? "bg-[#007AFF] text-white"
                    : "bg-[var(--hover-item)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                }`}
              >
                全部用户 ({users.length})
              </button>
            </div>
          </div>

          {/* User List */}
          <div className="max-h-60 overflow-y-auto divide-y divide-[var(--border-subtle)]/40 p-1">
            {loading && users.length === 0 ? (
              <div className="py-6 text-center text-[var(--text-tertiary)] flex flex-col items-center justify-center space-y-1">
                <RotateCw className="w-4 h-4 animate-spin text-[#007AFF]" />
                <span className="text-[11px]">正在读取服务器 /etc/passwd 用户列表...</span>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="py-6 text-center text-[var(--text-tertiary)] text-[11px]">
                未匹配到符合条件的用户
              </div>
            ) : (
              filteredUsers.map((u) => {
                const isActive = u.username === effectiveUser;
                return (
                  <div
                    key={u.username}
                    className={`group px-2 py-1.5 rounded-lg flex items-center justify-between hover:bg-[var(--hover-item)] transition cursor-pointer ${
                      isActive ? "bg-[#007AFF]/10 border border-[#007AFF]/20" : ""
                    }`}
                    onClick={() => handleStartSwitch(u.username)}
                  >
                    <div className="flex items-center space-x-2 truncate flex-1 min-w-0 mr-2">
                      {/* Avatar / Icon */}
                      <div
                        className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                          u.is_root
                            ? "bg-rose-500/15 text-rose-500"
                            : "bg-[var(--hover-item)] text-[var(--text-secondary)]"
                        }`}
                      >
                        {u.is_root ? (
                          <Shield className="w-3.5 h-3.5" />
                        ) : (
                          <User className="w-3.5 h-3.5" />
                        )}
                      </div>

                      {/* User Info */}
                      <div className="truncate flex-1 min-w-0">
                        <div className="flex items-center space-x-1.5 truncate">
                          <span
                            className={`font-mono text-[12px] font-semibold truncate ${
                              u.is_root ? "text-rose-500" : "text-[var(--text-primary)]"
                            }`}
                          >
                            {u.username}
                          </span>
                          <span className="text-[9.5px] px-1 py-0.2 rounded font-mono bg-[var(--hover-item)] text-[var(--text-tertiary)]">
                            UID:{u.uid}
                          </span>
                          {u.has_password && (
                            <span
                              title="已加密保存该用户的切换/登录密码"
                              className="text-emerald-500 inline-flex items-center"
                            >
                              <Key className="w-3 h-3 text-emerald-500" />
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--text-tertiary)] font-mono truncate flex items-center space-x-1">
                          <span className="truncate">{u.home}</span>
                          <span>·</span>
                          <span className="truncate">{u.shell.split("/").pop()}</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-1 flex-shrink-0">
                      {/* Password Key Manager Icon Button */}
                      {hostId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setManagingPasswordUser(u);
                            setNewManagedPassword("");
                            setShowManagedPassword(false);
                          }}
                          title={u.has_password ? "查看/更新已保存密码" : "为此用户配置密码"}
                          className={`p-1 rounded text-[var(--text-tertiary)] hover:text-[#007AFF] hover:bg-[var(--hover-item)] transition ${
                            u.has_password ? "text-emerald-500" : ""
                          }`}
                        >
                          <KeyRound className="w-3 h-3" />
                        </button>
                      )}

                      {/* Active Status or Switch Button */}
                      {isActive ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 flex items-center space-x-0.5">
                          <Check className="w-2.5 h-2.5" />
                          <span>当前</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartSwitch(u.username);
                          }}
                          className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#007AFF] text-white hover:bg-[#0062CC] transition active:scale-95 shadow-sm"
                        >
                          切换
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer: Custom user switch option */}
          <div className="px-2 py-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-app)] text-[11px] flex items-center justify-between">
            {showCustomUserInput ? (
              <div className="flex items-center space-x-1.5 w-full">
                <input
                  type="text"
                  placeholder="输入其他用户名 (su - xxx)..."
                  value={customUserName}
                  onChange={(e) => setCustomUserName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customUserName.trim()) {
                      handleStartSwitch(customUserName.trim());
                    }
                  }}
                  autoFocus
                  className="flex-1 px-2 py-0.5 text-[11px] bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] font-mono outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (customUserName.trim()) {
                      handleStartSwitch(customUserName.trim());
                    }
                  }}
                  className="px-2 py-0.5 bg-[#007AFF] text-white rounded text-[10.5px] font-medium hover:bg-[#0062CC]"
                >
                  确定
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomUserInput(false)}
                  className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCustomUserInput(true)}
                className="w-full text-left flex items-center space-x-1.5 text-[var(--text-tertiary)] hover:text-[#007AFF] transition py-0.5"
              >
                <Plus className="w-3 h-3" />
                <span>切换到其他自定义用户...</span>
              </button>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Password Prompt Modal for Switching Users (Portaled directly to document.body) */}
      {passwordModal &&
        createPortal(
          <div
            style={{ position: "fixed", inset: 0, zIndex: 10000 }}
            className="flex items-center justify-center bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-100"
            onClick={() => setPasswordModal(null)}
          >
          <div
            className="w-88 apple-card rounded-xl p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] select-none animate-in zoom-in-95 duration-120"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-lg bg-[#007AFF]/15 text-[#007AFF] flex items-center justify-center flex-shrink-0">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[13.5px] font-semibold tracking-tight">
                  切换到用户「{passwordModal.targetUser}」
                </div>
                <div className="text-[11.5px] text-[var(--text-secondary)]">
                  请输入该用户密码以完成身份切换
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {passwordModal.hasSavedPassword ? (
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11.5px] flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400">
                  <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>已找到该用户的已保存凭据，可直接确认切换</span>
                </div>
              ) : null}

              <div>
                <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                  用户密码
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showPasswordText ? "text" : "password"}
                    placeholder={passwordModal.hasSavedPassword ? "已填入已保存密码" : "输入密码..."}
                    value={inputPassword}
                    onChange={(e) => setInputPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleConfirmSwitch();
                      }
                    }}
                    autoFocus
                    className="w-full px-3 py-1.5 text-[12.5px] bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-lg outline-none pr-8 font-mono"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPasswordText(!showPasswordText)}
                    className="absolute right-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition"
                  >
                    {showPasswordText ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember Password Checkbox */}
              <label className="flex items-center space-x-2 text-[11.5px] text-[var(--text-secondary)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={(e) => setRememberPassword(e.target.checked)}
                  className="rounded border-[var(--border-subtle)] text-[#007AFF] focus:ring-0"
                />
                <span>记住该用户的密码 (安全存储于硬件加密保险库)</span>
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setPasswordModal(null)}
                className="px-3 py-1.5 text-[12px] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-item)] transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmSwitch}
                className="px-4 py-1.5 text-[12px] font-medium text-white bg-[#007AFF] hover:bg-[#0062CC] rounded-lg shadow-sm transition active:scale-95"
              >
                确认切换
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Password Management Modal for a Single User (Portaled directly to document.body) */}
      {managingPasswordUser &&
        createPortal(
          <div
            style={{ position: "fixed", inset: 0, zIndex: 10000 }}
            className="flex items-center justify-center bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-100"
            onClick={() => setManagingPasswordUser(null)}
          >
          <div
            className="w-84 apple-card rounded-xl p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] select-none animate-in zoom-in-95 duration-120"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <KeyRound className="w-4 h-4 text-[#007AFF]" />
                <span className="font-semibold text-[13.5px]">
                  管理用户密码: {managingPasswordUser.username}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setManagingPasswordUser(null)}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-3.5 space-y-3 text-[12px]">
              <div>
                <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                  {managingPasswordUser.has_password ? "更新新密码" : "设置用户密码"}
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showManagedPassword ? "text" : "password"}
                    placeholder="输入密码..."
                    value={newManagedPassword}
                    onChange={(e) => setNewManagedPassword(e.target.value)}
                    className="w-full px-3 py-1.5 bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-lg outline-none pr-8 font-mono text-[12px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowManagedPassword(!showManagedPassword)}
                    className="absolute right-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                  >
                    {showManagedPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              {managingPasswordUser.has_password ? (
                <button
                  type="button"
                  onClick={() => handleDeleteUserPassword(managingPasswordUser.username)}
                  className="px-2 py-1 text-[11px] text-rose-500 hover:bg-rose-500/10 rounded flex items-center space-x-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>清除密码</span>
                </button>
              ) : (
                <div />
              )}
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setManagingPasswordUser(null)}
                  className="px-3 py-1 text-[11.5px] rounded text-[var(--text-secondary)] hover:bg-[var(--hover-item)]"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!newManagedPassword.trim()}
                  onClick={() => handleSaveUserPassword(managingPasswordUser.username, newManagedPassword)}
                  className="px-3 py-1 text-[11.5px] font-medium text-white bg-[#007AFF] hover:bg-[#0062CC] rounded disabled:opacity-40"
                >
                  保存密码
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
