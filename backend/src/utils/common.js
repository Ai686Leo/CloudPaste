/**
 * 通用工具函数
 */
import { UserType, ApiStatus } from "../constants/index.js";
import { HTTPException } from "hono/http-exception";

/**
 * 生成随机字符串
 * @param {number} length - 字符串长度
 * @returns {string} 随机字符串
 */
export function generateRandomString(length = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  randomValues.forEach((val) => (result += chars[val % chars.length]));
  return result;
}

/**
 * 统一错误响应工具函数
 * @param {number} statusCode - HTTP状态码
 * @param {string} message - 错误消息
 * @returns {object} 标准错误响应对象
 */
export function createErrorResponse(statusCode, message) {
  return {
    code: statusCode,
    message: message,
    success: false,
    data: null,
  };
}

/**
 * 格式化文件大小
 * @param {number} bytes 文件大小（字节）
 * @returns {string} 格式化后的文件大小
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";

  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  return (bytes / Math.pow(1024, i)).toFixed(2) + " " + sizes[i];
}

/**
 * 处理每周数据，确保有7天的数据
 * @param {Array} data - 包含日期和数量的数据
 * @returns {Array} 处理后的数据
 */
export function processWeeklyData(data) {
  const result = new Array(7).fill(0);

  if (!data || data.length === 0) return result;

  // 获取过去7天的日期
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split("T")[0]); // 格式：YYYY-MM-DD
  }

  // 将数据映射到对应日期
  data.forEach((item) => {
    const itemDate = item.date.split("T")[0]; // 处理可能的时间部分
    const index = dates.indexOf(itemDate);
    if (index !== -1) {
      result[index] = item.count;
    }
  });

  return result;
}

/**
 * 生成通用UUID
 * @returns {string} 生成的UUID，符合RFC4122 v4标准
 */
export function generateUUID() {
  return crypto.randomUUID();
}

/**
 * 生成唯一文件ID
 * @returns {string} 生成的文件ID
 */
export function generateFileId() {
  return crypto.randomUUID();
}

/**
 * 生成统一的存储配置ID
 */
export function generateStorageConfigId() {
  return crypto.randomUUID();
}
/**
 * 生成短ID作为文件路径前缀
 * @returns {string} 生成的短ID
 */
export function generateShortId() {
  // 生成6位随机ID
  const charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";

  // 使用 crypto.getRandomValues 获取加密安全的随机值
  const randomValues = new Uint8Array(6);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < 6; i++) {
    result += charset[randomValues[i] % charset.length];
  }

  return result;
}

/**
 * 根据系统设置决定是否使用随机后缀
 * @param {D1Database} db - 数据库实例
 * @returns {Promise<boolean>} 是否使用随机后缀
 */
export async function shouldUseRandomSuffix(db) {
  try {
    // 动态导入避免循环依赖
    const { getSettingMetadata } = await import("../services/systemService.js");

    // 获取文件命名策略设置，默认为覆盖模式
    const setting = await getSettingMetadata(db, "file_naming_strategy");
    const strategy = setting ? setting.value : "overwrite";

    // 返回是否使用随机后缀
    return strategy === "random_suffix";
  } catch (error) {
    console.warn("获取文件命名策略失败，使用默认覆盖模式:", error);
    // 出错时默认使用覆盖模式（不使用随机后缀）
    return false;
  }
}

/**
 * 从文件名中获取文件名和扩展名
 * @param {string} filename - 文件名
 * @returns {Object} 包含文件名和扩展名的对象
 */
export function getFileNameAndExt(filename) {
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex > -1) {
    return {
      name: filename.substring(0, lastDotIndex),
      ext: filename.substring(lastDotIndex),
    };
  }
  return {
    name: filename,
    ext: "",
  };
}

/**
 * 生成安全的文件名（移除非法字符）
 * @param {string} fileName - 原始文件名
 * @returns {string} 安全的文件名
 */
export function getSafeFileName(fileName) {
  // 只过滤真正有害的字符：
  // - 控制字符 (\x00-\x1F, \x7F)
  // - 路径分隔符 (/ \)
  // - Windows保留字符 (< > : " | ? *)
  // 保留所有其他Unicode字符，包括中文标点符号
  return fileName.replace(/[<>:"|?*\\/\x00-\x1F\x7F]/g, "_");
}

/**
 * 验证 slug 格式
 * @param {string} slug - 要验证的 slug
 * @returns {boolean} 是否有效
 */
export function validateSlugFormat(slug) {
  if (!slug) return false;
  const slugRegex = /^[a-zA-Z0-9._-]+$/;
  return slugRegex.test(slug);
}

/**
 * 生成唯一的文件slug
 * @param {D1Database} db - D1数据库实例
 * @param {string} customSlug - 自定义slug
 * @param {boolean} override - 是否覆盖已存在的slug
 * @param {Object} overrideContext - 覆盖操作的上下文信息（当override=true时需要）
 * @returns {Promise<string>} 生成的唯一slug
 */
export async function generateUniqueFileSlug(db, customSlug = null, override = false, overrideContext = null) {
  // 动态导入DbTables以避免循环依赖
  const { DbTables } = await import("../constants/index.js");

  // 如果提供了自定义slug，验证其格式并检查是否已存在
  if (customSlug) {
    // 验证slug格式：只允许字母、数字、横杠、下划线和点号
    if (!validateSlugFormat(customSlug)) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "链接后缀格式无效，只能使用字母、数字、下划线、横杠和点号" });
    }

    // 检查slug是否已存在
    const existingFile = await db.prepare(`SELECT * FROM ${DbTables.FILES} WHERE slug = ?`).bind(customSlug).first();

    // 如果存在并且不覆盖，抛出错误
    if (existingFile && !override) {
      // 冲突：暴露 409，便于前端直接提示
      throw new HTTPException(ApiStatus.CONFLICT, { message: "链接后缀已被占用，请使用其他链接后缀" });
    } else if (existingFile && override) {
      // 处理文件覆盖逻辑
      await handleFileOverride(existingFile, overrideContext);
      console.log(`允许覆盖已存在的链接后缀: ${customSlug}`);
    }

    return customSlug;
  }

  // 生成随机slug (6个字符)
  let attempts = 0;
  const maxAttempts = 10;
  while (attempts < maxAttempts) {
    const randomSlug = generateShortId();

    // 检查是否已存在
    const existingFile = await db.prepare(`SELECT id FROM ${DbTables.FILES} WHERE slug = ?`).bind(randomSlug).first();
    if (!existingFile) {
      return randomSlug;
    }

    attempts++;
  }

  throw new Error("无法生成唯一链接后缀，请稍后再试");
}

