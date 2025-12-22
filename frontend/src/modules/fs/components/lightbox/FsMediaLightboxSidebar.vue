<template>
  <div class="p-lightbox__sidebar is-dark">
    <div class="p-sidebar__toolbar">
      <button class="p-sidebar__close" type="button" aria-label="关闭侧栏" @click="$emit('close')">
        <IconMdiChevronLeft size="sm" class="p-sidebar__close-icon" aria-hidden="true" />
      </button>
      <div class="p-sidebar__title">信息</div>
    </div>

    <div class="p-sidebar__content">
      <div v-if="!item" class="p-sidebar__empty">未选择文件</div>

      <template v-else>
        <div class="metadata__list">
          <div class="metadata__item">
            <div class="meta-title" :title="displayName">{{ displayName }}</div>
            <div class="meta-caption" :title="item.path">{{ item.path }}</div>
          </div>

          <div class="metadata__divider" />

          <div class="metadata__row">
            <IconMdiClockOutline size="sm" class="metadata__row-icon" aria-hidden="true" />
            <div class="metadata__row-body">
              <div class="meta-value" title="修改时间">{{ formattedModified }}</div>
            </div>
          </div>

          <div class="metadata__row">
            <IconMdiFileOutline size="sm" class="metadata__row-icon" aria-hidden="true" />
            <div class="metadata__row-body">
              <div class="meta-value" title="类型">{{ formattedType }}</div>
            </div>
          </div>

          <div class="metadata__row">
            <IconMdiDatabaseOutline size="sm" class="metadata__row-icon" aria-hidden="true" />
            <div class="metadata__row-body">
              <div class="meta-value" title="大小">{{ formattedSize }}</div>
            </div>
          </div>

          <div class="metadata__row">
            <IconMdiAspectRatio size="sm" class="metadata__row-icon" aria-hidden="true" />
            <div class="metadata__row-body">
              <div class="meta-value" title="尺寸">{{ formattedDimensions }}</div>
            </div>
          </div>

          <div v-if="isLivePhoto" class="p-sidebar__hint">Live Photo：包含视频片段</div>

          <template v-if="showExifSection">
            <div class="metadata__divider" />

            <div class="metadata__section-title">EXIF</div>

            <div v-if="exifLoading" class="p-sidebar__hint">正在解析 EXIF…</div>
            <div v-else-if="exifError" class="p-sidebar__hint">EXIF 解析失败</div>
            <div v-else-if="exifRows.length === 0 && exifTagCount === 0" class="p-sidebar__hint">无可用 EXIF</div>
            <div v-else-if="exifRows.length === 0 && exifTagCount > 0" class="p-sidebar__hint">
              已解析到 {{ exifTagCount }} 个元数据标签，但未匹配到当前展示字段
            </div>

            <div v-else>
              <div v-for="row in exifRows" :key="row.key" class="metadata__row">
                <IconMdiCalendar v-if="row.key === 'dateTimeOriginal'" size="sm" class="metadata__row-icon" aria-hidden="true" />
                <IconMdiMapMarkerOutline v-else-if="row.key === 'location'" size="sm" class="metadata__row-icon" aria-hidden="true" />
                <IconMdiCamera v-else-if="row.key === 'camera'" size="sm" class="metadata__row-icon" aria-hidden="true" />
                <IconMdiFocusAuto v-else-if="row.key === 'lensModel'" size="sm" class="metadata__row-icon" aria-hidden="true" />
                <IconMdiRuler v-else-if="row.key === 'focalLength'" size="sm" class="metadata__row-icon" aria-hidden="true" />
                <IconMdiCameraIris v-else-if="row.key === 'aperture'" size="sm" class="metadata__row-icon" aria-hidden="true" />
                <IconMdiTimerOutline v-else-if="row.key === 'shutter'" size="sm" class="metadata__row-icon" aria-hidden="true" />
                <IconMdiAlphaICircleOutline v-else-if="row.key === 'iso'" size="sm" class="metadata__row-icon" aria-hidden="true" />
                <IconMdiInformationOutline v-else size="sm" class="metadata__row-icon" aria-hidden="true" />
                <div class="metadata__row-body">
                  <div class="meta-value" :title="row.label">{{ row.value }}</div>
                </div>
              </div>
            </div>

            <!-- 地图嵌入 -->
            <div v-if="gpsCoords && !mapLoadError" class="metadata__map-container">
              <MapEmbed
                class="metadata__map-iframe"
                :lat="gpsCoords.lat"
                :lng="gpsCoords.lng"
                :interactive="true"
                :show-zoom-controls="true"
                @load="handleMapLoad"
                @error="handleMapError"
              />
              <div class="metadata__map-actions">
                <a :href="googleMapsUrl" target="_blank" rel="noopener noreferrer" class="metadata__map-link" title="在 Google Maps 中打开">
                  <IconMdiGoogleMaps size="sm" class="metadata__map-link-icon" aria-hidden="true" />
                </a>
                <a :href="amapUrl" target="_blank" rel="noopener noreferrer" class="metadata__map-link" title="在高德地图中打开">
                  <IconMdiMapMarker size="sm" class="metadata__map-link-icon" aria-hidden="true" />
                </a>
              </div>
            </div>
            <!-- 地图加载失败时的兜底 -->
            <div v-else-if="gpsCoords && mapLoadError" class="metadata__map-fallback">
              <div class="metadata__map-fallback-text">地图加载失败</div>
              <div class="metadata__map-actions">
                <a :href="googleMapsUrl" target="_blank" rel="noopener noreferrer" class="metadata__map-link" title="在 Google Maps 中打开">
                  <IconMdiGoogleMaps size="sm" class="metadata__map-link-icon" aria-hidden="true" />
                </a>
                <a :href="amapUrl" target="_blank" rel="noopener noreferrer" class="metadata__map-link" title="在高德地图中打开">
                  <IconMdiMapMarker size="sm" class="metadata__map-link-icon" aria-hidden="true" />
                </a>
              </div>
            </div>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { formatFileSize } from "@/utils/fileUtils";
