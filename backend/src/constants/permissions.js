/**
 * 位标志权限系统常量定义
 * 基于位运算的高性能权限管理系统
 */

/**
 * 权限位标志常量
 * 使用位移操作定义权限，支持高效的位运算检查
 *
 * 约定（基础区 0-7 位）：
 * - *_SHARE：创建/发起分享等“写入新记录”的能力
 * - *_MANAGE：对既有分享的列表/查看/修改/删除能力
 */
export const Permission = {
  // 基础权限 (0-7位)
  TEXT_SHARE: 1 << 0, // 0x0001 - 文本分享创建
  FILE_SHARE: 1 << 1, // 0x0002 - 文件分享创建
  TEXT_MANAGE: 1 << 2, // 0x0004 - 文本分享管理（列表/修改/删除）
  FILE_MANAGE: 1 << 3, // 0x0008 - 文件分享管理（列表/修改/删除）

  // 挂载页权限 (8-15位)
  MOUNT_VIEW: 1 << 8, // 0x0100 - 挂载页查看
  MOUNT_UPLOAD: 1 << 9, // 0x0200 - 上传/创建目录
  MOUNT_COPY: 1 << 10, // 0x0400 - 复制
  MOUNT_RENAME: 1 << 11, // 0x0800 - 重命名
  MOUNT_DELETE: 1 << 12, // 0x1000 - 删除

  // WebDAV权限 (16-23位)
  WEBDAV_READ: 1 << 16, // 0x10000 - WebDAV读取
  WEBDAV_MANAGE: 1 << 17, // 0x20000 - WebDAV管理
};

/**
 * 权限组合常量
 * 预定义的权限组合，便于快速分配
 */
export const PermissionGroup = {
  // 基础权限组合
  BASIC_TEXT: Permission.TEXT_SHARE | Permission.TEXT_MANAGE,
  BASIC_FILE: Permission.FILE_SHARE | Permission.FILE_MANAGE,

  // 挂载页权限组合
  MOUNT_READ_ONLY: Permission.MOUNT_VIEW,
  MOUNT_BASIC: Permission.MOUNT_VIEW | Permission.MOUNT_UPLOAD,
  MOUNT_FULL: Permission.MOUNT_VIEW | Permission.MOUNT_UPLOAD | Permission.MOUNT_COPY | Permission.MOUNT_RENAME | Permission.MOUNT_DELETE,

  // WebDAV权限组合
  WEBDAV_READ_ONLY: Permission.WEBDAV_READ,
  WEBDAV_FULL: Permission.WEBDAV_READ | Permission.WEBDAV_MANAGE,

  // 完整权限组合
  ALL_PERMISSIONS:
    Permission.TEXT_SHARE |
    Permission.FILE_SHARE |
    Permission.TEXT_MANAGE |
    Permission.FILE_MANAGE |
    Permission.MOUNT_VIEW |
    Permission.MOUNT_UPLOAD |
    Permission.MOUNT_COPY |
    Permission.MOUNT_RENAME |
    Permission.MOUNT_DELETE |
    Permission.WEBDAV_READ |
    Permission.WEBDAV_MANAGE,
};

/**
 * 角色预设和权限模板
 * 用于用户创建时的权限模板选择
 */
export const Role = {
  // 访客角色 - 可以设置为免密访问
  GUEST: {
    name: "GUEST",
    displayName: "访客",
    permissions: Permission.MOUNT_VIEW,
    description: "访客用户，可以设置为免密访问，权限可自定义",
  },

  // 普通用户角色 - 基础功能权限模板
  GENERAL: {
    name: "GENERAL",
    displayName: "普通用户",
    // 默认同时具备创建和管理文本/文件分享的能力
    permissions:
      Permission.TEXT_SHARE |
      Permission.TEXT_MANAGE |
      Permission.FILE_SHARE |
      Permission.FILE_MANAGE |
      PermissionGroup.MOUNT_BASIC |
      Permission.WEBDAV_READ,
    description: "可以使用文本分享、文件分享（含管理）、基础挂载页操作和WebDAV读取功能",
  },

  // 管理员角色 - 所有权限
  ADMIN: {
    name: "ADMIN",
    displayName: "管理员",
    permissions: PermissionGroup.ALL_PERMISSIONS,
    description: "拥有所有权限，可以进行任何操作",
  },
};

/**
 * 权限模板
 * 用于前端界面的快速权限设置
 */
