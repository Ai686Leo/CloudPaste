<template>
  <!-- 设置抽屉 - 右侧滑出面板 -->
  <Teleport to="body">
    <!-- 遮罩层 -->
    <Transition name="fade">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
        @click="handleClose"
      />
    </Transition>

    <!-- 抽屉面板 -->
    <Transition name="slide-right">
      <div
        v-if="isOpen"
        class="fixed top-0 right-0 z-[61] h-full w-80 max-w-[90vw] overflow-y-auto shadow-token-4"
        :class="darkMode ? 'bg-gray-800' : 'bg-white'"
        @click.stop
      >
        <!-- 头部 -->
        <div
          class="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
          :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
        >
          <h3 class="text-base font-medium" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
            {{ t('mount.settings.title') }}
          </h3>
          <button
            @click="handleClose"
            class="p-1.5 rounded-token-md transition-colors duration-token-fast"
            :class="darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'"
          >
            <IconClose size="md" class="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <!-- 设置内容 -->
        <div class="p-4 space-y-6">
          <!-- 视图模式 -->
          <SettingSection :title="t('mount.settings.viewMode')" :dark-mode="darkMode">
            <div class="flex gap-2">
              <ViewModeButton
                v-for="mode in viewModes"
                :key="mode.value"
                :active="settings.viewMode === mode.value"
                :dark-mode="darkMode"
                @click="updateSetting('viewMode', mode.value)"
              >
                <component :is="mode.icon" size="sm" aria-hidden="true" />
                <span class="text-xs">{{ t(mode.label) }}</span>
              </ViewModeButton>
            </div>
          </SettingSection>

          <!-- 显示密度 - 连续值滑块 -->
          <SettingSection :title="t('mount.settings.density')" :dark-mode="darkMode">
            <div class="space-y-2">
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  :value="settings.densityValue"
                  @input="updateSetting('densityValue', parseInt($event.target.value))"
                  class="flex-1 h-2 rounded-full appearance-none cursor-pointer slider-thumb"
                  :class="darkMode ? 'bg-gray-600' : 'bg-gray-200'"
                />
                <span class="text-xs w-8 text-right" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ settings.densityValue }}
                </span>
              </div>
              <div class="flex justify-between text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                <span>{{ t('mount.settings.densityCompact') }}</span>
                <span>{{ t('mount.settings.densitySpacious') }}</span>
              </div>
            </div>
          </SettingSection>

          <!-- 文件间距 - 连续值滑块 -->
          <SettingSection :title="t('mount.settings.itemSpacing')" :dark-mode="darkMode">
            <div class="space-y-2">
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  :value="settings.spacingValue"
                  @input="updateSetting('spacingValue', parseInt($event.target.value))"
                  class="flex-1 h-2 rounded-full appearance-none cursor-pointer slider-thumb"
                  :class="darkMode ? 'bg-gray-600' : 'bg-gray-200'"
                />
                <span class="text-xs w-8 text-right" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ settings.spacingValue }}
                </span>
              </div>
              <div class="flex justify-between text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                <span>{{ t('mount.settings.spacingCompact') }}</span>
                <span>{{ t('mount.settings.spacingRelaxed') }}</span>
              </div>
            </div>
          </SettingSection>

          <!-- 显示选项 -->
          <SettingSection :title="t('mount.settings.displayOptions')" :dark-mode="darkMode">
            <div class="space-y-3">
              <ToggleItem
                :label="t('mount.settings.showCheckboxes')"
                :checked="settings.showCheckboxes"
                :dark-mode="darkMode"
                @change="updateSetting('showCheckboxes', $event)"
              />
              <ToggleItem
                :label="t('mount.settings.showActionButtons')"
                :checked="settings.showActionButtons"
                :dark-mode="darkMode"
                @change="updateSetting('showActionButtons', $event)"
              />
            </div>
          </SettingSection>

          <!-- 排序配置 -->
          <SettingSection :title="t('mount.settings.sorting')" :dark-mode="darkMode">
            <div class="space-y-3">
              <div>
                <label class="block text-xs mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t('mount.settings.sortBy') }}
                </label>
                <select
                  :value="settings.sortBy"
                  @change="updateSetting('sortBy', $event.target.value)"
                  class="w-full px-3 py-2 rounded-token-md border text-sm transition-colors duration-token-fast"
                  :class="darkMode 
                    ? 'bg-gray-700 border-gray-600 text-gray-200' 
                    : 'bg-white border-gray-300 text-gray-700'"
                >
                  <option value="name">{{ t('mount.settings.sortByName') }}</option>
                  <option value="size">{{ t('mount.settings.sortBySize') }}</option>
                  <option value="modified">{{ t('mount.settings.sortByModified') }}</option>
                  <option value="type">{{ t('mount.settings.sortByType') }}</option>
                </select>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                  {{ t('mount.settings.sortOrder') }}
                </span>
                <button
                  @click="toggleSortOrder"
                  class="flex items-center gap-1 px-2 py-1 rounded-token-md text-sm transition-colors duration-token-fast"
                  :class="darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'"
                >
                  <IconChevronUp
                    size="sm"
                    class="w-4 h-4 transition-transform duration-token-fast"
                    :class="{ 'rotate-180': settings.sortOrder === 'desc' }"
                    aria-hidden="true"
                  />
                  <span>{{ settings.sortOrder === 'asc' ? t('mount.settings.ascending') : t('mount.settings.descending') }}</span>
                </button>
              </div>
              <ToggleItem
                :label="t('mount.settings.foldersFirst')"
                :checked="settings.foldersFirst"
                :dark-mode="darkMode"
                @change="updateSetting('foldersFirst', $event)"
              />
            </div>
          </SettingSection>

          <!-- 动画设置 -->
          <SettingSection :title="t('mount.settings.animations')" :dark-mode="darkMode">
            <ToggleItem
              :label="t('mount.settings.enableAnimations')"
              :checked="settings.animationsEnabled"
              :dark-mode="darkMode"
              @change="updateSetting('animationsEnabled', $event)"
            />
          </SettingSection>

          <!-- 文件名显示 -->
          <SettingSection :title="t('mount.settings.fileNameDisplay')" :dark-mode="darkMode">
            <select
              :value="settings.fileNameOverflow"
              @change="updateSetting('fileNameOverflow', $event.target.value)"
              class="w-full px-3 py-2 rounded-token-md border text-sm transition-colors duration-token-fast"
              :class="darkMode 
                ? 'bg-gray-700 border-gray-600 text-gray-200' 
                : 'bg-white border-gray-300 text-gray-700'"
            >
              <option value="ellipsis">{{ t('mount.settings.fileNameEllipsis') }}</option>
              <option value="scroll">{{ t('mount.settings.fileNameScroll') }}</option>
              <option value="wrap">{{ t('mount.settings.fileNameWrap') }}</option>
            </select>
          </SettingSection>

          <!-- 重置按钮 -->
          <div class="pt-4 border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
            <button
              @click="handleReset"
              class="w-full px-4 py-2 rounded-token-md text-sm font-medium transition-colors duration-token-fast"
              :class="darkMode 
                ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' 
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
            >
              {{ t('mount.settings.resetToDefault') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { h } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useExplorerSettings } from '@/composables/useExplorerSettings'
import { IconChevronUp, IconClose, IconGallery, IconGrid, IconList } from '@/components/icons'

// 子组件定义
const SettingSection = (props, { slots }) => {
  return h('div', { class: 'space-y-2' }, [
    h('h4', { 
      class: `text-sm font-medium ${props.darkMode ? 'text-gray-200' : 'text-gray-800'}` 
    }, props.title),
    slots.default?.()
  ])
}
SettingSection.props = ['title', 'darkMode']

const ToggleItem = (props, { emit }) => {
  return h('label', { 
    class: `flex items-center justify-between cursor-pointer` 
  }, [
    h('span', { 
      class: `text-sm ${props.darkMode ? 'text-gray-300' : 'text-gray-700'}` 
    }, props.label),
    h('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': props.checked,
      class: `relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-token-fast ${
        props.checked 
          ? 'bg-primary-500' 
          : props.darkMode ? 'bg-gray-600' : 'bg-gray-300'
      }`,
      onClick: () => emit('change', !props.checked)
    }, [
      h('span', {
        class: `inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-token-fast ${
          props.checked ? 'translate-x-4' : 'translate-x-0.5'
        }`
      })
    ])
  ])
}
ToggleItem.props = ['label', 'checked', 'darkMode']
ToggleItem.emits = ['change']

