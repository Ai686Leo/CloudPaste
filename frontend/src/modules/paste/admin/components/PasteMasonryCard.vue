<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
// 导入统一的时间处理工具
import { formatDateTime, formatRelativeTime, isExpired as isExpiredUtil } from "@/utils/timeUtils.js";
// 导入统一的文件工具
import { getRemainingViews as getRemainingViewsUtil } from "@/utils/fileUtils.js";
// 导入创建者徽章统一逻辑
import { useCreatorBadge } from "@/composables/admin-management/useCreatorBadge.js";

const { getCreatorText } = useCreatorBadge();

/**
 * Paste 瀑布流卡片组件
 * 用于在瀑布流布局中展示文本分享的预览卡片
 */
const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  paste: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["click", "preview", "edit", "delete", "copy-link", "copy-raw-link", "show-qrcode", "quick-edit-content"]);

/**
 * 截断文本内容用于预览
 * @param {string} text - 原始文本
 * @param {number} maxLength - 最大长度
 * @returns {string} 截断后的文本
 */
const truncateContent = (text, maxLength = 800) => {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

/**
 * 获取显示内容
 * 管理端列表统一返回完整 content，这里直接使用全文，预览截断交给前端 truncateContent 处理
 */
const displayContent = computed(() => {
  return props.paste.content || "";
});

/**
 * 检查是否已过期
 */
const isExpired = computed(() => {
  return props.paste.expires_at ? isExpiredUtil(props.paste.expires_at) : false;
});

/**
 * 获取剩余访问次数
 */
const remainingViews = computed(() => {
  return getRemainingViewsUtil(props.paste);
});

/**
 * 格式化创建者信息
 */
const creatorLabel = computed(() => {
  return getCreatorText(props.paste.created_by, props.paste.key_name);
});

/**
 * 是否显示剩余次数警告角标（<20时显示）
 */
const showViewsWarning = computed(() => {
  const num = remainingViews.value;
  return num !== Infinity && num > 0 && num < 10;
});

/**
 * 编辑状态管理
 */
const isEditing = ref(false);
const editingContent = ref("");
const isTouchDevice = ref(false);

// 移动端双击检测
const lastTapTime = ref(0);
const doubleTapDelay = 300;

/**
 * 开始编辑内容
 */
const startEditing = () => {
  editingContent.value = displayContent.value;
  isEditing.value = true;
  // 下一帧聚焦到 textarea
  nextTick(() => {
    const textarea = document.querySelector(`#edit-textarea-${props.paste.id}`);
    if (textarea) {
      // 防止浏览器自动滚动
      textarea.focus({ preventScroll: true });
      // 将 textarea 内部滚动位置重置到顶部
      textarea.scrollTop = 0;
      // 将光标定位到开头
      textarea.setSelectionRange(0, 0);
    }
  });
};

/**
 * 保存编辑内容
 */
const saveContent = () => {
  if (editingContent.value.trim() === "") {
    alert("内容不能为空");
    return;
  }

  emit("quick-edit-content", {
    id: props.paste.id,
    slug: props.paste.slug,
    content: editingContent.value,
  });

  isEditing.value = false;
};

/**
 * 取消编辑
 */
const cancelEdit = () => {
  isEditing.value = false;
  editingContent.value = "";
};

/**
 * 处理桌面端双击事件
 */
const handleDoubleClick = (event) => {
  // 如果点击的是按钮或链接，不触发编辑
  if (event.target.closest("button") || event.target.closest("a")) {
    return;
  }

  startEditing();
};

/**
 * 处理移动端双击事件
 * 通过检测两次触摸的时间间隔来判断是否为双击
 */
const handleTouchStart = (event) => {
  // 如果点击的是按钮或链接，不触发编辑
  if (event.target.closest("button") || event.target.closest("a")) {
    return;
  }

  const currentTime = new Date().getTime();
  const tapInterval = currentTime - lastTapTime.value;

  // 如果两次点击间隔小于阈值，认为是双击
  if (tapInterval < doubleTapDelay && tapInterval > 0) {
    // 阻止默认行为(如缩放)
    event.preventDefault();
    startEditing();
    // 重置时间，避免连续触发
    lastTapTime.value = 0;
  } else {
    // 记录本次点击时间
    lastTapTime.value = currentTime;
  }
};

/**
 * 下拉菜单显示状态
 */
const showDropdown = ref(false);

/**
 * 切换下拉菜单显示状态
 */
const toggleDropdown = (event) => {
  event.stopPropagation();
  showDropdown.value = !showDropdown.value;
};

/**
 * 关闭下拉菜单
 */
const closeDropdown = () => {
  showDropdown.value = false;
};

/**
 * 处理卡片点击 - 取消点击行为
 */
const handleCardClick = () => {
  // 不执行任何操作，预览功能移到三点菜单
};

/**
 * 点击外部关闭下拉菜单
 */
const handleClickOutside = (event) => {
  // 如果点击的不是下拉菜单本身，则关闭菜单
  if (showDropdown.value) {
    closeDropdown();
  }
};

// 生命周期：添加全局点击事件监听
onMounted(() => {
  document.addEventListener("click", handleClickOutside);

  // 检测是否为触摸设备（移动端）
  isTouchDevice.value =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
});

// 生命周期：移除全局点击事件监听
onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
});
</script>