import { formatDateTime } from "@/utils/timeUtils";
import { buildExifRows, isImageLikeForExif, loadExifTagsFromArrayBufferAsync, resolveGpsCoordinates } from "@/utils/exifReaderUtils";
import { useFsService } from "@/modules/fs";
import { getFileName, getMimeTypeDescription } from "@/utils/fileTypes";
import MapEmbed from "@/components/common/MapEmbed.vue";
import {
  IconMdiAlphaICircleOutline,
  IconMdiAspectRatio,
  IconMdiCalendar,
  IconMdiCamera,
  IconMdiCameraIris,
  IconMdiChevronLeft,
  IconMdiClockOutline,
  IconMdiDatabaseOutline,
  IconMdiFileOutline,
  IconMdiFocusAuto,
  IconMdiGoogleMaps,
  IconMdiInformationOutline,
  IconMdiMapMarker,
  IconMdiMapMarkerOutline,
  IconMdiRuler,
  IconMdiTimerOutline,
} from "@/components/icons";

const fsService = useFsService();

const props = defineProps({
  item: { type: Object, default: null },
  imageStates: { type: Object, default: null }, // Map
  loadImageUrl: { type: Function, default: null },
});

defineEmits(["close"]);

const displayName = computed(() => {
  return props.item?.name || props.item?.path || "未命名";
});

const formattedSize = computed(() => {
  const bytes = props.item?.size;
  return typeof bytes === "number" ? formatFileSize(bytes) : "-";
});

const formattedModified = computed(() => {
  const ts = props.item?.modified || props.item?.updatedAt || props.item?.updated_at || "";
  if (!ts) return "未知";
  return formatDateTime(ts);
});

const dimensions = computed(() => {
  const path = props.item?.path || "";
  if (!path || !props.imageStates || typeof props.imageStates.get !== "function") return null;
  const state = props.imageStates.get(path);
  if (!state) return null;
  const w = state.naturalWidth || 0;
  const h = state.naturalHeight || 0;
  if (!w || !h) return null;
  return { w, h };
});

const formattedDimensions = computed(() => {
  const d = dimensions.value;
  if (!d) return "未知";
  return `${d.w} × ${d.h}`;
});

const formattedType = computed(() => {
  // 优先使用后端明确给出的 mimetype
  const mimetype = String(props.item?.mimetype || "").trim();
  if (mimetype) return mimetype;

  // 兜底：根据文件名推断 MIME 或扩展名描述，避免直接展示数字枚举（如 5=IMAGE）
  const filename = getFileName(props.item?.path || props.item?.name || "");
  if (!filename) return "unknown";
  return getMimeTypeDescription({ name: filename, isDirectory: !!props.item?.isDirectory });
});

const isLivePhoto = computed(() => {
  return !!props.item?.__cloudpasteLivePhotoVideoPath;
});

const showExifSection = computed(() => {
  return isImageLikeForExif(props.item);
});

const exifLoading = ref(false);
const exifError = ref(false);
const exifRows = ref([]);
const exifTagCount = ref(0);

// 地图嵌入相关
const gpsCoords = ref(null); // { lat, lng }
const mapLoadError = ref(false);

const clampNumber = (n, min, max) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.min(max, Math.max(min, num));
};

