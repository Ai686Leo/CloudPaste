<script setup>
// PasteViewOutline组件 - 实现文档大纲及分栏布局功能
// 该组件负责显示文档的标题结构，并允许用户通过拖动分隔线调整大纲与内容的比例
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { debugLog } from "./PasteViewUtils";

// 定义组件接收的属性
const props = defineProps({
  // 是否为暗色模式
  darkMode: {
    type: Boolean,
    required: true,
  },
  // 扁平化的大纲数据数组
  outlineData: {
    type: Array,
    default: () => [],
  },
  // 树形结构的大纲数据
  outlineTreeData: {
    type: Array,
    default: () => [],
  },
  // 原始Markdown内容
  content: {
    type: String,
    default: "",
  },
  // 是否为开发环境
  isDev: {
    type: Boolean,
    default: false,
  },
  // 是否启用调试日志
  enableDebug: {
    type: Boolean,
    default: false,
  },
});

// 定义组件可触发的事件
const emit = defineEmits(["heading-click"]);

// 分栏比例控制
const leftPanelWidth = ref(25); // 默认左侧面板宽度占比，单位为百分比
const isDragging = ref(false); // 是否正在拖动分隔线
const startX = ref(0); // 拖动开始时的X坐标
const startWidth = ref(0); // 拖动开始时的宽度

// 移动端适配和控制
const isMobile = ref(false); // 是否为移动设备
const isOutlineExpanded = ref(false); // 移动端下大纲是否展开

// 点击大纲项跳转到对应标题位置
const scrollToHeading = (id) => {
  if (!id) return;
  emit("heading-click", id);
};

// 切换大纲项的展开/折叠状态
const toggleOutlineItem = (item, event) => {
  // 阻止事件冒泡，防止触发点击跳转
  if (event) {
    event.stopPropagation();
  }

  // 如果该项有子项，切换展开/折叠状态
  if (item.children && item.children.length > 0) {
    item.expanded = !item.expanded;
  }
};

// 计算大纲项的缩进样式，根据层级设置不同的缩进
const getIndentStyle = (level) => {
  return {
    paddingLeft: `${(level - 1) * 1}rem`,
  };
};

// 开始拖动处理 - 分隔线拖动的核心实现
const startDrag = (e) => {
  isDragging.value = true;
  startX.value = e.clientX;
  startWidth.value = leftPanelWidth.value;

  // 添加全局事件监听，使拖动可以在整个窗口范围内进行
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", stopDrag);

  // 修改光标样式，提高用户体验
  document.body.style.cursor = "col-resize";
  // 防止选择文本，避免干扰拖动过程
  document.body.style.userSelect = "none";

  // 禁用右侧内容区域的滚动功能，避免拖动过程中内容滚动
  const contentScrollEl = document.querySelector(".content-scroll");
  if (contentScrollEl) {
    // 保存当前滚动位置，以便后续恢复
    contentScrollEl.setAttribute("data-scroll-top", contentScrollEl.scrollTop);
    contentScrollEl.classList.add("no-scroll");
    contentScrollEl.style.overflowY = "hidden";
  }

  // 禁用动画以避免拖动时出现延迟
  document.querySelector(".outline-grid-container")?.classList.add("dragging");
};

// 拖动过程处理 - 计算并更新面板宽度
const onDrag = (e) => {
  if (!isDragging.value) return;

  // 阻止默认行为和事件传播
  e.preventDefault();
  e.stopPropagation();

  // 计算拖动的距离，转换为百分比
  const containerWidth = document.querySelector(".outline-grid-container")?.clientWidth || 1000;
  const deltaX = e.clientX - startX.value;
  const deltaPercent = (deltaX / containerWidth) * 100;

  // 计算新的宽度，限制在10%~50%之间，避免面板过窄或过宽
  let newWidth = startWidth.value + deltaPercent;
  newWidth = Math.max(10, Math.min(50, newWidth));

  leftPanelWidth.value = newWidth;

  // 强制内容面板保持在正确位置
  const contentPanel = document.querySelector(".content-panel");
  if (contentPanel) {
    contentPanel.style.width = `${100 - newWidth}%`;
  }
};

// 停止拖动处理 - 清理事件监听和恢复原有状态
const stopDrag = () => {
  isDragging.value = false;
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", stopDrag);

  // 恢复光标样式
  document.body.style.cursor = "";
  document.body.style.userSelect = "";

  // 恢复右侧内容区域的滚动功能
  const contentScrollEl = document.querySelector(".content-scroll");
  if (contentScrollEl) {
    contentScrollEl.classList.remove("no-scroll");
    contentScrollEl.style.overflowY = "auto";

    // 恢复原来的滚动位置
    const savedScrollTop = contentScrollEl.getAttribute("data-scroll-top");
    if (savedScrollTop) {
      contentScrollTop = parseInt(savedScrollTop);
      contentScrollEl.scrollTop = contentScrollTop;
    }
  }

  // 移除拖动状态
  document.querySelector(".outline-grid-container")?.classList.remove("dragging");
};

