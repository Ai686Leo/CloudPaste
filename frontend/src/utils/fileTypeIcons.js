/**
 * 文件类型图标工具
 * 提供根据文件类型返回相应SVG图标的功能
 */

import { getIconType, getExtension } from "./fileTypes.js";

// 文件类型图标映射
const fileIconsMap = {
  // 图片文件
  image: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#d946ef"/>
      <circle cx="8.5" cy="8.5" r="1.5" fill="white"/>
      <path d="M21 15L16 10L5 21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,

  // 文档文件
  document: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" 
        stroke="${darkMode ? "#f87171" : "#dc2626"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M14 2V8H20" stroke="${darkMode ? "#f87171" : "#dc2626"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M16 13H8" stroke="${darkMode ? "#f87171" : "#dc2626"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M16 17H8" stroke="${darkMode ? "#f87171" : "#dc2626"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M10 9H9H8" stroke="${darkMode ? "#f87171" : "#dc2626"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,

  // 电子书（EPUB/MOBI/AZW3/FB2/CBZ 等）
  book: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <!-- Book cover -->
      <path d="M4 4C4 2.9 4.9 2 6 2H18C19.1 2 20 2.9 20 4V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#8B4513"/>
      <!-- Book spine -->
      <rect x="4" y="2" width="3" height="20" fill="rgba(0,0,0,0.2)"/>
      <!-- Pages -->
      <rect x="8" y="4" width="10" height="16" rx="1" fill="white" fill-opacity="0.9"/>
      <!-- Page lines -->
      <path d="M10 8H16M10 11H16M10 14H14" stroke="#8B4513" stroke-width="1" stroke-opacity="0.3" stroke-linecap="round"/>
      <!-- Bookmark -->
      <path d="M15 4V9L16.5 7.5L18 9V4" fill="#ef4444"/>
    </svg>
  `,

  // PDF 文件
  pdf: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M12 8V2H6a2 2 0 0 0-2 2v6.668c-.591.281-1 .884-1 1.582v5.5c0 .698.409 1.3 1 1.582V20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-.668c.591-.281 1-.884 1-1.582v-5.5c0-.698-.409-1.3-1-1.582V10h-6a2 2 0 0 1-2-2Zm-7.25 4h14.5a.25.25 0 0 1 .25.25v5.5a.25.25 0 0 1-.25.25H4.75a.25.25 0 0 1-.25-.25v-5.5a.25.25 0 0 1 .25-.25Z" fill="#ef4444"/>
      <path d="M13.5 8V2.5l6 6H14a.5.5 0 0 1-.5-.5Z" fill="rgba(0,0,0,0.2)"/>
      <!-- PDF Text Layer - color adapts to theme -->
      <path d="M7.503 13.002a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 1 0v-.5H8.5a1.5 1.5 0 0 0 0-3h-.997Zm.997 2h-.497v-1H8.5a.5.5 0 1 1 0 1ZM14.998 13.501a.5.5 0 0 1 .5-.499h1.505a.5.5 0 1 1 0 1h-1.006l-.001 1.002h1.007a.5.5 0 0 1 0 1h-1.007l.002.497a.5.5 0 0 1-1 .002l-.003-.998v-.002l.003-2.002ZM11.5 13.002h.498a2 2 0 0 1 0 4H11.5a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5Zm.5 3a1 1 0 0 0 0-2v2Z" fill="${darkMode ? "white" : "#7f1d1d"}"/>
    </svg>
  `,

  // RTF 文件
  rtf: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#7c3aed"/>
      <path d="M14 2V8H20" fill="rgba(0,0,0,0.1)"/>
      <!-- RTF letters -->
      <path d="M6 10V16H7.5V14H8.5L9.5 16H11L9.8 13.8C10.5 13.5 11 12.8 11 12C11 10.9 10.1 10 9 10H6ZM7.5 11.2H9C9.4 11.2 9.8 11.5 9.8 12C9.8 12.5 9.4 12.8 9 12.8H7.5V11.2Z" fill="white"/>
      <path d="M12 10V11.5H13.25V16H14.75V11.5H16V10H12Z" fill="white"/>
      <path d="M17 10V16H18.5V13.8H20.5V12.3H18.5V11.5H21V10H17Z" fill="white"/>
    </svg>
  `,

  // 代码文件
  code: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#6366f1"/>
      <path d="M9 8L5 12L9 16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M15 8L19 12L15 16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M13 7L11 17" stroke="white" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    </svg>
  `,

  // 压缩文件
  archive: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#f59e0b"/>
      <path d="M14 2V8H20" fill="rgba(0,0,0,0.1)"/>
      <!-- Zipper Teeth & Pull -->
      <path d="M13 2H11V8H13V2Z" fill="white" fill-opacity="0.3"/>
      <path d="M10 8H12V10H10V8Z" fill="white" fill-opacity="0.8"/>
      <path d="M12 10H14V12H12V10Z" fill="white" fill-opacity="0.8"/>
      <path d="M10 12H12V14H10V12Z" fill="white" fill-opacity="0.8"/>
      <path d="M12 14H14V16H12V14Z" fill="white" fill-opacity="0.8"/>
      <path d="M12 16C12 17.1046 12.8954 18 14 18C15.1046 18 16 17.1046 16 16V15H14V16H14.01C14.01 15.99 12 15.99 12 16Z" fill="white"/>
    </svg>
  `,

  // 音频文件
  audio: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M9 18V5L21 3V16" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6 21C7.65685 21 9 19.6569 9 18C9 16.3431 7.65685 15 6 15C4.34315 15 3 16.3431 3 18C3 19.6569 4.34315 21 6 21Z"
        stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="#06b6d4" fill-opacity="0.2"/>
      <path d="M18 19C19.6569 19 21 17.6569 21 16C21 14.3431 19.6569 13 18 13C16.3431 13 15 14.3431 15 16C15 17.6569 16.3431 19 18 19Z"
        stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="#06b6d4" fill-opacity="0.2"/>
    </svg>
  `,

  // 视频文件
  video: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M17 10.5V7C17 6.45 16.55 6 16 6H4C3.45 6 3 6.45 3 7V17C3 17.55 3.45 18 4 18H16C16.55 18 17 17.55 17 17V13.5L21 17.5V6.5L17 10.5Z" fill="#f43f5e"/>
      <path d="M8 9L12 12L8 15V9Z" fill="white"/>
    </svg>
  `,

  // 字体文件
  font: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#6366f1"/>
      <!-- Large "A" letter representing typography -->
      <path d="M12 6L7 18H9.5L10.5 15H13.5L14.5 18H17L12 6Z" fill="white"/>
      <path d="M11 13L12 9.5L13 13H11Z" fill="#6366f1"/>
      <!-- Underline representing font baseline -->
      <path d="M7 19H17" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.6"/>
    </svg>
  `,

  // 可执行文件
  executable: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <!-- Window frame -->
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#8b5cf6"/>
      <!-- Title bar -->
      <rect x="3" y="4" width="18" height="4" rx="2" fill="#8b5cf6"/>
      <rect x="3" y="6" width="18" height="2" fill="#8b5cf6"/>
      <!-- Window buttons -->
      <circle cx="6" cy="6" r="1" fill="white" opacity="0.8"/>
      <circle cx="9" cy="6" r="1" fill="white" opacity="0.8"/>
      <circle cx="12" cy="6" r="1" fill="white" opacity="0.8"/>
      <!-- Content area -->
      <rect x="4" y="9" width="16" height="10" rx="1" fill="white" opacity="0.15"/>
      <!-- Gear icon in center -->
      <circle cx="12" cy="14" r="3" stroke="white" stroke-width="1.5" fill="none"/>
      <circle cx="12" cy="14" r="1" fill="white"/>
      <path d="M12 10V11M12 17V18M8 14H9M15 14H16M9.17 11.17L9.88 11.88M14.12 16.12L14.83 16.83M9.17 16.83L9.88 16.12M14.12 11.88L14.83 11.17" stroke="white" stroke-width="1" stroke-linecap="round"/>
    </svg>
  `,

  // APK 文件（Android 安装包）
  apk: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <!-- Android Robot Head - Official Bugdroid Design (Centered) -->
      <g transform="translate(0, 5) scale(0.158)">
        <!-- Head with antennas - official path -->
        <path fill="#3DDC84" d="M151.025 85.224q-.071-.464-.147-.92a75.665 75.665 0 0 0-7.546-22.597 76.5 76.5 0 0 0-5.511-8.995 76 76 0 0 0-8.322-9.808 76.034 76.034 0 0 0-13.398-10.626q.042-.074.085-.148 2.286-3.948 4.572-7.897l4.47-7.712a3946 3946 0 0 0 3.208-5.54q.38-.658.604-1.355a6.97 6.97 0 0 0-.652-5.702 6.9 6.9 0 0 0-2.406-2.398 7 7 0 0 0-2.954-.95 7 7 0 0 0-2.376.206 6.93 6.93 0 0 0-4.22 3.227q-1.606 2.77-3.208 5.54l-4.47 7.712c-1.523 2.634-3.05 5.263-4.573 7.897q-.25.43-.5.865c-.232-.092-.46-.184-.692-.272-8.398-3.205-17.511-4.958-27.036-4.958q-.39-.001-.78.004A75.7 75.7 0 0 0 50.977 25q-1.317.46-2.608.968-.234-.404-.467-.806-2.286-3.95-4.573-7.897l-4.47-7.713a4385 4385 0 0 1-3.208-5.54A6.93 6.93 0 0 0 29.055.58a6.9 6.9 0 0 0-2.954.95 6.92 6.92 0 0 0-3.157 4.185 6.96 6.96 0 0 0 .703 5.27l3.208 5.54 4.47 7.713c1.523 2.634 3.05 5.263 4.573 7.897.01.022.025.044.036.066a76.3 76.3 0 0 0-13.527 10.711 76.5 76.5 0 0 0-8.322 9.808 75.4 75.4 0 0 0-5.51 8.995 75.7 75.7 0 0 0-7.546 22.597 76.038 76.038 0 0 0-.581 4.247h151a77 77 0 0 0-.434-3.327z"/>
        <!-- Eyes - official elliptical design -->
        <path fill="#202124" d="M115.225 67.663c3.022-2.012 3.461-6.668.981-10.4-2.48-3.73-6.939-5.123-9.96-3.11-3.021 2.012-3.46 6.668-.98 10.4 2.479 3.73 6.938 5.123 9.959 3.11M46.762 64.564c2.48-3.73 2.04-8.387-.98-10.4-3.022-2.012-7.481-.619-9.96 3.112s-2.041 8.387.98 10.4 7.48.62 9.96-3.112"/>
      </g>
    </svg>
  `,

  // ISO 文件（镜像）
  iso: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <!-- Disc outer ring -->
      <circle cx="12" cy="12" r="9" fill="#607D8B"/>
      <!-- Disc shine -->
      <circle cx="12" cy="12" r="9" fill="url(#discGradient)" opacity="0.3"/>
      <!-- Inner ring -->
      <circle cx="12" cy="12" r="6" fill="none" stroke="white" stroke-width="0.5" opacity="0.5"/>
      <!-- Center hole -->
      <circle cx="12" cy="12" r="2.5" fill="${darkMode ? "#1a1a1a" : "white"}"/>
      <!-- ISO text -->
      <text x="12" y="20" text-anchor="middle" fill="white" font-size="4" font-weight="bold" font-family="Arial">ISO</text>
    </svg>
  `,

  // DMG 文件（macOS 镜像）
  dmg: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <!-- Hard drive shape -->
      <rect x="3" y="6" width="18" height="12" rx="2" fill="#A2AAAD"/>
      <!-- Top shine -->
      <rect x="3" y="6" width="18" height="4" rx="2" fill="white" fill-opacity="0.2"/>
      <!-- Drive slot -->
      <rect x="6" y="10" width="12" height="1" rx="0.5" fill="white" fill-opacity="0.5"/>
      <!-- Apple-style indicator light -->
      <circle cx="17" cy="14" r="1" fill="#4ade80"/>
      <!-- DMG text -->
      <text x="12" y="21" text-anchor="middle" fill="#A2AAAD" font-size="4" font-weight="bold" font-family="Arial">DMG</text>
    </svg>
  `,

  // 电子表格文件
  spreadsheet: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#10b981"/>
      <path d="M14 2V8H20" fill="rgba(0,0,0,0.1)"/>
      <path d="M8 10L16 16M16 10L8 16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,

  // 演示文稿文件 (PPT)
  presentation: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#f97316"/>
      <path d="M14 2V8H20" fill="rgba(0,0,0,0.1)"/>
      <path d="M10 10H14C15 10 15 13 14 13H10V10ZM10 10V17" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,

  // Markdown文件
  markdown: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <g transform="translate(1.5, 1.5) scale(1.4)">
        <path d="M0 3.5A1.5 1.5 0 0 1 1.5 2h12A1.5 1.5 0 0 1 15 3.5v8a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 0 11.5zM10 5v3.293L8.854 7.146l-.708.708l2 2a.5.5 0 0 0 .708 0l2-2l-.707-.708L11 8.293V5zm-7.146.146A.5.5 0 0 0 2 5.5V10h1V6.707l1.5 1.5l1.5-1.5V10h1V5.5a.5.5 0 0 0-.854-.354L4.5 6.793z" fill="#8b5cf6"/>
      </g>
    </svg>
  `,

  // HTML文件 - 基于HTML5官方盾牌设计
  html: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M4 3L5.5 20L12 22L18.5 20L20 3H4Z" fill="#f97316"/>
      <path d="M12 5V19.5L17 18L18.2 5H12Z" fill="rgba(0,0,0,0.1)"/>
      <text x="12" y="15" text-anchor="middle" fill="white" font-size="7" font-weight="bold" font-family="Arial">5</text>
    </svg>
  `,

  // Office文件（通用）- 基于微软现代设计
  office: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <!-- 微软Office现代方形设计 -->
      <rect x="3" y="3" width="18" height="18" rx="2"
        fill="${darkMode ? "#d13438" : "#d13438"}"
        stroke="none"/>

      <!-- 内部高光效果 -->
      <rect x="4" y="4" width="16" height="16" rx="1.5"
        fill="${darkMode ? "#e74c3c" : "#e74c3c"}"
        stroke="none"/>

      <!-- Office "O" 标识 - 白色圆环 -->
      <circle cx="12" cy="12" r="6"
        fill="none"
        stroke="white"
        stroke-width="2"/>
      <circle cx="12" cy="12" r="3"
        fill="white"/>
      <circle cx="12" cy="12" r="1.5"
        fill="${darkMode ? "#d13438" : "#d13438"}"/>
    </svg>
  `,

  // 配置文件
  config: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#64748b"/>
      <!-- Main gear -->
      <path d="M12 7L12.8 7.2L13.5 6L14.8 6.8L14.3 8.1L15.2 8.8L16.5 8.3L17 9.6L15.8 10.3L16 11.2L17.3 11.5L17 13L15.7 12.8L15.3 13.7L16.2 14.8L15 15.8L14 14.8L13.2 15.2L13.3 16.5L11.8 16.8L11.5 15.5L10.6 15.5L10.2 16.7L8.8 16.2L9.3 15L8.5 14.3L7.3 14.8L6.8 13.5L8 12.8L7.8 11.9L6.5 11.5L6.8 10L8.1 10.3L8.5 9.4L7.6 8.3L8.8 7.3L9.9 8.2L10.7 7.8L10.6 6.5L12 7Z" fill="white" stroke="white" stroke-width="0.5"/>
      <!-- Gear center hole -->
      <circle cx="12" cy="12" r="2.5" fill="#64748b"/>
      <circle cx="12" cy="12" r="1.2" fill="white"/>
    </svg>
  `,

  // Word文档文件 - 基于Word 2025现代设计
  word: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#3b82f6"/>
      <path d="M14 2V8H20" fill="rgba(0,0,0,0.1)"/>
      <path d="M7 10L9 16L12 12L15 16L17 10" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,

  // 数据库文件
  database: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <!-- Database cylinder -->
      <ellipse cx="12" cy="6" rx="7" ry="2.5" fill="#336791"/>
      <path d="M5 6V18C5 19.38 8.13 20.5 12 20.5C15.87 20.5 19 19.38 19 18V6" fill="#336791"/>
      <ellipse cx="12" cy="18" rx="7" ry="2.5" fill="#336791"/>
      <!-- Highlight lines -->
      <ellipse cx="12" cy="10" rx="7" ry="2" fill="none" stroke="white" stroke-opacity="0.3" stroke-width="0.5"/>
      <ellipse cx="12" cy="14" rx="7" ry="2" fill="none" stroke="white" stroke-opacity="0.3" stroke-width="0.5"/>
      <!-- Top highlight -->
      <ellipse cx="12" cy="6" rx="5" ry="1.5" fill="white" fill-opacity="0.2"/>
    </svg>
  `,

  // 纯文本文件
  text: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#94a3b8"/>
      <path d="M14 2V8H20" fill="rgba(0,0,0,0.1)"/>
      <path d="M8 12H16M8 16H12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,

  // JSON文件 - 数据格式
  json: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#84cc16"/>
      <!-- Left curly brace -->
      <path d="M9 7C7.5 7 7 8 7 9V10.5C7 11.5 6 12 6 12C6 12 7 12.5 7 13.5V15C7 16 7.5 17 9 17" stroke="white" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      <!-- Right curly brace -->
      <path d="M15 7C16.5 7 17 8 17 9V10.5C17 11.5 18 12 18 12C18 12 17 12.5 17 13.5V15C17 16 16.5 17 15 17" stroke="white" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      <!-- Data dots -->
      <circle cx="10.5" cy="10" r="1" fill="white"/>
      <circle cx="13.5" cy="12" r="1" fill="white"/>
      <circle cx="10.5" cy="14" r="1" fill="white"/>
    </svg>
  `,

  // CSV文件 - 表格数据
  csv: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#217346"/>
      <path d="M14 2V8H20" fill="rgba(0,0,0,0.1)"/>
      <!-- CSV grid -->
      <rect x="7" y="11" width="3" height="2" fill="white" fill-opacity="0.8"/>
      <rect x="11" y="11" width="3" height="2" fill="white" fill-opacity="0.6"/>
      <rect x="15" y="11" width="2" height="2" fill="white" fill-opacity="0.4"/>
      <rect x="7" y="14" width="3" height="2" fill="white" fill-opacity="0.6"/>
      <rect x="11" y="14" width="3" height="2" fill="white" fill-opacity="0.8"/>
      <rect x="15" y="14" width="2" height="2" fill="white" fill-opacity="0.6"/>
      <rect x="7" y="17" width="3" height="2" fill="white" fill-opacity="0.4"/>
      <rect x="11" y="17" width="3" height="2" fill="white" fill-opacity="0.6"/>
      <rect x="15" y="17" width="2" height="2" fill="white" fill-opacity="0.8"/>
    </svg>
  `,
  // CSS3 - Shield shape (Icons8 style)
  css: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M4 3L5.5 20L12 22L18.5 20L20 3H4Z" fill="${darkMode ? '#0ea5e9' : '#0ea5e9'}"/>
      <path d="M12 5V19.5L17 18L18.2 5H12Z" fill="rgba(0,0,0,0.1)"/>
      <text x="12" y="15" text-anchor="middle" fill="white" font-size="7" font-weight="bold" font-family="Arial">3</text>
    </svg>
  `,

  // JavaScript - Yellow square with JS
  js: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="2" fill="${darkMode ? '#eab308' : '#eab308'}"/>
      <text x="12" y="16" text-anchor="middle" fill="#323330" font-size="8" font-weight="bold" font-family="Arial">JS</text>
    </svg>
  `,

  // TypeScript - Blue square with TS
  ts: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="2" fill="${darkMode ? '#3b82f6' : '#3b82f6'}"/>
      <text x="12" y="16" text-anchor="middle" fill="white" font-size="8" font-weight="bold" font-family="Arial">TS</text>
    </svg>
  `,

  // Python - Official dual snake head design (blue & yellow)
  python: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#306998"/>
      <!-- Blue snake (top-left) -->
      <path d="M12 4C8.5 4 8 6 8 7V9H12.5V10H6.5C5 10 4 11.5 4 14C4 16.5 5.5 18 7 18H8.5V15.5C8.5 14 9.5 13 11 13H15C16.5 13 17.5 12 17.5 10.5V7C17.5 5 16 4 12 4ZM9.5 5.5C10.1 5.5 10.5 5.9 10.5 6.5C10.5 7.1 10.1 7.5 9.5 7.5C8.9 7.5 8.5 7.1 8.5 6.5C8.5 5.9 8.9 5.5 9.5 5.5Z" fill="#ffd43b"/>
      <!-- Yellow snake (bottom-right) -->
      <path d="M12 20C15.5 20 16 18 16 17V15H11.5V14H17.5C19 14 20 12.5 20 10C20 7.5 18.5 6 17 6H15.5V8.5C15.5 10 14.5 11 13 11H9C7.5 11 6.5 12 6.5 13.5V17C6.5 19 8 20 12 20ZM14.5 18.5C13.9 18.5 13.5 18.1 13.5 17.5C13.5 16.9 13.9 16.5 14.5 16.5C15.1 16.5 15.5 16.9 15.5 17.5C15.5 18.1 15.1 18.5 14.5 18.5Z" fill="#ffd43b" opacity="0.6"/>
    </svg>
  `,

  // Vue - V-shape chevron
  vue: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M2 4H6L12 14L18 4H22L12 21L2 4Z" fill="${darkMode ? '#10b981' : '#10b981'}"/>
      <path d="M6 4H10L12 7.5L14 4H18L12 14L6 4Z" fill="#35495e"/>
    </svg>
  `,

  // React - Atom orbital
  react: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#20232a"/>
      <circle cx="12" cy="12" r="2" fill="${darkMode ? '#06b6d4' : '#06b6d4'}"/>
      <ellipse cx="12" cy="12" rx="6" ry="2.5" stroke="${darkMode ? '#06b6d4' : '#06b6d4'}" stroke-width="1" fill="none" transform="rotate(0 12 12)"/>
      <ellipse cx="12" cy="12" rx="6" ry="2.5" stroke="${darkMode ? '#06b6d4' : '#06b6d4'}" stroke-width="1" fill="none" transform="rotate(60 12 12)"/>
      <ellipse cx="12" cy="12" rx="6" ry="2.5" stroke="${darkMode ? '#06b6d4' : '#06b6d4'}" stroke-width="1" fill="none" transform="rotate(-60 12 12)"/>
    </svg>
  `,

  // Java - Official Java logo style (orange steam + blue curves)
  java: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="white"/>
      <!-- Orange steam/flame curves -->
      <g transform="translate(3,3) scale(0.035)">
        <path d="M274 235c18 21-5 40-5 40s47-24 25-54-35-42 48-90C342 130 211 163 274 235M294 53s40 40-38 100c-62 49-14 77 0 109-36-33-63-61-45-88C238 134 310 115 294 53" fill="#f8981d"/>
        <path d="M206 347s-15 8 10 11s46 3 79-3a137 137 0 0 0 21 10C242 397 147 364 206 347m-9-42s-16 12 9 15s58 4 102-5a45 45 0 0 0 16 10C233 351 132 327 197 305m175 73s11 9-12 16c-43 13-179 17-217 1-14-6 15-17 33-17-17-10-98 21-42 30C287 432 412 396 372 378M213 262s-69 16-25 22c19 3 57 2 92-1s57-8 57-8a122 122 0 0 0-17 9c-70 18-206 10-167-9S213 262 213 262m124 69c73-37 39-80 7-66 36-30 101 36-9 68v-2M220 432c69 4 174-2 176-35 0 0-5 12-57 22s-131 10-174 3C166 422 175 429 220 432" fill="#5382a1"/>
      </g>
    </svg>
  `,

  // C++ - Plus plus
  cpp: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="${darkMode ? '#6366f1' : '#6366f1'}"/>
      <text x="12" y="16" text-anchor="middle" fill="white" font-size="9" font-weight="bold" font-family="Arial">C++</text>
    </svg>
  `,

  // Go - Gopher 风格
  go: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#00ADD8"/>
      <!-- Gopher body -->
      <ellipse cx="12" cy="13" rx="5" ry="4.5" fill="white"/>
      <!-- Eyes -->
      <circle cx="10" cy="11" r="2" fill="white" stroke="#00ADD8" stroke-width="0.5"/>
      <circle cx="14" cy="11" r="2" fill="white" stroke="#00ADD8" stroke-width="0.5"/>
      <circle cx="10" cy="11" r="1" fill="#333"/>
      <circle cx="14" cy="11" r="1" fill="#333"/>
      <!-- Nose -->
      <ellipse cx="12" cy="13.5" rx="1.5" ry="1" fill="#D4A574"/>
      <!-- Teeth -->
      <rect x="11" y="14.5" width="2" height="1.5" rx="0.3" fill="white" stroke="#00ADD8" stroke-width="0.3"/>
    </svg>
  `,

  // Rust - 齿轮 logo
  rust: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#1a1a1a"/>
      <!-- Rust gear -->
      <g transform="translate(12, 12)">
        <!-- Outer gear teeth -->
        <path d="M0-6.5L1-5.5L1-4L2-4L2.5-5.5L4-4.5L3.5-3L4.5-2.5L5.5-3.5L6 -2L4.5-1L5-0L6.5 0L6.5 1L5 1L5 2L6 2.5L5.5 4L4 3.5L3.5 4.5L4.5 5.5L3 6L2.5 4.5L1.5 5L1 6.5L0 6.5L0 5L-1 5L-1 6.5L-2.5 6L-2 4.5L-3.5 4.5L-4 5.5L-5.5 4L-4.5 3L-5 2L-6.5 2L-6.5 0L-5 0L-5-1L-6-2.5L-4.5-3.5L-3.5-2.5L-3-4L-4.5-4.5L-3.5-6L-2-5L-1-6L-1-6.5Z" fill="#DEA584"/>
        <!-- Inner circle -->
        <circle cx="0" cy="0" r="3" fill="#1a1a1a"/>
        <!-- R letter -->
        <text x="0" y="1.5" text-anchor="middle" fill="#DEA584" font-size="4" font-weight="bold" font-family="Arial">R</text>
      </g>
    </svg>
  `,

  // Kotlin - K 形状
  kotlin: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#7F52FF"/>
      <!-- Kotlin K shape -->
      <path d="M7 7H12L7 12L12 17H7V7Z" fill="white"/>
      <path d="M12 7L7 12L12 17H17L12 12L17 7H12Z" fill="white" fill-opacity="0.7"/>
    </svg>
  `,

  // Swift - 鸟形
  swift: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#F05138"/>
      <!-- Swift bird -->
      <path d="M17 7C17 7 14 10 10 12C13 10 15 8 15 8C12 10 8 11 6 10C8 12 11 14 15 14C12 16 8 17 6 17C10 17 14 15 17 12C18 11 18 9 17 7Z" fill="white"/>
    </svg>
  `,

  // PHP - 椭圆
  php: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="12" rx="9" ry="6" fill="#777BB4"/>
      <!-- PHP text -->
      <text x="12" y="14" text-anchor="middle" fill="white" font-size="7" font-weight="bold" font-family="Arial">php</text>
    </svg>
  `,

  // Ruby - 宝石
  ruby: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#CC342D"/>
      <!-- Ruby gem -->
      <path d="M12 5L17 9L12 19L7 9L12 5Z" fill="white"/>
      <path d="M7 9H17L12 19L7 9Z" fill="white" fill-opacity="0.7"/>
      <path d="M12 5L7 9H17L12 5Z" fill="white" fill-opacity="0.9"/>
      <path d="M12 9V19" stroke="#CC342D" stroke-width="0.5" stroke-opacity="0.3"/>
    </svg>
  `,

  // C# - 带井号
  csharp: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#68217A"/>
      <!-- C letter -->
      <text x="7" y="15" fill="white" font-size="10" font-weight="bold" font-family="Arial">C</text>
      <!-- Hash symbol - shifted right -->
      <path d="M13 7V15M16 7V15M12 9H17M12 13H17" stroke="white" stroke-width="1.2" stroke-linecap="round"/>
    </svg>
  `,

  // C 语言
  c: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#A8B9CC"/>
      <text x="12" y="16" text-anchor="middle" fill="#1a1a1a" font-size="12" font-weight="bold" font-family="Arial">C</text>
    </svg>
  `,

  // Shell - 终端提示符
  shell: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#1a1a1a"/>
      <!-- Terminal window -->
      <rect x="5" y="5" width="14" height="14" rx="2" fill="#2d2d2d"/>
      <!-- Prompt -->
      <path d="M7 10L10 12L7 14" stroke="#4EAA25" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <!-- Cursor line -->
      <path d="M12 14H17" stroke="#4EAA25" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `,

  // XML - 标签括号
  xml: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#F16529"/>
      <!-- XML brackets -->
      <path d="M8 8L5 12L8 16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M16 8L19 12L16 16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <!-- Slash -->
      <path d="M13 7L11 17" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  `,

  // YAML - 配置风格
  yaml: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#CB171E"/>
      <!-- YAML structure lines -->
      <path d="M7 8H10" stroke="white" stroke-width="2" stroke-linecap="round"/>
      <path d="M9 11H14" stroke="white" stroke-width="2" stroke-linecap="round"/>
      <path d="M9 14H12" stroke="white" stroke-width="2" stroke-linecap="round"/>
      <path d="M7 17H15" stroke="white" stroke-width="2" stroke-linecap="round"/>
      <!-- Dots for key-value -->
      <circle cx="17" cy="8" r="1" fill="white"/>
      <circle cx="17" cy="11" r="1" fill="white"/>
      <circle cx="17" cy="14" r="1" fill="white"/>
    </svg>
  `,

  // Docker - 官方 logo
  docker: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <g transform="scale(0.0317) translate(0, 100)">
        <path fill="#1d63ed" d="M743.96,245.25c-18.54-12.48-67.26-17.81-102.68-8.27-1.91-35.28-20.1-65.01-53.38-90.95l-12.32-8.27-8.21,12.4c-16.14,24.5-22.94,57.14-20.53,86.81,1.9,18.28,8.26,38.83,20.53,53.74-46.1,26.74-88.59,20.67-276.77,20.67H.06c-.85,42.49,5.98,124.23,57.96,190.77,5.74,7.35,12.04,14.46,18.87,21.31,42.26,42.32,106.11,73.35,201.59,73.44,145.66.13,270.46-78.6,346.37-268.97,24.98.41,90.92,4.48,123.19-57.88.79-1.05,8.21-16.54,8.21-16.54l-12.3-8.27ZM189.67,206.39h-81.7v81.7h81.7v-81.7ZM295.22,206.39h-81.7v81.7h81.7v-81.7ZM400.77,206.39h-81.7v81.7h81.7v-81.7ZM506.32,206.39h-81.7v81.7h81.7v-81.7ZM84.12,206.39H2.42v81.7h81.7v-81.7ZM189.67,103.2h-81.7v81.7h81.7v-81.7ZM295.22,103.2h-81.7v81.7h81.7v-81.7ZM400.77,103.2h-81.7v81.7h81.7v-81.7ZM400.77,0h-81.7v81.7h81.7V0Z"/>
      </g>
    </svg>
  `,

  // Git - 官方 logo
  git: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <g transform="scale(0.5)">
        <path fill="#F4511E" d="M42.2,22.1L25.9,5.8C25.4,5.3,24.7,5,24,5c0,0,0,0,0,0c-0.7,0-1.4,0.3-1.9,0.8l-3.5,3.5l4.1,4.1c0.4-0.2,0.8-0.3,1.3-0.3c1.7,0,3,1.3,3,3c0,0.5-0.1,0.9-0.3,1.3l4,4c0.4-0.2,0.8-0.3,1.3-0.3c1.7,0,3,1.3,3,3s-1.3,3-3,3c-1.7,0-3-1.3-3-3c0-0.5,0.1-0.9,0.3-1.3l-4-4c-0.1,0-0.2,0.1-0.3,0.1v10.4c1.2,0.4,2,1.5,2,2.8c0,1.7-1.3,3-3,3s-3-1.3-3-3c0-1.3,0.8-2.4,2-2.8V18.8c-1.2-0.4-2-1.5-2-2.8c0-0.5,0.1-0.9,0.3-1.3l-4.1-4.1L5.8,22.1C5.3,22.6,5,23.3,5,24c0,0.7,0.3,1.4,0.8,1.9l16.3,16.3c0,0,0,0,0,0c0.5,0.5,1.2,0.8,1.9,0.8s1.4-0.3,1.9-0.8l16.3-16.3c0.5-0.5,0.8-1.2,0.8-1.9C43,23.3,42.7,22.6,42.2,22.1z"/>
      </g>
    </svg>
  `,

  // 默认文件图标
  default: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#d1d5db"/>
      <path d="M14 2V8H20" fill="rgba(0,0,0,0.1)"/>
      <text x="12" y="15" text-anchor="middle" fill="white" font-size="10" font-weight="bold">?</text>
    </svg>
  `,

  // 文件夹图标 
  folder: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <!-- Folder back body -->
      <path d="M19 6H11L9 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H19.5C20.6 20 21.5 19.2 21.5 18V8C21.5 6.9 20.6 6 19.5 6Z" fill="#f59e0b"/>
      <!-- Front flap (open lid) - lighter color -->
      <path d="M21.1 9H7.65C6.7 9 5.85 9.7 5.65 10.65L4 20H19.85C20.8 20 21.65 19.3 21.85 18.35L23.25 11C23.55 9.65 22.55 9 21.1 9Z" fill="#FFCA28"/>
    </svg>
  `,

  // 挂载点文件夹图标 
  mountFolder: (darkMode = false) => `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24" fill="none">
      <!-- 文件夹阴影效果 -->
      <path d="M3 6C3 4.89543 3.89543 4 5 4H8.17157C8.70201 4 9.21071 4.21071 9.58579 4.58579L11 6H19C20.1046 6 21 6.89543 21 8V18C21 19.1046 20.1046 20 19 20H5C3.89543 20 3 19.1046 3 18V6Z" 
        fill="${darkMode ? "#3b82f6" : "#60a5fa"}" fill-opacity="${darkMode ? "0.08" : "0.2"}"/>

      <!-- 文件夹打开效果 - 底部 -->
      <path d="M3.5 7.5C3.5 6.67157 4.17157 6 5 6H19C19.8284 6 20.5 6.67157 20.5 7.5V18C20.5 18.8284 19.8284 19.5 19 19.5H5C4.17157 19.5 3.5 18.8284 3.5 18V7.5Z" 
        fill="${darkMode ? "#3b82f6" : "#60a5fa"}" fill-opacity="${darkMode ? "0.25" : "0.4"}" stroke="${
    darkMode ? "#3b82f6" : "#2563eb"
  }" stroke-width="1" stroke-linejoin="round"/>

      <!-- 文件夹打开效果 - 顶部翻盖 -->
      <path d="M4 5.5C4 4.94772 4.44772 4.5 5 4.5H8.5C8.89746 4.5 9.27285 4.67755 9.53553 4.98223L11.2678 7H19C19.2761 7 19.5 7.22386 19.5 7.5V8.5H4V5.5Z" 
        fill="${darkMode ? "#2563eb" : "#3b82f6"}" fill-opacity="${darkMode ? "0.45" : "0.6"}" stroke="${
    darkMode ? "#3b82f6" : "#2563eb"
  }" stroke-width="1" stroke-linejoin="round"/>

      <!-- 折角效果 -->
      <path d="M5 4.5L5.75 5.25H8.25L9.5 6.25H8L7.25 5.5H5V4.5Z" 
        fill="${darkMode ? "#3b82f6" : "#2563eb"}" fill-opacity="${darkMode ? "0.6" : "0.8"}" stroke="${
    darkMode ? "#3b82f6" : "#2563eb"
  }" stroke-width="0.5" stroke-linejoin="round"/>

      <!-- 挂载标识 "+" 符号 -->
      <path d="M12 11V15" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M10 13H14" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  `,
};