async function handleFileOverride(existingFile, overrideContext) {
  if (!overrideContext) {
    throw new Error("覆盖操作需要 overrideContext 信息");
  }

  const { userIdOrInfo, userType, encryptionSecret, repositoryFactory, db } = overrideContext;
  if (!repositoryFactory || !db) {
    throw new Error("覆盖操作缺少 repositoryFactory 或 db 上下文");
  }

  const apiKeyIdentifier = typeof userIdOrInfo === "object" ? userIdOrInfo?.id : userIdOrInfo;
  const currentCreator = userType === UserType.ADMIN ? userIdOrInfo : `apikey:${apiKeyIdentifier}`;

  if (!currentCreator || existingFile.created_by !== currentCreator) {
    throw new Error("无权覆盖该链接后缀");
  }

  const fileRepository = repositoryFactory.getFileRepository();

  if (existingFile.storage_path && existingFile.storage_config_id) {
    try {
      const storageConfigRepository = repositoryFactory.getStorageConfigRepository?.();
      const storageConfig = storageConfigRepository
        ? (storageConfigRepository.findByIdWithSecrets
            ? await storageConfigRepository.findByIdWithSecrets(existingFile.storage_config_id)
            : await storageConfigRepository.findById(existingFile.storage_config_id))
        : null;
      if (storageConfig) {
        const { StorageFactory } = await import("../storage/factory/StorageFactory.js");
        if (!storageConfig.storage_type) throw new Error("存储配置缺少 storage_type");
        const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, encryptionSecret);
        await driver.initialize?.();
        if (typeof driver.deleteObjectByStoragePath === "function") {
          await driver.deleteObjectByStoragePath(existingFile.storage_path, { db });
        } else if (typeof driver.batchRemoveItems === "function") {
          await driver.batchRemoveItems([existingFile.storage_path], { subPath: existingFile.storage_path, db });
        }
      }
    } catch (error) {
      console.warn("删除旧存储对象失败", error);
    }
  }

  try {
    await fileRepository.deleteFilePasswordRecord(existingFile.id);
  } catch (error) {
    console.warn("删除旧密码记录失败", error);
  }

  await fileRepository.deleteFile(existingFile.id);

  if (existingFile.storage_config_id) {
    const { invalidateFsCache } = await import("../cache/invalidation.js");
    await invalidateFsCache({ storageConfigId: existingFile.storage_config_id, reason: "file-override", db });
  }
}

/**
 * 解析查询参数为整数
 * @param {import('hono').Context} c
 * @param {string} key
 * @param {number} defaultValue
 * @returns {number}
 */
export function getQueryInt(c, key, defaultValue = 0) {
  const val = c.req.query(key);
  if (val === undefined || val === null || val === "") return defaultValue;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

/**
 * 解析查询参数为布尔值（支持 true/1/false/0）
 * @param {import('hono').Context} c
 * @param {string} key
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
export function getQueryBool(c, key, defaultValue = false) {
  const val = c.req.query(key);
  if (val === undefined || val === null || val === "") return defaultValue;
  const lowered = String(val).toLowerCase();
  if (lowered === "true" || lowered === "1") return true;
  if (lowered === "false" || lowered === "0") return false;
  return defaultValue;
}

/**
 * 标准化分页解析：优先使用 offset，缺失时按 page 计算
 * @param {import('hono').Context} c
 * @param {{limit?:number,page?:number,offset?:number}} defaults
 * @returns {{limit:number,page:number,offset:number}}
 */
export function getPagination(c, defaults = {}) {
  const limitDefault = defaults.limit ?? 30;
  const pageDefault = defaults.page ?? 1;
  const offsetDefault = defaults.offset ?? 0;

  const limit = getQueryInt(c, "limit", limitDefault);
  const page = getQueryInt(c, "page", pageDefault);
  const hasOffset = c.req.query("offset") !== undefined;
  const offset = hasOffset ? getQueryInt(c, "offset", offsetDefault) : Math.max(0, (page - 1) * limit);
  return { limit, page, offset };
}

/**
 * 处理文件覆盖逻辑的辅助函数
 * @private
 */

