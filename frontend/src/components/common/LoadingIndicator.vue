<template>
  <div class="loading-indicator flex flex-col items-center justify-center" :class="containerClass">
    <IconRefresh
      :size="size"
      class="animate-spin"
      :class="[iconClass, text ? 'mb-2' : '']"
      aria-hidden="true"
    />
    <p v-if="text" class="text-sm" :class="resolvedTextClass">{{ text }}</p>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { IconRefresh } from "@/components/icons";

const props = defineProps({
  text: {
    type: String,
    default: "",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  size: {
    type: String,
    default: "xl",
  },
  iconClass: {
    type: String,
    default: "",
  },
  textClass: {
    type: String,
    default: "",
  },
  containerClass: {
    type: String,
    default: "",
  },
});

const resolvedTextClass = computed(() => {
  if (props.textClass) {
    return props.textClass;
  }
  return props.darkMode ? "text-gray-400" : "text-gray-600";
});
</script>
