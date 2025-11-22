import type { PaginationInfo } from "./api";

export interface FsDirectoryItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isVirtual?: boolean;
  size?: number;
  modified?: string;
  mimetype?: string;
  download_url?: string;
  preview_url?: string;
}

export interface FsResolvedMeta {
  headerMarkdown?: string | null;
  footerMarkdown?: string | null;
  hidePatterns: string[];
}

export interface FsDirectoryResponse {
  path: string;
  items: FsDirectoryItem[];
  isVirtual?: boolean;
  mount_id?: string | number;
  total?: number;
  pagination?: PaginationInfo;
  meta?: FsResolvedMeta | null;
}
