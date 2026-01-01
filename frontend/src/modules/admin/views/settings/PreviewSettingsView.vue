<template>
  <div class="flex-1 flex flex-col overflow-y-auto">
    <!-- 页面标题 -->
    <div class="mb-8 flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-bold mb-2" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ t("admin.preview.title") }}
        </h1>
        <p class="text-base" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
          {{ t("admin.preview.description") }}
        </p>
      </div>
      <button
        type="button"
        @click="handleResetToDefaults"
        :disabled="isLoading"
        class="flex-shrink-0 px-4 py-2 text-sm font-medium border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        :class="darkMode ? 'text-gray-300 bg-gray-700 border-gray-600 hover:bg-gray-600' : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50'"
      >
        {{ t("admin.preview.resetDefaults") }}
      </button>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <IconRefresh size="lg" class="animate-spin" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" />
    </div>

    <!-- 设置内容 - 垂直布局 -->
    <div v-else class="space-y-6 max-w-2xl">

      <!-- ==================== 卡片1：文件类型配置 ==================== -->
      <section
        class="rounded-xl border transition-colors"
        :class="darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'"
      >
        <!-- 卡片头部 -->
        <div class="px-5 py-4 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
          <div class="flex items-center gap-3">
            <div
              class="flex items-center justify-center w-9 h-9 rounded-lg"
              :class="darkMode ? 'bg-blue-500/20' : 'bg-blue-50'"
            >
              <IconCollection size="sm" :class="darkMode ? 'text-blue-400' : 'text-blue-600'" />
            </div>
            <div>
              <h2 class="text-base font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
                {{ t("admin.preview.textTypes") }}
              </h2>
              <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.preview.textTypesHelp") }}
              </p>
            </div>
          </div>
        </div>

        <!-- 卡片内容 -->
        <div class="p-5 space-y-4">
          <!-- 文本文件类型 -->
          <div>
            <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.preview.textTypesLabel") }}
            </label>
            <textarea
              v-model="settings.preview_text_types"
              :placeholder="t('admin.preview.textTypesPlaceholder')"
              rows="2"
              class="w-full px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-vertical"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'"
            ></textarea>
            <p class="text-xs mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.preview.textTypesHelp") }}
            </p>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 图片文件类型 -->
          <div>
            <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.preview.imageTypesLabel") }}
            </label>
            <textarea
              v-model="settings.preview_image_types"
              :placeholder="t('admin.preview.imageTypesPlaceholder')"
              rows="2"
              class="w-full px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-vertical"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'"
            ></textarea>
            <p class="text-xs mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.preview.imageTypesHelp") }}
            </p>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 视频文件类型 -->
          <div>
            <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.preview.videoTypesLabel") }}
            </label>
            <textarea
              v-model="settings.preview_video_types"
              :placeholder="t('admin.preview.videoTypesPlaceholder')"
              rows="2"
              class="w-full px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-vertical"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'"
            ></textarea>
            <p class="text-xs mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.preview.videoTypesHelp") }}
            </p>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 音频文件类型 -->
          <div>
            <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.preview.audioTypesLabel") }}
            </label>
            <textarea
              v-model="settings.preview_audio_types"
              :placeholder="t('admin.preview.audioTypesPlaceholder')"
              rows="2"
              class="w-full px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-vertical"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'"
            ></textarea>
            <p class="text-xs mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.preview.audioTypesHelp") }}
            </p>
          </div>
        </div>

        <!-- 卡片底部：保存按钮 -->
        <div class="px-5 py-4 border-t flex justify-end" :class="darkMode ? 'border-gray-700 bg-gray-800/30' : 'border-gray-100 bg-gray-50/50'">
          <button
            type="button"
            @click="handleSaveFileTypes"
            :disabled="isSavingFileTypes"
            class="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            :class="isSavingFileTypes ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'"
          >
            <IconRefresh v-if="isSavingFileTypes" size="sm" class="animate-spin -ml-0.5 mr-2" />
            {{ isSavingFileTypes ? t("admin.global.buttons.updating") : t("admin.global.buttons.updateSettings") }}
          </button>
        </div>
      </section>

      <!-- ==================== 卡片2：预览规则配置 ==================== -->
      <section
        class="rounded-xl border transition-colors"
        :class="darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'"
      >
        <!-- 卡片头部 -->
        <div class="px-5 py-4 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-3">
              <div
                class="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0"
                :class="darkMode ? 'bg-purple-500/20' : 'bg-purple-50'"
              >
                <IconAdjustments size="sm" :class="darkMode ? 'text-purple-400' : 'text-purple-600'" />
              </div>
              <div class="min-w-0">
                <h2 class="text-base font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
                  {{ t("admin.preview.previewProvidersLabel") }}
                </h2>
                <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.preview.previewProvidersHelp") }}
                </p>
              </div>
            </div>
            <!-- 模式切换器 -->
            <div class="inline-flex items-center rounded-md border text-xs overflow-hidden flex-shrink-0 self-start sm:self-center" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
              <button
                type="button"
                @click="handleSwitchProviderMode(providerModes.visual)"
                class="px-3 py-1"
                :class="
                  providerMode === providerModes.visual
                    ? 'bg-blue-600 text-white'
                    : darkMode
                      ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      : 'bg-white text-gray-600 hover:bg-gray-100'
                "
              >
                {{ t("admin.preview.previewProvidersModeVisual") }}
              </button>
              <button
                type="button"
                @click="handleSwitchProviderMode(providerModes.json)"
                class="px-3 py-1 border-l"
                :class="
                  providerMode === providerModes.json
                    ? 'bg-blue-600 text-white'
                    : darkMode
                      ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 border-gray-600'
                      : 'bg-white text-gray-600 hover:bg-gray-100 border-gray-300'
                "
              >
                {{ t("admin.preview.previewProvidersModeJson") }}
              </button>
            </div>
          </div>
        </div>

        <!-- 卡片内容 -->
        <div class="p-5">
          <div v-if="providerMode === providerModes.visual" class="space-y-4">
                <!-- 空状态：居中显示，带图标和添加按钮 -->
                <div
                  v-if="!visualRules.length"
                  class="py-8 flex flex-col items-center justify-center rounded-lg border border-dashed"
                  :class="darkMode ? 'border-gray-600 bg-gray-800/30' : 'border-gray-300 bg-gray-50/50'"
                >
                  <IconCollection size="2xl" class="mb-3" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" />
                  <p class="text-sm mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                    {{ t("admin.preview.previewRulesEmpty") }}
                  </p>
                  <p class="text-xs mb-4" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                    {{ t("admin.preview.previewRulesEmptyHint") }}
                  </p>
                  <button
                    type="button"
                    @click="addRule"
                    class="inline-flex items-center px-3 py-1.5 text-xs rounded-md border"
                    :class="
                      darkMode
                        ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                    "
                  >
                    <IconPlus size="sm" class="mr-1" />
                    {{ t("admin.preview.addRule") }}
                  </button>
                </div>

                <!-- 规则列表工具栏：有规则时显示 -->
                <div v-if="visualRules.length" class="flex items-center justify-between">
                  <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                    {{ visualRules.length }} {{ t("admin.preview.ruleTitle") }}
                  </span>
                  <button
                    type="button"
                    @click="toggleAllRulesCollapsed"
                    class="inline-flex items-center px-2 py-1 text-xs rounded transition-colors"
                    :class="darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'"
                  >
                    <IconChevronDown v-if="isAllCollapsed" size="sm" class="mr-1" />
                    <IconChevronUp v-else size="sm" class="mr-1" />
                    {{ isAllCollapsed ? t("admin.preview.expandRule") : t("admin.preview.collapseRule") }}
                  </button>
                </div>

                <div
                  v-for="(rule, ruleIndex) in visualRules"
                  :key="rule.uid"
                  class="rounded-lg border p-4"
                  :class="darkMode ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        class="p-1 rounded transition-colors flex-shrink-0"
                        :class="darkMode ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'"
                        :title="isRuleCollapsed(rule) ? t('admin.preview.expandRule') : t('admin.preview.collapseRule')"
                        @click="toggleRuleCollapsed(rule.uid)"
                      >
                        <IconChevronRight
                          size="sm"
                          class="transition-transform duration-200"
                          :class="isRuleCollapsed(rule) ? '' : 'rotate-90'"
                          aria-hidden="true"
                        />
                      </button>

                      <div class="text-sm font-medium flex-shrink-0" :class="darkMode ? 'text-gray-100' : 'text-gray-800'">
                        {{ t("admin.preview.ruleTitle") }} #{{ ruleIndex + 1 }}
                      </div>

                      <div
                        v-if="isRuleCollapsed(rule)"
                        class="text-xs truncate"
                        :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
                        :title="getRuleSummary(rule)"
                      >
                        {{ getRuleSummary(rule) }}
                      </div>
                    </div>

                    <div class="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        class="p-1 rounded transition-colors"
                        :class="[
                          darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100',
                          ruleIndex === 0 ? 'opacity-40 cursor-not-allowed' : (darkMode ? 'text-gray-300' : 'text-gray-600'),
                        ]"
                        :disabled="ruleIndex === 0"
                        :title="t('admin.preview.moveRuleUp')"
                        @click="moveRuleUp(ruleIndex)"
                      >
                        <IconChevronUp size="sm" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        class="p-1 rounded transition-colors"
                        :class="[
                          darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100',
                          ruleIndex === visualRules.length - 1 ? 'opacity-40 cursor-not-allowed' : (darkMode ? 'text-gray-300' : 'text-gray-600'),
                        ]"
                        :disabled="ruleIndex === visualRules.length - 1"
                        :title="t('admin.preview.moveRuleDown')"
                        @click="moveRuleDown(ruleIndex)"
                      >
                        <IconChevronDown size="sm" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        @click="removeRule(ruleIndex)"
                        class="text-xs px-2 py-1 rounded transition"
                        :class="
                          darkMode
                            ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                            : 'bg-red-50 text-red-600 hover:bg-red-100'
                        "
                      >
                        {{ t("admin.preview.removeRule") }}
                      </button>
                    </div>
                  </div>

                  <div v-show="!isRuleCollapsed(rule)" class="space-y-3">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label class="block text-xs font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                          {{ t("admin.preview.ruleIdLabel") }}
                        </label>
                        <input
                          v-model="rule.id"
                          type="text"
                          :placeholder="t('admin.preview.ruleIdPlaceholder')"
                          class="w-full rounded border px-2 py-1 text-sm"
                          :class="
                            darkMode
                              ? 'bg-gray-800 border-gray-600 text-white placeholder-gray-500'
                              : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400'
                          "
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                          {{ t("admin.preview.rulePriorityLabel") }}
                        </label>
                        <input
                          v-model.number="rule.priority"
                          type="number"
                          step="1"
                          class="w-full rounded border px-2 py-1 text-sm"
                          :class="
                            darkMode
                              ? 'bg-gray-800 border-gray-600 text-white'
                              : 'bg-white border-gray-300 text-gray-800'
                          "
                        />
                        <p class="mt-1 text-[11px]" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                          {{ t("admin.preview.rulePriorityHelp") }}
                        </p>
                      </div>
                      <div>
                        <label class="block text-xs font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                          {{ t("admin.preview.rulePreviewKeyLabel") }}<span class="text-red-500 ml-1">*</span>
                        </label>
                        <select
                          v-model="rule.previewKey"
                          class="w-full rounded border px-2 py-1 text-sm"
                          :class="
                            darkMode
                              ? 'bg-gray-800 border-gray-600 text-white'
                              : 'bg-white border-gray-300 text-gray-800'
                          "
                        >
                          <option value="" disabled>{{ t("admin.preview.rulePreviewKeyPlaceholder") }}</option>
                          <option v-for="opt in previewKeyOptions" :key="opt.value" :value="opt.value">
                            {{ opt.label }}
                          </option>
                        </select>
                      </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-1 gap-3">
                      <div>
                        <label class="block text-xs font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                          {{ t("admin.preview.ruleMatchExtLabel") }}
                        </label>
                        <input
                          v-model="rule.match.ext"
                          type="text"
                          :placeholder="t('admin.preview.ruleMatchExtPlaceholder')"
                          class="w-full rounded border px-2 py-1 text-sm"
                          :class="
                            darkMode
                              ? 'bg-gray-800 border-gray-600 text-white placeholder-gray-500'
                              : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400'
                          "
                        />
                      </div>
                    </div>

                    <div class="mt-3">
                      <label class="block text-xs font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                        {{ t("admin.preview.ruleMatchRegexLabel") }}
                      </label>
                      <input
                        v-model="rule.match.regex"
                        type="text"
                        :placeholder="t('admin.preview.ruleMatchRegexPlaceholder')"
                        class="w-full rounded border px-2 py-1 text-sm"
                        :class="
                          darkMode
                            ? 'bg-gray-800 border-gray-600 text-white placeholder-gray-500'
                            : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400'
                        "
                      />
                      <p class="mt-1 text-[11px]" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ t("admin.preview.ruleMatchHelp") }}
                      </p>
                    </div>

                    <div class="space-y-2">
                      <div class="flex items-center justify-between">
                        <span class="text-xs font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                          {{ t("admin.preview.ruleProvidersLabel") }}<span v-if="isIframeRule(rule)" class="text-red-500 ml-1">*</span>
                        </span>
                        <button
                          type="button"
                          @click="addProvider(ruleIndex)"
                          class="text-xs px-2 py-1 rounded transition"
                          :class="
                            darkMode
                              ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                          "
                        >
                          {{ t("admin.preview.addProvider") }}
                        </button>
                      </div>

                      <div v-if="isIframeRule(rule) && getIframeValidProviders(rule).length === 0" class="text-xs text-red-500">
                        {{ t("admin.preview.previewRuleIframeNeedsProvider") }}
                      </div>

                      <div
                        v-if="isIframeRule(rule) && rule.providers.some((p) => String(p?.urlTemplate || '').trim() === 'native')"
                        class="text-xs text-red-500"
                      >
                        {{ t("admin.preview.previewRuleIframeNativeNotAllowed") }}
                      </div>

                      <div v-if="getDuplicateProviderKeys(rule).length" class="text-xs text-red-500">
                        {{ t("admin.preview.previewRuleDuplicateProviderKeys", { keys: getDuplicateProviderKeys(rule).join(', ') }) }}
                      </div>

                      <div
                        v-if="!rule.providers.length"
                        class="py-3 text-center text-xs rounded border border-dashed"
                        :class="darkMode ? 'border-gray-700 text-gray-500' : 'border-gray-200 text-gray-400'"
                      >
                        {{ t("admin.preview.ruleProvidersEmpty") }}
                      </div>

                      <div v-for="(provider, providerIndex) in rule.providers" :key="provider.uid" class="grid grid-cols-1 md:grid-cols-6 gap-2">
                        <input
                          v-model="provider.key"
                          type="text"
                          :placeholder="t('admin.preview.ruleProviderKeyPlaceholder')"
                          class="rounded border px-2 py-1 text-sm md:col-span-2"
                          :class="
                            darkMode
                              ? 'bg-gray-800 border-gray-600 text-white placeholder-gray-500'
                              : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400'
                          "
                        />
                        <input
                          v-model="provider.urlTemplate"
                          type="text"
                          :placeholder="t('admin.preview.ruleProviderUrlPlaceholder')"
                          class="rounded border px-2 py-1 text-sm md:col-span-3"
                          :class="
                            darkMode
                              ? 'bg-gray-800 border-gray-600 text-white placeholder-gray-500'
                              : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400'
                          "
                        />
                        <button
                          type="button"
                          @click="removeProvider(ruleIndex, providerIndex)"
                          class="text-xs px-2 py-1 rounded transition md:col-span-1"
                          :class="
                            darkMode
                              ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                              : 'bg-red-50 text-red-600 hover:bg-red-100'
                          "
                        >
                          {{ t("admin.preview.removeProvider") }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 有规则时底部显示添加按钮 -->
                <button
                  v-if="visualRules.length"
                  type="button"
                  @click="addRule"
                  class="inline-flex items-center px-3 py-1.5 text-xs rounded-md border"
                  :class="
                    darkMode
                      ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                  "
                >
                  <IconPlus size="sm" class="mr-1" />
                  {{ t("admin.preview.addRule") }}
                </button>
          </div>

          <div v-else>
            <textarea
              v-model="settings.preview_providers"
              :placeholder="t('admin.preview.previewProvidersPlaceholder')"
              rows="10"
              class="w-full px-3 py-2 border rounded-lg text-xs font-mono leading-snug transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-vertical"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'"
            ></textarea>
          </div>
        </div>

        <!-- 卡片底部：保存按钮 -->
        <div class="px-5 py-4 border-t flex justify-end" :class="darkMode ? 'border-gray-700 bg-gray-800/30' : 'border-gray-100 bg-gray-50/50'">
          <button
            type="button"
            @click="handleSaveProviders"
            :disabled="isSavingProviders"
            class="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            :class="isSavingProviders ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'"
          >
            <IconRefresh v-if="isSavingProviders" size="sm" class="animate-spin -ml-0.5 mr-2" />
            {{ isSavingProviders ? t("admin.global.buttons.updating") : t("admin.global.buttons.updateSettings") }}
          </button>
        </div>
      </section>

    </div>

    <!-- 确认对话框 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { IconRefresh, IconCollection, IconAdjustments, IconPlus, IconChevronDown, IconChevronRight, IconChevronUp } from "@/components/icons";
import { useAdminSystemService } from "@/modules/admin/services/systemService.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { useConfirmDialog } from "@/composables/core/useConfirmDialog.js";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import { createLogger } from "@/utils/logger.js";

// 使用i18n
const { t } = useI18n();
const log = createLogger("PreviewSettingsView");
const { getPreviewSettings, updatePreviewSettings } = useAdminSystemService();
const { isDarkMode: darkMode } = useThemeMode();
const { showSuccess, showError } = useGlobalMessage();

// 确认对话框
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

// ============ 状态管理 ============

// 加载状态
const isLoading = ref(false);
const isSavingFileTypes = ref(false);
const isSavingProviders = ref(false);

const providerModes = Object.freeze({
  visual: "visual",
  json: "json",
});
const providerMode = ref(providerModes.visual);
const visualRules = ref([]);
const collapsedRuleUids = ref({});
let ruleCounter = 0;

const isRuleCollapsed = (rule) => Boolean(collapsedRuleUids.value[String(rule?.uid || "")]);

const toggleRuleCollapsed = (uid) => {
  const key = String(uid || "");
  if (!key) return;
  collapsedRuleUids.value[key] = !collapsedRuleUids.value[key];
};

// 判断是否全部折叠
const isAllCollapsed = computed(() => {
  if (!visualRules.value.length) return false;
  return visualRules.value.every((rule) => isRuleCollapsed(rule));
});

// 切换全部规则的折叠状态
const toggleAllRulesCollapsed = () => {
  const shouldCollapse = !isAllCollapsed.value;
  visualRules.value.forEach((rule) => {
    if (rule?.uid) {
      collapsedRuleUids.value[rule.uid] = shouldCollapse;
    }
  });
};

const getRuleSummary = (rule) => {
  const previewKey = String(rule?.previewKey || "").trim() || "-";
  const priority = Number.isFinite(rule?.priority) ? String(rule.priority) : "0";
  const ext = String(rule?.match?.ext || "").trim();
  const regex = String(rule?.match?.regex || "").trim();

  const parts = [`类型:${previewKey}`, `优先级:${priority}`];
  if (ext) parts.push(`ext:${ext}`);
  if (regex) parts.push(`regex:${regex}`);
  return parts.join(" / ");
};


const normalizePreviewKey = (value) => {
  const v = String(value || "").trim();
  if (!v) return "";
  // 简化：文本类预览统一使用 text（具体“文本/代码/Markdown/HTML”由预览组件内部切换）
  if (["code", "markdown", "html"].includes(v)) return "text";
  return v;
};

const previewKeyOptions = computed(() => {
  const keys = [
    "image",
    "video",
    "audio",
    "pdf",
    "epub",
    "office",
    "text",
    "archive",
    "iframe",
    "download",
  ];
  return keys.map((value) => ({
    value,
    label: t(`admin.preview.previewKey.${value}`),
  }));
});

const isIframeRule = (rule) => String(rule?.previewKey || "").trim() === "iframe";

const getIframeValidProviders = (rule) =>
  (rule?.providers || [])
    .map((p) => ({
      key: String(p?.key || "").trim(),
      urlTemplate: String(p?.urlTemplate || "").trim(),
    }))
    .filter((p) => p.key && p.urlTemplate && p.urlTemplate !== "native");

const getDuplicateProviderKeys = (rule) => {
  const seen = new Set();
  const duplicates = new Set();
  for (const p of rule?.providers || []) {
    const key = String(p?.key || "").trim();
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return Array.from(duplicates);
};

// 预览设置数据
const settings = ref({
  preview_text_types: "",
  preview_image_types: "",
  preview_video_types: "",
  preview_audio_types: "",
  preview_providers: "",
});

// 默认设置
const defaultSettings = {
  preview_text_types:
    "txt,htm,html,xml,java,properties,sql,js,md,json,conf,ini,vue,php,py,bat,yml,yaml,go,sh,c,cpp,h,hpp,tsx,vtt,srt,ass,rs,lrc,gitignore",
  preview_image_types: "jpg,tiff,jpeg,png,gif,bmp,svg,ico,swf,webp,avif",
  preview_video_types: "mp4,mkv,avi,mov,rmvb,webm,flv,m3u8,ts,m2ts",
  preview_audio_types: "mp3,flac,ogg,m4a,wav,opus,wma",
  preview_providers: JSON.stringify(
    [
      // 无后缀文件（README/LICENSE/Dockerfile/Makefile 等）兜底：
      // - 这些文件名通常没有扩展名，单靠 ext 无法命中
      // - 文本预览组件内部可切换：文本/代码/Markdown/HTML
      {
        id: "noext-text",
        priority: 0,
        match: { regex: "/^(readme|license|dockerfile|makefile)$/i" },
        previewKey: "text",
        providers: {},
      },
      {
        id: "office-openxml",
        priority: 0,
        match: { ext: ["docx", "xlsx", "pptx"] },
        previewKey: "office",
        providers: {
          native: "native",
          microsoft: { urlTemplate: "https://view.officeapps.live.com/op/view.aspx?src=$e_url" },
          google: { urlTemplate: "https://docs.google.com/viewer?url=$e_url&embedded=true" },
        },
      },
      {
        id: "office-legacy",
        priority: 0,
        match: { ext: ["doc", "xls", "ppt", "rtf"] },
        previewKey: "office",
        providers: {
          microsoft: { urlTemplate: "https://view.officeapps.live.com/op/view.aspx?src=$e_url" },
          google: { urlTemplate: "https://docs.google.com/viewer?url=$e_url&embedded=true" },
        },
      },
      {
        id: "pdf",
        priority: 0,
        match: { ext: ["pdf"] },
        previewKey: "pdf",
        providers: {
          native: "native",
        },
      },
      {
        id: "epub",
        priority: 0,
        match: { ext: ["epub", "mobi", "azw3", "azw", "fb2", "cbz"] },
        previewKey: "epub",
        providers: {
          native: "native",
        },
      },
      {
        id: "archive",
        priority: 0,
        match: {
          ext: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "tbz", "tbz2", "txz", "cpio", "iso", "cab", "xar", "ar", "a", "mtree"],
        },
        previewKey: "archive",
        providers: {},
      },
    ],
    null,
    2,
  ),
};

const buildList = (value) => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((item) => String(item).trim()).filter((item) => item.length > 0);
};

