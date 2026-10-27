import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  height: number;
  isOpen: boolean;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
  onSendToTerminal: (cmd: string) => void;
}

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
  onToggleMaximize,
  onClose,
  onSendToTerminal,
}: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState<string>("~");
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
  const [history, setHistory] = useState<string[]>(["~"]);
  const [historyIdx, setHistoryIdx] = useState<number>(0);

  // Sorting
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Selection
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);

  // Left sidebar tree toggle & lazy root
  const [showTreePane, setShowTreePane] = useState<boolean>(true);
  const [rootNodes, setRootNodes] = useState<LazyTreeNode[]>([]);

  // Request counter to discard stale async responses
  const activeReqId = useRef<number>(0);

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

  // 100% Lazy Root Initialization: Only load the outermost root items!
  const initLazyRoot = async () => {
    if (!session.id || !isOpen) return;

    try {
      // Fetch only the outermost items of the home or root path
      const res = await invoke<DirResult>("fs_list_dir", {
        sessionId: session.id,
        path: "/",
        showHidden: false,
      });

      // Construct outermost tree nodes with children: null (pure lazy loading!)
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

      setRootNodes(topFolders);
    } catch (err) {
      console.error("初始化根目录树失败:", err);
      setRootNodes([]);
    }
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

  // Only trigger when opened
  useEffect(() => {
    if (isOpen && session.id) {
      loadDirectory("~", false);
      initLazyRoot();
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
      setPreviewContent(content);
    } catch (err: any) {
      setPreviewContent(`[无法读取文件预览: ${typeof err === "string" ? err : err.message}]`);
    } finally {
      setPreviewLoading(false);
    }
  };

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
      style={{ height: isMaximized ? "100%" : `${height}px` }}
      className="w-full flex flex-col bg-[var(--bg-app)] border-t border-[var(--border-subtle)] select-none overflow-hidden relative z-20"
    >
      {/* 1. Header Toolbar (Navigation, Breadcrumbs, Search, Toggles) */}
      <div className="h-9 px-2.5 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between space-x-2 text-[12px]">
        {/* Left Navigation Buttons */}
        <div className="flex items-center space-x-1 flex-shrink-0">
          <button
            onClick={handleGoBack}
            disabled={historyIdx <= 0}
            className="p-1 rounded hover:bg-[var(--hover-item)] disabled:opacity-30 disabled:hover:bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="后退 (Back)"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleGoForward}
            disabled={historyIdx >= history.length - 1}
            className="p-1 rounded hover:bg-[var(--hover-item)] disabled:opacity-30 disabled:hover:bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="前进 (Forward)"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleGoUp}
            disabled={!parentPath || parentPath === currentPath}
            className="p-1 rounded hover:bg-[var(--hover-item)] disabled:opacity-30 disabled:hover:bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="上一级目录 (Up)"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="刷新当前目录 (Refresh)"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#007AFF]" : ""}`} />
          </button>
          <button
            onClick={handleGoHome}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="主目录 (~)"
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
              placeholder="快速筛选..."
              className="h-6 w-28 focus:w-44 transition-all pl-6 pr-5 text-[11px] bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded focus:outline-none focus:border-[#007AFF]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
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
            title={showHidden ? "隐藏以点开头的文件" : "显示隐藏文件 (.dotfiles)"}
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
            title={showTreePane ? "收起左侧目录树" : "展开左侧目录树"}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          {/* Maximize / Restore */}
          <button
            onClick={onToggleMaximize}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title={isMaximized ? "还原窗口" : "最大化资源管理器"}
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Close Explorer */}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="关闭文件管理器"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Main Dual-Pane Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Tree Pane (Pure Lazy Loading) */}
        {showTreePane && (
          <div className="w-52 flex-shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] flex flex-col overflow-hidden">
            <div className="p-2 text-[10.5px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider flex items-center justify-between">
              <span>目录树 (最外层懒加载)</span>
              <button
                onClick={initLazyRoot}
                className="hover:text-[var(--text-primary)]"
                title="重新载入外层目录"
              >
                <RotateCw className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-1 pb-4">
              {rootNodes.length === 0 ? (
                <div className="p-3 text-[11px] text-[var(--text-tertiary)] text-center">
                  点击刷新载入外层目录
                </div>
              ) : (
                rootNodes.map((node) => renderLazyTreeNode(node))
              )}
            </div>
          </div>
        )}

        {/* Right Details Explorer Table */}
        <div className="flex-1 flex flex-col bg-[var(--bg-app)] overflow-hidden">
          {errorMsg ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mb-2">
                <X className="w-5 h-5" />
              </div>
              <div className="text-[13px] font-medium text-[var(--text-primary)]">无法加载此目录</div>
              <div className="text-[11.5px] text-[var(--text-tertiary)] mt-1 max-w-md">{errorMsg}</div>
              <button
                onClick={() => loadDirectory("~")}
                className="mt-3 px-3 py-1 bg-[#007AFF] text-white rounded text-[11.5px] hover:bg-[#0062CC] transition-colors"
              >
                返回主目录 (~)
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Table Header */}
              <div className="h-7 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center text-[11px] text-[var(--text-tertiary)] font-medium px-3 select-none flex-shrink-0">
                <div
                  onClick={() => handleSort("name")}
                  className="flex-1 flex items-center space-x-1 cursor-pointer hover:text-[var(--text-primary)] truncate"
                >
                  <span>名称</span>
                  {sortField === "name" && (
                    <span>{sortDirection === "asc" ? "↑" : "↓"}</span>
                  )}
                </div>

                <div
                  onClick={() => handleSort("mtime")}
                  className="w-36 flex items-center space-x-1 cursor-pointer hover:text-[var(--text-primary)] truncate pl-2"
                >
                  <span>修改日期</span>
                  {sortField === "mtime" && (
                    <span>{sortDirection === "asc" ? "↑" : "↓"}</span>
                  )}
                </div>

                <div
                  onClick={() => handleSort("file_type")}
                  className="w-28 flex items-center space-x-1 cursor-pointer hover:text-[var(--text-primary)] truncate pl-2"
                >
                  <span>类型</span>
                  {sortField === "file_type" && (
                    <span>{sortDirection === "asc" ? "↑" : "↓"}</span>
                  )}
                </div>

                <div
                  onClick={() => handleSort("size")}
                  className="w-24 text-right flex items-center justify-end space-x-1 cursor-pointer hover:text-[var(--text-primary)] truncate pr-2"
                >
                  <span>大小</span>
                  {sortField === "size" && (
                    <span>{sortDirection === "asc" ? "↑" : "↓"}</span>
                  )}
                </div>

                <div className="w-24 truncate pl-2">权限</div>
                <div className="w-20 truncate pl-2">所有者</div>
              </div>

              {/* Table Rows */}
              <div className="flex-1 overflow-y-auto">
                {loading && filteredEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)] text-[12px]">
                    <RotateCw className="w-6 h-6 animate-spin text-[#007AFF] mb-2" />
                    <span>正在按需加载目录...</span>
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)] text-[12px]">
                    <Folder className="w-8 h-8 opacity-40 mb-2 stroke-1" />
                    <span>{searchQuery ? "未匹配到任何文件" : "此文件夹为空"}</span>
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
                        className={`h-7 px-3 flex items-center text-[12px] border-b border-[var(--border-subtle)]/40 cursor-default group transition-colors ${
                          isSelected
                            ? "bg-[#007AFF]/15 text-[#007AFF] font-medium"
                            : "hover:bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {/* Name Column */}
                        <div className="flex-1 flex items-center space-x-2 truncate pr-2">
                          {renderFileIcon(entry)}
                          <span className="truncate">{entry.name}</span>
                          {entry.is_symlink && (
                            <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                              (链接)
                            </span>
                          )}
                        </div>

                        {/* Date Modified Column */}
                        <div className="w-36 text-[11px] text-[var(--text-tertiary)] truncate pl-2 font-mono">
                          {entry.mtime_formatted}
                        </div>

                        {/* Type Column */}
                        <div className="w-28 text-[11px] text-[var(--text-tertiary)] truncate pl-2">
                          {entry.file_type}
                        </div>

                        {/* Size Column */}
                        <div className="w-24 text-[11px] text-[var(--text-tertiary)] text-right truncate pr-2 font-mono">
                          {entry.size_formatted}
                        </div>

                        {/* Permissions */}
                        <div className="w-24 text-[10.5px] text-[var(--text-tertiary)] truncate pl-2 font-mono">
                          {entry.permissions}
                        </div>

                        {/* Owner */}
                        <div className="w-20 text-[10.5px] text-[var(--text-tertiary)] truncate pl-2 font-mono">
                          {entry.owner}
                        </div>
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
            共 {totalCount} 项 ({totalDirs} 个文件夹, {totalFiles} 个文件)
          </span>
          {selectedEntry && (
            <span className="flex items-center space-x-1.5 text-[var(--text-secondary)] font-mono">
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
              title="在终端中跳转到此目录"
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
            className="w-full px-3 py-1.5 text-left hover:bg-[#007AFF] hover:text-white flex items-center space-x-2 text-[var(--text-primary)]"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>复制文件名</span>
          </button>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-[720px] max-w-full max-h-[85vh] bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="h-10 px-4 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div className="flex items-center space-x-2 truncate">
                <FileText className="w-4 h-4 text-[#007AFF]" />
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
                  className="px-2.5 py-1 rounded bg-[var(--hover-item)] hover:bg-[#007AFF]/15 hover:text-[#007AFF] text-[11.5px] flex items-center space-x-1.5 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>复制内容</span>
                </button>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 p-3 overflow-y-auto font-mono text-[11.5px] leading-relaxed bg-[var(--bg-terminal)] text-[var(--text-primary)] select-text">
              {previewLoading ? (
                <div className="flex items-center justify-center py-12 text-[var(--text-tertiary)]">
                  <RotateCw className="w-5 h-5 animate-spin mr-2" />
                  <span>正在读取文件预览...</span>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-all">{previewContent}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
