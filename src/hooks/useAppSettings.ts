import { useState } from "react";

export interface AppSettings {
  fontSize: number;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  scrollback: number;
  minimizeToTray: boolean;
  downloadDir: string;
  deleteToTrash: boolean;
  hasAskedTrashConfirm: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 13.5,
  cursorStyle: "block",
  cursorBlink: false,
  scrollback: 5000,
  minimizeToTray: true,
  downloadDir: "",
  deleteToTrash: false,
  hasAskedTrashConfirm: false,
};

const STORAGE_KEY = "ultimateshell_app_settings";

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
    return DEFAULT_SETTINGS;
  });

  const updateSettings = (partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
  };

  return {
    settings,
    updateSettings,
    resetSettings,
  };
}
