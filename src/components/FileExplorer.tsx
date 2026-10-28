import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { usePointerReorder } from "../hooks/usePointerReorder";
import { useI18n } from "../i18n";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DirResult, FileEntry, TabSession } from "../types";
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

export function FileExplorer({
  session,
  height,
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

  // Preview Modal
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);

  // Context Menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);

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

  // Reset to root directory "/" and auto-load outermost directory tree whenever session changes or explorer opens
  useEffect(() => {
    if (isOpen && session.id) {
      setCurrentPath("/");
      setHistory(["/"]);
      setHistoryIdx(0);
      setSelectedEntry(null);
      loadDirectory("/", false);

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
    loadDirectory("/");
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

  // Open file preview modal
  const openFilePreview = async (entry: FileEntry) => {
    setPreviewFile(entry);
    setPreviewLoading(true);
    setPreviewContent("");

    try {
      const content = await invoke<string>("fs_read_preview", {
        sessionId: session.id,
        path: entry.path,
      });
      // Safety guard: if content exceeds 120KB, truncate with notice to prevent browser DOM rendering lockup
      const maxChars = 120 * 1024;
      if (content.length > maxChars) {
        setPreviewContent(
          content.slice(0, maxChars) + "\n\n--- [已截断显示前 120KB 内容，以防界面渲染卡死] ---"
        );
      } else {
        setPreviewContent(content);
      }
    } catch (err: any) {
      setPreviewContent(`[无法读取文件预览: ${typeof err === "string" ? err : err?.message || err}]`);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Listen for Escape key to close file preview modal immediately
  useEffect(() => {
    if (!previewFile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPreviewFile(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewFile]);

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
    const handleClickOutside = () => setContextMenu(null);
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
      style={hideHeaderControls ? undefined : { height: isMaximized ? "100%" : `${height ?? 340}px` }}
      className={`w-full flex flex-col bg-[var(--bg-app)] select-none overflow-hidden relative ${
        hideHeaderControls ? "h-full flex-1" : "border-t border-[var(--border-subtle)] z-20"
      }`}
    >
      {/* 1. Header Toolbar (Navigation, Breadcrumbs, Search, Toggles) */}
      <div className="h-9 px-2.5 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between space-x-2 text-[12px]">
        {/* Left Navigation Buttons */}
        <div className="flex items-center space-x-1 flex-shrink-0">
          <button
            onClick={handleGoBack}
            disabled={historyIdx <= 0}
            className="p-1 rounded hover:bg-[var(--hover-item)] disabled:opacity-30 disabled:hover:bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="后退 (返回上一个浏览历史路径)"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleGoForward}
            disabled={historyIdx >= history.length - 1}
            className="p-1 rounded hover:bg-[var(--hover-item)] disabled:opacity-30 disabled:hover:bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="前进 (进入下一个浏览历史路径)"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleGoUp}
            disabled={!parentPath || parentPath === currentPath}
            className="p-1 rounded hover:bg-[var(--hover-item)] disabled:opacity-30 disabled:hover:bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="上一级目录 (跳转到父目录: ..)"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="刷新当前目录 (重新拉取文件与文件夹列表)"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#007AFF]" : ""}`} />
          </button>
          <button
            onClick={handleGoHome}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="主目录 (跳转至用户 ~ 路径)"
          >
            <Home className="w-3.5 h-3.5" />
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
                placeholder="输入绝对路径并回车..."
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

          {/* Toggle Hidden Files */}
          <button
            onClick={() => setShowHidden(!showHidden)}
            className={`p-1 rounded transition-colors ${
              showHidden
                ? "bg-[#007AFF]/15 text-[#007AFF]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-item)]"
            }`}
            title={showHidden ? "隐藏以点开头的文件 (隐藏 .dotfiles)" : "显示隐藏文件 (查看 .bashrc/.ssh 等隐藏项)"}
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
            title={showTreePane ? "收起左侧目录树 (增大详细列表区域)" : "展开左侧目录树 (查看树状结构)"}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          {/* Maximize / Restore */}
          {!hideHeaderControls && onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title={isMaximized ? "还原视口高度 (恢复半屏分栏)" : "最大化文件树 (全屏浏览文件系统)"}
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Close Explorer */}
          {!hideHeaderControls && onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title="关闭文件管理器 (可在底部状态栏随时再次展开)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Main Dual-Pane Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Tree Pane (Pure Lazy Loading with Horizontal Resizing) */}
        {showTreePane && (
          <>
            <div
              style={{ width: `${treeWidth}px` }}
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

        {/* Right Details Explorer Table */}
        <div className="flex-1 flex flex-col bg-[var(--bg-app)] overflow-hidden">
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
                          setSelectedEntry(entry);
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
      <div className="h-6 bg-[var(--bg-card)] border-t border-[var(--border-subtle)] px-3 flex items-center justify-between text-[11px] text-[var(--text-tertiary)] select-none">
        <div className="flex items-center space-x-3 truncate">
          <span>
            {t("files.itemsCount", { total: totalCount, dirs: totalDirs, files: totalFiles })}
          </span>

          {/* Current Active User Badge with subtle color distinction */}
          <div className="flex items-center space-x-1.5 pl-1.5 border-l border-[var(--border-subtle)]">
            <span className="text-[var(--text-tertiary)]">{t("status.user")}</span>
            <span
              title={
                detectedUser === "root"
                  ? "当前终端身份: root (超级管理员特权)"
                  : `当前终端身份: ${detectedUser} (普通权限用户)`
              }
              className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-medium border flex items-center space-x-1 cursor-default ${
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
            <span className="flex items-center space-x-1.5 text-[var(--text-secondary)] font-mono pl-1.5 border-l border-[var(--border-subtle)]">
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
              className="px-2 py-0.5 rounded bg-[var(--hover-item)] hover:bg-[#007AFF]/15 hover:text-[#007AFF] text-[10.5px] flex items-center space-x-1 transition-colors"
              title="在活跃终端自动输入 cd 并跳转至此路径"
            >
              <Terminal className="w-3 h-3" />
              <span>在终端 cd</span>
            </button>
          )}
        </div>
      </div>

      {/* Context Menu Popover */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: `${Math.min(contextMenu.x, window.innerWidth - 200)}px`,
            top: `${Math.min(contextMenu.y, window.innerHeight - 180)}px`,
          }}
          className="z-50 w-44 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg shadow-xl py-1 text-[12px] apple-vibrancy-popover animate-in fade-in zoom-in-95 duration-100"
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
                className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)]"
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
                className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)]"
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
              className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)]"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>查看文本预览</span>
            </button>
          )}

          <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

          <button
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.entry.path);
              setContextMenu(null);
            }}
            title="复制此项完整绝对路径到剪贴板"
            className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)]"
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
            className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)]"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>复制文件名</span>
          </button>
        </div>
      )}

      {/* File Preview Modal (Portaled directly to document.body at top z-index, click-outside to dismiss) */}
      {previewFile &&
        createPortal(
          <div
            style={{ zIndex: 9999 }}
            className="fixed inset-0 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-100"
            onClick={() => setPreviewFile(null)}
          >
            <div
              className="w-[740px] max-w-full max-h-[85vh] bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-120"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="h-10 px-4 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between select-none">
                <div className="flex items-center space-x-2 truncate">
                  <FileText className="w-4 h-4 text-[#007AFF] flex-shrink-0" />
                  <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                    {previewFile.name}
                  </span>
                  <span className="text-[11px] text-[var(--text-tertiary)] font-mono">
                    ({previewFile.size_formatted})
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(previewContent)}
                    title="一键复制全部文本内容到剪贴板"
                    className="px-2.5 py-1 rounded bg-[var(--hover-item)] hover:bg-[#007AFF]/15 hover:text-[#007AFF] text-[11.5px] flex items-center space-x-1.5 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>复制内容</span>
                  </button>
                  <button
                    onClick={() => setPreviewFile(null)}
                    title="关闭预览弹窗 (Esc)"
                    className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 p-3.5 overflow-y-auto font-mono text-[11.5px] leading-relaxed bg-[var(--bg-terminal)] text-[var(--text-primary)] select-text">
                {previewLoading ? (
                  <div className="flex items-center justify-center py-16 text-[var(--text-tertiary)] space-x-2">
                    <RotateCw className="w-5 h-5 animate-spin text-[#007AFF]" />
                    <span>正在读取文件预览...</span>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-all">{previewContent}</pre>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
