<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useAdminStorageConfigService } from "@/modules/admin/services/storageConfigService.js";
import {
  STORAGE_UNITS,
  getDefaultStorageByProvider,
  setStorageSizeFromBytes,
  calculateStorageBytes,
  normalizeDefaultFolder,
  isValidUrl,
} from "@/modules/storage-core/schema/adminStorageSchemas.js";
import { useAdminStorageTypeBehavior } from "@/modules/admin/storage/adminStorageTypeBehavior.js";
import { api } from "@/api";
import { IconEye, IconEyeOff, IconRefresh } from "@/components/icons";

const { t } = useI18n();

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

// 存储类型元数据（从后端 /api/storage-types 动态加载）
const storageTypesMeta = ref([]);

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

// 行为配置 hook 依赖的辅助 ref
const isEditRef = computed(() => props.isEdit);
const configIdRef = computed(() => (props.config && props.config.id) || null);

const {
  currentType,
  isSecretField,
  isSecretVisible,
  isSecretRevealing,
  handleSecretToggle,
  getSecretInputType,
  isFieldDisabled: behaviorIsFieldDisabled,
  isFieldRequiredOnCreate: behaviorIsFieldRequiredOnCreate,
  formatFieldOnBlur,
  ensureTypeDefaults,
} = useAdminStorageTypeBehavior({
  formData,
  isEditRef,
  configIdRef,
  getStorageConfigReveal,
  errorRef: error,
});

// 计算表单标题与类型辅助标志
const isWebDavType = computed(() => formData.value.storage_type === "WEBDAV");
const isOneDriveType = computed(() => currentType.value === "ONEDRIVE");
const isGoogleDriveType = computed(() => currentType.value === "GOOGLE_DRIVE");

const formTitle = computed(() => {
  return props.isEdit ? "编辑存储配置" : "添加存储配置";
});

// 输入处理函数
const trimInput = (field) => {
  if (formData.value[field]) {
    formData.value[field] = formData.value[field].trim();
  }
};

const formatUrl = (field) => {
  if (!formData.value[field]) {
    return;
  }
  let url = formData.value[field].trim();
  // 通用规则：先去掉尾部多余斜杠
  url = url.replace(/\/+$/, "");
  formData.value[field] = url;
};

const formatBucketName = () => {
  if (formData.value.bucket_name) {
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

const shouldRenderField = (fieldName) => {
  if (FIELDS_HANDLED_EXTERNALLY.has(fieldName)) return false;
  return !!getFieldMeta(fieldName);
};

/**
 * 判断字段是否应该被禁用
 * - 具体规则由 per-type 行为配置决定（如 OneDrive token_renew_endpoint）
 */
const isFieldDisabled = (fieldName) => behaviorIsFieldDisabled(fieldName);

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
  return behaviorIsFieldRequiredOnCreate(fieldName, meta);
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
    // 针对具体类型的额外格式化逻辑（如 WebDAV endpoint 末尾追加斜杠）
    formatFieldOnBlur("endpoint_url");
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
  if (formData.value.total_storage_bytes != null) {
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

// 监听提供商变化（S3 默认 endpoint 由 per-type 行为配置填充）
watch(
  () => formData.value.provider_type,
  () => {
    ensureTypeDefaults();
  },
);

// 监听编辑的配置变化
watch(
  () => props.config,
  () => {
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
    normalizeFormBooleans(schema);
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

      // S3 密钥字段：空值或掩码值不提交（保留原值）
      if (!updateData.access_key_id || updateData.access_key_id.trim() === "" || isMaskedValue(updateData.access_key_id)) {
        delete updateData.access_key_id;
      }

      if (!updateData.secret_access_key || updateData.secret_access_key.trim() === "" || isMaskedValue(updateData.secret_access_key)) {
        delete updateData.secret_access_key;
      }

      // WebDAV 密码字段：空值或掩码值不提交（保留原值）
      if (isWebDavType.value && (!updateData.password || updateData.password.trim() === "" || isMaskedValue(updateData.password))) {
        delete updateData.password;
      }

      // OneDrive / GoogleDrive 密钥字段：空值或掩码值不提交（保留原值）
      if (
        (isOneDriveType.value || isGoogleDriveType.value) &&
        (!updateData.client_secret || updateData.client_secret.trim() === "" || isMaskedValue(updateData.client_secret))
      ) {
        delete updateData.client_secret;
      }

      if (
        (isOneDriveType.value || isGoogleDriveType.value) &&
        (!updateData.refresh_token || updateData.refresh_token.trim() === "" || isMaskedValue(updateData.refresh_token))
      ) {
        delete updateData.refresh_token;
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
    console.error("存储配置操作失败:", err);
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
    const resp = await api.mount.getStorageTypes();
    storageTypesMeta.value = Array.isArray(resp?.data) ? resp.data : Array.isArray(resp) ? resp : [];
    if (!formData.value.storage_type && storageTypes.value.length > 0) {
      formData.value.storage_type = storageTypes.value[0].value;
    }
    // schema 默认值填充
    const schema = currentConfigSchema.value;
    if (schema?.fields) {
      for (const field of schema.fields) {
        const key = field.name;
        const current = formData.value[key];
        if ((current === undefined || current === null || current === "") && field.defaultValue !== undefined) {
          formData.value[key] = field.defaultValue;
        }
      }
    }
    normalizeFormBooleans();
  } catch (e) {
    console.error("加载存储类型元数据失败:", e);
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
                {{ formData.provider_type === "Cloudflare R2" || formData.provider_type === "Backblaze B2" ? "建议默认 10GB" : "建议默认 5GB" }}
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
                        <select
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
                      <select
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
