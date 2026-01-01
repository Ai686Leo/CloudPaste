/**
 * 文件浏览器用户配置 Composable
 * 
 * 管理用户的视图偏好设置，支持 localStorage 持久化
 * 配置变更时自动注入 CSS 变量
 */
import { ref, watch, computed } from 'vue'
import { useLocalStorage, useMutationObserver } from '@vueuse/core'
import { defineStore } from 'pinia'
import { semanticColors } from '@/styles/design-tokens'
import { createLogger } from '@/utils/logger.js'

const log = createLogger('ExplorerSettings')

const STORAGE_KEY = 'cloudpaste-explorer-settings'

// 默认配置
const defaultSettings = {
  viewMode: 'list',           // list | grid | gallery
  densityValue: 50,           // 默认舒适密度：图标 ~22px，行高 ~51px
  animationsEnabled: true,
  showActionButtons: true,    // 是否显示操作按钮列
  spacingValue: 0,            // 默认无间距，文件项紧密排列
  sortBy: 'name',             // name | size | modified | type
  sortOrder: 'asc',           // asc | desc
  foldersFirst: true,
  fileNameOverflow: 'ellipsis', // ellipsis | scroll | wrap
  showCheckboxes: true,       // 是否默认显示勾选框
}

// 密度值范围映射
const densityRanges = {
  itemHeight: { min: 28, max: 80 },      // px
  iconSize: { min: 12, max: 36 },        // px
  fontSize: { min: 11, max: 18 },        // px 
  padding: { min: 2, max: 24 },          // px
  gap: { min: 2, max: 24 },              // px
  gridMinWidth: { min: 80, max: 280 },   // px
}

// 间距值范围映射
const spacingRanges = {
  itemSpacing: { min: 0, max: 16 },      // px
}

// 线性插值函数
function lerp(min, max, t) {
  return Math.round(min + (max - min) * t)
}

