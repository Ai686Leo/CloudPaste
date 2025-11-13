export const PathPolicy = {
  // 仅保留存储直传所需的目录合成功能
  composeDirectory(defaultFolder, customPath) {
    const def = PathPolicy.normalizeFragment(defaultFolder);
    const cus = PathPolicy.normalizeFragment(customPath);
    return [def, cus].filter(Boolean).join("/");
  },

  normalizeFragment(fragment) {
    if (!fragment) return "";
    return String(fragment).replace(/\\/g, "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
  },
};

