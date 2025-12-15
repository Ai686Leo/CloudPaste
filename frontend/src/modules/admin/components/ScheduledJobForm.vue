<script setup>
/**
 * 定时任务表单组件
 * - 3步创建流程：选择handler类型 → 配置参数 → 设置执行计划
 * - 支持表单模式和JSON模式切换
 * - 编辑模式跳过步骤1
 */
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import cronstrue from "cronstrue/i18n";
import { useScheduledJobs } from "@/modules/admin/composables/useScheduledJobs";
import DynamicFormField from "./DynamicFormField.vue";

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
});

const emit = defineEmits(["close", "success"]);

const { t, locale } = useI18n();
const { createJob, updateJob } = useScheduledJobs();

// 状态
const loading = ref(false);
const error = ref("");
const success = ref("");

// 步骤控制（1: 选择类型, 2: 配置参数, 3: 执行计划）
const step = ref(1);

// 配置模式（form: 表单模式, json: JSON模式）
const configMode = ref("form");

// 表单数据
// - taskId: 作业ID（jobId，唯一标识此调度作业）
// - handlerId: 任务处理器类型ID（Handler ID）
const formData = ref({
  taskId: "",
  handlerId: "",
  name: "",
  description: "",
  scheduleType: "interval", // interval | cron
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
    // 根据当前语言环境选择 cronstrue 的语言
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

// 重置表单函数（必须在watch之前定义）
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
  success.value = "";
  step.value = 1;
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

      // 编辑模式跳过步骤1
      step.value = 2;
    } else {
      resetForm();
    }
  }, 
  { immediate: true }
);

// 初始化：编辑模式跳过步骤1
onMounted(() => {
  if (props.isEdit && props.job) {
    step.value = 2;
  }
});

// 步骤1验证：是否选择了handler类型
const step1Valid = computed(() => {
  return !!formData.value.handlerId && !!currentHandlerType.value;
});

// 步骤2验证：配置参数是否有效
const step2Valid = computed(() => {
  if (configError.value) return false;
  // 检查必填字段
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

// 步骤3验证：执行计划是否有效
const step3Valid = computed(() => {
  const type = formData.value.scheduleType || "interval";
  if (type === "interval") {
    return Number(formData.value.intervalSec) >= 60;
  }
  if (type === "cron") {
    return !!formData.value.cronExpression;
  }
  return false;
});

// Cron 表达式人类可读提示（使用 cronstrue 完整解析）
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
    // 表达式不合法或不受支持时，退回示例文案，避免给出误导性描述
    return t("admin.scheduledJobs.form.cronExample");
  }
});

// 整体表单验证
const formValid = computed(() => {
  return step1Valid.value && step2Valid.value && step3Valid.value;
});

// 下一步
const nextStep = () => {
  if (step.value === 1 && step1Valid.value) {
    // 初始化配置默认值
    initConfigDefaults();
    step.value = 2;
  } else if (step.value === 2 && step2Valid.value) {
    step.value = 3;
  }
};

// 上一步
const prevStep = () => {
  if (step.value > 1) {
    // 编辑模式不能回到步骤1
    if (props.isEdit && step.value === 2) return;
    step.value--;
  }
};

// 初始化配置默认值
const initConfigDefaults = () => {
  const schema = currentHandlerType.value?.configSchema || [];
  const config = { ...formData.value.config };
  for (const field of schema) {
    if (config[field.name] === undefined && field.defaultValue !== undefined) {
      config[field.name] = field.defaultValue;
    }
  }
  formData.value.config = config;
  configText.value = JSON.stringify(config, null, 2);
};

// 更新配置字段值
const updateConfigField = (fieldName, value) => {
  formData.value.config = {
    ...formData.value.config,
    [fieldName]: value,
  };
};

// 关闭
const closeModal = () => {
  emit("close");
};

