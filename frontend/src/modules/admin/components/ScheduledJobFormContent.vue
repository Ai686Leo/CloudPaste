<script setup>
/**
 * 定时任务表单内容组件 - 页面级设计
 */
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import cronstrue from "cronstrue/i18n";
import DynamicFormField from "./DynamicFormField.vue";
import SyncTaskConfigForm from "./SyncTaskConfigForm.vue";

const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  job: {
    type: Object,
    default: null,
  },
  isEdit: {
    type: Boolean,
    default: false,
  },
  handlerTypes: {
    type: Array,
    default: () => [],
  },
  submitting: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["submit", "cancel"]);

const { t, locale } = useI18n();

// 状态
const loading = ref(false);
const error = ref("");

// 配置模式（form: 表单模式, json: JSON模式）
const configMode = ref("form");

// 表单数据
const formData = ref({
  taskId: "",
  handlerId: "",
  name: "",
  description: "",
  scheduleType: "interval",
  intervalSec: 3600,
  cronExpression: "",
  enabled: true,
  config: {},
});

// 间隔值和单位
const intervalValue = ref(1);
const intervalUnit = ref(3600);

// JSON配置文本
const configText = ref("{}");
const configError = ref("");

// 时间单位选项
const timeUnits = [
  { value: 60, label: "minutes" },
  { value: 3600, label: "hours" },
  { value: 86400, label: "days" },
];

// 当前选中的handler类型
const currentHandlerType = computed(() => {
  if (!formData.value.handlerId) return null;
  return props.handlerTypes.find((h) => h.id === formData.value.handlerId) || null;
});

// 类别标签样式
const getCategoryClass = (category) => {
  if (category === "maintenance") {
    return props.darkMode
      ? "bg-blue-900/40 text-blue-300"
      : "bg-blue-100 text-blue-700";
  }
  return props.darkMode
    ? "bg-purple-900/40 text-purple-300"
    : "bg-purple-100 text-purple-700";
};

// 类别显示文本
const getCategoryLabel = (category) => {
  return category === "maintenance"
    ? t("admin.scheduledJobs.handlerType.category.maintenance")
    : t("admin.scheduledJobs.handlerType.category.business");
};

// 解析 cron 表达式为人类可读文本
const getCronDescription = (cronExpression) => {
  if (!cronExpression) return '-';
  try {
    const lang = locale.value === 'zh-CN' ? 'zh_CN' : 'en';
    return cronstrue.toString(cronExpression, { locale: lang });
  } catch (error) {
    console.warn('解析 cron 表达式失败:', error);
    return '无法解析 cron 表达式';
  }
};

// 监听间隔值和单位变化
watch([intervalValue, intervalUnit], ([value, unit]) => {
  formData.value.intervalSec = value * unit;
});

// 监听configText变化（JSON模式 → 表单数据）
watch(configText, (newVal) => {
  if (configMode.value !== "json") return;
  try {
    if (!newVal.trim()) {
      formData.value.config = {};
      configError.value = "";
      return;
    }
    formData.value.config = JSON.parse(newVal);
    configError.value = "";
  } catch (e) {
    configError.value = t("admin.scheduledJobs.validation.configInvalidJson");
  }
});

// 监听config变化（表单数据 → JSON文本）
watch(
  () => formData.value.config,
  (newConfig) => {
    if (configMode.value !== "form") return;
    configText.value = JSON.stringify(newConfig || {}, null, 2);
  },
  { deep: true }
);

// 重置表单函数
const resetForm = () => {
  formData.value = {
    taskId: "",
    handlerId: "",
    name: "",
    description: "",
    scheduleType: "interval",
    intervalSec: 3600,
    cronExpression: "",
    enabled: true,
    config: {},
  };
  intervalValue.value = 1;
  intervalUnit.value = 3600;
  configText.value = "{}";
  configError.value = "";
  configMode.value = "form";
  error.value = "";
};

