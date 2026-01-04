<script setup>
import { ref, computed, watch, onMounted, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { useAdminStorageConfigService } from "@/modules/admin/services/storageConfigService.js";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import {
  STORAGE_UNITS,
  getDefaultStorageByProvider,
  setStorageSizeFromBytes,
  calculateStorageBytes,
  normalizeDefaultFolder,
  isValidUrl,
} from "@/modules/storage-core/schema/adminStorageSchemas.js";
import { IconEye, IconEyeOff, IconRefresh } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("ConfigForm");

// 接收属性
const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  config: {
    type: Object,
    default: null,
  },
  isEdit: {
    type: Boolean,
    default: false,
  },
});

// 定义事件
const emit = defineEmits(["close", "success"]);

// 存储类型元数据（从后端 /api/storage-types 动态加载，统一走 store 缓存）
const storageConfigsStore = useStorageConfigsStore();
const { storageTypesMeta } = storeToRefs(storageConfigsStore);

// 表单数据
const formData = ref({
  name: "",
  storage_type: "",
});

// 存储容量相关变量
const storageSize = ref("");
const storageUnit = ref(1024 * 1024 * 1024);
const storageUnits = STORAGE_UNITS;

const storageTypes = computed(() =>
  storageTypesMeta.value.map((meta) => ({
    value: meta.type,
    label: meta.displayName || meta.type,
  })),
);

const currentTypeMeta = computed(
  () => storageTypesMeta.value.find((meta) => meta.type === formData.value.storage_type) || null,
);

const providerTypes = computed(() => currentTypeMeta.value?.providerOptions || []);

// 当前存储类型的配置 schema（用于动态表单）
const currentConfigSchema = computed(() => currentTypeMeta.value?.configSchema || null);
const layoutGroups = computed(() => currentConfigSchema.value?.layout?.groups || []);

// 一些字段由外层统一处理，不在动态渲染中重复输出
const FIELDS_HANDLED_EXTERNALLY = new Set(["name", "storage_type", "is_public"]);

// 表单状态
const loading = ref(false);
const error = ref("");
const success = ref("");

const { getStorageConfigReveal, updateStorageConfig, createStorageConfig } = useAdminStorageConfigService();

const configIdRef = computed(() => (props.config && props.config.id) || null);
const currentType = computed(() => formData.value.storage_type || "");

// 计算表单标题与类型辅助标志
const isWebDavType = computed(() => formData.value.storage_type === "WEBDAV");
const isOneDriveType = computed(() => currentType.value === "ONEDRIVE");
const isGoogleDriveType = computed(() => currentType.value === "GOOGLE_DRIVE");

const formTitle = computed(() => {
  return props.isEdit ? "编辑存储配置" : "添加存储配置";
});

// 输入处理函数
const trimInput = (field) => {
  const value = formData.value[field];
  if (typeof value === "string") {
    formData.value[field] = value.trim();
  }
};

const formatUrl = (field) => {
  const value = formData.value[field];
  if (!value) {
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  let url = value.trim();
  // 通用规则：先去掉尾部多余斜杠
  url = url.replace(/\/+$/, "");
  formData.value[field] = url;
};

const formatBucketName = () => {
  if (typeof formData.value.bucket_name === "string") {
    // 只去除空格
    formData.value.bucket_name = formData.value.bucket_name.trim();
  }
};

// 基于后端 schema 的字段元数据查询
const getFieldMeta = (fieldName) => {
  const schema = currentConfigSchema.value;
  if (!schema?.fields) return null;
  return schema.fields.find((f) => f.name === fieldName) || null;
};

// 统一条件表达
const matchSchemaCondition = (condition) => {
  if (!condition || typeof condition !== "object") return false;
  const fieldName = condition.field;
  if (typeof fieldName !== "string" || !fieldName) return false;

  const currentValue = formData.value[fieldName];

  // 兼容两种写法：equals / value
  if (Object.prototype.hasOwnProperty.call(condition, "equals")) {
    return currentValue === condition.equals;
  }
  if (Object.prototype.hasOwnProperty.call(condition, "value")) {
    return currentValue === condition.value;
  }

  if (Object.prototype.hasOwnProperty.call(condition, "notEquals")) {
    return currentValue !== condition.notEquals;
  }

  if (Array.isArray(condition.values)) {
    return condition.values.includes(currentValue);
  }

  if (condition.truthy === true) {
    return !!currentValue;
  }
  if (condition.falsy === true) {
    return !currentValue;
  }

  return false;
};

const shouldRenderField = (fieldName) => {
  if (FIELDS_HANDLED_EXTERNALLY.has(fieldName)) return false;
  const meta = getFieldMeta(fieldName);
  if (!meta) return false;

  const dependsOn = meta?.ui?.dependsOn;
  if (dependsOn && typeof dependsOn === "object") {
    const depField = dependsOn.field;
    if (typeof depField === "string" && depField) {
      const currentValue = formData.value[depField];
      if (Object.prototype.hasOwnProperty.call(dependsOn, "value")) {
        return currentValue === dependsOn.value;
      }
      if (Array.isArray(dependsOn.values)) {
        return dependsOn.values.includes(currentValue);
      }
      if (dependsOn.truthy === true) {
        return !!currentValue;
      }
    }
  }

  return true;
};

/**
 * 判断字段是否应该被禁用
 * - 统一使用后端 schema 的 ui.disabledWhen 描述
 */
const isFieldDisabled = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  const disabledWhen = meta?.ui?.disabledWhen;
  if (disabledWhen && typeof disabledWhen === "object") {
    return matchSchemaCondition(disabledWhen);
  }
  return false;
};

