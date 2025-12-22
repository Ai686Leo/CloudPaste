/**
 * 预览设置缓存工具
 * 文件类型检测缓存机制
 */

import { ensureRepositoryFactory } from "../utils/repositories.js";
import { SETTING_GROUPS } from "../constants/settings.js";

/**
 * 预览设置缓存类
 * 提供O(1)复杂度的文件类型查询性能
 */
export class PreviewSettingsCache {
  constructor() {
    this.cache = new Map();
    this.typeCache = new Map();
    this.providerTypeCache = new Map();
    this.previewProviderRuleCache = [];
    this.lastUpdate = null;
    this.ttl = Infinity;
    this._isLoaded = false;
  }

  /**
   * 获取文件类型（基于扩展名）
   * @param {string} extension - 文件扩展名（不含点）
   * @param {D1Database} db - 数据库实例（可选）
   * @returns {Promise<string>} 文件类型 (text|audio|video|image|office|document|unknown)
   */
  async getFileType(extension, db = null) {
    await this.ensureLoaded(db);
    const key = extension.toLowerCase();
    return this.typeCache.get(key) || this.providerTypeCache.get(key) || "unknown";
  }

  /**
   * 检查缓存是否已加载
   * @returns {boolean}
   */
  isLoaded() {
    return this._isLoaded && this.lastUpdate; // 永不过期，只检查是否已加载
  }

  /**
   * 确保缓存已加载
   * @param {D1Database} db - 数据库实例（可选）
   */
  async ensureLoaded(db = null) {
    if (!this.isLoaded()) {
      await this.refresh(db);
    }
  }

  /**
   * 刷新缓存（从数据库重新加载预览设置）
   * @param {D1Database} db - 数据库实例（可选，用于外部调用）
   */
  async refresh(db = null, repositoryFactory = null) {
    try {
      // 如果没有传入db，尝试从全局获取（在实际使用中需要传入）
      if (!db) {
        console.warn("PreviewSettingsCache.refresh: 没有提供数据库实例，跳过刷新");
        return;
      }

      const factory = ensureRepositoryFactory(db, repositoryFactory);
      const systemRepository = factory.getSystemRepository();

      // 获取预览设置分组的所有设置
      const previewSettings = await systemRepository.getSettingsByGroup(SETTING_GROUPS.PREVIEW, false);

      // 清空现有缓存
      this.cache.clear();
      this.typeCache.clear();
      this.providerTypeCache.clear();

      // 重建缓存
      for (const setting of previewSettings) {
        this.cache.set(setting.key, setting.value);

        // 解析扩展名列表并建立映射
        if (setting.key.endsWith("_types")) {
          const typeCategory = this.extractTypeCategory(setting.key);
          this.parseAndCacheExtensions(typeCategory, setting.value);
        }
      }

      this.rebuildProviderTypeCache();
      this.rebuildPreviewProviderRuleCache();

      this.lastUpdate = Date.now();
      this._isLoaded = true;

      console.log(`预览设置缓存已刷新，共缓存 ${this.typeCache.size} 个扩展名映射`);
    } catch (error) {
      console.error("刷新预览设置缓存失败:", error);
      // 刷新失败时保持旧缓存，避免服务中断
    }
  }

  /**
   * 从设置键名提取类型分类
   * @param {string} settingKey - 设置键名 (如 preview_text_types)
   * @returns {string} 类型分类 (如 text)
   */
  extractTypeCategory(settingKey) {
    const match = settingKey.match(/^preview_(.+)_types$/);
    return match ? match[1] : "unknown";
  }

  /**
   * 解析扩展名字符串并缓存映射关系
   * @param {string} typeCategory - 类型分类 (text|audio|video|image|office|document)
   * @param {string} extensionString - 逗号分隔的扩展名字符串
   */
  parseAndCacheExtensions(typeCategory, extensionString) {
    if (!extensionString || typeof extensionString !== "string") {
      return;
    }

    const extensions = extensionString
      .split(",")
      .map((ext) => ext.trim().toLowerCase())
      .filter((ext) => ext.length > 0 && /^[a-z0-9]+$/.test(ext));

    for (const extension of extensions) {
      this.typeCache.set(extension, typeCategory);
    }

    console.log(`缓存 ${typeCategory} 类型扩展名: ${extensions.join(", ")} (共${extensions.length}个)`);
  }

  /**
   * 解析 preview_providers 规则并建立类型映射（用于 office/document 等分类）
   */
  rebuildProviderTypeCache() {
    const rules = this.getPreviewProvidersConfig();
    if (!Array.isArray(rules)) return;

    for (const rule of rules) {
      const category = this.resolveProviderCategory(rule);
      if (!category) continue;

      const match = rule?.match || {};
      const extList = this.normalizeExtensionList(match.ext || match.exts || match.extensions);
      if (!extList.length) continue;

      for (const ext of extList) {
        this.providerTypeCache.set(ext, category);
      }
    }
  }

