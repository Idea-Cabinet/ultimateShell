import React from "react";
import { ThemeMode } from "../hooks/useTheme";
import { Sun, Moon, Laptop } from "lucide-react";

interface Props {
  themeMode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

export const ThemeSelector: React.FC<Props> = ({ themeMode, onChange }) => {
  const options: { mode: ThemeMode; label: string; icon: React.FC<{ className?: string }> }[] = [
    { mode: "light", label: "浅色", icon: Sun },
    { mode: "dark", label: "深色", icon: Moon },
    { mode: "system", label: "自动", icon: Laptop },
  ];

  return (
    <div className="flex items-center bg-[var(--input-bg)] p-0.5 rounded-[7px] border border-[var(--border-subtle)]">
      {options.map((opt) => {
        const Icon = opt.icon;
        const isActive = themeMode === opt.mode;
        return (
          <button
            key={opt.mode}
            onClick={() => onChange(opt.mode)}
            title={
              opt.mode === "light"
                ? "浅色外观 (Light: 强制明亮风格)"
                : opt.mode === "dark"
                ? "深色外观 (Dark: 强制深色风格)"
                : "自动模式 (Auto: 随 macOS 系统外观自动切换)"
            }
            className={`flex-1 flex items-center justify-center space-x-1 py-1 px-1.5 rounded-[5px] text-[11px] font-medium transition ${
              isActive
                ? "bg-[var(--active-tab-bg)] text-[var(--text-primary)] shadow-sm border border-[var(--border-subtle)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Icon className="w-3 h-3" />
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
};