// ===== secret 字段 =====
const secretVisibleByField = reactive({});
const secretsLoaded = ref(false);
const secretsRevealing = ref(false);

const getSecretFieldNames = () => {
  const schema = currentConfigSchema.value;
  if (!schema?.fields) return [];
  return schema.fields
    .filter((f) => f && typeof f === "object" && f.type === "secret" && typeof f.name === "string" && f.name)
    .map((f) => f.name);
};

const resetSecretUiState = () => {
  for (const key of Object.keys(secretVisibleByField)) {
    delete secretVisibleByField[key];
  }
  secretsLoaded.value = false;
  secretsRevealing.value = false;
};

/**
 * 获取组内的布局行（支持新格式）
 * - 数组项 ["field1", "field2"] → 并排渲染
 * - 字符串项 "field" → 全宽渲染
 * @param {object} group
 * @returns {Array<{type: 'row'|'full', fields?: string[], field?: string}>}
 */
const getLayoutRowsForGroup = (group) => {
  if (!group || !Array.isArray(group.fields)) return [];

  return group.fields
    .map((item) => {
      if (Array.isArray(item)) {
        // 并排字段：过滤掉不可渲染的字段
        const renderableFields = item.filter((name) => shouldRenderField(name));
        if (renderableFields.length === 0) return null;
        return { type: "row", fields: renderableFields };
      } else if (typeof item === "string") {
        // 全宽字段
        if (!shouldRenderField(item)) return null;
        return { type: "full", field: item };
      }
      return null;
    })
    .filter(Boolean);
};

const getFieldType = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  return meta?.type || "string";
};

const isSecretField = (fieldName) => getFieldType(fieldName) === "secret";
const isSecretVisible = (fieldName) => !!secretVisibleByField[fieldName];
const isSecretRevealing = (_fieldName) => secretsRevealing.value;
const getSecretInputType = (fieldName) => (isSecretVisible(fieldName) ? "text" : "password");

const handleSecretToggle = async (fieldName) => {
  if (!isSecretField(fieldName)) return;

  const nextVisible = !isSecretVisible(fieldName);

  // 新建时：只做前端可见性切换，不请求 reveal
  if (!props.isEdit || !configIdRef.value) {
    secretVisibleByField[fieldName] = nextVisible;
    return;
  }

  // 编辑时：首次展开任意一个 secret 字段时，拉一次 plain，把所有 secret 字段一起填充
  if (nextVisible && !secretsLoaded.value && !secretsRevealing.value) {
    secretsRevealing.value = true;
    try {
      const resp = await getStorageConfigReveal(configIdRef.value, "plain");
      const data = resp?.data || resp || {};

      const secretFields = getSecretFieldNames();
      for (const key of secretFields) {
        formData.value[key] = data[key] || "";
      }

      secretsLoaded.value = true;
    } catch (e) {
      error.value = e?.message || "获取存储密钥失败";
    } finally {
      secretsRevealing.value = false;
    }
  }

  secretVisibleByField[fieldName] = nextVisible;
};

const getFieldLabel = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (meta?.labelKey) {
    return t(meta.labelKey);
  }
  return fieldName;
};

/**
 * 获取字段占位符文本
 */
const getFieldPlaceholder = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (meta?.ui?.placeholderKey) {
    return t(meta.ui.placeholderKey);
  }
  return "";
};

/**
 * 获取字段描述文本
 */
const getFieldDescription = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (meta?.ui?.descriptionKey) {
    return t(meta.ui.descriptionKey);
  }
  return "";
};

/**
 * 获取布尔字段的显示值（用于并排布局中的复选框标签）
 */
const getBooleanDisplayValue = (fieldName) => {
  return formData.value[fieldName] ? t("common.enabled") : t("common.disabled");
};

/**
 * 检查字段是否标记为全宽
 */
const isFieldFullWidth = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  return meta?.ui?.fullWidth === true;
};

