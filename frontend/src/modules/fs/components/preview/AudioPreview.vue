<template>
  <div class="audio-preview-container">
    <!-- 音频预览提示 -->
    <div class="audio-preview p-4">
      <!-- 加载中状态 -->
      <div v-if="isLoadingPlaylist" class="text-center py-8">
        <LoadingIndicator
          :text="$t('mount.audioPreview.loadingAudio')"
          :dark-mode="darkMode"
          size="2xl"
          :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
        />
      </div>

      <!-- 已发送到全局播放器的提示 -->
      <div v-else-if="sentToGlobalPlayer" class="flex flex-col items-center max-w-sm mx-auto py-8">
        <!-- 标题和描述 -->
        <div class="text-center mb-6">
          <h3
            class="text-lg font-semibold mb-1.5"
            :class="darkMode ? 'text-gray-100' : 'text-gray-900'"
          >
            {{ $t('mount.audioPreview.playingInGlobalPlayer') }}
          </h3>
          <p
            class="text-sm"
            :class="darkMode ? 'text-gray-400' : 'text-gray-600'"
          >
            {{ currentFileName }}
          </p>
        </div>
        <!-- 按钮 -->
        <div class="flex w-full gap-2">
          <button
            class="flex-1 px-4 py-2 rounded-md border transition-colors flex items-center justify-center gap-1.5 text-sm font-medium"
            :class="[
              darkMode
                ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            ]"
            @click="backToLocalPreview"
          >
            <span>{{ $t('mount.audioPreview.backToPreview') }}</span>
          </button>
        </div>
      </div>

      <!-- 本地预览模式（可选，用于首次加载时显示） -->
      <div v-else-if="!sentToGlobalPlayer && audioUrl && audioData" class="audio-player-wrapper">
        <AudioPlayer
          ref="audioPlayerRef"
          :audio-list="finalAudioList"
          :current-audio="null"
          :dark-mode="darkMode"
          :autoplay="false"
          :show-playlist="true"
          :list-folded="true"
          :list-max-height="'380px'"
          :mode="'normal'"
          :volume="0.7"
          :loop="'all'"
          :order="'list'"
          @play="handlePlay"
          @pause="handlePause"
          @error="handleError"
          @canplay="handleCanPlay"
          @ended="handleAudioEnded"
          @leftswitch="handleListSwitch"
        />
        <!-- 发送到全局播放器按钮 - 悬浮在播放器右上角 -->
        <button
          class="send-to-global-btn"
          :class="{ 'dark': darkMode }"
          :title="$t('mount.audioPreview.sendToGlobalPlayer')"
          @click="sendToGlobalPlayer"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <!-- 无音频数据 -->
      <div v-else class="text-center py-8">
        <LoadingIndicator
          :text="$t('mount.audioPreview.loadingAudio')"
          :dark-mode="darkMode"
          size="2xl"
          :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import AudioPlayer from "@/components/common/AudioPlayer.vue";
import { FileType } from "@/utils/fileTypes.js";
import { useFsService } from "@/modules/fs";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { useGlobalPlayer } from "@/composables/useGlobalPlayer.js";

const { t } = useI18n();
const fsService = useFsService();

// 全局播放器
const globalPlayer = useGlobalPlayer();

// Props 定义
const props = defineProps({
  // 文件信息
  file: {
    type: Object,
    required: true,
  },
  // 音频URL
  audioUrl: {
    type: String,
    default: null,
  },
  // 是否为深色模式
  darkMode: {
    type: Boolean,
    default: false,
  },
  // 是否为管理员
  isAdmin: {
    type: Boolean,
    default: false,
  },
  // 当前目录路径
  currentPath: {
    type: String,
    default: "",
  },
  // 目录项目列表
  directoryItems: {
    type: Array,
    default: () => [],
  },
});

// Emits 定义
const emit = defineEmits(["play", "pause", "error", "canplay", "loaded"]);

// 响应式数据
const audioPlayerRef = ref(null);
const isPlaying = ref(false);
const originalTitle = ref("");

// 是否已发送到全局播放器
const sentToGlobalPlayer = ref(false);

// 播放列表相关
const audioPlaylist = ref([]);
const isLoadingPlaylist = ref(false);

// 当前音频数据（响应式）
const currentAudioData = ref(null);

// 当前文件名
const currentFileName = computed(() => props.file?.name || t("mount.audioPreview.unknownAudio"));

// 计算最终的播放列表
const finalAudioList = computed(() => {
  if (audioPlaylist.value.length > 0) {
    return audioPlaylist.value;
  } else if (currentAudioData.value) {
    return [currentAudioData.value];
  }
  return [];
});

