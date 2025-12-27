import { computed, watch } from "vue";
import { useColorMode } from "@vueuse/core";

const THEME_KEY = "themeMode";
const ALLOWED_MODES = new Set(["auto", "light", "dark"]);

// 使用 VueUse 的 useColorMode 统一管理：
// - store: 'auto' | 'light' | 'dark'（真实存储值）
// - state: 'light' | 'dark'（最终生效值）
const colorMode = useColorMode({
  storageKey: THEME_KEY,
  onChanged(mode) {
    // 只维护 Tailwind 需要的 dark class，避免额外写入 light/auto class
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (!root) return;
    if (mode === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  },
});

const themeMode = colorMode.store;
const isDarkMode = computed(() => colorMode.state.value === "dark");

function applyBodyTheme() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const body = document.body;
  if (!root || !body) return;

  if (isDarkMode.value) {
    body.classList.add("bg-custom-bg-900", "text-custom-text-dark");
    body.classList.remove("bg-custom-bg-50", "text-custom-text");
  } else {
    body.classList.add("bg-custom-bg-50", "text-custom-text");
    body.classList.remove("bg-custom-bg-900", "text-custom-text-dark");
  }
}

let initialized = false;

export function useThemeMode() {
  if (!initialized) {
    initialized = true;

    // 如果 localStorage 里存了脏值，统一回退到 auto
    watch(
      themeMode,
      (val) => {
        if (!ALLOWED_MODES.has(val)) {
          themeMode.value = "auto";
        }
      },
      { immediate: true }
    );

    // mode / 系统偏好变化时，刷新 body 主题样式
    watch(isDarkMode, () => applyBodyTheme(), { immediate: true });
  }

  const toggleThemeMode = () => {
    const modes = ["auto", "light", "dark"];
    const currentIndex = modes.indexOf(themeMode.value);
    const nextIndex = (currentIndex + 1) % modes.length;
    themeMode.value = modes[nextIndex];
  };

  const setThemeMode = (mode) => {
    if (!ALLOWED_MODES.has(mode)) return;
    themeMode.value = mode;
  };

  const syncWithSystem = () => {
    themeMode.value = "auto";
  };

  return {
    themeMode,
    isDarkMode,
    toggleThemeMode,
    setThemeMode,
    syncWithSystem,
  };
}