const getEnumOptions = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (Array.isArray(meta?.enumValues) && meta.enumValues.length > 0) {
    return meta.enumValues;
  }
  // provider_type 默认复用后端提供的 providerOptions
  if (fieldName === "provider_type" && Array.isArray(providerTypes.value)) {
    return providerTypes.value;
  }
  return [];
};

const isEnumToggle = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (meta?.type !== "enum") return false;
  if (meta?.ui?.renderAs !== "toggle") return false;
  const opts = getEnumOptions(fieldName);
  return Array.isArray(opts) && opts.length === 2;
};

const getEnumToggleValues = (fieldName) => {
  const opts = getEnumOptions(fieldName);
  const values = (opts || []).map((o) => o?.value).filter(Boolean);
  // 优先识别 Telegram 的常用值，避免依赖 options 顺序
  const onValue = values.includes("self_hosted") ? "self_hosted" : values[1];
  const offValue = values.includes("official") ? "official" : values[0];
  return { onValue, offValue };
};

const getEnumToggleLabel = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (meta?.ui?.toggleLabelKey) {
    return t(meta.ui.toggleLabelKey);
  }

  const { onValue } = getEnumToggleValues(fieldName);
  const opts = getEnumOptions(fieldName) || [];
  const onOpt = opts.find((o) => o?.value === onValue) || null;
  if (onOpt?.labelKey) return t(onOpt.labelKey);
  return onOpt?.label || String(onValue || "");
};

const handleEnumToggleChange = (fieldName, checked) => {
  const { onValue, offValue } = getEnumToggleValues(fieldName);
  formData.value[fieldName] = checked ? onValue : offValue;
};

const isUrlField = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  return meta?.validation?.rule === "url";
};

const isAbsPathField = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  return meta?.validation?.rule === "abs_path";
};

const isFieldRequiredOnCreate = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (!meta) return false;

  // 条件必填：requiredWhen 命中时，视为必填
  const requiredWhen = meta?.requiredWhen;
  if (requiredWhen && typeof requiredWhen === "object") {
    if (matchSchemaCondition(requiredWhen)) {
      return true;
    }
  }

  // 编辑
  if (props.isEdit) {
    return !!meta.required;
  }

  // 新建
  if (meta.requiredOnCreate === true) {
    return true;
  }
  return !!meta.required;
};

/**
 * 判断字段值是否为掩码（未修改的密钥）
 * 掩码格式：以 * 开头的字符串，如 "********abcd"
 */
const isMaskedValue = (value) => {
  return typeof value === "string" && value.startsWith("*");
};

/**
 * 归一化布尔字段的取值：
 */
const normalizeBooleanLike = (value) => {
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return value;
};

const normalizeFormBooleans = (schema = currentConfigSchema.value) => {
  // 顶层字段：后端存储为 0/1
  formData.value.is_public = normalizeBooleanLike(formData.value.is_public);

  // schema 内 boolean 字段：统一转换为 boolean
  if (!schema?.fields) return;
  for (const field of schema.fields) {
    if (!field || field.type !== "boolean" || !field.name) continue;
    formData.value[field.name] = normalizeBooleanLike(formData.value[field.name]);
  }
};

// 基于 schema.defaultValue 填充默认值
// 只在当前字段为空（undefined/null/空字符串）时写入，避免覆盖用户输入或编辑态数据
const applySchemaDefaultValues = (schema = currentConfigSchema.value) => {
  if (!schema?.fields) return;
  for (const field of schema.fields) {
    const key = field?.name;
    if (!key) continue;
    const current = formData.value[key];
    if ((current === undefined || current === null || current === "") && field.defaultValue !== undefined) {
      formData.value[key] = field.defaultValue;
    }
  }
};

// 字段级 blur 处理：复用已有工具逻辑
const handleFieldBlur = (fieldName) => {
  if (fieldName === "name") {
    trimInput("name");
    return;
  }
  if (fieldName === "default_folder") {
    formData.value.default_folder = normalizeDefaultFolder(formData.value.default_folder);
    return;
  }
  if (fieldName === "endpoint_url") {
    formatUrl("endpoint_url");
    return;
  }
  if (isUrlField(fieldName)) {
    formatUrl(fieldName);
    return;
  }
  trimInput(fieldName);
};

const buildPayload = () => {
  const base = {
    name: formData.value.name,
    storage_type: formData.value.storage_type,
    is_public: formData.value.is_public,
  };

  // 容量限制不在 schema 中，单独处理
  if (formData.value.total_storage_bytes !== undefined) {
    base.total_storage_bytes = formData.value.total_storage_bytes;
  }

  const extra = {};
  const schema = currentConfigSchema.value;
  if (schema?.fields) {
    for (const field of schema.fields) {
      const key = field.name;
      if (FIELDS_HANDLED_EXTERNALLY.has(key)) continue;
      const value = formData.value[key];
      if (value !== undefined) {
        extra[key] = value;
      }
    }
  }

  return {
    ...base,
    ...extra,
  };
};

