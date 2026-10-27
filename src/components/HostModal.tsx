import React, { useState, useEffect } from "react";
import { HostProfile } from "../types";
import { X, Server } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (host: HostProfile) => void;
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

  useEffect(() => {
    if (initialHost) {
      setFormData(initialHost);
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
    }
  }, [initialHost, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.host.trim()) return;
    onSave({
      ...formData,
      name: formData.name.trim() || formData.host.trim(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md transition-all">
      <div className="apple-card rounded-2xl w-[450px] overflow-hidden text-sm animate-in fade-in zoom-in-95 duration-150">
        {/* Sheet Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-[#007AFF]/15 text-[#0A84FF]">
              <Server className="w-4 h-4" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-white">
                {initialHost ? "编辑服务器" : "添加服务器"}
              </h2>
              <p className="text-[11px] text-white/40">配置 SSH 远程主机连接凭证</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/80 p-1.5 hover:bg-white/[0.08] rounded-full transition active:scale-[0.95]"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        {/* Sheet Body */}
        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-2 space-y-3.5">
          <div>
            <label className="block text-[11px] font-medium text-white/60 mb-1">
              名称
            </label>
            <input
              type="text"
              placeholder="例如: 生产机器 / 香港主节点"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-1.5 bg-black/30 border border-white/[0.12] rounded-[8px] text-[13px] text-white placeholder-white/25 focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 transition"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-white/60 mb-1">
                主机地址 / IP <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="192.168.1.100"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                className="w-full px-3 py-1.5 bg-black/30 border border-white/[0.12] rounded-[8px] text-[13px] text-white placeholder-white/25 focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 transition font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-white/60 mb-1">
                端口
              </label>
              <input
                type="number"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 22 })}
                className="w-full px-3 py-1.5 bg-black/30 border border-white/[0.12] rounded-[8px] text-[13px] text-white focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 transition font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-white/60 mb-1">
                用户名
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-3 py-1.5 bg-black/30 border border-white/[0.12] rounded-[8px] text-[13px] text-white focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 transition font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-white/60 mb-1">
                分组
              </label>
              <input
                type="text"
                placeholder="默认分组"
                value={formData.group || ""}
                onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                className="w-full px-3 py-1.5 bg-black/30 border border-white/[0.12] rounded-[8px] text-[13px] text-white placeholder-white/25 focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-white/60 mb-1">
              私钥文件 (可选)
            </label>
            <input
              type="text"
              placeholder="~/.ssh/id_rsa"
              value={formData.identity_file || ""}
              onChange={(e) => setFormData({ ...formData, identity_file: e.target.value })}
              className="w-full px-3 py-1.5 bg-black/30 border border-white/[0.12] rounded-[8px] text-[12px] text-white/90 placeholder-white/25 focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 transition font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-white/60 mb-1">
              备注
            </label>
            <input
              type="text"
              placeholder="可选备忘说明"
              value={formData.description || ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-1.5 bg-black/30 border border-white/[0.12] rounded-[8px] text-[13px] text-white placeholder-white/25 focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/40 transition"
            />
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-end space-x-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-[13px] font-medium text-white/70 hover:text-white bg-white/[0.08] hover:bg-white/[0.12] rounded-[8px] transition active:scale-[0.97]"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 text-[13px] font-medium text-white bg-[#007AFF] hover:bg-[#0A84FF] rounded-[8px] shadow-[0_1px_3px_rgba(0,122,255,0.4)] transition active:scale-[0.97]"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
