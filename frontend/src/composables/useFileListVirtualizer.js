/**
 * 文件列表虚拟滚动 Composable
 * 
 * 使用 TanStack Virtual 实现高性能虚拟滚动
 * 支持大量文件（1000+）的流畅渲染
 * 
 * @author Codex
 * @date 2024-12-07
 */

import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

/**
 * 文件列表虚拟滚动 Hook
 * 
 * @param {Object} options - 配置选项
 * @param {Ref<Array>} options.items - 文件列表数据
 * @param {Ref<HTMLElement>} options.containerRef - 滚动容器引用
 * @param {number} options.itemHeight - 每项高度（默认 48px）
 * @param {number} options.overscan - 缓冲区项目数（默认 10）
 * @param {boolean} options.enabled - 是否启用虚拟滚动（默认 true）
 * @returns {Object} 虚拟滚动相关方法和状态
 */
export function useFileListVirtualizer(options = {}) {
  const {
    items,
    containerRef,
    itemHeight = 48,
    overscan = 10,
    enabled = true,
  } = options

  // 虚拟滚动实例
  const virtualizerInstance = ref(null)

  // 是否启用虚拟滚动（文件数量超过阈值时启用）
  const VIRTUAL_SCROLL_THRESHOLD = 100
  const shouldVirtualize = computed(() => {
    return enabled && items.value && items.value.length > VIRTUAL_SCROLL_THRESHOLD
  })

  // 创建虚拟滚动器
  const createVirtualizer = () => {
    if (!containerRef.value || !shouldVirtualize.value) {
      return null
    }

    return useVirtualizer({
      count: items.value.length,
      getScrollElement: () => containerRef.value,
      estimateSize: () => itemHeight,
      overscan: overscan,
      scrollMargin: 0,
    })
  }

  // 监听 items 变化，更新虚拟滚动器
  watch(
    () => items.value?.length,
    () => {
      if (shouldVirtualize.value && virtualizerInstance.value) {
        // 通知虚拟滚动器数据已更新
        virtualizerInstance.value.measure()
      }
    }
  )

  // 初始化
  onMounted(() => {
    if (shouldVirtualize.value) {
      virtualizerInstance.value = createVirtualizer()
    }
  })

  // 获取虚拟项目列表
  const virtualItems = computed(() => {
    if (!shouldVirtualize.value || !virtualizerInstance.value) {
      return null
    }
    return virtualizerInstance.value.getVirtualItems()
  })

  // 获取总高度
  const totalSize = computed(() => {
    if (!shouldVirtualize.value || !virtualizerInstance.value) {
      return 0
    }
    return virtualizerInstance.value.getTotalSize()
  })

  // 滚动到指定索引
  const scrollToIndex = (index, options = {}) => {
    if (virtualizerInstance.value) {
      virtualizerInstance.value.scrollToIndex(index, {
        align: 'start',
        ...options,
      })
    }
  }

  // 滚动到顶部
  const scrollToTop = () => {
    scrollToIndex(0)
  }

  // 滚动到底部
  const scrollToBottom = () => {
    if (items.value?.length > 0) {
      scrollToIndex(items.value.length - 1)
    }
  }

  return {
    // 状态
    shouldVirtualize,
    virtualItems,
    totalSize,
    virtualizerInstance,
    
    // 方法
    scrollToIndex,
    scrollToTop,
    scrollToBottom,
    
    // 常量
    VIRTUAL_SCROLL_THRESHOLD,
  }
}

export default useFileListVirtualizer
