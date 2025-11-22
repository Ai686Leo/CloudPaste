/**
 * FS 目录 Meta 解析服务
 *
 * 职责：
 * - 从 fs_meta 表按路径链获取原始配置
 * - 按继承规则折叠为最终有效的 meta 结果
 *
 * 注意：
 * - 继承规则遵循设计文档，避免前端重复实现
 */

import { ensureRepositoryFactory } from "../utils/repositories.js";

const normalizePath = (path) => {
  if (!path || path === "/") {
    return "/";
  }
  const trimmed = path.replace(/\/+$/, "") || "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const buildPathChain = (path) => {
  const normalized = normalizePath(path);
  if (normalized === "/") {
    return ["/"];
  }

  const segments = normalized.split("/").filter(Boolean);
  const chain = ["/"];
  let current = "";

  for (const segment of segments) {
    current = `${current}/${segment}`;
    chain.push(current === "" ? "/" : current);
  }

  return Array.from(new Set(chain));
};

export class FsMetaService {
  /**
   * @param {D1Database} db
   * @param {import("../repositories").RepositoryFactory} [repositoryFactory]
   */
  constructor(db, repositoryFactory = null) {
    this.db = db;
    this.repositoryFactory = ensureRepositoryFactory(db, repositoryFactory);
  }

  /**
   * 解析指定路径的聚合 Meta
   * @param {string} path
   * @returns {Promise<{headerMarkdown?: string|null, footerMarkdown?: string|null, hidePatterns: string[], password?: string|null, passwordOwnerPath?: string|null}>}
   */
  async resolveMetaForPath(path) {
    const fsMetaRepository = this.repositoryFactory.getFsMetaRepository();
    const chain = buildPathChain(path);

    const records = await fsMetaRepository.findByPaths(chain);
    if (!records || records.length === 0) {
      return {
        headerMarkdown: null,
        footerMarkdown: null,
        hidePatterns: [],
        password: null,
      };
    }

    // 以路径升序（从根到子目录）折叠
    const recordMap = new Map();
    for (const record of records) {
      if (record?.path) {
        recordMap.set(normalizePath(record.path), record);
      }
    }

    let effectiveHeader = null;
    let effectiveFooter = null;
    let effectivePassword = null;
    let passwordOwnerPath = null;
    /** @type {string[]} */
    let hidePatterns = [];

    for (const currentPath of chain) {
      const meta = recordMap.get(currentPath);
      if (!meta) {
        continue;
      }

      const isSelf = normalizePath(path) === normalizePath(currentPath);

      // header/footer：只要字段非 null，则认为当前节点显式声明，遵循 inherit 规则
      if (typeof meta.header_markdown === "string") {
        if (isSelf || meta.header_inherit) {
          effectiveHeader = meta.header_markdown;
        }
      }

      if (typeof meta.footer_markdown === "string") {
        if (isSelf || meta.footer_inherit) {
          effectiveFooter = meta.footer_markdown;
        }
      }

      // hidePatterns：在继承链上累积（父级 + 子级）
      if (meta.hide_patterns && (isSelf || meta.hide_inherit)) {
        try {
          const parsed = JSON.parse(meta.hide_patterns);
          if (Array.isArray(parsed)) {
            hidePatterns = [...hidePatterns, ...parsed.filter((x) => typeof x === "string")];
          }
        } catch {
          // 忽略解析错误，保持已有配置
        }
      }

      // password：仅在当前节点显式提供非空值时覆盖，并记录密码所属路径
      if (meta.password && (isSelf || meta.password_inherit)) {
        effectivePassword = meta.password;
        passwordOwnerPath = normalizePath(currentPath);
      }
    }

    // 去重 hidePatterns
    const uniquePatterns = [...new Set(hidePatterns.filter(Boolean))];

    return {
      headerMarkdown: effectiveHeader ?? null,
      footerMarkdown: effectiveFooter ?? null,
      hidePatterns: uniquePatterns,
      password: effectivePassword ?? null,
      passwordOwnerPath: effectivePassword ? passwordOwnerPath ?? normalizePath(path) : null,
    };
  }
}
