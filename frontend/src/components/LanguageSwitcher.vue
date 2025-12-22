<template>
  <button
    type="button"
    @click="toggleLanguageMenu"
    :class="[
      'p-2 rounded-full focus:outline-none transition-colors relative',
      darkMode ? 'text-blue-300 hover:text-blue-200 hover:bg-gray-700' : 'text-gray-500 hover:text-gray-600 hover:bg-gray-100',
    ]"
    :aria-label="$t('language.toggle')"
  >
    <span class="sr-only">{{ $t("language.toggle") }}</span>
    <IconTranslate />

    <!-- 当前语言指示器 -->
    <span class="absolute top-0 right-0 inline-flex items-center justify-center h-3 w-3 rounded-full bg-blue-500 text-xs text-white">
      {{ currentLanguage === "zh-CN" ? "zh" : "en" }}
    </span>

    <!-- 语言选择下拉菜单 -->
    <div
      v-show="showLanguageMenu"
      class="absolute right-0 mt-2 py-1 w-40 rounded-md shadow-lg z-10"
      :class="darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'"
    >
      <a
        href="#"
        @click.prevent="changeLanguage('zh-CN')"
        class="block px-4 py-2 text-sm"
        :class="[
          currentLanguage === 'zh-CN' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-900') : '',
          darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
        ]"
      >
        {{ $t("language.zh") }}
      </a>
      <a
        href="#"
        @click.prevent="changeLanguage('en-US')"
        class="block px-4 py-2 text-sm"
        :class="[
          currentLanguage === 'en-US' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-900') : '',
          darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
        ]"
      >
        {{ $t("language.en") }}
      </a>
    </div>
  </button>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { saveLanguagePreference } from "../i18n";
import { IconTranslate } from "@/components/icons";

const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const { locale, t } = useI18n();
const showLanguageMenu = ref(false);
const currentLanguage = computed(() => locale.value);

// 初始化时检查当前语言
onMounted(() => {
  // 确保语言与本地存储一致
  const savedLang = localStorage.getItem("language");
  if (savedLang && savedLang !== locale.value) {
    locale.value = savedLang;
  }
});

// 切换语言菜单显示状态
const toggleLanguageMenu = () => {
  showLanguageMenu.value = !showLanguageMenu.value;
};

// 切换语言
const changeLanguage = (lang) => {
  locale.value = lang;
  saveLanguagePreference(lang);
  showLanguageMenu.value = false;

  // 触发全局事件，用于通知其他组件语言已更改
  window.dispatchEvent(new CustomEvent("languageChanged", { detail: { locale: lang } }));
};

// 点击外部区域关闭菜单
const handleClickOutside = (event) => {
  const target = event.target;
  if (showLanguageMenu.value && !target.closest("button")) {
    showLanguageMenu.value = false;
  }
};

// 挂载和卸载点击外部关闭事件
onMounted(() => {
  document.addEventListener("click", handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleClickOutside);
});
</script>
