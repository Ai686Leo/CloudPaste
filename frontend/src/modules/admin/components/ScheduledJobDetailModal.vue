<template>
  <div
    v-if="show && job"
    class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black bg-opacity-50 overflow-y-auto"
    @click="$emit('close')"
  >
    <div
      class="w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden"
      :class="darkMode ? 'bg-gray-800' : 'bg-white'"
      @click.stop
    >
      <!-- 弹窗头部 -->
      <div
        class="px-5 py-4 border-b flex justify-between items-center"
        :class="darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50/50'"
      >
        <h3 class="text-lg font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ t('admin.scheduledJobs.detail.title') }}
        </h3>
        <button
          @click="$emit('close')"
          class="flex-shrink-0 p-1 rounded-lg transition-colors"
          :class="darkMode ? 'text-gray-400 hover:text-gray-300 hover:bg-gray-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'"
        >
          <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clip-rule="evenodd"
            />
          </svg>
        </button>
      </div>

      <div 
        class="p-5 max-h-[70vh] overflow-y-auto" 
        :class="[
          darkMode ? 'text-gray-300 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800' : 'text-gray-600 scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-200'
        ]"
      >
        <!-- Handler不存在警告 -->
        <div
          v-if="job.handlerExists === false"
          class="mb-4 p-3 rounded-lg"
          :class="darkMode ? 'bg-orange-900/30 text-orange-300 border border-orange-700' : 'bg-orange-50 text-orange-800 border border-orange-200'"
        >
          <div class="flex items-start gap-2">
            <svg class="h-5 w-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p class="font-medium text-sm">{{ t('admin.scheduledJobs.warnings.handlerNotFound') }}</p>
              <p class="text-xs mt-1 opacity-80">{{ t('admin.scheduledJobs.warnings.handlerNotFoundHint') }}</p>
            </div>
          </div>
        </div>

        <!-- 任务信息 -->
        <div class="mb-5">
          <!-- 任务名称 -->
          <div class="mb-3">
            <h4 class="text-base font-semibold mb-1" :class="darkMode ? 'text-white' : 'text-gray-900'">
              {{ job.taskId }}
            </h4>
            <p v-if="job.description" class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
              {{ job.description }}
            </p>
          </div>

          <!-- 信息网格 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <!-- 任务类型 -->
            <div>
              <span class="font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
                {{ t('admin.scheduledJobs.detail.handlerType') }}
              </span>
              <div class="mt-1 font-mono" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">{{ job.handlerId }}</div>
            </div>

            <!-- 状态 -->
            <div>
              <span class="font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
                {{ t('admin.scheduledJobs.detail.status') }}
              </span>
              <div class="mt-1">
                <span
                  class="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                  :class="
                    job.enabled
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                      : darkMode
                        ? 'bg-gray-700 text-gray-300'
                        : 'bg-gray-200 text-gray-600'
                  "
                >
                  {{ job.enabled ? t('admin.scheduledJobs.status.enabled') : t('admin.scheduledJobs.status.disabled') }}
                </span>
              </div>
            </div>

            <!-- 上次执行时间 -->
            <div>
              <span class="font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
                {{ t('admin.scheduledJobs.detail.lastRun') }}
              </span>
              <div class="mt-1" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">
                {{ job.lastRunFinishedAt ? formatDateTimeWithSeconds(job.lastRunFinishedAt) : t('admin.scheduledJobs.card.never') }}
              </div>
            </div>

            <!-- 下次执行时间 -->
            <div>
              <span class="font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
                {{ t('admin.scheduledJobs.detail.nextRun') }}
              </span>
              <div class="mt-1" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">{{ formatNextRun(job) }}</div>
            </div>
          </div>
        </div>

        <!-- 配置参数（可折叠） -->
        <div v-if="job.config && Object.keys(job.config).length > 0" class="mb-5">
          <button
            @click="configCollapsed = !configCollapsed"
            class="w-full text-sm font-semibold flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg transition-colors border"
            :class="darkMode ? 'text-gray-200 hover:bg-gray-700/30 border-gray-700' : 'text-gray-800 hover:bg-gray-50 border-gray-200'"
          >
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {{ t('admin.scheduledJobs.detail.configParams') }}
            </div>
            <svg
              class="w-4 h-4 transition-transform duration-200"
              :class="{ 'rotate-180': !configCollapsed }"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div v-show="!configCollapsed" class="mt-2 overflow-hidden transition-all duration-200">
            <pre
              class="text-xs p-4 rounded-lg overflow-x-auto"
              :class="darkMode ? 'bg-gray-900 text-gray-300 border border-gray-700' : 'bg-gray-50 text-gray-700 border border-gray-200'"
              >{{ JSON.stringify(job.config, null, 2) }}</pre
            >
          </div>
        </div>

        <!-- 执行历史（可折叠，优化的时间线样式） -->
        <div>
          <button
            @click="historyCollapsed = !historyCollapsed"
            class="w-full text-sm font-semibold flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg transition-colors border"
            :class="darkMode ? 'text-gray-200 hover:bg-gray-700/30 border-gray-700' : 'text-gray-800 hover:bg-gray-50 border-gray-200'"
          >
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {{ t('admin.scheduledJobs.detail.recentRuns') }}
              <span
                v-if="runs.length > 0"
                class="text-xs px-2 py-0.5 rounded-full font-medium"
                :class="darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'"
              >
                {{ runs.length }}
              </span>
            </div>
            <svg
              class="w-4 h-4 transition-transform duration-200"
              :class="{ 'rotate-180': !historyCollapsed }"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <div v-show="!historyCollapsed" class="mt-3 overflow-hidden transition-all duration-200">
            <div v-if="runsLoading" class="flex items-center justify-center py-8">
              <svg class="animate-spin w-6 h-6" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
            <div v-else-if="runs.length > 0" class="space-y-3">
                <div v-for="(run, index) in runs" :key="run.id" class="relative flex gap-4 group">
                <!-- 时间线区域（左侧固定宽度） -->
                <div class="relative flex flex-col items-center" style="width: 24px;">
                  <!-- 连接线 -->
                  <div
                    v-if="index < runs.length - 1"
                    class="absolute top-6 left-1/2 -translate-x-1/2 w-px h-full"
                    :class="darkMode ? 'bg-gradient-to-b from-gray-600/30 via-gray-600/15 to-transparent' : 'bg-gradient-to-b from-gray-400/40 via-gray-400/20 to-transparent'"
                  ></div>
                  
                  <!-- 圆点容器 -->
                  <div class="relative z-10 mt-2">
                    <!-- 外圈光晕 -->
                    <div
                      class="absolute inset-0 w-6 h-6 -left-1.5 -top-1.5 rounded-full transition-all duration-300"
                      :class="[
                        run.status === 'success'
                          ? darkMode
                            ? 'bg-emerald-400/8'
                            : 'bg-emerald-400/12'
                          : run.status === 'failure'
                            ? darkMode
                              ? 'bg-rose-400/8'
                              : 'bg-rose-400/12'
                            : darkMode
                              ? 'bg-amber-400/8'
                              : 'bg-amber-400/12',
                      ]"
                    ></div>
                    <!-- 主圆点 -->
                    <div
                      class="relative w-3 h-3 rounded-full transition-all duration-300 group-hover:scale-125"
                      :class="[
                        run.status === 'success'
                          ? darkMode
                            ? 'bg-emerald-400/60 ring-2 ring-emerald-400/20'
                            : 'bg-emerald-500/50 ring-2 ring-emerald-500/15'
                          : run.status === 'failure'
                            ? darkMode
                              ? 'bg-rose-400/60 ring-2 ring-rose-400/20'
                              : 'bg-rose-500/50 ring-2 ring-rose-500/15'
                            : darkMode
                              ? 'bg-amber-400/60 ring-2 ring-amber-400/20'
                              : 'bg-amber-500/50 ring-2 ring-amber-500/15',
                      ]"
                    >
                      <!-- 内核高光 -->
                      <div class="absolute inset-0.5 rounded-full bg-white/30"></div>
                    </div>
                    <!-- 最新记录的淡雅脉冲效果 -->
                    <div
                      v-if="index === 0"
                      class="absolute inset-0 w-6 h-6 -left-1.5 -top-1.5 rounded-full animate-ping"
                      :class="[
                        run.status === 'success'
                          ? darkMode
                            ? 'bg-emerald-400/15'
                            : 'bg-emerald-500/20'
                          : run.status === 'failure'
                            ? darkMode
                              ? 'bg-rose-400/15'
                              : 'bg-rose-500/20'
                            : darkMode
                              ? 'bg-amber-400/15'
                              : 'bg-amber-500/20',
                      ]"
                    ></div>
                  </div>
                </div>

                <!-- 记录内容卡片（右侧弹性宽度） -->
                <div
                  class="flex-1 rounded-lg border p-3 transition-all duration-200"
                  :class="darkMode ? 'bg-gray-700/20 border-gray-600/50 hover:bg-gray-700/30 hover:border-gray-600 hover:shadow-md' : 'bg-gray-50/50 border-gray-200 hover:bg-white hover:shadow-md hover:border-gray-300'"
                >
                    <!-- 头部：时间和状态 -->
                    <div class="flex flex-wrap items-center gap-2 mb-2">
                      <span class="text-xs font-semibold" :class="darkMode ? 'text-gray-200' : 'text-gray-800'">
                        {{ formatDateTimeWithSeconds(run.startedAt) }}
                      </span>
                      <span
                        class="text-xs px-2.5 py-0.5 rounded-full font-medium"
                        :class="[
                          run.status === 'success'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                            : run.status === 'failure'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300',
                        ]"
                      >
                        {{ t(`admin.scheduledJobs.runStatus.${run.status}`) }}
                      </span>
                      <span class="text-xs font-mono px-2 py-0.5 rounded" :class="darkMode ? 'bg-gray-800/50 text-gray-400' : 'bg-gray-100 text-gray-600'">
                        {{ formatDuration(run.durationMs) }}
                      </span>
                    </div>

                    <!-- 摘要信息 -->
                    <div
                      v-if="run.summary"
                      class="text-xs leading-relaxed"
                      :class="darkMode ? 'text-gray-300' : 'text-gray-700'"
                    >
                      {{ run.summary }}
                    </div>

                    <!-- 任务额外统计信息（例如清理 upload_sessions 任务的会话总数） -->
                    <div
                      v-if="run.totalSessions != null"
                      class="text-xs mt-1"
                      :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
                    >
                      {{ t('admin.scheduledJobs.detail.totalSessions', { count: run.totalSessions }) }}
                    </div>

                    <!-- 错误信息 -->
                    <div
                      v-if="run.errorMessage"
                      class="text-xs p-2.5 rounded-md border mt-2"
                      :class="darkMode ? 'bg-red-900/20 text-red-300 border-red-800/50' : 'bg-red-50 text-red-700 border-red-200'"
                    >
                      <div class="flex items-start gap-1.5">
                        <svg class="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fill-rule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                            clip-rule="evenodd"
                          />
                        </svg>
                        <span class="font-medium">{{ run.errorMessage }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            <div v-else class="flex flex-col items-center justify-center py-10">
              <div class="relative mb-3">
                <svg class="w-14 h-14" :class="darkMode ? 'text-gray-600' : 'text-gray-400'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              </div>
              <p class="text-sm font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t('admin.scheduledJobs.detail.noRuns') }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDateTimeWithSeconds } from '@/utils/timeUtils.js';

const { t } = useI18n();

// Props
const props = defineProps({
  show: {
    type: Boolean,
    required: true,
  },
  job: {
    type: Object,
    default: null,
  },
  runs: {
    type: Array,
    default: () => [],
  },
  runsLoading: {
    type: Boolean,
    default: false,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// Emits
defineEmits(['close']);

// 复用主页面的统一配置管理
const SETTINGS_KEY = 'scheduled-jobs-view-settings';

// 从 localStorage 加载配置
const loadSettings = () => {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn('加载定时任务配置失败:', error);
  }
  return {};
};

// 保存配置到 localStorage
const saveSettings = (key, value) => {
  try {
    const settings = loadSettings();
    settings[key] = value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('保存定时任务配置失败:', error);
  }
};

// 折叠状态（使用 modal 前缀区分）
const settings = loadSettings();
const configCollapsed = ref(settings.modalConfigCollapsed ?? true); // 默认折叠
const historyCollapsed = ref(settings.modalHistoryCollapsed ?? false); // 默认展开

// 监听折叠状态变化，自动保存
watch(configCollapsed, (newValue) => {
  saveSettings('modalConfigCollapsed', newValue);
});

watch(historyCollapsed, (newValue) => {
  saveSettings('modalHistoryCollapsed', newValue);
});

// 格式化执行耗时
const formatDuration = (ms) => {
  if (!ms && ms !== 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

// 格式化下次运行时间
const formatNextRun = (job) => {
  if (!job.nextRunAfter) return t('admin.scheduledJobs.detail.notScheduled');
  return formatDateTimeWithSeconds(job.nextRunAfter);
};
</script>

<style scoped>
/* 自定义滚动条样式 */
.scrollbar-thin {
  scrollbar-width: thin;
}

.scrollbar-thin::-webkit-scrollbar {
  width: 6px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  border-radius: 3px;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  border-radius: 3px;
}

.scrollbar-thumb-gray-600::-webkit-scrollbar-thumb {
  background-color: rgb(75 85 99 / 0.5);
}

.scrollbar-thumb-gray-600::-webkit-scrollbar-thumb:hover {
  background-color: rgb(75 85 99 / 0.7);
}

.scrollbar-track-gray-800::-webkit-scrollbar-track {
  background-color: rgb(31 41 55 / 0.3);
}

.scrollbar-thumb-gray-400::-webkit-scrollbar-thumb {
  background-color: rgb(156 163 175 / 0.5);
}

.scrollbar-thumb-gray-400::-webkit-scrollbar-thumb:hover {
  background-color: rgb(156 163 175 / 0.7);
}

.scrollbar-track-gray-200::-webkit-scrollbar-track {
  background-color: rgb(229 231 235 / 0.3);
}
</style>