// 表单验证：基于 schema + 通用规则
const formValid = computed(() => {
  const hasName = Boolean(formData.value.name && formData.value.name.trim());
  if (!hasName || !formData.value.storage_type) {
    return false;
  }

  const schema = currentConfigSchema.value;
  if (!schema || !Array.isArray(schema.fields)) {
    return true;
  }

  for (const field of schema.fields) {
    const key = field.name;
    if (FIELDS_HANDLED_EXTERNALLY.has(key)) continue;

    const value = formData.value[key];
    const requiredOnCreate = isFieldRequiredOnCreate(key);

    if (requiredOnCreate) {
      const missing =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim().length === 0);
      if (missing) {
        return false;
      }
    }

    if (field.validation?.rule === "url") {
      if (value && !isValidUrl(value)) {
        return false;
      }
    }

    if (field.validation?.rule === "abs_path" && typeof value === "string") {
      const trimmed = value.trim();
      const isPosixAbs = trimmed.startsWith("/");
      const isWinAbs = /^[a-zA-Z]:[\\/]/.test(trimmed);
      if (!isPosixAbs && !isWinAbs) {
        return false;
      }
    }
  }

  return true;
});

// 照顾当前已有的 S3/MIRROR 体验。
const ensureTypeDefaults = () => {
  const type = currentType.value;

  if (type === "S3") {
    const providerType = formData.value.provider_type;
    if (!providerType) return;
    if (formData.value.endpoint_url) return;

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
        formData.value.endpoint_url = "https://your-s3-endpoint.com";
        formData.value.path_style = false;
        break;
    }
  }

  if (type === "MIRROR") {
    const preset = formData.value.preset;
    if (!preset) return;
    const currentEndpoint = (formData.value.endpoint_url || "").trim();

    const defaultsByPreset = {
      tuna: "https://mirrors.tuna.tsinghua.edu.cn/",
      ustc: "https://mirrors.ustc.edu.cn/",
      aliyun: "https://mirrors.aliyun.com/",
    };

    const key = String(preset).trim().toLowerCase();
    const nextDefault = defaultsByPreset[key] || "";
    if (!nextDefault) return;

    if (!currentEndpoint) {
      formData.value.endpoint_url = nextDefault;
      return;
    }

    const knownDefaults = new Set(Object.values(defaultsByPreset));
    if (knownDefaults.has(currentEndpoint)) {
      formData.value.endpoint_url = nextDefault;
    }
  }
};

// 监听提供商变化（S3 默认 endpoint 由 per-type 行为配置填充）
watch(
  () => formData.value.provider_type,
  () => {
    ensureTypeDefaults();
  },
);

// 监听 MIRROR preset 变化（选择模板后自动回填 endpoint_url）
watch(
  () => [formData.value.storage_type, formData.value.preset],
  ([type]) => {
    if (type === "MIRROR") {
      ensureTypeDefaults();
    }
  },
);

// 切换存储类型时，secret 可见性与 reveal 状态必须重置（避免“上一个类型的密钥状态串到下一个类型”）
watch(
  () => currentType.value,
  () => {
    resetSecretUiState();
  },
);

// 监听编辑的配置变化
watch(
  () => props.config,
  () => {
    resetSecretUiState();
    const config = props.config;
    if (config) {
      const type = config.storage_type || (storageTypes.value[0]?.value || "");
      const next = { ...config, storage_type: type };

      // Google Drive：如果未显式设置 root_id，则编辑表单中统一展示为 "root"
      if (
        next.storage_type === "GOOGLE_DRIVE" &&
        (!next.root_id || String(next.root_id).trim().length === 0)
      ) {
        next.root_id = "root";
      }

      formData.value = next;
      normalizeFormBooleans();

      const sizeState = { storageSize: "", storageUnit: storageUnit.value };
      setStorageSizeFromBytes(formData.value.total_storage_bytes, sizeState);
      storageSize.value = sizeState.storageSize;
      storageUnit.value = sizeState.storageUnit;
    } else {
      const type = storageTypes.value[0]?.value || "";
      formData.value = {
        name: "",
        storage_type: type,
      };
      normalizeFormBooleans();
      const defaultBytes = getDefaultStorageByProvider("Cloudflare R2");
      formData.value.total_storage_bytes = defaultBytes;
      const sizeState = { storageSize: "", storageUnit: storageUnit.value };
      setStorageSizeFromBytes(defaultBytes, sizeState);
      storageSize.value = sizeState.storageSize;
      storageUnit.value = sizeState.storageUnit;
    }
  },
  { immediate: true },
);

