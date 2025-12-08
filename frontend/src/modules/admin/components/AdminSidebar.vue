<template>
  <div>
    <!-- 桌面端侧边栏 - 为全局header留出空间，支持收缩 -->
    <div
      class="hidden md:block fixed left-0 top-16 border-r shadow-md z-30 transition-all duration-300"
      :class="[isCollapsed ? 'w-16' : 'w-64', 'h-[calc(100vh-4rem)]', darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200']"
    >
      <div class="flex flex-col h-full">
        <!-- 桌面端头部区域 - Logo + 标题 + 收缩按钮 -->
        <div class="h-16 flex-shrink-0 border-b flex items-center" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
          <!-- 统一容器，避免重复创建img元素 -->
          <div class="relative w-full h-full flex items-center" :class="isCollapsed ? 'justify-center' : 'px-4'">
            <!-- 站点图标 - 单一元素，通过CSS控制位置 -->
            <div class="flex-shrink-0 w-8 h-8" :class="isCollapsed ? '' : 'mr-3'">
              <img
                :src="siteFaviconUrl || '/cloudpaste.svg'"
                :alt="siteTitle"
                class="w-8 h-8 object-contain"
                :title="isCollapsed ? `${siteTitle} - ${userTypeText}` : siteTitle"
                @error="handleImageError"
              />
            </div>

            <!-- 标题信息 - 展开状态显示 -->
            <transition
              name="fade-slide"
              enter-active-class="transition-all duration-300 delay-100"
              leave-active-class="transition-all duration-200"
              enter-from-class="opacity-0 transform translate-x-2"
              enter-to-class="opacity-100 transform translate-x-0"
              leave-from-class="opacity-100 transform translate-x-0"
              leave-to-class="opacity-0 transform translate-x-2"
            >
              <div v-if="!isCollapsed" class="flex-1 min-w-0">
                <div class="font-semibold text-sm truncate" :class="darkMode ? 'text-white' : 'text-gray-900'">
                  {{ siteTitle }}
                </div>
                <div class="text-xs opacity-75 truncate" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                  {{ userTypeText }}
                </div>
              </div>
            </transition>

            <!-- 收缩按钮 - 展开状态显示 -->
            <transition
              name="fade-slide"
              enter-active-class="transition-all duration-300 delay-100"
              leave-active-class="transition-all duration-200"
              enter-from-class="opacity-0 transform translate-x-2"
              enter-to-class="opacity-100 transform translate-x-0"
              leave-from-class="opacity-100 transform translate-x-0"
              leave-to-class="opacity-0 transform translate-x-2"
            >
              <button
                v-if="!isCollapsed"
                @click="toggleCollapse"
                class="p-1.5 rounded-md transition-colors ml-2 flex-shrink-0"
                :class="darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'"
                :title="t('admin.sidebar.collapse')"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </transition>

            <!-- 展开按钮 - 收缩状态显示，位于侧边栏右边缘 -->
            <button
              v-if="isCollapsed"
              @click="toggleCollapse"
              class="absolute -right-3 top-1/2 transform -translate-y-1/2 w-6 h-6 rounded-full border shadow-sm transition-all flex items-center justify-center"
              :class="
                darkMode
                  ? 'bg-gray-800 border-gray-600 text-gray-300 hover:text-white hover:bg-gray-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              "
              :title="t('admin.sidebar.expand')"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        <div class="flex-1 flex flex-col overflow-y-auto pt-4">
          <nav class="flex-1 px-2 space-y-1">
            <template v-for="item in visibleMenuItems">
              <!-- 普通菜单项 -->
              <router-link
                v-if="item.type === 'item'"
                :key="`item-${item.id}`"
                :to="{ name: item.routeName }"
                :class="[
                  $route.name === item.routeName
                    ? darkMode
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-900'
                    : darkMode
                    ? 'text-gray-300 hover:bg-gray-700 hover:text-white'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                  'group flex items-center text-sm font-medium rounded-md transition-colors',
                  isCollapsed ? 'px-3 py-3 justify-center' : 'px-3 py-2.5',
                ]"
                :title="isCollapsed ? item.name : ''"
              >
                <svg
                  class="flex-shrink-0 h-6 w-6"
                  :class="[
                    isCollapsed ? 'mx-auto' : 'mr-3',
                    $route.name === item.routeName ? 'text-primary-500' : darkMode ? 'text-gray-400 group-hover:text-gray-300' : 'text-gray-400 group-hover:text-gray-500',
                  ]"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIconPath(item.icon)" />
                </svg>
                <transition
                  name="fade-slide"
                  enter-active-class="transition-all duration-300 delay-100"
                  leave-active-class="transition-all duration-200"
                  enter-from-class="opacity-0 transform translate-x-2"
                  enter-to-class="opacity-100 transform translate-x-0"
                  leave-from-class="opacity-100 transform translate-x-0"
                  leave-to-class="opacity-0 transform translate-x-2"
                >
                  <span v-if="!isCollapsed" class="whitespace-nowrap">
                    {{ item.name }}
                  </span>
                </transition>
              </router-link>

              <!-- 带子菜单的菜单组 -->
              <div v-else-if="item.type === 'group'" :key="`group-${item.id}`" class="space-y-1">
                <!-- 收缩状态：显示为图标，点击展开侧边栏 -->
                <button
                  v-if="isCollapsed"
                  @click="handleGroupItemClick"
                  :class="[
                    darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                    'w-full group flex items-center px-3 py-3 justify-center text-sm font-medium rounded-md cursor-pointer transition-colors',
                  ]"
                  :title="item.name"
                >
                  <svg
                    class="h-6 w-6 mx-auto"
                    :class="darkMode ? 'text-gray-400 group-hover:text-gray-300' : 'text-gray-400 group-hover:text-gray-500'"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIconPath(item.icon)" />
                  </svg>
                </button>

                <!-- 展开状态：显示完整的组菜单 -->
                <template v-else>
                  <!-- 主菜单项 -->
                  <button
                    @click="toggleSystemSettings"
                    :class="[
                      darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                      'w-full group flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-md cursor-pointer',
                    ]"
                  >
                    <div class="flex items-center">
                      <svg
                        class="flex-shrink-0 h-6 w-6"
                        :class="[isCollapsed ? 'mx-auto' : 'mr-3', darkMode ? 'text-gray-400 group-hover:text-gray-300' : 'text-gray-400 group-hover:text-gray-500']"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIconPath(item.icon)" />
                      </svg>
                      <transition
                        name="fade-slide"
                        enter-active-class="transition-all duration-300 delay-100"
                        leave-active-class="transition-all duration-200"
                        enter-from-class="opacity-0 transform translate-x-2"
                        enter-to-class="opacity-100 transform translate-x-0"
                        leave-from-class="opacity-100 transform translate-x-0"
                        leave-to-class="opacity-0 transform translate-x-2"
                      >
                        <span v-if="!isCollapsed" class="whitespace-nowrap">
                          {{ item.name }}
                        </span>
                      </transition>
                    </div>
                    <!-- 展开/收起箭头 -->
                    <transition
                      name="fade-slide"
                      enter-active-class="transition-all duration-300 delay-100"
                      leave-active-class="transition-all duration-200"
                      enter-from-class="opacity-0 transform translate-x-2"
                      enter-to-class="opacity-100 transform translate-x-0"
                      leave-from-class="opacity-100 transform translate-x-0"
                      leave-to-class="opacity-0 transform translate-x-2"
                    >
                      <svg
                        v-if="!isCollapsed"
                        class="h-5 w-5 transition-transform duration-200"
                        :class="[isSystemSettingsExpanded ? 'transform rotate-180' : '', darkMode ? 'text-gray-400' : 'text-gray-500']"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIconPath('chevron-down')" />
                      </svg>
                    </transition>
                  </button>

                  <!-- 子菜单项 -->
                  <div v-if="isSystemSettingsExpanded" class="ml-6 space-y-1">
                    <router-link
                      v-for="child in item.children"
                      :key="child.id"
                      :to="{ name: child.routeName }"
                      :class="[
                        $route.name === child.routeName
                          ? darkMode
                            ? 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-900'
                          : darkMode
                          ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
                        'group flex items-center px-3 py-2 text-sm font-medium rounded-md',
                      ]"
                    >
                      <svg
                        class="flex-shrink-0 h-5 w-5"
                        :class="[
                          isCollapsed ? 'mx-auto' : 'mr-3',
                          $route.name === child.routeName ? 'text-primary-500' : darkMode ? 'text-gray-500 group-hover:text-gray-400' : 'text-gray-400 group-hover:text-gray-500',
                        ]"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIconPath(child.icon)" />
                      </svg>
                      <transition
                        name="fade-slide"
                        enter-active-class="transition-all duration-300 delay-100"
                        leave-active-class="transition-all duration-200"
                        enter-from-class="opacity-0 transform translate-x-2"
                        enter-to-class="opacity-100 transform translate-x-0"
                        leave-from-class="opacity-100 transform translate-x-0"
                        leave-to-class="opacity-0 transform translate-x-2"
                      >
                        <span v-if="!isCollapsed" class="whitespace-nowrap">
                          {{ child.name }}
                        </span>
                      </transition>
                    </router-link>
                  </div>
                </template>
              </div>
            </template>

            <!-- 退出登录按钮 -->
            <div class="pt-4 mt-4 border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
              <a
                @click="handleLogout"
                :class="[
                  darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                  'group flex items-center text-sm font-medium rounded-md cursor-pointer transition-colors',
                  isCollapsed ? 'px-3 py-3 justify-center' : 'px-3 py-2.5',
                ]"
                :title="isCollapsed ? logoutText : ''"
              >
                <svg
                  class="flex-shrink-0 h-6 w-6"
                  :class="[isCollapsed ? 'mx-auto' : 'mr-3', 'text-gray-400']"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIconPath('logout')" />
                </svg>
                <transition
                  name="fade-slide"
                  enter-active-class="transition-all duration-300 delay-100"
                  leave-active-class="transition-all duration-200"
                  enter-from-class="opacity-0 transform translate-x-2"
                  enter-to-class="opacity-100 transform translate-x-0"
                  leave-from-class="opacity-100 transform translate-x-0"
                  leave-to-class="opacity-0 transform translate-x-2"
                >
                  <span v-if="!isCollapsed" class="whitespace-nowrap">
                    {{ logoutText }}
                  </span>
                </transition>
              </a>

              <!-- 文档链接 -->
              <div class="flex justify-center mt-2">
                <a
                  :href="DOC_URL"
                  target="_blank"
                  rel="noopener noreferrer"
                  :class="[
                    darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-400 hover:text-gray-500',
                    'inline-flex items-center justify-center p-2 rounded-md transition-colors duration-200',
                  ]"
                  title="Document"
                >
                  <svg class="h-7 w-7" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                    />
                  </svg>
                </a>
              </div>
            </div>
          </nav>
          <div class="h-6"></div>
        </div>
      </div>
    </div>

    <!-- 移动端侧边栏覆盖层 - 混合导航模式下的层级管理 -->
    <transition name="slide">
      <div v-if="isMobileSidebarOpen" class="md:hidden fixed inset-0 z-[60] flex">
        <!-- 侧边栏背景遮罩 -->
        <div class="fixed inset-0 bg-gray-900 bg-opacity-50 transition-opacity" @click="$emit('close-mobile-sidebar')"></div>

        <!-- 侧边栏内容 -->
        <div class="relative flex-1 flex flex-col w-full max-w-xs shadow-xl transform transition-transform ease-in-out duration-300" :class="darkMode ? 'bg-gray-800' : 'bg-white'">
          <!-- 移动端侧边栏Logo + 标题和关闭按钮 -->
          <div class="flex items-center justify-between p-3 h-14 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
            <!-- Logo + 标题 -->
            <div class="flex items-center flex-1 min-w-0">
              <!-- 站点图标 -->
              <div class="flex-shrink-0 w-8 h-8 mr-3">
                <img :src="siteFaviconUrl || '/cloudpaste.svg'" :alt="siteTitle" class="w-8 h-8 object-contain" @error="handleImageError" />
              </div>

              <!-- 标题信息 -->
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-base truncate" :class="darkMode ? 'text-white' : 'text-gray-900'">
                  {{ siteTitle }}
                </div>
                <div class="text-sm opacity-75 truncate" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                  {{ userTypeText }}
                </div>
              </div>
            </div>
            <button
              type="button"
              @click="$emit('close-mobile-sidebar')"
              class="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
            >
              <span class="sr-only">{{ t("admin.sidebar.closeMenu") }}</span>
              <svg
                class="h-6 w-6"
                :class="darkMode ? 'text-white' : 'text-gray-600'"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 移动端菜单内容 -->
          <div class="flex-1 overflow-y-auto pt-4">
            <nav class="px-4 space-y-2">
              <!-- 这里复制桌面端的菜单结构，但使用移动端样式 -->
              <template v-for="item in visibleMenuItems">
                <!-- 普通菜单项 -->
                <router-link
                  v-if="item.type === 'item'"
                  :key="item.id"
                  :to="{ name: item.routeName }"
                  :class="[
                    $route.name === item.routeName
                      ? darkMode
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-900'
                      : darkMode
                      ? 'text-gray-300 hover:bg-gray-700 hover:text-white'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                    'group flex items-center px-3 py-2.5 text-sm font-medium rounded-md',
                  ]"
                  @click="$emit('close-mobile-sidebar')"
                >
                  <svg
                    class="mr-3 flex-shrink-0 h-6 w-6"
                    :class="$route.name === item.routeName ? 'text-primary-500' : darkMode ? 'text-gray-400 group-hover:text-gray-300' : 'text-gray-400 group-hover:text-gray-500'"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIconPath(item.icon)" />
                  </svg>
                  {{ item.name }}
                </router-link>

                <!-- 带子菜单的菜单组 -->
                <div v-else-if="item.type === 'group'" :key="`mobile-group-${item.id}`" class="space-y-1">
                  <!-- 主菜单项 -->
                  <a
                    @click="toggleSystemSettings"
                    :class="[
                      darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                      'group flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-md cursor-pointer',
                    ]"
                  >
                    <div class="flex items-center">
                      <svg
                        class="mr-3 flex-shrink-0 h-6 w-6"
                        :class="darkMode ? 'text-gray-400 group-hover:text-gray-300' : 'text-gray-400 group-hover:text-gray-500'"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIconPath(item.icon)" />
                      </svg>
                      {{ item.name }}
                    </div>
                    <!-- 展开/收起箭头 -->
                    <svg
                      class="h-5 w-5 transition-transform duration-200"
                      :class="[isSystemSettingsExpanded ? 'transform rotate-180' : '', darkMode ? 'text-gray-400' : 'text-gray-500']"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIconPath('chevron-down')" />
                    </svg>
                  </a>

                  <!-- 子菜单项 -->
                  <div v-if="isSystemSettingsExpanded" class="ml-6 space-y-1">
                    <router-link
                      v-for="child in item.children"
                      :key="child.id"
                      :to="{ name: child.routeName }"
                      :class="[
                        $route.name === child.routeName
                          ? darkMode
                            ? 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-900'
                          : darkMode
                          ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
                        'group flex items-center px-3 py-2 text-sm font-medium rounded-md',
                      ]"
                      @click="$emit('close-mobile-sidebar')"
                    >
                      <svg
                        class="mr-3 flex-shrink-0 h-5 w-5"
                        :class="
                          $route.name === child.routeName ? 'text-primary-500' : darkMode ? 'text-gray-500 group-hover:text-gray-400' : 'text-gray-400 group-hover:text-gray-500'
                        "
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIconPath(child.icon)" />
                      </svg>
                      {{ child.name }}
                    </router-link>
                  </div>
                </div>
              </template>

              <!-- 退出登录按钮 -->
              <div class="pt-4 mt-4 border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
                <a
                  @click="handleLogout"
                  :class="[
                    darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                    'group flex items-center px-3 py-2.5 text-sm font-medium rounded-md cursor-pointer',
                  ]"
                >
                  <svg class="mr-3 flex-shrink-0 h-6 w-6 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIconPath('logout')" />
                  </svg>
                  {{ logoutText }}
                </a>

                <!-- 文档链接 -->
                <div class="flex justify-center mt-2">
                  <a
                    :href="DOC_URL"
                    target="_blank"
                    rel="noopener noreferrer"
                    :class="[
                      darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-400 hover:text-gray-500',
                      'inline-flex items-center justify-center p-2 rounded-md transition-colors duration-200',
                    ]"
                    title="Document"
                    @click="$emit('close-mobile-sidebar')"
                  >
                    <svg class="h-7 w-7" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      />
                    </svg>
                  </a>
                </div>
              </div>
            </nav>
            <div class="h-6"></div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useSiteConfigStore } from "@/stores/siteConfigStore.js";

