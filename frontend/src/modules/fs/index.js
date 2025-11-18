// FS 模块统一入口
// 仅导出 service，视图通过直接路径引入以避免循环依赖

import { useFsService } from "./fsService.js";

export { useFsService };

export default {
  useFsService,
};
