<template>
  <div ref="mapEl" class="p-map-embed" :class="{ 'is-error': loadState === 'error' }" :style="containerStyle">
    <div v-if="loadState === 'error'" class="p-map-embed__overlay" aria-live="polite">
      <div class="p-map-embed__overlay-text">地图加载失败</div>
    </div>

    <div v-if="showZoomControls" class="p-map-embed__zoom">
      <button type="button" class="p-map-embed__zoom-btn" aria-label="放大" @click.stop="zoomIn">
        <IconPlus class="p-map-embed__zoom-icon" aria-hidden="true" />
      </button>
      <button type="button" class="p-map-embed__zoom-btn" aria-label="缩小" @click.stop="zoomOut">
        <IconMinus class="p-map-embed__zoom-icon" aria-hidden="true" />
      </button>
    </div>

    <div v-if="attributionText" class="p-map-embed__attribution" aria-label="地图版权信息">
      {{ attributionText }}
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { IconMinus, IconPlus } from "@/components/icons";

const props = defineProps({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  zoom: { type: Number, default: 16 },
  height: { type: Number, default: 160 },
  showZoomControls: { type: Boolean, default: false },
  interactive: { type: Boolean, default: false },
  providers: { type: Array, default: null },
});

const emit = defineEmits(["load", "error", "provider-change"]);

const DEFAULT_PROVIDERS = [
  {
    id: "osmfj",
    name: "OpenStreetMap Japan (OSMFJ)",
    urlTemplate: "https://{s}.tile.openstreetmap.jp/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  },
  {
    id: "osm-de",
    name: "OpenStreetMap DE",
    urlTemplate: "https://tile.openstreetmap.de/{z}/{x}/{y}.png",
    subdomains: null,
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  },
  {
    id: "osmfr-hot",
    name: "OpenStreetMap FR (HOT)",
    urlTemplate: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  },
  {
    id: "osmfr-osmfr",
    name: "OpenStreetMap FR (OSMFR)",
    urlTemplate: "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors",
  },
  {
    id: "osm-official",
    name: "OpenStreetMap (official)",
    urlTemplate: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  },
];

const mapEl = ref(null);
const loadState = ref("idle"); // idle | loading | loaded | error
const containerStyle = computed(() => {
  const h = Math.max(80, Number(props.height) || 160);
  return { height: `${h}px`, minHeight: `${h}px`, width: "100%" };
});

const currentProvider = ref(null);
const stripHtml = (html) => String(html || "").replace(/<[^>]*>/g, "").replace(/&copy;/gi, "©").trim();
const attributionText = computed(() => {
  if (!currentProvider.value) return "© OpenStreetMap contributors";
  const txt = stripHtml(currentProvider.value.attribution);
  return txt || "© OpenStreetMap contributors";
});

let map = null;
let marker = null;
let tileLayer = null;
let resizeObserver = null;

let providerIndex = 0;
let tileErrorCount = 0;
let loadTimer = null;

const clearLoadTimer = () => {
  if (loadTimer) {
    clearTimeout(loadTimer);
    loadTimer = null;
  }
};

const clampNumber = (n, min, max) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.min(max, Math.max(min, num));
};

const getProviders = () => {
  const list = Array.isArray(props.providers) && props.providers.length > 0 ? props.providers : DEFAULT_PROVIDERS;
  return list.filter((p) => p && p.urlTemplate);
};

const toLatLng = () => {
  const lat = clampNumber(props.lat, -90, 90);
  const lng = clampNumber(props.lng, -180, 180);
  return [lat, lng];
};

const applyView = () => {
  if (!map) return;
  map.setView(toLatLng(), props.zoom, { animate: false });
  if (!marker) {
    marker = L.circleMarker(toLatLng(), {
      radius: 6,
      weight: 2,
      color: "#3b82f6",
      fillColor: "#3b82f6",
      fillOpacity: 0.9,
    }).addTo(map);
  } else {
    marker.setLatLng(toLatLng());
  }
};

const zoomIn = () => {
  if (!map) return;
  map.zoomIn(1, { animate: false });
};

const zoomOut = () => {
  if (!map) return;
  map.zoomOut(1, { animate: false });
};

const destroyTileLayer = () => {
  clearLoadTimer();
  tileErrorCount = 0;
  if (tileLayer && map) {
    try {
      tileLayer.off();
      map.removeLayer(tileLayer);
    } catch {
      // ignore
    }
  }
  tileLayer = null;
};

