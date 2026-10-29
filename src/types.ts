export type ProxyType = "none" | "jump" | "proxy";

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
  proxy_type?: ProxyType;
  jump_host_id?: string;
  proxy_url?: string;
}

export type TunnelType = "local" | "remote" | "dynamic";

export interface TunnelEntry {
  id: string;
  session_id: string;
  tunnel_type: TunnelType;
  local_port: number;
  remote_host: string;
  remote_port: number;
  status: "active" | "stopped" | "error";
  description: string;
  error_msg?: string;
}

export function isDefaultGroup(group?: string | null): boolean {
  if (!group) return true;
  const g = group.trim().toLowerCase();
  return g === "" || g === "默认分组" || g === "default group";
}

export interface TabSession {
  id: string;
  title: string;
  isLocal: boolean;
  hostProfile?: HostProfile;
  connected: boolean;
  isRenamed?: boolean;
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

export interface PreviewResult {
  content: string;
  total_size: number;
  is_truncated: boolean;
  mode: "tail" | "head";
  line_count: number;
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

export interface ProcessEntry {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  stat: string;
  command: string;
}

export interface DiskPartition {
  filesystem: string;
  mount_point: string;
  total: string;
  used: string;
  avail: string;
  use_percent: number;
}

export interface PortEntry {
  proto: string;
  local_ip: string;
  port: number;
  state: string;
  pid: number | null;
  program: string;
  user: string;
}

export interface SystemdService {
  name: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

export interface ServerUser {
  username: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
  is_root: boolean;
  is_login_user: boolean;
  has_password: boolean;
}

export interface TransferTask {
  id: string;
  sessionId: string;
  hostName: string;
  type: "upload" | "download";
  fileName: string;
  srcPath: string;
  destPath: string;
  totalSize: number;
  transferredSize: number;
  speed: number; // bytes per second
  progress: number; // 0 - 100
  status: "pending" | "transferring" | "completed" | "error" | "cancelled";
  errorMsg?: string;
  startTime: number;
  endTime?: number;
}