// 计算左侧面板样式 - 使用计算属性动态更新样式
const leftPanelStyle = computed(() => {
  return {
    width: `${leftPanelWidth.value}%`,
  };
});

// 计算右侧面板样式 - 确保两侧面板宽度之和为100%
const rightPanelStyle = computed(() => {
  return {
    width: `${100 - leftPanelWidth.value}%`,
  };
});

// 检查是否为移动设备 - 根据屏幕宽度判断
const checkMobile = () => {
  isMobile.value = window.innerWidth < 768;
  // 在移动端默认收起大纲，优化小屏幕下的空间利用
  if (isMobile.value) {
    isOutlineExpanded.value = false;
  }
};

// 切换移动端大纲展开状态
const toggleOutlineOnMobile = () => {
  if (isMobile.value) {
    isOutlineExpanded.value = !isOutlineExpanded.value;
    debugLog(props.enableDebug, props.isDev, "切换移动端大纲状态:", isOutlineExpanded.value ? "展开" : "收起");
  }
};

// 监听窗口大小变化，动态适应布局
onMounted(() => {
  checkMobile();
  window.addEventListener("resize", checkMobile);
});

// 组件卸载时清理事件监听，避免内存泄漏
onBeforeUnmount(() => {
  window.removeEventListener("resize", checkMobile);
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", stopDrag);
});
</script>