const setProvider = (nextIndex) => {
  const providers = getProviders();
  if (!map || providers.length === 0) return;

  providerIndex = Math.max(0, Math.min(nextIndex, providers.length - 1));
  const provider = providers[providerIndex];
  currentProvider.value = provider;

  destroyTileLayer();
  loadState.value = "loading";
  emit("provider-change", { provider, index: providerIndex });

  let tileSuccessCount = 0;

  tileLayer = L.tileLayer(provider.urlTemplate, {
    maxZoom: provider.maxZoom ?? 19,
    subdomains: provider.subdomains ?? undefined,
    crossOrigin: true,
    attribution: provider.attribution ?? "",
    updateWhenIdle: true,
    keepBuffer: 2,
  });

  const tryNextProvider = () => {
    clearLoadTimer();
    const next = providerIndex + 1;
    if (next >= providers.length) {
      loadState.value = "error";
      emit("error");
      return;
    }
    setProvider(next);
  };

  // 关键：小地图容器可能只请求 1-2 张瓦片，若都失败，之前的阈值(>=3)不会触发切换。
  // 改为：在“尚未成功加载任何瓦片”时，只要发生 tileerror 就立刻切换到下一个 provider。
  tileLayer.on("tileload", () => {
    tileSuccessCount += 1;
    if (tileSuccessCount === 1) {
      clearLoadTimer();
      tileErrorCount = 0;
      loadState.value = "loaded";
      emit("load");
    }
  });

  tileLayer.on("tileerror", () => {
    tileErrorCount += 1;
    if (tileSuccessCount === 0) {
      tryNextProvider();
      return;
    }

    // 若已经有瓦片成功，但连续出现多次错误，也认为当前 provider 不稳定，尝试切换
    if (tileErrorCount >= 5) {
      tryNextProvider();
    }
  });

  // 超时兜底：即便没有触发 tileerror，也可能是请求被挂起/阻断
  loadTimer = setTimeout(() => {
    tryNextProvider();
  }, 6000);

  tileLayer.addTo(map);
};

const initMap = () => {
  if (!mapEl.value) return;

  map = L.map(mapEl.value, {
    zoomControl: false,
    attributionControl: false,
    dragging: props.interactive,
    scrollWheelZoom: props.interactive,
    doubleClickZoom: props.interactive,
    boxZoom: props.interactive,
    keyboard: props.interactive,
    tap: props.interactive,
    touchZoom: props.interactive,
  });

  applyView();
  setProvider(0);

  requestAnimationFrame(() => {
    if (map) map.invalidateSize({ animate: false });
  });

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (map) map.invalidateSize({ animate: false });
    });
    resizeObserver.observe(mapEl.value);
  }
};

onMounted(() => {
  initMap();
});

watch(
  () => [props.lat, props.lng, props.zoom],
  () => {
    applyView();
  },
);

watch(
  () => props.providers,
  () => {
    // providers 切换时，从头开始尝试
    if (!map) return;
    setProvider(0);
  },
);

onBeforeUnmount(() => {
  clearLoadTimer();
  destroyTileLayer();
  if (resizeObserver) {
    try {
      resizeObserver.disconnect();
    } catch {
      // ignore
    }
  }
  if (map) {
    try {
      map.remove();
    } catch {
      // ignore
    }
  }
  map = null;
  marker = null;
});
</script>

<style scoped>
.p-map-embed {
  position: relative;
  width: 100%;
  background: #1a1b1d;
}

.p-map-embed__zoom {
  position: absolute;
  left: 8px;
  top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* Leaflet pane z-index 通常在 200+，这里必须显式高于瓦片层，否则会被“盖住” */
  z-index: 1001;
  pointer-events: auto;
}

.p-map-embed__zoom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  color: #ffffffcc;
  background: rgba(26, 27, 29, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px);
  transition: background 0.15s, border-color 0.15s;
  cursor: pointer;
}

.p-map-embed__zoom-btn:hover {
  background: rgba(26, 27, 29, 0.98);
  border-color: rgba(255, 255, 255, 0.32);
  color: #fff;
}

.p-map-embed__zoom-icon {
  width: 16px;
  height: 16px;
}

.p-map-embed__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 27, 29, 0.85);
  z-index: 2;
}

.p-map-embed__overlay-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
}

.p-map-embed__attribution {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px 6px;
  font-size: 11px;
  line-height: 1.2;
  border-radius: 6px;
  background: rgba(26, 27, 29, 0.7);
  color: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.12);
  z-index: 2;
  user-select: none;
  pointer-events: none;
}
</style>
