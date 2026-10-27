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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl w-[480px] overflow-hidden text-sm">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#30363d] bg-[#1c2128]">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-blue-400" />
            <span className="font-semibold text-gray-100">
              {initialHost ? "编辑服务器连接" : "新建 SSH 连接"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition p-1 hover:bg-[#30363d] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              连接名称
            </label>
            <input
              type="text"
              placeholder="例如: 生产机器 / 香港测试节点"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-300 mb-1">
                主机地址 / IP <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="192.168.1.100 或 example.com"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                className="w-full px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">
                端口
              </label>
              <input
                type="number"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 22 })}
                className="w-full px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">
                用户名
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">
                分组
              </label>
              <input
                type="text"
                placeholder="例如: 生产环境 / 测试服"
                value={formData.group || ""}
                onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                className="w-full px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              SSH 私钥路径 (可选，留空使用默认密钥或密码)
            </label>
            <input
              type="text"
              placeholder="~/.ssh/id_rsa 或 /path/to/key.pem"
              value={formData.identity_file || ""}
              onChange={(e) => setFormData({ ...formData, identity_file: e.target.value })}
              className="w-full px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500 font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              备注说明
            </label>
            <input
              type="text"
              placeholder="服务器用途备注"
              value={formData.description || ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-[#30363d]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-gray-300 hover:text-white bg-[#21262d] hover:bg-[#30363d] rounded-lg transition"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-white bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition shadow-sm"
            >
              保存连接
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