const ViewModeButton = (props, { slots, emit }) => {
  return h('button', {
    class: `flex-1 flex flex-col items-center gap-1 px-3 py-2 rounded-token-md border transition-all duration-token-fast ${
      props.active
        ? props.darkMode 
          ? 'bg-primary-500/20 border-primary-500 text-primary-400' 
          : 'bg-primary-50 border-primary-500 text-primary-600'
        : props.darkMode
          ? 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
          : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
    }`,
    onClick: () => emit('click')
  }, slots.default?.())
}
ViewModeButton.props = ['active', 'darkMode']
ViewModeButton.emits = ['click']

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  darkMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close'])

const { t } = useI18n()
const explorerSettings = useExplorerSettings()
const { settings } = storeToRefs(explorerSettings)

// 视图模式选项
const viewModes = [
  { 
    value: 'list', 
    label: 'mount.settings.listView',
    icon: IconList
  },
  { 
    value: 'grid', 
    label: 'mount.settings.gridView',
    icon: IconGrid
  },
  { 
    value: 'gallery', 
    label: 'mount.settings.galleryView',
    icon: IconGallery
  }
]

// 更新设置
function updateSetting(key, value) {
  explorerSettings.updateSetting(key, value)
}

// 切换排序顺序
function toggleSortOrder() {
  explorerSettings.toggleSortOrder()
}

// 重置设置
function handleReset() {
  explorerSettings.resetSettings()
}

// 关闭抽屉
function handleClose() {
  emit('close')
}
</script>

<style scoped>
/* 遮罩淡入淡出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 250ms cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 抽屉滑入滑出 */
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
}

/* 滑块样式 */
.slider-thumb::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #3b82f6;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 150ms ease;
}

.slider-thumb::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.slider-thumb::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #3b82f6;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 150ms ease;
}

.slider-thumb::-moz-range-thumb:hover {
  transform: scale(1.1);
}
</style>
