import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { followTerminalDirectory as followDirectory, SessionDirectory } from "../utils/sessionDirectory";
import { TransferTask } from "../types";

interface TransferContextValue {
  tasks: TransferTask[];
  directories: Record<string, SessionDirectory>;
  setDirectory: (sessionId: string, path: string) => void;
  followTerminalDirectory: (sessionId: string, path: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  startDownload: (
    sessionId: string,
    hostName: string,
    remotePath: string,
    fileName: string,
    totalSize?: number,
    customLocalPath?: string
  ) => Promise<string>;
  startUpload: (
    sessionId: string,
    hostName: string,
    localPath: string,
    remoteDir: string,
    fileName?: string
  ) => Promise<string>;
  cancelTransfer: (taskId: string) => Promise<void>;
  retryTransfer: (taskId: string) => Promise<void>;
  clearCompleted: () => void;
  removeTask: (taskId: string) => void;
  activeCount: number;
}

const TransferContext = createContext<TransferContextValue | null>(null);

const STORAGE_KEY = "ultimateshell_transfers_v1";

export const TransferProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tasks, setTasks] = useState<TransferTask[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: TransferTask[] = JSON.parse(saved);
        // Reset any transferring status to error on page reload
        return parsed.map((t) =>
          t.status === "transferring" || t.status === "pending"
            ? { ...t, status: "cancelled", errorMsg: "会话已重启" }
            : t
        );
      }
    } catch {}
    return [];
  });

  const [directories, setDirectories] = useState<Record<string, SessionDirectory>>({});
  const setDirectory = useCallback((sessionId: string, path: string) => {
    setDirectories(prev => prev[sessionId]?.path === path ? prev : {
      ...prev, [sessionId]: { ...prev[sessionId], path },
    });
  }, []);
  const followTerminalDirectory = useCallback((sessionId: string, path: string) => {
    setDirectories(prev => {
      const next = followDirectory(prev[sessionId], path);
      return !next || next === prev[sessionId] ? prev : { ...prev, [sessionId]: next };
    });
  }, []);
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const uploadsRef = useRef(new Map<string, Promise<string>>());
  const cancelledRef = useRef(new Set<string>());
  const queueRef = useRef<{ running: number; jobs: (() => Promise<void>)[] }>({ running: 0, jobs: [] });
  const pumpUploads = () => {
    const queue = queueRef.current;
    while (queue.running < 2 && queue.jobs.length) {
      const job = queue.jobs.shift()!;
      queue.running++;
      void job().finally(() => { queue.running--; pumpUploads(); });
    }
  };

  // Persist tasks to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.slice(0, 50)));
    } catch {}
  }, [tasks]);

  // Listen for Tauri backend transfer progress and status events
  useEffect(() => {
    let disposed = false;
    let unlistenProgress: (() => void) | null = null;
    let unlistenStatus: (() => void) | null = null;

    listen<{ task_id: string; transferred: number; total: number; speed: number }>(
      "file-transfer-progress",
      (event) => {
        if (disposed) return;
        const { task_id, transferred, total, speed } = event.payload;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id === task_id && (t.status === "pending" || t.status === "transferring")) {
              const progress = total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0;
              return {
                ...t,
                transferredSize: transferred,
                totalSize: total > 0 ? total : t.totalSize,
                speed,
                progress,
                status: "transferring",
              };
            }
            return t;
          })
        );
      }
    ).then((fn) => {
      if (disposed) fn();
      else unlistenProgress = fn;
    });

    listen<{ task_id: string; status: string; error?: string }>(
      "file-transfer-status",
      (event) => {
        if (disposed) return;
        const { task_id, status, error } = event.payload;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id === task_id) {
              return {
                ...t,
                status: t.status === "cancelled" ? "cancelled" : status as TransferTask["status"],
                errorMsg: error,
                speed: 0,
                progress: status === "completed" ? 100 : t.progress,
                endTime: Date.now(),
              };
            }
            return t;
          })
        );
      }
    ).then((fn) => {
      if (disposed) fn();
      else unlistenStatus = fn;
    });

    return () => {
      disposed = true;
      if (unlistenProgress) unlistenProgress();
      if (unlistenStatus) unlistenStatus();
    };
  }, []);

  const activeCount = tasks.filter(
    (t) => t.status === "transferring" || t.status === "pending"
  ).length;

  const startDownload = async (
    sessionId: string,
    hostName: string,
    remotePath: string,
    fileName: string,
    totalSize: number = 0,
    customLocalPath?: string
  ): Promise<string> => {
    let localPath = customLocalPath;
    if (!localPath) {
      let downloadDir = "";
      try {
        const savedSettings = localStorage.getItem("ultimateshell_app_settings");
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          if (parsed.downloadDir && typeof parsed.downloadDir === "string" && parsed.downloadDir.trim()) {
            downloadDir = parsed.downloadDir.trim();
          }
        }
      } catch {}

      if (!downloadDir) {
        downloadDir = await invoke<string>("fs_get_default_download_dir").catch(
          () => "."
        );
      }
      localPath = `${downloadDir.replace(/[\\/]$/, "")}/${fileName}`;
    }

    const taskId = `dl-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newTask: TransferTask = {
      id: taskId,
      sessionId,
      hostName,
      type: "download",
      fileName,
      srcPath: remotePath,
      destPath: localPath,
      totalSize,
      transferredSize: 0,
      speed: 0,
      progress: 0,
      status: "pending",
      startTime: Date.now(),
    };

    setTasks((prev) => [newTask, ...prev]);
    setIsOpen(true);
    setIsCollapsed(false);

    // Trigger backend download
    invoke("fs_download_file", {
      sessionId,
      remotePath,
      localPath,
      taskId,
    }).catch((err) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId && t.status !== "cancelled"
            ? {
                ...t,
                status: "error",
                errorMsg: typeof err === "string" ? err : err?.message || "下载失败",
                endTime: Date.now(),
              }
            : t
        )
      );
    });

    return taskId;
  };

  const startUpload = (
    sessionId: string,
    hostName: string,
    localPath: string,
    remoteDir: string,
    customFileName?: string
  ): Promise<string> => {
    if (!localPath || !remoteDir?.trim()) return Promise.reject(new Error("上传源文件或目标目录为空，已停止上传。"));
    const fileName = customFileName || localPath.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
    if (!fileName || fileName === "." || fileName === ".." || /[/\\]/.test(fileName)) {
      return Promise.reject(new Error("上传文件名无效。"));
    }
    const remotePath = `${remoteDir.replace(/\/$/, "")}/${fileName}`;
    const key = JSON.stringify([sessionId, localPath, remotePath]);
    const existing = uploadsRef.current.get(key);
    if (existing) return existing;
    const taskId = `up-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const newTask: TransferTask = {
      id: taskId, sessionId, hostName, type: "upload", fileName,
      srcPath: localPath, destPath: remotePath, totalSize: 0,
      transferredSize: 0, speed: 0, progress: 0, status: "pending", startTime: Date.now(),
    };
    setTasks(prev => [newTask, ...prev]);
    setIsOpen(true);
    setIsCollapsed(false);
    let finish!: (id: string) => void;
    const result = new Promise<string>(resolve => { finish = resolve; });
    uploadsRef.current.set(key, result);
    queueRef.current.jobs.push(async () => {
      try {
        if (cancelledRef.current.has(taskId)) return;
        await invoke("fs_upload_file", { sessionId, localPath, remotePath, taskId });
        const cancelled = cancelledRef.current.has(taskId);
        setTasks(prev => prev.map(t => t.id !== taskId ? t : cancelled || t.status === "cancelled"
          ? { ...t, status: "cancelled", speed: 0, endTime: Date.now() }
          : { ...t, status: "completed", progress: 100, speed: 0, errorMsg: undefined, endTime: Date.now() }));
      } catch (err) {
        const cancelled = cancelledRef.current.has(taskId);
        setTasks(prev => prev.map(t => t.id !== taskId ? t : cancelled || t.status === "cancelled"
          ? { ...t, status: "cancelled", speed: 0, endTime: Date.now() }
          : { ...t, status: "error", speed: 0, errorMsg: String(err), endTime: Date.now() }));
      } finally {
        uploadsRef.current.delete(key);
        cancelledRef.current.delete(taskId);
        finish(taskId);
      }
    });
    pumpUploads();
    return result;
  };

  const cancelTransfer = async (taskId: string) => {
    if (tasksRef.current.some(t => t.id === taskId && t.type === "upload")) cancelledRef.current.add(taskId);
    try {
      await invoke("fs_cancel_transfer", { taskId });
    } catch {}
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId && (t.status === "pending" || t.status === "transferring")
          ? { ...t, status: "cancelled", speed: 0, endTime: Date.now() }
          : t
      )
    );
  };

  const retryTransfer = async (taskId: string) => {
    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!task) return;
    if (task.type === "download") {
      await startDownload(
        task.sessionId,
        task.hostName,
        task.srcPath,
        task.fileName,
        task.totalSize,
        task.destPath
      );
    } else {
      const dir = task.destPath.substring(0, task.destPath.lastIndexOf("/"));
      await startUpload(
        task.sessionId,
        task.hostName,
        task.srcPath,
        dir,
        task.fileName
      );
    }
  };

  const clearCompleted = () => {
    setTasks((prev) =>
      prev.filter((t) => t.status === "transferring" || t.status === "pending")
    );
  };

  const removeTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  return (
    <TransferContext.Provider
      value={{
        tasks, directories, setDirectory, followTerminalDirectory,
        isOpen,
        setIsOpen,
        isCollapsed,
        setIsCollapsed,
        startDownload,
        startUpload,
        cancelTransfer,
        retryTransfer,
        clearCompleted,
        removeTask,
        activeCount,
      }}
    >
      {children}
    </TransferContext.Provider>
  );
};

export const useTransferManager = (): TransferContextValue => {
  const ctx = useContext(TransferContext);
  if (!ctx) {
    throw new Error("useTransferManager must be used within a TransferProvider");
  }
  return ctx;
};