// 提交
const submitForm = async () => {
  if (!formValid.value || configError.value) {
    return;
  }

  loading.value = true;
  error.value = "";
  success.value = "";

  try {
    if (props.isEdit) {
      await updateJob(formData.value.taskId, {
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
      });
    } else {
      // 创建时不再手动指定 taskId，由后端根据 handlerId 自动生成唯一作业ID
      await createJob({
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
      });
    }

    success.value = props.isEdit
      ? t("admin.scheduledJobs.updateSuccess")
      : t("admin.scheduledJobs.createSuccess");

    emit("success");
    setTimeout(() => {
      emit("close");
    }, 1000);
  } catch (err) {
    error.value = err.message || t("admin.scheduledJobs.createFailed");
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4 bg-black bg-opacity-50 overflow-y-auto"
    @click.self="closeModal"
  >
    <div
      class="w-full max-w-md sm:max-w-xl rounded-lg shadow-xl overflow-hidden transition-colors max-h-[85vh] sm:max-h-[80vh] flex flex-col"
      :class="darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'"
      @click.stop
    >
      <!-- 头部 -->
      <div
        class="px-4 sm:px-6 py-3 sm:py-4 border-b"
        :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
      >
        <h2 class="text-base sm:text-lg font-semibold">
          {{ isEdit ? t("admin.scheduledJobs.form.editTitle") : t("admin.scheduledJobs.form.createTitle") }}
        </h2>
        <!-- 步骤指示器 -->
        <div class="flex items-center mt-2 text-xs">
          <template v-for="(stepInfo, idx) in [
            { num: 1, label: t('admin.scheduledJobs.form.step1Title') },
            { num: 2, label: t('admin.scheduledJobs.form.step2Title') },
            { num: 3, label: t('admin.scheduledJobs.form.step3Title') },
          ]" :key="stepInfo.num">
            <div
              class="flex items-center"
              :class="step >= stepInfo.num ? 'text-primary-500' : (darkMode ? 'text-gray-500' : 'text-gray-400')"
            >
              <span
                class="w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium"
                :class="step >= stepInfo.num
                  ? 'bg-primary-500 text-white'
                  : (darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500')"
              >
                {{ stepInfo.num }}
              </span>
              <span class="ml-1 hidden sm:inline">{{ stepInfo.label }}</span>
            </div>
            <div
              v-if="idx < 2"
              class="w-8 h-px mx-2"
              :class="step > stepInfo.num ? 'bg-primary-500' : (darkMode ? 'bg-gray-700' : 'bg-gray-300')"
            ></div>
          </template>
        </div>
      </div>

      <!-- 内容 -->
      <div class="p-4 sm:p-6 space-y-4 flex-1 overflow-y-auto">
        <!-- 成功/错误提示 -->
        <div
          v-if="success"
          class="p-3 rounded-md text-sm font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
        >
          {{ success }}
        </div>
        <div
          v-if="error"
          class="p-3 rounded-md text-sm font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
        >
          {{ error }}
        </div>

        <!-- 步骤1：选择handler类型 -->
        <div v-if="step === 1" class="space-y-4">
          <div>
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.handlerType.select") }}
              <span class="text-red-500">*</span>
            </label>
            <select
              v-model="formData.handlerId"
              class="w-full px-3 py-2 rounded-md border text-sm"
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
            class="p-4 rounded-md border"
            :class="darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'"
          >
            <div class="flex items-center gap-2 mb-2">
              <span class="font-medium">{{ currentHandlerType.name }}</span>
              <span
                class="text-xs px-2 py-0.5 rounded-full font-medium"
                :class="getCategoryClass(currentHandlerType.category)"
              >
                {{ getCategoryLabel(currentHandlerType.category) }}
              </span>
            </div>
            <p class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
              {{ currentHandlerType.description }}
            </p>
          </div>
        </div>

        <!-- 步骤2：配置参数 -->
        <div v-if="step === 2" class="space-y-4">
          <!-- 任务名称 -->
          <div>
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.name") }}
            </label>
            <input
              v-model="formData.name"
              type="text"
              :placeholder="t('admin.scheduledJobs.form.namePlaceholder')"
              class="w-full px-3 py-2 rounded-md border text-sm"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
            />
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.scheduledJobs.form.nameHint") }}
            </p>
          </div>

          <!-- 任务描述 -->
          <div>
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.description") }}
            </label>
            <textarea
              v-model="formData.description"
              rows="2"
              :placeholder="t('admin.scheduledJobs.form.descriptionPlaceholder')"
              class="w-full px-3 py-2 rounded-md border text-sm"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
            ></textarea>
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.scheduledJobs.form.descriptionHint") }}
            </p>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 模式切换 -->
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.scheduledJobs.form.configParams") }}
            </span>
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

          <!-- 表单模式 -->
          <div v-if="configMode === 'form'" class="space-y-4">
            <DynamicFormField
              v-for="field in currentHandlerType?.configSchema || []"
              :key="field.name"
              :field="field"
              :model-value="formData.config[field.name]"
              :dark-mode="darkMode"
              @update:model-value="updateConfigField(field.name, $event)"
            />
            <p
              v-if="!currentHandlerType?.configSchema?.length"
              class="text-sm"
              :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
            >
              {{ t("admin.scheduledJobs.form.noConfigParams") }}
            </p>
          </div>

          <!-- JSON模式 -->
          <div v-else class="space-y-2">
            <textarea
              v-model="configText"
              rows="10"
              :placeholder="t('admin.scheduledJobs.form.configPlaceholder')"
              class="w-full px-3 py-2 rounded-md border text-sm font-mono"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
            ></textarea>
            <p v-if="configError" class="text-xs text-red-500">
              {{ configError }}
            </p>
          </div>
        </div>

        <!-- 步骤3：执行计划 -->
        <div v-if="step === 3" class="space-y-4">
          <!-- 调度类型 -->
          <div>
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.scheduleType") }}
            </label>
            <select
              v-model="formData.scheduleType"
              class="w-full px-3 py-2 rounded-md border text-sm"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100'
                : 'bg-white border-gray-300 text-gray-900'"
            >
              <option value="interval">
                {{ t("admin.scheduledJobs.form.scheduleTypeInterval") }}
              </option>
              <option value="cron">
                {{ t("admin.scheduledJobs.form.scheduleTypeCron") }}
              </option>
            </select>
          </div>

          <!-- 执行间隔 -->
          <div v-if="formData.scheduleType === 'interval'">
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.intervalSec") }}
              <span class="text-red-500">*</span>
            </label>
            <div class="flex gap-2">
              <input
                v-model.number="intervalValue"
                type="number"
                min="1"
                class="flex-1 px-3 py-2 rounded-md border text-sm"
                :class="darkMode
                  ? 'bg-gray-700 border-gray-600 text-gray-100'
                  : 'bg-white border-gray-300 text-gray-900'"
              />
              <select
                v-model="intervalUnit"
                class="px-3 py-2 rounded-md border text-sm"
                :class="darkMode
                  ? 'bg-gray-700 border-gray-600 text-gray-100'
                  : 'bg-white border-gray-300 text-gray-900'"
              >
                <option v-for="unit in timeUnits" :key="unit.value" :value="unit.value">
                  {{ t(`admin.scheduledJobs.timeUnit.${unit.label}`) }}
                </option>
              </select>
            </div>

            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.scheduledJobs.form.intervalHint") }}
            </p>
          </div>

          <!-- Cron 表达式 -->
          <div v-if="formData.scheduleType === 'cron'">
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.scheduleTypeCron") }}
            </label>
            <input
              v-model="formData.cronExpression"
              type="text"
              class="w-full px-3 py-2 rounded-md border text-sm font-mono"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
              placeholder="0 2 * * *"
            />
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ cronHint }}
            </p>
          </div>

          <!-- 启用状态 -->
          <div class="flex items-center gap-2">
            <input
              v-model="formData.enabled"
              type="checkbox"
              id="enabled"
              class="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
            />
            <label
              for="enabled"
              class="text-sm"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.enabledLabel") }}
            </label>
          </div>

          <!-- 任务摘要 -->
          <div
            class="p-4 rounded-lg border"
            :class="darkMode ? 'bg-gray-700/30 border-gray-600' : 'bg-gray-50 border-gray-200'"
          >
            <h4 class="text-sm font-medium mb-3" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.scheduledJobs.form.summary") }}
            </h4>
            <dl class="text-sm space-y-2">
              <!-- 任务类型 -->
              <div class="flex">
                <dt class="w-24 flex-shrink-0" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.scheduledJobs.handlerType.title") }}:
                </dt>
                <dd :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  {{ currentHandlerType?.name || '-' }}
                </dd>
              </div>
              <!-- 执行间隔 -->
              <div class="flex">
                <dt class="w-24 flex-shrink-0" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.scheduledJobs.form.intervalSec") }}:
                </dt>
                <dd :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  <template v-if="formData.scheduleType === 'interval'">
                    {{ intervalValue }}
                    {{ t(`admin.scheduledJobs.timeUnit.${timeUnits.find(u => u.value === intervalUnit)?.label || 'hours'}`) }}
                    <span class="ml-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                      ({{ formData.intervalSec }} 秒)
                    </span>
                  </template>
                  <template v-else-if="formData.scheduleType === 'cron'">
                    <div class="space-y-1">
                      <div class="font-mono text-xs" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                        {{ formData.cronExpression || '-' }}
                      </div>
                      <div v-if="formData.cronExpression" class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ getCronDescription(formData.cronExpression) }}
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    -
                  </template>
                </dd>
              </div>
              <!-- 启用状态 -->
              <div class="flex items-center">
                <dt class="w-24 flex-shrink-0" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.scheduledJobs.form.enabled") }}:
                </dt>
                <dd>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                    :class="formData.enabled
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'"
                  >
                    {{ formData.enabled ? t("admin.scheduledJobs.status.enabled") : t("admin.scheduledJobs.status.disabled") }}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div
        class="px-4 sm:px-6 py-3 sm:py-4 border-t flex justify-between"
        :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
      >
        <div>
          <button
            v-if="step > 1 && !(isEdit && step === 2)"
            @click="prevStep"
            class="px-4 py-2 rounded-md text-sm font-medium transition"
            :class="darkMode
              ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
              : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
          >
            {{ t("admin.scheduledJobs.form.prevStep") }}
          </button>
        </div>
        <div class="flex gap-3">
          <button
            @click="closeModal"
            class="px-4 py-2 rounded-md text-sm font-medium transition"
            :class="darkMode
              ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
              : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
          >
            {{ t("admin.scheduledJobs.form.cancel") }}
          </button>
          <!-- 下一步按钮 -->
          <button
            v-if="step < 3"
            @click="nextStep"
            :disabled="(step === 1 && !step1Valid) || (step === 2 && !step2Valid)"
            class="px-4 py-2 rounded-md text-sm font-medium transition bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ t("admin.scheduledJobs.form.nextStep") }}
          </button>
          <!-- 提交按钮 -->
          <button
            v-if="step === 3"
            @click="submitForm"
            :disabled="!formValid || loading"
            class="px-4 py-2 rounded-md text-sm font-medium transition bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span v-if="loading" class="flex items-center">
              <svg class="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              {{ t("common.loading") }}
            </span>
            <span v-else>
              {{ isEdit ? t("admin.scheduledJobs.form.save") : t("admin.scheduledJobs.form.create") }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
