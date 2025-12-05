/**
 * 统一的创建者徽章逻辑 composable
 *
 * 用于管理面板中显示创建者信息的统一处理，支持：
 * - 管理员 (admin / UUID 格式的用户ID)
 * - API密钥 (apikey: 前缀 / 有 keyName 的记录)
 * - 系统/未知来源
 *
 * @example
 * // 在组件中使用
 * import { useCreatorBadge } from '@/composables/admin-management/useCreatorBadge.js';
 * const { getCreatorType, getCreatorText, getCreatorBadgeClass } = useCreatorBadge();
 *
 * // 获取创建者类型
 * const type = getCreatorType(userId, keyName);
 *
 * // 获取显示文本
 * const text = getCreatorText(userId, keyName);
 *
 * // 获取徽章样式类
 * const badgeClass = getCreatorBadgeClass(userId, keyName);
 */

/**
 * UUID 正则表达式
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 创建者类型枚举
 */
export const CreatorType = {
  ADMIN: 'admin',
  API_KEY: 'apikey',
  SYSTEM: 'system',
  OTHER: 'other',
};

/**
 * 徽章样式映射 (Tailwind CSS 类)
 */
const BADGE_CLASSES = {
  [CreatorType.ADMIN]: 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100',
  [CreatorType.API_KEY]: 'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100',
  [CreatorType.SYSTEM]: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  [CreatorType.OTHER]: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
};

/**
 * 创建者徽章 composable
 * @param {Object} options - 可选配置
 * @param {Object} options.apiKeyNames - API密钥名称映射表 (可选，用于查找已知密钥)
 * @returns {Object} 创建者徽章相关方法
 */
export function useCreatorBadge(options = {}) {
  const { apiKeyNames = null } = options;

  /**
   * 判断创建者类型
   * @param {string|null} userId - 用户ID或创建者标识
   * @param {string|null} keyName - API密钥名称 (可选，后端可能直接返回)
   * @returns {string} 创建者类型 (admin/apikey/system/other)
   */
  const getCreatorType = (userId, keyName = null) => {
    // 无创建者信息
    if (!userId) {
      return CreatorType.SYSTEM;
    }

    // 优先使用后端返回的 keyName 判断
    if (keyName) {
      return CreatorType.API_KEY;
    }

    // 明确的 admin 标识
    if (userId === 'admin') {
      return CreatorType.ADMIN;
    }

    // 处理带 "apikey:" 前缀的 API 密钥 ID
    if (typeof userId === 'string' && userId.startsWith('apikey:')) {
      return CreatorType.API_KEY;
    }

    // UUID 格式检查
    if (UUID_REGEX.test(userId)) {
      // 如果提供了 apiKeyNames 映射表，检查是否为已知 API 密钥
      if (apiKeyNames && apiKeyNames[userId]) {
        return CreatorType.API_KEY;
      }
      // UUID 格式但不在已知 API 密钥列表中，视为管理员
      return CreatorType.ADMIN;
    }

    // 默认为其他类型
    return CreatorType.OTHER;
  };

  /**
   * 获取创建者显示文本
   * @param {string|null} userId - 用户ID或创建者标识
   * @param {string|null} keyName - API密钥名称 (可选)
   * @returns {string} 用于显示的文本
   */
  const getCreatorText = (userId, keyName = null) => {
    const creatorType = getCreatorType(userId, keyName);

    switch (creatorType) {
      case CreatorType.ADMIN:
        return '管理员';

      case CreatorType.API_KEY:
        // 优先显示 keyName
        if (keyName) {
          return `密钥：${keyName}`;
        }
        // 处理 apikey: 前缀格式
        if (typeof userId === 'string' && userId.startsWith('apikey:')) {
          const keyPart = userId.substring(7);
          return `密钥：${keyPart.substring(0, 5)}...`;
        }
        // UUID 格式的 API 密钥
        if (apiKeyNames && apiKeyNames[userId]) {
          return `密钥：${apiKeyNames[userId]}`;
        }
        return `密钥：${userId.substring(0, 8)}...`;

      case CreatorType.SYSTEM:
        return '未知来源';

      default:
        return userId || '未知';
    }
  };

  /**
   * 获取创建者徽章样式类 (Tailwind CSS)
   * @param {string|null} userId - 用户ID或创建者标识
   * @param {string|null} keyName - API密钥名称 (可选)
   * @returns {string} Tailwind CSS 类名
   */
  const getCreatorBadgeClass = (userId, keyName = null) => {
    const creatorType = getCreatorType(userId, keyName);
    return BADGE_CLASSES[creatorType] || BADGE_CLASSES[CreatorType.OTHER];
  };

  /**
   * 格式化创建者信息 (兼容旧版 formatCreator 函数)
   * @param {Object} item - 包含 created_by 和可选 key_name 的对象
   * @returns {string} 格式化后的创建者文本
   */
  const formatCreator = (item) => {
    if (!item) return '未知';
    return getCreatorText(item.created_by, item.key_name);
  };

  /**
   * 获取创建者徽章完整信息
   * @param {string|null} userId - 用户ID或创建者标识
   * @param {string|null} keyName - API密钥名称 (可选)
   * @returns {Object} 包含 type, text, badgeClass 的对象
   */
  const getCreatorBadgeInfo = (userId, keyName = null) => {
    const type = getCreatorType(userId, keyName);
    return {
      type,
      text: getCreatorText(userId, keyName),
      badgeClass: BADGE_CLASSES[type] || BADGE_CLASSES[CreatorType.OTHER],
    };
  };

  return {
    // 类型枚举
    CreatorType,
    // 核心方法
    getCreatorType,
    getCreatorText,
    getCreatorBadgeClass,
    // 便捷方法
    formatCreator,
    getCreatorBadgeInfo,
  };
}

// 导出静态版本供非组件环境使用
export const creatorBadgeUtils = {
  CreatorType,
  UUID_REGEX,
  BADGE_CLASSES,

  /**
   * 静态方法：判断创建者类型
   */
  getCreatorType(userId, keyName = null) {
    if (!userId) return CreatorType.SYSTEM;
    if (keyName) return CreatorType.API_KEY;
    if (userId === 'admin') return CreatorType.ADMIN;
    if (typeof userId === 'string' && userId.startsWith('apikey:')) return CreatorType.API_KEY;
    if (UUID_REGEX.test(userId)) return CreatorType.ADMIN;
    return CreatorType.OTHER;
  },

  /**
   * 静态方法：获取徽章样式类
   */
  getBadgeClass(userId, keyName = null) {
    const type = this.getCreatorType(userId, keyName);
    return BADGE_CLASSES[type] || BADGE_CLASSES[CreatorType.OTHER];
  },
};
