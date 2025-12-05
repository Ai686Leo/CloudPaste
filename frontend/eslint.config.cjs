// Flat ESLint config for ESLint v9+
// 主要规则：
// - 限制 components/* 直接依赖 modules/*
// - 限制随意 import storage-core 内部实现（drivers/uppy）

const vue = require("eslint-plugin-vue");
const importPlugin = require("eslint-plugin-import");
const vueParser = require("vue-eslint-parser");

/** @type {import("eslint").Linter.FlatConfig[]} */
module.exports = [
  ...vue.configs['flat/essential'],

  // 通用规则：应用于 src 下所有 JS/Vue 文件
  {
    files: ["src/**/*.{js,vue}"],
    ignores: ["dist/**"],
    languageOptions: {
      parser: vueParser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
      },
    },
    plugins: {
      vue,
      import: importPlugin,
    },
    // 对当前规则不强依赖 import 解析，暂时不配置 import/resolver
    rules: {
      // Vue 推荐规则基础上关闭多词组件名限制（项目中已有大量单词组件名）
      "vue/multi-word-component-names": "off",

      // 1) components/* 禁止依赖 modules/*
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/components",
              from: "./src/modules",
              message:
                "通用组件层禁止直接依赖 modules/*，请在 modules/<domain> 中封装领域组件再在上层使用。",
            },
          ],
        },
      ],

      // 2) 禁止直接使用 storage-core 内部实现（drivers/uppy）
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/modules/storage-core/drivers/*",
                "@/modules/storage-core/uppy/*",
              ],
              message:
                "禁止直接依赖 storage-core 内部实现，请通过 modules/storage-core/index 或 modules/upload/shareUploadController 访问。",
            },
          ],
        },
      ],
    },
  },

  // 特例：允许 storage-core / upload / FS Uppy 弹窗直接使用 storage-core 内部实现
  {
    files: [
      "src/modules/storage-core/**/*.{js,vue}",
      "src/modules/upload/**/*.{js,vue}",
      "src/modules/fs/components/shared/modals/UppyUploadModal.vue",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
