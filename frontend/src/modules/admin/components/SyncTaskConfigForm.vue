<template>
  <div class="sync-task-config-form">
    <!-- 路径对列表 -->
    <div class="space-y-4">
      <TransitionGroup name="path-pair-list" tag="div" class="space-y-4">
        <div
          v-for="(pair, index) in pathPairs"
          :key="pair.id"
          class="path-pair-container"
        >
          <!-- 路径对标题行 - 可点击展开/收缩 -->
          <div
            class="flex items-center justify-between cursor-pointer select-none group/header py-1.5 px-1"
            :class="pair.collapsed ? 'mb-0' : 'mb-3'"
            @click="togglePairCollapsed(pair)"
          >
            <div class="flex items-center gap-2">
              <!-- 展开/收缩箭头 -->
              <button
                type="button"
                class="p-0.5 rounded transition-all"
                :class="darkMode ? 'text-gray-400 group-hover/header:text-gray-300' : 'text-gray-500 group-hover/header:text-gray-600'"
                :title="pair.collapsed ? $t('admin.scheduledJobs.syncTask.expandPair', '展开路径对') : $t('admin.scheduledJobs.syncTask.collapsePair', '收起路径对')"
              >
                <svg
                  class="w-4 h-4 transition-transform duration-200"
                  :class="{ 'rotate-90': !pair.collapsed }"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <span
                class="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-semibold"
                :class="darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'"
              >
                {{ index + 1 }}
              </span>
              <span class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                {{ $t('admin.scheduledJobs.syncTask.pairNumber', '路径对 {n}', { n: index + 1 }) }}
              </span>
              <!-- 配置完成标记 -->
              <svg
                v-if="pair.sourcePath && pair.targetPath"
                class="w-4 h-4"
                :class="darkMode ? 'text-green-400' : 'text-green-500'"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>

              <!-- 收缩状态下显示路径摘要 -->
              <div
                v-if="pair.collapsed && (pair.sourcePath || pair.targetPath)"
                class="flex items-center gap-2 ml-2 text-xs font-mono truncate max-w-[300px] xl:max-w-[500px]"
                :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
              >
                <span class="truncate" :title="pair.sourcePath">{{ pair.sourcePath || '...' }}</span>
                <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span class="truncate" :title="pair.targetPath">{{ pair.targetPath || '...' }}</span>
              </div>
            </div>
            <button
              v-if="pathPairs.length > 1"
              @click.stop="removePathPair(pair.id)"
              class="text-xs px-2 py-1 rounded transition-colors"
              :class="darkMode ? 'text-gray-500 hover:text-red-400 hover:bg-gray-800' : 'text-gray-400 hover:text-red-500 hover:bg-gray-100'"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 双面板布局 - FreeFileSync 风格 (可折叠) -->
          <Transition name="pair-content">
            <div v-show="!pair.collapsed" class="dual-panel-container">
            <!-- 源路径面板 -->
            <div class="path-panel" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
              <!-- 面板标题 -->
              <div
                class="panel-header"
                :class="darkMode ? 'bg-blue-900/30 border-gray-700' : 'bg-blue-50 border-gray-200'"
              >
                <div class="flex items-center gap-2">
                  <svg class="w-4 h-4" :class="darkMode ? 'text-blue-400' : 'text-blue-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span class="text-sm font-medium" :class="darkMode ? 'text-blue-300' : 'text-blue-700'">
                    {{ $t('admin.scheduledJobs.syncTask.sourcePath', '源路径') }}
                  </span>
                </div>
              </div>

              <!-- 路径输入 -->
              <div class="panel-input">
                <div class="flex items-center gap-2">
                  <input
                    v-model="pair.sourcePathInput"
                    type="text"
                    :placeholder="$t('admin.scheduledJobs.syncTask.quickInputPlaceholder', '输入路径后按回车...')"
                    class="flex-1 px-3 py-2 text-sm font-mono border-0 bg-transparent focus:outline-none focus:ring-0"
                    :class="darkMode ? 'text-gray-200 placeholder-gray-500' : 'text-gray-800 placeholder-gray-400'"
                    @keyup.enter="applyQuickPath(pair, 'source')"
                  />
                  <!-- 复制路径按钮 -->
                  <button
                    v-if="pair.sourcePath"
                    @click="copyPath(pair.sourcePath)"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-primary-400' : 'hover:bg-gray-100 text-gray-400 hover:text-primary-500'"
                    :title="$t('admin.scheduledJobs.syncTask.copyPath', '复制路径')"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    @click="toggleSourceExpand(pair)"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'"
                    :title="pair.sourceExpanded ? $t('admin.scheduledJobs.syncTask.collapse', '收起') : $t('admin.scheduledJobs.syncTask.expand', '展开')"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" />
                    </svg>
                  </button>
                  <button
                    v-if="pair.sourcePath"
                    @click="clearPath(pair, 'source')"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-red-400' : 'hover:bg-gray-100 text-gray-400 hover:text-red-500'"
                    :title="$t('admin.scheduledJobs.syncTask.clearPath', '清除')"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- 路径选择器 -->
              <div
                v-show="pair.sourceExpanded"
                class="panel-selector"
              >
                <PathTreeSelector
                  v-model="pair.sourcePath"
                  :dark-mode="darkMode"
                  :allow-files="true"
                  max-height="280px"
                  @update:model-value="onPathSelected(pair, 'source', $event)"
                />
              </div>

              <!-- 路径提示 -->
              <div class="panel-hint" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                {{ $t('admin.scheduledJobs.syncTask.sourcePathHint', '可以是文件或文件夹路径') }}
              </div>
            </div>

            <!-- 中间同步方向指示 -->
            <div class="sync-direction-indicator">
              <!-- 桌面端 - 专业连接线设计 -->
              <div class="hidden xl:flex flex-col items-center justify-center h-full py-8">
                <!-- 连接线上段 -->
                <div
                  class="w-px flex-1 min-h-[20px]"
                  :class="darkMode ? 'bg-gradient-to-b from-transparent via-gray-600 to-gray-600' : 'bg-gradient-to-b from-transparent via-gray-300 to-gray-300'"
                ></div>
                <!-- 箭头圆圈 -->
                <div
                  class="relative w-9 h-9 rounded-full flex items-center justify-center my-2 transition-all duration-200"
                  :class="[
                    pair.sourcePath && pair.targetPath
                      ? (darkMode ? 'bg-primary-600/20 ring-2 ring-primary-500/50' : 'bg-primary-50 ring-2 ring-primary-200')
                      : (darkMode ? 'bg-gray-800 ring-1 ring-gray-700' : 'bg-gray-50 ring-1 ring-gray-200')
                  ]"
                >
                  <svg
                    class="w-4 h-4 transition-colors"
                    :class="pair.sourcePath && pair.targetPath ? (darkMode ? 'text-primary-400' : 'text-primary-500') : (darkMode ? 'text-gray-500' : 'text-gray-400')"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
                <!-- 连接线下段 -->
                <div
                  class="w-px flex-1 min-h-[20px]"
                  :class="darkMode ? 'bg-gradient-to-b from-gray-600 via-gray-600 to-transparent' : 'bg-gradient-to-b from-gray-300 via-gray-300 to-transparent'"
                ></div>
              </div>
              <!-- 移动端 - 简洁横条 -->
              <div class="flex xl:hidden items-center justify-center py-3">
                <div
                  class="flex items-center gap-3"
                  :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
                >
                  <div class="h-px w-8" :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"></div>
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  <div class="h-px w-8" :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"></div>
                </div>
              </div>
            </div>

            <!-- 目标路径面板 -->
            <div class="path-panel" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
              <!-- 面板标题 -->
              <div
                class="panel-header"
                :class="darkMode ? 'bg-green-900/30 border-gray-700' : 'bg-green-50 border-gray-200'"
              >
                <div class="flex items-center gap-2">
                  <svg class="w-4 h-4" :class="darkMode ? 'text-green-400' : 'text-green-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span class="text-sm font-medium" :class="darkMode ? 'text-green-300' : 'text-green-700'">
                    {{ $t('admin.scheduledJobs.syncTask.targetPath', '目标路径') }}
                  </span>
                </div>
              </div>

              <!-- 路径输入 -->
              <div class="panel-input">
                <div class="flex items-center gap-2">
                  <input
                    v-model="pair.targetPathInput"
                    type="text"
                    :placeholder="$t('admin.scheduledJobs.syncTask.quickInputPlaceholder', '输入路径后按回车...')"
                    class="flex-1 px-3 py-2 text-sm font-mono border-0 bg-transparent focus:outline-none focus:ring-0"
                    :class="darkMode ? 'text-gray-200 placeholder-gray-500' : 'text-gray-800 placeholder-gray-400'"
                    @keyup.enter="applyQuickPath(pair, 'target')"
                  />
                  <!-- 复制路径按钮 -->
                  <button
                    v-if="pair.targetPath"
                    @click="copyPath(pair.targetPath)"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-primary-400' : 'hover:bg-gray-100 text-gray-400 hover:text-primary-500'"
                    :title="$t('admin.scheduledJobs.syncTask.copyPath', '复制路径')"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    @click="toggleTargetExpand(pair)"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'"
                    :title="pair.targetExpanded ? $t('admin.scheduledJobs.syncTask.collapse', '收起') : $t('admin.scheduledJobs.syncTask.expand', '展开')"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" />
                    </svg>
                  </button>
                  <button
                    v-if="pair.targetPath"
                    @click="clearPath(pair, 'target')"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-red-400' : 'hover:bg-gray-100 text-gray-400 hover:text-red-500'"
                    :title="$t('admin.scheduledJobs.syncTask.clearPath', '清除')"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- 路径选择器 -->
              <div
                v-show="pair.targetExpanded"
                class="panel-selector"
              >
                <PathTreeSelector
                  v-model="pair.targetPath"
                  :dark-mode="darkMode"
                  :allow-files="false"
                  max-height="280px"
                  @update:model-value="onPathSelected(pair, 'target', $event)"
                />
              </div>

              <!-- 路径提示 -->
              <div class="panel-hint" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                {{ $t('admin.scheduledJobs.syncTask.targetPathHint', '必须是文件夹路径') }}
              </div>
            </div>
          </div>
          </Transition>

          <!-- 分隔线 (多个路径对时) -->
          <div
            v-if="index < pathPairs.length - 1"
            class="mt-4 border-t"
            :class="darkMode ? 'border-gray-800' : 'border-gray-100'"
          ></div>
        </div>
      </TransitionGroup>

      <!-- 添加路径对按钮 -->
      <button
        @click="addPathPair"
        :disabled="pathPairs.length >= 100"
        class="w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors border-2 border-dashed flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        :class="darkMode
          ? 'border-gray-700 hover:border-gray-600 text-gray-500 hover:text-gray-400 hover:bg-gray-800/50'
          : 'border-gray-200 hover:border-gray-300 text-gray-400 hover:text-gray-500 hover:bg-gray-50'"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ $t('admin.scheduledJobs.syncTask.addPathPair', '添加路径对') }}
        <span class="text-xs opacity-60">({{ pathPairs.length }}/100)</span>
      </button>

      <!-- 高级选项 -->
      <details class="mt-4">
        <summary
          class="flex items-center gap-2 text-sm cursor-pointer select-none py-2"
          :class="darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'"
        >
          <svg class="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
          {{ $t('admin.scheduledJobs.syncTask.advancedOptions', '高级选项') }}
        </summary>

        <div
          class="mt-3 p-4 rounded-lg border grid grid-cols-1 md:grid-cols-2 gap-6"
          :class="darkMode ? 'bg-gray-800/30 border-gray-700' : 'bg-gray-50 border-gray-200'"
        >
          <!-- 跳过已存在文件 -->
          <label class="flex items-start cursor-pointer">
            <input
              v-model="options.skipExisting"
              type="checkbox"
              class="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <div class="ml-3">
              <span class="text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ $t('admin.scheduledJobs.syncTask.skipExisting', '跳过已存在文件') }}
              </span>
              <p class="text-xs mt-0.5" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                {{ $t('admin.scheduledJobs.syncTask.skipExistingHint', '启用后仅复制目标位置不存在的文件（增量同步）') }}
              </p>
            </div>
          </label>

          <!-- 复制并发数 -->
          <div>
            <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ $t('admin.scheduledJobs.syncTask.maxConcurrency', '复制并发数') }}
            </label>
            <div class="flex items-center gap-3">
              <input
                v-model.number="options.maxConcurrency"
                type="range"
                min="1"
                max="32"
                class="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
              />
              <input
                v-model.number="options.maxConcurrency"
                type="number"
                min="1"
                max="32"
                class="w-14 px-2 py-1 rounded text-sm text-center border"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'"
              />
            </div>
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ $t('admin.scheduledJobs.syncTask.concurrencyHint', 'Workers 环境建议使用 1') }}
            </p>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import PathTreeSelector from './PathTreeSelector.vue'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({})
  },
  darkMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])

