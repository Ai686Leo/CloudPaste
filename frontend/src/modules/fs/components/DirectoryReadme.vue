<template>
  <div v-if="hasContent" class="mt-6 mb-6">
    <div
      class="rounded-xl px-2 py-2 shadow-lg"
      :class="darkMode ? 'bg-gray-800' : 'bg-white'"
    >
      <MarkdownDisplay :content="content" :dark-mode="darkMode" />
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import MarkdownDisplay from "@/components/common/text-preview/MarkdownDisplay.vue";

const props = defineProps({
  position: {
    type: String,
    default: "top", // "top" | "bottom"
  },
  meta: {
    type: Object,
    default: null,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const content = computed(() => {
  if (!props.meta) {
    return "";
  }
  if (props.position === "bottom") {
    return props.meta.footerMarkdown || "";
  }
  return props.meta.headerMarkdown || "";
});

const hasContent = computed(() => Boolean(content.value && content.value.trim().length > 0));
</script>

