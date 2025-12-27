export default {
  tasks: {
    title: '任务与操作',
    description: '查看和管理系统中的所有后台任务',
    loading: '加载中...',

    viewMode: {
      table: '表格视图',
      card: '卡片视图',
    },

    filters: {
      searchPlaceholder: '搜索任务名称、ID或路径...',
      allStatuses: '全部状态',
      allTypes: '全部类型',
      allCreators: '全部创建者',
      allTriggers: '全部触发方式',
    },

    list: {
      title: '任务列表',
    },

    table: {
      name: '名称',
      creator: '创建者',
      status: '状态',
      progress: '统计/进度',
      actions: '操作',
      details: '任务详情',
      createdAt: '创建时间',
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
      viewDetails: '查看详情',
      deleteTask: '删除任务',
      retryFile: '重试此文件',
      retryAllFailed: '重试所有失败文件',
      retrySelected: '重试选中文件',
    },

    labels: {
      creator: '创建者',
      created: '创建时间',
      progress: '进度',
    },

    creator: {
      admin: '管理员',
      keyPrefix: '密钥: {key}',
    },

    time: {
      created: '创建时间',
    },

    details: {
      trigger: '来源',
      triggerRef: '来源引用',
      fileList: '文件列表',
      itemList: '执行明细',
      sourcePath: '源路径',
      targetPath: '目标路径',
      payload: '任务参数',
      errorInfo: '错误信息',
      noFiles: '暂无文件信息',
      none: '无',
    },

    timeline: {
      start: '开始',
      finish: '完成',
      duration: '耗时',
    },

    progress: {
      items: '{count} 项',
      empty: '-',
    },

    indexDetails: {
      rebuildTitle: '挂载点索引重建',
      applyDirtyTitle: '增量索引更新',
      mountUnit: '挂载点',
      queueUnit: '队列',
      queueProcessed: '队列处理',
      updated: '更新',
      deleted: '删除',
      skipped: '跳过',
      duration: '耗时',
      discovered: '发现文件/目录',
      upserted: '写入索引',
      path: '路径',
      realtime: '实时进度',
      scannedDirs: '已扫描目录',
      discoveredShort: '已发现',
      pending: '待写入',
      noMounts: '暂无挂载点信息',
      noRecords: '暂无处理记录',
      unknownMount: '未知挂载点',
      errors: {
        indexNotReady: '索引未就绪',
        mountNotFound: '挂载点不存在',
        permissionDenied: '权限不足',
      },
    },

    trigger: {
      manual: '手动',
      scheduled: '定时',
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

    confirmCancel: {
      title: '确认取消',
      single: '确定要取消任务 "{name}" 吗？取消后会尽快停止后续处理。',
      batch: '确定要取消选中的 {count} 个任务吗？取消后会尽快停止后续处理。',
    },

    empty: {
      title: '暂无任务',
      description: '当前没有任何任务记录',
      tableNoData: '暂无任务',
    },

    taskName: {
      single: '{file}',
      batch: '{file} (+{count})',
      default: '任务 {id}',
    },

    taskType: {
      copy: '复制',
      fs_index_rebuild: '索引重建',
      fs_index_apply_dirty: '索引增量应用',
      unknown: '未知任务',
      unknownWithType: '未知任务（{type}）',
    },

    // 阶段类任务的阶段名称
    stages: {
      scanning: '扫描文件',
      indexing: '建立索引',
      finalizing: '完成收尾',
      loading: '加载变更',
      applying: '应用变更',
      committing: '提交更新',
      pending: '等待中',
      running: '执行中',
      completed: '已完成',
      failed: '失败',
    },

    // 统计信息
    stats: {
      total: '当前页合计',
      running: '当前页运行中',
      completed: '当前页已完成',
      success: '成功',
      failed: '当前页失败',
      skipped: '跳过',
    },

    unknownFile: '未知文件',
  },
};
