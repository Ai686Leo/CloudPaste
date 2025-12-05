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
  normalizeEndpointForWebDav,
  isValidUrl,
} from "@/modules/storage-core/schema/adminStorageSchemas.js";
import { api } from "@/api";

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

// 密钥揭示控制：none | masked | plain
const showPlain = ref(false);
const revealing = ref(false);
const fetchedPlain = ref(false);

// WebDAV 密码显示控制
const showWebDavPassword = ref(false);
const revealingWebDav = ref(false);
const fetchedWebDavPassword = ref(false);

const toggleReveal = async () => {
  if (!props.isEdit || !props?.config?.id) {
    showPlain.value = !showPlain.value;
    return;
  }
  if (!showPlain.value && !fetchedPlain.value) {
    revealing.value = true;
    try {
      const resp = await getStorageConfigReveal(props.config.id, "plain");
      const data = resp?.data || resp;
      if (data) {
        formData.value.access_key_id = data.access_key_id || "";
        formData.value.secret_access_key = data.secret_access_key || "";
        fetchedPlain.value = true;
      }
    } catch (e) {
      error.value = e?.message || "获取密钥失败";
    } finally {
      revealing.value = false;
    }
  }
  showPlain.value = !showPlain.value;
};

const toggleWebDavPasswordReveal = async () => {
  if (!props.isEdit || !props?.config?.id) {
    showWebDavPassword.value = !showWebDavPassword.value;
    return;
  }
  if (!showWebDavPassword.value && !fetchedWebDavPassword.value) {
    revealingWebDav.value = true;
    try {
      const resp = await getStorageConfigReveal(props.config.id, "plain");
      const data = resp?.data || resp;
      if (data) {
        formData.value.password = data.password || "";
        fetchedWebDavPassword.value = true;
      }
    } catch (e) {
      error.value = e?.message || "获取WebDAV密码失败";
    } finally {
      revealingWebDav.value = false;
    }
  }
  showWebDavPassword.value = !showWebDavPassword.value;
};

// 计算表单标题
const isWebDavType = computed(() => formData.value.storage_type === "WEBDAV");

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
  if (formData.value[field]) {
    let url = formData.value[field].trim();

    if (field === "endpoint_url" && isWebDavType.value) {
      url = normalizeEndpointForWebDav(url);
    } else {
      url = url.replace(/\/+$/, "");
    }

    formData.value[field] = url;
  }
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
  // secret 类字段在新建时默认视为必填，编辑时允许留空保留原值
  if (!props.isEdit && meta.type === "secret") {
    return true;
  }
  return !!meta.required;
};

// secret 字段的可见性控制（沿用原有 S3 / WebDAV 逻辑）
const isS3SecretField = (fieldName) =>
  formData.value.storage_type === "S3" && (fieldName === "access_key_id" || fieldName === "secret_access_key");

const isWebDavPasswordField = (fieldName) => formData.value.storage_type === "WEBDAV" && fieldName === "password";

const isSecretVisible = (fieldName) => {
  if (isS3SecretField(fieldName)) {
    return showPlain.value;
  }
  if (isWebDavPasswordField(fieldName)) {
    return showWebDavPassword.value;
  }
  return false;
};

const isSecretRevealing = (fieldName) => {
  if (isS3SecretField(fieldName)) {
    return revealing.value;
  }
  if (isWebDavPasswordField(fieldName)) {
    return revealingWebDav.value;
  }
  return false;
};

const handleSecretToggle = async (fieldName) => {
  if (isS3SecretField(fieldName)) {
    await toggleReveal();
  } else if (isWebDavPasswordField(fieldName)) {
    await toggleWebDavPasswordReveal();
  }
};

const getSecretInputType = (fieldName) => (isSecretVisible(fieldName) ? "text" : "password");

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

// 根据提供商类型预填默认端点
const updateEndpoint = () => {
  const type = formData.value.provider_type;

  if (formData.value.endpoint_url) {
    return; // 如果已有值，不覆盖
  }

  switch (type) {
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
      // 其他S3兼容服务使用标准设置
      formData.value.endpoint_url = "https://your-s3-endpoint.com";
      formData.value.path_style = false;
      break;
  }
};

// 监听提供商变化
watch(() => formData.value.provider_type, updateEndpoint);