const normalizeList = (value) => buildList(value).join(", ");

const createRule = (rule = {}) => ({
  uid: `rule-${Date.now()}-${ruleCounter++}`,
  id: rule.id || "",
  priority: Number.isFinite(rule.priority) ? Number(rule.priority) : 0,
  previewKey: normalizePreviewKey(rule.previewKey || rule.key || ""),
  match: {
    ext: normalizeList(rule.match?.ext || rule.match?.exts || rule.match?.extensions || rule.ext),
    regex: String(rule.match?.regex || rule.match?.pattern || "").trim(),
  },
  providers: (rule.providers ? Object.entries(rule.providers) : []).map(([key, cfg]) => ({
    uid: `provider-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    key,
    urlTemplate: typeof cfg === "string" ? cfg : cfg?.urlTemplate || "",
  })),
});

const syncVisualRulesFromJson = (rawValue) => {
  const raw = rawValue || "";
  if (!raw.trim()) {
    visualRules.value = [];
    collapsedRuleUids.value = {};
    return true;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return false;
    }
    visualRules.value = parsed.map((rule) => createRule(rule));
    collapsedRuleUids.value = {};
    return true;
  } catch (error) {
    log.error("预览规则配置 JSON 解析失败:", error);
    return false;
  }
};

const buildProvidersFromVisual = () =>
  visualRules.value.map((rule) => {
    const match = {};
    const extList = buildList(rule.match.ext);
    if (extList.length) match.ext = extList;
    const regex = String(rule.match.regex || "").trim();
    if (regex) match.regex = regex;

    const providers = {};
    rule.providers.forEach((provider) => {
      const key = String(provider.key || "").trim();
      const urlTemplate = String(provider.urlTemplate || "").trim();
      if (!key || !urlTemplate) return;
      providers[key] = { urlTemplate };
    });

    const output = {
      previewKey: rule.previewKey || "",
    };
    if (rule.id) output.id = rule.id;
    if (Number.isFinite(rule.priority)) output.priority = Number(rule.priority);
    if (Object.keys(match).length) output.match = match;
    if (Object.keys(providers).length) output.providers = providers;
    return output;
  });

const applyVisualRulesToJson = () => {
  settings.value.preview_providers = JSON.stringify(buildProvidersFromVisual(), null, 2);
};

const handleSwitchProviderMode = (mode) => {
  if (mode === providerMode.value) return;
  if (mode === providerModes.json) {
    applyVisualRulesToJson();
    providerMode.value = mode;
    return;
  }
  const ok = syncVisualRulesFromJson(settings.value.preview_providers);
  if (!ok) {
    showError(t("admin.preview.previewProvidersInvalidJson"));
    return;
  }
  providerMode.value = mode;
};

const addRule = () => {
  const rule = createRule({
    priority: 0,
    previewKey: "",
    match: { ext: "", regex: "" },
    providers: {},
  });
  visualRules.value.push(rule);
  collapsedRuleUids.value[rule.uid] = false;
};

const removeRule = (index) => {
  const rule = visualRules.value[index];
  visualRules.value.splice(index, 1);
  if (rule?.uid) {
    delete collapsedRuleUids.value[rule.uid];
  }
};

const moveRuleUp = (index) => {
  const list = visualRules.value;
  if (!Array.isArray(list)) return;
  if (index <= 0 || index >= list.length) return;
  const current = list.splice(index, 1)[0];
  list.splice(index - 1, 0, current);
};

const moveRuleDown = (index) => {
  const list = visualRules.value;
  if (!Array.isArray(list)) return;
  if (index < 0 || index >= list.length - 1) return;
  const current = list.splice(index, 1)[0];
  list.splice(index + 1, 0, current);
};

const addProvider = (ruleIndex) => {
  const rule = visualRules.value[ruleIndex];
  if (!rule) return;
  rule.providers.push({
    uid: `provider-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    key: "",
    urlTemplate: "",
  });
};

const removeProvider = (ruleIndex, providerIndex) => {
  const rule = visualRules.value[ruleIndex];
  if (!rule) return;
  rule.providers.splice(providerIndex, 1);
};

// 加载设置
const loadSettings = async () => {
  try {
    isLoading.value = true;

    // 使用分组API获取预览设置（分组ID = 2）
    const previewSettings = await getPreviewSettings();

    // 将设置数据映射到本地状态
    previewSettings.forEach((setting) => {
      if (Object.prototype.hasOwnProperty.call(settings.value, setting.key)) {
        settings.value[setting.key] = setting.value || "";
      }
    });
    const synced = syncVisualRulesFromJson(settings.value.preview_providers);
    if (!synced) {
      providerMode.value = providerModes.json;
    }
  } catch (err) {
    log.error("加载预览设置失败:", err);
    const message = err.message || "加载设置失败";
    showError(message);
  } finally {
    isLoading.value = false;
  }
};

// ============ 保存函数 ============

// 保存文件类型设置
const handleSaveFileTypes = async () => {
  isSavingFileTypes.value = true;
  try {
    await updatePreviewSettings({
      preview_text_types: settings.value.preview_text_types,
      preview_image_types: settings.value.preview_image_types,
      preview_video_types: settings.value.preview_video_types,
      preview_audio_types: settings.value.preview_audio_types,
    });
    showSuccess(t("admin.preview.saveSuccess"));
  } catch (err) {
    log.error("保存文件类型设置失败:", err);
    showError(err.message || t("admin.preview.loadError"));
  } finally {
    isSavingFileTypes.value = false;
  }
};

// 保存预览规则设置
const handleSaveProviders = async () => {
  try {
    if (providerMode.value === providerModes.visual) {
      // 可视化模式下做"必填"校验
      const hasMissingPreviewKey = visualRules.value.some((rule) => !String(rule.previewKey || "").trim());
      if (hasMissingPreviewKey) {
        showError(t("admin.preview.previewRuleMissingPreviewKey"));
        return;
      }

      // 可视化防呆校验（避免“保存了但不生效/页面打不开”）
      for (const rule of visualRules.value) {
        const previewKey = String(rule?.previewKey || "").trim();
        if (!previewKey) continue;

        // providers key 不能重复（否则前端下拉会冲突/覆盖）
        if (getDuplicateProviderKeys(rule).length) {
          showError(t("admin.preview.previewRuleDuplicateProviderKeysShort"));
          return;
        }

        const providers = rule?.providers || [];
        const hasNativePlaceholder = providers.some((p) => String(p?.urlTemplate || "").trim() === "native");

        // native 只能用于“前端能解释 native 占位符”的预览类型（否则会被后端清掉，用户会困惑）
        if (hasNativePlaceholder && !["pdf", "office", "epub", "iframe"].includes(previewKey)) {
          showError(t("admin.preview.previewRuleNativeNotSupported"));
          return;
        }

        // iframe 规则：必须有至少一个有效 provider 且 provider 必须是 URL（不能填 native）
        if (previewKey === "iframe") {
          if (hasNativePlaceholder) {
            showError(t("admin.preview.previewRuleIframeNativeNotAllowed"));
            return;
          }
          const hasHalfFilledProviderRow = providers.some((p) => {
            const key = String(p?.key || "").trim();
            const urlTemplate = String(p?.urlTemplate || "").trim();
            return (key && !urlTemplate) || (!key && urlTemplate);
          });
          if (hasHalfFilledProviderRow) {
            showError(t("admin.preview.previewRuleIframeProviderIncomplete"));
            return;
          }
          if (getIframeValidProviders(rule).length === 0) {
            showError(t("admin.preview.previewRuleIframeNeedsProvider"));
            return;
          }
        }
      }

      applyVisualRulesToJson();
    }
    // 基础 JSON 校验：preview_providers 需要是合法的 JSON 数组
    if (settings.value.preview_providers && settings.value.preview_providers.trim().length > 0) {
      try {
        const parsed = JSON.parse(settings.value.preview_providers);
        if (!Array.isArray(parsed)) {
          throw new Error("INVALID_PREVIEW_PROVIDERS_JSON");
        }
        settings.value.preview_providers = JSON.stringify(parsed, null, 2);
      } catch (e) {
        log.error("预览规则配置 JSON 解析失败:", e);
        showError(t("admin.preview.previewProvidersInvalidJson"));
        return;
      }
    }

    isSavingProviders.value = true;

    // 预览设置组，分组ID = 2
    await updatePreviewSettings({
      preview_providers: settings.value.preview_providers,
    });
    showSuccess(t("admin.preview.saveSuccess"));
  } catch (err) {
    log.error("保存预览规则设置失败:", err);
    showError(err.message || t("admin.preview.loadError"));
  } finally {
    isSavingProviders.value = false;
  }
};

// 重置为默认设置
const handleResetToDefaults = async () => {
  const confirmed = await confirm({
    title: t("common.dialogs.resetTitle"),
    message: t("common.dialogs.resetConfirm"),
    confirmType: "warning",
    confirmText: t("common.dialogs.resetButton"),
    darkMode: darkMode.value,
  });
  if (!confirmed) {
    return;
  }
  Object.assign(settings.value, defaultSettings);
  syncVisualRulesFromJson(settings.value.preview_providers);
};

// 组件挂载时加载设置
onMounted(() => {
  loadSettings();
});
</script>
