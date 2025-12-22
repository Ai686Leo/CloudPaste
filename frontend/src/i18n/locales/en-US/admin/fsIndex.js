export default {
  fsIndex: {
    title: "File System Index Management",
    description: "Manage file system search indexes with full rebuild and incremental update support",

    // KPI Metrics
    kpi: {
      health: "Overall Health",
      running: "Running",
      pending: "Pending",
      lastUpdate: "Last Update",
      activeTasks: "active tasks",
      changes: "changes",
      never: "Never",
      justNow: "Just now",
      minutesAgo: "m ago",
      hoursAgo: "h ago",
      daysAgo: "d ago",
    },

    viewMode: {
      table: "Table View",
      card: "Card View",
    },

    // Index status
    status: {
      notReady: "Not Ready",
      indexing: "Indexing",
      ready: "Ready",
      error: "Error",
      unknown: "Unknown",
    },

    // Recommended actions
    action: {
      none: "No Action Needed",
      wait: "Please Wait",
      rebuild: "Rebuild Recommended",
      applyDirty: "Incremental Update Recommended",
      unknown: "Unknown",
    },

    // Table columns
    table: {
      title: "Mount Point Index Status",
      mountName: "Mount Point",
      storageType: "Storage Type",
      status: "Index Status",
      dirtyCount: "Pending Changes",
      lastIndexed: "Last Indexed",
      actions: "Actions",
    },

    // Action buttons
    actions: {
      title: "Quick Actions",
      refresh: "Refresh",
      rebuildAll: "Rebuild All",
      applyDirtyAll: "Apply Updates",
      clearAll: "Clear Index",
      stop: "Stop",
      rebuild: "Rebuild",
      applyDirty: "Update",
      clear: "Clear",
    },

    // Action panel descriptions
    actionPanel: {
      rebuildDesc: "Scan all files and rebuild the search index from scratch",
      applyDirtyDesc: "Process pending changes and update the index incrementally",
      clearDesc: "Remove all index data, search will be unavailable until rebuilt",
    },

    // Running jobs section
    runningJobs: {
      title: "Running Jobs",
      empty: "No running index jobs",
      processed: "Processed",
      mountProgress: "Mounts Done",
      scannedDirs: "Scanned Directories",
      discoveredCount: "Discovered Items",
      upsertedCount: "Updated Entries",
      duration: "Duration",
      lastUpdate: "Last Update",
      processing: "Processing",
    },

    // Task types
    taskType: {
      fs_index_rebuild: "Index Rebuild",
      fs_index_apply_dirty: "Incremental Update",
    },

    // Confirmation dialogs
    confirm: {
      rebuildTitle: "Confirm Rebuild",
      rebuildAll: "Are you sure you want to rebuild indexes for all mount points? This may take a while.",
      rebuildSelected: "Are you sure you want to rebuild indexes for {count} selected mount point(s)?",
      applyDirtyTitle: "Confirm Incremental Update",
      applyDirtyAll: "Are you sure you want to apply incremental updates to all mount points?",
      applyDirtySelected: "Are you sure you want to apply incremental updates to {count} selected mount point(s)?",
      clearTitle: "Confirm Clear Index",
      clearAll: "Are you sure you want to clear all index data? You will need to rebuild indexes to use search.",
      clearSelected: "Are you sure you want to clear indexes for {count} selected mount point(s)?",
      stopTitle: "Confirm Stop Job",
      stopJob: "Are you sure you want to stop job {jobId}?",
    },

    // Success messages
    success: {
      rebuildStarted: "Index rebuild job created",
      applyDirtyStarted: "Incremental update job created",
      stopped: "Job stopped",
      cleared: "Index cleared",
    },

    // Error messages
    error: {
      loadFailed: "Failed to load index status",
      rebuildFailed: "Failed to create rebuild job",
      applyDirtyFailed: "Failed to create incremental update job",
      stopFailed: "Failed to stop job",
      clearFailed: "Failed to clear index",
    },

    // Empty state
    empty: {
      title: "No Mount Points",
      description: "No mount points configured",
    },

    // Card view
    card: {
      neverIndexed: "Never indexed",
    },

    // Status chart
    chart: {
      title: "Status Distribution",
      total: "Total",
    },

    // Filter
    filter: {
      all: "All",
      placeholder: "Search mount points...",
      noResults: "No matching mount points found",
    },

    // Advanced Options
    advancedOptions: {
      title: "Advanced Options",
      description: "Configure rebuild and update parameters",
      rebuildOptions: "Rebuild Options",
      applyDirtyOptions: "Incremental Update Options",
      batchSize: "Batch Size",
      maxDepth: "Max Depth",
      maxItems: "Max Items",
      forceRefresh: "Force refresh (skip cache)",
      rebuildSubtree: "Recursively rebuild directory subtree",
      unlimited: "Unlimited",
      resetDefaults: "Reset to Defaults",
    },
  },
};