<template>
  <!-- 大纲容器 - 主要布局结构，包含大纲和内容两个部分 -->
  <div class="outline-grid-container flex flex-col md:flex-row select-none outline-container-height" :class="{ dragging: isDragging }">
    <!-- 大纲区域 - 在手机端默认收起 -->
    <div
      class="outline-panel md:p-4 border-b md:border-b-0 md:border-r overflow-hidden flex flex-col transition-all duration-300"
      :class="[darkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-200 bg-gray-50', isMobile ? (isOutlineExpanded ? 'h-[300px]' : 'h-[48px]') : 'h-full']"
      :style="!isMobile ? leftPanelStyle : {}"
    >
      <!-- 大纲标题栏 - 在手机端可点击展开/收起 -->
      <div class="flex items-center justify-between p-3 md:p-0 md:mb-4 cursor-pointer md:cursor-default" @click="toggleOutlineOnMobile">
        <h3 class="text-lg font-medium" :class="[darkMode ? 'text-white' : 'text-gray-900']">文档大纲</h3>
        <!-- 手机端展开/收起按钮 -->
        <button class="md:hidden p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
          <svg class="w-5 h-5 transform transition-transform duration-300" :class="{ 'rotate-180': isOutlineExpanded }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      <!-- 大纲内容区域 - 使用v-show在移动端控制显示/隐藏 -->
      <div v-show="isOutlineExpanded || !isMobile" class="outline-container flex-1 overflow-y-auto pr-2 hide-scrollbar">
        <div v-if="outlineTreeData.length === 0" class="py-8 text-center text-gray-500">
          <p>无大纲信息</p>
        </div>

        <!-- 大纲树形结构 - 使用嵌套列表展示层级关系 -->
        <ul v-else class="space-y-1">
          <!-- 使用普通的嵌套列表替代递归组件，确保兼容性 -->
          <li v-for="(item, index) in outlineTreeData" :key="index" class="outline-item">
            <div class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors" @click="scrollToHeading(item.id)">
              <!-- 展开/折叠按钮 -->
              <button
                v-if="item.children && item.children.length > 0"
                @click.stop="toggleOutlineItem(item, $event)"
                class="mr-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                aria-label="展开或折叠子项"
              >
                <span v-if="item.expanded">▼</span>
                <span v-else>▶</span>
              </button>
              <span v-else class="w-5"></span>

              <!-- 标题文本 - 样式根据标题级别不同而不同 -->
              <span class="block truncate" :class="[item.level === 1 ? 'font-bold' : '', item.level === 2 ? 'font-semibold' : '', darkMode ? 'text-gray-200' : 'text-gray-800']">{{
                item.text
              }}</span>
            </div>

            <!-- 第二层 - 子标题列表 -->
            <ul v-if="item.children && item.children.length > 0 && item.expanded" class="pl-4 space-y-1 mt-1">
              <li v-for="(child, childIndex) in item.children" :key="`${index}-${childIndex}`" class="outline-item">
                <div class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors" @click="scrollToHeading(child.id)">
                  <button
                    v-if="child.children && child.children.length > 0"
                    @click.stop="toggleOutlineItem(child, $event)"
                    class="mr-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    aria-label="展开或折叠子项"
                  >
                    <span v-if="child.expanded">▼</span>
                    <span v-else>▶</span>
                  </button>
                  <span v-else class="w-5"></span>

                  <span
                    class="block truncate"
                    :class="[child.level === 1 ? 'font-bold' : '', child.level === 2 ? 'font-semibold' : '', darkMode ? 'text-gray-200' : 'text-gray-800']"
                    >{{ child.text }}</span
                  >
                </div>

                <!-- 第三层 -->
                <ul v-if="child.children && child.children.length > 0 && child.expanded" class="pl-4 space-y-1 mt-1">
                  <li v-for="(grandChild, grandChildIndex) in child.children" :key="`${index}-${childIndex}-${grandChildIndex}`" class="outline-item">
                    <div
                      class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors"
                      @click="scrollToHeading(grandChild.id)"
                    >
                      <button
                        v-if="grandChild.children && grandChild.children.length > 0"
                        @click.stop="toggleOutlineItem(grandChild, $event)"
                        class="mr-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        aria-label="展开或折叠子项"
                      >
                        <span v-if="grandChild.expanded">▼</span>
                        <span v-else>▶</span>
                      </button>
                      <span v-else class="w-5"></span>

                      <span
                        class="block truncate"
                        :class="[grandChild.level === 1 ? 'font-bold' : '', grandChild.level === 2 ? 'font-semibold' : '', darkMode ? 'text-gray-200' : 'text-gray-800']"
                        >{{ grandChild.text }}</span
                      >
                    </div>

                    <!-- 第四层 -->
                    <ul v-if="grandChild.children && grandChild.children.length > 0 && grandChild.expanded" class="pl-4 space-y-1 mt-1">
                      <li
                        v-for="(greatGrandChild, greatGrandChildIndex) in grandChild.children"
                        :key="`${index}-${childIndex}-${grandChildIndex}-${greatGrandChildIndex}`"
                        class="outline-item"
                      >
                        <div
                          class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors"
                          @click="scrollToHeading(greatGrandChild.id)"
                        >
                          <button
                            v-if="greatGrandChild.children && greatGrandChild.children.length > 0"
                            @click.stop="toggleOutlineItem(greatGrandChild, $event)"
                            class="mr-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            aria-label="展开或折叠子项"
                          >
                            <span v-if="greatGrandChild.expanded">▼</span>
                            <span v-else>▶</span>
                          </button>
                          <span v-else class="w-5"></span>

                          <span
                            class="block truncate"
                            :class="[
                              greatGrandChild.level === 1 ? 'font-bold' : '',
                              greatGrandChild.level === 2 ? 'font-semibold' : '',
                              darkMode ? 'text-gray-200' : 'text-gray-800',
                            ]"
                            >{{ greatGrandChild.text }}</span
                          >
                        </div>

                        <!-- 第五层 -->
                        <ul v-if="greatGrandChild.children && greatGrandChild.children.length > 0 && greatGrandChild.expanded" class="pl-4 space-y-1 mt-1">
                          <li
                            v-for="(lvl5Child, lvl5Index) in greatGrandChild.children"
                            :key="`${index}-${childIndex}-${grandChildIndex}-${greatGrandChildIndex}-${lvl5Index}`"
                            class="outline-item"
                          >
                            <div
                              class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors"
                              @click="scrollToHeading(lvl5Child.id)"
                            >
                              <button
                                v-if="lvl5Child.children && lvl5Child.children.length > 0"
                                @click.stop="toggleOutlineItem(lvl5Child, $event)"
                                class="mr-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                aria-label="展开或折叠子项"
                              >
                                <span v-if="lvl5Child.expanded">▼</span>
                                <span v-else>▶</span>
                              </button>
                              <span v-else class="w-5"></span>

                              <span class="block truncate" :class="[darkMode ? 'text-gray-300' : 'text-gray-700']">{{ lvl5Child.text }}</span>
                            </div>

                            <!-- 第六层 - 最后一层，不再提供折叠功能 -->
                            <ul v-if="lvl5Child.children && lvl5Child.children.length > 0 && lvl5Child.expanded" class="pl-4 space-y-1 mt-1">
                              <li
                                v-for="(lvl6Child, lvl6Index) in lvl5Child.children"
                                :key="`${index}-${childIndex}-${grandChildIndex}-${greatGrandChildIndex}-${lvl5Index}-${lvl6Index}`"
                                class="outline-item"
                              >
                                <div
                                  class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors"
                                  @click="scrollToHeading(lvl6Child.id)"
                                >
                                  <span class="w-5"></span>
                                  <span class="block truncate" :class="[darkMode ? 'text-gray-400' : 'text-gray-600']">{{ lvl6Child.text }}</span>
                                </div>
                              </li>
                            </ul>
                          </li>
                        </ul>
                      </li>
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </div>

    <!-- 可拖动分隔线 - 仅在桌面端显示，实现分栏拖拽调整 -->
    <div class="resizer-handle hidden md:block" @mousedown.prevent="startDrag" :class="darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'"></div>

    <!-- 右侧内容区域 - 使用slot接收实际内容 -->
    <div
      class="content-panel h-full md:relative flex-grow flex flex-col overflow-hidden"
      :class="[isMobile ? 'w-full' : '', isOutlineExpanded ? 'h-[calc(100%-300px)] md:h-full' : 'h-[calc(100%-48px)] md:h-full', isDragging ? 'dragging' : '']"
      :style="isMobile ? {} : rightPanelStyle"
    >
      <!-- 内容区域，使用slot允许父组件插入具体内容 -->
      <slot name="content"></slot>
    </div>
  </div>