<template>
  <div
    class="paste-masonry-card relative group flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    :class="isExpired && !isEditing
      ? 'bg-gray-50 dark:bg-gray-900'
      : 'bg-white dark:bg-gray-800'"
    tabindex="0"
    @dblclick.prevent="handleDoubleClick"
    @touchstart="handleTouchStart"
  >
    <!-- 编辑模式：整个卡片变成编辑区 -->
    <div v-if="isEditing" class="flex flex-col min-h-[180px] sm:min-h-[220px]">
      <textarea
        :id="`edit-textarea-${paste.id}`"
        v-model="editingContent"
        class="w-full flex-1 p-3 sm:p-4 text-sm leading-relaxed resize-none border-none outline-none paste-edit-textarea min-h-[120px] sm:min-h-[160px] max-h-[400px] sm:max-h-[500px]"
        :class="darkMode ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'"
        placeholder="编辑内容..."
        @keydown.esc="cancelEdit"
        @keydown.meta.enter="saveContent"
        @keydown.ctrl.enter="saveContent"
      ></textarea>

      <!-- 编辑按钮组 -->
      <div class="flex items-center justify-end space-x-2 p-2 sm:p-3 border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <button
          @click="cancelEdit"
          class="px-4 py-2 text-sm font-medium rounded transition-colors"
          :class="darkMode
            ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
        >
          取消
        </button>
        <button
          @click="saveContent"
          class="px-4 py-2 text-sm font-medium text-white rounded transition-colors"
          :class="darkMode
            ? 'bg-primary-600 hover:bg-primary-700'
            : 'bg-primary-600 hover:bg-primary-700'"
        >
          保存
        </button>
      </div>
    </div>

    <!-- 阅读模式：显示完整卡片内容 -->
    <template v-else>
      <!-- 卡片头部：创建时间 + 状态标签 + 操作按钮 -->
      <div class="px-3 pt-3 pb-2 sm:px-4 sm:pt-4">
      <!-- 第一行：创建时间（左）+ 状态标签和按钮（右） -->
      <div class="flex items-center justify-between mb-2">
        <!-- 左：创建时间（小字，显示具体时分秒） -->
        <time class="text-xs text-gray-500 dark:text-gray-400" :datetime="paste.created_at" :title="formatDateTime(paste.created_at)">
          {{ formatDateTime(paste.created_at) }}
        </time>

        <!-- 右侧：状态标签 + 操作按钮 -->
        <div class="flex items-center space-x-2 flex-shrink-0">
          <!-- 状态图标组（仅图标） -->
          <div class="flex items-center space-x-1.5">
            <!-- 密码图标 -->
            <span
              v-if="paste.has_password"
              class="inline-flex items-center justify-center w-6 h-6 rounded-full"
              :class="darkMode ? 'bg-amber-500/15' : 'bg-amber-50'"
              title="密码保护"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="h-4 w-4" :class="darkMode ? 'text-amber-200' : 'text-amber-600'">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11V7a5 5 0 0110 0v4" />
                <rect stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x="6" y="11" width="12" height="9" rx="2" />
              </svg>
            </span>

            <!-- 可见性图标 -->
            <span
              class="inline-flex items-center justify-center w-6 h-6 rounded-full"
              :class="paste.is_public
                ? (darkMode ? 'bg-green-500/15' : 'bg-green-50')
                : (darkMode ? 'bg-gray-500/15' : 'bg-gray-50')"
              :title="paste.is_public ? '公开访问' : '仅管理员和创建者可见'"
            >
              <!-- 公开图标 -->
              <svg
                v-if="paste.is_public"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                class="h-4 w-4"
                :class="darkMode ? 'text-green-200' : 'text-green-600'"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <!-- 私密图标 -->
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                class="h-4 w-4"
                :class="darkMode ? 'text-gray-200' : 'text-gray-600'"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c1.657 0 3-1.343 3-3S13.657 5 12 5s-3 1.343-3 3 1.343 3 3 3z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.5 20a8.38 8.38 0 017.5-4.5 8.38 8.38 0 017.5 4.5" />
              </svg>
            </span>

            <!-- 过期图标 -->
            <span v-if="isExpired" class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30" title="已过期">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>

            <!-- 剩余次数警告（<10时显示）- 图标+数字组合 -->
            <span
              v-if="showViewsWarning"
              class="inline-flex items-center space-x-0.5"
              :title="`剩余次数: ${remainingViews}`"
            >
              <!-- 眼睛图标（与其他图标风格统一） -->
              <span
                class="inline-flex items-center justify-center w-6 h-6 rounded-full"
                :class="darkMode ? 'bg-orange-500/15' : 'bg-orange-50'"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4"
                  :class="darkMode ? 'text-orange-300' : 'text-orange-600'"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </span>
              <!-- 数字标签 -->
              <span
                class="text-xs font-medium"
                :class="darkMode ? 'text-orange-300' : 'text-orange-600'"
              >
                {{ remainingViews }}
              </span>
            </span>
          </div>

          <!-- 三点操作按钮 -->
          <div class="relative">
            <button
              @click.stop="toggleDropdown"
              class="p-2 sm:p-1 -m-1 sm:m-0 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600 text-gray-500 dark:text-gray-400 transition-colors"
              title="更多操作"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>

            <!-- 下拉菜单 -->
            <div
              v-if="showDropdown"
              class="absolute right-0 top-8 mt-1 w-40 rounded-md shadow-lg bg-white dark:bg-gray-700 ring-1 ring-black ring-opacity-5 z-50"
              @click.stop
            >
              <div class="py-1">
                <!-- 预览 -->
                <button
                  @click.stop="
                    emit('preview', paste);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  预览
                </button>

                <!-- 快速编辑 -->
                <button
                  @click.stop="
                    startEditing();
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  快速编辑
                </button>

                <!-- 编辑 -->
                <button
                  @click.stop="
                    emit('edit', paste);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  完整编辑
                </button>

                <!-- 复制链接 -->
                <button
                  @click.stop="
                    emit('copy-link', paste.slug);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  复制链接
                </button>

                <!-- 复制直链 -->
                <button
                  @click.stop="
                    emit('copy-raw-link', paste.slug);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-cyan-600 dark:text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  复制直链
                </button>

                <!-- 显示二维码 -->
                <button
                  @click.stop="
                    emit('show-qrcode', paste.slug);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                  显示二维码
                </button>

                <!-- 分隔线 -->
                <div class="border-t border-gray-200 dark:border-gray-600 my-1"></div>

                <!-- 删除 -->
                <button
                  @click.stop="
                    emit('delete', paste.id);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 第二行：标题 -->
      <h3
        class="text-sm sm:text-base font-medium truncate mb-2"
        :class="isExpired ? 'text-red-600 dark:text-red-400' : 'text-primary-600 dark:text-primary-400'"
        :title="paste.title || paste.remark || paste.slug"
      >
        {{ paste.title || paste.slug }}
      </h3>

      <!-- 内容区域 -->
      <div class="text-sm text-gray-700 dark:text-gray-300 mb-3 line-clamp-8 sm:line-clamp-10 whitespace-pre-wrap break-words leading-relaxed">
        {{ truncateContent(displayContent, 400) }}
      </div>
    </div>

    <!-- 卡片底部：元数据（小字灰色） -->
    <div class="px-3 pb-2.5 sm:px-4 sm:pb-3">
      <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <!-- 创建者 -->
        <span class="inline-flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {{ creatorLabel }}
        </span>

        <!-- 过期时间（如果有） -->
        <span v-if="paste.expires_at" class="inline-flex items-center" :class="isExpired ? 'text-red-600 dark:text-red-400' : ''">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {{ formatRelativeTime(paste.expires_at) }}
        </span>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
/* 编辑态 textarea 自适应内容高度，叠加最大高度限制 */
.paste-edit-textarea {
  field-sizing: content;
}

/* line-clamp 工具类（Tailwind 3.x 已内置，这里作为备用） */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line-clamp-8 {
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line-clamp-10 {
  display: -webkit-box;
  -webkit-line-clamp: 10;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
