<template>
  <OfficePreviewContainer
    :content-url="contentUrl"
    :filename="filename"
    :is-fullscreen="isFullscreen"
    :providers="normalizedProviders"
    :default-provider="providerKey"
    :height-mode="isFullscreen ? 'flex' : 'fixed'"
    :show-provider-selector="false"
    :show-footer="false"
    :error-message="errorMessage"
    @load="emit('load')"
    @error="emit('error', $event)"
    @provider-change="emit('provider-change', $event)"
  />
</template>

<script setup>
import { computed } from "vue";
import { OfficePreviewContainer } from "@/components/office";

const props = defineProps({
  previewUrl: {
    type: String,
    default: "",
  },
  contentUrl: {
    type: String,
    default: "",
  },
  filename: {
    type: String,
    default: "",
  },
  providerKey: {
    type: String,
    default: "",
  },
  errorMessage: {
    type: String,
    default: "",
  },
  isFullscreen: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["load", "error", "provider-change"]);

// 将 previewUrl 和 providerKey 转换为 providers 对象格式
const normalizedProviders = computed(() => {
  const providers = {};

  // 如果 providerKey 是 native，添加 native 渠道
  if (props.providerKey === "native" || props.previewUrl === "native") {
    providers.native = "native";
  } else if (props.previewUrl) {
    // 使用 providerKey 作为 key，previewUrl 作为 url
    providers[props.providerKey || "default"] = props.previewUrl;
  }

  return providers;
});
</script>
