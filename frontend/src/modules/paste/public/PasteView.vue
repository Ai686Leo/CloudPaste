<script setup>
// PasteView组件是一个轻量级包装器组件
// 主要负责接收darkMode和slug属性，并传递给主组件PasteViewMain
// 通过这种方式实现了关注点分离，使代码结构更加清晰
import PasteViewMain from "@/modules/paste/public/components/PasteViewMain.vue";

// 定义组件接收的属性
const props = defineProps({
  // 暗色模式标志，控制整个组件的颜色主题
  darkMode: {
    type: Boolean,
    required: true,
  },
  // 文本分享的唯一标识符
  slug: {
    type: String,
    required: true,
  },
});
</script>

<template>
  <!-- 将接收到的属性传递给主组件 -->
  <PasteViewMain :dark-mode="darkMode" :slug="slug" />
</template>
