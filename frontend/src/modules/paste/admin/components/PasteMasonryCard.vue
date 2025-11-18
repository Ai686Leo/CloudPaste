<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
// 导入统一的时间处理工具
import { formatDateTime, formatRelativeTime, isExpired as isExpiredUtil } from "@/utils/timeUtils.js";
// 导入统一的文件工具
import { getRemainingViews as getRemainingViewsUtil } from "@/utils/fileUtils.js";

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

const emit = defineEmits(["click", "preview", "edit", "delete", "copy-link", "show-qrcode"]);

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
 * 获取显示内容（兼容 content_preview 和 content 字段）
 * 管理员列表API返回 content_preview，API Key用户列表返回 content
 */
const displayContent = computed(() => {
  return props.paste.content_preview || props.paste.content || "";
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
  if (!props.paste.created_by) return "系统";

  if (props.paste.created_by.startsWith("apikey:")) {
    return props.paste.key_name ? `密钥：${props.paste.key_name}` : "API密钥";
  }

  if (props.paste.created_by === "admin" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(props.paste.created_by)) {
    return "管理员";
  }

  return props.paste.created_by;
});

/**
 * 创建者样式类
 */
const creatorClass = computed(() => {
  if (!props.paste.created_by) return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";

  if (props.paste.created_by.startsWith("apikey:")) {
    return "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100";
  }

  if (props.paste.created_by === "admin" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(props.paste.created_by)) {
    return "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100";
  }

  return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
});

/**
 * 过期时间样式类
 */
const expiryClass = computed(() => {
  if (isExpired.value) {
    return "text-red-600 dark:text-red-400";
  }
  return "text-gray-700 dark:text-gray-300";
});

/**
 * 剩余次数样式类
 */
const remainingViewsClass = computed(() => {
  if (isExpired.value || remainingViews.value === "已用完") {
    return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
  }
  return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
});

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
 * 处理卡片点击
 */
const handleCardClick = () => {
  emit("click", props.paste);
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
});

// 生命周期：移除全局点击事件监听
onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
});
</script>

<template>
  <div
    class="paste-masonry-card relative group flex flex-col bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    :class="{ 'opacity-60': isExpired }"
    tabindex="0"
    @click="handleCardClick"
    @keydown.enter="handleCardClick"
  >
    <!-- 卡片头部：slug + 状态标签 + 操作按钮 -->
    <div class="px-3 pt-3 pb-2 sm:px-4 sm:pt-4">
      <div class="flex items-start justify-between mb-2">
        <!-- Slug -->
        <h3
          class="text-sm sm:text-base font-medium truncate flex-1 mr-2"
          :class="isExpired ? 'text-red-600 dark:text-red-400' : 'text-primary-600 dark:text-primary-400'"
          :title="paste.slug"
        >
          {{ paste.slug }}
        </h3>

        <!-- 右侧：状态标签 + 操作按钮 -->
        <div class="flex items-center space-x-2 flex-shrink-0">
          <!-- 状态标签组 -->
          <div class="flex items-center space-x-1">
            <!-- 密码标签 -->
            <span
              v-if="paste.has_password"
              :class="[
                'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                darkMode ? 'bg-amber-500/15 text-amber-100 border-amber-400/30' : 'bg-amber-50 text-amber-700 border-amber-200',
              ]"
              title="密码保护"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="h-3.5 w-3.5" :class="darkMode ? 'text-amber-200' : 'text-amber-600'">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11V7a5 5 0 0110 0v4" />
                <rect stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x="6" y="11" width="12" height="9" rx="2" />
              </svg>
              <span class="leading-none">加密</span>
            </span>
            <!-- 过期标签 -->
            <span v-if="isExpired" class="px-1.5 py-0.5 text-xs font-medium rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">
              已过期
            </span>
          </div>

          <!-- 三点操作按钮 - 一直显示 -->
          <div class="relative">
            <button
              @click.stop="toggleDropdown"
              class="p-0.5 sm:p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              title="更多操作"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>

            <!-- 下拉菜单 -->
            <div
              v-if="showDropdown"
              class="absolute right-0 top-8 mt-1 w-40 rounded-md shadow-lg bg-white dark:bg-gray-700 ring-1 ring-black ring-opacity-5 z-10"
              @click.stop
            >
              <div class="py-1">
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
                  编辑
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

      <!-- 备注（如果有） -->
      <div v-if="paste.remark" class="mb-2 sm:mb-3">
        <div class="px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs sm:text-sm line-clamp-2" :title="paste.remark">
          {{ paste.remark }}
        </div>
      </div>

      <!-- 内容预览 - 移动端8行,桌面端10行 -->
      <div class="text-sm text-gray-700 dark:text-gray-300 mb-3 line-clamp-8 sm:line-clamp-10 whitespace-pre-wrap break-words leading-relaxed">
        {{ truncateContent(displayContent, 800) }}
      </div>
    </div>

    <!-- 卡片底部：元数据和操作 -->
    <div class="px-3 pb-2.5 sm:px-4 sm:pb-3">
      <!-- 元数据标签 -->
      <div class="flex flex-wrap gap-1.5 sm:gap-2 mb-2 sm:mb-3 text-xs">
        <!-- 创建者 -->
        <span :class="['px-1.5 py-0.5 sm:px-2 sm:py-1 rounded inline-flex items-center', creatorClass]">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {{ creatorLabel }}
        </span>

        <!-- 剩余次数 -->
        <span :class="['px-1.5 py-0.5 sm:px-2 sm:py-1 rounded inline-flex items-center', remainingViewsClass]">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          {{ remainingViews }}
        </span>

        <!-- 创建时间 -->
        <span class="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 inline-flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {{ formatRelativeTime(paste.created_at) }}
        </span>
      </div>

      <!-- 过期时间（如果有） -->
      <div v-if="paste.expires_at" class="text-xs" :class="expiryClass">
        <span class="inline-flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {{ formatRelativeTime(paste.expires_at) }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
