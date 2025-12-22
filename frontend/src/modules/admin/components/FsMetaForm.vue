<script setup>
import { ref, computed, watch, shallowRef, h } from "vue";
import { useI18n } from "vue-i18n";
import { useFsService } from "@/modules/fs";
import { useAdminMountService } from "@/modules/admin/services/mountService.js";
import { IconClose, IconFolder, IconRefresh } from "@/components/icons";

const { t } = useI18n();
const fsService = useFsService();
const { getMountsList } = useAdminMountService();

// 目录缓存
const directoryCache = shallowRef(new Map());

const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  meta: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(["close", "save"]);

// 表单数据
const formData = ref({
  path: "",
  headerMarkdown: "",
  headerInherit: false,
  footerMarkdown: "",
  footerInherit: false,
  hidePatterns: [],
  hideInherit: false,
  password: "",
  passwordInherit: false,
});

// UI 状态
const isLoading = ref(false);
const error = ref(null);
const activeTab = ref("basic"); // 'basic' 或 'path'

// 路径选择器状态
const isLoadingMounts = ref(false);
const mountsList = ref([]);
const selectedPath = ref("/");
const rootDirectories = shallowRef([]);

// 隐藏规则文本（用于textarea显示）
const hidePatternsText = computed({
  get: () => (Array.isArray(formData.value.hidePatterns) ? formData.value.hidePatterns.join("\n") : ""),
  set: (value) => {
    formData.value.hidePatterns = value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  },
});

// 计算属性
const formTitle = computed(() =>
  props.meta ? t("admin.fsMeta.form.titleEdit") : t("admin.fsMeta.form.titleCreate")
);
const submitButtonText = computed(() => {
  if (isLoading.value) {
    return props.meta
      ? t("admin.fsMeta.form.actions.updating")
      : t("admin.fsMeta.form.actions.creating");
  }
  return props.meta
    ? t("admin.fsMeta.form.actions.update")
    : t("admin.fsMeta.form.actions.create");
});

// 重置表单
const resetForm = () => {
  formData.value = {
    path: "",
    headerMarkdown: "",
    headerInherit: false,
    footerMarkdown: "",
    footerInherit: false,
    hidePatterns: [],
    hideInherit: false,
    password: "",
    passwordInherit: false,
  };
  error.value = null;
  activeTab.value = "basic";
};

// 监听props变化，初始化表单
watch(
  () => props.meta,
  (newMeta) => {
    if (newMeta) {
      formData.value = {
        path: newMeta.path || "",
        headerMarkdown: newMeta.headerMarkdown || "",
        headerInherit: newMeta.headerInherit || false,
        footerMarkdown: newMeta.footerMarkdown || "",
        footerInherit: newMeta.footerInherit || false,
        hidePatterns: Array.isArray(newMeta.hidePatterns) ? [...newMeta.hidePatterns] : [],
        hideInherit: newMeta.hideInherit || false,
        password: newMeta.password || "",
        passwordInherit: newMeta.passwordInherit || false,
      };
    } else {
      resetForm();
    }
  },
  { immediate: true }
);

// 提交表单
const handleSubmit = async () => {
  error.value = null;

  // 验证路径
  if (!formData.value.path.trim()) {
    error.value = t("admin.fsMeta.form.path.required");
    return;
  }

  // 统一规范化路径：前端防呆处理
  // 1. 去除首尾空格
  // 2. 确保以 / 开头
  // 3. 去掉末尾多余的 /（根路径除外）
  let normalizedPath = formData.value.path.trim();
  if (!normalizedPath.startsWith("/")) {
    normalizedPath = `/${normalizedPath}`;
  }
  normalizedPath = normalizedPath.replace(/\/+$/, "") || "/";
  formData.value.path = normalizedPath;

  isLoading.value = true;

  try {
    const submitData = {
      path: formData.value.path,
      headerMarkdown: formData.value.headerMarkdown || null,
      headerInherit: formData.value.headerInherit,
      footerMarkdown: formData.value.footerMarkdown || null,
      footerInherit: formData.value.footerInherit,
      hidePatterns: formData.value.hidePatterns,
      hideInherit: formData.value.hideInherit,
      passwordInherit: formData.value.passwordInherit,
      password: formData.value.password || "",
    };

    emit("save", submitData);
  } catch (err) {
    console.error("表单提交失败:", err);
    error.value = err.message || t("admin.fsMeta.form.errors.submitFailed");
    isLoading.value = false;
  }
};

