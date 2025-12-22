<template>
  <div
    class="file-item group"
    :class="[
      isSelected ? 'file-item--selected' : '',
      isContextHighlight && !isSelected ? 'file-item--context-highlight' : '',
      isEntering && animationsEnabled ? 'file-item--entering' : '',
      darkMode ? 'file-item--dark' : 'file-item--light'
    ]"
    :style="{ '--enter-delay': `${enterDelay}ms` }"
    @click="handleClick"
    @contextmenu.prevent="handleContextMenu"
  >
    <!-- 勾选框 (根据全局设置显示) -->
    <div v-if="showCheckboxes" class="file-item__checkbox" @click.stop="toggleSelect">
      <input
        type="checkbox"
        :checked="isSelected"
        class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
        :class="darkMode ? 'bg-gray-700 border-gray-500' : ''"
      />
    </div>

    <!-- 文件/文件夹图标 -->
    <div class="file-item__icon">
      <span v-html="fileIcon"></span>
    </div>

    <!-- 文件/文件夹名称 -->
    <div class="file-item__info" @click="handleClick">
      <div 
        class="file-item__name" 
        :class="[
          darkMode ? 'text-gray-200' : 'text-gray-700',
          `file-item__name--${fileNameOverflow}`
        ]"
        :title="fileNameOverflow === 'ellipsis' ? item.name : undefined"
      >
        {{ item.name }}
      </div>
      <!-- 移动端文件大小显示 -->
      <div class="file-item__size-mobile" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        <span v-if="item.isDirectory && item.isVirtual">-</span>
        <span v-else :title="sizeTitle">
          {{ formatSize(item.size) }}
          <span v-if="sizeMarker" class="file-item__meta-marker">{{ sizeMarker }}</span>
        </span>
      </div>
    </div>

    <!-- 文件大小（桌面端） -->
    <div class="file-item__size" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
      <span v-if="item.isDirectory && item.isVirtual">-</span>
      <span v-else :title="sizeTitle">
        {{ formatSize(item.size) }}
        <span v-if="sizeMarker" class="file-item__meta-marker">{{ sizeMarker }}</span>
      </span>
    </div>

    <!-- 修改时间（桌面端） -->
    <div class="file-item__time" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
      <span v-if="item.isDirectory && item.isVirtual">-</span>
      <span v-else :title="modifiedTitle">
        {{ formatDate(item.modified) }}
        <span v-if="modifiedMarker" class="file-item__meta-marker">{{ modifiedMarker }}</span>
      </span>
    </div>

    <!-- 操作按钮 (根据设置显示/隐藏) -->
    <div v-if="showActionButtons" class="file-item__actions">
      <div class="file-item__actions-inner">
        <!-- 下载按钮（只对文件显示）-->
        <button
          v-if="!item.isDirectory"
          @click.stop="$emit('download', item)"
          class="file-item__action-btn"
          :class="darkMode ? 'file-item__action-btn--download-dark' : 'file-item__action-btn--download-light'"
          :title="t('mount.fileItem.download')"
        >
          <IconDownload class="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
        </button>

        <!-- 直链按钮（只对文件显示）-->
        <button
          v-if="!item.isDirectory"
          @click.stop="$emit('getLink', item)"
          class="file-item__action-btn"
          :class="darkMode ? 'file-item__action-btn--link-dark' : 'file-item__action-btn--link-light'"
          :title="t('mount.fileItem.getLink')"
        >
          <IconLink class="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
        </button>

        <!-- 重命名按钮 -->
        <button
          v-if="!item.isDirectory"
          @click.stop="$emit('rename', item)"
          class="file-item__action-btn"
          :class="darkMode ? 'file-item__action-btn--rename-dark' : 'file-item__action-btn--rename-light'"
          :title="t('mount.fileItem.rename')"
        >
          <IconRename class="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
        </button>

        <!-- 删除按钮 -->
        <button
          @click.stop="$emit('delete', item)"
          class="file-item__action-btn"
          :class="darkMode ? 'file-item__action-btn--delete-dark' : 'file-item__action-btn--delete-light'"
          :title="t('mount.fileItem.delete')"
        >
          <IconDelete class="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { IconDelete, IconDownload, IconLink, IconRename } from "@/components/icons";
