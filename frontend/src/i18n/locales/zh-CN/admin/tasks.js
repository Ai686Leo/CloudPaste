export default {
  tasks: {
    title: '任务管理',
    description: '查看和管理系统中的所有后台任务',
    loading: '加载中...',

    viewMode: {
      table: '表格视图',
      card: '卡片视图',
    },

    filters: {
      searchPlaceholder: '搜索任务名称、ID或路径...',
      allStatuses: '全部状态',
    },

    table: {
      name: '名称',
      creator: '创建者',
      status: '状态',
      progress: '进度',
      actions: '操作',
    },

    status: {
      pending: '等待中',
      running: '执行中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
      partial: '部分成功',
    },

    actions: {
      refresh: '刷新',
      cancel: '取消任务',
      expandAll: '展开全部',
      collapseAll: '收起全部',
      delete: '删除任务',
      deleteShort: '删除',
      retryFile: '重试此文件',
      retryAllFailed: '重试所有失败文件',
      retrySelected: '重试选中文件',
    },

    time: {
      created: '创建时间',
    },

    details: {
      fileList: '文件列表',
      sourcePath: '源路径',
      targetPath: '目标路径',
      errorInfo: '错误信息',
      none: '无',
    },

    fileStatus: {
      success: '完成',
      processing: '传输中',
      retrying: '重试中',
      failed: '失败',
      skipped: '跳过',
      pending: '等待',
    },

    retry: {
      retrying: '重试中',
      retryCount: '已重试 {count} 次',
      retrySuccess: '重试成功',
      retryFailed: '重试失败',
      retryExhausted: '已达最大重试次数',
      withRetry: '(重试 {count} 次)',
    },

    error: {
      loadFailed: '加载任务列表失败',
      cancelFailed: '取消任务失败',
      deleteFailed: '删除任务失败',
      deleteBatchFailed: '批量删除失败，没有任务被删除',
      taskNotFound: '任务不存在',
      cannotDeleteRunning: '无法删除运行中的任务，请先取消任务',
      cannotDeleteRunningBatch: '有 {count} 个任务正在运行，无法删除。请先取消这些任务。',
      noTasksToDelete: '选中的任务均无法删除',
      retryFailed: '重试失败',
      noFailedFiles: '没有失败的文件可以重试',
      cannotRetryRunning: '无法重试运行中的任务',
    },

    success: {
      deleted: '任务已删除',
      deletedBatch: '成功删除 {count} 个任务',
      deletedPartial: '删除完成，成功 {success} 个，失败 {failed} 个',
      retryStarted: '重试任务已创建',
      retryStartedWithCount: '已创建包含 {count} 个失败文件的重试任务',
    },

    confirmDelete: {
      title: '确认删除',
      single: '确定要删除任务 "{name}" 吗？此操作不可恢复。',
      batch: '确定要删除选中的 {count} 个任务吗？此操作不可恢复。',
    },

    empty: {
      title: '暂无任务',
      description: '当前没有任何任务记录',
    },

    taskName: {
      single: '{file}',
      batch: '{file} (+{count})',
      default: '任务 {id}',
    },

    unknownFile: '未知文件',
  },
};