export const useExplorerSettings = defineStore('explorerSettings', () => {
  // 配置状态
  const settings = useLocalStorage(STORAGE_KEY, { ...defaultSettings })
  
  // 是否已初始化
  const initialized = ref(false)

  // 计算属性：当前密度配置（基于连续值计算）
  const currentDensity = computed(() => {
    const t = settings.value.densityValue / 100
    return {
      itemHeight: `${lerp(densityRanges.itemHeight.min, densityRanges.itemHeight.max, t)}px`,
      iconSize: `${lerp(densityRanges.iconSize.min, densityRanges.iconSize.max, t)}px`,
      fontSize: `${lerp(densityRanges.fontSize.min, densityRanges.fontSize.max, t)}px`,
      padding: `${lerp(densityRanges.padding.min, densityRanges.padding.max, t)}px`,
      gap: `${lerp(densityRanges.gap.min, densityRanges.gap.max, t)}px`,
      gridMinWidth: `${lerp(densityRanges.gridMinWidth.min, densityRanges.gridMinWidth.max, t)}px`,
    }
  })

  // 计算属性：当前间距值（基于连续值计算）
  const currentSpacing = computed(() => {
    const t = settings.value.spacingValue / 100
    return `${lerp(spacingRanges.itemSpacing.min, spacingRanges.itemSpacing.max, t)}px`
  })

  // 从 localStorage 恢复配置
  function loadSettings() {
    try {
      const parsed = settings.value || {}
      // 合并配置，确保新增字段有默认值
      settings.value = { ...defaultSettings, ...parsed }
      
      // 兼容旧版配置：将旧的 density 字符串转换为数值
      if (typeof parsed.density === 'string') {
        const densityMap = { compact: 0, comfortable: 50, spacious: 100 }
        settings.value.densityValue = densityMap[parsed.density] ?? 50
      }
      // 兼容旧版配置：将旧的 itemSpacing 字符串转换为数值
      if (typeof parsed.itemSpacing === 'string') {
        const spacingMap = { compact: 0, standard: 50, relaxed: 100 }
        settings.value.spacingValue = spacingMap[parsed.itemSpacing] ?? 50
      }
    } catch (e) {
      log.warn('[ExplorerSettings] 加载配置失败，使用默认值:', e)
    }
    initialized.value = true
    injectCSSVariables()
  }

  // 保存配置到 localStorage
  function saveSettings() {
  }

  // 注入 CSS 变量到 document root
  function injectCSSVariables() {
    const density = currentDensity.value
    const root = document.documentElement
    const isDark = root.classList.contains('dark')
    const colors = isDark ? semanticColors.dark : semanticColors.light

    // 密度相关变量
    root.style.setProperty('--explorer-item-height', density.itemHeight)
    root.style.setProperty('--explorer-icon-size', density.iconSize)
    root.style.setProperty('--explorer-font-size', density.fontSize)
    root.style.setProperty('--explorer-padding', density.padding)
    root.style.setProperty('--explorer-gap', density.gap)
    root.style.setProperty('--explorer-grid-min-width', density.gridMinWidth)

    // 颜色变量
    root.style.setProperty('--explorer-hover', colors.hover)
    root.style.setProperty('--explorer-selected', colors.selected)
    root.style.setProperty('--explorer-muted', colors.muted)
    root.style.setProperty('--explorer-border', colors.border)
    root.style.setProperty('--explorer-surface', colors.surface)
    root.style.setProperty('--explorer-surface-elevated', colors.surfaceElevated)

    // 动画开关
    root.style.setProperty('--explorer-animation-duration', 
      settings.value.animationsEnabled ? '200ms' : '0ms')

    // 文件间距
    root.style.setProperty('--explorer-item-spacing', currentSpacing.value)
  }

  // 更新单个配置项
  function updateSetting(key, value) {
    if (key in settings.value) {
      settings.value[key] = value
    }
  }

  // 重置为默认配置
  function resetSettings() {
    settings.value = { ...defaultSettings }
  }

  // 切换视图模式
  function setViewMode(mode) {
    if (['list', 'grid', 'gallery'].includes(mode)) {
      settings.value.viewMode = mode
    }
  }

  // 设置密度值 (0-100)
  function setDensityValue(value) {
    settings.value.densityValue = Math.max(0, Math.min(100, value))
  }

  // 设置间距值 (0-100)
  function setSpacingValue(value) {
    settings.value.spacingValue = Math.max(0, Math.min(100, value))
  }

  // 切换排序
  function setSort(sortBy, sortOrder) {
    if (['name', 'size', 'modified', 'type'].includes(sortBy)) {
      settings.value.sortBy = sortBy
    }
    if (['asc', 'desc'].includes(sortOrder)) {
      settings.value.sortOrder = sortOrder
    }
  }

  // 切换排序顺序
  function toggleSortOrder() {
    settings.value.sortOrder = settings.value.sortOrder === 'asc' ? 'desc' : 'asc'
  }

  // 切换勾选框显示状态
  function toggleShowCheckboxes() {
    settings.value.showCheckboxes = !settings.value.showCheckboxes
  }

  // 监听配置变化，自动保存和注入 CSS 变量
  watch(settings, () => {
    if (initialized.value) {
      injectCSSVariables()
    }
  }, { deep: true })

  // 暗色模式观察器 stop（VueUse 管理）
  let stopDarkModeObserver = null

  // 监听暗色模式变化
  function setupDarkModeObserver() {
    // 避免重复创建
    if (typeof stopDarkModeObserver === 'function') return stopDarkModeObserver

    const { stop } = useMutationObserver(
      document.documentElement,
      () => {
        injectCSSVariables()
      },
      { attributes: true, attributeFilter: ['class'] }
    )
    stopDarkModeObserver = stop
    return stopDarkModeObserver
  }

  // 清理暗色模式观察器
  function cleanupDarkModeObserver() {
    if (typeof stopDarkModeObserver === 'function') {
      stopDarkModeObserver()
      stopDarkModeObserver = null
    }
  }

  // 自动初始化：在 store 创建时立即加载设置
  // 这确保了在任何组件使用设置之前，设置已经从 localStorage 恢复
  if (typeof window !== 'undefined' && !initialized.value) {
    loadSettings()
  }

  return {
    // 状态
    settings,
    initialized,
    currentDensity,
    currentSpacing,
    
    // 方法
    loadSettings,
    saveSettings,
    injectCSSVariables,
    updateSetting,
    resetSettings,
    setViewMode,
    setDensityValue,
    setSpacingValue,
    setSort,
    toggleSortOrder,
    toggleShowCheckboxes,
    setupDarkModeObserver,
    cleanupDarkModeObserver,
  }
})

export default useExplorerSettings