// ========== 核心状态 ==========
const pathPairs = ref([])
const options = ref({
  skipExisting: true,
  maxConcurrency: 1
})

// ========== 状态控制标志 ==========
let isInitialized = false
let isInternalUpdate = false
let lastEmittedConfigStr = null

// ========== 辅助函数 ==========

function createNewPair() {
  return {
    id: Date.now() + Math.random(),
    sourcePath: '',
    targetPath: '',
    sourcePathInput: '',
    targetPathInput: '',
    sourceExpanded: true,
    targetExpanded: true,
    collapsed: false  // 路径对整体是否收缩
  }
}

function parseConfigToPairs(config) {
  if (!config || Object.keys(config).length === 0) {
    return [createNewPair()]
  }

  if (Array.isArray(config.pairs) && config.pairs.length > 0) {
    return config.pairs.map((pair, index) => ({
      id: Date.now() + index + Math.random(),
      sourcePath: pair.sourcePath || '',
      targetPath: pair.targetPath || '',
      sourcePathInput: pair.sourcePath || '',
      targetPathInput: pair.targetPath || '',
      sourceExpanded: !pair.sourcePath,
      targetExpanded: !pair.targetPath,
      collapsed: !!(pair.sourcePath && pair.targetPath)  // 已配置的路径对默认收缩
    }))
  }

  if (config.sourcePath || config.targetPath) {
    return [{
      id: Date.now(),
      sourcePath: config.sourcePath || '',
      targetPath: config.targetPath || '',
      sourcePathInput: config.sourcePath || '',
      targetPathInput: config.targetPath || '',
      sourceExpanded: !config.sourcePath,
      targetExpanded: !config.targetPath,
      collapsed: !!(config.sourcePath && config.targetPath)  // 已配置的路径对默认收缩
    }]
  }

  return [createNewPair()]
}

