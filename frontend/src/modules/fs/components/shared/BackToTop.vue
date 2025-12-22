<template>
  <!-- 返回顶部按钮 - 位于 FAB 左侧，避免冲突 -->
  <Teleport to="body">
    <Transition name="fade-scale">
      <button
        v-if="isVisible"
        @click="scrollToTop"
        class="fixed bottom-4 right-16 z-40 p-2.5 rounded-full shadow-lg transition-all duration-200"
        :class="darkMode 
          ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-gray-100' 
          : 'bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-900 border border-gray-200'"
        :title="t('common.backToTop')"
      >
        <IconArrowUp size="sm" class="w-4 h-4" aria-hidden="true" />
      </button>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { IconArrowUp } from '@/components/icons'

const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false
  },
  threshold: {
    type: Number,
    default: 300
  }
})

const { t } = useI18n()
const isVisible = ref(false)

// 滚动事件处理
function handleScroll() {
  isVisible.value = window.scrollY > props.threshold
}

// 平滑滚动到顶部
function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  })
}

// 节流函数
function throttle(fn, delay) {
  let lastCall = 0
  return function (...args) {
    const now = Date.now()
    if (now - lastCall >= delay) {
      lastCall = now
      fn.apply(this, args)
    }
  }
}

const throttledScroll = throttle(handleScroll, 100)

onMounted(() => {
  window.addEventListener('scroll', throttledScroll, { passive: true })
  handleScroll() // 初始检查
})

onUnmounted(() => {
  window.removeEventListener('scroll', throttledScroll)
})
</script>

<style scoped>
/* 淡入缩放动画 */
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
</style>
