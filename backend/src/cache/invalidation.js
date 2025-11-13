import cacheBus, { CACHE_EVENTS } from "./cacheBus.js";

const emit = (payload) => {
  cacheBus.emit(CACHE_EVENTS.INVALIDATE, payload);
};

export const invalidateFsCache = ({
  mountId = null,
  paths = [],
  storageConfigId = null,
  reason = "manual",
  bumpMountsVersion = false,
  db = null,
}) => {
  if (!mountId && !storageConfigId && !paths.length) {
    return;
  }
  emit({ target: "fs", mountId, paths, storageConfigId, reason, bumpMountsVersion, db });
};

export const invalidatePreviewCache = ({ db = null, reason = "manual" } = {}) => {
  emit({ target: "preview", db, reason });
};

export const invalidateAllCaches = ({ reason = "manual" } = {}) => {
  emit({ invalidateAll: true, reason });
};
