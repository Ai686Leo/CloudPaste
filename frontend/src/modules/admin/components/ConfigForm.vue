<script setup>
import { ref, computed, watch } from "vue";
import { useAdminStorageConfigService } from "@/modules/admin/services/storageConfigService.js";
import {
  STORAGE_TYPES,
  STORAGE_UNITS,
  STORAGE_TYPE_OPTIONS,
  S3_PROVIDER_TYPES,
  getAdminStorageStrategy,
} from "@/modules/storage-core/schema/adminStorageSchemas.js";

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

// 表单数据
const currentStorageType = ref(STORAGE_TYPES.S3);
const formData = ref(getAdminStorageStrategy(STORAGE_TYPES.S3).createDefaultFormState());

// 存储容量相关变量
const storageSize = ref("");
const storageUnit = ref(1024 * 1024 * 1024);
const storageUnits = STORAGE_UNITS;

const storageTypes = STORAGE_TYPE_OPTIONS;
const providerTypes = S3_PROVIDER_TYPES;

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
const isS3Type = computed(() => formData.value.storage_type === STORAGE_TYPES.S3);
const isWebDavType = computed(() => formData.value.storage_type === STORAGE_TYPES.WEBDAV);

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
      if (!url.endsWith("/")) {
        url = `${url}/`;
      }
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

const normalizeDefaultFolder = (value) => {
  if (!value) return "";
  return value.toString().replace(/^\/+/, "");
};

const buildPayload = () => {
  const base = {
    name: formData.value.name,
    storage_type: formData.value.storage_type,
    is_public: formData.value.is_public,
    total_storage_bytes: formData.value.total_storage_bytes,
  };

  if (isS3Type.value) {
    return {
      ...base,
      provider_type: formData.value.provider_type,
      endpoint_url: formData.value.endpoint_url,
      bucket_name: formData.value.bucket_name,
      region: formData.value.region,
      access_key_id: formData.value.access_key_id,
      secret_access_key: formData.value.secret_access_key,
      path_style: formData.value.path_style,
      default_folder: normalizeDefaultFolder(formData.value.default_folder),
      custom_host: formData.value.custom_host || "",
      signature_expires_in: formData.value.signature_expires_in,
    };
  }

  if (isWebDavType.value) {
    return {
      ...base,
      endpoint_url: formData.value.endpoint_url,
      username: formData.value.username,
      password: formData.value.password,
      default_folder: normalizeDefaultFolder(formData.value.default_folder),
      tls_insecure_skip_verify: formData.value.tls_insecure_skip_verify,
      custom_host: formData.value.custom_host || "",
    };
  }

  return base;
};

// URL格式验证
const isValidUrl = (url) => {
  if (!url) return true; // 空值由required验证处理
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === "https:" || urlObj.protocol === "http:";
  } catch {
    return false;
  }
};

// 表单验证
const formValid = computed(() => {
  const hasName = Boolean(formData.value.name && formData.value.name.trim());
  if (!hasName || !formData.value.storage_type) {
    return false;
  }

  if (isS3Type.value) {
    const s3FieldsValid = formData.value.provider_type && formData.value.endpoint_url && formData.value.bucket_name;
    const urlValid = isValidUrl(formData.value.endpoint_url) && isValidUrl(formData.value.custom_host);

    if (props.isEdit) {
      return s3FieldsValid && urlValid;
    }

    return s3FieldsValid && urlValid && formData.value.access_key_id && formData.value.secret_access_key;
  }

  if (isWebDavType.value) {
    const urlValid = formData.value.endpoint_url && isValidUrl(formData.value.endpoint_url);
    const customHostValid = isValidUrl(formData.value.custom_host);
    const passwordOk = props.isEdit ? true : Boolean(formData.value.password);
    return urlValid && customHostValid && formData.value.username && passwordOk;
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
      const type = config.storage_type || STORAGE_TYPES.S3;
      currentStorageType.value = type;
      const strategy = getAdminStorageStrategy(type);
      formData.value = strategy.createDefaultFormState();
      strategy.hydrateFormFromConfig(formData.value, config);

      const sizeState = { storageSize: "", storageUnit: storageUnit.value };
      strategy.setStorageSizeFromBytes(formData.value.total_storage_bytes, sizeState);
      storageSize.value = sizeState.storageSize;
      storageUnit.value = sizeState.storageUnit;
    } else {
      const type = STORAGE_TYPES.S3;
      currentStorageType.value = type;
      const strategy = getAdminStorageStrategy(type);
      formData.value = strategy.createDefaultFormState();
      formData.value.total_storage_bytes = strategy.getDefaultStorageByProvider(
        formData.value.provider_type || "Cloudflare R2"
      );
      const sizeState = { storageSize: "", storageUnit: storageUnit.value };
      strategy.setStorageSizeFromBytes(formData.value.total_storage_bytes, sizeState);
      storageSize.value = sizeState.storageSize;
      storageUnit.value = sizeState.storageUnit;
    }
  },
  { immediate: true }
);