const googleMapsUrl = computed(() => {
  if (!gpsCoords.value) return "";
  const lat = clampNumber(gpsCoords.value.lat, -90, 90);
  const lng = clampNumber(gpsCoords.value.lng, -180, 180);
  const url = new URL("https://www.google.com/maps");
  url.searchParams.set("q", `${lat},${lng}`);
  return url.toString();
});

const amapUrl = computed(() => {
  if (!gpsCoords.value) return "";
  const lat = clampNumber(gpsCoords.value.lat, -90, 90);
  const lng = clampNumber(gpsCoords.value.lng, -180, 180);
  // 高德地图 URI API（注意：WGS-84 坐标可能有偏移，但作为跳转链接可接受）
  const url = new URL("https://uri.amap.com/marker");
  url.searchParams.set("position", `${lng},${lat}`);
  url.searchParams.set("name", "照片位置");
  return url.toString();
});

const handleMapError = () => {
  mapLoadError.value = true;
};

const handleMapLoad = () => {
  mapLoadError.value = false;
};

let exifAbortController = null;

const abortExif = () => {
  if (exifAbortController) {
    try {
      exifAbortController.abort();
    } catch {
      // ignore
    }
  }
  exifAbortController = null;
};

const ensureImageUrl = async (item, signal) => {
  const path = item?.path || "";
  if (!path) return "";
  const states = props.imageStates;
  const getState = () => (states && typeof states.get === "function" ? states.get(path) : null);

  const state = getState();
  if (state?.status === "loaded" && state?.url) return state.url;

  if (typeof props.loadImageUrl === "function") {
    await props.loadImageUrl(item, { priority: "high", signal });
  }

  const nextState = getState();
  if (nextState?.status === "loaded" && nextState?.url) return nextState.url;
  return "";
};

const parseExif = async () => {
  abortExif();
  exifLoading.value = false;
  exifError.value = false;
  exifRows.value = [];
  exifTagCount.value = 0;
  gpsCoords.value = null;
  mapLoadError.value = false;

  const item = props.item;
  if (!item || !showExifSection.value) return;

  const controller = new AbortController();
  exifAbortController = controller;
  exifLoading.value = true;

  try {
    // 优先尝试当前用于显示的图片 URL（通常与 previewUrl 一致，且避免额外一次 getFileLink 请求）
    // 但如果是 HEIC/HEIF 解码后的 blob/objectUrl，则必然缺失元数据，需要回退到原文件直链。
    let candidateUrl = await ensureImageUrl(item, controller.signal);
    if (candidateUrl?.startsWith?.("blob:") || candidateUrl?.startsWith?.("data:")) {
      candidateUrl = "";
    }

    const tryLoadFromUrl = async (url) => {
      if (!url) return { rows: [], tagCount: 0, tags: null };
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const ct = String(res.headers.get("content-type") || "").toLowerCase();
      if (ct && ct.includes("text/html")) throw new Error("unexpected content-type: text/html");
      const buf = await res.arrayBuffer();
      const tags = await loadExifTagsFromArrayBufferAsync(buf);
      const tagCount = Object.keys(tags || {}).length;
      const rows = buildExifRows(tags);
      return { rows, tagCount, tags };
    };

    // 先尝试 candidateUrl
    const first = await tryLoadFromUrl(candidateUrl);
    exifTagCount.value = first.tagCount;
    exifRows.value = first.rows;
    // 提取 GPS 坐标用于地图嵌入
    if (first.tags) {
      gpsCoords.value = resolveGpsCoordinates(first.tags);
    }

    // 若没有匹配到展示字段，回退使用 getFileLink 获取原文件字节
    // 注意：location 行是 always=true，占位会让 exifRows.length > 0，从而导致永远不回退获取原文件 GPS
    const shouldTryRaw =
      exifRows.value.length === 0 || (exifTagCount.value > 0 && !gpsCoords.value);

    if (shouldTryRaw) {
      let rawUrl = "";
      try {
        rawUrl = await fsService.getFileLink(item.path, null, false);
      } catch {
        rawUrl = "";
      }

      if (rawUrl && rawUrl !== candidateUrl) {
        const second = await tryLoadFromUrl(rawUrl);
        exifTagCount.value = second.tagCount;
        exifRows.value = second.rows;
        // 更新 GPS 坐标
        if (second.tags) {
          gpsCoords.value = resolveGpsCoordinates(second.tags);
        }
      }
    }
  } catch (e) {
    if (e?.name !== "AbortError") {
      exifError.value = true;
    }
  } finally {
    if (exifAbortController === controller) {
      exifAbortController = null;
    }
    exifLoading.value = false;
  }
};
watch(
  () => props.item?.path,
  () => {
    void parseExif();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  abortExif();
});
</script>
