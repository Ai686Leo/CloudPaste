/**
 * 设计令牌 Composable
 * 
 * 提供设计令牌的访问和 CSS 变量注入功能
 */
import { ref, computed, onBeforeUnmount } from 'vue'
import tokens, { 
  spacing, 
  radius, 
  duration, 
  easing, 
  elevation, 
  elevationDark,
  explorerDensity,
  explorerAnimation,
  semanticColors 
} from '@/styles/design-tokens'

// 模块级响应式暗色模式状态
const isDarkModeRef = ref(document.documentElement.classList.contains('dark'))

// 模块级暗色模式观察器（单例）
let globalDarkModeObserver = null
let observerRefCount = 0

/**
 * 初始化全局暗色模式观察器
 */
function initGlobalDarkModeObserver() {
  if (globalDarkModeObserver) return
  
  globalDarkModeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class') {
        isDarkModeRef.value = document.documentElement.classList.contains('dark')
      }
    })
  })
  
  globalDarkModeObserver.observe(document.documentElement, { 
    attributes: true,
    attributeFilter: ['class']
  })
}

/**
 * 设计令牌 Composable
 * @returns {Object} 设计令牌和工具函数
 */
export function useDesignTokens() {
  // 使用响应式的暗色模式状态
  const isDarkMode = computed(() => isDarkModeRef.value)

  // 获取当前主题的阴影
  const currentElevation = computed(() => {
    return isDarkMode.value ? elevationDark : elevation
  })

  // 获取当前主题的语义化颜色
  const currentColors = computed(() => {
    return isDarkMode.value ? semanticColors.dark : semanticColors.light
  })

  /**
   * 注入基础 CSS 变量到 document root
   */
  function injectBaseVariables() {
    const root = document.documentElement
    const colors = currentColors.value
    const shadows = currentElevation.value

    // 间距变量
    Object.entries(spacing).forEach(([key, value]) => {
      root.style.setProperty(`--spacing-${key}`, value)
    })

    // 圆角变量
    Object.entries(radius).forEach(([key, value]) => {
      root.style.setProperty(`--radius-${key}`, value)
    })

    // 动画时长变量
    Object.entries(duration).forEach(([key, value]) => {
      root.style.setProperty(`--duration-${key}`, value)
    })

    // 缓动函数变量
    Object.entries(easing).forEach(([key, value]) => {
      root.style.setProperty(`--easing-${key}`, value)
    })

    // 阴影变量
    Object.entries(shadows).forEach(([key, value]) => {
      root.style.setProperty(`--elevation-${key}`, value)
    })

    // 语义化颜色变量
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value)
    })
  }

  /**
   * 获取间距值
   * @param {string} key - 间距键名
   * @returns {string} 间距值
   */
  function getSpacing(key) {
    return spacing[key] || spacing['4']
  }

  /**
   * 获取圆角值
   * @param {string} key - 圆角键名
   * @returns {string} 圆角值
   */
  function getRadius(key) {
    return radius[key] || radius.md
  }

  /**
   * 获取动画时长
   * @param {string} key - 时长键名
   * @returns {string} 时长值
   */
  function getDuration(key) {
    return duration[key] || duration.normal
  }

  /**
   * 获取阴影值
   * @param {number} level - 阴影层级 (0-4)
   * @returns {string} 阴影值
   */
  function getElevation(level) {
    return currentElevation.value[level] || currentElevation.value[0]
  }

  /**
   * 获取密度配置
   * @param {string} density - 密度名称
   * @returns {Object} 密度配置对象
   */
  function getDensityConfig(density) {
    return explorerDensity[density] || explorerDensity.comfortable
  }

  /**
   * 生成 CSS 变量字符串（用于内联样式）
   * @param {Object} vars - 变量对象 { name: value }
   * @returns {string} CSS 变量字符串
   */
  function toCSSVars(vars) {
    return Object.entries(vars)
      .map(([key, value]) => `--${key}: ${value}`)
      .join('; ')
  }

  /**
   * 设置暗色模式观察器（自动管理生命周期）
   */
  function setupDarkModeObserver() {
    initGlobalDarkModeObserver()
    observerRefCount++
    
    // 在组件卸载时自动清理
    onBeforeUnmount(() => {
      observerRefCount--
      if (observerRefCount <= 0 && globalDarkModeObserver) {
        globalDarkModeObserver.disconnect()
        globalDarkModeObserver = null
        observerRefCount = 0
      }
    })
  }

  /**
   * 清理暗色模式观察器（手动调用）
   */
  function cleanupDarkModeObserver() {
    observerRefCount--
    if (observerRefCount <= 0 && globalDarkModeObserver) {
      globalDarkModeObserver.disconnect()
      globalDarkModeObserver = null
      observerRefCount = 0
    }
  }

  return {
    // 令牌数据
    tokens,
    spacing,
    radius,
    duration,
    easing,
    elevation: currentElevation,
    colors: currentColors,
    explorerDensity,
    explorerAnimation,
    
    // 状态
    isDarkMode,
    
    // 方法
    injectBaseVariables,
    getSpacing,
    getRadius,
    getDuration,
    getElevation,
    getDensityConfig,
    toCSSVars,
    setupDarkModeObserver,
    cleanupDarkModeObserver,
  }
}

export default useDesignTokens
