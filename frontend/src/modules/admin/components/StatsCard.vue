<template>
  <div class="bg-white dark:bg-gray-800 p-4 sm:p-5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm flex items-start justify-between hover:shadow-md transition-shadow">
    <div>
      <p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ title }}</p>
      <h3 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{{ value }}</h3>
      <p v-if="trend" class="text-xs text-gray-400 dark:text-gray-500 mt-2">{{ trend }}</p>
    </div>
    <div :class="colorClass + ' p-2 rounded-lg'">
      <component :is="icon" class="w-5 h-5" />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    required: true
  },
  value: {
    type: Number,
    required: true
  },
  icon: {
    type: Object,
    required: true
  },
  trend: {
    type: String,
    default: null
  },
  colorClass: {
    type: String,
    required: true
  }
})
</script>
