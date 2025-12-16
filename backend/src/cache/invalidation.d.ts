export interface InvalidateFsCacheParams {
  mountId?: string | null;
  paths?: string[];
  storageConfigId?: string | null;
  reason?: string;
  bumpMountsVersion?: boolean;
  db?: unknown;
}

export declare const invalidateFsCache: (params: InvalidateFsCacheParams) => void;

export declare const invalidatePreviewCache: (params?: { db?: unknown; reason?: string }) => void;

export declare const invalidateAllCaches: (params?: { reason?: string }) => void;