// 使用i18n和站点配置Store
const { t } = useI18n();
const siteConfigStore = useSiteConfigStore();

const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  permissions: {
    type: Object,
    required: true,
  },
  isMobileSidebarOpen: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["close-mobile-sidebar", "logout", "sidebar-toggle"]);

// 侧边栏收缩状态
const isCollapsed = ref(false);

// 恢复保存的收缩状态
onMounted(() => {
  const saved = localStorage.getItem("admin-sidebar-collapsed");
  if (saved !== null) {
    isCollapsed.value = JSON.parse(saved);
    // 初始化时也要通知父组件
    emit("sidebar-toggle", { collapsed: isCollapsed.value });
  }
});

// 系统设置菜单的展开状态
const isSystemSettingsExpanded = ref(false);

// 站点图标相关计算属性
const siteFaviconUrl = computed(() => siteConfigStore.siteFaviconUrl);
const siteTitle = computed(() => siteConfigStore.siteTitle || "CloudPaste");

// 提取重复的权限判断逻辑
const userTypeText = computed(() => (props.permissions.isAdmin ? t("admin.sidebar.menuTitle.admin") : t("admin.sidebar.menuTitle.user")));
const logoutText = computed(() => (props.permissions.isAdmin ? t("admin.sidebar.logout") : t("admin.sidebar.logoutAuth")));

