import { computed, ref } from "vue";

/**
 * Admin 存储类型行为配置
 * - 聚合不同存储类型在配置表单中的行为差异（secret 显示、字段禁用/必填规则等）
 * - 仅描述 Admin 配置 UI 行为，不承担后端校验职责
 */

const STORAGE_TYPE_BEHAVIOR_DEF = {
  S3: {
    secretFields: ["access_key_id", "secret_access_key"],
    /**
     * 针对 provider_type 的默认值填充与 endpoint 初始化
     * - 仅在 endpoint_url 为空时生效（避免覆盖用户输入）
     */
    ensureDefaults(formData) {
      const providerType = formData.value.provider_type;
      if (!providerType) return;
      if (formData.value.endpoint_url) {
        return;
      }

      switch (providerType) {
        case "Cloudflare R2":
          formData.value.endpoint_url = "https://<accountid>.r2.cloudflarestorage.com";
          formData.value.region = "auto";
          formData.value.path_style = false;
          break;
        case "Backblaze B2":
          formData.value.endpoint_url = "https://s3.us-west-000.backblazeb2.com";
          formData.value.region = "";
          formData.value.path_style = true;
          break;
        case "AWS S3":
          formData.value.endpoint_url = "https://s3.amazonaws.com";
          formData.value.path_style = false;
          break;
        case "Aliyun OSS":
          formData.value.endpoint_url = "https://oss-cn-hangzhou.aliyuncs.com";
          formData.value.region = "oss-cn-hangzhou";
          formData.value.path_style = false;
          break;
        default:
          // 其他 S3 兼容服务的通用默认值
          formData.value.endpoint_url = "https://your-s3-endpoint.com";
          formData.value.path_style = false;
          break;
      }
    },
  },
  WEBDAV: {
    secretFields: ["password"],
    /**
     * 字段格式化规则
     * - endpoint_url 统一追加结尾斜杠
     */
    formatOnBlur(fieldName, formData) {
      if (fieldName === "endpoint_url") {
        const raw = formData.value.endpoint_url;
        if (!raw) {
          formData.value.endpoint_url = "";
          return;
        }
        let value = String(raw).trim();
        if (!value.endsWith("/")) {
          value = `${value}/`;
        }
        formData.value.endpoint_url = value;
      }
    },
  },
  ONEDRIVE: {
    secretFields: ["client_secret", "refresh_token"],
    /**
     * 字段禁用规则
     * - token_renew_endpoint 仅在 use_online_api 启用时可编辑
     */
    isFieldDisabled(fieldName, formData) {
      if (fieldName === "token_renew_endpoint") {
        return !formData.value.use_online_api;
      }
      return false;
    },
  },
  GOOGLE_DRIVE: {
    secretFields: ["client_secret", "refresh_token"],
    /**
     * 字段禁用规则
     * - api_address 仅在 use_online_api 启用时可编辑
     */
    isFieldDisabled(fieldName, formData) {
      if (fieldName === "api_address") {
        return !formData.value.use_online_api;
      }
      return false;
    },
  },
  GITHUB_RELEASES: {
    secretFields: ["token"],
  },
};

/**
 * Admin 存储类型行为钩子
 * @param {object} options
 * @param {import('vue').Ref<object>} options.formData - 表单数据 ref
 * @param {import('vue').Ref<boolean>} options.isEditRef - 是否为编辑模式
 * @param {import('vue').Ref<string|null>} options.configIdRef - 当前配置 ID
 * @param {Function} options.getStorageConfigReveal - 后端 reveal API
 * @param {import('vue').Ref<string>} [options.errorRef] - 错误信息 ref
 */