// 创建目录项组件（递归展示目录树）
const DirectoryItemVue = {
  name: "DirectoryItemVue",
  props: {
    item: { type: Object, required: true },
    currentPath: { type: String, required: true },
    darkMode: { type: Boolean, default: false },
    level: { type: Number, default: 0 },
  },
  emits: ["select"],
  setup(props, { emit }) {
    const expanded = ref(false);
    const children = shallowRef([]);
    const loading = ref(false);

    const isSelected = computed(() => props.currentPath === props.item.path + "/");

    const loadChildren = async () => {
      const cacheKey = props.item.path;
      if (directoryCache.value.has(cacheKey)) {
        children.value = directoryCache.value.get(cacheKey);
        return;
      }

      loading.value = true;
      try {
        let dirItems = [];
        if (props.item.path === "/") {
          dirItems = mountsList.value.map((mount) => ({
            name: mount.name,
            path: mount.mount_path,
            isDirectory: true,
          }));
        } else {
          try {
            const data = await fsService.getDirectoryList(props.item.path);
            if (data && data.items) {
              dirItems = data.items
                .filter((item) => item.isDirectory)
                .map((item) => ({
                  name: item.name,
                  path: (props.item.path + "/" + item.name).replace(/\/\//g, "/"),
                  isDirectory: true,
                }));
            }
          } catch (err) {
            console.error("加载目录失败:", err);
          }
        }
        children.value = dirItems;
        directoryCache.value.set(cacheKey, dirItems);
      } finally {
        loading.value = false;
      }
    };

    watch(
      () => props.currentPath,
      (newPath) => {
        if (newPath.startsWith(props.item.path + "/") && newPath !== props.item.path + "/") {
          expanded.value = true;
          if (children.value.length === 0) loadChildren();
        }
      },
      { immediate: true }
    );

    const toggleExpand = (event) => {
      event.stopPropagation();
      expanded.value = !expanded.value;
      if (expanded.value && children.value.length === 0) loadChildren();
    };

    const selectFolder = () => emit("select", props.item.path);

    return { expanded, children, loading, isSelected, toggleExpand, selectFolder };
  },
  render() {
    return h("div", { class: "directory-item" }, [
      h("div", { class: ["tree-item", { selected: this.isSelected }], onClick: this.selectFolder }, [
        h("div", { class: "flex items-center py-2 px-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer", style: { paddingLeft: `${this.level * 0.75 + 0.5}rem` } }, [
          h("div", { class: "folder-toggle", onClick: (e) => { e.stopPropagation(); this.toggleExpand(e); } }, [
            this.expanded
              ? h("svg", { class: "h-4 w-4", xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", "stroke-width": "2" }, [
                  h("path", { "stroke-linecap": "round", "stroke-linejoin": "round", d: "M19 9l-7 7-7-7" }),
                ])
              : h("svg", { class: "h-4 w-4", xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", "stroke-width": "2" }, [
                  h("path", { "stroke-linecap": "round", "stroke-linejoin": "round", d: "M9 5l7 7-7 7" }),
                ]),
          ]),
          h("svg", { class: ["h-4 w-4 flex-shrink-0 mr-2", this.darkMode ? "text-yellow-400" : "text-yellow-600"], xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", "stroke-width": "2" }, [
            h("path", { "stroke-linecap": "round", "stroke-linejoin": "round", d: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" }),
          ]),
          h("span", { class: ["truncate", this.darkMode ? "text-gray-200" : "text-gray-700"] }, this.item.name),
        ]),
      ]),
      this.expanded
        ? h("div", { class: "folder-children" }, [
            this.loading
              ? h("div", { class: "folder-loading", style: { paddingLeft: `${(this.level + 1) * 0.75 + 0.75}rem` } }, [
                  h(IconRefresh, { class: "animate-spin h-3 w-3 mr-1", "aria-hidden": "true" }),
                  h("span", { class: "text-xs" }, t("admin.fsMeta.common.loading")),
                ])
              : this.children.length === 0
                ? null
                : this.children.map((child) =>
                    h("div", { class: "folder-item", key: child.path }, [
                      h(DirectoryItemVue, {
                        item: child,
                        currentPath: this.currentPath,
                        darkMode: this.darkMode,
                        level: this.level + 1,
                        onSelect: (path) => this.$emit("select", path),
                      }),
                    ])
                  ),
          ])
        : null,
    ]);
  },
};

// 加载挂载点列表
const loadMounts = async () => {
  if (mountsList.value.length > 0) return;

  isLoadingMounts.value = true;
  try {
    const mounts = await getMountsList();
    mountsList.value = (Array.isArray(mounts) ? mounts : []).filter((mount) => mount.is_active);
    rootDirectories.value = mountsList.value.map((mount) => ({
      name: mount.name,
      path: mount.mount_path,
      isDirectory: true,
    }));
  } catch (error) {
    console.error("加载挂载点列表失败:", error);
    mountsList.value = [];
    rootDirectories.value = [];
  } finally {
    isLoadingMounts.value = false;
  }
};

// 切换到路径选择标签页
const switchToPathTab = async () => {
  await loadMounts();
  selectedPath.value = formData.value.path || "/";
  activeTab.value = "path";
};

// 选择路径
const selectPath = (path) => {
  selectedPath.value = path.endsWith("/") ? path : path + "/";
  formData.value.path = selectedPath.value;
  activeTab.value = "basic"; // 选择后自动切换回基本信息标签页
};

// 取消
const handleCancel = () => {
  emit("close");
};
</script>

<template>
  <div class="fixed inset-0 z-[60] overflow-auto bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4" @click.self="handleCancel">
    <div
      class="w-full max-w-sm sm:max-w-lg md:max-w-2xl rounded-lg shadow-xl overflow-hidden max-h-[95vh] sm:max-h-[85vh] flex flex-col"
      :class="darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-800'"
    >
      <!-- 固定头部 -->
      <div class="px-3 sm:px-4 py-2 sm:py-3 border-b flex justify-between items-center sticky top-0 z-10" :class="darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'">
        <h3 class="text-base sm:text-lg leading-6 font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ formTitle }}
        </h3>
        <button
          @click="handleCancel"
          class="rounded-md p-0.5 sm:p-1 inline-flex items-center justify-center"
          :class="darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'"
        >
          <span class="sr-only">{{ $t("common.close") }}</span>
          <IconClose class="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
        </button>
      </div>

      <!-- 标签页导航 -->
      <div class="border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <div class="flex space-x-4 px-3 sm:px-4">
          <button
            @click="activeTab = 'basic'"
            class="px-4 py-2 text-sm font-medium"
            :class="[
              activeTab === 'basic'
                ? darkMode
                  ? 'border-b-2 border-primary-500 text-primary-400'
                  : 'border-b-2 border-primary-500 text-primary-600'
                : darkMode
                ? 'text-gray-400 hover:text-gray-200'
                : 'text-gray-500 hover:text-gray-700',
            ]"
          >
            {{ $t("admin.fsMeta.form.tabs.basic") }}
          </button>
          <button
            @click="switchToPathTab"
            class="px-4 py-2 text-sm font-medium"
            :class="[
              activeTab === 'path'
                ? darkMode
                  ? 'border-b-2 border-primary-500 text-primary-400'
                  : 'border-b-2 border-primary-500 text-primary-600'
                : darkMode
                ? 'text-gray-400 hover:text-gray-200'
                : 'text-gray-500 hover:text-gray-700',
            ]"
          >
            {{ $t("admin.fsMeta.form.tabs.path") }}
          </button>
        </div>
      </div>

      <!-- 可滚动内容区 -->
      <div class="px-3 sm:px-4 py-3 sm:py-4 overflow-y-auto flex-1">
        <!-- 基本信息标签页 -->
        <div v-if="activeTab === 'basic'" class="space-y-3 sm:space-y-4">
          <!-- 路径 -->
          <div>
            <label for="path" class="block text-xs sm:text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ $t("admin.fsMeta.form.path.label") }}
              <span class="text-red-500">*</span>
            </label>
            <div class="flex">
              <input
                id="path"
                v-model="formData.path"
                type="text"
                :placeholder="$t('admin.fsMeta.form.path.placeholder')"
                class="flex-1 px-2 sm:px-3 py-1.5 sm:py-2 border text-sm sm:text-base rounded-l-md"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500'"
              />
              <button
                @click="switchToPathTab"
                type="button"
                class="px-2 sm:px-3 py-1.5 sm:py-2 rounded-r-md text-white transition-colors"
                :class="darkMode ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'"
                :title="$t('admin.fsMeta.form.path.selectButton')"
              >
                <IconFolder class="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
              </button>
            </div>
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ $t("admin.fsMeta.form.path.helper") }}
            </p>
          </div>

          <!-- Header Markdown -->
          <div>
            <label for="header-markdown" class="block text-xs sm:text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ $t("admin.fsMeta.form.headerMarkdown.label") }}
            </label>
            <textarea
              id="header-markdown"
              v-model="formData.headerMarkdown"
              rows="3"
              :placeholder="$t('admin.fsMeta.form.headerMarkdown.placeholder')"
              class="w-full px-2 sm:px-3 py-1.5 sm:py-2 rounded-md border font-mono text-xs sm:text-sm"
              :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500'"
            ></textarea>
            <div class="flex items-center space-x-2 mt-2">
              <input id="header-inherit" v-model="formData.headerInherit" type="checkbox" class="h-3 w-3 sm:h-4 sm:w-4 rounded" :class="darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'" />
              <label for="header-inherit" class="text-xs sm:text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t("admin.fsMeta.form.headerMarkdown.inheritLabel") }}
              </label>
            </div>
          </div>

          <!-- Footer Markdown -->
          <div>
            <label for="footer-markdown" class="block text-xs sm:text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ $t("admin.fsMeta.form.footerMarkdown.label") }}
            </label>
            <textarea
              id="footer-markdown"
              v-model="formData.footerMarkdown"
              rows="3"
              :placeholder="$t('admin.fsMeta.form.footerMarkdown.placeholder')"
              class="w-full px-2 sm:px-3 py-1.5 sm:py-2 rounded-md border font-mono text-xs sm:text-sm"
              :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500'"
            ></textarea>
            <div class="flex items-center space-x-2 mt-2">
              <input id="footer-inherit" v-model="formData.footerInherit" type="checkbox" class="h-3 w-3 sm:h-4 sm:w-4 rounded" :class="darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'" />
              <label for="footer-inherit" class="text-xs sm:text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t("admin.fsMeta.form.footerMarkdown.inheritLabel") }}
              </label>
            </div>
          </div>

          <!-- 隐藏规则 -->
          <div>
            <label for="hide-patterns" class="block text-xs sm:text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ $t("admin.fsMeta.form.hidePatterns.label") }}
            </label>
            <textarea
              id="hide-patterns"
              v-model="hidePatternsText"
              rows="3"
              :placeholder="$t('admin.fsMeta.form.hidePatterns.placeholder')"
              class="w-full px-2 sm:px-3 py-1.5 sm:py-2 rounded-md border font-mono text-xs sm:text-sm"
              :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500'"
            ></textarea>
            <div class="flex items-center space-x-2 mt-2">
              <input id="hide-inherit" v-model="formData.hideInherit" type="checkbox" class="h-3 w-3 sm:h-4 sm:w-4 rounded" :class="darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'" />
              <label for="hide-inherit" class="text-xs sm:text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t("admin.fsMeta.form.hidePatterns.inheritLabel") }}
              </label>
            </div>
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ $t("admin.fsMeta.form.hidePatterns.helper") }}
            </p>
          </div>

          <!-- 密码 -->
          <div>
            <label for="password" class="block text-xs sm:text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ $t("admin.fsMeta.form.password.label") }}
            </label>
            <input
              id="password"
              v-model="formData.password"
              type="password"
              :placeholder="
                meta
                  ? $t('admin.fsMeta.form.password.placeholderKeep')
                  : $t('admin.fsMeta.form.password.placeholderSetOptional')
              "
              class="w-full px-2 sm:px-3 py-1.5 sm:py-2 rounded-md border text-sm sm:text-base"
              :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500'"
              autocomplete="new-password"
            />
            <div class="flex items-center space-x-2 mt-2">
              <input id="password-inherit" v-model="formData.passwordInherit" type="checkbox" class="h-3 w-3 sm:h-4 sm:w-4 rounded" :class="darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'" />
              <label for="password-inherit" class="text-xs sm:text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t("admin.fsMeta.form.password.inheritLabel") }}
              </label>
            </div>
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ $t("admin.fsMeta.form.password.helper") }}
            </p>
          </div>

          <!-- 错误信息 -->
          <div v-if="error" class="p-2 sm:p-3 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 text-xs sm:text-sm">
            {{ error }}
          </div>
        </div>

        <!-- 路径选择标签页 -->
        <div v-if="activeTab === 'path'" class="space-y-3 sm:space-y-4">
          <!-- 当前选择的路径 -->
          <div>
            <label class="block text-xs sm:text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ $t("admin.fsMeta.form.pathSelector.currentSelection") }}
            </label>
            <div
              class="w-full px-2 sm:px-3 py-1.5 sm:py-2 rounded-md border font-mono text-sm sm:text-base"
              :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-100 border-gray-300 text-gray-800'"
            >
              {{ selectedPath }}
            </div>
          </div>

          <!-- 目录树 -->
          <div>
            <label class="block text-xs sm:text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ $t("admin.fsMeta.form.pathSelector.selectDirectory") }}
            </label>
            <div class="border rounded-md overflow-hidden" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
              <div v-if="isLoadingMounts" class="h-64 flex justify-center items-center">
                <IconRefresh size="xl" class="animate-spin" :class="darkMode ? 'text-blue-400' : 'text-blue-500'" aria-hidden="true" />
              </div>
              <div v-else class="h-64 overflow-y-auto p-1">
                <div class="file-tree">
                  <!-- 根目录 -->
                  <div class="tree-item" :class="{ selected: selectedPath === '/' }" @click="selectPath('/')">
                    <div
                      class="flex items-center py-2 px-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                      :style="{ paddingLeft: '0.5rem' }"
                    >
                      <IconFolder size="sm" class="flex-shrink-0 mr-2" :class="darkMode ? 'text-yellow-400' : 'text-yellow-600'" aria-hidden="true" />
                      <span :class="darkMode ? 'text-gray-200' : 'text-gray-700'">/</span>
                    </div>
                  </div>

                  <!-- 挂载点目录 -->
                  <div v-for="item in rootDirectories" :key="item.path" class="folder-item">
                    <DirectoryItemVue :item="item" :current-path="selectedPath" :dark-mode="darkMode" :level="0" @select="selectPath" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 固定底部按钮区 -->
      <div
        class="px-3 sm:px-4 py-2 sm:py-3 border-t flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 space-y-2 space-y-reverse sm:space-y-0"
        :class="darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'"
      >
        <button
          @click="handleCancel"
          class="w-full sm:w-auto px-3 sm:px-4 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
          :disabled="isLoading"
        >
          {{ $t("admin.fsMeta.form.actions.cancel") }}
        </button>
        <button
          @click="handleSubmit"
          type="button"
          class="w-full sm:w-auto flex justify-center items-center px-3 sm:px-4 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium text-white transition-colors"
          :class="[isLoading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary-600', darkMode ? 'bg-primary-600' : 'bg-primary-500']"
          :disabled="isLoading"
        >
          {{ submitButtonText }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 目录树样式 */
.file-tree {
  @apply text-sm;
}

.tree-item {
  @apply relative;
}

.tree-item.selected > div {
  @apply bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-500;
}

.folder-toggle {
  @apply w-5 h-5 flex items-center justify-center cursor-pointer;
  @apply text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200;
}

.folder-children {
  @apply relative;
}

.folder-item {
  @apply relative;
}

.folder-loading {
  @apply flex items-center text-gray-500 dark:text-gray-400 py-2;
}
</style>