// 监听provider_type变化，自动设置默认存储容量
watch(
  () => formData.value.provider_type,
  (newProvider) => {
    if (!formData.value.total_storage_bytes) {
      const strategy = getAdminStorageStrategy(STORAGE_TYPES.S3);
      const defaultBytes = strategy.getDefaultStorageByProvider(newProvider);
      formData.value.total_storage_bytes = defaultBytes;
      const sizeState = { storageSize: "", storageUnit: storageUnit.value };
      strategy.setStorageSizeFromBytes(defaultBytes, sizeState);
      storageSize.value = sizeState.storageSize;
      storageUnit.value = sizeState.storageUnit;
    }
  }
);

watch(
  () => formData.value.storage_type,
  (type) => {
    if (type === "WEBDAV") {
      formData.value.provider_type = "";
      formData.value.bucket_name = "";
      formData.value.region = "";
      formData.value.path_style = false;
      formData.value.signature_expires_in = null;
      formData.value.access_key_id = "";
      formData.value.secret_access_key = "";
      formData.value.username = formData.value.username || "";
      formData.value.password = "";
      formData.value.default_folder = formData.value.default_folder || "";
    } else if (type === "S3") {
      formData.value.provider_type = formData.value.provider_type || "Cloudflare R2";
      formData.value.signature_expires_in = formData.value.signature_expires_in || 3600;
    }
  }
);

// 监听存储大小和单位的变化
watch([storageSize, storageUnit], () => {
  const strategy = getAdminStorageStrategy(formData.value.storage_type);
  formData.value.total_storage_bytes = strategy.calculateStorageBytes({
    storageSize: storageSize.value,
    storageUnit: storageUnit.value,
  });
});