import { formatFileSize } from "@/utils/fileUtils.js";
import { getFileIcon as getFileIconSvg } from "@/utils/fileTypeIcons.js";
import { formatDateTime } from "@/utils/timeUtils.js";

const { t } = useI18n();

const props = defineProps({
  item: { type: Object, required: true },
  darkMode: { type: Boolean, default: false },
  showCheckboxes: { type: Boolean, default: false },
  isSelected: { type: Boolean, default: false },
  // 右键菜单高亮状态（临时高亮，不是勾选选中）
  isContextHighlight: { type: Boolean, default: false },
  currentPath: { type: String, required: true },
  index: { type: Number, default: 0 },
  animationsEnabled: { type: Boolean, default: true },
  // 文件名过长处理模式: ellipsis(省略号) | scroll(滚动) | wrap(换行)
  fileNameOverflow: { type: String, default: 'ellipsis' },
  // 是否显示操作按钮列
  showActionButtons: { type: Boolean, default: true },
});

const emit = defineEmits(["click", "download", "rename", "delete", "select", "getLink", "contextmenu"]);

// 缓存文件图标 SVG，避免每次渲染重复计算
const fileIcon = computed(() => getFileIconSvg(props.item, props.darkMode));

// 入场动画状态
const isEntering = ref(true);
const enterDelay = computed(() => Math.min(props.index * 30, 300));

// 组件挂载后移除入场动画状态
onMounted(() => {
  if (props.animationsEnabled) {
    setTimeout(() => {
      isEntering.value = false;
    }, 300 + enterDelay.value);
  } else {
    isEntering.value = false;
  }
});

// 处理点击事件
const handleClick = () => {
  emit("click", props.item);
};

// 添加选择功能
const toggleSelect = () => {
  emit("select", props.item, !props.isSelected);
};

// 处理右键菜单
const handleContextMenu = (event) => {
  emit("contextmenu", { event, item: props.item });
};

const isValidSize = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

// 格式化日期
const formatDate = (dateString) => {
  if (!dateString) return "-";
  return formatDateTime(dateString);
};

// 格式化大小：未知则显示 "-"
const formatSize = (value) => {
  if (!isValidSize(value)) return "-";
  return formatFileSize(value);
};

const sizeMarker = computed(() => {
  if (!props.item?.isDirectory || props.item?.isVirtual) return "";
  if (!isValidSize(props.item?.size)) return "";
  if (props.item?.size_source === "index") return "≈";
  if (props.item?.size_source === "compute") return "*";
  return "";
});

const sizeTitle = computed(() => {
  if (!props.item?.isDirectory || props.item?.isVirtual) return undefined;
  if (!isValidSize(props.item?.size)) return undefined;
  if (props.item?.size_source === "index") return "索引计算（无法实时）";
  if (props.item?.size_source === "compute") return "递归计算（性能损耗）";
  return undefined;
});

const modifiedMarker = computed(() => {
  if (!props.item?.isDirectory || props.item?.isVirtual) return "";
  if (!props.item?.modified) return "";
  if (props.item?.modified_source === "index") return "≈";
  if (props.item?.modified_source === "compute") return "*";
  return "";
});

const modifiedTitle = computed(() => {
  if (!props.item?.isDirectory || props.item?.isVirtual) return undefined;
  if (!props.item?.modified) return undefined;
  if (props.item?.modified_source === "index") return "时间来自索引兜底（不一定实时）";
  if (props.item?.modified_source === "compute") return "时间来自递归计算（可能较慢）";
  return undefined;
});
</script>

<style scoped>
/* 基础样式 - 使用 CSS 变量 */
/* 基础样式 - 移除左边框，只用背景高亮 */
.file-item {
  display: grid;
  align-items: center;
  height: var(--explorer-item-height, 48px);
  padding: 0 var(--explorer-padding, 12px);
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  transition: all var(--duration-fast, 150ms) var(--easing-default, cubic-bezier(0.4, 0, 0.2, 1));
  /* 使用 CSS 变量控制文件间距 */
  margin: var(--explorer-item-spacing, 2px) 4px;
}

