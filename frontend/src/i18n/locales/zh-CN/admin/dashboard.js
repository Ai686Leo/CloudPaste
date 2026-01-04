export default {
  dashboard: {
    systemOverview: "系统概览",
    refresh: "刷新",
    refreshing: "刷新中...",
    refreshStorage: "刷新存储",
    refreshingStorage: "刷新中...",
    refreshStorageTooltip: "重新计算所有存储配置的用量快照",
    fetchError: "获取数据失败",
    loading: "加载中...",
    error: "加载失败",

    // 统计卡片
    totalPastes: "文本分享",
    totalFiles: "文件上传",
    totalApiKeys: "API密钥",
    totalStorageConfigs: "存储配置",
    totalStorageUsed: "存储使用",

    // 缓存监控
    cacheMonitoring: "缓存监控",
    directoryCache: "目录缓存",
    urlCache: "URL缓存",
    searchCache: "搜索缓存",
    hitRate: "命中率",
    cacheItems: "缓存项",
    cacheUnavailable: "缓存数据不可用",
    clearAllCache: "清理所有缓存",

    // 存储相关
    storageUsage: "存储使用情况(已用/限额)",
    storageConfigs: "存储配置",
    noStorageConfigs: "暂无存储配置",
    allStorages: "所有存储",
    selectStorage: "选择存储",
    usagePercent: "使用率",
    availableStorage: "可用存储",
    usedStorage: "已用存储",
    remaining: "剩余",
    total: "总容量",
    used: "已使用",
    available: "可用",
    unlimited: "不限额",
    configs: "个配置",
    exceeded: "已超限",

    // 存储详情
    showDetails: "查看详情",
    hideDetails: "隐藏详情",
    providerQuota: "上游用量（总/已用）",
    quotaSnapshot: "配额快照",
    snapshotInfo: "快照信息",
    snapshotTime: "上次快照",
    latestSnapshot: "最新快照",
    clickToViewList: "点击查看列表",
    totalItems: "共 {count} 个",

    // 数据来源标签
    sourceLabels: {
      provider: "上游数据",
      localFs: "磁盘扫描",
      vfsNodes: "虚拟文件",
      fsIndex: "文件索引",
      unknown: "未知来源",
    },

    // 数据来源描述
    sourceDescriptions: {
      provider: "数据来自存储驱动的原生配额接口",
      localFs: "通过扫描本地磁盘目录计算",
      vfsNodes: "基于虚拟文件系统节点统计",
      fsIndex: "基于文件索引记录统计",
    },

    storageUnits: {
      bytes: "字节",
      kb: "KB",
      mb: "MB",
      gb: "GB",
      tb: "TB",
    },

    // 图表相关
    chartTitle: "过去7天活动统计",
    chartType: {
      bar: "柱状图",
      line: "折线图",
      toggle: "切换图表类型",
    },
    weeklyStats: "本周统计",
    weeklyActivity: "本周活动",
    weeklyPastes: "本周文本",
    weeklyFiles: "本周文件",
    mostActiveDate: "最活跃日期",
    highestDailyActivity: "最高日活跃",
    activityOverview: "活动概览",
    items: "项",
    switchToLineChart: "切换到折线图",
    switchToBarChart: "切换到柱状图",
    dailyActivity: "每日活动",
    noData: "暂无数据",

    // 时间相关
    lastUpdated: "最后更新",
    timeAgo: "{time}前",
    justNow: "刚刚",

    // 存储类型
    storageTypeDistribution: "存储类型分布",

    // 状态信息
    status: {
      healthy: "正常",
      warning: "警告",
      error: "错误",
      offline: "离线",
    },

    // 操作按钮
    actions: {
      viewDetails: "查看详情",
      manage: "管理",
      configure: "配置",
      export: "导出数据",
    },

    // 系统信息
    systemVersion: "系统版本",
    serverEnvironment: "服务器环境",
    dataStorage: "数据存储",

    // 提示信息
    tips: {
      noApiKeys: "还没有创建API密钥",
      noStorageConfigs: "还没有配置存储",
      noActivity: "最近没有活动",
      lowStorage: "存储空间不足",
    },
  },
};