// 切换配置模式时同步数据
watch(configMode, (newMode) => {
  if (newMode === "json") {
    configText.value = JSON.stringify(formData.value.config || {}, null, 2);
  } else {
    try {
      formData.value.config = JSON.parse(configText.value || "{}");
      configError.value = "";
    } catch (e) {
      // 保持原有config
    }
  }
});

// 监听job prop变化（编辑模式）
watch(
  () => props.job,
  (newJob) => {
    if (newJob) {
      formData.value = {
        taskId: newJob.taskId,
        handlerId: newJob.handlerId,
        name: newJob.name || "",
        description: newJob.description || "",
        scheduleType: newJob.scheduleType || "interval",
        intervalSec: newJob.intervalSec,
        cronExpression: newJob.cronExpression || "",
        enabled: newJob.enabled,
        config: newJob.config || {},
      };

      // 转换intervalSec为合适的单位
      const sec = newJob.intervalSec;
      if (sec % 86400 === 0) {
        intervalValue.value = sec / 86400;
        intervalUnit.value = 86400;
      } else if (sec % 3600 === 0) {
        intervalValue.value = sec / 3600;
        intervalUnit.value = 3600;
      } else if (sec % 60 === 0) {
        intervalValue.value = sec / 60;
        intervalUnit.value = 60;
      } else {
        intervalValue.value = Math.ceil(sec / 60);
        intervalUnit.value = 60;
      }

      configText.value = JSON.stringify(newJob.config || {}, null, 2);
    } else {
      resetForm();
    }
  },
  { immediate: true }
);

// 初始化配置默认值（选择handler后）
watch(() => formData.value.handlerId, (newHandlerId) => {
  if (!newHandlerId || props.isEdit) return;
  const handler = props.handlerTypes.find(h => h.id === newHandlerId);
  if (!handler) return;

  const schema = handler.configSchema || [];
  const config = {};
  for (const field of schema) {
    if (field.defaultValue !== undefined) {
      config[field.name] = field.defaultValue;
    }
  }
  formData.value.config = config;
  configText.value = JSON.stringify(config, null, 2);
});

// 表单验证
const handlerValid = computed(() => !!formData.value.handlerId && !!currentHandlerType.value);

const configValid = computed(() => {
  if (configError.value) return false;

  // 同步任务专用验证：必须至少有一组有效的源路径和目标路径
  if (formData.value.handlerId === 'scheduled_sync_copy') {
    const config = formData.value.config || {};

    // 检查 pairs 数组模式
    if (Array.isArray(config.pairs) && config.pairs.length > 0) {
      // 至少有一个有效的路径对
      const hasValidPair = config.pairs.some(pair =>
        pair &&
        typeof pair.sourcePath === 'string' &&
        typeof pair.targetPath === 'string' &&
        pair.sourcePath.trim() &&
        pair.targetPath.trim()
      );
      return hasValidPair;
    }

    // 检查单路径模式
    if (
      typeof config.sourcePath === 'string' &&
      typeof config.targetPath === 'string' &&
      config.sourcePath.trim() &&
      config.targetPath.trim()
    ) {
      return true;
    }

    // 没有有效配置
    return false;
  }

  // 其他任务类型：检查 configSchema 中的 required 字段
  const schema = currentHandlerType.value?.configSchema || [];
  for (const field of schema) {
    if (field.required) {
      const value = formData.value.config[field.name];
      if (value === undefined || value === null || value === "") {
        return false;
      }
    }
  }
  return true;
});

const scheduleValid = computed(() => {
  const type = formData.value.scheduleType || "interval";
  if (type === "interval") {
    return Number(formData.value.intervalSec) >= 60;
  }
  if (type === "cron") {
    return !!formData.value.cronExpression;
  }
  return false;
});

// Cron 表达式人类可读提示
const cronHint = computed(() => {
  const expr = (formData.value.cronExpression || "").trim();
  if (!expr) {
    return t("admin.scheduledJobs.form.cronExample");
  }

  try {
    const currentLocale = (locale.value || "zh-CN").toLowerCase();
    const cronLocale = currentLocale.startsWith("zh") ? "zh_CN" : "en";
    return cronstrue.toString(expr, {
      locale: cronLocale,
      use24HourTimeFormat: true,
    });
  } catch (e) {
    return t("admin.scheduledJobs.form.cronExample");
  }
});

