<template>
  <nav class="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 gap-2 sm:gap-0" :aria-label="$t('breadcrumb.navigation')">
    <!-- 左侧面包屑 -->
    <ol class="flex flex-wrap items-center space-x-1">
      <li class="flex items-center">
        <a
          href="#"
          @click.prevent="navigateToRoot"
          :class="['flex items-center font-medium transition-colors duration-200', darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900']"
        >
          <!-- 根目录图标 -->
          <svg class="w-5 h-5 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          <span>{{ $t("breadcrumb.root") }}</span>
        </a>
      </li>

      <!-- 路径分隔符和目录段 -->
      <li v-for="(segment, index) in pathSegments" :key="index" class="flex items-center">
        <span :class="['mx-1', darkMode ? 'text-gray-500' : 'text-gray-400']"> / </span>
        <a
          href="#"
          @click.prevent="navigateToSegment(index)"
          :class="[
            'font-medium transition-colors duration-200',
            index === pathSegments.length - 1 && !previewFileName
              ? darkMode
                ? 'text-primary-400'
                : 'text-primary-600'
              : darkMode
              ? 'text-gray-300 hover:text-white'
              : 'text-gray-600 hover:text-gray-900',
          ]"
        >
          {{ segment }}
        </a>
      </li>

      <!-- 文件预览项 - 直接从URL读取，即时显示 -->
      <li v-if="previewFileName" class="flex items-center">
        <span :class="['mx-1', darkMode ? 'text-gray-500' : 'text-gray-400']"> / </span>
        <span :class="['font-medium', darkMode ? 'text-primary-400' : 'text-primary-600']">
          {{ previewFileName }}
        </span>
      </li>
    </ol>

  </nav>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const route = useRoute();

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

const emit = defineEmits(["navigate"]);

// 从URL直接读取预览文件名（即时响应，无需等待API）
const previewFileName = computed(() => route.query.preview || null);

// 计算路径段
const pathSegments = computed(() => {
  // 移除开头的斜杠，然后按斜杠分割
  const segments = props.currentPath
    .replace(/^\/+/, "") // 移除开头的斜杠
    .split("/")
    .filter((segment) => segment); // 过滤空字符串

  // 对于API密钥用户，需要根据基本路径过滤可显示的路径段
  if (props.userType === "user" && props.basicPath !== "/") {
    const normalizedBasicPath = props.basicPath.replace(/\/+$/, "");
    const basicSegments = normalizedBasicPath
      .replace(/^\/+/, "")
      .split("/")
      .filter((segment) => segment);

    // 如果当前路径在基本路径范围内，只显示基本路径及其子路径的段
    const currentPathNormalized = "/" + segments.join("/");
    const basicPathNormalized = "/" + basicSegments.join("/");

    if (currentPathNormalized === basicPathNormalized) {
      // 当前路径就是基本路径，显示为根路径（空数组）
      return [];
    } else if (currentPathNormalized.startsWith(basicPathNormalized + "/")) {
      // 当前路径在基本路径范围内，显示从基本路径开始的段
      return segments.slice(basicSegments.length);
    } else if (basicPathNormalized.startsWith(currentPathNormalized + "/")) {
      // 当前路径是基本路径的父级路径，显示到基本路径为止的段
      return segments;
    } else {
      // 其他情况，显示所有段（这种情况理论上不应该发生，因为后端会阻止访问）
      return segments;
    }
  }

  return segments;
});

// 导航到指定段
const navigateToSegment = (segmentIndex) => {
  // 对于API密钥用户，需要检查导航权限
  if (props.userType === "user" && props.basicPath !== "/") {
    const normalizedBasicPath = props.basicPath.replace(/\/+$/, "");
    const basicSegments = normalizedBasicPath
      .replace(/^\/+/, "")
      .split("/")
      .filter((segment) => segment);

    // 构建目标路径
    let targetSegments;
    if (props.currentPath.startsWith(normalizedBasicPath)) {
      // 当前在基本路径范围内，目标路径需要加上基本路径前缀
      targetSegments = [...basicSegments, ...pathSegments.value.slice(0, segmentIndex + 1)];
    } else {
      // 当前在基本路径的父级路径，直接使用段
      targetSegments = pathSegments.value.slice(0, segmentIndex + 1);
    }

    let targetPath = "/";
    if (targetSegments.length > 0) {
      targetPath += targetSegments.join("/") + "/";
    }

    // 检查目标路径是否在权限范围内
    const basicPathNormalized = "/" + basicSegments.join("/");
    const targetPathNormalized = "/" + targetSegments.join("/");

    if (targetPathNormalized === basicPathNormalized || targetPathNormalized.startsWith(basicPathNormalized + "/") || basicPathNormalized.startsWith(targetPathNormalized + "/")) {
      emit("navigate", targetPath);
    }
    // 如果无权限，不执行导航
    return;
  }

  // 管理员用户或根路径用户，正常导航
  let targetPath = "/";
  if (segmentIndex >= 0) {
    targetPath += pathSegments.value.slice(0, segmentIndex + 1).join("/") + "/";
  }
  emit("navigate", targetPath);
};

// 导航到根目录
const navigateToRoot = () => {
  // 对于API密钥用户，如果有基本路径限制，导航到基本路径而不是真正的根路径
  if (props.userType === "user" && props.basicPath !== "/") {
    emit("navigate", props.basicPath);
  } else {
    emit("navigate", "/");
  }
};
</script>
