/**
 * listDirectoryPaging（类型声明）
 *
 */

export type DirectoryListItem = {
  path?: string;
  name?: string;
  isDirectory?: boolean;
  size?: any;
  modified?: any;
  mimetype?: any;
  [key: string]: any;
};

export type DirectoryListResult<TItem = DirectoryListItem> = {
  items?: TItem[];
  hasMore?: boolean;
  nextCursor?: string | null;
  [key: string]: any;
};

export type ListDirectoryOptions = {
  refresh?: boolean;
  paged?: boolean;
  cursor?: string | null;
  limit?: number | null;
  [key: string]: any;
};

export type FileSystemLike<TItem = DirectoryListItem> = {
  listDirectory: (
    path: string,
    userIdOrInfo: any,
    userType: any,
    options?: ListDirectoryOptions,
  ) => Promise<DirectoryListResult<TItem>>;
};

export type IterateListDirectoryItemsOptions = {
  refresh?: boolean;
  pageLimit?: number | null;
};

export function iterateListDirectoryItems<TItem = DirectoryListItem>(
  fileSystem: FileSystemLike<TItem>,
  dirPath: string,
  userIdOrInfo: any,
  userType: any,
  options?: IterateListDirectoryItemsOptions,
): AsyncGenerator<TItem, void, void>;

