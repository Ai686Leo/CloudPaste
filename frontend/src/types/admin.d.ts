import type { PaginationInfo } from "./api";

export interface AdminStorageConfig {
  id: number;
  name: string;
  driver: string;
  is_default: boolean;
  config: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface MountConfig {
  id: number;
  name: string;
  mount_path: string;
  storage_config_id: number;
  is_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AdminStorageConfigListResponse {
  items: AdminStorageConfig[];
  pagination: PaginationInfo;
}