  /**
   * 预编译 preview_providers 规则（支持 ext + regex）
   * - 仅用于“类型归类/图标归类”用途，不会生成 providers URL
   * - 排序规则与预览选择保持一致：priority 越大越优先；priority 相同按数组顺序
   */
  rebuildPreviewProviderRuleCache() {
    const rules = this.getPreviewProvidersConfig();
    if (!Array.isArray(rules)) {
      this.previewProviderRuleCache = [];
      return;
    }

    const compiled = rules
      .map((rule, index) => {
        const previewKey = (rule?.previewKey || rule?.key || "").toString().toLowerCase();
        // 对图标/类型来说：iframe / download 不代表“文件本身类型”，不参与归类
        if (previewKey === "iframe" || previewKey === "download") {
          return null;
        }

        const category = this.resolveProviderCategory(rule);
        if (!category) return null;

        const match = rule?.match || {};
        const extList = this.normalizeExtensionList(match.ext || match.exts || match.extensions || rule.ext);
        const regexSource = (match.regex || match.pattern || "").toString().trim();
        const regex = regexSource ? this.toRegex(regexSource) : null;

        return {
          _index: index,
          priority: Number.isFinite(rule?.priority) ? Number(rule.priority) : 0,
          extSet: extList.length ? new Set(extList) : null,
          regex,
          category,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.priority - a.priority || a._index - b._index);

    this.previewProviderRuleCache = compiled;
  }

  /**
   * 将 preview_providers 中的 regex 字符串解析为 RegExp
   * - 支持 /pattern/flags（例如 /^(readme|license)$/i）
   * - 也支持直接写 pattern（不带斜杠/flags）
   * @param {string} value
   * @returns {RegExp|null}
   */
  toRegex(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    if (raw.startsWith("/")) {
      const lastSlash = raw.lastIndexOf("/");
      if (lastSlash > 0) {
        const pattern = raw.slice(1, lastSlash);
        const flags = raw.slice(lastSlash + 1);
        try {
          return new RegExp(pattern, flags);
        } catch (error) {
          console.warn("preview_providers 正则无效，已忽略:", raw, error);
          return null;
        }
      }
    }

    try {
      return new RegExp(raw);
    } catch (error) {
      console.warn("preview_providers 正则无效，已忽略:", raw, error);
      return null;
    }
  }

  /**
   * 根据 preview_providers（ext + regex）推断“类型分类”
   * @param {{ filename: string, extension?: string }} input
   * @returns {string} text|audio|video|image|office|document|unknown
   */
  resolveTypeCategoryByProviders(input) {
    const filename = (input?.filename || "").toString();
    const extension = (input?.extension || "").toString().toLowerCase();

    for (const rule of this.previewProviderRuleCache || []) {
      if (rule.extSet && !rule.extSet.has(extension)) continue;
      if (rule.regex && !rule.regex.test(filename)) continue;
      return rule.category || "unknown";
    }

    return "unknown";
  }

  normalizeExtensionList(value) {
    if (!value) return [];
    const list = Array.isArray(value) ? value : String(value).split(",");
    return list
      .map((ext) => String(ext).trim().toLowerCase())
      .filter((ext) => ext.length > 0 && /^[a-z0-9]+$/.test(ext));
  }


  resolveProviderCategory(rule) {
    const explicit = (rule?.category || rule?.fileType || "").toString().toLowerCase();
    if (explicit) return explicit;

    const previewKey = (rule?.previewKey || rule?.key || "").toString().toLowerCase();
    if (["text", "code", "markdown", "html"].includes(previewKey)) return "text";
    if (["image", "video", "audio"].includes(previewKey)) return previewKey;
    if (previewKey === "office") return "office";
    if (["pdf", "document", "epub"].includes(previewKey)) return "document";
    return "";
  }

  /**
   * 获取原始设置值
   * @param {string} key - 设置键名
   * @returns {string|null} 设置值
   */
  getSetting(key) {
    return this.cache.get(key) || null;
  }

  /**
   * 获取 Preview Providers 配置（JSON 数组）
   * @returns {Array|null}
   */
  getPreviewProvidersConfig() {
    const raw = this.getSetting("preview_providers");
    if (!raw || typeof raw !== "string" || raw.trim().length === 0) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      console.error("解析 preview_providers 配置失败，将视为未配置:", e);
      return [];
    }

    return [];
  }

  /**
   * 获取所有支持的扩展名（按类型分组）
   * @returns {Object} 按类型分组的扩展名对象
   */
  getAllSupportedExtensions() {
    const result = {};
    for (const [extension, type] of this.typeCache.entries()) {
      if (!result[type]) {
        result[type] = [];
      }
      result[type].push(extension);
    }
    return result;
  }

  /**
   * 清除缓存
   */
  clear() {
    this.cache.clear();
    this.typeCache.clear();
    this.lastUpdate = null;
    this._isLoaded = false;
  }

  /**
   * 获取缓存统计信息
   * @returns {Object} 缓存统计
   */
  getStats() {
    return {
      isLoaded: this._isLoaded,
      lastUpdate: this.lastUpdate,
      settingsCount: this.cache.size,
      extensionMappings: this.typeCache.size,
      ttl: "永不过期",
      age: this.lastUpdate ? Date.now() - this.lastUpdate : null,
      cacheStrategy: "永不过期 + 主动刷新",
    };
  }
}

// 创建全局单例实例
const previewSettingsCacheInstance = new PreviewSettingsCache();

// 默认导出单例实例
export default previewSettingsCacheInstance;

// 命名导出
export const previewSettingsCache = previewSettingsCacheInstance;
