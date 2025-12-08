<template>
  <div class="skeleton-container">
    <div
      v-for="i in itemCount"
      :key="i"
      class="skeleton-item"
      :class="darkMode ? 'skeleton-item--dark' : 'skeleton-item--light'"
      :style="{ animationDelay: `${i * 100}ms` }"
    >
      <!-- 图标占位 -->
      <div class="skeleton-icon skeleton-pulse" />
      
      <!-- 文件名占位 -->
      <div class="skeleton-info">
        <div class="skeleton-name skeleton-pulse" :style="{ width: getWidth(i) }" />
        <!-- 移动端文件大小占位 -->
        <div class="skeleton-size-mobile skeleton-pulse" />
      </div>
      
      <!-- 文件大小占位（桌面端） -->
      <div class="skeleton-size skeleton-pulse" />
      
      <!-- 修改时间占位（桌面端） -->
      <div class="skeleton-time skeleton-pulse" />
      
      <!-- 操作按钮占位 -->
      <div class="skeleton-actions">
        <div class="skeleton-action skeleton-pulse" />
        <div class="skeleton-action skeleton-pulse" />
        <div class="skeleton-action skeleton-pulse" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
  count: {
    type: Number,
    default: 8,
  },
})

// 显示的骨架项数量
const itemCount = computed(() => Math.min(Math.max(props.count, 3), 12))

// 预生成固定的随机宽度数组，避免重渲染时跳变
const widthOptions = ['40%', '50%', '60%', '70%', '80%']
const preGeneratedWidths = computed(() => {
  // 使用固定种子生成伪随机序列，确保每个索引对应固定宽度
  return Array.from({ length: itemCount.value }, (_, i) => {
    // 使用简单的哈希算法生成稳定的伪随机索引
    const hash = (i * 2654435761) % widthOptions.length
    return widthOptions[Math.abs(hash)]
  })
})

// 获取指定索引的宽度
const getWidth = (index) => preGeneratedWidths.value[index - 1] || '60%'
</script>

<style scoped>
.skeleton-container {
  padding: 4px;
}

.skeleton-item {
  display: grid;
  align-items: center;
  height: var(--explorer-item-height, 48px);
  padding: 0 var(--explorer-padding, 12px);
  border-radius: var(--radius-md, 8px);
  margin: 2px 4px;
  grid-template-columns: var(--explorer-icon-size, 20px) 1fr auto;
  gap: var(--explorer-gap, 12px);
}

@media (min-width: 640px) {
  .skeleton-item {
    grid-template-columns: var(--explorer-icon-size, 20px) 1fr 6rem 9rem auto;
  }
}

/* 亮色模式 */
.skeleton-item--light {
  background: rgba(0, 0, 0, 0.02);
}

.skeleton-item--light .skeleton-pulse {
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
}

/* 暗色模式 */
.skeleton-item--dark {
  background: rgba(255, 255, 255, 0.02);
}

.skeleton-item--dark .skeleton-pulse {
  background: linear-gradient(90deg, #374151 25%, #4b5563 50%, #374151 75%);
  background-size: 200% 100%;
}

/* 脉冲动画 */
.skeleton-pulse {
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-sm, 4px);
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* 图标占位 */
.skeleton-icon {
  width: var(--explorer-icon-size, 20px);
  height: var(--explorer-icon-size, 20px);
  border-radius: var(--radius-sm, 4px);
}

/* 文件信息占位 */
.skeleton-info {
  min-width: 0;
}

.skeleton-name {
  height: calc(var(--explorer-font-size, 14px) + 2px);
  min-width: 100px;
}

/* 移动端文件大小占位 */
.skeleton-size-mobile {
  height: 12px;
  width: 50px;
  margin-top: 4px;
}

@media (min-width: 640px) {
  .skeleton-size-mobile {
    display: none;
  }
}

/* 桌面端文件大小和时间占位 */
.skeleton-size,
.skeleton-time {
  display: none;
  height: calc(var(--explorer-font-size, 14px) - 1px);
}

.skeleton-size {
  width: 60px;
}

.skeleton-time {
  width: 100px;
}

@media (min-width: 640px) {
  .skeleton-size,
  .skeleton-time {
    display: block;
  }
}

/* 操作按钮占位 */
.skeleton-actions {
  display: flex;
  gap: 4px;
  min-width: 80px;
  justify-content: flex-end;
}

@media (min-width: 640px) {
  .skeleton-actions {
    min-width: 120px;
    justify-content: center;
  }
}

.skeleton-action {
  width: 24px;
  height: 24px;
  border-radius: 9999px;
}

/* 禁用动画时 */
@media (prefers-reduced-motion: reduce) {
  .skeleton-pulse {
    animation: none;
  }
}
</style>
