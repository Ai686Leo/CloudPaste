export default {
  dashboard: {
    systemOverview: "System Overview",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    refreshStorage: "Refresh Storage",
    refreshingStorage: "Refreshing...",
    refreshStorageTooltip: "Recalculate usage snapshots for all storage configurations",
    fetchError: "Failed to fetch data",
    loading: "Loading...",
    error: "Loading failed",

    // Statistics cards
    totalPastes: "Text Shares",
    totalFiles: "File Uploads",
    totalApiKeys: "API Keys",
    totalStorageConfigs: "Storage Configs",
    totalStorageUsed: "Storage Used",

    // Cache monitoring
    cacheMonitoring: "Cache Monitoring",
    directoryCache: "Directory Cache",
    urlCache: "URL Cache",
    searchCache: "Search Cache",
    hitRate: "Hit Rate",
    cacheItems: "Cache Items",
    cacheUnavailable: "Cache data unavailable",
    clearAllCache: "Clear All Cache",

    // Storage related
    storageUsage: "Storage Usage (Used/Limit)",
    storageConfigs: "Storage Configurations",
    noStorageConfigs: "No storage configurations",
    allStorages: "All Storages",
    selectStorage: "Select Storage",
    usagePercent: "Usage",
    availableStorage: "Available Storage",
    usedStorage: "Used Storage",
    remaining: "Remaining",
    total: "Total",
    used: "Used",
    available: "Available",
    unlimited: "Unlimited",
    configs: " configs",
    exceeded: "Exceeded",

    // Storage details
    showDetails: "Show Details",
    hideDetails: "Hide Details",
    providerQuota: "Provider Usage (Total/Used)",
    quotaSnapshot: "Quota Snapshot",
    snapshotInfo: "Snapshot Info",
    snapshotTime: "Last snapshot",
    latestSnapshot: "Latest snapshot",
    clickToViewList: "Click to view list",
    totalItems: "{count} items",

    // Source labels
    sourceLabels: {
      provider: "Provider",
      localFs: "Disk Scan",
      vfsNodes: "VFS Nodes",
      fsIndex: "File Index",
      unknown: "Unknown",
    },

    // Source descriptions
    sourceDescriptions: {
      provider: "Data from storage driver's native quota API",
      localFs: "Calculated by scanning local disk directory",
      vfsNodes: "Based on virtual file system node statistics",
      fsIndex: "Based on file index records",
    },

    storageUnits: {
      bytes: "Bytes",
      kb: "KB",
      mb: "MB",
      gb: "GB",
      tb: "TB",
    },

    // Chart related
    chartTitle: "Activity Statistics (Last 7 Days)",
    chartType: {
      bar: "Bar Chart",
      line: "Line Chart",
      toggle: "Toggle Chart Type",
    },
    weeklyStats: "Weekly Stats",
    weeklyActivity: "Weekly Activity",
    weeklyPastes: "Weekly Texts",
    weeklyFiles: "Weekly Files",
    mostActiveDate: "Most Active Date",
    highestDailyActivity: "Highest Daily Activity",
    activityOverview: "Activity Overview",
    items: "items",
    switchToLineChart: "Switch to Line Chart",
    switchToBarChart: "Switch to Bar Chart",
    dailyActivity: "Daily Activity",
    noData: "No data available",

    // Time related
    lastUpdated: "Last Updated",
    timeAgo: "{time} ago",
    justNow: "Just now",

    // Storage types
    storageTypeDistribution: "Storage Type Distribution",

    // Status information
    status: {
      healthy: "Healthy",
      warning: "Warning",
      error: "Error",
      offline: "Offline",
    },

    // Action buttons
    actions: {
      viewDetails: "View Details",
      manage: "Manage",
      configure: "Configure",
      export: "Export Data",
    },

    // System information
    systemVersion: "System Version",
    serverEnvironment: "Server Environment",
    dataStorage: "Data Storage",

    // Tips and messages
    tips: {
      noApiKeys: "No API keys created yet",
      noStorageConfigs: "No storage configuration yet",
      noActivity: "No recent activity",
      lowStorage: "Low storage space",
    },
  },
};