/**
 * 获取文件类型对应的图标
 * @param {Object} item - 文件项对象
 * @param {boolean} darkMode - 是否为暗色模式
 * @returns {string} SVG图标字符串
 */
export const getFileIcon = (item, darkMode = false) => {
  // 如果是文件夹
  if (item.isDirectory) {
    return item.isMount ? fileIconsMap.mountFolder(darkMode) : fileIconsMap.folder(darkMode);
  }

  // 一些“没有扩展名/扩展名不标准”的文件，直接按文件名判断
  const rawFilename = item.filename || item.name || "";
  const baseFilename = rawFilename.split(/[\\/]/).pop().toLowerCase();
  if ([ "dockerfile", "containerfile", ".dockerignore" ].includes(baseFilename)) {
    return fileIconsMap.docker(darkMode);
  }
  if ([ ".gitignore", ".gitattributes", ".gitmodules", ".gitkeep" ].includes(baseFilename)) {
    return fileIconsMap.git(darkMode);
  }

  // 获取后端返回的图标类型和文件扩展名
  const iconType = getIconType(item);
  const extension = getExtension(item.filename || item.name || "");

  // 根据大类型进行细分处理
  if (extension) {
    const ext = extension.toLowerCase();

    // TEXT 类型的细分处理
    if (iconType === "text") {
      // JSON 文件
      if (ext === "json") {
        return fileIconsMap.json(darkMode);
      }

      // CSV 文件
      if (ext === "csv") {
        return fileIconsMap.csv(darkMode);
      }

      // Markdown 文件
      if (["md", "markdown"].includes(ext)) {
        return fileIconsMap.markdown(darkMode);
      }

      // HTML 文件特殊处理
      if (["html", "htm"].includes(ext)) {
        return fileIconsMap.html(darkMode);
      }

      // 配置文件
      const configExtensions = ["ini", "conf", "config", "cfg", "env"];
      if (configExtensions.includes(ext)) {
        return fileIconsMap.config(darkMode);
      }

      // 数据库文件
      if (["sql", "db", "sqlite", "sqlite3"].includes(ext)) {
        return fileIconsMap.database(darkMode);
      }

      // 代码文件
      const codeExtensions = [
        "js",
        "jsx",
        "ts",
        "tsx",
        "vue",
        "css",
        "scss",
        "sass",
        "less",
        "py",
        "java",
        "c",
        "cpp",
        "cc",
        "cxx",
        "h",
        "hpp",
        "cs",
        "php",
        "rb",
        "go",
        "rs",
        "kt",
        "sh",
        "bash",
        "zsh",
        "ps1",
        "bat",
        "cmd",
        "xml",
        "yml",
        "yaml",
        "toml",
        "dockerfile",
        "makefile",
        "cmake",
        "gradle",
      ];

      // 特定编程语言图标处理
      if (["js", "jsx"].includes(ext)) {
        return fileIconsMap.js(darkMode);
      }
      if (["ts", "tsx"].includes(ext)) {
        return fileIconsMap.ts(darkMode);
      }
      if (["css", "scss", "sass", "less"].includes(ext)) {
        return fileIconsMap.css(darkMode);
      }
      if (ext === "py") {
        return fileIconsMap.python(darkMode);
      }
      if (ext === "vue") {
        return fileIconsMap.vue(darkMode);
      }
      if (ext === "java") {
        return fileIconsMap.java(darkMode);
      }
      if (["cpp", "cc", "cxx", "c++"].includes(ext)) {
        return fileIconsMap.cpp(darkMode);
      }
      if (ext === "go") {
        return fileIconsMap.go ? fileIconsMap.go(darkMode) : fileIconsMap.code(darkMode);
      }
      if (ext === "rs") {
        return fileIconsMap.rust ? fileIconsMap.rust(darkMode) : fileIconsMap.code(darkMode);
      }
      if (ext === "kt") {
        return fileIconsMap.kotlin ? fileIconsMap.kotlin(darkMode) : fileIconsMap.code(darkMode);
      }
      if (ext === "swift") {
        return fileIconsMap.swift ? fileIconsMap.swift(darkMode) : fileIconsMap.code(darkMode);
      }
      if (ext === "php") {
        return fileIconsMap.php ? fileIconsMap.php(darkMode) : fileIconsMap.code(darkMode);
      }
      if (["rb", "ruby"].includes(ext)) {
        return fileIconsMap.ruby ? fileIconsMap.ruby(darkMode) : fileIconsMap.code(darkMode);
      }
      if (ext === "cs") {
        return fileIconsMap.csharp ? fileIconsMap.csharp(darkMode) : fileIconsMap.code(darkMode);
      }
      if (ext === "c") {
        return fileIconsMap.c ? fileIconsMap.c(darkMode) : fileIconsMap.code(darkMode);
      }
      if (["sh", "bash", "zsh", "ps1", "bat", "cmd"].includes(ext)) {
        return fileIconsMap.shell ? fileIconsMap.shell(darkMode) : fileIconsMap.code(darkMode);
      }
      if (ext === "xml") {
        return fileIconsMap.xml ? fileIconsMap.xml(darkMode) : fileIconsMap.code(darkMode);
      }
      if (["yml", "yaml"].includes(ext)) {
        return fileIconsMap.yaml ? fileIconsMap.yaml(darkMode) : fileIconsMap.code(darkMode);
      }
      if (["dockerfile", "docker"].includes(ext)) {
        return fileIconsMap.docker ? fileIconsMap.docker(darkMode) : fileIconsMap.code(darkMode);
      }
      if (ext === "git") {
        return fileIconsMap.git ? fileIconsMap.git(darkMode) : fileIconsMap.code(darkMode);
      }

      if (codeExtensions.includes(ext)) {
        return fileIconsMap.code(darkMode);
      }
    }

    // OFFICE 类型的细分处理
    if (iconType === "document") {
      // PDF 文件
      if (ext === "pdf") {
        return fileIconsMap.pdf(darkMode);
      }

      // RTF 文件
      if (ext === "rtf") {
        return fileIconsMap.rtf(darkMode);
      }

      // PowerPoint 文件
      if (["ppt", "pptx"].includes(ext)) {
        return fileIconsMap.presentation(darkMode);
      }

      // Excel 文件
      if (["xls", "xlsx"].includes(ext)) {
        return fileIconsMap.spreadsheet(darkMode);
      }

      // Word 文件
      if (["doc", "docx"].includes(ext)) {
        return fileIconsMap.word(darkMode);
      }

      return fileIconsMap.office(darkMode);
    }

    // System 类型：跨类型优先显示更具体的图标
    if (ext === "apk") {
      return fileIconsMap.apk(darkMode);
    }
    if (ext === "iso") {
      return fileIconsMap.iso(darkMode);
    }
    if (ext === "dmg") {
      return fileIconsMap.dmg(darkMode);
    }

    // 压缩文件的特殊处理（跨类型）
    const archiveExtensions = ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "tbz", "tbz2", "txz", "cpio", "cab", "xar", "ar", "a", "mtree"];
    if (archiveExtensions.includes(ext)) {
      return fileIconsMap.archive(darkMode);
    }

    // 可执行文件的特殊处理（跨类型）
    const executableExtensions = ["exe", "msi", "app", "deb", "rpm", "pkg", "run", "bin"];
    if (executableExtensions.includes(ext)) {
      return fileIconsMap.executable(darkMode);
    }
  }

  if (iconType === "document") {
    return fileIconsMap.office(darkMode);
  }

  // 使用默认的类型图标
  return fileIconsMap[iconType] ? fileIconsMap[iconType](darkMode) : fileIconsMap.default(darkMode);
};