export function useAdminStorageTypeBehavior(options) {
  const { formData, isEditRef, configIdRef, getStorageConfigReveal, errorRef } = options;

  const secretState = {
    S3: {
      visible: ref(false),
      revealing: ref(false),
      loaded: ref(false),
    },
    WEBDAV: {
      visible: ref(false),
      revealing: ref(false),
      loaded: ref(false),
    },
    ONEDRIVE: {
      visible: ref(false),
      revealing: ref(false),
      loaded: ref(false),
    },
    GOOGLE_DRIVE: {
      visible: ref(false),
      revealing: ref(false),
      loaded: ref(false),
    },
    GITHUB_RELEASES: {
      visible: ref(false),
      revealing: ref(false),
      loaded: ref(false),
    },
  };

  const currentType = computed(() => formData.value.storage_type || "");

  const getBehaviorDef = (type) => STORAGE_TYPE_BEHAVIOR_DEF[type] || null;

  const isSecretField = (fieldName) => {
    const def = getBehaviorDef(currentType.value);
    return !!def?.secretFields?.includes(fieldName);
  };

  const isSecretVisible = (fieldName) => {
    const type = currentType.value;
    if (!isSecretField(fieldName)) return false;
    const state = secretState[type];
    return !!state?.visible.value;
  };

  const isSecretRevealing = (fieldName) => {
    const type = currentType.value;
    if (!isSecretField(fieldName)) return false;
    const state = secretState[type];
    return !!state?.revealing.value;
  };

  const getSecretInputType = (fieldName) => (isSecretVisible(fieldName) ? "text" : "password");

  const handleSecretToggle = async (fieldName) => {
    const type = currentType.value;
    const def = getBehaviorDef(type);
    const state = secretState[type];

    if (!def || !def.secretFields?.includes(fieldName) || !state) {
      return;
    }

    // 新建时或无 configId 时，仅在前端切换可见性，不触发 reveal API
    if (!isEditRef.value || !configIdRef.value) {
      state.visible.value = !state.visible.value;
      return;
    }

    // 首次展开时调用一次 reveal API，填充表单中的密钥字段
    if (!state.visible.value && !state.loaded.value) {
      state.revealing.value = true;
      try {
        const resp = await getStorageConfigReveal(configIdRef.value, "plain");
        const data = resp?.data || resp;
        if (data) {
          if (type === "S3") {
            formData.value.access_key_id = data.access_key_id || "";
            formData.value.secret_access_key = data.secret_access_key || "";
          } else if (type === "WEBDAV") {
            formData.value.password = data.password || "";
          } else if (type === "ONEDRIVE") {
            formData.value.client_secret = data.client_secret || "";
            formData.value.refresh_token = data.refresh_token || "";
          } else if (type === "GOOGLE_DRIVE") {
            formData.value.client_secret = data.client_secret || "";
            formData.value.refresh_token = data.refresh_token || "";
          } else if (type === "GITHUB_RELEASES") {
            formData.value.token = data.token || "";
          }
          state.loaded.value = true;
        }
      } catch (e) {
        if (errorRef) {
          errorRef.value = e?.message || "获取存储密钥失败";
        }
      } finally {
        state.revealing.value = false;
      }
    }

    state.visible.value = !state.visible.value;
  };

  const isFieldDisabled = (fieldName) => {
    const def = getBehaviorDef(currentType.value);
    if (def && typeof def.isFieldDisabled === "function") {
      return def.isFieldDisabled(fieldName, formData);
    }
    return false;
  };

  /**
   * 字段在创建时是否必填
   * - 复用现有实现逻辑：非编辑模式下，secret 字段默认必填
   * - 对 ONEDRIVE 的 refresh_token/client_secret 使用 schema 的 required 定义
   */
  const isFieldRequiredOnCreate = (fieldName, meta) => {
    if (!meta) return false;

    const storageType = currentType.value;

    // GitHub Releases：令牌等 secret 字段保持可选
    if (storageType === "GITHUB_RELEASES") {
      return !!meta.required;
    }

    // OneDrive / GoogleDrive 的 refresh_token 和 client_secret 通过授权获取，新建时遵循 schema 标记
    if (
      (storageType === "ONEDRIVE" || storageType === "GOOGLE_DRIVE") &&
      (fieldName === "refresh_token" || fieldName === "client_secret")
    ) {
      return !!meta.required;
    }

    // 其他 secret 类字段在新建时默认视为必填，编辑时允许留空保留原值
    if (!isEditRef.value && meta.type === "secret") {
      return true;
    }

    return !!meta.required;
  };

  /**
   * 根据字段名称执行类型特定的 blur 格式化逻辑
   * - 例如 WebDAV endpoint 末尾补斜杠
   */
  const formatFieldOnBlur = (fieldName) => {
    const def = getBehaviorDef(currentType.value);
    if (def && typeof def.formatOnBlur === "function") {
      def.formatOnBlur(fieldName, formData);
    }
  };

  /**
   * 针对 provider_type 的默认值填充（目前用于 S3 endpoint 默认值）
   */
  const ensureTypeDefaults = () => {
    const def = getBehaviorDef(currentType.value);
    if (def && typeof def.ensureDefaults === "function") {
      def.ensureDefaults(formData);
    }
  };

  return {
    currentType,
    isSecretField,
    isSecretVisible,
    isSecretRevealing,
    handleSecretToggle,
    getSecretInputType,
    isFieldDisabled,
    isFieldRequiredOnCreate,
    formatFieldOnBlur,
    ensureTypeDefaults,
  };
}