/* 网格布局 - 默认无操作列 */
.file-item {
  grid-template-columns: var(--explorer-icon-size, 20px) 1fr;
  gap: var(--explorer-gap, 12px);
}

@media (min-width: 640px) {
  .file-item {
    grid-template-columns: var(--explorer-icon-size, 20px) 1fr 6rem 9rem;
  }
}

/* 有操作列时的网格布局 */
.file-item:has(.file-item__actions) {
  grid-template-columns: var(--explorer-icon-size, 20px) 1fr auto;
}

@media (min-width: 640px) {
  .file-item:has(.file-item__actions) {
    grid-template-columns: var(--explorer-icon-size, 20px) 1fr 6rem 9rem auto;
  }
}

/* 显示勾选框时的网格布局 - 无操作列 */
.file-item:has(.file-item__checkbox):not(:has(.file-item__actions)) {
  grid-template-columns: auto var(--explorer-icon-size, 20px) 1fr;
}

@media (min-width: 640px) {
  .file-item:has(.file-item__checkbox):not(:has(.file-item__actions)) {
    grid-template-columns: auto var(--explorer-icon-size, 20px) 1fr 6rem 9rem;
  }
}

/* 显示勾选框时的网格布局 - 有操作列 */
.file-item:has(.file-item__checkbox):has(.file-item__actions) {
  grid-template-columns: auto var(--explorer-icon-size, 20px) 1fr auto;
}

@media (min-width: 640px) {
  .file-item:has(.file-item__checkbox):has(.file-item__actions) {
    grid-template-columns: auto var(--explorer-icon-size, 20px) 1fr 6rem 9rem auto;
  }
}

.file-item__meta-marker {
  margin-left: 4px;
  font-size: 0.75em;
  opacity: 0.7;
}

/* 亮色模式 hover */
.file-item--light:hover {
  background: var(--explorer-hover, rgba(0, 0, 0, 0.04));
  transform: scale(1.005);
}

/* 暗色模式 hover */
.file-item--dark:hover {
  background: var(--explorer-hover, rgba(255, 255, 255, 0.06));
  transform: scale(1.005);
}

/* 选中状态 - 亮色（仅背景高亮，无左边框） */
.file-item--light.file-item--selected {
  background: var(--explorer-selected, rgba(59, 130, 246, 0.12));
}

/* 选中状态 - 暗色（仅背景高亮，无左边框） */
.file-item--dark.file-item--selected {
  background: var(--explorer-selected, rgba(59, 130, 246, 0.25));
}

/* 右键菜单高亮状态 - 亮色（临时高亮，不是勾选） */
.file-item--light.file-item--context-highlight {
  background: var(--explorer-hover, rgba(59, 130, 246, 0.08));
}

/* 右键菜单高亮状态 - 暗色 */
.file-item--dark.file-item--context-highlight {
  background: var(--explorer-hover, rgba(59, 130, 246, 0.15));
}

/* 入场动画 */
.file-item--entering {
  animation: fadeInScale var(--explorer-animation-duration, 200ms) var(--easing-out, cubic-bezier(0, 0, 0.2, 1)) forwards;
  animation-delay: var(--enter-delay, 0ms);
  opacity: 0;
}

@keyframes fadeInScale {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* 勾选框 - 增加内边距扩大点击区域 */
.file-item__checkbox {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 8px;
  margin: -8px;
  cursor: pointer;
}

/* 图标 */
.file-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--explorer-icon-size, 20px);
  height: var(--explorer-icon-size, 20px);
  flex-shrink: 0;
}

.file-item__icon :deep(svg) {
  width: 100%;
  height: 100%;
}

/* 文件信息 */
.file-item__info {
  min-width: 0;
  flex-grow: 1;
}

.file-item__name {
  font-size: var(--explorer-font-size, 14px);
  font-weight: 500;
}

/* 文件名过长处理模式 - 省略号（默认） */
.file-item__name--ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 文件名过长处理模式 - 滚动 */
.file-item__name--scroll {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
}

