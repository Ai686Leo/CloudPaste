<template>
  <div class="file-uploader">
    <!-- 上传类型选项卡 -->
    <div class="upload-tabs mb-4">
      <div class="flex border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <button
          @click="activeTab = 'file'"
          class="py-2 px-4 font-medium text-sm focus:outline-none transition-colors duration-200"
          :class="[
            activeTab === 'file'
              ? darkMode
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-blue-600 border-b-2 border-blue-600'
              : darkMode
              ? 'text-gray-400 hover:text-gray-300'
              : 'text-gray-500 hover:text-gray-700',
          ]"
        >
          <div class="flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h7.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            {{ t("file.uploadTabs.fileUpload") }}
          </div>
        </button>
        <button
          @click="activeTab = 'url'"
          class="py-2 px-4 font-medium text-sm focus:outline-none transition-colors duration-200"
          :class="[
            activeTab === 'url'
              ? darkMode
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-blue-600 border-b-2 border-blue-600'
              : darkMode
              ? 'text-gray-400 hover:text-gray-300'
              : 'text-gray-500 hover:text-gray-700',
          ]"
        >
          <div class="flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.172 13.828a4 4 0 015.656 0l4 4a4 4 0 01-5.656 5.656l-1.102-1.101" />
            </svg>
            {{ t("file.uploadTabs.urlUpload") }}
          </div>
        </button>
      </div>
    </div>

    <!-- 文件上传界面 -->
    <div v-if="activeTab === 'file'">
      <!-- 文件拖放区域 -->
      <div
        class="drop-zone mb-4 border-2 border-dashed rounded-lg flex flex-col items-center justify-center py-6 px-4 cursor-pointer transition-all duration-300"
        :class="[
          darkMode ? 'border-gray-600 hover:border-gray-500 bg-gray-800/30' : 'border-gray-300 hover:border-gray-400 bg-gray-50',
          isDragging ? (darkMode ? 'border-blue-500 bg-blue-500/10 pulsing-border' : 'border-blue-500 bg-blue-50 pulsing-border') : '',
        ]"
        @dragenter.prevent="handleDragOver"
        @dragover.prevent="handleDragOver"
        @dragleave.prevent="handleDragLeave"
        @drop.prevent="handleDrop"
        @click="triggerFileInput"
      >
        <div class="icon-container mb-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-12 w-12 transition-colors duration-300"
            :class="[darkMode ? 'text-gray-400' : 'text-gray-500', isDragging ? (darkMode ? 'text-blue-400' : 'text-blue-500') : '']"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <div class="text-center">
          <p
            class="text-base font-medium transition-colors duration-300"
            :class="[darkMode ? 'text-gray-300' : 'text-gray-700', isDragging ? (darkMode ? 'text-blue-300' : 'text-blue-700') : '']"
          >
            {{ isDragging ? t("file.drag") : t("file.select") }}
          </p>
          <p
            class="text-sm mt-1 transition-colors duration-300"
            :class="[darkMode ? 'text-gray-400' : 'text-gray-500', isDragging ? (darkMode ? 'text-blue-300/80' : 'text-blue-600/80') : '']"
          >
            {{ t("file.maxSizeExceeded", { size: formatMaxFileSize() }) }}
          </p>
          <p
            class="text-sm mt-1 transition-colors duration-300"
            :class="[darkMode ? 'text-gray-400' : 'text-gray-500', isDragging ? (darkMode ? 'text-blue-300/80' : 'text-blue-600/80') : '']"
          >
            <span class="px-1.5 py-0.5 rounded text-xs" :class="darkMode ? 'bg-gray-700 text-blue-300' : 'bg-gray-200 text-blue-600'">
              {{ t("file.multipleFilesSupported") }}
            </span>
          </p>
        </div>
        <input ref="fileInput" type="file" class="hidden" multiple @change="onFileSelected" />
      </div>

      <!-- 已选文件预览 -->
      <div v-if="selectedFiles.length > 0" class="selected-files mb-6">
        <div class="files-header flex justify-between items-center mb-3">
          <h3 class="text-base font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
            {{ t("file.selectedFiles", { count: selectedFiles.length }) }}
          </h3>
          <button
            type="button"
            @click="clearAllFiles"
            class="text-sm px-2 py-1 rounded transition-colors flex items-center"
            :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            {{ t("file.clearAll") }}
          </button>
        </div>
        <div class="files-list max-h-60 overflow-y-auto">
          <div
            v-for="(file, index) in selectedFiles"
            :key="index"
            class="selected-file mb-3 flex items-center p-3 rounded-md"
            :class="[
              darkMode ? 'bg-gray-700/50' : 'bg-gray-100',
              fileItems[index]?.status === 'error' ? (darkMode ? 'border-l-4 border-red-500' : 'border-l-4 border-red-500') : '',
              fileItems[index]?.status === 'success' ? (darkMode ? 'border-l-4 border-green-500' : 'border-l-4 border-green-500') : '',
              fileItems[index]?.status === 'uploading' ? (darkMode ? 'border-l-4 border-blue-500' : 'border-l-4 border-blue-500') : '',
            ]"
          >
            <div class="file-icon mr-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" :class="darkMode ? 'text-gray-300' : 'text-gray-600'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div class="file-info flex-grow mr-3">
              <div class="font-medium truncate" :class="darkMode ? 'text-white' : 'text-gray-900'">
                {{ file.name }}
              </div>
              <div class="flex justify-between">
                <span class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ formatFileSize(file.size) }}
                </span>

                <!-- 文件状态显示 -->
                <span
                  v-if="fileItems[index]"
                  class="text-xs ml-2 px-2 py-0.5 rounded-full"
                  :class="{
                    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300': fileItems[index].status === 'pending',
                    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300': fileItems[index].status === 'uploading',
                    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300': fileItems[index].status === 'success',
                    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300': fileItems[index].status === 'error',
                  }"
                >
                  {{
                    fileItems[index].status === "pending"
                      ? t("file.pending")
                      : fileItems[index].status === "uploading"
                      ? `${fileItems[index].progress}%`
                      : fileItems[index].status === "success"
                      ? t("file.success")
                      : fileItems[index].status === "error"
                      ? t("file.error")
                      : ""
                  }}
                </span>
              </div>

              <!-- 单个文件进度条 -->
              <div v-if="fileItems[index]?.status === 'uploading'" class="w-full bg-gray-200 rounded-full h-1.5 mt-1 dark:bg-gray-700">
                <div
                  class="h-1.5 rounded-full transition-all duration-200"
                  :class="fileItems[index].progress >= 95 ? 'bg-green-500' : 'bg-blue-500'"
                  :style="{ width: `${fileItems[index].progress}%` }"
                ></div>
              </div>
            </div>
            <!-- 取消上传按钮，仅在上传状态显示 -->
            <button
              v-if="fileItems[index]?.status === 'uploading'"
              type="button"
              @click="cancelSingleUpload(index)"
              class="p-1 rounded-full hover:bg-opacity-20 transition-colors mr-1"
              :class="darkMode ? 'hover:bg-red-900/60 text-gray-400 hover:text-red-300' : 'hover:bg-red-100 text-gray-500 hover:text-red-500'"
              :title="t('file.cancelUpload')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5M5 12l7-7 7 7" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4L20 20" stroke="red" />
              </svg>
            </button>
            <!-- 重试按钮，仅在错误状态显示 -->
            <button
              v-if="fileItems[index]?.status === 'error'"
              type="button"
              @click="retryUpload(index)"
              class="p-1 rounded-full hover:bg-opacity-20 transition-colors mr-1"
              :class="darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-200 text-gray-500'"
              :title="t('file.retry')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
            <button
              type="button"
              @click="clearSelectedFile(index)"
              class="p-1 rounded-full hover:bg-opacity-20 transition-colors"
              :class="darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-200 text-gray-500'"
              :title="t('file.clearSelected')"
              :disabled="fileItems[index]?.status === 'uploading'"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 上传选项表单 -->
      <div class="upload-form">
        <form @submit.prevent="submitUpload">
          <!-- 存储配置选择 -->
          <div class="mb-6">
            <h3 class="text-lg font-medium mb-4" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{ t("file.storage") }}</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="form-group flex flex-col">
                <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.storage") }}</label>
                <div class="relative">
                <select
                  v-model="formData.storage_config_id"
                    class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent appearance-none"
                    :class="[
                      darkMode
                        ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                        : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
                    ]"
                    :disabled="!storageConfigs.length || loading || isUploading"
                    required
                  >
                    <option value="" disabled selected>{{ storageConfigs.length ? t("file.selectStorage") : t("file.noStorage") }}</option>
                    <option v-for="config in storageConfigs" :key="config.id" :value="config.id">{{ formatStorageOptionLabel(config) }}</option>
                  </select>
                  <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5"
                      :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              <!-- 存储路径 -->
              <div class="form-group flex flex-col">
                <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.path") }}</label>
                <input
                  type="text"
                  v-model="formData.path"
                  class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
                  :class="[
                    darkMode
                      ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
                  ]"
                  :placeholder="t('file.pathPlaceholder')"
                  :disabled="isUploading"
                />
              </div>
            </div>
          </div>

          <!-- 分享设置表单 -->
          <div class="mt-6 border-t pt-4 w-full overflow-hidden" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
            <h3 class="text-lg font-medium mb-4" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{ t("file.shareSettings") }}</h3>

            <!-- 更改这里的布局，使用更灵活的网格系统，每个栏位使用相同的模式 -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <!-- 每个表单组都使用一致的结构，增强布局的一致性 -->

              <!-- 备注 -->
              <div class="form-group flex flex-col">
                <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.remark") }}</label>
                <input
                  type="text"
                  v-model="formData.remark"
                  class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
                  :class="[
                    darkMode
                      ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
                  ]"
                  :placeholder="t('file.remarkPlaceholder')"
                  :disabled="isUploading"
                />
              </div>

              <!-- 自定义链接 -->
              <div class="form-group flex flex-col">
                <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.customLink") }}</label>
                <input
                  type="text"
                  v-model="formData.slug"
                  class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
                  :class="[
                    darkMode
                      ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
                    slugError ? (darkMode ? 'border-red-500' : 'border-red-600') : '',
                  ]"
                  :placeholder="t('file.customLinkPlaceholder')"
                  :disabled="isUploading"
                  @input="validateCustomLink"
                />
                <p v-if="slugError" class="mt-1 text-sm text-red-600 dark:text-red-400">{{ slugError }}</p>
                <p v-else class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t("file.onlyAllowedChars") }}</p>
              </div>

              <!-- 密码保护 -->
              <div class="form-group flex flex-col">
                <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.passwordProtection") }}</label>
                <input
                  type="text"
                  v-model="formData.password"
                  class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
                  :class="[
                    darkMode
                      ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
                  ]"
                  :placeholder="t('file.passwordPlaceholder')"
                  :disabled="isUploading"
                />
              </div>

              <!-- 过期时间 -->
              <div class="form-group flex flex-col">
                <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.expireTime") }}</label>
                <select
                  v-model="formData.expires_in"
                  class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
                  :class="[
                    darkMode
                      ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
                  ]"
                  :disabled="isUploading"
                >
                  <option value="1">{{ t("file.expireOptions.hour1") }}</option>
                  <option value="24">{{ t("file.expireOptions.day1") }}</option>
                  <option value="168">{{ t("file.expireOptions.day7") }}</option>
                  <option value="720">{{ t("file.expireOptions.day30") }}</option>
                  <option value="0">{{ t("file.expireOptions.never") }}</option>
                </select>
              </div>

              <!-- 最大查看次数 -->
              <div class="form-group flex flex-col">
                <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.maxViews") }}</label>
                <input
                  type="number"
                  v-model.number="formData.max_views"
                  min="0"
                  step="1"
                  pattern="\d*"
                  class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
                  :class="[
                    darkMode
                      ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
                  ]"
                  :placeholder="t('file.maxViewsPlaceholder')"
                  :disabled="isUploading"
                  @input="validateMaxViews"
                />
              </div>
            </div>

            <!-- 上传进度 -->
            <div v-if="totalProgress > 0 && isUploading" class="mt-4">
              <div class="flex justify-between items-center mb-1">
                <div class="flex items-center">
                  <span class="text-sm mr-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.uploadProgress") }}</span>
                  <span v-if="uploadSpeed" class="text-xs px-2 py-0.5 rounded" :class="darkMode ? 'bg-blue-900/30 text-blue-200' : 'bg-blue-100 text-blue-700'">
                    {{ uploadSpeed }}
                  </span>
                </div>
                <span class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ totalProgress }}%</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700 overflow-hidden">
                <div
                  class="h-2.5 rounded-full transition-all duration-200 ease-out relative overflow-hidden"
                  :class="totalProgress >= 95 ? 'bg-green-600' : 'bg-blue-600'"
                  :style="{ width: `${totalProgress}%` }"
                >
                  <div class="progress-stripes absolute inset-0 w-full h-full" :class="totalProgress < 100 ? 'animate-progress-stripes' : ''"></div>
                </div>
              </div>
            </div>

            <!-- 表单按钮 -->
            <div class="submit-section mt-6 flex flex-row items-center gap-3">
              <button
                type="submit"
                :disabled="selectedFiles.length === 0 || !formData.storage_config_id || isUploading || loading"
                class="btn-primary px-4 py-2 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors flex items-center justify-center min-w-[120px]"
                :class="[
                  selectedFiles.length === 0 || !formData.storage_config_id || isUploading || loading
                    ? darkMode
                      ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : darkMode
                    ? 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                    : 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 focus:ring-offset-white',
                ]"
              >
                <svg v-if="isUploading" class="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                {{ isUploading ? t("file.loading") : t("file.upload") }}
              </button>

              <!-- 将取消按钮放在上传按钮右侧 -->
              <button
                v-if="isUploading"
                type="button"
                @click="cancelUpload"
                class="px-4 py-2 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors flex items-center justify-center border"
                :class="
                  darkMode
                    ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-red-900/60 hover:text-red-200 hover:border-red-800 focus:ring-gray-500 focus:ring-offset-gray-800'
                    : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-red-50 hover:text-red-600 hover:border-red-300 focus:ring-gray-300 focus:ring-offset-white'
                "
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {{ t("file.cancel") }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>

    <!-- URL上传界面 -->
    <div v-else>
      <UrlUploader
        :darkMode="darkMode"
        :storage-configs="storageConfigs"
        :loading="loading"
        :isAdmin="isAdmin"
        @upload-success="$emit('upload-success', $event)"
        @upload-error="$emit('upload-error', $event)"
        @refresh-files="$emit('refresh-files')"
        @share-results="$emit('share-results', $event)"
      />
    </div>

  </div>
</template>

<script setup>
import { ref, computed, defineProps, defineEmits, onMounted, onUnmounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import UrlUploader from "./UrlUploader.vue";
import { formatFileSize } from "@/utils/fileUtils.js";
import { useDeleteSettingsStore } from "@/stores/deleteSettingsStore.js";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import { useShareSettingsForm } from "@/composables/upload/useShareSettingsForm.js";
import { useUploadQueue } from "@/composables/upload/useUploadQueue.js";
import { useShareUploadController, useShareUploadDomain, useUploadService } from "@/modules/upload";
import { useFileshareService } from "@/modules/fileshare";

const props = defineProps({
  darkMode: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  storageConfigs: { type: Array, default: () => [] },
});

const emit = defineEmits(["upload-success", "upload-error", "refresh-files", "share-results"]);
const { t } = useI18n();
const deleteSettingsStore = useDeleteSettingsStore();
const storageConfigsStore = useStorageConfigsStore();
const fileshareService = useFileshareService();
const {
  fileInput,
  selectedFiles,
  fileItems,
  isDragging,
  appendFiles,
  removeFileAt,
  updateFileItem,
  FILE_STATUS,
} = useUploadQueue();

const { getMaxUploadSize } = useUploadService();

const {
  formData,
  slugError,
  validateSlug,
  handleSlugInput,
  handleMaxViewsInput,
  selectDefaultStorageConfig,
} = useShareSettingsForm();

const {
  activeShareSession,
  startShareUpload,
  disposeShareSession,
} = useShareUploadController();

const {
  buildPayloadForFile,
  buildErrorDescriptor,
  summarizeUploadResults,
} = useShareUploadDomain();

const storageConfigs = computed(() => (props.storageConfigs && props.storageConfigs.length ? props.storageConfigs : storageConfigsStore.sortedConfigs));
const activeTab = ref("file");
const maxFileSizeMB = ref(100);
const isUploading = ref(false);
const uploadSpeed = ref("");
const totalProgress = ref(0);
const message = ref(null);
const lastLoaded = ref(0);
const lastTime = ref(0);
const shareRecordMap = new Map();
const pendingShareItems = ref([]);

const uppyIdByIndex = new Map();
const pendingErrorDescriptors = [];

const findFileIndexById = (fileId) => {
  for (const [index, id] of uppyIdByIndex.entries()) {
    if (id === fileId) return index;
  }
  return -1;
};

const emitShareResults = (results) => {
  emit("share-results", Array.isArray(results) ? results : []);
};

watch(
  storageConfigs,
  (configs) => {
    if (!configs || configs.length === 0) {
      return;
    }
    if (formData.storage_config_id && configs.some((config) => config.id === formData.storage_config_id)) {
      return;
    }
    formData.storage_config_id = configs[0].id;
  },
  { immediate: true }
);

onMounted(async () => {
  try {
    const size = await getMaxUploadSize();
    if (size) {
      maxFileSizeMB.value = size;
    }
  } catch (error) {
    console.warn("获取最大上传大小失败", error);
  }
  document.addEventListener("paste", handlePaste);
  selectDefaultStorageConfig();
});

onUnmounted(() => {
  document.removeEventListener("paste", handlePaste);
  disposeShareSession();
});

const formatStorageOptionLabel = (config) => {
  if (!config) {
    return t("file.storage");
  }
  const meta = config.provider_type || config.storage_type;
  return meta ? `${config.name} (${meta})` : config.name;
};

const formatMaxFileSize = () => formatFileSize(maxFileSizeMB.value * 1024 * 1024);

const triggerFileInput = () => {
  fileInput.value?.click?.();
};

const setErrorMessage = (text, type = "error") => {
  message.value = { type, content: text };
  if (type !== "success") {
    emit("upload-error", new Error(text));
  }
};

const getCurrentOrigin = () => (typeof window !== "undefined" && window.location ? window.location.origin : "");

const buildShareResultEntry = (item) => {
  const meta = item?.meta || {};
  const cachedRecord = shareRecordMap.get(item?.id);
  if (!meta.shareRecord && cachedRecord) {
    console.debug("[FileUploader] using cached shareRecord", item?.id, cachedRecord);
  }
  const record = meta.shareRecord || cachedRecord;
  if (!record) return null;
  const slug = record.slug || meta.slug || item?.slug || null;
  if (!slug && !record.url) return null;

  const origin = getCurrentOrigin();
  let shareUrl = "";
  if (slug) {
    shareUrl = fileshareService.buildShareUrl({ slug }, origin);
  } else if (record.url) {
    shareUrl = record.url.startsWith("http") || !origin ? record.url : `${origin.replace(/\/$/,"")}${record.url}`;
  }
  const previewUrl = record.previewUrl || record.proxy_preview_url || record.proxyPreviewUrl || shareUrl;
  const downloadUrl =
    record.proxy_download_url ||
    record.proxyDownloadUrl ||
    record.downloadUrl ||
    (slug ? fileshareService.getPermanentDownloadUrl({ slug }) : "");

  return {
    id: record.id || meta.fileId || item?.id || slug,
    filename: record.filename || meta.filename || item?.name || slug || "file",
    slug,
    shareUrl,
    previewUrl,
    downloadUrl,
    password: meta.password || null,
    expiresAt: record.expires_at || record.expiresAt || null,
  };
};

const extractShareResults = (uploadResults = []) => {
  console.debug("[FileUploader] upload successful items", uploadResults);
  const normalized = uploadResults.map((item) => {
    const entry = buildShareResultEntry(item);
    if (!entry) {
      console.debug("[FileUploader] missing shareRecord for item", item);
    }
    return entry;
  });
  return normalized.filter((entry) => entry && entry.shareUrl);
};

const flushPendingShareResults = () => {
  if (!pendingShareItems.value.length) return;
  const ready = [];
  const waiting = [];

  pendingShareItems.value.forEach((item) => {
    const entry = buildShareResultEntry(item);
    if (entry) {
      ready.push(entry);
      if (item?.id) {
        shareRecordMap.delete(item.id);
      }
    } else {
      waiting.push(item);
    }
  });

  if (!ready.length) {
    console.debug("[FileUploader] pending share records not ready", waiting.map((item) => item.id));
    pendingShareItems.value = waiting;
    return;
  }

  emitShareResults(ready);
  pendingShareItems.value = waiting;
  if (!waiting.length) {
    shareRecordMap.clear();
  }
};

const resetShareCaches = () => {
  shareRecordMap.clear();
  pendingShareItems.value = [];
};



const handleFilesAddition = (fileList) => {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const accepted = [];
  let rejected = false;
  files.forEach((file) => {
    if (file.size > maxFileSizeMB.value * 1024 * 1024) {
      rejected = true;
      return;
    }
    accepted.push(file);
  });
  if (rejected) {
    setErrorMessage(t("file.maxSizeExceeded", { size: formatMaxFileSize() }));
  }
  if (accepted.length) {
    appendFiles(accepted);
  }
};

const onFileSelected = (event) => {
  handleFilesAddition(event?.target?.files);
  if (event?.target) {
    event.target.value = "";
  }
};

const handleDragOver = (event) => {
  event?.preventDefault?.();
  isDragging.value = true;
};

const handleDragLeave = (event) => {
  event?.preventDefault?.();
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  const x = event?.clientX ?? 0;
  const y = event?.clientY ?? 0;
  if (!rect || x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
    isDragging.value = false;
  }
};

const handleDrop = (event) => {
  event?.preventDefault?.();
  isDragging.value = false;
  handleFilesAddition(event?.dataTransfer?.files || []);
};

const handlePaste = (event) => {
  if (event?.clipboardData?.files?.length) {
    event.preventDefault();
    handleFilesAddition(event.clipboardData.files);
  }
};

const clearSelectedFile = (index) => {
  const item = fileItems.value[index];
  if (!item || item.status === FILE_STATUS.UPLOADING) return;
  removeFileAt(index);
  if (!selectedFiles.value.length && fileInput.value) {
    fileInput.value.value = "";
  }
};

const clearAllFiles = () => {
  for (let i = fileItems.value.length - 1; i >= 0; i -= 1) {
    if (fileItems.value[i]?.status !== FILE_STATUS.UPLOADING) {
      removeFileAt(i);
    }
  }
  if (!selectedFiles.value.length && fileInput.value) {
    fileInput.value.value = "";
  }
};

const validateMaxViews = (event) => {
  handleMaxViewsInput(event?.target?.value ?? 0);
};

const validateCustomLink = (event) => {
  handleSlugInput(event?.target?.value ?? formData.slug);
  return validateSlug();
};

const computeFileSlug = (index) => {
  if (!formData.slug) return "";
  return selectedFiles.value.length > 1 ? `${formData.slug}-${index + 1}` : formData.slug;
};

const updateOverallProgress = (currentIndex, loaded, total) => {
  const totalSize = selectedFiles.value.reduce((sum, file) => sum + file.size, 0);
  if (!totalSize) {
    totalProgress.value = 0;
    return;
  }
  const completedSize = selectedFiles.value.reduce((sum, file, idx) => {
    const item = fileItems.value[idx];
    if (!item) return sum;
    if (idx < currentIndex) {
      return sum + file.size;
    }
    if (idx === currentIndex) {
      return sum + Math.min(loaded, total);
    }
    if (item.status === FILE_STATUS.SUCCESS) {
      return sum + file.size;
    }
    return sum;
  }, 0);
  totalProgress.value = Math.round((completedSize / totalSize) * 100);
};

const updateSpeedMeter = (loaded) => {
  const now = Date.now();
  const elapsed = (now - lastTime.value) / 1000;
  if (elapsed > 0.5) {
    const delta = loaded - lastLoaded.value;
    uploadSpeed.value = formatSpeed(delta / elapsed);
    lastLoaded.value = loaded;
    lastTime.value = now;
  }
};

const removeSuccessfulItems = () => {
  for (let i = fileItems.value.length - 1; i >= 0; i -= 1) {
    if (fileItems.value[i]?.status === FILE_STATUS.SUCCESS) {
      removeFileAt(i);
    }
  }
  if (!selectedFiles.value.length && fileInput.value) {
    fileInput.value.value = "";
  }
};

const ensurePreconditions = () => {
  if (!selectedFiles.value.length) {
    setErrorMessage(t("file.messages.noFilesSelected"), "warning");
    return false;
  }
  if (!formData.storage_config_id) {
    selectDefaultStorageConfig();
    if (!formData.storage_config_id) {
      setErrorMessage(t("file.messages.noStorageConfig"));
      return false;
    }
  }
  if (Number(formData.max_views) < 0) {
    setErrorMessage(t("file.messages.negativeMaxViews"));
    return false;
  }
  if (formData.slug && !validateSlug()) {
    message.value = { type: "error", content: slugError.value };
    return false;
  }
  return true;
};

const submitUpload = async () => {
  if (!ensurePreconditions()) return;

  disposeShareSession();
  emitShareResults([]);
  resetShareCaches();

  let ids = [];
  const basePayload = buildPayloadForFile(formData);
  try {
    ({ ids } = startShareUpload({
      files: selectedFiles.value,
      payload: basePayload,
      events: {
        onProgress: ({ fileId, bytesUploaded, bytesTotal, percent }) => {
          const idx = findFileIndexById(fileId);
          if (idx < 0) return;
          updateFileItem(idx, { status: FILE_STATUS.UPLOADING, progress: Math.min(100, percent) });
          updateOverallProgress(idx, bytesUploaded, bytesTotal);
          updateSpeedMeter(bytesUploaded);
        },
        onSuccess: ({ file }) => {
          const idx = findFileIndexById(file?.id);
          if (idx < 0) return;
          updateFileItem(idx, { status: FILE_STATUS.SUCCESS, progress: 100 });
        },
        onError: ({ file, error }) => {
          const idx = findFileIndexById(file?.id);
          if (idx < 0) return;
          const descriptor = buildErrorDescriptor(error || new Error(t("file.messages.uploadFailed")));
          updateFileItem(idx, { status: FILE_STATUS.ERROR, message: descriptor.message });
        },
        onComplete: (result) => {
          const failedDescriptors = (result?.failed || []).map((item) => buildErrorDescriptor(item?.error || new Error(t("file.messages.uploadFailed"))));
          const uploadResults = result?.successful || [];
          pendingShareItems.value = uploadResults;
          const normalizedShareResults = extractShareResults(uploadResults);
          const summary = summarizeUploadResults({
            errors: failedDescriptors,
            uploadResults,
            totalFiles: selectedFiles.value.length,
          });

          if (normalizedShareResults.length) {
            emitShareResults(normalizedShareResults);
            resetShareCaches();
          } else if (pendingShareItems.value.length) {
            console.debug("[FileUploader] waiting for share-record events", pendingShareItems.value.map((item) => item.id));
          }

          flushPendingShareResults();

          isUploading.value = false;
          uploadSpeed.value = "";

          if (summary) {
            if (summary.kind === "error") {
              setErrorMessage(summary.message, summary.severity === "warning" ? "warning" : "error");
            } else if (summary.kind === "success") {
              message.value = {
                type: "success",
                content: summary.message,
              };
              emit("upload-success", uploadResults);
              emit("refresh-files");
              formData.slug = "";
              formData.remark = "";
              formData.password = "";
            }
          }

          removeSuccessfulItems();
          disposeShareSession();
        },
        onShareRecord: ({ file, shareRecord }) => {
          console.debug("[FileUploader] share-record event", file?.id, shareRecord);
          if (file?.id && shareRecord) {
            shareRecordMap.set(file.id, shareRecord);
          }
          flushPendingShareResults();
        },
      },
    }));
  } catch (error) {
    setErrorMessage(error.message || t("file.messages.uploadFailed"));
    return;
  }

  ids.forEach((id, index) => {
    if (id) uppyIdByIndex.set(index, id);
    updateFileItem(index, { status: FILE_STATUS.PENDING, progress: 0, message: "" });
  });

  isUploading.value = true;
  totalProgress.value = 0;
  message.value = null;
  lastLoaded.value = 0;
  lastTime.value = Date.now();
  uploadSpeed.value = "";

  try {
    await activeShareSession.value.start();
  } catch (error) {
    isUploading.value = false;
    disposeShareSession();
    setErrorMessage(error.message || t("file.messages.uploadFailed"));
  }
};

const retryUpload = async (index) => {
  const item = fileItems.value[index];
  if (!item || !formData.storage_config_id || isUploading.value) return;

  try {
    const payload = buildPayloadForFile(formData, computeFileSlug(index));
    const { session } = startShareUpload({
      files: [selectedFiles.value[index]],
      payload,
      events: {
        onProgress: ({ percent, bytesUploaded }) => {
          updateFileItem(index, { status: FILE_STATUS.UPLOADING, progress: Math.min(100, percent) });
          updateSpeedMeter(bytesUploaded);
        },
        onError: ({ error }) => {
          const descriptor = buildErrorDescriptor(error || new Error(t("file.messages.uploadFailed")));
          updateFileItem(index, { status: FILE_STATUS.ERROR, message: descriptor.message });
        },
        onComplete: (result) => {
          const uploadResults = result?.successful || [];
          pendingShareItems.value = uploadResults;
          const failedDescriptors = (result?.failed || []).map((item) => buildErrorDescriptor(item?.error || new Error(t("file.messages.uploadFailed"))));
          const normalizedShareResults = extractShareResults(uploadResults);

          if (normalizedShareResults.length) {
            emitShareResults(normalizedShareResults);
            resetShareCaches();
          } else if (pendingShareItems.value.length) {
            console.debug("[FileUploader] waiting for share-record events", pendingShareItems.value.map((item) => item.id));
          }

          flushPendingShareResults();

          isUploading.value = false;

          if (failedDescriptors.length === 0) {
            message.value = { type: "success", content: t("file.retrySuccessful") };
            emit("refresh-files");
            setTimeout(() => clearSelectedFile(index), 2000);
          } else {
            setErrorMessage(failedDescriptors[0].message || t("file.messages.uploadFailed"));
          }
          session?.destroy?.();
        },
        onShareRecord: ({ file, shareRecord }) => {
          console.debug("[FileUploader] share-record event (retry)", file?.id, shareRecord);
          if (file?.id && shareRecord) {
            shareRecordMap.set(file.id, shareRecord);
          }
          flushPendingShareResults();
        },
      },
    });

    isUploading.value = true;
    uploadSpeed.value = "";
    lastLoaded.value = 0;
    lastTime.value = Date.now();
    await session.start();
  } catch (error) {
    isUploading.value = false;
    session?.destroy?.();
    emit("upload-error", error);
  }
};

const cancelUpload = () => {
  if (!isUploading.value && !activeShareSession.value) return;
  try { activeShareSession.value?.cancel?.(); } catch {}
  isUploading.value = false;
  totalProgress.value = 0;
  uploadSpeed.value = "";
  lastLoaded.value = 0;
  lastTime.value = 0;
  fileItems.value.forEach((item, index) => {
    if (item.status === FILE_STATUS.UPLOADING || item.status === FILE_STATUS.PENDING) {
      updateFileItem(index, { status: FILE_STATUS.ERROR, message: t("file.messages.uploadCancelled") });
    }
  });
  message.value = { type: "warning", content: t("file.cancelAllMessage") };
  disposeShareSession();
};


const formatSpeed = (bytesPerSecond) => {
  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond.toFixed(0)} B/s`;
  }
  if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
};

const cancelSingleUpload = (index) => {
  const item = fileItems.value[index];
  if (!item || (item.status !== FILE_STATUS.UPLOADING && item.status !== FILE_STATUS.PENDING)) return;
  try {
    const fid = uppyIdByIndex.get(index);
    if (fid && activeShareSession.value?.uppy?.removeFile) {
      activeShareSession.value.uppy.removeFile(fid);
    }
  } catch {}
  updateFileItem(index, { status: FILE_STATUS.ERROR, message: t("file.messages.uploadCancelled") });
  message.value = { type: "warning", content: t("file.singleFileCancelMessage") };
};

</script>

<style scoped>
/* 脉动边框动画 */
@keyframes pulseBorder {
  0% {
    border-color: rgba(59, 130, 246, 0.5); /* 淡蓝色 */
  }
  50% {
    border-color: rgba(59, 130, 246, 1); /* 全蓝色 */
  }
  100% {
    border-color: rgba(59, 130, 246, 0.5); /* 淡蓝色 */
  }
}

/* 进度条条纹动画 */
@keyframes progressStripes {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 30px 0;
  }
}

.pulsing-border {
  animation: pulseBorder 1.5s ease-in-out infinite;
}

/* 提升动画性能 */
.drop-zone {
  will-change: border-color, background-color, transform;
  transform: translateZ(0);
}

/* 拖动元素进入时的缩放效果 */
.drop-zone.pulsing-border {
  transform: scale(1.01);
  transition: transform 0.3s ease;
}

/* 进度条条纹样式 */
.progress-stripes {
  background-image: linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.15) 25%,
    transparent 25%,
    transparent 50%,
    rgba(255, 255, 255, 0.15) 50%,
    rgba(255, 255, 255, 0.15) 75%,
    transparent 75%,
    transparent
  );
  background-size: 30px 30px;
}

/* 进度条条纹动画 */
.animate-progress-stripes {
  animation: progressStripes 1s linear infinite;
}

</style>