function parseConfigToOptions(config) {
  return {
    skipExisting: config?.skipExisting !== undefined ? config.skipExisting : true,
    maxConcurrency: config?.maxConcurrency || 1
  }
}

const toBackendConfig = () => {
  const allPairs = pathPairs.value.map(p => ({
    sourcePath: p.sourcePath || '',
    targetPath: p.targetPath || ''
  }))

  if (allPairs.length === 1) {
    return {
      sourcePath: allPairs[0].sourcePath,
      targetPath: allPairs[0].targetPath,
      ...options.value
    }
  }

  return {
    pairs: allPairs,
    ...options.value
  }
}

function isConfigEquivalent(config1, config2) {
  const getPairsCount = (cfg) => {
    if (!cfg) return 0
    if (Array.isArray(cfg.pairs)) return cfg.pairs.length
    if (cfg.sourcePath !== undefined || cfg.targetPath !== undefined) return 1
    return 0
  }

  const count1 = getPairsCount(config1)
  const count2 = getPairsCount(config2)

  if (count1 !== count2) return false

  const normalize = (cfg) => {
    if (!cfg) return '{}'
    const { skipExisting, maxConcurrency, pairs, sourcePath, targetPath } = cfg
    return JSON.stringify({ skipExisting, maxConcurrency, pairs, sourcePath, targetPath })
  }

  return normalize(config1) === normalize(config2)
}

