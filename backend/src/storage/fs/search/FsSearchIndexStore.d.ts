/**
 * FsSearchIndexStore.js 的 TypeScript 类型声明
 *
 */

export type FsSearchDirtyOp = "upsert" | "delete";

export type FsSearchIndexEntryInput = {
  mountId: string;
  fsPath: string;
  name: string;
  isDir: boolean;
  size: number;
  modifiedIso?: string;
  modifiedMs?: number;
  mimetype?: string | null;
};

export class FsSearchIndexStore {
  constructor(db: any);

  getIndexStates(mountIds: string[]): Promise<Map<string, any>>;
  getDirtyCounts(mountIds: string[]): Promise<Map<string, number>>;
  getChildDirectoryAggregates(
    mountId: string,
    parentDirFsPath: string,
  ): Promise<Array<{ dir_path: string; total_size: number; latest_modified_ms: number; entry_count: number }>>;

  markIndexing(mountId: string, options?: { jobId?: string | null }): Promise<void>;
  markReady(mountId: string, indexedAtMs: number): Promise<void>;
  markError(mountId: string, errorMessage: string): Promise<void>;
  markNotReady(mountId: string): Promise<void>;

  upsertEntries(items: FsSearchIndexEntryInput[], options?: { indexRunId?: string | null }): Promise<void>;

  cleanupMountByRunId(mountId: string, indexRunId: string): Promise<void>;
  cleanupPrefixByRunId(mountId: string, dirPath: string, indexRunId: string): Promise<void>;

  clearMount(mountId: string): Promise<void>;
  clearDirtyByMount(mountId: string): Promise<void>;
  deleteStateByMount(mountId: string): Promise<void>;
  clearDerivedByMount(mountId: string, options?: { keepState?: boolean }): Promise<void>;

  listDirtyBatch(mountId: string, limit?: number): Promise<any[]>;
  deleteDirtyByKeys(keys: string[]): Promise<void>;

  deleteEntry(mountId: string, fsPath: string): Promise<void>;
  deleteByPathPrefix(mountId: string, dirPath: string): Promise<void>;

  upsertDirty(item: { mountId: string; fsPath: string; op: FsSearchDirtyOp }): Promise<void>;
}
