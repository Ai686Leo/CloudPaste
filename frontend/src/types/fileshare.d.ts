import type { PaginationInfo } from "./api";

export interface FileshareItem {
  id: number;
  slug: string;
  filename: string;
  mimetype: string;
  size: number;
  remark?: string;
  views?: number;
  max_views?: number | null;
  expires_at?: string | null;
  is_expired?: boolean;
  requires_password?: boolean;
  passwordVerified?: boolean;
  currentPassword?: string | null;
  use_proxy?: boolean;
  previewUrl?: string | null;
  downloadUrl?: string | null;
  linkType?: "direct" | "proxy" | "url_proxy";
  created_at?: string;
  updated_at?: string;
}

export interface FileshareListResponse {
  files: FileshareItem[];
  pagination: PaginationInfo;
}
