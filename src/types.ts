export interface HostProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  group?: string;
  description?: string;
  identity_file?: string;
  create_time?: number;
  access_time?: number;
  has_password?: boolean;
}

export interface TabSession {
  id: string;
  title: string;
  isLocal: boolean;
  hostProfile?: HostProfile;
  connected: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  size_formatted: string;
  mtime: number;
  mtime_formatted: string;
  permissions: string;
  owner: string;
  file_type: string;
  ext: string;
}

export interface DirResult {
  current_path: string;
  parent_path?: string;
  entries: FileEntry[];
  total_count: number;
  total_dirs: number;
  total_files: number;
}

export interface SystemPerfStats {
  cpu_usage: number;
  mem_percent: number;
  mem_used_gb: number;
  mem_total_gb: number;
  net_rx_kbs: number;
  net_tx_kbs: number;
  io_read_kbs: number;
  io_write_kbs: number;
  load_1m: number;
}
