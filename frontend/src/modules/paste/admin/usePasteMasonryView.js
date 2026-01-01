/**
 * 文本瀑布流视图组合式函数
 * 管理文本瀑布流的列数、间距等配置
 */

import { ref, computed, watch } from "vue";
import { useLocalStorage, useWindowSize } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

export function usePasteMasonryView() {
  const log = createLogger("PasteMasonry");
  // ===== 设置持久化 =====

  const STORAGE_KEYS = {
    COLUMN_COUNT: "paste_masonry_column_count",
    HORIZONTAL_GAP: "paste_masonry_horizontal_gap",
    VERTICAL_GAP: "paste_masonry_vertical_gap",
  };

  // ===== 瀑布流设置状态 =====

  // 列数控制 - 默认值（自动）
  const columnCount = useLocalStorage(STORAGE_KEYS.COLUMN_COUNT, "auto");

  // 水平和垂直间距 - 默认值
  const horizontalGap = useLocalStorage(STORAGE_KEYS.HORIZONTAL_GAP, 16);
  const verticalGap = useLocalStorage(STORAGE_KEYS.VERTICAL_GAP, 16);

  // 工具栏状态管理
  const showViewSettings = ref(false);

  // 窗口宽度响应式状态
  const { width: windowWidth } = useWindowSize({ initialWidth: 1024 });

  // ===== MasonryWall配置 =====

  // MasonryWall的gap直接使用水平间距（控制列间距）
  const baseGap = computed(() => horizontalGap.value);

  // MasonryWall列宽配置 - 响应式列宽
  const columnWidth = computed(() => {
    // 移动端：较宽的卡片以适应单列显示
    if (windowWidth.value < 640) return 300; // 移动端：300px
    if (windowWidth.value < 1024) return 280; // 平板：280px
    return 260; // 桌面：260px
  });

  // 计算最小和最大列数 - 移动端优先
  const minColumns = computed(() => {
    if (columnCount.value === "auto") {
      return 1; // 自动模式：最少1列
    }
    const cols = parseInt(columnCount.value);
    return cols; // 固定列数模式：最小列数等于设定值
  });

  const maxColumns = computed(() => {
    if (columnCount.value === "auto") {
      // 自动模式：根据屏幕宽度限制最大列数
      if (windowWidth.value < 640) return 1; // 移动端：最多1列
      if (windowWidth.value < 1024) return 3; // 平板：最多3列
      return 4; // 桌面：最多4列
    }
    const cols = parseInt(columnCount.value);
    return cols; // 固定列数模式：最大列数等于设定值
  });

  // ===== 设置管理方法 =====

  // 检查是否为默认设置
  const isDefaultSettings = computed(() => {
    return columnCount.value === "auto" && horizontalGap.value === 16 && verticalGap.value === 16;
  });

  // 重置瀑布流设置到默认值
  const resetMasonrySettings = () => {
    // 重置到默认值
    columnCount.value = "auto";
    horizontalGap.value = 16;
    verticalGap.value = 16;

    // 清除存储中的设置
    columnCount.remove?.();
    horizontalGap.remove?.();
    verticalGap.remove?.();

    log.debug("文本瀑布流设置已重置为默认值");
  };

  // ===== 工具栏交互方法 =====

  const toggleViewSettings = () => {
    showViewSettings.value = !showViewSettings.value;
  };

  // ===== 监听器设置 =====

  // 监听设置变化（这里主要用于打印日志，持久化由 useLocalStorage 自动完成）
  const setupWatchers = () => {
    watch(columnCount, (newValue) => {
      log.debug(`文本瀑布流列数设置已保存: ${newValue}`);
    });

    watch(horizontalGap, (newValue) => {
      log.debug(`文本瀑布流水平间距设置已保存: ${newValue}px`);
    });

    watch(verticalGap, (newValue) => {
      log.debug(`文本瀑布流垂直间距设置已保存: ${newValue}px`);
    });
  };

  // 清理监听器
  const cleanupWatchers = () => {
  };

  // 返回所有需要的状态和方法
  return {
    // 设置状态
    columnCount,
    horizontalGap,
    verticalGap,
    showViewSettings,

    // MasonryWall配置
    baseGap,
    columnWidth,
    minColumns,
    maxColumns,

    // 设置管理
    isDefaultSettings,
    resetMasonrySettings,

    // 工具栏交互
    toggleViewSettings,

    // 初始化和清理方法
    setupWatchers,
    cleanupWatchers,
  };
}
