import React, { useState, useEffect, useRef } from "react";
import { HostProfile } from "../types";
import { X, Server, Lock, FolderOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (host: HostProfile, password?: string) => void;
  initialHost?: HostProfile | null;
}

export const HostModal: React.FC<Props> = ({ isOpen, onClose, onSave, initialHost }) => {
  const [formData, setFormData] = useState<HostProfile>({
    id: "",
    name: "",
    host: "",
    port: 22,
    username: "root",
    group: "默认分组",
    description: "",
    identity_file: "",
  });
  const [password, setPassword] = useState("");
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Auto focus first input on modal open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        firstInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (initialHost) {
      setFormData(initialHost);
      // Fetch saved password from hardware vault if editing
      if (initialHost.id) {
        invoke<string | null>("get_host_password", { hostId: initialHost.id })
          .then((p) => {
            if (p) setPassword(p);
            else setPassword("");
          })
          .catch(() => setPassword(""));
      } else {
        setPassword("");
      }
    } else {
      setFormData({
        id: "",
        name: "",
        host: "",
        port: 22,
        username: "root",
        group: "默认分组",
        description: "",
        identity_file: "",
      });
      setPassword("");
    }
  }, [initialHost, isOpen]);

  if (!isOpen) return null;

  const handleSelectPrivateKey = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "选择 SSH 私钥文件",
      });
      if (selected && typeof selected === "string") {
        setFormData((prev) => ({ ...prev, identity_file: selected }));
      }
    } catch (err) {
      console.error("选择私钥文件失败:", err);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.host.trim()) return;
    onSave(
      {
        ...formData,
        name: formData.name.trim() || formData.host.trim(),
      },
      password.trim() || undefined
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-md">
      <div className="apple-card apple-modal-enter rounded-2xl w-[460px] overflow-hidden text-sm text-[var(--text-primary)]">
        {/* Sheet Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-[#007AFF]/15 text-[#007AFF]">
              <Server className="w-4 h-4" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">
                {initialHost ? "编辑服务器连接" : "添加服务器连接"}
              </h2>
              <p className="text-[11px] text-[var(--text-secondary)]">配置 SSH 远程主机连接与硬件加密凭据</p>
            </div>
          </div>
          <button
            onClick={onClose}
            title="关闭窗口 (Esc: 取消并返回)"
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1.5 hover:bg-[var(--hover-item)] rounded-full active:scale-[0.95]"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        {/* Sheet Body */}
        <form
          onSubmit={handleSubmit}
          className="px-6 pb-6 pt-2 space-y-3.5"
        >
          <div>
            <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
              名称
            </label>
            <input
              ref={firstInputRef}
              type="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="例如: 生产机器 / 香港主节点"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-[8px] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                主机地址 / IP <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="192.168.1.100"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-[8px] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                端口
              </label>
              <input
                type="number"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 22 })}
                className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-[8px] text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                用户名
              </label>
              <input
                type="text"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-[8px] text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                分组
              </label>
              <input
                type="text"
                placeholder="默认分组"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={formData.group || ""}
                onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-[8px] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40"
              />
            </div>
          </div>

          {/* Password with Hardware Fingerprint Encryption (Requirement 6) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-[var(--text-secondary)] flex items-center space-x-1">
                <Lock className="w-3 h-3 text-[#007AFF]" />
                <span>服务器登录密码 (硬件指纹安全加密)</span>
              </label>
              <span className="text-[10px] text-emerald-500 font-mono">AES-256-GCM 保护</span>
            </div>
            <input
              type="password"
              placeholder="输入密码以实现免密自动连接"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-[8px] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
              私钥文件 (可选)
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                placeholder="~/.ssh/id_rsa 或从右侧选择私钥"
                value={formData.identity_file || ""}
                onChange={(e) => setFormData({ ...formData, identity_file: e.target.value })}
                className="flex-1 px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-[8px] text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 font-mono"
              />
              <button
                type="button"
                onClick={handleSelectPrivateKey}
                className="px-3 py-1.5 bg-[var(--active-item)] hover:bg-[var(--hover-item)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] rounded-[8px] text-[12px] text-[var(--text-primary)] flex items-center space-x-1.5 flex-shrink-0 active:scale-[0.97] transition-all"
                title="选择私钥文件 (从系统 Finder 浏览并载入私钥)"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#007AFF]" />
                <span>选择文件</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
              备注
            </label>
            <input
              type="text"
              placeholder="可选备忘说明"
              value={formData.description || ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-[8px] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40"
            />
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-end space-x-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--active-item)] hover:bg-[var(--hover-item)] rounded-[8px] active:scale-[0.97]"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 text-[13px] font-medium text-white bg-[#007AFF] hover:bg-[#0A84FF] rounded-[8px] shadow-[0_1px_3px_rgba(0,122,255,0.4)] active:scale-[0.97]"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
