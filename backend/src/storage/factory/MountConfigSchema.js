/**
 * Mount配置的Schema定义
 * 为前端动态表单渲染提供元数据
 */

/**
 * WebDAV代理策略选项
 */
export const WebDavPolicyOptions = [
  {
    value: "302_redirect",
    labelKey: "admin.mount.form.webdavPolicyOptions.302_redirect",
    // 仅支持 DirectLink 能力的驱动（如 S3）
    requiresCapability: "directLink",
  },
  {
    value: "use_proxy_url",
    labelKey: "admin.mount.form.webdavPolicyOptions.use_proxy_url",
    // 需要存储配置中设置了 url_proxy
    requiresCapability: "urlProxy",
  },
  {
    value: "native_proxy",
    labelKey: "admin.mount.form.webdavPolicyOptions.native_proxy",
    // 所有存储类型都支持
    requiresCapability: null,
  },
];

/**
 * Mount配置Schema
 */
export const MountConfigSchema = {
  fields: [
    // === 基本信息 ===
    {
      name: "name",
      type: "string",
      required: true,
      labelKey: "admin.mount.form.name",
      ui: {
        placeholderKey: "admin.mount.form.namePlaceholder",
        maxLength: 50,
      },
      validation: {
        maxLength: 50,
        pattern: "^[\\u4e00-\\u9fa5a-zA-Z0-9_-]+$",
        patternMessageKey: "admin.mount.validation.namePattern",
      },
    },
    {
      name: "remark",
      type: "textarea",
      required: false,
      labelKey: "admin.mount.form.remark",
      ui: {
        placeholderKey: "admin.mount.form.remarkPlaceholder",
        rows: 2,
      },
    },

    // === 存储关联 ===
    {
      name: "storage_type",
      type: "select",
      required: false,
      labelKey: "admin.mount.form.storageType",
      ui: {
        placeholderKey: "admin.mount.form.selectStorageType",
        descriptionKey: "admin.mount.form.storageTypeHint",
        // 动态选项：从已有存储配置中提取可用类型
        dynamicOptions: "storageTypes",
      },
    },
    {
      name: "storage_config_id",
      type: "select",
      required: true,
      labelKey: "admin.mount.form.storageConfig",
      ui: {
        placeholderKey: "admin.mount.form.storageConfigPlaceholder",
        descriptionKey: "admin.mount.form.storageConfigHint",
        // 动态选项：从API获取存储配置列表
        dynamicOptions: "storageConfigs",
        // 显示存储类型标签
        showTypeLabel: true,
      },
    },
    {
      name: "mount_path",
      type: "string",
      required: true,
      labelKey: "admin.mount.form.mountPath",
      ui: {
        placeholderKey: "admin.mount.form.mountPathPlaceholder",
        descriptionKey: "admin.mount.form.mountPathHint",
      },
      // 验证在前端组件中进行更复杂的逻辑判断（支持中文、斜杠等）
      // 这里只做基本的长度限制
      validation: {
        maxLength: 128,
      },
    },

    // === 高级设置 ===
    {
      name: "cache_ttl",
      type: "number",
      required: false,
      defaultValue: 300,
      labelKey: "admin.mount.form.cacheTtl",
      ui: {
        descriptionKey: "admin.mount.form.cacheTtlHint",
        suffix: "admin.mount.seconds",
        min: 0,
        max: 86400,
      },
      validation: {
        min: 0,
        max: 86400,
      },
    },
    {
      name: "sort_order",
      type: "number",
      required: false,
      defaultValue: 0,
      labelKey: "admin.mount.form.sortOrder",
      ui: {
        descriptionKey: "admin.mount.form.sortOrderHint",
      },
    },
    {
      name: "enable_folder_summary_compute",
      type: "boolean",
      required: false,
      defaultValue: false,
      labelKey: "admin.mount.form.enableFolderSummaryCompute",
      ui: {
        descriptionKey: "admin.mount.form.enableFolderSummaryComputeHint",
      },
    },

    // === 代理设置 ===
    {
      name: "web_proxy",
      type: "boolean",
      required: false,
      defaultValue: false,
      labelKey: "admin.mount.form.webProxy",
      ui: {
        descriptionKey: "admin.mount.form.webProxyHint",
      },
    },
    {
      name: "enable_sign",
      type: "boolean",
      required: false,
      defaultValue: false,
      labelKey: "admin.mount.form.proxySign.enableSign",
      ui: {
        descriptionKey: "admin.mount.form.proxySign.enableSignHint",
      },
      dependsOn: {
        field: "web_proxy",
        value: true,
      },
    },
    {
      name: "sign_expires",
      type: "number",
      required: false,
      labelKey: "admin.mount.form.proxySign.signExpires",
      ui: {
        placeholderKey: "admin.mount.form.proxySign.signExpiresPlaceholder",
        descriptionKey: "admin.mount.form.proxySign.signExpiresHint",
        suffix: "admin.mount.seconds",
        min: 60,
        max: 604800,
      },
      validation: {
        min: 60,
        max: 604800,
      },
      dependsOn: {
        field: "enable_sign",
        value: true,
      },
    },
    {
      name: "webdav_policy",
      type: "select",
      required: false,
      defaultValue: "302_redirect",
      labelKey: "admin.mount.form.webdavPolicy",
      ui: {
        descriptionKey: "admin.mount.form.webdavPolicyDescription",
        // 选项基于存储能力动态过滤
        dynamicOptions: "webdavPolicies",
      },
    },

    // === 状态 ===
    {
      name: "is_active",
      type: "boolean",
      required: false,
      defaultValue: true,
      labelKey: "admin.mount.form.isActive",
      ui: {
        descriptionKey: "admin.mount.form.isActiveHint",
      },
    },
  ],

  // 表单布局分组（支持双列和卡片布局）
  layout: {
    groups: [
      {
        id: "basic",
        // 不显示标题，作为默认首组
        titleKey: null,
        fields: ["name", "storage_type", "storage_config_id", "mount_path"],
      },
      {
        id: "advanced",
        titleKey: "admin.mount.groups.advanced",
        // 使用 { row: [...] } 标记双列布局
        fields: ["remark", { row: ["cache_ttl", "sort_order"] }, "enable_folder_summary_compute"],
      },
      {
        id: "proxy",
        titleKey: "admin.mount.groups.proxy",
        fields: [
          "web_proxy",
          // 代理签名配置卡片：依赖 web_proxy 启用时显示
          {
            card: "proxy_sign",
            titleKey: "admin.mount.groups.proxySign",
            dependsOn: { field: "web_proxy", value: true },
            fields: ["enable_sign", "sign_expires"],
          },
          "webdav_policy",
          "is_active",
        ],
      },
    ],
  },

  // 提供给前端的WebDAV策略选项元数据
  webdavPolicies: WebDavPolicyOptions,
};

/**
 * 获取Mount配置Schema
 * @returns {Object} Schema对象
 */
export function getMountConfigSchema() {
  return MountConfigSchema;
}
