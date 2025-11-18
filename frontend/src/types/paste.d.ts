import type { PaginationInfo } from "./api";

export interface Paste {
  id: number;
  slug: string;
  content: string;
  remark?: string;
  hasPassword?: boolean;
  plain_password?: string | null;
  requiresPassword?: boolean;
  views?: number;
  max_views?: number | null;
  expires_at?: string | null;
  is_expired?: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PasteListResponse {
  items: Paste[];
  pagination: PaginationInfo;
}

export interface PasteUpdatePayload {
  content: string;
  remark?: string;
  max_views?: number | null;
  expires_at?: string | null;
  password?: string | null;
  clearPassword?: boolean;
}