// 图标错误处理 - 直接切换到默认图标
const handleImageError = (event) => {
  event.target.src = "/cloudpaste.svg";
};

// 提取localStorage操作
const saveCollapseState = (collapsed) => {
  localStorage.setItem("admin-sidebar-collapsed", JSON.stringify(collapsed));
};

// 常量
const DOC_URL = "https://doc.cloudpaste.qzz.io/";

// 根据登录类型和权限计算可见的菜单项
const visibleMenuItems = computed(() => {
  // 管理员可见所有菜单
  if (props.permissions.isAdmin) {
    return [
      { id: "dashboard", name: t("admin.sidebar.dashboard"), icon: "chart-bar", type: "item", routeName: "AdminDashboard" },
      { id: "text-management", name: t("admin.sidebar.textManagement"), icon: "document-text", type: "item", routeName: "AdminTextManagement" },
      { id: "file-management", name: t("admin.sidebar.fileManagement"), icon: "folder", type: "item", routeName: "AdminFileManagement" },
      { id: "storage", name: t("admin.sidebar.storageConfig"), icon: "cloud", type: "item", routeName: "AdminStorage" },
      { id: "mount-management", name: t("admin.sidebar.mountManagement"), icon: "server", type: "item", routeName: "AdminMountManagement" },
      { id: "fs-meta-management", name: t("admin.sidebar.fsMetaManagement"), icon: "information-circle", type: "item", routeName: "AdminFsMetaManagement" },
      { id: "tasks", name: t("admin.sidebar.tasks"), icon: "clipboard-list", type: "item", routeName: "AdminTasks" },
      { id: "key-management", name: t("admin.sidebar.keyManagement"), icon: "key", type: "item", routeName: "AdminKeyManagement" },
      { id: "account-management", name: t("admin.sidebar.accountManagement"), icon: "user", type: "item", routeName: "AdminAccountManagement" },
      { id: "backup", name: t("admin.sidebar.backup"), icon: "circle-stack", type: "item", routeName: "AdminBackup" },
      {
        id: "system-settings",
        name: t("admin.sidebar.systemSettings"),
        icon: "cog",
        type: "group",
        children: [
          { id: "settings/global", name: t("admin.sidebar.globalSettings"), icon: "globe", type: "item", routeName: "AdminGlobalSettings" },
          { id: "settings/preview", name: t("admin.sidebar.previewSettings"), icon: "eye", type: "item", routeName: "AdminPreviewSettings" },
          { id: "settings/webdav", name: t("admin.sidebar.webdavSettings"), icon: "cloud-webdav", type: "item", routeName: "AdminWebDAVSettings" },
          { id: "settings/site", name: t("admin.sidebar.siteSettings"), icon: "home", type: "item", routeName: "AdminSiteSettings" },
        ],
      },
    ];
  }

  // API密钥用户根据权限显示菜单
  const items = [];

  if (props.permissions.text) {
    items.push({ id: "text-management", name: t("admin.sidebar.textManagement"), icon: "document-text", type: "item", routeName: "AdminTextManagement" });
  }

  if (props.permissions.file) {
    items.push({ id: "file-management", name: t("admin.sidebar.fileManagement"), icon: "folder", type: "item", routeName: "AdminFileManagement" });
  }

  if (props.permissions.mount) {
    items.push({ id: "mount-management", name: t("admin.sidebar.mountManagement"), icon: "server", type: "item", routeName: "AdminMountManagement" });
  }

  // 任务管理：有挂载权限即可访问，具体任务根据权限类型在列表内过滤
  if (props.permissions.mount) {
    items.push({ id: "tasks", name: t("admin.sidebar.tasks"), icon: "clipboard-list", type: "item", routeName: "AdminTasks" });
  }

  // 所有API密钥用户都可以访问账户管理（用于查看信息和登出）
  items.push({ id: "account-management", name: t("admin.sidebar.accountManagement"), icon: "user", type: "item", routeName: "AdminAccountManagement" });

  return items;
});

