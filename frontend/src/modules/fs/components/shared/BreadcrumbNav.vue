<template>
  <nav class="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 gap-2 sm:gap-0" :aria-label="$t('breadcrumb.navigation')">
    <!-- 左侧面包屑 -->
    <ol class="flex flex-wrap items-center gap-1">
      <li class="flex items-center">
        <a
          href="#"
          @click.prevent="navigateToRoot"
          @mouseenter="prefetchRoot"
          :class="['flex items-center px-2 py-1.5 rounded-md transition-colors duration-200', darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100']"
        >
          <!-- 根目录图标 -->
          <IconHome size="sm" class="mr-1.5" aria-hidden="true" />
          <span class="text-base font-medium">{{ $t("breadcrumb.root") }}</span>
        </a>
      </li>

      <!-- 路径分隔符和目录段 -->
      <li v-for="(segment, index) in pathSegments" :key="index" class="flex items-center">
        <!-- Chevron Separator -->
        <IconChevronRight size="xs" :class="['mx-0.5', darkMode ? 'text-gray-600' : 'text-gray-400']" />
        
        <span
          v-if="index === pathSegments.length - 1"
          :class="['px-2 py-1.5 rounded-md text-base font-semibold', darkMode ? 'text-gray-100 bg-gray-800/50' : 'text-gray-900 bg-gray-100']"
        >
          {{ segment }}
        </span>
        <a
          v-else
          href="#"
          @click.prevent="navigateToSegment(index)"
          @mouseenter="prefetchSegment(index)"
          :class="[
            'px-2 py-1.5 rounded-md text-base font-medium transition-colors duration-200',
            darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
          ]"
        >
          {{ segment }}
        </a>
      </li>
    </ol>

  </nav>
</template>

<script setup>
import { computed } from "vue";
import { IconHome, IconChevronRight } from "@/components/icons";
import { normalizeFsPath } from "@/utils/fsPathUtils.js";

const props = defineProps({
  currentPath: {
    type: String,
    required: true,
    default: "/",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  basicPath: {
    type: String,
    default: "/",
  },
  userType: {
    type: String,
    default: "admin", // 'admin' 或 'user'
  },
});

const emit = defineEmits(["navigate", "prefetch"]);

const normalizedBasicPath = computed(() => normalizeFsPath(props.basicPath));
const normalizedCurrentPath = computed(() => normalizeFsPath(props.currentPath));

const isApiKeyUser = computed(() => props.userType === "user" && normalizedBasicPath.value !== "/");

const fullSegments = computed(() =>
  normalizedCurrentPath.value
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment)
);

const basicSegments = computed(() =>
  normalizedBasicPath.value
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment)
);

const isWithinBasicPath = computed(() => {
  if (!isApiKeyUser.value) return true;
  const base = basicSegments.value;
  if (!base.length) return true;
  return base.every((seg, index) => fullSegments.value[index] === seg);
});

// 计算路径段
const pathSegments = computed(() => {
  if (!isApiKeyUser.value || !isWithinBasicPath.value) {
    return fullSegments.value;
  }

  // 处于 basicPath 范围内时：面包屑 root 代表 basicPath，仅展示相对段
  return fullSegments.value.slice(basicSegments.value.length);
});

const buildTargetPath = (segmentIndex) => {
  const segments = pathSegments.value.slice(0, segmentIndex + 1);

  let targetSegments = segments;
  if (isApiKeyUser.value && isWithinBasicPath.value) {
    targetSegments = [...basicSegments.value, ...segments];
  }

  const targetPath = targetSegments.length > 0 ? `/${targetSegments.join("/")}` : "/";

  if (isApiKeyUser.value) {
    const base = normalizedBasicPath.value;
    if (targetPath !== base && !targetPath.startsWith(`${base}/`)) {
      return null;
    }
  }

  return targetPath;
};

// 导航到指定段
const navigateToSegment = (segmentIndex) => {
  const targetPath = buildTargetPath(segmentIndex);
  if (targetPath) {
    emit("navigate", targetPath);
  }
};

const prefetchSegment = (segmentIndex) => {
  const targetPath = buildTargetPath(segmentIndex);
  if (targetPath) {
    emit("prefetch", targetPath);
  }
};

// 导航到根目录
const navigateToRoot = () => {
  // 对于API密钥用户，如果有基本路径限制，导航到基本路径而不是真正的根路径
  if (isApiKeyUser.value) {
    emit("navigate", normalizedBasicPath.value);
  } else {
    emit("navigate", "/");
  }
};

const prefetchRoot = () => {
  if (isApiKeyUser.value) {
    emit("prefetch", normalizedBasicPath.value);
  } else {
    emit("prefetch", "/");
  }
};
</script>