// 监听provider_type变化，自动设置默认存储容量
watch(
  () => formData.value.provider_type,
  (newProvider) => {
    if (!formData.value.total_storage_bytes) {
      const defaultBytes = getDefaultStorageByProvider(newProvider);
      formData.value.total_storage_bytes = defaultBytes;
      const sizeState = { storageSize: "", storageUnit: storageUnit.value };
      setStorageSizeFromBytes(defaultBytes, sizeState);
      storageSize.value = sizeState.storageSize;
      storageUnit.value = sizeState.storageUnit;
    }
  },
);

// 监听存储大小和单位的变化
watch([storageSize, storageUnit], () => {
  formData.value.total_storage_bytes = calculateStorageBytes({
    storageSize: storageSize.value,
    storageUnit: storageUnit.value,
  });
});

// 当 schema 加载完成或 storage_type 切换时，确保布尔字段已归一化
watch(
  () => currentConfigSchema.value,
  (schema) => {
    if (!schema) return;
    applySchemaDefaultValues(schema);
    normalizeFormBooleans(schema);
    ensureTypeDefaults();
  },
);

// 提交表单
const submitForm = async () => {
  loading.value = true;
  error.value = "";
  success.value = "";

  try {
    let savedConfig;
    if (props.isEdit && props.config?.id) {
      const updateData = { ...buildPayload() };

      // 通用规则：所有 secret 字段（按后端 schema 定义）在编辑时都遵循：
      // - 空值：不提交（保留原值）
      // - masked 占位符（*****1234）：不提交（保留原值）
      const schema = currentConfigSchema.value;
      const secretFields = Array.isArray(schema?.fields)
        ? schema.fields
            .filter((f) => f && typeof f === "object" && f.type === "secret" && typeof f.name === "string" && f.name)
            .map((f) => f.name)
        : [];

      for (const fieldName of secretFields) {
        if (!Object.prototype.hasOwnProperty.call(updateData, fieldName)) continue;
        const raw = updateData[fieldName];
        const str = typeof raw === "string" ? raw.trim() : "";
        const shouldSkip = raw === null || raw === undefined || str.length === 0 || isMaskedValue(str);
        if (shouldSkip) {
          delete updateData[fieldName];
        }
      }

      savedConfig = await updateStorageConfig(props.config.id, updateData);
    } else {
      savedConfig = await createStorageConfig(buildPayload());
    }

    success.value = props.isEdit ? "存储配置更新成功！" : "存储配置创建成功！";
    try {
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        const configId = props.isEdit ? props.config?.id : savedConfig?.data?.id || savedConfig?.id;
        window.dispatchEvent(
          new CustomEvent("cloudpaste:storage-config-changed", {
            detail: {
              id: configId || null,
              storage_type: formData.value.storage_type || null,
            },
          }),
        );
      }
    } catch {}
    emit("success", savedConfig);
    setTimeout(() => {
      emit("close");
    }, 1000);
  } catch (err) {
    log.error("存储配置操作失败:", err);
    error.value = err.message || "操作失败，请重试";
  } finally {
    loading.value = false;
  }
};

// 处理关闭模态框
const closeModal = () => {
  emit("close");
};