// 为了兼容性，保留 audioData 计算属性
const audioData = computed(() => currentAudioData.value);

// 更新页面标题
const updatePageTitle = (playing = false, fileName = null) => {
  const title = fileName || t("mount.audioPreview.audioPlayer");
  document.title = playing ? `🎵 ${title}` : `${title}`;
};

// 恢复原始页面标题
const restoreOriginalTitle = () => {
  if (originalTitle.value) {
    document.title = originalTitle.value;
  }
};

// 发送到全局播放器
const sendToGlobalPlayer = () => {
  if (finalAudioList.value.length === 0) {
    console.warn("没有可播放的音频");
    return;
  }

  // 找到当前文件在播放列表中的索引
  const currentIndex = finalAudioList.value.findIndex(
    (audio) => audio.originalFile?.path === props.file?.path || audio.name === props.file?.name
  );

  // 发送到全局播放器
  globalPlayer.playAudio(finalAudioList.value, Math.max(0, currentIndex));

  // 标记已发送
  sentToGlobalPlayer.value = true;

  // 停止本地播放器
  if (audioPlayerRef.value) {
    const player = audioPlayerRef.value.getInstance?.();
    if (player) {
      player.pause();
    }
  }

  console.log("🎵 音频已发送到全局播放器");
};

// 返回本地预览模式
const backToLocalPreview = () => {
  sentToGlobalPlayer.value = false;
};

// 事件处理函数
const handlePlay = (data) => {
  isPlaying.value = true;
  const audioName = data?.audio?.name;
  updatePageTitle(true, audioName);
  emit("play", data);
};

const handlePause = (data) => {
  isPlaying.value = false;
  const audioName = data?.audio?.name;
  updatePageTitle(false, audioName);
  emit("pause", data);
};

const handleError = (error) => {
  if (error?.target?.src?.includes(window.location.origin) && currentAudioData.value?.url) {
    console.log("🎵 忽略Service Worker相关的误报错误");
    return;
  }
  isPlaying.value = false;
  emit("error", error);
};

const handleCanPlay = () => {
  emit("canplay");
  emit("loaded");
};

const handleAudioEnded = () => {
  console.log("音频播放结束");
};

const handleListSwitch = (data) => {
  const audioIndex = data?.index?.index ?? data?.index;
  let audioName = null;
  if (data?.audio?.name) {
    audioName = data.audio.name;
  } else if (typeof audioIndex === "number" && finalAudioList.value[audioIndex]) {
    audioName = finalAudioList.value[audioIndex].name;
  }
  updatePageTitle(isPlaying.value, audioName);
};

// 获取当前目录下的音频文件列表
const loadAudioPlaylist = async () => {
  console.log("🎵 开始加载音频播放列表...");

  if (!props.currentPath || isLoadingPlaylist.value) {
    return;
  }

  if (audioPlaylist.value.length > 0) {
    console.log("✅ 播放列表已存在，跳过重复加载");
    return;
  }

  try {
    isLoadingPlaylist.value = true;

    let directoryItems = [];

    if (props.directoryItems && props.directoryItems.length > 0) {
      directoryItems = props.directoryItems;
    } else {
      const data = await fsService.getDirectoryList(props.currentPath);
      if (data?.items) {
        directoryItems = data.items;
      } else {
        return;
      }
    }

    const audioFileList = directoryItems.filter((item) => {
      if (item.isDirectory) return false;
      return item.type === FileType.AUDIO;
    });

    audioFileList.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if (audioFileList.length > 0) {
      await generateAudioPlaylist(audioFileList);
    }
  } catch (error) {
    console.error("❌ 加载音频播放列表失败:", error);
  } finally {
    isLoadingPlaylist.value = false;
  }
};

