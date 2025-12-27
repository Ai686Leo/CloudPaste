export default {
  tasks: {
    title: 'Tasks & Operations',
    description: 'View and manage all background tasks in the system',
    loading: 'Loading...',

    viewMode: {
      table: 'Table View',
      card: 'Card View',
    },

    filters: {
      searchPlaceholder: 'Search task name, ID or path...',
      allStatuses: 'All Statuses',
      allTypes: 'All Types',
      allCreators: 'All Creators',
      allTriggers: 'All Triggers',
    },

    list: {
      title: 'Task List',
    },

    table: {
      name: 'Name',
      creator: 'Creator',
      status: 'Status',
      progress: 'Stats / Progress',
      actions: 'Actions',
      details: 'Job Details',
      createdAt: 'Created At',
    },

    status: {
      pending: 'Pending',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
      partial: 'Partial Success',
    },

    actions: {
      refresh: 'Refresh',
      cancel: 'Cancel Task',
      expandAll: 'Expand All',
      collapseAll: 'Collapse All',
      delete: 'Delete Task',
      deleteShort: 'Delete',
      viewDetails: 'View Details',
      deleteTask: 'Delete Task',
      retryFile: 'Retry this file',
      retryAllFailed: 'Retry all failed files',
      retrySelected: 'Retry selected files',
    },

    labels: {
      creator: 'Creator',
      created: 'Created',
      progress: 'Progress',
    },

    creator: {
      admin: 'Admin',
      keyPrefix: 'Key: {key}',
    },

    time: {
      created: 'Created',
    },

    details: {
      trigger: 'Source',
      triggerRef: 'Source Ref',
      fileList: 'File List',
      itemList: 'Details',
      sourcePath: 'Source Path',
      targetPath: 'Target Path',
      payload: 'Payload',
      errorInfo: 'Error Info',
      noFiles: 'No file info',
      none: 'None',
    },

    timeline: {
      start: 'Start',
      finish: 'Finish',
      duration: 'Duration',
    },

    progress: {
      items: '{count} items',
      empty: '-',
    },

    indexDetails: {
      rebuildTitle: 'Index Rebuild',
      applyDirtyTitle: 'Apply Index Dirty',
      mountUnit: 'mounts',
      queueUnit: 'queue',
      queueProcessed: 'Queue Processed',
      updated: 'Updated',
      deleted: 'Deleted',
      skipped: 'Skipped',
      duration: 'Duration',
      discovered: 'Discovered Files/Dirs',
      upserted: 'Indexed',
      path: 'Path',
      realtime: 'Realtime Progress',
      scannedDirs: 'Scanned Dirs',
      discoveredShort: 'Discovered',
      pending: 'Pending Write',
      noMounts: 'No mount info',
      noRecords: 'No records',
      unknownMount: 'Unknown Mount',
      errors: {
        indexNotReady: 'Index not ready',
        mountNotFound: 'Mount not found',
        permissionDenied: 'Permission denied',
      },
    },

    trigger: {
      manual: 'Manual',
      scheduled: 'Scheduled',
    },

    fileStatus: {
      success: 'Done',
      processing: 'Transferring',
      retrying: 'Retrying',
      failed: 'Failed',
      skipped: 'Skipped',
      pending: 'Pending',
    },

    retry: {
      retrying: 'Retrying',
      retryCount: 'Retried {count} times',
      retrySuccess: 'Retry succeeded',
      retryFailed: 'Retry failed',
      retryExhausted: 'Max retries reached',
      withRetry: '(retried {count} times)',
    },

    error: {
      loadFailed: 'Failed to load task list',
      cancelFailed: 'Failed to cancel task',
      deleteFailed: 'Failed to delete task',
      deleteBatchFailed: 'Batch deletion failed, no tasks were deleted',
      taskNotFound: 'Task not found',
      cannotDeleteRunning: 'Cannot delete running task, please cancel it first',
      cannotDeleteRunningBatch: '{count} tasks are running and cannot be deleted. Please cancel them first.',
      noTasksToDelete: 'None of the selected tasks can be deleted',
      retryFailed: 'Failed to retry',
      noFailedFiles: 'No failed files to retry',
      cannotRetryRunning: 'Cannot retry running task',
    },

    success: {
      deleted: 'Task deleted',
      deletedBatch: 'Successfully deleted {count} tasks',
      deletedPartial: 'Deletion completed: {success} succeeded, {failed} failed',
      retryStarted: 'Retry task created successfully',
      retryStartedWithCount: 'Created retry task with {count} failed files',
    },

    confirmDelete: {
      title: 'Confirm Delete',
      single: 'Are you sure you want to delete task "{name}"? This action cannot be undone.',
      batch: 'Are you sure you want to delete {count} selected tasks? This action cannot be undone.',
    },

    confirmCancel: {
      title: 'Confirm Cancel',
      single: 'Are you sure you want to cancel task "{name}"? It will stop as soon as possible.',
      batch: 'Are you sure you want to cancel {count} selected tasks? They will stop as soon as possible.',
    },

    empty: {
      title: 'No Tasks',
      description: 'There are no task records currently',
      tableNoData: 'No tasks found',
    },

    taskName: {
      single: '{file}',
      batch: '{file} (+{count})',
      default: 'Task {id}',
    },

    taskType: {
      copy: 'Copy',
      fs_index_rebuild: 'Index Rebuild',
      fs_index_apply_dirty: 'Apply Index Dirty',
      unknown: 'Unknown Task',
      unknownWithType: 'Unknown ({type})',
    },

    // Stage names for staged tasks
    stages: {
      scanning: 'Scanning Files',
      indexing: 'Building Index',
      finalizing: 'Finalizing',
      loading: 'Loading Changes',
      applying: 'Applying Changes',
      committing: 'Committing Updates',
      pending: 'Pending',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
    },

    // Statistics
    stats: {
      total: 'This Page Total',
      running: 'Running (This Page)',
      completed: 'Completed (This Page)',
      success: 'Success',
      failed: 'Failed (This Page)',
      skipped: 'Skipped',
    },

    unknownFile: 'Unknown file',
  },
};
