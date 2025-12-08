import { spacing, radius, duration, easing, elevation, elevationDark } from './src/styles/design-tokens.js'

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    screens: {
      xs: "360px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      // 设计令牌：间距
      spacing: {
        'token-0': spacing['0'],
        'token-1': spacing['1'],
        'token-2': spacing['2'],
        'token-3': spacing['3'],
        'token-4': spacing['4'],
        'token-5': spacing['5'],
        'token-6': spacing['6'],
        'token-8': spacing['8'],
        'token-10': spacing['10'],
        'token-12': spacing['12'],
      },
      
      // 设计令牌：圆角
      borderRadius: {
        'token-none': radius.none,
        'token-sm': radius.sm,
        'token-md': radius.md,
        'token-lg': radius.lg,
        'token-xl': radius.xl,
        'token-2xl': radius['2xl'],
        'token-full': radius.full,
      },
      
      // 设计令牌：动画时长
      transitionDuration: {
        'token-instant': duration.instant,
        'token-fast': duration.fast,
        'token-normal': duration.normal,
        'token-slow': duration.slow,
      },
      
      // 设计令牌：缓动函数
      transitionTimingFunction: {
        'token-default': easing.default,
        'token-in': easing.in,
        'token-out': easing.out,
        'token-in-out': easing.inOut,
        'token-bounce': easing.bounce,
      },
      
      // 设计令牌：阴影
      boxShadow: {
        'token-0': elevation[0],
        'token-1': elevation[1],
        'token-2': elevation[2],
        'token-3': elevation[3],
        'token-4': elevation[4],
        'dark-token-1': elevationDark[1],
        'dark-token-2': elevationDark[2],
        'dark-token-3': elevationDark[3],
        'dark-token-4': elevationDark[4],
      },
      
      colors: {
        primary: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#3b82f6",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
          950: "#082f49",
        },
        secondary: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
          950: "#2e1065",
        },
        // 支持自定义CSS变量的颜色系统
        "custom-bg": {
          50: "var(--custom-bg-light, rgb(249 250 251))",
          900: "var(--custom-bg-dark, rgb(17 24 39))",
        },
        "custom-surface": {
          DEFAULT: "var(--custom-surface-light, rgb(255 255 255))",
          dark: "var(--custom-surface-dark, rgb(31 41 55))",
        },
        "custom-text": {
          DEFAULT: "var(--custom-text-light, rgb(17 24 39))",
          dark: "var(--custom-text-dark, rgb(243 244 246))",
        },
        // 文件浏览器语义化颜色（CSS 变量）
        explorer: {
          hover: "var(--explorer-hover, rgba(0, 0, 0, 0.04))",
          selected: "var(--explorer-selected, rgba(59, 130, 246, 0.1))",
          muted: "var(--explorer-muted, rgb(107, 114, 128))",
          border: "var(--explorer-border, rgb(229, 231, 235))",
        },
      },

      gridTemplateColumns: {
        "file-list": "2fr 0.8fr 1fr 0.8fr 0.8fr 1.5fr 0.8fr",
        "search-result": "2fr 1fr 1fr 1.5fr auto",
        "search-result-simple": "2fr 1fr auto",
      },
      
      // 自定义动画 keyframes
      keyframes: {
        'fade-in-scale': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateX(-50%) translateY(100px)' },
          '100%': { opacity: '1', transform: 'translateX(-50%) translateY(0)' },
        },
        'slide-down': {
          '0%': { opacity: '1', transform: 'translateX(-50%) translateY(0)' },
          '100%': { opacity: '0', transform: 'translateX(-50%) translateY(100px)' },
        },
        'slide-right-in': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-right-out': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
      },
      
      // 自定义动画
      animation: {
        'fade-in-scale': `fade-in-scale ${duration.normal} ${easing.out} forwards`,
        'slide-up': `slide-up ${duration.normal} ${easing.default}`,
        'slide-down': `slide-down ${duration.normal} ${easing.default}`,
        'slide-right-in': `slide-right-in ${duration.normal} ${easing.default}`,
        'slide-right-out': `slide-right-out ${duration.normal} ${easing.default}`,
        'shimmer': 'shimmer 1.5s infinite',
        'fade-in': `fade-in ${duration.fast} ${easing.default}`,
        'fade-out': `fade-out ${duration.fast} ${easing.default}`,
      },
    },
  },
  plugins: [],
  darkMode: "class",
};
