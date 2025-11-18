import { ref, watch, onMounted, onBeforeUnmount } from "vue";

const THEME_KEY = "themeMode";

let initialMode = "auto";

try {
  if (typeof window !== "undefined" && window.localStorage) {
    initialMode = window.localStorage.getItem(THEME_KEY) || "auto";
  }
} catch {
  initialMode = "auto";
}

const themeMode = ref(initialMode);
const isDarkMode = ref(false);

let mediaQuery = null;
let mediaQueryHandler = null;

const computeIsDark = () => {
  if (themeMode.value === "auto") {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  }
  return themeMode.value === "dark";
};

const applyTheme = () => {
  isDarkMode.value = computeIsDark();

  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const body = document.body;

  if (isDarkMode.value) {
    root.classList.add("dark");
    body.classList.add("bg-custom-bg-900", "text-custom-text-dark");
    body.classList.remove("bg-custom-bg-50", "text-custom-text");
  } else {
    root.classList.remove("dark");
    body.classList.add("bg-custom-bg-50", "text-custom-text");
    body.classList.remove("bg-custom-bg-900", "text-custom-text-dark");
  }

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(THEME_KEY, themeMode.value);
    }
  } catch {
    // ignore storage errors
  }
};

const ensureMediaQuery = () => {
  if (typeof window === "undefined" || !window.matchMedia) {
    return;
  }

  if (!mediaQuery) {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  }

  if (!mediaQueryHandler) {
    mediaQueryHandler = (event) => {
      if (themeMode.value === "auto") {
        isDarkMode.value = event.matches;
        applyTheme();
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", mediaQueryHandler);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(mediaQueryHandler);
    }
  }
};

const cleanupMediaQuery = () => {
  if (mediaQuery && mediaQueryHandler) {
    if (mediaQuery.removeEventListener) {
      mediaQuery.removeEventListener("change", mediaQueryHandler);
    } else if (mediaQuery.removeListener) {
      mediaQuery.removeListener(mediaQueryHandler);
    }
    mediaQueryHandler = null;
  }
};

export function useThemeMode() {
  onMounted(() => {
    ensureMediaQuery();
    applyTheme();
  });

  onBeforeUnmount(() => {
    cleanupMediaQuery();
  });

  watch(
    themeMode,
    () => {
      applyTheme();
    },
    { immediate: true }
  );

  const toggleThemeMode = () => {
    const modes = ["auto", "light", "dark"];
    const currentIndex = modes.indexOf(themeMode.value);
    const nextIndex = (currentIndex + 1) % modes.length;
    themeMode.value = modes[nextIndex];
  };

  const setThemeMode = (mode) => {
    if (!["auto", "light", "dark"].includes(mode)) {
      return;
    }
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

