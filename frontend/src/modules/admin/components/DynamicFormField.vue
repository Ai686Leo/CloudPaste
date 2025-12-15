<script setup>
/**
 * 动态表单字段组件
 * - 根据 FieldSchema 渲染不同类型的输入控件
 * - 支持 string、number、boolean、select、textarea 类型
 * - 支持暗黑模式
 */
import { computed } from "vue";

const props = defineProps({
  /** 字段 Schema 定义 */
  field: {
    type: Object,
    required: true,
  },
  /** 字段值（v-model） */
  modelValue: {
    type: [String, Number, Boolean],
    default: undefined,
  },
  /** 暗黑模式 */
  darkMode: {
    type: Boolean,
    default: false,
  },
  /** 是否禁用 */
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:modelValue"]);

// 计算属性：字段类型
const fieldType = computed(() => props.field?.type || "string");

// 计算属性：字段标签
const fieldLabel = computed(() => props.field?.label || props.field?.name || "");

// 计算属性：是否必填
const isRequired = computed(() => props.field?.required === true);

// 计算属性：字段描述
const fieldDescription = computed(() => props.field?.description || "");

// 计算属性：下拉选项（用于 select 类型）
const selectOptions = computed(() => props.field?.options || []);

// 计算属性：数值范围
const minValue = computed(() => props.field?.min);
const maxValue = computed(() => props.field?.max);

// 计算属性：默认值
const defaultValue = computed(() => props.field?.defaultValue);

// 更新值
const updateValue = (newValue) => {
  emit("update:modelValue", newValue);
};

// 处理 input 事件
const handleInput = (event) => {
  const value = event.target.value;
  if (fieldType.value === "number") {
    updateValue(value === "" ? undefined : Number(value));
  } else {
    updateValue(value);
  }
};

// 处理 checkbox 事件
const handleCheckbox = (event) => {
  updateValue(event.target.checked);
};

// 处理 select 事件
const handleSelect = (event) => {
  updateValue(event.target.value);
};

// 输入框样式
const inputClass = computed(() => [
  "block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border",
  props.darkMode
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "border-gray-300 text-gray-900 placeholder-gray-500",
  props.disabled ? "opacity-50 cursor-not-allowed" : "",
]);

// 标签样式
const labelClass = computed(() => [
  "block text-sm font-medium mb-1",
  props.darkMode ? "text-gray-200" : "text-gray-700",
]);

// 描述文本样式
const descriptionClass = computed(() => [
  "mt-1 text-xs",
  props.darkMode ? "text-gray-400" : "text-gray-500",
]);
</script>

<template>
  <div class="dynamic-form-field">
    <!-- String 类型：文本输入框 -->
    <template v-if="fieldType === 'string'">
      <label :for="field.name" :class="labelClass">
        {{ fieldLabel }}
        <span v-if="isRequired" class="text-red-500">*</span>
      </label>
      <input
        type="text"
        :id="field.name"
        :value="modelValue"
        :placeholder="defaultValue !== undefined ? String(defaultValue) : ''"
        :disabled="disabled"
        :required="isRequired"
        :class="inputClass"
        @input="handleInput"
      />
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
      </p>
    </template>

    <!-- Number 类型：数字输入框 -->
    <template v-else-if="fieldType === 'number'">
      <label :for="field.name" :class="labelClass">
        {{ fieldLabel }}
        <span v-if="isRequired" class="text-red-500">*</span>
      </label>
      <input
        type="number"
        :id="field.name"
        :value="modelValue"
        :placeholder="defaultValue !== undefined ? String(defaultValue) : ''"
        :min="minValue"
        :max="maxValue"
        :disabled="disabled"
        :required="isRequired"
        :class="inputClass"
        @input="handleInput"
      />
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
        <span v-if="minValue !== undefined || maxValue !== undefined" class="ml-1">
          ({{ minValue !== undefined ? `最小: ${minValue}` : '' }}{{ minValue !== undefined && maxValue !== undefined ? ', ' : '' }}{{ maxValue !== undefined ? `最大: ${maxValue}` : '' }})
        </span>
      </p>
    </template>

    <!-- Boolean 类型：复选框 -->
    <template v-else-if="fieldType === 'boolean'">
      <div class="flex items-center h-10 px-3 py-2 rounded-md border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
        <input
          type="checkbox"
          :id="field.name"
          :checked="modelValue"
          :disabled="disabled"
          class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
          @change="handleCheckbox"
        />
        <label :for="field.name" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
          {{ fieldLabel }}
          <span v-if="isRequired" class="text-red-500">*</span>
        </label>
      </div>
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
      </p>
    </template>

    <!-- Select 类型：下拉选择框 -->
    <template v-else-if="fieldType === 'select'">
      <label :for="field.name" :class="labelClass">
        {{ fieldLabel }}
        <span v-if="isRequired" class="text-red-500">*</span>
      </label>
      <select
        :id="field.name"
        :value="modelValue"
        :disabled="disabled"
        :required="isRequired"
        :class="inputClass"
        @change="handleSelect"
      >
        <option v-for="opt in selectOptions" :key="opt.value" :value="opt.value">
          {{ opt.label || opt.value }}
        </option>
      </select>
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
      </p>
    </template>

    <!-- Textarea 类型：多行文本框 -->
    <template v-else-if="fieldType === 'textarea'">
      <label :for="field.name" :class="labelClass">
        {{ fieldLabel }}
        <span v-if="isRequired" class="text-red-500">*</span>
      </label>
      <textarea
        :id="field.name"
        :value="modelValue"
        :placeholder="defaultValue !== undefined ? String(defaultValue) : ''"
        :disabled="disabled"
        :required="isRequired"
        rows="4"
        :class="inputClass"
        @input="handleInput"
      />
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
      </p>
    </template>

    <!-- 未知类型：回退到文本输入框 -->
    <template v-else>
      <label :for="field.name" :class="labelClass">
        {{ fieldLabel }}
        <span v-if="isRequired" class="text-red-500">*</span>
      </label>
      <input
        type="text"
        :id="field.name"
        :value="modelValue"
        :disabled="disabled"
        :required="isRequired"
        :class="inputClass"
        @input="handleInput"
      />
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
      </p>
    </template>
  </div>
</template>