</template>

<style scoped>
/* 大纲容器高度 - 响应式设计，根据屏幕高度调整 */
.outline-container-height {
  height: calc(80vh - 150px);
  min-height: 600px;
  max-height: 1000px;
}

/* 小屏幕设备的大纲容器高度 */
@media (max-height: 800px) {
  .outline-container-height {
    height: calc(85vh - 120px);
    min-height: 500px;
  }
}

/* 大屏幕设备的大纲容器高度 */
@media (min-height: 1000px) {
  .outline-container-height {
    height: calc(75vh - 150px);
    min-height: 700px;
    max-height: 1200px;
  }
}

/* 可拖动分隔线样式 */
.outline-grid-container {
  position: relative;
  /* 防止拖动过程中文本被选中 */
  user-select: none;
  width: 100%;
  overflow: hidden; /* 防止内容溢出 */
}

/* 拖动状态下的特殊处理 */
.outline-grid-container.dragging {
  pointer-events: none; /* 拖动时禁用所有指针事件 */
  cursor: col-resize !important; /* 确保整个容器显示拖动光标 */
}

.outline-grid-container.dragging .resizer-handle {
  pointer-events: auto !important; /* 确保分隔线仍可拖动 */
  z-index: 30;
}

/* 左右面板基本样式 */
.outline-panel,
.content-panel {
  transition: none; /* 移除过渡动画，避免拖动时的延迟感 */
  position: relative; /* 确保定位上下文 */
}

.outline-panel {
  min-width: 0;
}

.content-panel.dragging {
  overflow: hidden;
}

/* 拖动手柄样式 */
.resizer-handle {
  width: 14px; /* 增加手柄宽度，更容易抓取 */
  margin: 0 -7px; /* 负边距使手柄偏移，防止拖动时影响内容区域 */
  cursor: col-resize;
  height: 100%;
  z-index: 20; /* 提高z-index确保在最上层 */
  transition: background-color 0.2s;
  position: relative;
  flex-shrink: 0; /* 防止手柄被压缩 */
}

.resizer-handle:hover {
  opacity: 1;
  background-color: v-bind('darkMode ? "rgba(75, 85, 99, 0.4)" : "rgba(229, 231, 235, 0.6)"');
}

.resizer-handle:active {
  opacity: 1;
  background-color: v-bind('darkMode ? "rgba(75, 85, 99, 0.6)" : "rgba(229, 231, 235, 0.8)"');
}

/* 拖动手柄中间的线条 */
.resizer-handle::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  height: 4rem;
  width: 2px;
  background-color: currentColor;
  opacity: 0.7;
}

/* 隐藏大纲区域的滚动条，但保留滚动功能，提升UI美观度 */
.hide-scrollbar {
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
}

.hide-scrollbar::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Opera*/
  width: 0;
  height: 0;
}

/* 解决大纲模式下的内容布局问题 */
@media (min-width: 768px) {
  .outline-grid-container .content-panel ::v-deep(.content-scroll) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }
}

/* 大纲模式样式 */
:deep(.vditor-outline) {
  background-color: v-bind('darkMode ? "#1F2937" : "#F9FAFB"');
  border-right: 1px solid v-bind('darkMode ? "#374151" : "#E5E7EB"');
}

:deep(.outline-item) {
  margin-bottom: 2px;
}

/* 移动端大纲样式优化 */
@media (max-width: 768px) {
  /* 移动端响应式设计，调整高度和过渡效果 */
  .outline-container-height {
    height: auto;
    min-height: auto;
    max-height: none;
  }

  .outline-panel {
    transition: height 0.3s ease-in-out;
    min-width: 0; /* 移动端最小宽度 */
    width: 100% !important;
  }

  .outline-container {
    max-height: 250px;
    overflow-y: auto;
  }

  .content-panel {
    transition: height 0.3s ease-in-out;
    width: 100% !important;
  }
}
</style>
