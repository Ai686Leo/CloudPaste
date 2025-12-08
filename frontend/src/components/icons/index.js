/**
 * 统一图标组件库
 * 集中管理所有 SVG 图标
 */

import { h } from 'vue'

// 基础图标组件
const createIcon = (pathData, strokeWidth = 2) => {
  return {
    name: 'Icon',
    props: {
      size: {
        type: String,
        default: 'md'
      },
      strokeWidth: {
        type: [String, Number],
        default: strokeWidth
      }
    },
    setup(props) {
      const sizeMap = {
        xs: 'w-3 h-3',
        sm: 'w-4 h-4',
        md: 'w-5 h-5',
        lg: 'w-6 h-6',
        xl: 'w-8 h-8',
        '2xl': 'w-10 h-10',
        '3xl': 'w-12 h-12'
      }

      return () => h('svg', {
        class: sizeMap[props.size] || sizeMap.md,
        fill: 'none',
        stroke: 'currentColor',
        viewBox: '0 0 24 24'
      }, Array.isArray(pathData) 
        ? pathData.map(d => h('path', {
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'stroke-width': props.strokeWidth,
            d
          }))
        : h('path', {
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'stroke-width': props.strokeWidth,
            d: pathData
          })
      )
    }
  }
}

// 常用图标定义
export const IconUpload = createIcon('M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12')

export const IconDownload = createIcon('M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4')

export const IconShoppingCart = createIcon('M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z')

export const IconSettings = createIcon([
  'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  'M15 12a3 3 0 11-6 0 3 3 0 016 0z'
], 1.5)

export const IconCheckbox = createIcon('M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4', 1.5)

export const IconTaskList = createIcon('M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01', 1.5)

export const IconFolderPlus = createIcon('M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z', 1.5)

export const IconRefresh = createIcon('M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', 1.5)

export const IconClose = createIcon('M6 18L18 6M6 6l12 12')

export const IconMenu = createIcon('M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z')

export const IconLink = createIcon('M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1')

export const IconCopy = createIcon('M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z')

export const IconRename = createIcon('M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z')

export const IconDelete = createIcon('M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16')

export const IconSearch = createIcon('M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z')

export const IconFolder = createIcon('M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z', 1.5)

export const IconList = createIcon('M4 6h16M4 12h16M4 18h16')

export const IconGrid = createIcon('M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z')

export const IconGallery = createIcon('M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z')

export const IconBack = createIcon('M10 19l-7-7m0 0l7-7m-7 7h18')

export const IconChevronDown = createIcon('M19 9l-7 7-7-7', 1.5)

export const IconChevronUp = createIcon('M5 15l7-7 7 7')

export const IconExternalLink = createIcon('M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14', 1.75)

export const IconError = createIcon('M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z')

export const IconArchive = createIcon([
  'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z',
  'M8 7V3a2 2 0 012-2h4a2 2 0 012 2v4'
])

export const IconHome = createIcon('M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6')

// 导出所有图标
export default {
  IconUpload,
  IconDownload,
  IconShoppingCart,
  IconSettings,
  IconCheckbox,
  IconTaskList,
  IconFolderPlus,
  IconRefresh,
  IconClose,
  IconMenu,
  IconLink,
  IconCopy,
  IconRename,
  IconDelete,
  IconSearch,
  IconFolder,
  IconList,
  IconGrid,
  IconGallery,
  IconBack,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconError,
  IconArchive,
  IconHome
}