// 监听编辑的配置变化
watch(
  () => props.config,
  () => {
    const config = props.config;
    if (config) {
      const type = config.storage_type || (storageTypes.value[0]?.value || "");
      formData.value = { ...config, storage_type: type };

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

// 提交表单
const submitForm = async () => {
  loading.value = true;
  error.value = "";
  success.value = "";

  try {
    let savedConfig;
    if (props.isEdit && props.config?.id) {
      const updateData = { ...buildPayload() };

      if (!updateData.access_key_id || updateData.access_key_id.trim() === "") {
        delete updateData.access_key_id;
      }

      if (!updateData.secret_access_key || updateData.secret_access_key.trim() === "") {
        delete updateData.secret_access_key;
      }

      if (isWebDavType.value && (!updateData.password || updateData.password.trim() === "")) {
        delete updateData.password;
      }

      savedConfig = await updateStorageConfig(props.config.id, updateData);
    } else {
      savedConfig = await createStorageConfig(buildPayload());
    }

    success.value = props.isEdit ? "存储配置更新成功！" : "存储配置创建成功！";
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
                <template v-for="(row, rowIndex) in getLayoutRowsForGroup(group)" :key="rowIndex">
                  <!-- 并排字段行 -->
                  <div v-if="row.type === 'row'" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        <label
                          class="block text-sm font-medium mb-1 flex items-center justify-between"
                          :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
                        >
                          <span>
                            {{ getFieldLabel(fieldName) }}
                            <span v-if="isFieldRequiredOnCreate(fieldName)" class="text-red-500">*</span>
                          </span>
                          <button
                            v-if="isS3SecretField(fieldName) || isWebDavPasswordField(fieldName)"
                            type="button"
                            @click="handleSecretToggle(fieldName)"
                            class="ml-2 inline-flex items-center px-2 py-1 rounded text-xs"
                            :class="darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                            :disabled="isSecretRevealing(fieldName)"
                          >
                            <svg
                              v-if="!isSecretRevealing(fieldName) && !isSecretVisible(fieldName)"
                              xmlns="http://www.w3.org/2000/svg"
                              class="h-4 w-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              <circle cx="12" cy="12" r="3" stroke-width="2" />
                            </svg>
                            <svg
                              v-else-if="!isSecretRevealing(fieldName) && isSecretVisible(fieldName)"
                              xmlns="http://www.w3.org/2000/svg"
                              class="h-4 w-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a10.05 10.05 0 013.47-5.23M6.1 6.1C7.93 5.103 9.91 4.5 12 4.5c4.477 0 8.268 2.943 9.542 7-.337 1.075-.84 2.08-1.48 2.985M3 3l18 18" />
                            </svg>
                            <svg v-else class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          </button>
                        </label>
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
                          :placeholder="getFieldPlaceholder(fieldName)"
                          @blur="handleFieldBlur(fieldName)"
                          class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                          :class="[
                            darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500',
                            isUrlField(fieldName) && formData[fieldName] && !isValidUrl(formData[fieldName]) ? 'border-red-500' : '',
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
                  <div v-else-if="row.type === 'full'" class="w-full">
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
                      <label
                        class="block text-sm font-medium mb-1 flex items-center justify-between"
                        :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
                      >
                        <span>
                          {{ getFieldLabel(row.field) }}
                          <span v-if="isFieldRequiredOnCreate(row.field)" class="text-red-500">*</span>
                        </span>
                        <button
                          v-if="isS3SecretField(row.field) || isWebDavPasswordField(row.field)"
                          type="button"
                          @click="handleSecretToggle(row.field)"
                          class="ml-2 inline-flex items-center px-2 py-1 rounded text-xs"
                          :class="darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                          :disabled="isSecretRevealing(row.field)"
                        >
                          <svg
                            v-if="!isSecretRevealing(row.field) && !isSecretVisible(row.field)"
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            <circle cx="12" cy="12" r="3" stroke-width="2" />
                          </svg>
                          <svg
                            v-else-if="!isSecretRevealing(row.field) && isSecretVisible(row.field)"
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a10.05 10.05 0 013.47-5.23M6.1 6.1C7.93 5.103 9.91 4.5 12 4.5c4.477 0 8.268 2.943 9.542 7-.337 1.075-.84 2.08-1.48 2.985M3 3l18 18" />
                          </svg>
                          <svg v-else class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        </button>
                      </label>
                      <input
                        :type="getSecretInputType(row.field)"
                        :id="row.field"
                        v-model="formData[row.field]"
                        :required="isFieldRequiredOnCreate(row.field) && !isEdit"
                        :placeholder="getFieldPlaceholder(row.field)"
                        autocomplete="new-password"
                        class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                        :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                      />
                      <p v-if="getFieldDescription(row.field)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
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
                        :placeholder="getFieldPlaceholder(row.field)"
                        @blur="handleFieldBlur(row.field)"
                        class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                        :class="[
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500',
                          isUrlField(row.field) && formData[row.field] && !isValidUrl(formData[row.field]) ? 'border-red-500' : '',
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
          <svg v-if="loading" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {{ loading ? "保存中..." : "保存配置" }}
        </button>
      </div>
    </div>
  </div>
</template>
