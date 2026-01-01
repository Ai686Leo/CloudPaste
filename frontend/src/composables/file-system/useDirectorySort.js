/**
 * 目录排序管理 Composable
 * 处理文件列表的排序逻辑和状态管理
 * 
 * 排序设置现在由 useExplorerSettings 统一管理
 */

import { computed } from "vue";
import { useExplorerSettings } from "@/composables/useExplorerSettings";
import { createLogger } from "@/utils/logger.js";

export function useDirectorySort() {
  const log = createLogger("DirectorySort");
  // 获取全局设置
  const explorerSettings = useExplorerSettings();

  // ===== 排序状态（从 explorerSettings 获取）=====
  const sortField = computed(() => explorerSettings.settings.sortBy);
  const sortOrder = computed(() => explorerSettings.settings.sortOrder);
  const foldersFirst = computed(() => explorerSettings.settings.foldersFirst);

  // ===== 计算属性 =====

  /**
   * 当前排序状态的描述
   */
  const sortDescription = computed(() => {
    const fieldNames = {
      name: "名称",
      size: "大小", 
      modified: "修改时间",
      type: "类型"
    };
    
    const orderNames = {
      asc: "升序",
      desc: "降序"
    };
    
    return `按${fieldNames[sortField.value]}${orderNames[sortOrder.value]}`;
  });

  /**
   * 是否为默认排序
   */
  const isDefaultSort = computed(() => 
    sortField.value === 'name' && sortOrder.value === 'asc' && foldersFirst.value
  );

  /**
   * 是否为自定义排序
   */
  const isCustomSort = computed(() => !isDefaultSort.value);

  // ===== 持久化方法 =====

  /**
   * 初始化排序状态（从 useExplorerSettings 加载）
   */
  const initializeSortState = () => {
    // 排序状态已由 useExplorerSettings.loadSettings() 自动加载
    log.debug("排序状态已初始化:", {
      field: sortField.value,
      order: sortOrder.value,
      foldersFirst: foldersFirst.value,
    });
  };

  /**
   * 重置排序状态为默认值
   */
  const resetSortState = () => {
    explorerSettings.updateSetting('sortBy', 'name');
    explorerSettings.updateSetting('sortOrder', 'asc');
    explorerSettings.updateSetting('foldersFirst', true);
  };

  // ===== 排序控制方法 =====

  /**
   * 点击表头排序
   * @param {string} field - 排序字段
   */
  const handleSort = (field) => {
    if (!["name", "size", "modified", "type"].includes(field)) {
      log.warn("无效的排序字段:", field);
      return;
    }

    if (sortField.value === field) {
      // 同一字段，切换排序顺序
      explorerSettings.toggleSortOrder();
    } else {
      // 不同字段，设置为该字段升序
      explorerSettings.updateSetting('sortBy', field);
      explorerSettings.updateSetting('sortOrder', 'asc');
    }
  };

  /**
   * 设置特定的排序状态
   * @param {string} field - 排序字段
   * @param {string} order - 排序顺序
   */
  const setSortState = (field, order) => {
    if (!["name", "size", "modified", "type"].includes(field)) {
      log.warn("无效的排序字段:", field);
      return;
    }

    if (!["asc", "desc"].includes(order)) {
      log.warn("无效的排序顺序:", order);
      return;
    }

    explorerSettings.updateSetting('sortBy', field);
    explorerSettings.updateSetting('sortOrder', order);
  };

  // ===== UI辅助方法 =====

  /**
   * 获取排序图标
   * @param {string} field - 字段名
   * @returns {string} 排序图标
   */
  const getSortIcon = (field) => {
    if (sortField.value !== field) {
      return ""; // 非当前排序字段不显示图标
    }
    return sortOrder.value === "asc" ? "↑" : "↓";
  };

  /**
   * 获取排序图标类名（用于CSS图标）
   * @param {string} field - 字段名
   * @returns {string} CSS类名
   */
  const getSortIconClass = (field) => {
    if (sortField.value !== field) {
      return "";
    }
    return sortOrder.value === "asc" ? "sort-asc" : "sort-desc";
  };

  /**
   * 检查字段是否为当前排序字段
   * @param {string} field - 字段名
   * @returns {boolean} 是否为当前排序字段
   */
  const isCurrentSortField = (field) => {
    return sortField.value === field;
  };

  /**
   * 获取字段的排序状态
   * @param {string} field - 字段名
   * @returns {Object} 排序状态信息
   */
  const getFieldSortState = (field) => {
    return {
      isActive: sortField.value === field,
      order: sortField.value === field ? sortOrder.value : null,
      icon: getSortIcon(field),
      iconClass: getSortIconClass(field),
    };
  };

  // ===== 排序算法 =====

  /**
   * 对项目列表进行排序
   * @param {Array} items - 原始项目列表
   * @returns {Array} 排序后的项目列表
   */
  const sortItems = (items) => {
    if (!items || !Array.isArray(items)) {
      return [];
    }

    let sortedItems = [...items];

    return sortedItems.sort((a, b) => {
      // 文件夹优先（如果启用）
      if (foldersFirst.value) {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
      }

      let comparison = 0;

      switch (sortField.value) {
        case "name":
          comparison = a.name.localeCompare(b.name, undefined, { 
            numeric: true, 
            sensitivity: "base" 
          });
          break;
        case "size":
          // 虚拟目录的大小视为0
          const aSize = a.isDirectory && a.isVirtual ? 0 : a.size || 0;
          const bSize = b.isDirectory && b.isVirtual ? 0 : b.size || 0;
          comparison = aSize - bSize;
          break;
        case "modified":
          // 虚拟目录没有修改时间，视为最早
          const aTime = a.isDirectory && a.isVirtual ? 0 : new Date(a.modified || 0).getTime();
          const bTime = b.isDirectory && b.isVirtual ? 0 : new Date(b.modified || 0).getTime();
          comparison = aTime - bTime;
          break;
        case "type":
          // 按文件扩展名排序
          const aExt = a.isDirectory ? '' : (a.name.split('.').pop() || '').toLowerCase();
          const bExt = b.isDirectory ? '' : (b.name.split('.').pop() || '').toLowerCase();
          comparison = aExt.localeCompare(bExt);
          break;
        default:
          comparison = a.name.localeCompare(b.name, undefined, { 
            numeric: true, 
            sensitivity: "base" 
          });
      }

      return sortOrder.value === "asc" ? comparison : -comparison;
    });
  };

  /**
   * 创建排序后的计算属性
   * @param {Ref} itemsRef - 项目列表的响应式引用
   * @returns {ComputedRef} 排序后的项目列表
   */
  const createSortedItems = (itemsRef) => {
    return computed(() => sortItems(itemsRef.value));
  };

  /**
   * 获取排序配置对象（用于API调用或其他用途）
   * @returns {Object} 排序配置
   */
  const getSortConfig = () => {
    return {
      field: sortField.value,
      order: sortOrder.value,
      foldersFirst: foldersFirst.value,
      isDefault: isDefaultSort.value,
      description: sortDescription.value,
    };
  };

  return {
    // 状态
    sortField,
    sortOrder,
    foldersFirst,

    // 计算属性
    sortDescription,
    isDefaultSort,
    isCustomSort,

    // 持久化方法
    initializeSortState,
    resetSortState,

    // 排序控制方法
    handleSort,
    setSortState,

    // UI辅助方法
    getSortIcon,
    getSortIconClass,
    isCurrentSortField,
    getFieldSortState,

    // 排序算法
    sortItems,
    createSortedItems,

    // 工具方法
    getSortConfig,
  };
}
