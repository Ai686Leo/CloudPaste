<template>
  <span :class="badgeClass">
    {{ statusText }}
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  status: {
    type: String,
    required: true
  }
})

const { t } = useI18n()

const statusConfig = {
  pending: {
    class: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
  },
  running: {
    class: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
  },
  completed: {
    class: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
  },
  partial: {
    class: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
  },
  failed: {
    class: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
  },
  cancelled: {
    class: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
  }
}

const statusText = computed(() => {
  const textMap = {
    pending: t('admin.tasks.status.pending'),
    running: t('admin.tasks.status.running'),
    completed: t('admin.tasks.status.completed'),
    partial: t('admin.tasks.status.partial'),
    failed: t('admin.tasks.status.failed'),
    cancelled: t('admin.tasks.status.cancelled')
  }
  return textMap[props.status] || props.status
})

const badgeClass = computed(() => {
  const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
  const colorClass = statusConfig[props.status]?.class || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
  return `${baseClass} ${colorClass}`
})
</script>
