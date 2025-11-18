// Fileshare 模块统一入口

import { useFileshareService } from "./fileshareService.js";
import { useFileShareStore } from "./fileShareStore.js";
import FileView from "./public/FileView.vue";
import { useFileManagement } from "./admin/useFileManagement.js";
import FileManagementView from "./admin/FileManagementView.vue";

export {
  useFileshareService,
  useFileShareStore,
  FileView,
  useFileManagement,
  FileManagementView,
};

export default {
  useFileshareService,
  useFileShareStore,
  FileView,
  useFileManagement,
  FileManagementView,
};

