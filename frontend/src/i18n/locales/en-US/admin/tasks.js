export default {
  tasks: {
    title: 'Task Management',
    description: 'View and manage all background tasks in the system',
    loading: 'Loading...',

    viewMode: {
      table: 'Table View',
      card: 'Card View',
    },

    filters: {
      searchPlaceholder: 'Search task name, ID or path...',
      allStatuses: 'All Statuses',
    },

    table: {
      name: 'Name',
      creator: 'Creator',
      status: 'Status',
      progress: 'Progress',
      actions: 'Actions',
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
      retryFile: 'Retry this file',
      retryAllFailed: 'Retry all failed files',
      retrySelected: 'Retry selected files',
    },

    time: {
      created: 'Created',
    },

    details: {
      fileList: 'File List',
      sourcePath: 'Source Path',
      targetPath: 'Target Path',
      errorInfo: 'Error Info',
      none: 'None',
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

    empty: {
      title: 'No Tasks',
      description: 'There are no task records currently',
    },

    taskName: {
      single: '{file}',
      batch: '{file} (+{count})',
      default: 'Task {id}',
    },

    unknownFile: 'Unknown file',
  },
};
