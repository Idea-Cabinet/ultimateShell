import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { usePointerReorder } from "../hooks/usePointerReorder";
import { useI18n } from "../i18n";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useTransferManager } from "../context/TransferContext";
import { DirResult, FileEntry, TabSession, PreviewResult } from "../types";
import { TextEditorModal } from "./TextEditorModal";
import {
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode,
  FileArchive,
  FileJson,
  Image as ImageIcon,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Search,
  Eye,
  EyeOff,
  Copy,
  Terminal,
  Maximize2,
  Minimize2,
  X,
  HardDrive,
  Layers,
  Upload,
  Download,
  Pencil,
  ArrowUpDown,
  FilePlus,
  FolderPlus,
  Trash2,
  AlertTriangle,
  ShieldCheck,
  Calculator,
} from "lucide-react";

interface FileExplorerProps {
  session: TabSession;
  height?: number;
  isOpen: boolean;
  isMaximized?: boolean;
  currentUser?: string;
  hideHeaderControls?: boolean;
  onToggleMaximize?: () => void;
  onClose?: () => void;
  onSendToTerminal: (cmd: string) => void;
}

export type ColumnId = "name" | "mtime" | "file_type" | "size" | "permissions" | "owner";

interface ColumnDef {
  id: ColumnId;
  label: string;
  width: number;
  minWidth: number;
  align: "left" | "right";
  sortable: boolean;
  tooltip: string;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  {
    id: "name",
    label: "名称",
    width: 260,
    minWidth: 120,
    align: "left",
    sortable: true,
    tooltip: "文件/目录名称 (点击升降序，可拖拽列头排序或拖拽右边缘调整宽度)",
  },
  {
    id: "mtime",
    label: "修改日期",
    width: 140,
    minWidth: 90,
    align: "left",
    sortable: true,
    tooltip: "最后修改日期 (点击按时间先后排序)",
  },
  {
    id: "file_type",
    label: "类型",
    width: 110,
    minWidth: 70,
    align: "left",
    sortable: true,
    tooltip: "文件类型说明 (点击归类排序)",
  },
  {
    id: "size",
    label: "大小",
    width: 95,
    minWidth: 60,
    align: "right",
    sortable: true,
    tooltip: "文件大小 (点击按字节大小排序)",
  },
  {
    id: "permissions",
    label: "权限",
    width: 95,
    minWidth: 70,
    align: "left",
    sortable: false,
    tooltip: "POSIX 权限掩码 (如 drwxr-xr-x)",
  },
  {
    id: "owner",
    label: "所有者",
    width: 85,
    minWidth: 60,
    align: "left",
    sortable: false,
    tooltip: "文件拥有者与群组 (UID:GID)",
  },
];

type SortField = "name" | "size" | "mtime" | "file_type";
type SortDirection = "asc" | "desc";

// Dynamic Tree Node with 100% Lazy Loading
interface LazyTreeNode {
  path: string;
  name: string;
  isDir: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  children: LazyTreeNode[] | null; // null means not yet loaded (lazy)
}

export interface ChmodState {
  ownerR: boolean;
  ownerW: boolean;
  ownerX: boolean;
  groupR: boolean;
  groupW: boolean;
  groupX: boolean;
  otherR: boolean;
  otherW: boolean;
  otherX: boolean;
}

export const parseOctalToState = (oct: string): ChmodState => {
  const clean = oct.replace(/^0+/, "") || "0";
  const num = parseInt(clean, 8) || 0;
  return {
    ownerR: Boolean(num & 0o400),
    ownerW: Boolean(num & 0o200),
    ownerX: Boolean(num & 0o100),
    groupR: Boolean(num & 0o040),
    groupW: Boolean(num & 0o020),
    groupX: Boolean(num & 0o010),
    otherR: Boolean(num & 0o004),
    otherW: Boolean(num & 0o002),
    otherX: Boolean(num & 0o001),
  };
};

export const stateToOctal = (s: ChmodState): string => {
  let num = 0;
  if (s.ownerR) num |= 0o400;
  if (s.ownerW) num |= 0o200;
  if (s.ownerX) num |= 0o100;
  if (s.groupR) num |= 0o040;
  if (s.groupW) num |= 0o020;
  if (s.groupX) num |= 0o010;
  if (s.otherR) num |= 0o004;
  if (s.otherW) num |= 0o002;
  if (s.otherX) num |= 0o001;
  return "0" + num.toString(8).padStart(3, "0");
};

export const parsePermissionsToOctal = (permStr: string, isDir: boolean): string => {
  const s = permStr.replace(/^[-dcbsp]/, "");
  if (s.length >= 9) {
    let num = 0;
    if (s[0] === 'r') num |= 0o400;
    if (s[1] === 'w') num |= 0o200;
    if (s[2] === 'x') num |= 0o100;
    if (s[3] === 'r') num |= 0o040;
    if (s[4] === 'w') num |= 0o020;
    if (s[5] === 'x') num |= 0o010;
    if (s[6] === 'r') num |= 0o004;
    if (s[7] === 'w') num |= 0o002;
    if (s[8] === 'x') num |= 0o001;
    return "0" + num.toString(8).padStart(3, "0");
  }
  return isDir ? "0755" : "0644";
};

