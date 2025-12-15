import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import { useAdminStorageConfigService } from "@/modules/admin/services/storageConfigService.js";

/**
 * 存储配置管理 composable
 * 提供多存储配置的 CRUD、分页管理、测试等能力
 * @param {Object} options - 可选配置
 * @param {Function} options.confirmFn - 自定义确认函数，接收 {title, message, confirmType} 参数，返回 Promise<boolean>
 */
export function useStorageConfigManagement(options = {}) {
  const { confirmFn } = options;

  // 国际化
  const { t } = useI18n();

  // 继承基础功能，使用独立的页面标识符
  const base = useAdminBase("storage");
  const storageConfigsStore = useStorageConfigsStore();
  const { getStorageConfigs, getStorageConfigReveal, deleteStorageConfig, setDefaultStorageConfig, testStorageConfig } =
    useAdminStorageConfigService();

  const STORAGE_TYPE_UNKNOWN = "__UNSPECIFIED__";

  const refreshSharedConfigs = async () => {
    try {
      await storageConfigsStore.refreshConfigs();
    } catch (error) {
      console.warn("刷新全局存储配置缓存失败", error);
    }
  };

  // 存储配置状态
  const storageConfigs = ref([]);
  const currentConfig = ref(null);
  const showAddForm = ref(false);
  const showEditForm = ref(false);
  const testResults = ref({});

  const storageTypeFilter = ref("all");

  const normalizeStorageTypeValue = (value) => {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    return STORAGE_TYPE_UNKNOWN;
  };

  const availableStorageTypes = computed(() => {
    const set = new Set();
    storageConfigs.value.forEach((config) => {
      set.add(normalizeStorageTypeValue(config.storage_type));
    });
    return Array.from(set);
  });

  const filteredConfigs = computed(() => {
    const filtered = storageTypeFilter.value === "all"
      ? storageConfigs.value
      : storageConfigs.value.filter((config) => normalizeStorageTypeValue(config.storage_type) === storageTypeFilter.value);

    // 前端分页：基于筛选结果切片
    const start = (base.pagination.page - 1) * base.pagination.limit;
    const end = start + base.pagination.limit;
    return filtered.slice(start, end);
  });

  watch(availableStorageTypes, (types) => {
    if (storageTypeFilter.value !== "all" && !types.includes(storageTypeFilter.value)) {
      storageTypeFilter.value = "all";
    }
  });

  // 筛选条件变化时重置到第一页
  watch(storageTypeFilter, () => {
    base.resetPagination();
  });

  // 测试详情模态框状态
  const showTestDetails = ref(false);
  const selectedTestResult = ref(null);
  const showDetailedResults = ref(true);

  // 存储配置分页选项：4、8、12
  const pageSizeOptions = [4, 8, 12];

  // 重写默认页面大小，默认 4 条记录
  const getDefaultPageSize = () => {
    try {
      const saved = localStorage.getItem("admin-page-size");
      if (saved) {
        const pageSizes = JSON.parse(saved);
        const savedSize = pageSizes["storage"] || 4;
        // 确保保存的值在分页选项范围内，否则使用默认值4
        return pageSizeOptions.includes(savedSize) ? savedSize : 4;
      }
    } catch (error) {
      console.warn("解析存储配置分页设置失败:", error);
    }
    return 4;
  };

  // 重新初始化分页状态
  base.pagination.limit = getDefaultPageSize();

  // 筛选后的总数（用于分页）
  const filteredTotal = computed(() => {
    const filtered = storageTypeFilter.value === "all"
      ? storageConfigs.value
      : storageConfigs.value.filter((config) => normalizeStorageTypeValue(config.storage_type) === storageTypeFilter.value);
    return filtered.length;
  });

  // 监听筛选结果变化，更新分页
  watch([filteredTotal, () => base.pagination.limit], () => {
    base.updatePagination({ total: filteredTotal.value }, "page");
  });

  /**
   * 加载存储配置列表
   */
  const loadStorageConfigs = async () => {
    return await base.withLoading(async () => {
      try {
        const { items } = await getStorageConfigs();
        storageConfigs.value = items;
        base.updatePagination({ total: filteredTotal.value }, "page");
        base.updateLastRefreshTime();
        console.log(`存储配置列表加载完成，共 ${items.length} 条`);
      } catch (error) {
        console.error("加载存储配置列表失败:", error);
        storageConfigs.value = [];
        throw error;
      }
    });
  };

  /**
   * 处理页码变化
   */
  const handlePageChange = (page) => {
    base.handlePaginationChange(page, "page");
  };

  /**
   * 处理每页数量变化
   */
  const handleLimitChange = (newLimit) => {
    base.changePageSize(newLimit);
  };

  /**
   * 删除存储配置
   */
  const handleDeleteConfig = async (configId) => {
    // 使用传入的确认函数或默认的 window.confirm
    let confirmed;
    if (confirmFn) {
      confirmed = await confirmFn({
        title: t("common.dialogs.deleteTitle"),
        message: t("common.dialogs.deleteItem", { name: t("admin.storage.item", "此存储配置") }),
        confirmType: "danger",
      });
    } else {
      confirmed = confirm(t("common.dialogs.deleteItem", { name: t("admin.storage.item", "此存储配置") }));
    }

    if (!confirmed) {
      return;
    }

    return await base.withLoading(async () => {
      try {
        await deleteStorageConfig(configId);
        base.showSuccess("删除成功");
        await loadStorageConfigs();
        await refreshSharedConfigs();
      } catch (err) {
        console.error("删除存储配置失败:", err);
        if (err.message && err.message.includes("有文件正在使用")) {
          base.showError(`无法删除此配置：${err.message}`);
        } else {
          base.showError(err.message || "删除存储配置失败，请稍后再试");
        }
      }
    });
  };

  /**
   * 编辑配置（使用 masked 模式加载密钥字段）
   */
  const editConfig = async (config) => {
    try {
      // 使用 masked 模式重新加载配置，显示掩码占位符
      const maskedConfig = await getStorageConfigReveal(config.id, "masked");
      const finalConfig = maskedConfig?.data || maskedConfig || { ...config };
      
      // 调试日志：查看掩码字段
      console.log("编辑配置 - 掩码数据:", {
        id: finalConfig.id,
        storage_type: finalConfig.storage_type,
        access_key_id: finalConfig.access_key_id,
        secret_access_key: finalConfig.secret_access_key,
        password: finalConfig.password,
        client_secret: finalConfig.client_secret,
        refresh_token: finalConfig.refresh_token,
      });
      
      currentConfig.value = finalConfig;
      showEditForm.value = true;
      showAddForm.value = false;
    } catch (err) {
      console.error("加载配置失败:", err);
      // 降级：使用原始配置
      currentConfig.value = { ...config };
      showEditForm.value = true;
      showAddForm.value = false;
    }
  };

  /**
   * 添加新配置
   */
  const addNewConfig = () => {
    currentConfig.value = null;
    showAddForm.value = true;
    showEditForm.value = false;
  };

  /**
   * 处理表单成功提交
   */
  const handleFormSuccess = async () => {
    showAddForm.value = false;
    showEditForm.value = false;
    await loadStorageConfigs();
    await refreshSharedConfigs();
  };

  /**
   * 设置默认配置
   */
  const handleSetDefaultConfig = async (configId) => {
    return await base.withLoading(async () => {
      try {
        await setDefaultStorageConfig(configId);
        base.showSuccess("设置默认配置成功");
        await loadStorageConfigs();
        await refreshSharedConfigs();
      } catch (err) {
        console.error("设置默认存储配置失败:", err);
        base.showError(err.message || "无法设置为默认配置，请稍后再试");
      }
    });
  };

  /**
   * 测试结果处理器类
   */
  class TestResultProcessor {
    constructor(result) {
      // 原始结果形态：后端返回 { success, result: {...} } 或 { success, data: { success, result: {...} } }
      this.raw = result || {};

      // 处理嵌套的 result 结构
      // 如果有 result 字段，优先使用 result 内容
      let inner = this.raw;
      
      // 检查是否有嵌套的 result 字段（S3/WebDAV 的情况）
      if (this.raw.result && typeof this.raw.result === 'object') {
        // LOCAL 测试：result 包含 pathExists/readPermission/writePermission
        if (this.raw.result.pathExists || this.raw.result.readPermission || this.raw.result.writePermission) {
          inner = this.raw.result;
        }
        // S3/WebDAV 测试：result 包含 read/write/cors/frontendSim/info
        else if (this.raw.result.read || this.raw.result.write || this.raw.result.cors || 
                 this.raw.result.frontendSim || this.raw.result.info) {
          inner = this.raw.result;
        }
      }

      this.result = inner || {};

      // 识别存储类型：
      // - OneDrive：result.info 中包含 driveName/driveType 等 OneDrive 特有字段，且不存在 cors/frontendSim
      // - LOCAL：有 pathExists/readPermission/writePermission 字段（本地存储特有）
      // - WebDAV：有 info 字段但没有 cors/frontendSim
      // - S3：有 cors 或 frontendSim 字段
      this.isOneDrive = !!(
        this.result.info &&
        (this.result.info.driveName || this.result.info.driveType || this.result.info.region) &&
        !this.result.cors &&
        !this.result.frontendSim
      );
      this.isLocal = !!(this.result.pathExists || this.result.readPermission || this.result.writePermission);
      this.isWebDAV = !this.isOneDrive && !this.isLocal && !!(this.result.info && !this.result.cors && !this.result.frontendSim);
    }

    /**
     * 计算测试状态
     */
    calculateStatus() {
      // OneDrive：只检查读写权限
      if (this.isOneDrive) {
        const basicConnectSuccess = this.result.read?.success === true;
        const writeSuccess = this.result.write?.success === true;
        const isFullSuccess = basicConnectSuccess && writeSuccess;
        const isPartialSuccess = basicConnectSuccess && !writeSuccess;
        const isSuccess = basicConnectSuccess;
        return {
          isFullSuccess,
          isPartialSuccess,
          isSuccess,
        };
      }

      // LOCAL：基于 pathExists / isDirectory / readPermission / writePermission 计算
      if (this.isLocal) {
        const pathOk = this.result.pathExists?.success === true;
        const dirOk = this.result.isDirectory?.success === true;
        const readOk = this.result.readPermission?.success === true;
        const writeOk = this.result.writePermission?.success === true;

        const isFullSuccess = pathOk && dirOk && readOk && writeOk;
        const isPartialSuccess = pathOk && dirOk && readOk && !writeOk;
        const isSuccess = isFullSuccess || isPartialSuccess;

        return {
          isFullSuccess,
          isPartialSuccess,
          isSuccess,
        };
      }

      const basicConnectSuccess = this.result.read?.success === true;
      const writeSuccess = this.result.write?.success === true;

      if (this.isWebDAV) {
        // WebDAV测试：只检查读写权限
        const isFullSuccess = basicConnectSuccess && writeSuccess;
        const isPartialSuccess = basicConnectSuccess && !writeSuccess;
        const isSuccess = basicConnectSuccess;

        return {
          isFullSuccess,
          isPartialSuccess,
          isSuccess,
        };
      } else {
        // S3测试：检查读写权限、CORS和前端模拟
        const corsSuccess = this.result.cors?.success === true;
        const frontendSimSuccess = this.result.frontendSim?.success === true;

        const isFullSuccess = basicConnectSuccess && writeSuccess && corsSuccess && frontendSimSuccess;
        const isPartialSuccess = basicConnectSuccess && (!writeSuccess || !corsSuccess || !frontendSimSuccess);
        const isSuccess = basicConnectSuccess;

        return {
          isFullSuccess,
          isPartialSuccess,
          isSuccess,
        };
      }
    }

    /**
     * 生成状态消息
     */
    generateStatusMessage() {
      // 优先使用后端返回的 message，保持与各驱动 tester 的语义一致
      const backendMessage =
        this.raw && typeof this.raw.message === "string" ? this.raw.message.trim() : "";
      if (backendMessage) {
        return backendMessage;
      }

      // 后端未提供 message 时，再根据本地计算状态给一个兜底提示
      const status = this.calculateStatus();
      if (status.isFullSuccess) return "连接测试成功";
      if (status.isPartialSuccess) return "连接测试部分成功";
      return "连接测试失败";
    }

    /**
     * 生成简洁的状态消息
     */
    generateDetailsMessage() {
      const details = [];

      // OneDrive 测试详情
      if (this.isOneDrive) {
        // 读权限
        if (this.result.read?.success) {
          details.push("✓ 读权限正常");
        } else {
          details.push("✗ 读权限失败");
          if (this.result.read?.error) {
            details.push(`  ${this.result.read.error.split("\n")[0]}`);
          }
        }

        // 写权限
        if (this.result.write?.success) {
          details.push("✓ 写权限正常");
        } else {
          details.push("✗ 写权限失败");
          if (this.result.write?.error) {
            details.push(`  ${this.result.write.error.split("\n")[0]}`);
          }
        }

        const d = this.result.info || {};
        if (d.defaultFolder) {
          details.push(`✓ 默认上传目录: ${d.defaultFolder}`);
        }
        if (d.driveName) {
          details.push(`✓ 驱动器: ${d.driveName}`);
        }
        if (d.responseTime) {
          details.push(`✓ 响应时间: ${d.responseTime}`);
        }
        return details.join("\n");
      }

      // LOCAL 测试详情
      if (this.isLocal) {
        // 路径与目录检查
        if (this.result.pathExists?.success) {
          details.push("✓ 根路径存在");
        } else {
          details.push("✗ 根路径不存在");
          if (this.result.pathExists?.error) {
            details.push(`  ${this.result.pathExists.error.split("\n")[0]}`);
          }
        }

        if (this.result.isDirectory?.success) {
          details.push("✓ 根路径是目录");
        } else {
          details.push("✗ 根路径不是目录");
          if (this.result.isDirectory?.error) {
            details.push(`  ${this.result.isDirectory.error.split("\n")[0]}`);
          }
        }

        // 读权限
        if (this.result.readPermission?.success) {
          details.push("✓ 读权限正常");
        } else {
          details.push("✗ 读权限失败");
          if (this.result.readPermission?.error) {
            details.push(`  ${this.result.readPermission.error.split("\n")[0]}`);
          }
        }

        // 写权限
        if (this.result.writePermission?.success) {
          if (this.result.writePermission?.note) {
            details.push(`✓ 写权限正常（${this.result.writePermission.note}）`);
          } else {
            details.push("✓ 写权限正常");
          }
        } else {
          details.push("✗ 写权限失败");
          if (this.result.writePermission?.error) {
            details.push(`  ${this.result.writePermission.error.split("\n")[0]}`);
          }
        }

        return details.join("\n");
      }

      // 读权限状态 - 简洁显示
      if (this.result.read?.success) {
        details.push("✓ 读权限正常");
      } else {
        details.push("✗ 读权限失败");
        if (this.result.read?.error) {
          details.push(`  ${this.result.read.error.split("\n")[0]}`);
        }
      }

      // 写权限状态 - 简洁显示
      if (this.result.write?.success) {
        details.push("✓ 写权限正常");
      } else {
        details.push("✗ 写权限失败");
        if (this.result.write?.error) {
          details.push(`  ${this.result.write.error.split("\n")[0]}`);
        }
      }

      // S3特有的CORS配置状态
      if (!this.isWebDAV && this.result.cors) {
        if (this.result.cors.success) {
          details.push("✓ CORS配置正确");
        } else {
          details.push("✗ CORS配置有问题");
          if (this.result.cors.error) {
            details.push(`  ${this.result.cors.error.split("\n")[0]}`);
          }
        }
      }

      // WebDAV特有的协议信息
      if (this.isWebDAV && this.result.info) {
        if (this.result.info.davCompliance) {
          // davCompliance 可能是对象 {compliance: [...], server: "..."} 或直接是数组
          const dav = this.result.info.davCompliance;
          let davText = "";
          if (dav.compliance && Array.isArray(dav.compliance)) {
            davText = dav.compliance.join(", ");
            if (dav.server) {
              davText += ` (${dav.server})`;
            }
          } else if (Array.isArray(dav)) {
            davText = dav.join(", ");
          } else {
            davText = String(dav);
          }
          details.push(`✓ DAV协议: ${davText}`);
        }
        if (this.result.info.quota && (this.result.info.quota.used !== null || this.result.info.quota.available !== null)) {
          const usedMB = this.result.info.quota.used !== null ? (this.result.info.quota.used / 1024 / 1024).toFixed(2) : "N/A";
          const availableMB = this.result.info.quota.available !== null ? (this.result.info.quota.available / 1024 / 1024).toFixed(2) : "N/A";
          details.push(`✓ 配额: 已用${usedMB}MB / 可用${availableMB}MB`);
        }
      }

      return details.join("\n");
    }
  }

  /**
   * 测试存储配置连接
   */
  const testConnection = async (configId) => {
    try {
      testResults.value[configId] = { loading: true };
      const result = await testStorageConfig(configId);

      // 使用测试结果处理器
      const processor = new TestResultProcessor(result || {});
      const status = processor.calculateStatus();

      testResults.value[configId] = {
        success: status.isFullSuccess,
        partialSuccess: status.isPartialSuccess,
        message: processor.generateStatusMessage(),
        details: processor.generateDetailsMessage(),
        result: result || {},
        loading: false,
      };
    } catch (err) {
      testResults.value[configId] = {
        success: false,
        partialSuccess: false,
        message: "测试连接失败",
        details: err.message || "无法连接到服务器",
        loading: false,
      };
    }
  };

  /**
   * 显示测试结果详情
   */
  const showTestDetailsModal = (configId) => {
    selectedTestResult.value = testResults.value[configId];
    showTestDetails.value = true;
    showDetailedResults.value = true;
  };

  /**
   * 获取提供商图标
   */
  const getProviderIcon = (storageType, providerType = null) => {
    // S3存储类型：根据provider_type细分图标和颜色
    if (storageType === 'S3' && providerType) {
      const s3ProviderIcons = {
        // Cloudflare R2 - cloud
        'Cloudflare R2': {
          path: 'M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z',
          color: 'text-orange-500'
        },
        
        // Backblaze B2 - archive-box
        'Backblaze B2': {
          path: 'M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z',
          color: 'text-red-500'
        },
        
        // AWS S3 - cube
        'AWS S3': {
          path: 'M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9',
          color: 'text-orange-600'
        },
        
        // 阿里云OSS - cloud-arrow-down
        'Aliyun OSS': {
          path: 'M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z',
          color: 'text-blue-500'
        },
        
        // 通用S3/Other - circle-stack
        'Other': {
          path: 'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125',
          color: 'text-gray-500'
        }
      };
      
      // 返回对应提供商的图标，未匹配则使用Other图标
      return s3ProviderIcons[providerType] || s3ProviderIcons['Other'];
    }
    
    // 其他存储类型的基础图标
    const baseIcons = {
      // S3对象存储 - circle-stack
      'S3': {
        path: 'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125',
        color: 'text-primary-500'
      },
      
      // OneDrive云盘 - cloud-arrow-up
      'ONEDRIVE': {
        path: 'M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z',
        color: 'text-blue-600'
      },
      
      // Google Drive - "G" letter
      'GOOGLE_DRIVE': {
        path: 'M12 4C7.58 4 4 7.58 4 12s3.58 8 8 8c4.06 0 7.42-3.03 7.93-6.93H13v-2h9c.05.33.08.66.08 1 0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2c2.76 0 5.26 1.12 7.07 2.93l-1.41 1.41C16.21 4.89 14.21 4 12 4z',
        color: 'text-red-500'
      },
      
      // WebDAV网络驱动器 - server
      'WEBDAV': {
        path: 'M21.75 17.25v-.228a4.5 4.5 0 00-.12-1.03l-2.268-9.64a3.375 3.375 0 00-3.285-2.602H7.923a3.375 3.375 0 00-3.285 2.602l-2.268 9.64a4.5 4.5 0 00-.12 1.03v.228m19.5 0a3 3 0 01-3 3H5.25a3 3 0 01-3-3m19.5 0a3 3 0 00-3-3H5.25a3 3 0 00-3 3m16.5 0h.008v.008h-.008v-.008zm-3 0h.008v.008h-.008v-.008z',
        color: 'text-purple-500'
      },
      
      // 本地存储 - folder
      'LOCAL': {
        path: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z',
        color: 'text-yellow-500'
      },
      
      // GitHub Releases - tag (版本标签)
      'GITHUB_RELEASES': {
        path: 'M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z',
        color: 'text-emerald-500'
      }
    };
    
    // 返回对应的图标对象，如果未找到则使用LOCAL图标作为默认
    return baseIcons[storageType] || baseIcons['LOCAL'];
  };

  return {
    // 继承基础功能
    ...base,

    // 重写分页选项
    pageSizeOptions,

    // 存储配置状态
    storageConfigs,
    filteredConfigs,
    storageTypeFilter,
    availableStorageTypes,
    currentConfig,
    showAddForm,
    showEditForm,
    testResults,
    showTestDetails,
    selectedTestResult,
    showDetailedResults,

    // 存储配置管理方法
    loadStorageConfigs,
    handlePageChange,
    handleLimitChange,
    handleDeleteConfig,
    editConfig,
    addNewConfig,
    handleFormSuccess,
    handleSetDefaultConfig,

    // 测试功能方法
    testConnection,
    showTestDetailsModal,

    // 工具方法
    getProviderIcon,
    normalizeStorageTypeValue,
    STORAGE_TYPE_UNKNOWN,
  };
}