.file-item__name--scroll:hover {
  overflow: visible;
}

.file-item__name--scroll:hover::after {
  content: attr(data-name);
  position: absolute;
  left: 0;
  top: 0;
  white-space: nowrap;
  animation: scrollText 5s linear infinite;
  background: inherit;
  z-index: 10;
}

@keyframes scrollText {
  0%, 10% { transform: translateX(0); }
  90%, 100% { transform: translateX(calc(-100% + 100px)); }
}

/* 文件名过长处理模式 - 换行 */
.file-item__name--wrap {
  white-space: normal;
  word-break: break-word;
  line-height: 1.3;
}

/* 移动端文件大小 */
.file-item__size-mobile {
  font-size: calc(var(--explorer-font-size, 14px) - 2px);
  margin-top: 2px;
}

@media (min-width: 640px) {
  .file-item__size-mobile {
    display: none;
  }
}

/* 桌面端文件大小和时间 */
.file-item__size,
.file-item__time {
  display: none;
  font-size: calc(var(--explorer-font-size, 14px) - 1px);
  text-align: center;
  white-space: nowrap;
}

@media (min-width: 640px) {
  .file-item__size,
  .file-item__time {
    display: block;
  }
}

/* 操作按钮容器 */
.file-item__actions {
  min-width: 80px;
}

@media (min-width: 640px) {
  .file-item__actions {
    min-width: 120px;
  }
}

.file-item__actions-inner {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  /* 移动端始终显示 */
  opacity: 1;
  transition: opacity var(--duration-fast, 150ms);
}

/* 桌面端：始终显示操作按钮 */
@media (min-width: 640px) {
  .file-item__actions-inner {
    justify-content: center;
  }
}

/* 操作按钮基础样式 */
.file-item__action-btn {
  padding: 4px;
  border-radius: 9999px;
  transition: all var(--duration-fast, 150ms);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 下载按钮 */
.file-item__action-btn--download-light {
  color: rgb(37, 99, 235);
}
.file-item__action-btn--download-light:hover {
  background: rgb(229, 231, 235);
  color: rgb(29, 78, 216);
}
.file-item__action-btn--download-dark {
  color: rgb(96, 165, 250);
}
.file-item__action-btn--download-dark:hover {
  background: rgb(75, 85, 99);
  color: rgb(147, 197, 253);
}

/* 链接按钮 */
.file-item__action-btn--link-light {
  color: rgb(22, 163, 74);
}
.file-item__action-btn--link-light:hover {
  background: rgb(229, 231, 235);
  color: rgb(21, 128, 61);
}
.file-item__action-btn--link-dark {
  color: rgb(74, 222, 128);
}
.file-item__action-btn--link-dark:hover {
  background: rgb(75, 85, 99);
  color: rgb(134, 239, 172);
}

/* 重命名按钮 */
.file-item__action-btn--rename-light {
  color: rgb(202, 138, 4);
}
.file-item__action-btn--rename-light:hover {
  background: rgb(229, 231, 235);
  color: rgb(161, 98, 7);
}
.file-item__action-btn--rename-dark {
  color: rgb(250, 204, 21);
}
.file-item__action-btn--rename-dark:hover {
  background: rgb(75, 85, 99);
  color: rgb(253, 224, 71);
}

/* 删除按钮 */
.file-item__action-btn--delete-light {
  color: rgb(220, 38, 38);
}
.file-item__action-btn--delete-light:hover {
  background: rgb(229, 231, 235);
  color: rgb(185, 28, 28);
}
.file-item__action-btn--delete-dark {
  color: rgb(248, 113, 113);
}
.file-item__action-btn--delete-dark:hover {
  background: rgb(75, 85, 99);
  color: rgb(252, 165, 165);
}

/* 禁用动画时移除所有过渡 */
@media (prefers-reduced-motion: reduce) {
  .file-item,
  .file-item__actions-inner,
  .file-item__action-btn {
    transition: none;
  }
  
  .file-item--entering {
    animation: none;
    opacity: 1;
  }
}
</style>
