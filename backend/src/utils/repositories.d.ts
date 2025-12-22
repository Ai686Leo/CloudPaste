/**
 * repositories.js 的 TypeScript 类型声明
 */

export interface MountRepositoryLike {
  /**
   * 获取挂载点列表
   * @param includeDisabled 是否包含禁用的挂载点
   */
  findAll(includeDisabled?: boolean): Promise<any[]>;
}

export interface RepositoryFactoryLike {
  getMountRepository(): MountRepositoryLike;
}

/**
 * 从请求上下文里拿/缓存 RepositoryFactory
 */
export function useRepositories(c: any): RepositoryFactoryLike;

/**
 * 保证拿到 RepositoryFactory：
 * - 传了 repositoryFactory 就直接用
 * - 否则用 db + env 创建一个新的
 */
export function ensureRepositoryFactory(
  db: any,
  repositoryFactory?: RepositoryFactoryLike | null,
  env?: any,
): RepositoryFactoryLike;

/**
 * 可选中间件：确保每次请求都有 RepositoryFactory
 */
export function withRepositories(): (c: any, next: () => Promise<void>) => Promise<void>;

