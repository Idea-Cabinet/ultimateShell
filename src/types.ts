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
