// Upload 模块对外统一入口
// 仅导出给其它模块复用的领域能力，避免与视图产生循环依赖

import { useShareUploadController } from "./shareUploadController.js";
import { useShareUploadDomain } from "./shareUploadDomain.js";
import { useUploadService } from "./services/uploadService.js";

export {
  // controllers & domain
  useShareUploadController,
  useShareUploadDomain,

  // services
  useUploadService,
};

export default {
  useShareUploadController,
  useShareUploadDomain,
  useUploadService,
};
