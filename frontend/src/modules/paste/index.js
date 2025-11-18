// Paste 模块对外统一入口
// 仅导出 service/composable，视图组件通过具体路径按需引入，避免循环依赖

import { usePasteService } from "./services/pasteService.js";
import { usePasteManagement } from "./admin/usePasteManagement.js";

export {
  // service
  usePasteService,

  // admin composables
  usePasteManagement,
};

// 默认导出方便解构
export default {
  usePasteService,
  usePasteManagement,
};