// ========== 初始化 ==========
onMounted(() => {
  if (!isInitialized) {
    isInitialized = true
    pathPairs.value = parseConfigToPairs(props.modelValue)
    options.value = parseConfigToOptions(props.modelValue)
    lastEmittedConfigStr = JSON.stringify(toBackendConfig())
  }
})

// ========== 用户操作 ==========

const addPathPair = () => {
  if (pathPairs.value.length < 100) {
    isInternalUpdate = true
    pathPairs.value.push(createNewPair())
    emitConfigChange()
    setTimeout(() => {
      isInternalUpdate = false
    }, 50)
  }
}

const removePathPair = (id) => {
  if (pathPairs.value.length > 1) {
    isInternalUpdate = true
    pathPairs.value = pathPairs.value.filter(p => p.id !== id)
    emitConfigChange()
    setTimeout(() => {
      isInternalUpdate = false
    }, 50)
  }
}

const toggleSourceExpand = (pair) => {
  pair.sourceExpanded = !pair.sourceExpanded
}

const toggleTargetExpand = (pair) => {
  pair.targetExpanded = !pair.targetExpanded
}

// 切换路径对整体展开/收缩
const togglePairCollapsed = (pair) => {
  pair.collapsed = !pair.collapsed
}

const applyQuickPath = (pair, type) => {
  if (type === 'source') {
    const input = pair.sourcePathInput?.trim()
    if (input) {
      pair.sourcePath = input
      pair.sourceExpanded = false
    }
  } else {
    const input = pair.targetPathInput?.trim()
    if (input) {
      pair.targetPath = input
      pair.targetExpanded = false
    }
  }
}