// 切换系统设置菜单的展开状态
const toggleSystemSettings = () => {
  isSystemSettingsExpanded.value = !isSystemSettingsExpanded.value;
};

// 收缩/展开切换函数
const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value;
  saveCollapseState(isCollapsed.value);
  emit("sidebar-toggle", { collapsed: isCollapsed.value });
};

// 处理收缩状态下的组菜单项点击 - 展开侧边栏并展开子菜单
const handleGroupItemClick = () => {
  isCollapsed.value = false;
  saveCollapseState(false);
  emit("sidebar-toggle", { collapsed: false });
  isSystemSettingsExpanded.value = true;
};

// 退出登录
const handleLogout = () => {
  emit("logout");
};

// 根据图标名称返回SVG路径数据
// 统一使用 Heroicons v2 图标
const getIconPath = (iconName) => {
  switch (iconName) {
    case "chart-bar":
      // Heroicons v2: chart-bar-square
      return "M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z";
    case "document-text":
      // Heroicons v2: document-text
      return "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z";
    case "document-duplicate":
      // Heroicons v2: document-duplicate
      return "M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75";
    case "information-circle":
      // Heroicons v2: information-circle
      return "M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z";
    case "folder":
      // Heroicons v2: folder
      return "M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z";
    case "cloud":
      // Heroicons v2: cloud
      return "M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z";
    case "cloud-webdav":
      // Heroicons v2: link
      return "M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244";
    case "key":
      // Heroicons v2: key
      return "M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z";
    case "cog":
      // Heroicons v2: cog-6-tooth
      return "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z";
    case "logout":
      // Heroicons v2: arrow-right-on-rectangle
      return "M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75";
    case "server":
      // Heroicons v2: server-stack
      return "M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z";
    case "chevron-down":
      // Heroicons v2: chevron-down
      return "M19.5 8.25l-7.5 7.5-7.5-7.5";
    case "globe":
      // Heroicons v2: globe-alt
      return "M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418";
    case "user":
      // Heroicons v2: user
      return "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z";
    case "eye":
      // Heroicons v2: eye
      return "M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z";
    case "home":
      // Heroicons v2: home
      return "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25";
    case "archive":
      // Heroicons v2: archive-box
      return "M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z";
    case "circle-stack":
      // Heroicons v2: circle-stack
      return "M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125";
    case "clipboard-list":
      // Heroicons v2: clipboard-document-list
      return "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z";
    default:
      return "";
  }
};
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease-in-out;
}

.slide-enter-from {
  transform: translateX(-100%);
}

.slide-leave-to {
  transform: translateX(-100%);
}
</style>