// 提交表单
const submitForm = async () => {
  const strategy = getAdminStorageStrategy(formData.value.storage_type);
  const { valid, message } = strategy.validate(formData.value, props.isEdit);
  if (!valid) {
    error.value = message || "请填写所有必填字段";
    return;
  }

  loading.value = true;
  error.value = "";
  success.value = "";

  try {
    let savedConfig;
    const stateForPayload = {
      ...formData.value,
      storageSize: storageSize.value,
      storageUnit: storageUnit.value,
    };
    if (props.isEdit && props.config?.id) {
      const updateData = { ...strategy.buildPayload(stateForPayload) };

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
      savedConfig = await createStorageConfig(strategy.buildPayload(stateForPayload));
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
                class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900'"
              >
                <option v-for="type in storageTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
              </select>
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">支持 S3 兼容对象存储和 WebDAV 存储</p>
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
                class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                placeholder="例如：我的备份存储"
              />
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">为此配置指定一个易于识别的名称</p>
            </div>

            <div>
              <label for="storage_size" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 存储容量限制 </label>
              <div class="flex space-x-2">
                <input
                  type="number"
                  id="storage_size"
                  v-model="storageSize"
                  min="0"
                  step="0.01"
                  class="block w-2/3 px-3 py-2 rounded-md text-sm transition-colors duration-200"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                  placeholder="例如：10"
                />
                <select
                  v-model="storageUnit"
                  class="block w-1/3 px-3 py-2 rounded-md text-sm transition-colors duration-200"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900'"
                >
                  <option v-for="unit in storageUnits" :key="unit.value" :value="unit.value">{{ unit.label }}</option>
                </select>
              </div>
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ formData.provider_type === "Cloudflare R2" ? "默认为10GB" : formData.provider_type === "Backblaze B2" ? "默认为10GB" : "默认为5GB" }}
              </p>
            </div>

            <div v-if="isS3Type" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="provider_type" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  提供商类型 <span class="text-red-500">*</span>
                </label>
                <select
                  id="provider_type"
                  v-model="formData.provider_type"
                  required
                  class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900'"
                >
                  <option v-for="provider in providerTypes" :key="provider.value" :value="provider.value">
                    {{ provider.label }}
                  </option>
                </select>
              </div>

              <div>
                <label for="bucket_name" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  存储桶名称 <span class="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="bucket_name"
                  v-model="formData.bucket_name"
                  required
                  @blur="formatBucketName"
                  class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                  placeholder="my-bucket"
                />
              </div>
            </div>

            <div v-else-if="isWebDavType" class="space-y-3">
              <div>
                <label for="endpoint_url" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  WebDAV 端点 <span class="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="webdav_endpoint_url"
                  v-model="formData.endpoint_url"
                  required
                  @blur="formatUrl('endpoint_url')"
                  class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                  :class="[
                    darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500',
                    formData.endpoint_url && !isValidUrl(formData.endpoint_url) ? 'border-red-500' : '',
                  ]"
                  placeholder="https://dav.example.com/dav/"
                />
                <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">需包含协议与路径前缀，末尾建议保留斜杠</p>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="username" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                    用户名 <span class="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="username"
                    v-model="formData.username"
                    required
                    @blur="trimInput('username')"
                    class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                    :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                    placeholder="dav-user"
                  />
                </div>

                <div>
                  <label for="password" class="block text-sm font-medium mb-1 flex items-center justify-between" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                    <span>密码 <span class="text-red-500" v-if="!isEdit">*</span></span>
                    <button
                      type="button"
                      @click="toggleWebDavPasswordReveal"
                      class="ml-2 inline-flex items-center px-2 py-1 rounded text-xs"
                      :class="darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                      :title="showWebDavPassword ? '隐藏密码' : '显示密码'"
                      :disabled="revealingWebDav"
                    >
                      <svg v-if="!revealingWebDav && !showWebDavPassword" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        <circle cx="12" cy="12" r="3" stroke-width="2" />
                      </svg>
                      <svg v-else-if="!revealingWebDav && showWebDavPassword" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a10.05 10.05 0 013.47-5.23M6.1 6.1C7.93 5.103 9.91 4.5 12 4.5c4.477 0 8.268 2.943 9.542 7-.337 1.075-.84 2.08-1.48 2.985M3 3l18 18" />
                      </svg>
                      <svg v-else class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </button>
                  </label>
                  <input
                    :type="showWebDavPassword ? 'text' : 'password'"
                    id="password"
                    v-model="formData.password"
                    :required="!isEdit"
                    autocomplete="new-password"
                    class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                    :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                    placeholder="••••••••"
                  />
                  <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">编辑时留空表示不修改密码</p>
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="webdav_default_folder" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                    默认上传路径
                  </label>
                  <input
                    type="text"
                    id="webdav_default_folder"
                    v-model="formData.default_folder"
                    @blur="trimInput('default_folder')"
                    class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                    :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                    placeholder="如：cloudpaste/"
                  />
                  <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">相对 endpoint 的子目录，不以 / 开头，末尾可不填斜杠</p>
                </div>

                <div>
                  <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">TLS 校验证书</label>
                  <div class="flex items-center h-10 px-3 py-2 rounded-md border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                    <input
                      type="checkbox"
                      id="tls_skip"
                      v-model="formData.tls_insecure_skip_verify"
                      class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                    />
                    <label for="tls_skip" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 跳过自签证书校验 </label>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="rounded-md border border-dashed p-3 text-xs" :class="darkMode ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-600'">
              当前存储类型表单未定义，请选择已支持的类型。
            </div>
          </div>

          <!-- 连接配置 -->
          <div class="space-y-4" v-if="isS3Type">
            <h3 class="text-sm font-medium border-b pb-2" :class="darkMode ? 'text-gray-200 border-gray-600' : 'text-gray-700 border-gray-200'">连接配置</h3>

            <div>
              <label for="endpoint_url" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                端点URL <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="endpoint_url"
                v-model="formData.endpoint_url"
                required
                @blur="formatUrl('endpoint_url')"
                class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                :class="[
                  darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500',
                  formData.endpoint_url && !isValidUrl(formData.endpoint_url) ? 'border-red-500' : '',
                ]"
                placeholder="https://endpoint.example.com"
              />
              <p v-if="formData.endpoint_url && !isValidUrl(formData.endpoint_url)" class="mt-1 text-xs text-red-500">请输入有效的URL格式，如 https://xxx.com</p>
              <p v-else class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">S3 API的完整端点URL，例如：https://endpoint.example.com</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="region" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 区域 </label>
                <input
                  type="text"
                  id="region"
                  v-model="formData.region"
                  @blur="trimInput('region')"
                  class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                  placeholder="us-east-1"
                />
              </div>

              <div>
                <label for="default_folder" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 默认上传路径 </label>
                <input
                  type="text"
                  id="default_folder"
                  v-model="formData.default_folder"
                  @blur="trimInput('default_folder')"
                  class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                  placeholder="如：uploads/ ，留空表示根目录"
                />
              </div>
            </div>
          </div>

          <!-- 认证信息 -->
          <div class="space-y-4" v-if="isS3Type">
            <h3 class="text-sm font-medium border-b pb-2" :class="darkMode ? 'text-gray-200 border-gray-600' : 'text-gray-700 border-gray-200'">认证信息</h3>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="access_key_id" class="block text-sm font-medium mb-1 flex items-center justify-between" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  <span>访问密钥ID <span class="text-red-500">{{ !isEdit ? "*" : "" }}</span></span>
                  <button
                    v-if="isEdit"
                    type="button"
                    @click="toggleReveal"
                    class="ml-2 inline-flex items-center px-2 py-1 rounded text-xs"
                    :class="darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                    :title="showPlain ? '隐藏明文' : '显示明文'"
                  >
                    <svg v-if="!revealing && !showPlain" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      <circle cx="12" cy="12" r="3" stroke-width="2" />
                    </svg>
                    <svg v-else-if="!revealing && showPlain" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a10.05 10.05 0 013.47-5.23M6.1 6.1C7.93 5.103 9.91 4.5 12 4.5c4.477 0 8.268 2.943 9.542 7-.337 1.075-.84 2.08-1.48 2.985M3 3l18 18" />
                    </svg>
                    <svg v-else class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  </button>
                </label>
                <input
                  type="text"
                  id="access_key_id"
                  v-model="formData.access_key_id"
                  :required="!isEdit"
                  @blur="trimInput('access_key_id')"
                  class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                  placeholder="AKIAXXXXXXXXXXXXXXXX"
                />
                <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">访问密钥ID用于签名请求；编辑留空表示保持不变。</p>
              </div>

              <div>
                <label for="secret_access_key" class="block text-sm font-medium mb-1 flex items-center justify-between" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  <span>秘密访问密钥 <span class="text-red-500">{{ !isEdit ? "*" : "" }}</span></span>
                  <button
                    v-if="isEdit"
                    type="button"
                    @click="toggleReveal"
                    class="ml-2 inline-flex items-center px-2 py-1 rounded text-xs"
                    :class="darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                    :title="showPlain ? '隐藏明文' : '显示明文'"
                  >
                    <svg v-if="!revealing && !showPlain" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      <circle cx="12" cy="12" r="3" stroke-width="2" />
                    </svg>
                    <svg v-else-if="!revealing && showPlain" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a10.05 10.05 0 013.47-5.23M6.1 6.1C7.93 5.103 9.91 4.5 12 4.5c4.477 0 8.268 2.943 9.542 7-.337 1.075-.84 2.08-1.48 2.985M3 3l18 18" />
                    </svg>
                    <svg v-else class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  </button>
                </label>
                <input
                  :type="showPlain ? 'text' : 'password'"
                  id="secret_access_key"
                  autocomplete="new-password"
                  v-model="formData.secret_access_key"
                  :required="!isEdit"
                  @blur="trimInput('secret_access_key')"
                  class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                  placeholder="••••••••••••••••••••••••••••••"
                />
                <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">编辑留空表示保持不变。点击右侧小眼睛可按需显示掩码/明文（仅本次可见）。</p>
              </div>
            </div>
          </div>

          <!-- 高级配置 -->
          <div class="space-y-4" v-if="isS3Type">
            <h3 class="text-sm font-medium border-b pb-2" :class="darkMode ? 'text-gray-200 border-gray-600' : 'text-gray-700 border-gray-200'">高级配置</h3>

            <!-- 自定义域名 -->
            <div>
              <label for="custom_host" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 自定义HOST/CDN域名 </label>
              <input
                type="text"
                id="custom_host"
                v-model="formData.custom_host"
                @blur="formatUrl('custom_host')"
                class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                :class="[
                  darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500',
                  formData.custom_host && !isValidUrl(formData.custom_host) ? 'border-red-500' : '',
                ]"
                placeholder="https://cdn.example.com"
              />
              <p v-if="formData.custom_host && !isValidUrl(formData.custom_host)" class="mt-1 text-xs text-red-500">请输入有效的URL格式，如 https://xxx.com</p>
              <p v-else class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">可选：配置CDN加速域名或自定义域名，留空使用原始S3端点</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- 签名有效期 -->
              <div>
                <label for="signature_expires_in" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 签名有效期（秒） </label>
                <input
                  type="number"
                  id="signature_expires_in"
                  v-model="formData.signature_expires_in"
                  min="1"
                  class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                  placeholder="3600"
                />
                <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">控制预签名URL的默认有效期，默认3600秒</p>
              </div>
            </div>
          </div>

          <div class="space-y-4" v-if="isWebDavType">
            <h3 class="text-sm font-medium border-b pb-2" :class="darkMode ? 'text-gray-200 border-gray-600' : 'text-gray-700 border-gray-200'">高级配置</h3>

            <div>
              <label for="webdav_custom_host" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 自定义 HOST/外链域名 </label>
              <input
                type="text"
                id="webdav_custom_host"
                v-model="formData.custom_host"
                @blur="formatUrl('custom_host')"
                class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200"
                :class="[
                  darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500',
                  formData.custom_host && !isValidUrl(formData.custom_host) ? 'border-red-500' : '',
                ]"
                placeholder="https://files.example.com"
              />
              <p v-if="formData.custom_host && !isValidUrl(formData.custom_host)" class="mt-1 text-xs text-red-500">请输入有效的URL格式，如 https://xxx.com</p>
              <p v-else class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">可选：用于展示直链/代理外链，留空使用原端点。</p>
            </div>
          </div>

          <!-- 其他选项 -->
          <div class="space-y-4">
            <h3 class="text-sm font-medium border-b pb-2" :class="darkMode ? 'text-gray-200 border-gray-600' : 'text-gray-700 border-gray-200'">其他选项</h3>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- 路径样式：仅 S3 -->
              <div v-if="isS3Type">
                <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 访问样式 </label>
                <div class="flex items-center h-10 px-3 py-2 rounded-md border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                  <input
                    type="checkbox"
                    id="path_style"
                    v-model="formData.path_style"
                    class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                  />
                  <label for="path_style" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 使用路径样式访问 </label>
                </div>
                <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">使用 endpoint.com/bucket 格式</p>
              </div>

              <!-- API密钥权限 -->
              <div>
                <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> API密钥权限 </label>
                <div class="flex items-center h-10 px-3 py-2 rounded-md border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                  <input
                    type="checkbox"
                    id="is_public"
                    v-model="formData.is_public"
                    class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                  />
                  <label for="is_public" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 允许API密钥用户使用 </label>
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