// 生成音频播放列表数据
const generateAudioPlaylist = async (audioFileList) => {
  const playlist = [];

  for (const audioFile of audioFileList) {
    if (audioFile.name === props.file?.name && currentAudioData.value) {
      playlist.push(currentAudioData.value);
      continue;
    }

    try {
      const presignedUrl = await generateS3PresignedUrl(audioFile);
      if (presignedUrl) {
        const audioItem = {
          name: audioFile.name || "unknown",
          artist: "unknown",
          url: presignedUrl,
          cover: generateDefaultCover(audioFile.name),
          originalFile: audioFile,
        };
        playlist.push(audioItem);
      }
    } catch (error) {
      console.error(`生成音频播放数据失败: ${audioFile.name}`, error);
    }
  }

  const currentFileIndex = playlist.findIndex((audio) => audio.originalFile?.path === props.file.path);
  if (currentFileIndex > 0) {
    const currentFile = playlist.splice(currentFileIndex, 1)[0];
    playlist.unshift(currentFile);
  }

  audioPlaylist.value = playlist;

  if (audioPlayerRef.value && playlist.length > 0) {
    setTimeout(() => {
      nextTick(() => {
        const player = audioPlayerRef.value?.getInstance();
        if (player && player.list && playlist.length > 0) {
          try {
            player.list.clear();
            const validPlaylist = playlist.filter((audio) => audio?.url && audio?.name);
            validPlaylist.forEach((audio) => {
              try {
                player.list.add(audio);
              } catch (error) {
                console.error(`添加音频失败: ${audio.name}`, error);
              }
            });
            if (validPlaylist.length > 0) {
              player.list.switch(0);
            }
          } catch (error) {
            console.error("更新播放列表失败:", error);
          }
        }
      });
    }, 100);
  }
};

// 生成 S3 预签名 URL
const generateS3PresignedUrl = async (audioFile) => {
  try {
    const presignedUrl = await fsService.getFileLink(audioFile.path, null, false);
    return presignedUrl;
  } catch (error) {
    console.error(`获取音频预签名URL失败: ${audioFile.name}`, error);
  }
  return null;
};

// 生成默认封面
const generateDefaultCover = (name) => {
  const firstChar = (name || "M")[0].toUpperCase();
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = props.darkMode ? "#60a5fa" : "#3b82f6";
  ctx.fillRect(0, 0, 100, 100);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(firstChar, 50, 50);

  return canvas.toDataURL();
};

// 初始化当前音频数据
const initializeCurrentAudio = async () => {
  if (!props.file) {
    return;
  }

  if (props.audioUrl) {
    currentAudioData.value = {
      name: props.file.name || "unknown",
      artist: "unknown",
      url: props.audioUrl,
      cover: generateDefaultCover(props.file.name),
      contentType: props.file.contentType,
      originalFile: props.file,
    };
    return;
  }

  console.warn("⚠️ audioUrl为空");
  currentAudioData.value = {
    name: props.file.name || "unknown",
    artist: "unknown",
    url: null,
    cover: generateDefaultCover(props.file.name),
    contentType: props.file.contentType,
  };
};

// 监听 audioUrl 变化
watch(
  () => props.audioUrl,
  async (newAudioUrl, oldAudioUrl) => {
    if (newAudioUrl && props.file && newAudioUrl !== oldAudioUrl) {
      await initializeCurrentAudio();
    }
  }
);

// 监听全局播放器状态，自动同步 sentToGlobalPlayer
watch(
  [() => globalPlayer.isVisible.value, () => globalPlayer.hasPlaylist.value],
  ([visible, hasPlaylist]) => {
    // 当全局播放器关闭或播放列表清空时，自动返回本地预览
    if (sentToGlobalPlayer.value && (!visible || !hasPlaylist)) {
      sentToGlobalPlayer.value = false;
    }
  }
);

// 快捷键处理
const handleKeydown = (event) => {
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") {
    return;
  }

  // 如果已发送到全局播放器，不处理本地快捷键
  if (sentToGlobalPlayer.value) {
    return;
  }

  const player = audioPlayerRef.value?.getInstance();
  if (!player) return;

  switch (event.code) {
    case "Space":
      event.preventDefault();
      player.toggle();
      break;
    case "ArrowLeft":
      event.preventDefault();
      player.seek(Math.max(0, player.audio.currentTime - 10));
      break;
    case "ArrowRight":
      event.preventDefault();
      player.seek(Math.min(player.audio.duration, player.audio.currentTime + 10));
      break;
    case "ArrowUp":
      event.preventDefault();
      player.volume(Math.min(1, player.audio.volume + 0.1));
      break;
    case "ArrowDown":
      event.preventDefault();
      player.volume(Math.max(0, player.audio.volume - 0.1));
      break;
  }
};

// 生命周期钩子
onMounted(() => {
  originalTitle.value = document.title;
  document.addEventListener("keydown", handleKeydown);

  nextTick(async () => {
    await initializeCurrentAudio();
    loadAudioPlaylist();
  });
});

onBeforeUnmount(() => {
  restoreOriginalTitle();
  document.removeEventListener("keydown", handleKeydown);
  console.log("🧹 音频预览组件已卸载");
});
</script>

<style scoped>
@import "@/styles/pages/mount-explorer/audio-preview.css";
</style>