export const PermissionTemplate = {
  // 只读模板 - 只能查看
  READ_ONLY: {
    name: "READ_ONLY",
    displayName: "只读权限",
    permissions: Permission.MOUNT_VIEW,
    description: "只能查看挂载页内容，无法进行任何操作",
  },

  // 基础模板 - 常用功能
  BASIC: {
    name: "BASIC",
    displayName: "基础权限",
    permissions:
      Permission.TEXT_SHARE |
      Permission.TEXT_MANAGE |
      Permission.FILE_SHARE |
      Permission.FILE_MANAGE |
      PermissionGroup.MOUNT_BASIC,
    description: "可以使用文本分享、文件分享（含管理）和基础挂载页操作",
  },

  // 完整模板 - 除管理外的所有功能
  FULL: {
    name: "FULL",
    displayName: "完整权限",
    permissions:
      Permission.TEXT_SHARE |
      Permission.TEXT_MANAGE |
      Permission.FILE_SHARE |
      Permission.FILE_MANAGE |
      PermissionGroup.MOUNT_FULL |
      PermissionGroup.WEBDAV_FULL,
    description: "可以使用所有功能，包括文本/文件管理、文件系统管理和WebDAV访问",
  },
};

/**
 * 权限检查工具函数
 */
export class PermissionChecker {
  /**
   * 检查用户是否拥有指定权限
   * @param {number} userPermissions - 用户权限位标志
   * @param {number} requiredPermission - 需要的权限位标志
   * @returns {boolean} 是否拥有权限
   */
  static hasPermission(userPermissions, requiredPermission) {
    return (userPermissions & requiredPermission) === requiredPermission;
  }

  /**
   * 检查用户是否拥有任一权限
   * @param {number} userPermissions - 用户权限位标志
   * @param {number[]} requiredPermissions - 需要的权限位标志数组
   * @returns {boolean} 是否拥有任一权限
   */
  static hasAnyPermission(userPermissions, requiredPermissions) {
    return requiredPermissions.some((permission) => this.hasPermission(userPermissions, permission));
  }

  /**
   * 检查用户是否拥有所有权限
   * @param {number} userPermissions - 用户权限位标志
   * @param {number[]} requiredPermissions - 需要的权限位标志数组
   * @returns {boolean} 是否拥有所有权限
   */
  static hasAllPermissions(userPermissions, requiredPermissions) {
    return requiredPermissions.every((permission) => this.hasPermission(userPermissions, permission));
  }

  /**
   * 添加权限
   * @param {number} currentPermissions - 当前权限位标志
   * @param {number} newPermission - 要添加的权限位标志
   * @returns {number} 新的权限位标志
   */
  static addPermission(currentPermissions, newPermission) {
    return currentPermissions | newPermission;
  }

  /**
   * 移除权限
   * @param {number} currentPermissions - 当前权限位标志
   * @param {number} permissionToRemove - 要移除的权限位标志
   * @returns {number} 新的权限位标志
   */
  static removePermission(currentPermissions, permissionToRemove) {
    return currentPermissions & ~permissionToRemove;
  }

  /**
   * 获取权限描述
   * @param {number} permissions - 权限位标志
   * @returns {string[]} 权限描述数组
   */
  static getPermissionDescriptions(permissions) {
    const descriptions = [];

    if (this.hasPermission(permissions, Permission.TEXT_SHARE)) {
      descriptions.push("文本分享（创建）");
    }
    if (this.hasPermission(permissions, Permission.TEXT_MANAGE)) {
      descriptions.push("文本分享管理");
    }
    if (this.hasPermission(permissions, Permission.FILE_SHARE)) {
      descriptions.push("文件分享（创建）");
    }
    if (this.hasPermission(permissions, Permission.FILE_MANAGE)) {
      descriptions.push("文件分享管理");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_VIEW)) {
      descriptions.push("挂载页查看");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_UPLOAD)) {
      descriptions.push("上传/创建目录");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_COPY)) {
      descriptions.push("复制文件");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_RENAME)) {
      descriptions.push("重命名文件");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_DELETE)) {
      descriptions.push("删除文件");
    }
    if (this.hasPermission(permissions, Permission.WEBDAV_READ)) {
      descriptions.push("WebDAV读取");
    }
    if (this.hasPermission(permissions, Permission.WEBDAV_MANAGE)) {
      descriptions.push("WebDAV管理");
    }

    return descriptions;
  }
}

/**
 * 任务类型到权限的映射配置
 * 用于任务管理界面的细粒度权限控制
 *
 * 添加新任务类型时，在此映射表中添加对应的权限要求
 */
export const TaskPermissionMap = {
  copy: Permission.MOUNT_COPY, // 复制任务需要复制权限
};
