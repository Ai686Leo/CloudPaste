<template>
  <nav class="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 gap-2 sm:gap-0" :aria-label="$t('breadcrumb.navigation')">
    <!-- 左侧面包屑 -->
    <ol class="flex flex-wrap items-center space-x-1">
      <li class="flex items-center">
        <a
          href="#"
          @click.prevent="navigateToRoot"
          @mouseenter="prefetchRoot"
          :class="['flex items-center font-medium transition-colors duration-200', darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900']"
        >
          <!-- 根目录图标 -->
          <IconHome class="mr-1" aria-hidden="true" />
          <span>{{ $t("breadcrumb.root") }}</span>
        </a>
      </li>

      <!-- 路径分隔符和目录段 -->
      <li v-for="(segment, index) in pathSegments" :key="index" class="flex items-center">
        <span :class="['mx-1', darkMode ? 'text-gray-500' : 'text-gray-400']"> / </span>
        <span
          v-if="index === pathSegments.length - 1"
          :class="['font-medium', darkMode ? 'text-primary-400' : 'text-primary-600']"
        >
          {{ segment }}
        </span>
        <a
          v-else
          href="#"
          @click.prevent="navigateToSegment(index)"
          @mouseenter="prefetchSegment(index)"
          :class="[
            'font-medium transition-colors duration-200',
            darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900',
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
import { IconHome } from "@/components/icons";

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

const normalizePath = (path) => {
  const raw = typeof path === "string" && path ? path : "/";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  const collapsed = withLeading.replace(/\/{2,}/g, "/");
  if (collapsed === "/") return "/";
  return collapsed.replace(/\/+$/, "");
};

const normalizedBasicPath = computed(() => normalizePath(props.basicPath));
const normalizedCurrentPath = computed(() => normalizePath(props.currentPath));

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