const onPathSelected = (pair, type, path) => {
  if (type === 'source') {
    pair.sourcePathInput = path
  } else {
    pair.targetPathInput = path
  }
}

const clearPath = (pair, type) => {
  if (type === 'source') {
    pair.sourcePath = ''
    pair.sourcePathInput = ''
    pair.sourceExpanded = true
  } else {
    pair.targetPath = ''
    pair.targetPathInput = ''
    pair.targetExpanded = true
  }
}

// 复制路径到剪贴板
const copyPath = async (path) => {
  if (!path) return
  try {
    await navigator.clipboard.writeText(path)
  } catch (err) {
    // 降级方案：使用 execCommand
    const textArea = document.createElement('textarea')
    textArea.value = path
    textArea.style.position = 'fixed'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
  }
}

// ========== 数据同步 ==========

function emitConfigChange() {
  const newConfig = toBackendConfig()
  const newConfigStr = JSON.stringify(newConfig)

  if (newConfigStr !== lastEmittedConfigStr) {
    lastEmittedConfigStr = newConfigStr
    emit('update:modelValue', newConfig)
  }
}

watch(() => props.modelValue, (newVal) => {
  if (isInternalUpdate) return
  if (!isInitialized) return

  const currentConfig = toBackendConfig()
  if (isConfigEquivalent(newVal, currentConfig)) return

  pathPairs.value = parseConfigToPairs(newVal)
  options.value = parseConfigToOptions(newVal)
  lastEmittedConfigStr = JSON.stringify(toBackendConfig())
}, { deep: true })

let updateTimer = null
watch([pathPairs, options], () => {
  if (isInternalUpdate) return

  if (updateTimer) {
    clearTimeout(updateTimer)
  }
  updateTimer = setTimeout(() => {
    emitConfigChange()
  }, 150)
}, { deep: true })
</script>

<style scoped>
.sync-task-config-form {
  @apply w-full;
}

/* 路径对容器 */
.path-pair-container {
  @apply relative;
}

/* 双面板布局 */
.dual-panel-container {
  @apply grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr] gap-0;
  align-items: start; /* 让两个面板各自独立高度，而不是等高拉伸 */
}

/* 路径面板 - 提升质感 */
.path-panel {
  @apply border rounded-xl overflow-hidden;
  @apply shadow-sm;
  @apply transition-all duration-200; /* 添加高度变化动画 */
}

.path-panel:focus-within {
  @apply shadow-md;
}

.panel-header {
  @apply px-4 py-2.5 border-b;
  @apply flex items-center justify-between;
}

.panel-input {
  @apply px-1 py-1;
  @apply border-gray-200 dark:border-gray-700;
}

.panel-selector {
  @apply p-3;
  @apply bg-gray-50/50 dark:bg-gray-900/30;
}

.panel-hint {
  @apply px-4 py-2 text-xs;
  @apply border-t border-gray-100 dark:border-gray-800;
  @apply bg-gray-50/30 dark:bg-gray-900/20;
}

/* 同步方向指示器 */
.sync-direction-indicator {
  @apply flex items-stretch justify-center;
  @apply xl:px-3 xl:min-w-[60px];
  align-self: stretch; /* 指示器保持拉伸以居中显示 */
}

/* 列表动画 */
.path-pair-list-enter-active,
.path-pair-list-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.path-pair-list-enter-from,
.path-pair-list-leave-to {
  opacity: 0;
  transform: translateY(-12px) scale(0.98);
}

.path-pair-list-move {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 路径对内容展开/收缩动画 */
.pair-content-enter-active,
.pair-content-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.pair-content-enter-from,
.pair-content-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-8px);
}

.pair-content-enter-to,
.pair-content-leave-from {
  opacity: 1;
  max-height: 1000px;
}

/* 高级选项箭头旋转 */
details[open] .details-chevron {
  transform: rotate(90deg);
}

/* 滑块样式 */
input[type="range"]::-webkit-slider-thumb {
  @apply appearance-none w-4 h-4 rounded-full bg-primary-500 cursor-pointer;
  @apply shadow-sm;
  @apply transition-transform duration-150;
}

input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

input[type="range"]::-moz-range-thumb {
  @apply w-4 h-4 rounded-full bg-primary-500 cursor-pointer border-0;
  @apply shadow-sm;
}

/* 暗色模式边框覆盖 */
.dark .panel-input {
  @apply border-gray-700;
}

/* 添加路径对按钮悬停效果 */
.path-pair-container + button:hover {
  @apply scale-[1.01];
}
</style>
