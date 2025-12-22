import { computed, ref, watch, unref } from "vue";

/**
 * 通用的“预览渠道（providers）选择器”逻辑
 *
 *
 * providers 结构：{ [providerKey]: stringUrl | "native" }
 */
export function useProviderSelector({
  providers,
  nativeUrl,
  nativeLabel,
  initialKey = "native",
  labelMap,
  filter,
}) {
  const selectedKey = ref(initialKey);

  const providerOptions = computed(() => {
    const map = unref(providers) || {};
    const native = String(unref(nativeUrl) || "").trim();
    const labelForNative = unref(nativeLabel) || "native";
    const mappedLabels = unref(labelMap) || {};

    const options = [];
    const hasNativePlaceholder = Object.values(map).some((v) => v === "native");

    // 如果规则里没有显式声明 native 占位符，但我们有 nativeUrl，那么给一个默认 native 选项。
    if (!hasNativePlaceholder && native) {
      options.push({
        key: "native",
        label: labelForNative,
        url: native,
        isNative: true,
      });
    }

    for (const [key, rawUrl] of Object.entries(map)) {
      if (!rawUrl) continue;

      // 允许外部过滤（例如 iframe 预览不允许 native）
      if (typeof filter === "function" && !filter({ key, url: rawUrl })) {
        continue;
      }

      if (rawUrl === "native") {
        if (!native) continue;
        options.push({
          key,
          label: key === "native" ? labelForNative : key,
          url: native,
          isNative: true,
        });
        continue;
      }

      options.push({
        key,
        label: mappedLabels[key] || key,
        url: String(rawUrl),
        isNative: false,
      });
    }

    return options;
  });

  const currentOption = computed(() => {
    const options = providerOptions.value;
    if (!options.length) return null;
    return options.find((opt) => opt.key === selectedKey.value) || options[0];
  });

  const currentUrl = computed(() => {
    return currentOption.value?.url || "";
  });

  const isNativeProvider = computed(() => {
    return Boolean(currentOption.value?.isNative);
  });

  const currentIframeProviders = computed(() => {
    const opt = currentOption.value;
    if (!opt || opt.isNative) return {};
    if (!opt.url) return {};
    return { [opt.key]: opt.url };
  });

  // providers 变了（或 nativeUrl 变了）时，自动修正 selectedKey
  watch(
    providerOptions,
    (options) => {
      if (!options.length) {
        selectedKey.value = "";
        return;
      }
      const exists = options.some((opt) => opt.key === selectedKey.value);
      if (exists) return;

      // 优先 native（如果存在），否则选第一个
      selectedKey.value = options.some((opt) => opt.key === "native") ? "native" : options[0].key;
    },
    { immediate: true },
  );

  return {
    providerOptions,
    selectedKey,
    currentOption,
    currentUrl,
    isNativeProvider,
    currentIframeProviders,
  };
}

