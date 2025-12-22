<template>
  <div class="epub-fs-preview w-full h-full relative">
    <!-- Native 预览：使用 FoliateEpubView -->
    <FoliateEpubView
      v-if="isNativeProvider"
      :src-url="currentNativeUrl"
      :dark-mode="darkMode"
      :loading-text="t('mount.filePreview.loadingPreview')"
      :error-text="t('mount.filePreview.previewError')"
      class="w-full h-full"
      @load="emit('load')"
      @error="emit('error')"
    />

    <!-- Iframe 预览：使用第三方服务 -->
    <IframePreview
      v-else
      :providers="currentIframeProviders"
      :dark-mode="darkMode"
      :loading-text="t('mount.filePreview.loadingPreview')"
      :error-text="t('mount.filePreview.previewError')"
      class="w-full h-full"
      @load="emit('load')"
      @error="emit('error')"
    />
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import FoliateEpubView from "@/components/common/FoliateEpubView.vue";
import IframePreview from "@/components/common/IframePreview.vue";

const { t } = useI18n();

const props = defineProps({
  // 外部传入的 provider key
  providerKey: {
    type: String,
    default: "native",
  },
  providers: {
    type: Object,
    default: () => ({}),
  },
  // 本地/原生渲染时，foliate-js 需要一个可以 fetch 的 URL
  nativeUrl: {
    type: String,
    default: "",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["load", "error"]);

// 根据外部传入的 providerKey 计算当前选项
const currentOption = computed(() => {
  const providers = props.providers || {};
  const key = props.providerKey;

  // 如果是 native 或者 providers 中该 key 的值是 "native"
  if (key === "native" || providers[key] === "native") {
    return {
      key,
      url: props.nativeUrl,
      isNative: true,
    };
  }

  // 否则是 iframe 预览
  const url = providers[key];
  if (url) {
    return {
      key,
      url,
      isNative: false,
    };
  }

  // 默认回退到 native
  return {
    key: "native",
    url: props.nativeUrl,
    isNative: true,
  };
});

const isNativeProvider = computed(() => {
  return Boolean(currentOption.value?.isNative);
});

const currentNativeUrl = computed(() => {
  return currentOption.value?.url || "";
});

const currentIframeProviders = computed(() => {
  const opt = currentOption.value;
  if (!opt || opt.isNative) return {};
  return { [opt.key]: opt.url };
});
</script>