export function FileExplorer({
  session,
  height: _height,
  isOpen,
  isMaximized,
  currentUser,
  hideHeaderControls,
  onToggleMaximize,
  onClose,
  onSendToTerminal,
}: FileExplorerProps) {
  // Always default to root directory "/" so no subfolder/root is auto-selected!
  const [currentPath, setCurrentPath] = useState<string>("/");
  const [parentPath, setParentPath] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalDirs, setTotalDirs] = useState<number>(0);
  const [totalFiles, setTotalFiles] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Address bar & search
  const [isEditingPath, setIsEditingPath] = useState<boolean>(false);
  const [inputPath, setInputPath] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showHidden, setShowHidden] = useState<boolean>(false);

  // Navigation History
  const [history, setHistory] = useState<string[]>(["/"]);
  const [historyIdx, setHistoryIdx] = useState<number>(0);

  const { t } = useI18n();

  const getColumnLabel = (id: ColumnId): string => {
    switch (id) {
      case "name": return t("files.col.name");
      case "mtime": return t("files.col.mtime");
      case "file_type": return t("files.col.type");
      case "size": return t("files.col.size");
      case "permissions": return t("files.col.permissions");
      case "owner": return t("files.col.owner");
      default: return id;
    }
  };

  // Sorting
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Selection
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);

  // Resizable Left sidebar tree toggle & lazy root
  const [showTreePane, setShowTreePane] = useState<boolean>(true);
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    const saved = localStorage.getItem("ultimateshell_tree_width");
    return saved ? parseInt(saved, 10) : 210;
  });
  const [rootNodes, setRootNodes] = useState<LazyTreeNode[]>([]);
  const [isTreeLoading, setIsTreeLoading] = useState<boolean>(false);
  const rootNodesCache = useRef<Record<string, LazyTreeNode[]>>({});

  // Resizable & Reorderable Table Columns
  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    try {
      const saved = localStorage.getItem("ultimateshell_explorer_cols_v2");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === DEFAULT_COLUMNS.length) {
          return parsed;
        }
      }
    } catch {}
    return DEFAULT_COLUMNS;
  });
  const columnHeaderRef = useRef<HTMLDivElement>(null);
  const columnReorder = usePointerReorder(columns, (next) => {
    setColumns(next);
    localStorage.setItem("ultimateshell_explorer_cols_v2", JSON.stringify(next));
  }, columnHeaderRef);

  // Dynamic user detection with real-time prompt parsing
  const [detectedUser, setDetectedUser] = useState<string>(() => {
    return currentUser || session.hostProfile?.username || "root";
  });

  useEffect(() => {
    if (currentUser) {
      setDetectedUser(currentUser);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!session.id) return;
    let unlisten: (() => void) | null = null;
    listen<string>(`pty-user-${session.id}`, (event) => {
      if (event.payload) {
        setDetectedUser(event.payload);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [session.id]);

  // Request counter to discard stale async responses
  const activeReqId = useRef<number>(0);

  // Tree Pane Horizontal Resizer
  const handleStartTreeResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = treeWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.min(Math.max(140, startW + delta), 480);
      setTreeWidth(newWidth);
      localStorage.setItem("ultimateshell_tree_width", newWidth.toString());
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Column width resizing
  const handleStartColResize = (colId: ColumnId, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const col = columns.find((c) => c.id === colId);
    if (!col) return;
    const startWidth = col.width;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(col.minWidth, startWidth + delta);
      setColumns((prev) => {
        const updated = prev.map((c) => (c.id === colId ? { ...c, width: newWidth } : c));
        localStorage.setItem("ultimateshell_explorer_cols_v2", JSON.stringify(updated));
        return updated;
      });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Preview / Editor Modal
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [editContent, setEditContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Global Transfer Manager
  const transferManager = useTransferManager();

  // Drag & drop state for file upload
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Rename states
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);
  const [newName, setNewName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Focus rename input and select filename without extension
  useEffect(() => {
    if (renamingEntry && renameInputRef.current) {
      renameInputRef.current.focus();
      const dotIdx = renamingEntry.name.lastIndexOf(".");
      if (dotIdx > 0 && !renamingEntry.is_dir) {
        renameInputRef.current.setSelectionRange(0, dotIdx);
      } else {
        renameInputRef.current.select();
      }
    }
  }, [renamingEntry]);

  // Context Menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);

  // Blank Area Context Menu (New File, New Folder, Upload, Terminal, Refresh)
  const [blankContextMenu, setBlankContextMenu] = useState<{ x: number; y: number } | null>(null);

  // New File / Folder modal state
  const [createModal, setCreateModal] = useState<{ type: "file" | "folder" } | null>(null);
  const [createItemName, setCreateItemName] = useState("");
  const [createItemLoading, setCreateItemLoading] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Focus create input on modal open
  useEffect(() => {
    if (createModal && createInputRef.current) {
      createInputRef.current.focus();
      const dotIdx = createItemName.lastIndexOf(".");
      if (dotIdx > 0 && createModal.type === "file") {
        createInputRef.current.setSelectionRange(0, dotIdx);
      } else {
        createInputRef.current.select();
      }
    }
  }, [createModal]);

  // Delete modal state (Recycle bin / permanent delete)
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [isFirstTimeDelete, setIsFirstTimeDelete] = useState(false);
  const [modalUseTrash, setModalUseTrash] = useState(false);
  const [modalRememberChoice, setModalRememberChoice] = useState(true);

  // Terminal CWD Sync state
  const [isSyncingCwd, setIsSyncingCwd] = useState(false);

  // Archive & Extract states
  const [archiveModal, setArchiveModal] = useState<{
    entry: FileEntry;
    format: "tar.gz" | "zip";
    archiveName: string;
  } | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [extractLoading, setExtractLoading] = useState(false);

  // Chmod / Permissions modal state
  const [chmodModal, setChmodModal] = useState<{
    entry: FileEntry;
    octal: string;
    state: ChmodState;
    recursive: boolean;
    owner: string;
    folderSize?: string | null;
    isCalculatingSize?: boolean;
  } | null>(null);
  const [chmodLoading, setChmodLoading] = useState(false);

  // Fetch directory contents lazily for the main table view
  const loadDirectory = async (path: string, pushHistory = true) => {
    if (!session.id || !isOpen) return;
    const reqId = ++activeReqId.current;

    setLoading(true);
    setErrorMsg(null);
    setSelectedEntry(null);

    try {
      const res = await invoke<DirResult>("fs_list_dir", {
        sessionId: session.id,
        path,
        showHidden,
      });

      if (reqId !== activeReqId.current) return; // Stale response discarded

      setCurrentPath(res.current_path);
      setParentPath(res.parent_path);
      setEntries(res.entries);
      setTotalCount(res.total_count);
      setTotalDirs(res.total_dirs);
      setTotalFiles(res.total_files);
      setInputPath(res.current_path);

      // Populate outermost tree cache if not already populated
      if (res.current_path === "/" && !rootNodesCache.current[session.id]?.length) {
        const topFolders: LazyTreeNode[] = res.entries
          .filter((e) => e.is_dir)
          .map((e) => ({
            path: e.path,
            name: e.name,
            isDir: true,
            isExpanded: false,
            isLoading: false,
            children: null,
          }));
        rootNodesCache.current[session.id] = topFolders;
        setRootNodes(topFolders);
        setIsTreeLoading(false);
      }

      if (pushHistory) {
        setHistory((prev) => {
          const updated = [...prev.slice(0, historyIdx + 1), res.current_path];
          setHistoryIdx(updated.length - 1);
          return updated;
        });
      }
    } catch (err: any) {
      if (reqId !== activeReqId.current) return;
      console.error("加载目录失败:", err);
      setErrorMsg(typeof err === "string" ? err : err.message || "读取目录超时或失败");
    } finally {
      if (reqId === activeReqId.current) {
        setLoading(false);
      }
    }
  };

  // Automatically load the outermost root items with caching and auto-retry
  const autoLoadOutermostTree = async (targetSessionId: string, retryCount = 0) => {
    if (!targetSessionId || !isOpen) return;

    // Check memory cache first
    const cached = rootNodesCache.current[targetSessionId];
    if (cached && cached.length > 0) {
      setRootNodes(cached);
      setIsTreeLoading(false);
      return;
    }

    setIsTreeLoading(true);

    try {
      const res = await invoke<DirResult>("fs_list_dir", {
        sessionId: targetSessionId,
        path: "/",
        showHidden: false,
      });

      const topFolders: LazyTreeNode[] = res.entries
        .filter((e) => e.is_dir)
        .map((e) => ({
          path: e.path,
          name: e.name,
          isDir: true,
          isExpanded: false,
          isLoading: false,
          children: null, // Subfolders NOT loaded until clicked!
        }));

      rootNodesCache.current[targetSessionId] = topFolders;
      if (session.id === targetSessionId) {
        setRootNodes(topFolders);
        setIsTreeLoading(false);
      }
    } catch (err) {
      console.warn(`[AutoLoadTree] 尝试第 ${retryCount + 1} 次自动载入外层目录:`, err);
      // Auto-retry up to 3 times with exponential backoff if SSH is still negotiating
      if (retryCount < 3 && isOpen && session.id === targetSessionId) {
        setTimeout(() => {
          autoLoadOutermostTree(targetSessionId, retryCount + 1);
        }, 700 * (retryCount + 1));
      } else {
        if (session.id === targetSessionId) {
          setIsTreeLoading(false);
        }
      }
    }
  };

  const initLazyRoot = async (forceRefresh = false) => {
    if (!session.id || !isOpen) return;
    if (forceRefresh) {
      delete rootNodesCache.current[session.id];
    }
    await autoLoadOutermostTree(session.id);
  };

  // Lazy load sub-folder only when the user clicks that specific folder
  const handleToggleFolderNode = async (node: LazyTreeNode) => {
    // If already expanded, just collapse (0 network call)
    if (node.isExpanded) {
      node.isExpanded = false;
      setRootNodes([...rootNodes]);
      return;
    }

    // If children already cached, just expand (0 network call)
    if (node.children !== null) {
      node.isExpanded = true;
      setRootNodes([...rootNodes]);
      loadDirectory(node.path);
      return;
    }

    // Pure on-demand lazy fetch for this specific folder!
    node.isLoading = true;
    setRootNodes([...rootNodes]);

    try {
      const res = await invoke<DirResult>("fs_list_dir", {
        sessionId: session.id,
        path: node.path,
        showHidden,
      });

      // Only extract child folders for the tree, keep children unexpanded (lazy)
      const childNodes: LazyTreeNode[] = res.entries
        .filter((e) => e.is_dir)
        .map((e) => ({
          path: e.path,
          name: e.name,
          isDir: true,
          isExpanded: false,
          isLoading: false,
          children: null, // Nested subdirectories are also lazy!
        }));

      node.children = childNodes;
      node.isExpanded = true;
      // Also update table view to this folder
      loadDirectory(node.path);
    } catch (err) {
      console.error(`加载子文件夹 ${node.path} 失败:`, err);
      node.children = [];
    } finally {
      node.isLoading = false;
      setRootNodes([...rootNodes]);
    }
  };

  // Open explorer at user home directory "~" and auto-load outermost directory tree
  useEffect(() => {
    if (isOpen && session.id) {
      setCurrentPath("~");
      setHistory(["~"]);
      setHistoryIdx(0);
      setSelectedEntry(null);
      loadDirectory("~", false);

      // Requirement 1: If outermost directory tree has not been loaded yet, auto-load it!
      const cached = rootNodesCache.current[session.id];
      if (cached && cached.length > 0) {
        setRootNodes(cached);
        setIsTreeLoading(false);
      } else {
        setRootNodes([]);
        autoLoadOutermostTree(session.id);
      }
    }
  }, [isOpen, session.id]);

  // Reload when showHidden toggles
  useEffect(() => {
    if (isOpen && session.id && currentPath) {
      loadDirectory(currentPath, false);
    }
  }, [showHidden]);

  // Navigation handlers
  const handleGoBack = () => {
    if (historyIdx > 0) {
      const prevIdx = historyIdx - 1;
      setHistoryIdx(prevIdx);
      loadDirectory(history[prevIdx], false);
    }
  };

  const handleGoForward = () => {
    if (historyIdx < history.length - 1) {
      const nextIdx = historyIdx + 1;
      setHistoryIdx(nextIdx);
      loadDirectory(history[nextIdx], false);
    }
  };

  const handleGoUp = () => {
    if (parentPath && parentPath !== currentPath) {
      loadDirectory(parentPath);
    }
  };

  const handleGoHome = () => {
    loadDirectory("~");
  };

  const handleRefresh = () => {
    loadDirectory(currentPath, false);
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputPath.trim()) {
      setIsEditingPath(false);
      loadDirectory(inputPath.trim());
    }
  };

  // Double click file / folder in table view
  const handleItemDoubleClick = (entry: FileEntry) => {
    if (entry.is_dir) {
      loadDirectory(entry.path);
    } else {
      openFilePreview(entry);
    }
  };

  // Open file preview & editor modal (ultra-fast tail/head chunked preview for logs & text)
  const openFilePreview = async (entry: FileEntry, requestedMode?: "tail" | "head") => {
    setPreviewFile(entry);
    setPreviewLoading(true);
    setPreviewError(null);
    setSaveSuccess(false);

    const isLog =
      entry.name.endsWith(".log") ||
      entry.name.endsWith(".out") ||
      entry.name.endsWith(".err") ||
      entry.path.includes("/log/") ||
      entry.name.includes("syslog") ||
      entry.name.includes("messages");

    const mode = requestedMode || (isLog ? "tail" : undefined);

    try {
      const res = await invoke<PreviewResult>("fs_read_preview", {
        sessionId: session.id,
        path: entry.path,
        mode,
        maxBytes: 128 * 1024,
      });
      setPreviewResult(res);
      setEditContent(res.content);
    } catch (err: any) {
      setPreviewError(typeof err === "string" ? err : err?.message || String(err));
      setPreviewResult(null);
      setEditContent("");
    } finally {
      setPreviewLoading(false);
    }
  };

  // Save modified text file content to remote or local
  const handleSaveFile = async (newContent?: string): Promise<boolean> => {
    if (!previewFile || isSaving) return false;
    const contentToSave = newContent !== undefined ? newContent : editContent;
    setIsSaving(true);
    try {
      await invoke("fs_save_file", {
        sessionId: session.id,
        path: previewFile.path,
        content: contentToSave,
      });
      setEditContent(contentToSave);
      setPreviewResult((prev) =>
        prev
          ? {
              ...prev,
              content: contentToSave,
              line_count: contentToSave.split("\n").length,
            }
          : null
      );
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2200);
      return true;
    } catch (err: any) {
      alert(`保存文件失败: ${typeof err === "string" ? err : err?.message || err}`);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // Force close preview modal
  const forceClosePreview = () => {
    setPreviewFile(null);
    setPreviewResult(null);
    setPreviewError(null);
    setEditContent("");
    setSaveSuccess(false);
  };

  // Download file to default Downloads folder
  const handleDownload = async (entry: FileEntry) => {
    try {
      await transferManager.startDownload(
        session.id,
        session.title || "服务器",
        entry.path,
        entry.name,
        entry.size
      );
    } catch (err) {
      console.error("下载失败:", err);
    }
  };

  // Download file with Save As... dialog
  const handleDownloadSaveAs = async (entry: FileEntry) => {
    try {
      const selected = await save({
        defaultPath: entry.name,
        title: "另存为到本地目录",
      });
      if (selected) {
        await transferManager.startDownload(
          session.id,
          session.title || "服务器",
          entry.path,
          entry.name,
          entry.size,
          selected
        );
      }
    } catch (err) {
      console.error("另存为失败:", err);
    }
  };

  // Upload files via file picker dialog
  const handleUploadClick = async () => {
    try {
      const selected = await open({
        multiple: true,
        title: `选择要上传到 ${currentPath} 的文件`,
      });
      if (selected) {
        const filePaths = Array.isArray(selected) ? selected : [selected];
        for (const localPath of filePaths) {
          if (localPath) {
            await transferManager.startUpload(
              session.id,
              session.title || "服务器",
              localPath,
              currentPath
            );
          }
        }
      }
    } catch (err) {
      console.error("打开文件选择器失败:", err);
    }
  };

  // Confirm rename operation
  const handleConfirmRename = async () => {
    if (!renamingEntry || !newName.trim() || newName.trim() === renamingEntry.name) {
      setRenamingEntry(null);
      return;
    }
    const cleanNewName = newName.trim();
    const parentDir = renamingEntry.path.substring(0, renamingEntry.path.lastIndexOf("/"));
    const newPath = `${parentDir}/${cleanNewName}`;

    setRenameLoading(true);
    try {
      await invoke("fs_rename", {
        sessionId: session.id,
        oldPath: renamingEntry.path,
        newPath,
      });
      setRenamingEntry(null);
      loadDirectory(currentPath, false);
    } catch (err: any) {
      alert(`重命名失败: ${typeof err === "string" ? err : err?.message || err}`);
    } finally {
      setRenameLoading(false);
    }
  };

  // Confirm create file or directory
  const handleConfirmCreate = async () => {
    if (!createModal || !createItemName.trim()) {
      setCreateModal(null);
      return;
    }
    const cleanName = createItemName.trim();
    const basePath = currentPath === "/" ? "" : currentPath.replace(/\/$/, "");
    const targetPath = `${basePath}/${cleanName}`;
    setCreateItemLoading(true);

    try {
      console.log(`[FileExplorer] 创建${createModal.type === "file" ? "文件" : "文件夹"}: targetPath=${targetPath}`);
      if (createModal.type === "file") {
        await invoke("fs_create_file", {
          sessionId: session.id,
          path: targetPath,
        });
      } else {
        await invoke("fs_create_dir", {
          sessionId: session.id,
          path: targetPath,
        });
      }
      setCreateModal(null);
      setCreateItemName("");
      await loadDirectory(currentPath, false);
      if (currentPath === "/" || currentPath === "~") {
        initLazyRoot(true);
      }
    } catch (err: any) {
      console.error("[FileExplorer] 创建失败:", err);
      const errStr = typeof err === "string" ? err : err?.message || String(err);
      if (errStr.includes("permission denied") || errStr.includes("SFTP(3)") || errStr.includes("Permission denied")) {
        alert(
          `创建${createModal.type === "file" ? "文件" : "文件夹"}失败: 权限不足 (Permission Denied)\n\n当前用户无权在目录「${currentPath}」中写入。\n\n提示：若需在根目录或受保护的系统目录（如 / 或 /etc）中创建，请在终端切换为 root 身份；或点击主页图标 (~) 导航至您的主目录进行操作。`
        );
      } else {
        alert(`创建${createModal.type === "file" ? "文件" : "文件夹"}失败: ${errStr}`);
      }
    } finally {
      setCreateItemLoading(false);
    }
  };

  // Open delete confirmation modal (checks if user has already configured trash preference)
  const handleRequestDelete = (entry: FileEntry) => {
    let hasAsked = false;
    let deleteToTrash = false;
    try {
      const s = localStorage.getItem("ultimateshell_app_settings");
      if (s) {
        const parsed = JSON.parse(s);
        hasAsked = !!parsed.hasAskedTrashConfirm;
        deleteToTrash = !!parsed.deleteToTrash;
      }
    } catch {}

    setDeleteTarget(entry);
    setModalUseTrash(deleteToTrash);
    setIsFirstTimeDelete(!hasAsked);
  };

  // Confirm delete file or folder
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);

    try {
      // If first time prompt, persist user's choice to app settings
      if (isFirstTimeDelete && modalRememberChoice) {
        try {
          const s = localStorage.getItem("ultimateshell_app_settings");
          const parsed = s ? JSON.parse(s) : {};
          parsed.hasAskedTrashConfirm = true;
          parsed.deleteToTrash = modalUseTrash;
          localStorage.setItem("ultimateshell_app_settings", JSON.stringify(parsed));
        } catch {}
      }

      console.log(`[FileExplorer] 删除项: path=${deleteTarget.path}, is_dir=${deleteTarget.is_dir}, use_trash=${modalUseTrash}`);
      await invoke("fs_delete", {
        sessionId: session.id,
        path: deleteTarget.path,
        isDir: deleteTarget.is_dir,
        useTrash: modalUseTrash,
      });

      setDeleteTarget(null);
      await loadDirectory(currentPath, false);
      if (currentPath === "/" || currentPath === "~") {
        initLazyRoot(true);
      }
    } catch (err: any) {
      console.error("[FileExplorer] 删除失败:", err);
      const errStr = typeof err === "string" ? err : err?.message || String(err);
      alert(`删除失败: ${errStr}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  // Follow Terminal CWD
  const handleSyncTerminalCwd = async () => {
    if (!session.id || isSyncingCwd) return;
    setIsSyncingCwd(true);
    try {
      const cwd = await invoke<string>("fs_get_terminal_cwd", {
        sessionId: session.id,
      });
      if (cwd && cwd.trim() && cwd.trim() !== currentPath) {
        await loadDirectory(cwd.trim(), true);
      }
    } catch (err: any) {
      console.warn("[FileExplorer] 同步终端工作目录失败:", err);
      const errStr = typeof err === "string" ? err : err?.message || String(err);
      alert(`获取终端工作目录失败: ${errStr}`);
    } finally {
      setIsSyncingCwd(false);
    }
  };

  // Archive Handlers
  const openArchiveModal = (entry: FileEntry, format: "tar.gz" | "zip") => {
    const ext = format === "tar.gz" ? ".tar.gz" : ".zip";
    const baseName = entry.name.replace(/\.[^/.]+$/, "");
    const defaultName = `${entry.is_dir ? entry.name : (baseName || entry.name)}${ext}`;
    setArchiveModal({
      entry,
      format,
      archiveName: defaultName,
    });
  };

  const handleConfirmArchive = async () => {
    if (!archiveModal || !archiveModal.archiveName.trim()) return;
    setArchiveLoading(true);
    try {
      const parentDir = currentPath === "/" ? "" : currentPath.replace(/\/$/, "");
      const destArchivePath = `${parentDir}/${archiveModal.archiveName.trim()}`;
      await invoke("fs_archive", {
        sessionId: session.id,
        sourcePaths: [archiveModal.entry.path],
        destArchivePath,
        format: archiveModal.format,
      });
      setArchiveModal(null);
      await loadDirectory(currentPath, false);
    } catch (err: any) {
      console.error("[FileExplorer] 压缩失败:", err);
      const errStr = typeof err === "string" ? err : err?.message || String(err);
      alert(`压缩失败: ${errStr}`);
    } finally {
      setArchiveLoading(false);
    }
  };

  // Extract Archive Handler
  const handleExtractArchive = async (entry: FileEntry) => {
    if (extractLoading) return;
    setExtractLoading(true);
    try {
      await invoke("fs_extract", {
        sessionId: session.id,
        archivePath: entry.path,
        destDir: currentPath,
      });
      await loadDirectory(currentPath, false);
      if (currentPath === "/" || currentPath === "~") {
        initLazyRoot(true);
      }
    } catch (err: any) {
      console.error("[FileExplorer] 解压失败:", err);
      const errStr = typeof err === "string" ? err : err?.message || String(err);
      alert(`解压失败: ${errStr}`);
    } finally {
      setExtractLoading(false);
    }
  };

  // Helper to check if file is an archive
  const isArchiveFile = (fileName: string): boolean => {
    const lower = fileName.toLowerCase();
    return (
      lower.endsWith(".tar.gz") ||
      lower.endsWith(".tgz") ||
      lower.endsWith(".tar") ||
      lower.endsWith(".zip")
    );
  };

  // Chmod / Permissions Modal Handlers
  const openChmodModal = (entry: FileEntry) => {
    const octal = parsePermissionsToOctal(entry.permissions || "", entry.is_dir);
    const state = parseOctalToState(octal);
    const owner = entry.owner || "";
    setChmodModal({
      entry,
      octal,
      state,
      recursive: false,
      owner,
      folderSize: null,
      isCalculatingSize: false,
    });
  };

  const handleCalculateFolderSize = async () => {
    if (!chmodModal || !chmodModal.entry.is_dir || chmodModal.isCalculatingSize) return;
    setChmodModal((prev) => (prev ? { ...prev, isCalculatingSize: true } : null));
    try {
      const sizeStr = await invoke<string>("fs_get_dir_size", {
        sessionId: session.id,
        path: chmodModal.entry.path,
      });
      setChmodModal((prev) => (prev ? { ...prev, folderSize: sizeStr, isCalculatingSize: false } : null));
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || String(err);
      setChmodModal((prev) => (prev ? { ...prev, folderSize: `统计失败: ${msg}`, isCalculatingSize: false } : null));
    }
  };

  const handleChmodStateToggle = (key: keyof ChmodState) => {
    if (!chmodModal) return;
    const newState = { ...chmodModal.state, [key]: !chmodModal.state[key] };
    const newOctal = stateToOctal(newState);
    setChmodModal({
      ...chmodModal,
      state: newState,
      octal: newOctal,
    });
  };

  const handleChmodOctalChange = (val: string) => {
    if (!chmodModal) return;
    const clean = val.replace(/[^0-7]/g, "").slice(0, 4);
    const newState = parseOctalToState(clean);
    setChmodModal({
      ...chmodModal,
      octal: clean,
      state: newState,
    });
  };

  const handleApplyPreset = (presetOctal: string) => {
    if (!chmodModal) return;
    const newState = parseOctalToState(presetOctal);
    setChmodModal({
      ...chmodModal,
      octal: presetOctal,
      state: newState,
    });
  };

  const handleConfirmChmod = async () => {
    if (!chmodModal) return;
    setChmodLoading(true);
    try {
      await invoke("fs_chmod", {
        sessionId: session.id,
        path: chmodModal.entry.path,
        mode: chmodModal.octal,
        recursive: chmodModal.recursive,
      });

      if (chmodModal.owner && chmodModal.owner.trim()) {
        await invoke("fs_chown", {
          sessionId: session.id,
          path: chmodModal.entry.path,
          owner: chmodModal.owner.trim(),
          recursive: chmodModal.recursive,
        });
      }

      setChmodModal(null);
      await loadDirectory(currentPath, false);
    } catch (err: any) {
      console.error("[FileExplorer] 更改权限失败:", err);
      const errStr = typeof err === "string" ? err : err?.message || String(err);
      alert(`设置权限失败: ${errStr}`);
    } finally {
      setChmodLoading(false);
    }
  };

  // Drag and Drop event handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer?.types?.includes("Files")) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setIsDragOver(false);
      dragCounterRef.current = 0;
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const localPath = (file as any).path;
        if (localPath) {
          await transferManager.startUpload(
            session.id,
            session.title || "服务器",
            localPath,
            currentPath,
            file.name
          );
        }
      }
    }
  };

  // Listen for Tauri window native drag-drop
  useEffect(() => {
    if (!isOpen) return;
    let unlisten: (() => void) | null = null;
    listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
      const paths = event.payload?.paths;
      if (paths && paths.length > 0) {
        for (const localPath of paths) {
          await transferManager.startUpload(
            session.id,
            session.title || "服务器",
            localPath,
            currentPath
          );
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [isOpen, session.id, session.title, currentPath]);

  // Sorting columns
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Filtered & Sorted Entries
  const filteredEntries = useMemo(() => {
    let result = entries;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e) => e.name.toLowerCase().includes(q));
    }

    return [...result].sort((a, b) => {
      // Directories always come first
      if (a.is_dir !== b.is_dir) {
        return a.is_dir ? -1 : 1;
      }

      let comp = 0;
      if (sortField === "name") {
        comp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortField === "size") {
        comp = a.size - b.size;
      } else if (sortField === "mtime") {
        comp = a.mtime - b.mtime;
      } else if (sortField === "file_type") {
        comp = a.file_type.localeCompare(b.file_type);
      }

      return sortDirection === "asc" ? comp : -comp;
    });
  }, [entries, searchQuery, sortField, sortDirection]);

  // Breadcrumbs segments
  const breadcrumbs = useMemo(() => {
    if (!currentPath || currentPath === "/") {
      return [{ label: "/", path: "/" }];
    }
    const parts = currentPath.split("/").filter(Boolean);
    const crumbs = [{ label: "/", path: "/" }];
    let accumulated = "";
    for (const part of parts) {
      accumulated += `/${part}`;
      crumbs.push({ label: part, path: accumulated });
    }
    return crumbs;
  }, [currentPath]);

  // Context menu closer
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu(null);
      setBlankContextMenu(null);
    };
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  if (!isOpen) return null;

  // File Icon resolver based on extension
  const renderFileIcon = (entry: FileEntry) => {
    if (entry.is_dir) {
      return <Folder className="w-4 h-4 text-[#F2B93B] flex-shrink-0 fill-[#F2B93B]/20" />;
    }
    const ext = entry.ext;
    if (["sh", "bash", "zsh", "py", "rs", "go", "c", "cpp", "java"].includes(ext)) {
      return <FileCode className="w-4 h-4 text-[#30D158] flex-shrink-0" />;
    }
    if (["js", "jsx", "ts", "tsx"].includes(ext)) {
      return <FileCode className="w-4 h-4 text-[#007AFF] flex-shrink-0" />;
    }
    if (["json", "yaml", "yml", "toml", "conf", "ini"].includes(ext)) {
      return <FileJson className="w-4 h-4 text-[#BF5AF2] flex-shrink-0" />;
    }
    if (["tar", "gz", "tgz", "zip", "7z", "rar", "xz"].includes(ext)) {
      return <FileArchive className="w-4 h-4 text-[#FF9500] flex-shrink-0" />;
    }
    if (["png", "jpg", "jpeg", "svg", "gif", "webp"].includes(ext)) {
      return <ImageIcon className="w-4 h-4 text-[#FF2D55] flex-shrink-0" />;
    }
    if (["txt", "md", "log"].includes(ext)) {
      return <FileText className="w-4 h-4 text-[var(--text-secondary)] flex-shrink-0" />;
    }
    return <File className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />;
  };

  // Render content for each dynamic table cell
  const renderCellContent = (col: ColumnDef, entry: FileEntry) => {
    switch (col.id) {
      case "name":
        return (
          <div className="flex items-center space-x-2 truncate w-full">
            {renderFileIcon(entry)}
            <span className="truncate">{entry.name}</span>
            {entry.is_symlink && (
              <span className="text-[10px] text-[var(--text-tertiary)] font-mono flex-shrink-0">
                (链接)
              </span>
            )}
          </div>
        );
      case "mtime":
        return (
          <span className="text-[11px] text-[var(--text-tertiary)] truncate font-mono">
            {entry.mtime_formatted}
          </span>
        );
      case "file_type":
        return (
          <span className="text-[11px] text-[var(--text-tertiary)] truncate">
            {entry.file_type}
          </span>
        );
      case "size":
        return (
          <span className="text-[11px] text-[var(--text-tertiary)] truncate font-mono text-right w-full">
            {entry.size_formatted}
          </span>
        );
      case "permissions":
        return (
          <span className="text-[10.5px] text-[var(--text-tertiary)] truncate font-mono">
            {entry.permissions}
          </span>
        );
      case "owner":
        return (
          <span className="text-[10.5px] text-[var(--text-tertiary)] truncate font-mono">
            {entry.owner}
          </span>
        );
    }
  };

  // Render a lazy tree node recursively with pure on-demand expansion
  const renderLazyTreeNode = (node: LazyTreeNode, depth: number = 0) => {
    const isCurrent = currentPath === node.path;

    return (
      <div key={node.path} className="select-none">
        <div
          className={`flex items-center space-x-1.5 py-1 px-2 rounded-md text-[12px] cursor-pointer transition-colors group ${
            isCurrent
              ? "bg-[#007AFF]/15 text-[#007AFF] font-medium"
              : "text-[var(--text-secondary)] hover:bg-[var(--hover-item)] hover:text-[var(--text-primary)]"
          }`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => handleToggleFolderNode(node)}
        >
          {/* Lazy Expand Chevron */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleFolderNode(node);
            }}
            className="w-3.5 h-3.5 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded"
          >
            {node.isLoading ? (
              <RotateCw className="w-2.5 h-2.5 animate-spin text-[#007AFF]" />
            ) : node.isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>

          {node.isExpanded ? (
            <FolderOpen className="w-3.5 h-3.5 text-[#F2B93B] fill-[#F2B93B]/20 flex-shrink-0" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-[#F2B93B] flex-shrink-0" />
          )}

          <span className="truncate flex-1 tracking-tight">{node.name}</span>
        </div>

        {/* Lazy Children: Render only when expanded */}
        {node.isExpanded && node.children && (
          <div>
            {node.children.length === 0 ? (
              <div
                className="text-[10px] text-[var(--text-tertiary)] py-0.5"
                style={{ paddingLeft: `${24 + depth * 14}px` }}
              >
                (空文件夹)
              </div>
            ) : (
              node.children.map((child) => renderLazyTreeNode(child, depth + 1))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="w-full h-full flex-1 flex flex-col bg-[var(--bg-app)] select-none overflow-hidden relative z-20 min-h-0"
    >
      {/* 1. Header Toolbar (Navigation, Breadcrumbs, Search, Toggles) */}
      <div className="h-9 px-2.5 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between space-x-2 text-[12px] flex-shrink-0">
        {/* Left Navigation Buttons */}
        <div className="flex items-center space-x-1 flex-shrink-0">
          <button
            onClick={handleGoBack}
            disabled={historyIdx <= 0}
            className="p-1 rounded hover:bg-[var(--hover-item)] disabled:opacity-30 disabled:hover:bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title={t("files.goBack")}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleGoForward}
            disabled={historyIdx >= history.length - 1}
            className="p-1 rounded hover:bg-[var(--hover-item)] disabled:opacity-30 disabled:hover:bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title={t("files.goForward")}
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleGoUp}
            disabled={!parentPath || parentPath === currentPath}
            className="p-1 rounded hover:bg-[var(--hover-item)] disabled:opacity-30 disabled:hover:bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title={t("files.goUp")}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title={t("common.refresh")}
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#007AFF]" : ""}`} />
          </button>
          <button
            onClick={handleGoHome}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title={t("files.goHome")}
          >
            <Home className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleSyncTerminalCwd}
            disabled={isSyncingCwd}
            className="px-1.5 py-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors flex items-center space-x-1 disabled:opacity-50"
            title={t("files.followTerminalTip")}
          >
            <Terminal className={`w-3.5 h-3.5 text-[#007AFF] ${isSyncingCwd ? "animate-pulse" : ""}`} />
            <span className="text-[11px] font-medium hidden sm:inline">{t("files.followTerminal")}</span>
          </button>
        </div>

        {/* Center: Address Bar (Breadcrumbs or Direct Text Input) */}
        <div className="flex-1 max-w-2xl mx-2 flex items-center">
          {isEditingPath ? (
            <form onSubmit={handlePathSubmit} className="w-full">
              <input
                type="text"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                onBlur={() => setIsEditingPath(false)}
                autoFocus
                className="w-full h-6 px-2 text-[12px] font-mono bg-[var(--bg-app)] border border-[#007AFF] rounded focus:outline-none text-[var(--text-primary)]"
                placeholder={t("files.inputPathPlaceholder")}
              />
            </form>
          ) : (
            <div
              onClick={() => {
                setInputPath(currentPath);
                setIsEditingPath(true);
              }}
              className="w-full h-6 px-2 bg-[var(--bg-app)] hover:border-[var(--border-strong)] border border-[var(--border-subtle)] rounded flex items-center space-x-1 cursor-text overflow-hidden text-[11.5px]"
              title="点击可直接编辑路径"
            >
              <HardDrive className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
              <div className="flex items-center space-x-0.5 overflow-x-auto no-scrollbar font-mono text-[var(--text-secondary)]">
                {breadcrumbs.map((crumb, idx) => (
                  <div key={crumb.path} className="flex items-center space-x-0.5 flex-shrink-0">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        loadDirectory(crumb.path);
                      }}
                      className="px-1 py-0.2 hover:bg-[var(--hover-item)] hover:text-[var(--text-primary)] rounded cursor-pointer"
                    >
                      {crumb.label}
                    </span>
                    {idx < breadcrumbs.length - 1 && (
                      <span className="text-[var(--text-tertiary)] text-[10px]">/</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Tools: Filter Search, Hidden Toggle, Tree Toggle, Maximize, Close */}
        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {/* Quick Search */}
          <div className="relative flex items-center">
            <Search className="w-3 h-3 text-[var(--text-tertiary)] absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("files.filter")}
              className="h-6 w-28 focus:w-44 transition-all pl-6 pr-5 text-[11px] bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded focus:outline-none focus:border-[#007AFF]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                title="清除筛选内容"
                className="absolute right-1.5 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>

          {/* Transfer Manager Button */}
          <button
            onClick={() => {
              transferManager.setIsOpen(true);
              transferManager.setIsCollapsed(false);
            }}
            className={`p-1 rounded transition-colors ${
              transferManager.activeCount > 0
                ? "bg-[#007AFF]/20 text-[#007AFF] animate-pulse"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)]"
            }`}
            title="查看全局文件传输管理与进度"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>

          {/* Toggle Hidden Files */}
          <button
            onClick={() => setShowHidden(!showHidden)}
            className={`p-1 rounded transition-colors ${
              showHidden
                ? "bg-[#007AFF]/15 text-[#007AFF]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)]"
            }`}
            title={showHidden ? t("files.hideHidden") : t("files.showHidden")}
          >
            {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>

          {/* Toggle Tree Pane */}
          <button
            onClick={() => setShowTreePane(!showTreePane)}
            className={`p-1 rounded transition-colors ${
              showTreePane
                ? "bg-[var(--hover-item)] text-[var(--text-primary)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)]"
            }`}
            title={t("files.toggleTree")}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          {/* Maximize / Restore */}
          {!hideHeaderControls && onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title={isMaximized ? t("common.restore") : t("common.maximize")}
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Close Explorer */}
          {!hideHeaderControls && onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title={t("files.close")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Main Dual-Pane Body */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Tree Pane (Pure Lazy Loading with Horizontal Resizing) */}
        {showTreePane && (
          <>
            <div
              style={{ width: `${treeWidth}px` }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu(null);
                setBlankContextMenu({ x: e.clientX, y: e.clientY });
              }}
              className="flex-shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] flex flex-col overflow-hidden select-none"
            >
              <div className="p-2 text-[10.5px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider flex items-center justify-between">
                <span>{t("files.tree.outermost")}</span>
                <button
                  onClick={() => initLazyRoot(true)}
                  className="hover:text-[var(--text-primary)]"
                  title={t("files.tree.reload")}
                >
                  <RotateCw className={`w-2.5 h-2.5 ${isTreeLoading ? "animate-spin text-[#007AFF]" : ""}`} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-1 pb-4">
                {isTreeLoading ? (
                  <div className="py-8 px-2 flex flex-col items-center justify-center text-center space-y-2 text-[var(--text-tertiary)]">
                    <RotateCw className="w-4 h-4 animate-spin text-[#007AFF]" />
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      {t("files.tree.loading")}
                    </span>
                  </div>
                ) : rootNodes.length === 0 ? (
                  <div className="py-6 px-3 text-center space-y-2">
                    <div className="text-[11px] text-[var(--text-tertiary)]">{t("files.tree.empty")}</div>
                    <button
                      onClick={() => initLazyRoot(true)}
                      className="px-2.5 py-1 text-[11px] rounded bg-[var(--hover-item)] hover:bg-[#007AFF] hover:text-white transition active:scale-95 text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                    >
                      {t("files.tree.reload")}
                    </button>
                  </div>
                ) : (
                  rootNodes.map((node) => renderLazyTreeNode(node))
                )}
              </div>
            </div>
            {/* Tree Sidebar Horizontal Resizer Handle */}
            <div
              onMouseDown={handleStartTreeResize}
              className="w-1 cursor-col-resize hover:bg-[#007AFF]/60 active:bg-[#007AFF] transition-colors flex-shrink-0 select-none relative z-10"
              title="左右拖拽调整目录树宽度"
            />
          </>
        )}

        {/* Right Details Explorer Table (Supports Drag-and-Drop File Upload) */}
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu(null);
            setBlankContextMenu({ x: e.clientX, y: e.clientY });
          }}
          className="flex-1 flex flex-col bg-[var(--bg-app)] overflow-hidden relative"
        >
          {/* Drag & Drop File Upload Overlay */}
          {isDragOver && (
            <div className="absolute inset-0 z-40 bg-[#007AFF]/12 backdrop-blur-[2px] border-2 border-dashed border-[#007AFF] rounded-lg m-1.5 flex flex-col items-center justify-center space-y-2 pointer-events-none animate-in fade-in duration-100 select-none">
              <div className="w-12 h-12 rounded-2xl bg-[#007AFF] text-white flex items-center justify-center shadow-lg animate-bounce">
                <Upload className="w-6 h-6" />
              </div>
              <div className="text-[13.5px] font-semibold text-[#007AFF]">
                松开鼠标立即上传文件至此目录
              </div>
              <div className="text-[11px] font-mono text-[var(--text-secondary)] px-3 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-xs">
                目标路径: {currentPath}
              </div>
            </div>
          )}
          {errorMsg ? (
            <div className="flex-1 flex flex-col items-center justify-center py-16 px-6 text-center select-none">
              <FolderOpen className="w-10 h-10 text-[var(--text-tertiary)] opacity-35 mb-3 stroke-1" />
              <div className="text-[13px] font-medium text-[var(--text-secondary)]">{t("files.emptyTitle")}</div>
              <div className="text-[11.5px] text-[var(--text-tertiary)] mt-1 max-w-xs leading-relaxed">
                {t("files.emptySubtitle")}
              </div>
              <div className="flex items-center space-x-2 mt-4">
                {parentPath && parentPath !== currentPath && (
                  <button
                    onClick={() => {
                      setErrorMsg(null);
                      loadDirectory(parentPath);
                    }}
                    className="px-3 py-1 bg-[var(--hover-item)] hover:bg-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded text-[11.5px] transition-colors"
                  >
                    {t("files.goUp")}
                  </button>
                )}
                <button
                  onClick={() => {
                    setErrorMsg(null);
                    loadDirectory("/");
                  }}
                  className="px-3 py-1 bg-[#007AFF] text-white hover:bg-[#0062CC] rounded text-[11.5px] transition-colors"
                >
                  {t("files.goRoot")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Table Header: Supports Resizable Column Widths & Drag-and-Drop Reordering */}
              <div ref={columnHeaderRef} className="h-7 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center text-[11px] text-[var(--text-tertiary)] font-medium select-none flex-shrink-0 overflow-x-auto no-scrollbar">
                {columns.map((col) => {
                  const isDragOver = columnReorder.dropTarget?.id === col.id;
                  const isDragging = columnReorder.draggedId === col.id;

                  return (
                    <div
                      key={col.id}
                      draggable={false}
                      data-reorder-id={col.id}
                      onPointerDown={(e) => columnReorder.onPointerDown(e, col.id)}
                      style={{ width: `${col.width}px`, touchAction: "none" }}
                      className={`relative h-full flex items-center px-2 cursor-grab active:cursor-grabbing hover:bg-[var(--hover-item)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0 group/col select-none ${
                        col.align === "right" ? "justify-end text-right" : "justify-start text-left"
                      } ${
                        isDragOver
                          ? columnReorder.dropTarget?.position === "left"
                            ? "border-l-2 border-[#007AFF] bg-[#007AFF]/10"
                            : "border-r-2 border-[#007AFF] bg-[#007AFF]/10"
                          : ""
                      } ${isDragging ? "opacity-35" : ""}`}
                      title={`${col.tooltip} (可左右拖拽调整顺序)`}
                      onClick={() => {
                        if (columnReorder.suppressClick()) return;
                        if (col.sortable) handleSort(col.id as SortField);
                      }}
                    >
                      <span className="truncate select-none font-medium pointer-events-none">{getColumnLabel(col.id)}</span>
                      {col.sortable && sortField === col.id && (
                        <span className="ml-1 text-[10px] text-[#007AFF] font-bold flex-shrink-0 pointer-events-none">
                          {sortDirection === "asc" ? "↑" : "↓"}
                        </span>
                      )}

                      {/* Resizer Handle on right border */}
                      <div
                        draggable={false}
                        data-reorder-ignore
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleStartColResize(col.id, e);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize hover:bg-[#007AFF]/60 active:bg-[#007AFF] flex items-center justify-center opacity-0 group-hover/col:opacity-100 transition-opacity z-10"
                        title="左右拖拽调整此列宽度"
                      >
                        <div className="w-[1px] h-3 bg-[var(--border-strong)]" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Table Rows */}
              <div className="flex-1 overflow-y-auto overflow-x-auto">
                {loading && filteredEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)] text-[12px]">
                    <RotateCw className="w-6 h-6 animate-spin text-[#007AFF] mb-2" />
                    <span>{t("common.loading")}</span>
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)] text-[12px]">
                    <Folder className="w-8 h-8 opacity-40 mb-2 stroke-1" />
                    <span>{searchQuery ? t("files.noMatch") : t("files.folderEmpty")}</span>
                  </div>
                ) : (
                  filteredEntries.map((entry) => {
                    const isSelected = selectedEntry?.path === entry.path;

                    return (
                      <div
                        key={entry.path}
                        onClick={() => setSelectedEntry(entry)}
                        onDoubleClick={() => handleItemDoubleClick(entry)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedEntry(entry);
                          setBlankContextMenu(null);
                          setContextMenu({ x: e.clientX, y: e.clientY, entry });
                        }}
                        className={`h-7 flex items-center text-[12px] border-b border-[var(--border-subtle)]/40 cursor-default group transition-colors min-w-max ${
                          isSelected
                            ? "bg-[#007AFF]/15 text-[#007AFF] font-medium"
                            : "hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {columns.map((col) => (
                          <div
                            key={col.id}
                            style={{ width: `${col.width}px` }}
                            className={`h-full flex items-center px-2 overflow-hidden flex-shrink-0 ${
                              col.align === "right" ? "justify-end text-right" : "justify-start text-left"
                            }`}
                          >
                            {renderCellContent(col, entry)}
                          </div>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Explorer Bottom Status Bar */}
      <div className="h-[34px] min-h-[34px] flex-shrink-0 bg-[var(--bg-card)] border-t border-[var(--border-subtle)] px-3 py-1 flex items-center justify-between text-[11px] text-[var(--text-secondary)] select-none relative z-10">
        <div className="flex items-center space-x-3 truncate">
          <span>
            {t("files.itemsCount", { total: totalCount, dirs: totalDirs, files: totalFiles })}
          </span>

          {/* Current Active User Badge with subtle color distinction */}
          <div className="flex items-center space-x-1.5 pl-2 border-l border-[var(--border-subtle)]">
            <span className="text-[var(--text-tertiary)]">{t("status.user")}</span>
            <span
              title={
                detectedUser === "root"
                  ? "当前终端身份: root (超级管理员特权)"
                  : `当前终端身份: ${detectedUser} (普通权限用户)`
              }
              className={`px-2 py-0.5 rounded text-[10.5px] font-mono font-medium border flex items-center space-x-1.5 cursor-default ${
                detectedUser === "root"
                  ? "bg-rose-500/15 text-rose-500 border-rose-500/30"
                  : "bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/30"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  detectedUser === "root" ? "bg-rose-500" : "bg-[#007AFF]"
                }`}
              />
              <span>{detectedUser}</span>
            </span>
          </div>

          {selectedEntry && (
            <span className="flex items-center space-x-1.5 text-[var(--text-secondary)] font-mono pl-2 border-l border-[var(--border-subtle)]">
              <span className="text-[#007AFF] font-medium">{selectedEntry.name}</span>
              <span>·</span>
              <span>{selectedEntry.size_formatted}</span>
              <span>·</span>
              <span>{selectedEntry.permissions}</span>
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {selectedEntry?.is_dir && (
            <button
              onClick={() => onSendToTerminal(`cd "${selectedEntry.path}"\n`)}
              className="px-2.5 py-0.5 rounded bg-[var(--hover-item)] hover:bg-[#007AFF]/15 hover:text-[#007AFF] text-[11px] font-medium flex items-center space-x-1 transition-colors border border-[var(--border-subtle)]"
              title="在活跃终端自动输入 cd 并跳转至此路径"
            >
              <Terminal className="w-3 h-3 text-[#007AFF]" />
              <span>{t("files.cdInTerminal")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Context Menu Popover (Portaled to document.body at top z-index) */}
      {contextMenu &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: `${Math.max(10, Math.min(contextMenu.x, window.innerWidth - 210))}px`,
              top: `${Math.max(10, Math.min(contextMenu.y, window.innerHeight - 280))}px`,
              zIndex: 9999,
            }}
            className="w-48 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg shadow-xl py-1 text-[12px] apple-vibrancy-popover animate-in fade-in zoom-in-95 duration-100 select-none"
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.entry.is_dir ? (
              <>
                <button
                  onClick={() => {
                    loadDirectory(contextMenu.entry.path);
                    setContextMenu(null);
                  }}
                  title="打开并载入此文件夹"
                  className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>进入目录</span>
                </button>
                <button
                  onClick={() => {
                    onSendToTerminal(`cd "${contextMenu.entry.path}"\n`);
                    setContextMenu(null);
                  }}
                  title="在终端 Shell 中执行 cd 进入此路径"
                  className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>在终端 cd 此路径</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  openFilePreview(contextMenu.entry);
                  setContextMenu(null);
                }}
                title="在弹窗中查看只读 UTF-8 文本内容"
                className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
              >
                <Eye className="w-3.5 h-3.5 text-[#007AFF]" />
                <span>查看文本预览</span>
              </button>
            )}

            {!contextMenu.entry.is_dir && (
              <>
                <button
                  onClick={() => {
                    handleDownload(contextMenu.entry);
                    setContextMenu(null);
                  }}
                  title="快速下载此文件至本地 Downloads 目录"
                  className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-500" />
                  <span>下载文件</span>
                </button>
                <button
                  onClick={() => {
                    handleDownloadSaveAs(contextMenu.entry);
                    setContextMenu(null);
                  }}
                  title="选择本地保存目录并下载"
                  className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
                >
                  <Download className="w-3.5 h-3.5 opacity-70" />
                  <span>另存为...</span>
                </button>
              </>
            )}

            <button
              onClick={() => {
                setRenamingEntry(contextMenu.entry);
                setNewName(contextMenu.entry.name);
                setContextMenu(null);
              }}
              title="重命名此文件或文件夹"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-[#007AFF]" />
              <span>重命名</span>
            </button>

            <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

            {/* Archive & Extraction options */}
            {isArchiveFile(contextMenu.entry.name) && (
              <button
                onClick={() => {
                  const entry = contextMenu.entry;
                  setContextMenu(null);
                  handleExtractArchive(entry);
                }}
                disabled={extractLoading}
                title="解压该压缩包内容到当前目录"
                className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
              >
                <FileArchive className={`w-3.5 h-3.5 text-amber-500 ${extractLoading ? "animate-spin" : ""}`} />
                <span>{extractLoading ? "正在解压..." : "解压到当前目录"}</span>
              </button>
            )}

            <button
              onClick={() => {
                const entry = contextMenu.entry;
                setContextMenu(null);
                openArchiveModal(entry, "tar.gz");
              }}
              title="打包压缩为 .tar.gz"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <FileArchive className="w-3.5 h-3.5 text-sky-500" />
              <span>压缩为 .tar.gz</span>
            </button>

            <button
              onClick={() => {
                const entry = contextMenu.entry;
                setContextMenu(null);
                openArchiveModal(entry, "zip");
              }}
              title="打包压缩为 .zip"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <FileArchive className="w-3.5 h-3.5 text-blue-500" />
              <span>压缩为 .zip</span>
            </button>

            <button
              onClick={() => {
                const entry = contextMenu.entry;
                setContextMenu(null);
                openChmodModal(entry);
              }}
              title="查看与修改文件属性与权限 (chmod / chown)"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>属性与权限 (chmod)...</span>
            </button>

            <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

            <button
              onClick={() => {
                navigator.clipboard.writeText(contextMenu.entry.path);
                setContextMenu(null);
              }}
              title="复制此项完整绝对路径到剪贴板"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>复制完整路径</span>
            </button>

            <button
              onClick={() => {
                navigator.clipboard.writeText(contextMenu.entry.name);
                setContextMenu(null);
              }}
              title="仅复制文件名到剪贴板"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>复制文件名</span>
            </button>

            <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

            <button
              onClick={() => {
                const entry = contextMenu.entry;
                setContextMenu(null);
                handleRequestDelete(entry);
              }}
              title="删除此项 (可选择是否移入程序回收站)"
              className="w-full px-3 py-1.5 text-left hover:bg-rose-500 hover:text-white flex items-center space-x-2 text-rose-500 transition-colors group"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-500 group-hover:text-white" />
              <span>删除</span>
            </button>
          </div>,
          document.body
        )}

      {/* Blank Area Context Menu */}
      {blankContextMenu &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: `${Math.min(blankContextMenu.x, window.innerWidth - 200)}px`,
              top: `${Math.min(blankContextMenu.y, window.innerHeight - 250)}px`,
              zIndex: 9999,
            }}
            className="w-48 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg shadow-xl py-1 text-[12px] apple-vibrancy-popover animate-in fade-in zoom-in-95 duration-100 select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setBlankContextMenu(null);
                setCreateItemName("untitled.txt");
                setCreateModal({ type: "file" });
              }}
              title="在此目录下创建新文本文件"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <FilePlus className="w-3.5 h-3.5 text-[#007AFF]" />
              <span>新建文件</span>
            </button>

            <button
              onClick={() => {
                setBlankContextMenu(null);
                setCreateItemName("new_folder");
                setCreateModal({ type: "folder" });
              }}
              title="在此目录下创建新文件夹"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#F2B93B]" />
              <span>新建文件夹</span>
            </button>

            <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

            <button
              onClick={() => {
                setBlankContextMenu(null);
                handleUploadClick();
              }}
              title="选择本地文件上传到此目录"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-500" />
              <span>上传文件...</span>
            </button>

            <button
              onClick={() => {
                setBlankContextMenu(null);
                onSendToTerminal(`cd "${currentPath}"\n`);
              }}
              title="在终端 Shell 中执行 cd 进入此当前路径"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>在终端打开此路径</span>
            </button>

            <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

            <button
              onClick={() => {
                setBlankContextMenu(null);
                handleRefresh();
              }}
              title="重新加载刷新当前目录"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>刷新目录</span>
            </button>

            <button
              onClick={() => {
                setBlankContextMenu(null);
                navigator.clipboard.writeText(currentPath);
              }}
              title="复制当前目录完整绝对路径到剪贴板"
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)] transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>复制当前路径</span>
            </button>
          </div>,
          document.body
        )}

      {/* Create File / Folder Modal */}
      {createModal &&
        createPortal(
          <div
            style={{ zIndex: 10000 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-100"
            onClick={() => setCreateModal(null)}
          >
            <div
              className="w-96 apple-card rounded-xl p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] select-none animate-in zoom-in-95 duration-120"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#007AFF]/15 text-[#007AFF] flex items-center justify-center flex-shrink-0">
                  {createModal.type === "file" ? (
                    <FilePlus className="w-4 h-4" />
                  ) : (
                    <FolderPlus className="w-4 h-4 text-[#F2B93B]" />
                  )}
                </div>
                <div>
                  <div className="text-[13.5px] font-semibold tracking-tight">
                    {createModal.type === "file" ? "新建文件" : "新建文件夹"}
                  </div>
                  <div className="text-[11px] text-[var(--text-tertiary)] truncate max-w-[280px]">
                    所在目录: {currentPath}
                  </div>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleConfirmCreate();
                }}
                className="mt-4 space-y-3"
              >
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    {createModal.type === "file" ? "文件名称" : "文件夹名称"}
                  </label>
                  <input
                    ref={createInputRef}
                    type="text"
                    value={createItemName}
                    onChange={(e) => setCreateItemName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setCreateModal(null);
                    }}
                    disabled={createItemLoading}
                    placeholder={createModal.type === "file" ? "untitled.txt" : "new_folder"}
                    className="w-full px-3 py-1.5 text-[12.5px] bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-lg outline-none font-mono"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCreateModal(null)}
                    disabled={createItemLoading}
                    className="px-3.5 py-1.5 text-[12px] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-item)] transition"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={createItemLoading || !createItemName.trim()}
                    className="px-4 py-1.5 text-[12px] font-medium text-white bg-[#007AFF] hover:bg-[#0062CC] rounded-lg shadow-sm transition active:scale-95 disabled:opacity-40 flex items-center space-x-1.5"
                  >
                    {createItemLoading && <RotateCw className="w-3 h-3 animate-spin" />}
                    <span>确认创建</span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Rename Modal (Portaled directly to document.body at top z-index) */}
      {renamingEntry &&
        createPortal(
          <div
            style={{ zIndex: 10000 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-100"
            onClick={() => setRenamingEntry(null)}
          >
            <div
              className="w-96 apple-card rounded-xl p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] select-none animate-in zoom-in-95 duration-120"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#007AFF]/15 text-[#007AFF] flex items-center justify-center flex-shrink-0">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[13.5px] font-semibold tracking-tight">
                    {renamingEntry.is_dir ? "重命名文件夹" : "重命名文件"}
                  </div>
                  <div className="text-[11px] text-[var(--text-tertiary)] truncate max-w-[280px]">
                    原名称: {renamingEntry.name}
                  </div>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleConfirmRename();
                }}
                className="mt-4 space-y-3"
              >
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    新名称
                  </label>
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setRenamingEntry(null);
                    }}
                    disabled={renameLoading}
                    className="w-full px-3 py-1.5 text-[12.5px] bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-lg outline-none font-mono"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRenamingEntry(null)}
                    disabled={renameLoading}
                    className="px-3.5 py-1.5 text-[12px] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-item)] transition"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={renameLoading || !newName.trim() || newName.trim() === renamingEntry.name}
                    className="px-4 py-1.5 text-[12px] font-medium text-white bg-[#007AFF] hover:bg-[#0062CC] rounded-lg shadow-sm transition active:scale-95 disabled:opacity-40 flex items-center space-x-1.5"
                  >
                    {renameLoading && <RotateCw className="w-3 h-3 animate-spin" />}
                    <span>确认重命名</span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Enhanced Text & Code Editor Modal with Line Numbers, Snippets & Syntax Format Validation */}
      {previewFile && (
        <TextEditorModal
          entry={previewFile}
          previewResult={previewResult}
          loading={previewLoading}
          error={previewError}
          isOpen={!!previewFile}
          isSaving={isSaving}
          saveSuccess={saveSuccess}
          onSave={handleSaveFile}
          onClose={forceClosePreview}
          onReload={(mode) => openFilePreview(previewFile, mode)}
        />
      )}

      {/* Delete Confirmation Modal (First-time preference prompt or standard confirmation) */}
      {deleteTarget &&
        createPortal(
          <div
            style={{ zIndex: 10000 }}
            className="fixed inset-0 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-100"
            onClick={() => {
              if (!deleteLoading) setDeleteTarget(null);
            }}
          >
            <div
              className="w-[430px] max-w-full apple-card rounded-2xl p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] select-none animate-in zoom-in-95 duration-120"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-start space-x-3">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    modalUseTrash ? "bg-[#007AFF]/15 text-[#007AFF]" : "bg-rose-500/15 text-rose-500"
                  }`}
                >
                  {modalUseTrash ? <ShieldCheck className="w-5 h-5" /> : <Trash2 className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold tracking-tight">
                    {isFirstTimeDelete
                      ? "删除确认与回收站设置"
                      : `确认删除${deleteTarget.is_dir ? "文件夹" : "文件"}？`}
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)] mt-1 break-all leading-relaxed">
                    目标：<span className="font-mono font-medium text-[var(--text-primary)]">{deleteTarget.name}</span>
                    <span className="text-[var(--text-tertiary)] ml-1">
                      ({deleteTarget.is_dir ? "文件夹" : deleteTarget.size_formatted})
                    </span>
                  </div>
                </div>
              </div>

              {/* First Time: Interactive Choice Cards */}
              {isFirstTimeDelete ? (
                <div className="mt-4 space-y-2.5">
                  <div className="text-[11px] text-[var(--text-tertiary)]">
                    首次执行删除操作，请选择删除模式（默认直接删除，可配置先备份至回收站）：
                  </div>

                  {/* Option 1: Direct Permanent Delete (Default) */}
                  <div
                    onClick={() => setModalUseTrash(false)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      !modalUseTrash
                        ? "border-rose-500/60 bg-rose-500/10 shadow-xs"
                        : "border-[var(--border-subtle)] hover:bg-[var(--hover-item)]"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="trashMode"
                        checked={!modalUseTrash}
                        onChange={() => setModalUseTrash(false)}
                        className="accent-rose-500 cursor-pointer"
                      />
                      <span className="font-semibold text-[12px] text-rose-500">直接永久删除（默认）</span>
                    </div>
                    <div className="text-[10.5px] text-[var(--text-tertiary)] mt-1 pl-5 leading-normal">
                      直接从服务器或文件系统永久移除，速度极快，不可撤销。
                    </div>
                  </div>

                  {/* Option 2: Download to local trash first */}
                  <div
                    onClick={() => setModalUseTrash(true)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      modalUseTrash
                        ? "border-[#007AFF]/60 bg-[#007AFF]/10 shadow-xs"
                        : "border-[var(--border-subtle)] hover:bg-[var(--hover-item)]"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="trashMode"
                        checked={modalUseTrash}
                        onChange={() => setModalUseTrash(true)}
                        className="accent-[#007AFF] cursor-pointer"
                      />
                      <span className="font-semibold text-[12px] text-[#007AFF]">先下载备份至本地回收站再删除（安全模式）</span>
                    </div>
                    <div className="text-[10.5px] text-[var(--text-tertiary)] mt-1 pl-5 leading-normal">
                      删除前自动下载一份备份至程序本地回收站 (~/.ultimateshell/trash)，防止手滑误删。
                    </div>
                  </div>

                  {/* Remember choice checkbox */}
                  <label className="flex items-center space-x-2 pt-1 px-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={modalRememberChoice}
                      onChange={(e) => setModalRememberChoice(e.target.checked)}
                      className="accent-[#007AFF] rounded w-3.5 h-3.5"
                    />
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      记住选择并作为默认模式（可在偏好设置中随时修改）
                    </span>
                  </label>
                </div>
              ) : (
                /* Subsequent Deletes: Clean Confirmation with Mode Badge & Quick Toggle */
                <div className="mt-4 space-y-2.5">
                  <div
                    className={`p-2.5 rounded-xl border text-[11px] flex items-center justify-between ${
                      modalUseTrash
                        ? "bg-[#007AFF]/10 border-[#007AFF]/30 text-[#007AFF]"
                        : "bg-amber-500/10 border-amber-500/30 text-amber-500"
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 truncate">
                      {modalUseTrash ? (
                        <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      )}
                      <span>
                        {modalUseTrash
                          ? "回收站保护开启：将先自动下载备份至本地回收站"
                          : "永久删除：将直接从服务器移除，不可撤销"}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setModalUseTrash(!modalUseTrash)}
                      className="text-[10.5px] underline hover:opacity-80 flex-shrink-0 ml-2"
                    >
                      {modalUseTrash ? "临时改为永久删除" : "临时备份至回收站"}
                    </button>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-5">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteLoading}
                  className="px-3.5 py-1.5 text-[12px] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-item)] transition"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deleteLoading}
                  className={`px-4 py-1.5 text-[12px] font-medium text-white rounded-lg shadow-sm transition active:scale-95 disabled:opacity-50 flex items-center space-x-1.5 ${
                    modalUseTrash
                      ? "bg-[#007AFF] hover:bg-[#0062CC]"
                      : "bg-rose-500 hover:bg-rose-600"
                  }`}
                >
                  {deleteLoading && <RotateCw className="w-3 h-3 animate-spin" />}
                  <span>{modalUseTrash ? "备份并删除" : "确认永久删除"}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Archive Modal */}
      {archiveModal &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
            style={{ zIndex: 99999 }}
            onClick={() => {
              if (!archiveLoading) setArchiveModal(null);
            }}
          >
            <div
              className="w-[420px] max-w-full apple-card rounded-2xl p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] select-none animate-in zoom-in-95 duration-120"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start space-x-3">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 text-sky-500 flex items-center justify-center flex-shrink-0">
                  <FileArchive className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold tracking-tight">
                    压缩{archiveModal.entry.is_dir ? "文件夹" : "文件"}
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)] mt-1 truncate">
                    源目标：<span className="font-mono font-medium text-[var(--text-primary)]">{archiveModal.entry.name}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-[11.5px] font-medium text-[var(--text-secondary)] block mb-1">
                    压缩包文件名 ({archiveModal.format === "tar.gz" ? ".tar.gz 格式" : ".zip 格式"})
                  </label>
                  <input
                    type="text"
                    value={archiveModal.archiveName}
                    onChange={(e) =>
                      setArchiveModal({ ...archiveModal, archiveName: e.target.value })
                    }
                    disabled={archiveLoading}
                    placeholder="输入压缩文件名..."
                    className="w-full h-8 px-2.5 text-[12px] font-mono bg-[var(--bg-app)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-lg focus:outline-none text-[var(--text-primary)]"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirmArchive();
                    }}
                  />
                </div>
                <div className="text-[11px] text-[var(--text-tertiary)] leading-normal">
                  压缩文件将直接生成在当前目录「<span className="font-mono">{currentPath}</span>」下。
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-5">
                <button
                  type="button"
                  onClick={() => setArchiveModal(null)}
                  disabled={archiveLoading}
                  className="px-3.5 py-1.5 text-[12px] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-item)] transition"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmArchive}
                  disabled={archiveLoading || !archiveModal.archiveName.trim()}
                  className="px-4 py-1.5 text-[12px] font-medium text-white rounded-lg shadow-sm transition active:scale-95 disabled:opacity-50 flex items-center space-x-1.5 bg-[#007AFF] hover:bg-[#0062CC]"
                >
                  {archiveLoading && <RotateCw className="w-3 h-3 animate-spin" />}
                  <span>{archiveLoading ? "正在打包压缩..." : "开始压缩"}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Chmod / Permissions Modal */}
      {chmodModal &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
            style={{ zIndex: 99999 }}
            onClick={() => {
              if (!chmodLoading) setChmodModal(null);
            }}
          >
            <div
              className="w-[450px] max-w-full apple-card rounded-2xl p-5 shadow-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] select-none animate-in zoom-in-95 duration-120"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start space-x-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center flex-shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold tracking-tight">
                    文件属性与权限设置 (chmod / chown)
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)] mt-1 truncate">
                    目标：<span className="font-mono font-medium text-[var(--text-primary)]">{chmodModal.entry.name}</span>
                    <span className="text-[var(--text-tertiary)] ml-1">
                      ({chmodModal.entry.is_dir ? "文件夹" : "文件"})
                    </span>
                  </div>
                </div>
              </div>

              {/* Basic File/Folder Information */}
              <div className="mt-3 p-3 bg-[var(--bg-app)] rounded-xl border border-[var(--border-subtle)] text-[12px] space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[var(--text-tertiary)] flex-shrink-0">完整路径:</span>
                  <span className="text-[var(--text-primary)] font-mono text-[11px] break-all select-all text-right">
                    {chmodModal.entry.path}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-tertiary)] flex-shrink-0">大小:</span>
                  <div className="flex items-center space-x-2">
                    {chmodModal.entry.is_dir ? (
                      chmodModal.isCalculatingSize ? (
                        <div className="flex items-center space-x-1.5 text-xs text-[var(--text-secondary)]">
                          <RotateCw className="w-3.5 h-3.5 animate-spin text-[#007AFF]" />
                          <span>正在后台统计大小...</span>
                        </div>
                      ) : chmodModal.folderSize ? (
                        <div className="flex items-center space-x-1.5">
                          <span className="font-semibold text-[#007AFF] font-mono">{chmodModal.folderSize}</span>
                          <button
                            type="button"
                            onClick={handleCalculateFolderSize}
                            title="重新统计大小"
                            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
                          >
                            <RotateCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleCalculateFolderSize}
                          className="px-2 py-0.5 text-xs font-medium bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/20 rounded-md transition-colors flex items-center space-x-1 cursor-pointer border border-[#007AFF]/20"
                        >
                          <Calculator className="w-3 h-3" />
                          <span>统计文件夹大小</span>
                        </button>
                      )
                    ) : (
                      <span className="font-mono text-[var(--text-primary)]">
                        {chmodModal.entry.size_formatted || "0 B"}
                      </span>
                    )}
                  </div>
                </div>
                {chmodModal.entry.mtime_formatted && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--text-tertiary)] flex-shrink-0">修改时间:</span>
                    <span className="text-[var(--text-secondary)] font-mono text-[11px]">
                      {chmodModal.entry.mtime_formatted}
                    </span>
                  </div>
                )}
              </div>

              {/* Permission Checkboxes Matrix */}
              <div className="mt-4 p-3 bg-[var(--bg-app)] rounded-xl border border-[var(--border-subtle)]">
                <table className="w-full text-center text-[11.5px]">
                  <thead>
                    <tr className="text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
                      <th className="py-1 text-left font-medium">权限类别</th>
                      <th className="py-1 font-medium">读取 (r)</th>
                      <th className="py-1 font-medium">写入 (w)</th>
                      <th className="py-1 font-medium">执行 (x)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/50">
                    <tr>
                      <td className="py-1.5 text-left font-medium text-[var(--text-primary)]">所有者 (Owner)</td>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={chmodModal.state.ownerR}
                          onChange={() => handleChmodStateToggle("ownerR")}
                          className="accent-[#007AFF] rounded cursor-pointer"
                        />
                      </td>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={chmodModal.state.ownerW}
                          onChange={() => handleChmodStateToggle("ownerW")}
                          className="accent-[#007AFF] rounded cursor-pointer"
                        />
                      </td>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={chmodModal.state.ownerX}
                          onChange={() => handleChmodStateToggle("ownerX")}
                          className="accent-[#007AFF] rounded cursor-pointer"
                        />
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-left font-medium text-[var(--text-primary)]">用户组 (Group)</td>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={chmodModal.state.groupR}
                          onChange={() => handleChmodStateToggle("groupR")}
                          className="accent-[#007AFF] rounded cursor-pointer"
                        />
                      </td>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={chmodModal.state.groupW}
                          onChange={() => handleChmodStateToggle("groupW")}
                          className="accent-[#007AFF] rounded cursor-pointer"
                        />
                      </td>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={chmodModal.state.groupX}
                          onChange={() => handleChmodStateToggle("groupX")}
                          className="accent-[#007AFF] rounded cursor-pointer"
                        />
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-left font-medium text-[var(--text-primary)]">公共其他人 (Others)</td>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={chmodModal.state.otherR}
                          onChange={() => handleChmodStateToggle("otherR")}
                          className="accent-[#007AFF] rounded cursor-pointer"
                        />
                      </td>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={chmodModal.state.otherW}
                          onChange={() => handleChmodStateToggle("otherW")}
                          className="accent-[#007AFF] rounded cursor-pointer"
                        />
                      </td>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={chmodModal.state.otherX}
                          onChange={() => handleChmodStateToggle("otherX")}
                          className="accent-[#007AFF] rounded cursor-pointer"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Octal & Presets */}
              <div className="mt-3 flex items-center justify-between space-x-2">
                <div className="flex items-center space-x-2">
                  <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">八进制权限码:</span>
                  <input
                    type="text"
                    maxLength={4}
                    value={chmodModal.octal}
                    onChange={(e) => handleChmodOctalChange(e.target.value)}
                    className="w-16 h-7 px-2 text-center text-[12px] font-mono font-bold bg-[var(--bg-app)] border border-[#007AFF] rounded focus:outline-none text-[#007AFF]"
                  />
                </div>
                {/* Presets */}
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset("0644")}
                    className="px-1.5 py-0.5 text-[10.5px] rounded border border-[var(--border-subtle)] hover:border-[#007AFF] hover:text-[#007AFF] transition"
                    title="0644 (标准文件只读执行限制)"
                  >
                    0644
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset("0755")}
                    className="px-1.5 py-0.5 text-[10.5px] rounded border border-[var(--border-subtle)] hover:border-[#007AFF] hover:text-[#007AFF] transition"
                    title="0755 (标准目录与可执行程序)"
                  >
                    0755
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset("0777")}
                    className="px-1.5 py-0.5 text-[10.5px] rounded border border-[var(--border-subtle)] hover:border-rose-500 hover:text-rose-500 transition"
                    title="0777 (全员可读写执行)"
                  >
                    0777
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset("0600")}
                    className="px-1.5 py-0.5 text-[10.5px] rounded border border-[var(--border-subtle)] hover:border-amber-500 hover:text-amber-500 transition"
                    title="0600 (私密文件/密钥)"
                  >
                    0600
                  </button>
                </div>
              </div>

              {/* Owner / Group (chown) */}
              <div className="mt-3">
                <label className="text-[11px] text-[var(--text-secondary)] block mb-1">
                  所有者与组 (chown，如 <span className="font-mono">root:root</span> 或 <span className="font-mono">www-data</span>)
                </label>
                <input
                  type="text"
                  value={chmodModal.owner}
                  onChange={(e) => setChmodModal({ ...chmodModal, owner: e.target.value })}
                  placeholder="留空则不修改所有者"
                  className="w-full h-7 px-2 text-[11.5px] font-mono bg-[var(--bg-app)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded focus:outline-none text-[var(--text-primary)]"
                />
              </div>

              {/* Recursive for directory */}
              {chmodModal.entry.is_dir && (
                <label className="flex items-center space-x-2 mt-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={chmodModal.recursive}
                    onChange={(e) => setChmodModal({ ...chmodModal, recursive: e.target.checked })}
                    className="accent-[#007AFF] rounded w-3.5 h-3.5"
                  />
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    递归应用到该目录下的所有子文件和子文件夹 (-R)
                  </span>
                </label>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-4">
                <button
                  type="button"
                  onClick={() => setChmodModal(null)}
                  disabled={chmodLoading}
                  className="px-3.5 py-1.5 text-[12px] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-item)] transition"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmChmod}
                  disabled={chmodLoading}
                  className="px-4 py-1.5 text-[12px] font-medium text-white rounded-lg shadow-sm transition active:scale-95 disabled:opacity-50 flex items-center space-x-1.5 bg-[#007AFF] hover:bg-[#0062CC]"
                >
                  {chmodLoading && <RotateCw className="w-3 h-3 animate-spin" />}
                  <span>{chmodLoading ? "正在应用..." : "保存权限"}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