// 整体表单验证
const formValid = computed(() => {
  return handlerValid.value && configValid.value && scheduleValid.value;
});

// 更新配置字段值
const updateConfigField = (fieldName, value) => {
  formData.value.config = {
    ...formData.value.config,
    [fieldName]: value,
  };
};

// 提交
const handleSubmit = () => {
  if (!formValid.value || configError.value) {
    return;
  }

  const payload = {
    handlerId: formData.value.handlerId,
    name: formData.value.name,
    description: formData.value.description,
    scheduleType: formData.value.scheduleType,
    intervalSec:
      formData.value.scheduleType === "interval"
        ? formData.value.intervalSec
        : undefined,
    cronExpression:
      formData.value.scheduleType === "cron"
        ? formData.value.cronExpression
        : undefined,
    enabled: formData.value.enabled,
    config: formData.value.config,
  };

  if (props.isEdit) {
    payload.taskId = formData.value.taskId;
  }

  emit("submit", payload);
};

// 取消
const handleCancel = () => {
  emit("cancel");
};
</script>

<template>
  <div class="scheduled-job-form flex-1 flex flex-col min-h-0">
    <!-- 错误提示 -->
    <div
      v-if="error"
      class="mb-4 p-3 rounded-md text-sm font-medium"
      :class="darkMode ? 'bg-red-900/30 text-red-300' : 'bg-red-100 text-red-700'"
    >
      {{ error }}
    </div>

    <!-- 主内容区：垂直分区布局 -->
    <div class="flex-1 flex flex-col gap-6 min-h-0 overflow-y-auto pb-4">

      <!-- ========== 顶部区域：三列对称布局 ========== -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">

        <!-- 第一列：任务类型选择 -->
        <section
          class="rounded-lg border"
          :class="darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'"
        >
          <div
            class="px-4 py-3 border-b"
            :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
          >
            <h3 class="text-sm font-semibold flex items-center gap-2" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
              <span
                class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                :class="handlerValid
                  ? 'bg-green-500 text-white'
                  : (darkMode ? 'bg-gray-600 text-gray-300' : 'bg-gray-200 text-gray-600')"
              >
                <svg v-if="handlerValid" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                <span v-else>1</span>
              </span>
              {{ t("admin.scheduledJobs.handlerType.title") }}
            </h3>
          </div>

          <div class="p-4 space-y-4">
            <!-- Handler类型选择器 -->
            <div>
              <label
                class="block text-sm font-medium mb-2"
                :class="darkMode ? 'text-gray-300' : 'text-gray-700'"
              >
                {{ t("admin.scheduledJobs.handlerType.select") }}
                <span class="text-red-500 ml-1">*</span>
              </label>

              <!-- 编辑模式：只读显示 -->
              <div
                v-if="isEdit"
                class="px-3 py-2 rounded-md text-sm border"
                :class="darkMode
                  ? 'bg-gray-700/50 border-gray-600 text-gray-300'
                  : 'bg-gray-50 border-gray-200 text-gray-700'"
              >
                {{ currentHandlerType?.name || formData.handlerId }}
              </div>

              <!-- 创建模式：可选择 -->
              <select
                v-else
                v-model="formData.handlerId"
                class="w-full px-3 py-2 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                :class="darkMode
                  ? 'bg-gray-700 border-gray-600 text-gray-100'
                  : 'bg-white border-gray-300 text-gray-900'"
              >
                <option value="">{{ t("admin.scheduledJobs.handlerType.selectPlaceholder") }}</option>
                <option v-for="handler in handlerTypes" :key="handler.id" :value="handler.id">
                  {{ handler.name }}
                </option>
              </select>
            </div>

            <!-- 选中的handler详情 -->
            <div
              v-if="currentHandlerType"
              class="p-3 rounded-md"
              :class="darkMode ? 'bg-gray-700/30' : 'bg-gray-50'"
            >
              <div class="flex items-center gap-2 mb-2">
                <span
                  class="text-xs px-2 py-0.5 rounded-full font-medium"
                  :class="getCategoryClass(currentHandlerType.category)"
                >
                  {{ getCategoryLabel(currentHandlerType.category) }}
                </span>
              </div>
              <p class="text-sm leading-relaxed" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
                {{ currentHandlerType.description }}
              </p>
            </div>
          </div>
        </section>

        <!-- 第二列：基本信息 -->
        <section
          class="rounded-lg border"
          :class="darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'"
        >
          <div
            class="px-4 py-3 border-b"
            :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
          >
            <h3 class="text-sm font-semibold flex items-center gap-2" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
              <svg class="w-4 h-4" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {{ t("admin.scheduledJobs.form.name") }} &amp; {{ t("admin.scheduledJobs.form.description") }}
            </h3>
          </div>

          <div class="p-4 space-y-4">
            <!-- 任务名称 -->
            <div>
              <label
                class="block text-sm font-medium mb-1.5"
                :class="darkMode ? 'text-gray-300' : 'text-gray-700'"
              >
                {{ t("admin.scheduledJobs.form.name") }}
              </label>
              <input
                v-model="formData.name"
                type="text"
                :placeholder="t('admin.scheduledJobs.form.namePlaceholder')"
                class="w-full px-3 py-2 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                :class="darkMode
                  ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                  : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
              />
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                {{ t("admin.scheduledJobs.form.nameHint") }}
              </p>
            </div>

            <!-- 任务描述 -->
            <div>
              <label
                class="block text-sm font-medium mb-1.5"
                :class="darkMode ? 'text-gray-300' : 'text-gray-700'"
              >
                {{ t("admin.scheduledJobs.form.description") }}
              </label>
              <textarea
                v-model="formData.description"
                rows="3"
                :placeholder="t('admin.scheduledJobs.form.descriptionPlaceholder')"
                class="w-full px-3 py-2 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                :class="darkMode
                  ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                  : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
              ></textarea>
            </div>
          </div>
        </section>

        <!-- 第三列：执行计划 -->
        <section
          class="rounded-lg border"
          :class="darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'"
        >
          <div
            class="px-4 py-3 border-b"
            :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
          >
            <h3 class="text-sm font-semibold flex items-center gap-2" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
              <span
                class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                :class="scheduleValid
                  ? 'bg-green-500 text-white'
                  : (darkMode ? 'bg-gray-600 text-gray-300' : 'bg-gray-200 text-gray-600')"
              >
                <svg v-if="scheduleValid" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                <span v-else>3</span>
              </span>
              {{ t("admin.scheduledJobs.form.step3Title") }}
            </h3>
          </div>

          <div class="p-4 space-y-4">
            <!-- 调度类型 -->
            <div>
              <label
                class="block text-sm font-medium mb-1.5"
                :class="darkMode ? 'text-gray-300' : 'text-gray-700'"
              >
                {{ t("admin.scheduledJobs.form.scheduleType") }}
              </label>
              <div class="flex gap-2">
                <button
                  type="button"
                  @click="formData.scheduleType = 'interval'"
                  class="flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors border"
                  :class="formData.scheduleType === 'interval'
                    ? 'bg-primary-500 text-white border-primary-500'
                    : (darkMode ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50')"
                >
                  {{ t("admin.scheduledJobs.form.scheduleTypeInterval") }}
                </button>
                <button
                  type="button"
                  @click="formData.scheduleType = 'cron'"
                  class="flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors border"
                  :class="formData.scheduleType === 'cron'
                    ? 'bg-primary-500 text-white border-primary-500'
                    : (darkMode ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50')"
                >
                  {{ t("admin.scheduledJobs.form.scheduleTypeCron") }}
                </button>
              </div>
            </div>

            <!-- 执行间隔 -->
            <div v-if="formData.scheduleType === 'interval'">
              <label
                class="block text-sm font-medium mb-1.5"
                :class="darkMode ? 'text-gray-300' : 'text-gray-700'"
              >
                {{ t("admin.scheduledJobs.form.intervalSec") }}
                <span class="text-red-500 ml-1">*</span>
              </label>
              <div class="flex gap-2">
                <input
                  v-model.number="intervalValue"
                  type="number"
                  min="1"
                  class="flex-1 px-3 py-2 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  :class="darkMode
                    ? 'bg-gray-700 border-gray-600 text-gray-100'
                    : 'bg-white border-gray-300 text-gray-900'"
                />
                <select
                  v-model="intervalUnit"
                  class="px-3 py-2 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  :class="darkMode
                    ? 'bg-gray-700 border-gray-600 text-gray-100'
                    : 'bg-white border-gray-300 text-gray-900'"
                >
                  <option v-for="unit in timeUnits" :key="unit.value" :value="unit.value">
                    {{ t(`admin.scheduledJobs.timeUnit.${unit.label}`) }}
                  </option>
                </select>
              </div>
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                {{ t("admin.scheduledJobs.form.intervalHint") }}
              </p>
            </div>

            <!-- Cron 表达式 -->
            <div v-if="formData.scheduleType === 'cron'">
              <label
                class="block text-sm font-medium mb-1.5"
                :class="darkMode ? 'text-gray-300' : 'text-gray-700'"
              >
                Cron {{ t("admin.scheduledJobs.form.scheduleTypeCron") }}
                <span class="text-red-500 ml-1">*</span>
              </label>
              <input
                v-model="formData.cronExpression"
                type="text"
                class="w-full px-3 py-2 rounded-md border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                :class="darkMode
                  ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                  : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
                placeholder="0 2 * * *"
              />
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                {{ cronHint }}
              </p>
            </div>

            <!-- 启用状态 -->
            <div class="flex items-center justify-between pt-2">
              <span class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ t("admin.scheduledJobs.form.enabledLabel") }}
              </span>
              <button
                type="button"
                @click="formData.enabled = !formData.enabled"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                :class="[
                  formData.enabled ? 'bg-primary-500' : (darkMode ? 'bg-gray-600' : 'bg-gray-300'),
                  darkMode ? 'focus:ring-offset-gray-800' : ''
                ]"
                role="switch"
                :aria-checked="formData.enabled"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="formData.enabled ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>
          </div>
        </section>
      </div>

      <!-- ========== 底部区域：配置参数（全宽） ========== -->
      <section
        class="rounded-lg border flex-1 flex flex-col min-h-[400px]"
        :class="darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'"
      >
        <div
          class="px-4 py-3 border-b flex items-center justify-between flex-shrink-0"
          :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
        >
          <h3 class="text-sm font-semibold flex items-center gap-2" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
            <span
              class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
              :class="configValid
                ? 'bg-green-500 text-white'
                : (darkMode ? 'bg-gray-600 text-gray-300' : 'bg-gray-200 text-gray-600')"
            >
              <svg v-if="configValid" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              <span v-else>2</span>
            </span>
            {{ t("admin.scheduledJobs.form.configParams") }}
          </h3>

          <!-- 模式切换 -->
          <div class="flex rounded-md overflow-hidden border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
            <button
              type="button"
              @click="configMode = 'form'"
              class="px-3 py-1 text-xs font-medium transition"
              :class="configMode === 'form'
                ? 'bg-primary-500 text-white'
                : (darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')"
            >
              {{ t("admin.scheduledJobs.form.modeForm") }}
            </button>
            <button
              type="button"
              @click="configMode = 'json'"
              class="px-3 py-1 text-xs font-medium transition"
              :class="configMode === 'json'
                ? 'bg-primary-500 text-white'
                : (darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')"
            >
              {{ t("admin.scheduledJobs.form.modeJson") }}
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <!-- 未选择任务类型提示 -->
          <div
            v-if="!formData.handlerId"
            class="h-full flex flex-col items-center justify-center text-center py-12"
          >
            <svg class="w-16 h-16 mb-4" :class="darkMode ? 'text-gray-600' : 'text-gray-300'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p class="text-sm" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ t("admin.scheduledJobs.handlerType.selectPlaceholder") }}
            </p>
          </div>

          <!-- 同步任务专用配置 -->
          <SyncTaskConfigForm
            v-else-if="configMode === 'form' && formData.handlerId === 'scheduled_sync_copy'"
            v-model="formData.config"
            :dark-mode="darkMode"
          />

          <!-- 其他任务类型：表单模式 -->
          <div v-else-if="configMode === 'form'" class="space-y-4">
            <DynamicFormField
              v-for="field in currentHandlerType?.configSchema || []"
              :key="field.name"
              :field="field"
              :model-value="formData.config[field.name]"
              :dark-mode="darkMode"
              @update:model-value="updateConfigField(field.name, $event)"
            />
            <div
              v-if="!currentHandlerType?.configSchema?.length"
              class="flex flex-col items-center justify-center py-12 text-center"
            >
              <svg class="w-12 h-12 mb-3" :class="darkMode ? 'text-gray-600' : 'text-gray-300'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.scheduledJobs.form.noConfigParams") }}
              </p>
            </div>
          </div>

          <!-- JSON模式 -->
          <div v-else class="h-full flex flex-col">
            <textarea
              v-model="configText"
              class="flex-1 w-full px-3 py-2 rounded-md border text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 min-h-[300px]"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
              :placeholder="t('admin.scheduledJobs.form.configPlaceholder')"
            ></textarea>
            <p v-if="configError" class="mt-2 text-xs text-red-500">
              {{ configError }}
            </p>
          </div>
        </div>
      </section>
    </div>

    <!-- 底部操作栏 -->
    <div
      class="flex-shrink-0 mt-4 pt-4 border-t"
      :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
    >
      <!-- 移动端：垂直堆叠布局 -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <!-- 验证状态摘要 - 移动端精简显示 -->
        <div class="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm overflow-x-auto">
          <div class="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
            <span
              class="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full"
              :class="handlerValid ? 'bg-green-500' : 'bg-gray-400'"
            ></span>
            <span :class="darkMode ? 'text-gray-400' : 'text-gray-500'" class="whitespace-nowrap">
              {{ t("admin.scheduledJobs.handlerType.title") }}
            </span>
          </div>
          <div class="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
            <span
              class="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full"
              :class="configValid ? 'bg-green-500' : 'bg-gray-400'"
            ></span>
            <span :class="darkMode ? 'text-gray-400' : 'text-gray-500'" class="whitespace-nowrap">
              {{ t("admin.scheduledJobs.form.configParams") }}
            </span>
          </div>
          <div class="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
            <span
              class="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full"
              :class="scheduleValid ? 'bg-green-500' : 'bg-gray-400'"
            ></span>
            <span :class="darkMode ? 'text-gray-400' : 'text-gray-500'" class="whitespace-nowrap">
              {{ t("admin.scheduledJobs.form.step3Title") }}
            </span>
          </div>
        </div>

        <!-- 操作按钮 - 移动端全宽 -->
        <div class="flex gap-2 sm:gap-3">
          <button
            type="button"
            @click="handleCancel"
            class="flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition border"
            :class="darkMode
              ? 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-200'
              : 'border-gray-300 bg-white hover:bg-gray-50 text-gray-700'"
          >
            {{ t("admin.scheduledJobs.form.cancel") }}
          </button>

          <button
            type="button"
            @click="handleSubmit"
            :disabled="!formValid || submitting"
            class="flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-md text-sm font-medium transition bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            <svg v-if="submitting" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {{ isEdit ? t("admin.scheduledJobs.form.save") : t("admin.scheduledJobs.form.create") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scheduled-job-form {
  /* 确保表单内容可以充分利用页面空间 */
}
</style>
