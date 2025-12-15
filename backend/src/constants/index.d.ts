/**
 * TypeScript 类型声明文件
 * 为 constants/index.js 提供类型定义
 */

/**
 * 数据库表名常量
 */
export const DbTables: {
  readonly ADMINS: "admins";
  readonly ADMIN_TOKENS: "admin_tokens";
  readonly PASTES: "pastes";
  readonly API_KEYS: "api_keys";
  readonly STORAGE_CONFIGS: "storage_configs";
  readonly PRINCIPAL_STORAGE_ACL: "principal_storage_acl";
  readonly FILES: "files";
  readonly FILE_PASSWORDS: "file_passwords";
  readonly SYSTEM_SETTINGS: "system_settings";
  readonly PASTE_PASSWORDS: "paste_passwords";
  readonly STORAGE_MOUNTS: "storage_mounts";
  readonly FS_META: "fs_meta";
  readonly TASKS: "tasks";
  readonly SCHEDULED_JOBS: "scheduled_jobs";
  readonly SCHEDULED_JOB_RUNS: "scheduled_job_runs";
  readonly UPLOAD_SESSIONS: "upload_sessions";
};

/**
 * API 响应状态码
 */
export const ApiStatus: {
  readonly SUCCESS: 200;
  readonly CREATED: 201;
  readonly BAD_REQUEST: 400;
  readonly UNAUTHORIZED: 401;
  readonly FORBIDDEN: 403;
  readonly NOT_FOUND: 404;
  readonly CONFLICT: 409;
  readonly INTERNAL_ERROR: 500;
};

/**
 * 权限位标志常量
 */
export const Permissions: {
  readonly TEXT_SHARE: number;
  readonly FILE_SHARE: number;
  readonly FS_READ: number;
  readonly FS_WRITE: number;
  readonly FS_DELETE: number;
  readonly FS_MKDIR: number;
  readonly FS_UPLOAD: number;
};
