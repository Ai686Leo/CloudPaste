export default {
  fsIndex: {
    title: "文件系统索引管理",
    description: "管理文件系统搜索索引,支持全量重建和增量更新",

    // KPI 指标
    kpi: {
      health: "整体健康度",
      running: "运行中",
      pending: "待处理",
      lastUpdate: "最后更新",
      activeTasks: "个活跃任务",
      changes: "条变更",
      never: "从未",
      justNow: "刚刚",
      minutesAgo: "分钟前",
      hoursAgo: "小时前",
      daysAgo: "天前",
    },

    viewMode: {
      table: "表格视图",
      card: "卡片视图",
    },

    // 索引状态
    status: {
      notReady: "未就绪",
      indexing: "索引中",
      ready: "就绪",
      error: "错误",
      unknown: "未知",
    },

    // 建议操作
    action: {
      none: "无需操作",
      wait: "请等待",
      rebuild: "建议重建",
      applyDirty: "建议增量更新",
      unknown: "未知",
    },

    // 表格列
    table: {
      title: "挂载点索引状态",
      mountName: "挂载点",
      storageType: "存储类型",
      status: "索引状态",
      dirtyCount: "待处理变更",
      lastIndexed: "最后索引时间",
      actions: "操作",
    },

    // 操作按钮
    actions: {
      title: "快速操作",
      refresh: "刷新",
      rebuildAll: "全量重建",
      applyDirtyAll: "增量更新",
      clearAll: "清空索引",
      stop: "停止",
      rebuild: "重建",
      applyDirty: "增量更新",
      clear: "清空",
    },

    // 操作面板描述
    actionPanel: {
      rebuildDesc: "扫描所有文件，从头重建搜索索引",
      applyDirtyDesc: "处理待处理的变更，增量更新索引",
      clearDesc: "删除所有索引数据，重建前搜索将不可用",
    },

    // 运行中任务区域
    runningJobs: {
      title: "运行中的任务",
      empty: "当前没有运行中的索引任务",
      processed: "已处理",
      mountProgress: "完成挂载点",
      scannedDirs: "已扫描目录",
      discoveredCount: "已发现条目",
      upsertedCount: "已更新条目",
      duration: "耗时",
      lastUpdate: "最后更新",
      processing: "处理中",
    },

    // 任务类型
    taskType: {
      fs_index_rebuild: "索引重建",
      fs_index_apply_dirty: "增量更新",
    },

    // 确认对话框
    confirm: {
      rebuildTitle: "确认重建索引",
      rebuildAll: "确定要重建所有挂载点的索引吗？这可能需要较长时间。",
      rebuildSelected: "确定要重建选中的 {count} 个挂载点的索引吗？",
      applyDirtyTitle: "确认增量更新",
      applyDirtyAll: "确定要对所有挂载点执行增量更新吗？",
      applyDirtySelected: "确定要对选中的 {count} 个挂载点执行增量更新吗？",
      clearTitle: "确认清空索引",
      clearAll: "确定要清空所有索引数据吗？清空后需要重新重建索引才能使用搜索功能。",
      clearSelected: "确定要清空选中的 {count} 个挂载点的索引吗？",
      stopTitle: "确认停止任务",
      stopJob: "确定要停止任务 {jobId} 吗？",
    },

    // 成功消息
    success: {
      rebuildStarted: "索引重建任务已创建",
      applyDirtyStarted: "增量更新任务已创建",
      stopped: "任务已停止",
      cleared: "索引已清空",
    },

    // 错误消息
    error: {
      loadFailed: "加载索引状态失败",
      rebuildFailed: "创建重建任务失败",
      applyDirtyFailed: "创建增量更新任务失败",
      stopFailed: "停止任务失败",
      clearFailed: "清空索引失败",
    },

    // 空状态
    empty: {
      title: "暂无挂载点",
      description: "当前没有配置任何挂载点",
    },

    // 卡片视图
    card: {
      neverIndexed: "从未索引",
    },

    // 状态图表
    chart: {
      title: "状态分布",
      total: "总计",
    },

    // 筛选
    filter: {
      all: "全部",
      placeholder: "搜索挂载点...",
      noResults: "没有找到匹配的挂载点",
    },

    // 高级选项
    advancedOptions: {
      title: "高级选项",
      description: "配置重建和更新参数",
      rebuildOptions: "重建选项",
      applyDirtyOptions: "增量更新选项",
      batchSize: "批量大小",
      maxDepth: "最大深度",
      maxItems: "最大条目数",
      forceRefresh: "强制刷新（跳过缓存）",
      rebuildSubtree: "递归重建目录子树",
      unlimited: "不限制",
      resetDefaults: "重置为默认值",
    },
  },
};