// 初始化：加载存储类型元数据
onMounted(async () => {
  try {
    await storageConfigsStore.loadStorageTypes();
    if (!formData.value.storage_type && storageTypes.value.length > 0) {
      formData.value.storage_type = storageTypes.value[0].value;
    }
    // schema 默认值填充
    applySchemaDefaultValues(currentConfigSchema.value);
    normalizeFormBooleans();
  } catch (e) {
    log.error("加载存储类型元数据失败:", e);
  }
});
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4 bg-black bg-opacity-50 overflow-y-auto" @click.self="closeModal">
    <div
      class="w-full max-w-md sm:max-w-xl rounded-lg shadow-xl overflow-hidden transition-colors max-h-[85vh] sm:max-h-[80vh] flex flex-col"
      :class="darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'"
      @click.stop
    >
      <div class="px-4 sm:px-6 py-3 sm:py-4 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <h2 class="text-base sm:text-lg font-semibold">{{ formTitle }}</h2>
      </div>

      <div class="p-4 sm:p-6 space-y-3 sm:space-y-4 flex-1 overflow-y-auto">
        <div v-if="success" class="p-3 rounded-md text-sm font-medium mb-4 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
          {{ success }}
        </div>
        <div v-if="error" class="p-3 rounded-md text-sm font-medium mb-4 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {{ error }}
        </div>

        <!-- 表单字段 -->
        <form @submit.prevent="submitForm" class="space-y-6">
          <!-- 基本信息 -->
          <div class="space-y-4">
            <h3 class="text-sm font-medium border-b pb-2" :class="darkMode ? 'text-gray-200 border-gray-600' : 'text-gray-700 border-gray-200'">基本信息</h3>

            <div>
              <label for="storage_type" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                存储类型 <span class="text-red-500">*</span>
              </label>
              <select
                id="storage_type"
                v-model="formData.storage_type"
                class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900'"
              >
                <option v-for="type in storageTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
              </select>
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">请先选择存储类型。</p>
            </div>

            <!-- 配置名称 -->
            <div>
              <label for="name" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 配置名称 <span class="text-red-500">*</span> </label>
              <input
                type="text"
                id="name"
                v-model="formData.name"
                required
                @blur="trimInput('name')"
                class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                placeholder="例如：我的备份存储"
              />
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">为此配置指定一个易于识别的名称</p>
            </div>

            <!-- 容量限制 -->
            <div>
              <label for="storage_size" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 存储容量限制 </label>
              <div class="flex space-x-2">
                <input
                  type="number"
                  id="storage_size"
                  v-model="storageSize"
                  min="0"
                  step="0.01"
                  class="block w-2/3 px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                  placeholder="例如：10"
                />
                <select
                  v-model="storageUnit"
                  class="block w-1/3 px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900'"
                >
                  <option v-for="unit in storageUnits" :key="unit.value" :value="unit.value">{{ unit.label }}</option>
                </select>
              </div>
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                用于限制该存储的最大可用容量（默认 10GB，清空=不限额）
              </p>
            </div>

            <!-- schema 驱动的存储配置 -->
            <div v-if="currentConfigSchema && layoutGroups && layoutGroups.length" class="space-y-4">
              <div
                v-for="group in layoutGroups"
                :key="group.name"
                class="space-y-3"
              >
                <h3
                  class="text-sm font-medium border-b pb-2"
                  :class="darkMode ? 'text-gray-200 border-gray-600' : 'text-gray-700 border-gray-200'"
                >
                  {{ group.titleKey ? t(group.titleKey) : "存储配置" }}
                </h3>

                <!-- 遍历布局行 -->
                <template v-for="(row, rowIndex) in getLayoutRowsForGroup(group)">
                  <!-- 并排字段行 -->
                  <div v-if="row.type === 'row'" :key="`row-${rowIndex}`" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div v-for="fieldName in row.fields" :key="fieldName">
                      <!-- 布尔类型：勾选框 -->
                      <template v-if="getFieldType(fieldName) === 'boolean'">
                        <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                          {{ getFieldLabel(fieldName) }}
                        </label>
                        <div class="flex items-center h-10 px-3 py-2 rounded-md border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                          <input
                            type="checkbox"
                            :id="fieldName"
                            v-model="formData[fieldName]"
                            class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                          />
                          <label :for="fieldName" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                            {{ getBooleanDisplayValue(fieldName) }}
                          </label>
                        </div>
                        <p v-if="getFieldDescription(fieldName)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                          {{ getFieldDescription(fieldName) }}
                        </p>
                      </template>

                      <!-- 枚举：下拉选择 -->
                      <template v-else-if="getFieldType(fieldName) === 'enum'">
                        <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                          {{ getFieldLabel(fieldName) }}
                          <span v-if="isFieldRequiredOnCreate(fieldName)" class="text-red-500">*</span>
                        </label>
                        <div
                          v-if="isEnumToggle(fieldName)"
                          class="flex items-center h-10 px-3 py-2 rounded-md border"
                          :class="darkMode ? 'border-gray-600' : 'border-gray-300'"
                        >
                          <input
                            type="checkbox"
                            :id="fieldName"
                            :checked="formData[fieldName] === getEnumToggleValues(fieldName).onValue"
                            @change="handleEnumToggleChange(fieldName, $event.target.checked)"
                            class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                          />
                          <label :for="fieldName" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                            {{ getEnumToggleLabel(fieldName) }}
                          </label>
                        </div>
                        <select
                          v-else
                          :id="fieldName"
                          v-model="formData[fieldName]"
                          class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                          :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900'"
                        >
                          <option
                            v-for="opt in getEnumOptions(fieldName)"
                            :key="opt.value"
                            :value="opt.value"
                          >
                            {{ opt.labelKey ? t(opt.labelKey) : opt.label || opt.value }}
                          </option>
                        </select>
                        <p v-if="getFieldDescription(fieldName)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                          {{ getFieldDescription(fieldName) }}
                        </p>
                      </template>

                      <!-- secret：密码字段 -->
                      <template v-else-if="getFieldType(fieldName) === 'secret'">
                        <div class="flex items-center justify-between mb-1">
                          <label
                            :for="fieldName"
                            class="block text-sm font-medium"
                            :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
                          >
                            {{ getFieldLabel(fieldName) }}
                            <span v-if="isFieldRequiredOnCreate(fieldName)" class="text-red-500">*</span>
                          </label>
                          <button
                            v-if="isSecretField(fieldName)"
                            type="button"
                            @click.stop="handleSecretToggle(fieldName)"
                            class="inline-flex items-center px-2 py-1 rounded text-xs flex-shrink-0"
                            :class="darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                            :disabled="isSecretRevealing(fieldName)"
                          >
                            <IconEye v-if="!isSecretRevealing(fieldName) && !isSecretVisible(fieldName)" size="sm" />
                            <IconEyeOff v-else-if="!isSecretRevealing(fieldName) && isSecretVisible(fieldName)" size="sm" />
                            <IconRefresh v-else size="sm" class="animate-spin" />
                          </button>
                        </div>
                        <input
                          :type="getSecretInputType(fieldName)"
                          :id="fieldName"
                          v-model="formData[fieldName]"
                          :required="isFieldRequiredOnCreate(fieldName) && !isEdit"
                          :placeholder="getFieldPlaceholder(fieldName)"
                          autocomplete="new-password"
                          class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                          :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                        />
                        <p v-if="getFieldDescription(fieldName)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                          {{ getFieldDescription(fieldName) }}
                        </p>
                      </template>

                      <!-- 数字 / 文本字段 -->
                      <template v-else>
                        <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                          {{ getFieldLabel(fieldName) }}
                          <span v-if="isFieldRequiredOnCreate(fieldName)" class="text-red-500">*</span>
                        </label>
                        <input
                          :type="getFieldType(fieldName) === 'number' ? 'number' : 'text'"
                          :id="fieldName"
                          v-model="formData[fieldName]"
                          :required="isFieldRequiredOnCreate(fieldName)"
                          :disabled="isFieldDisabled(fieldName)"
                          :placeholder="getFieldPlaceholder(fieldName)"
                          @blur="handleFieldBlur(fieldName)"
                          class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                          :class="[
                            darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500',
                            isUrlField(fieldName) && formData[fieldName] && !isValidUrl(formData[fieldName]) ? 'border-red-500' : '',
                            isFieldDisabled(fieldName) ? 'opacity-50 cursor-not-allowed' : '',
                          ]"
                        />
                        <p v-if="isUrlField(fieldName) && formData[fieldName] && !isValidUrl(formData[fieldName])" class="mt-1 text-xs text-red-500">
                          请输入有效的 URL 格式，如 https://xxx.com
                        </p>
                        <p v-else-if="getFieldDescription(fieldName)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                          {{ getFieldDescription(fieldName) }}
                        </p>
                      </template>
                    </div>
                  </div>

                  <!-- 全宽字段 -->
                  <div v-else-if="row.type === 'full'" :key="`full-${rowIndex}`" class="w-full">
                    <!-- 布尔类型：勾选框 -->
                    <template v-if="getFieldType(row.field) === 'boolean'">
                      <div class="flex items-center h-10 px-3 py-2 rounded-md border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                        <input
                          type="checkbox"
                          :id="row.field"
                          v-model="formData[row.field]"
                          class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                        />
                        <label :for="row.field" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                          {{ getFieldLabel(row.field) }}
                        </label>
                      </div>
                      <p v-if="getFieldDescription(row.field)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ getFieldDescription(row.field) }}
                      </p>
                    </template>

                    <!-- 枚举：下拉选择 -->
                    <template v-else-if="getFieldType(row.field) === 'enum'">
                      <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                        {{ getFieldLabel(row.field) }}
                        <span v-if="isFieldRequiredOnCreate(row.field)" class="text-red-500">*</span>
                      </label>
                      <div
                        v-if="isEnumToggle(row.field)"
                        class="flex items-center h-10 px-3 py-2 rounded-md border"
                        :class="darkMode ? 'border-gray-600' : 'border-gray-300'"
                      >
                        <input
                          type="checkbox"
                          :id="row.field"
                          :checked="formData[row.field] === getEnumToggleValues(row.field).onValue"
                          @change="handleEnumToggleChange(row.field, $event.target.checked)"
                          class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                        />
                        <label :for="row.field" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                          {{ getEnumToggleLabel(row.field) }}
                        </label>
                      </div>
                      <select
                        v-else
                        :id="row.field"
                        v-model="formData[row.field]"
                        class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                        :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900'"
                      >
                        <option
                          v-for="opt in getEnumOptions(row.field)"
                          :key="opt.value"
                          :value="opt.value"
                        >
                          {{ opt.labelKey ? t(opt.labelKey) : opt.label || opt.value }}
                        </option>
                      </select>
                      <p v-if="getFieldDescription(row.field)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ getFieldDescription(row.field) }}
                      </p>
                    </template>

                    <!-- secret：密码字段 -->
                    <template v-else-if="getFieldType(row.field) === 'secret'">
                      <div class="flex items-center justify-between mb-1">
                        <label
                          :for="row.field"
                          class="block text-sm font-medium"
                          :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
                        >
                          {{ getFieldLabel(row.field) }}
                          <span v-if="isFieldRequiredOnCreate(row.field)" class="text-red-500">*</span>
                        </label>
                        <button
                          v-if="isSecretField(row.field)"
                          type="button"
                          @click.stop="handleSecretToggle(row.field)"
                          class="inline-flex items-center px-2 py-1 rounded text-xs flex-shrink-0"
                          :class="darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                          :disabled="isSecretRevealing(row.field)"
                        >
                          <IconEye v-if="!isSecretRevealing(row.field) && !isSecretVisible(row.field)" size="sm" />
                          <IconEyeOff v-else-if="!isSecretRevealing(row.field) && isSecretVisible(row.field)" size="sm" />
                          <IconRefresh v-else size="sm" class="animate-spin" />
                        </button>
                      </div>
                      <!-- OneDrive refresh_token 字段：仅输入框，由外部授权站点提供令牌 -->
                      <input
                        v-if="row.field === 'refresh_token' && isOneDriveType"
                        :type="getSecretInputType(row.field)"
                        :id="row.field"
                        v-model="formData[row.field]"
                        :required="isFieldRequiredOnCreate(row.field) && !isEdit"
                        :placeholder="getFieldPlaceholder(row.field)"
                        autocomplete="new-password"
                        class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                        :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                      />
                      <!-- 其他 secret 字段：普通输入框 -->
                      <input
                        v-else
                        :type="getSecretInputType(row.field)"
                        :id="row.field"
                        v-model="formData[row.field]"
                        :required="isFieldRequiredOnCreate(row.field) && !isEdit"
                        :placeholder="getFieldPlaceholder(row.field)"
                        autocomplete="new-password"
                        class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                        :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                      />
                      <p v-if="row.field === 'refresh_token' && isOneDriveType" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        请输入在外部授权页面（如 OpenList APIPages）获取的刷新令牌
                      </p>
                      <p v-else-if="getFieldDescription(row.field)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ getFieldDescription(row.field) }}
                      </p>
                    </template>

                    <!-- 数字 / 文本字段 -->
                    <template v-else>
                      <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                        {{ getFieldLabel(row.field) }}
                        <span v-if="isFieldRequiredOnCreate(row.field)" class="text-red-500">*</span>
                      </label>
                      <input
                        :type="getFieldType(row.field) === 'number' ? 'number' : 'text'"
                        :id="row.field"
                        v-model="formData[row.field]"
                        :required="isFieldRequiredOnCreate(row.field)"
                        :disabled="isFieldDisabled(row.field)"
                        :placeholder="getFieldPlaceholder(row.field)"
                        @blur="handleFieldBlur(row.field)"
                        class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                        :class="[
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500',
                          isUrlField(row.field) && formData[row.field] && !isValidUrl(formData[row.field]) ? 'border-red-500' : '',
                          isFieldDisabled(row.field) ? 'opacity-50 cursor-not-allowed' : '',
                        ]"
                      />
                      <p v-if="isUrlField(row.field) && formData[row.field] && !isValidUrl(formData[row.field])" class="mt-1 text-xs text-red-500">
                        请输入有效的 URL 格式，如 https://xxx.com
                      </p>
                      <p v-else-if="getFieldDescription(row.field)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ getFieldDescription(row.field) }}
                      </p>
                    </template>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <!-- 其他选项 -->
          <div class="space-y-4">
            <h3 class="text-sm font-medium border-b pb-2" :class="darkMode ? 'text-gray-200 border-gray-600' : 'text-gray-700 border-gray-200'">其他选项</h3>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- API密钥权限 -->
              <div>
                <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">API密钥权限</label>
                <div class="flex items-center h-10 px-3 py-2 rounded-md border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                  <input
                    type="checkbox"
                    id="is_public"
                    v-model="formData.is_public"
                    class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                  />
                  <label for="is_public" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">允许API密钥用户使用</label>
                </div>
                <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">允许API密钥用户使用此存储</p>
              </div>
            </div>
          </div>
        </form>
      </div>

      <div
        class="px-3 sm:px-4 py-2 sm:py-3 border-t transition-colors duration-200 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 space-y-2 space-y-reverse sm:space-y-0"
        :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
      >
        <button
          @click="closeModal"
          class="w-full sm:w-auto px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
        >
          取消
        </button>

        <button
          @click="submitForm"
          :disabled="!formValid || loading"
          class="w-full sm:w-auto flex justify-center items-center px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 bg-primary-500 hover:bg-primary-600 text-white"
          :class="{ 'opacity-50 cursor-not-allowed': !formValid || loading }"
        >
          <IconRefresh v-if="loading" size="sm" class="animate-spin -ml-1 mr-2 text-white" />
          {{ loading ? "保存中..." : "保存配置" }}
        </button>
      </div>
    </div>
  </div>
</template>
