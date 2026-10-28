import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TransferTask } from "../types";

interface TransferContextValue {
  tasks: TransferTask[];
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

  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

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
            if (t.id === task_id) {
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
                status: status as any,
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
      const defaultDir = await invoke<string>("fs_get_default_download_dir").catch(
        () => "."
      );
      localPath = `${defaultDir.replace(/\/$/, "")}/${fileName}`;
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
          t.id === taskId
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

  const startUpload = async (
    sessionId: string,
    hostName: string,
    localPath: string,
    remoteDir: string,
    customFileName?: string
  ): Promise<string> => {
    const rawName = localPath.split(/[/\\]/).pop() || "upload.bin";
    const fileName = customFileName || rawName;
    const remotePath = `${remoteDir.replace(/\/$/, "")}/${fileName}`;

    const taskId = `up-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newTask: TransferTask = {
      id: taskId,
      sessionId,
      hostName,
      type: "upload",
      fileName,
      srcPath: localPath,
      destPath: remotePath,
      totalSize: 0,
      transferredSize: 0,
      speed: 0,
      progress: 0,
      status: "pending",
      startTime: Date.now(),
    };

    setTasks((prev) => [newTask, ...prev]);
    setIsOpen(true);
    setIsCollapsed(false);

    // Trigger backend upload
    invoke("fs_upload_file", {
      sessionId,
      localPath,
      remotePath,
      taskId,
    }).catch((err) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: "error",
                errorMsg: typeof err === "string" ? err : err?.message || "上传失败",
                endTime: Date.now(),
              }
            : t
        )
      );
    });

    return taskId;
  };

  const cancelTransfer = async (taskId: string) => {
    try {
      await invoke("fs_cancel_transfer", { taskId });
    } catch {}
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
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
        tasks,
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
