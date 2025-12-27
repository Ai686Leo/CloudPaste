export default {
  backup: {
    title: "数据备份与恢复",
    subtitle: "管理系统数据的备份和恢复操作",
    operationLogs: "操作日志",

    // 备份操作
    backupOperations: {
      title: "备份操作",
      backupType: "备份类型：",
      fullBackup: {
        title: "完整备份",
        description: "备份所有数据和配置（推荐）",
      },
      moduleBackup: {
        title: "模块选择备份",
        description: "选择特定功能模块进行备份",
      },
      selectModules: "选择要备份的模块：",
      selectedModules: "已选择 {count} 个模块",
      createBackup: "创建备份",
      creating: "创建中...",
    },

    // 恢复操作
    restoreOperations: {
      title: "恢复操作",
      selectFile: "选择备份文件",
      restoreMode: "恢复模式：",
      overwriteMode: "覆盖",
      mergeMode: "合并",
      executeRestore: "执行恢复",
      restoring: "恢复中...",
    },

    // 模块定义
    modules: {
      text_management: {
        name: "文本管理",
        description: "文本分享数据和密码",
      },
      file_management: {
        name: "文件管理",
        description: "文件分享数据和密码",
      },
      mount_management: {
        name: "挂载管理",
        description: "存储挂载点配置",
      },
      storage_config: {
        name: "存储配置管理",
        description: "存储配置信息和访问控制",
      },
      key_management: {
        name: "密钥管理",
        description: "API密钥管理",
      },
      account_management: {
        name: "账号管理",
        description: "管理员账号和令牌",
      },
      system_settings: {
        name: "系统设置",
        description: "系统全局设置",
      },
      fs_meta_management: {
        name: "目录元信息管理",
        description: "目录元信息配置",
      },
      task_management: {
        name: "任务管理",
        description: "异步任务执行记录和状态",
      },
      upload_sessions: {
        name: "分片上传会话管理",
        description: "分片上传会话记录和状态"
      },
      vfs_management: {
        name: "虚拟目录树管理",
        description: "虚拟目录树索引。建议与“存储配置”“挂载管理”一起备份",
      },
    },

    // 日志和状态消息
    logs: {
      startFullBackup: "开始创建完整备份...",
      startModuleBackup: "开始创建模块备份 ({count}个模块)...",
      backupFileParsed: "备份文件解析成功（本地）",
      previewStart: "开始预检查（{mode}模式）...",
      previewPassed: "预检查通过，可以开始恢复",
      previewFailed: "预检查发现问题，已取消恢复",
      previewIssue: "预检查问题：{message}",
      previewIssueUnknown: "未知问题",
      previewBlockedRestore: "预检查未通过，已阻止执行恢复",
      previewIntegrityIssues: "预检查提示：发现 {count} 个潜在数据完整性问题",
      restoreIntegrityIssues: "恢复提示：发现 {count} 个数据完整性问题",
      serverWarning: "提示：{message}",
      startRestore: "开始执行恢复 ({mode}模式)...",
      backupComplete: "备份创建完成，共导出{count}条记录",
      moduleBackupComplete: "模块备份创建完成，共导出{count}条记录",
      downloadStarted: "备份文件开始下载",
      restoreComplete: "数据恢复完成，共新增{added}条记录，忽略{ignored}条重复记录",
      restoreCompleteOverwrite: "数据恢复完成，共恢复{count}条记录",
      tableExported: "{table}表: 导出{count}条记录",
      tableRestored: "{table}表: 新增{added}条，忽略{ignored}条，预期{expected}条 (部分已存在)",
      tableRestoredOverwrite: "{table}表: 成功{success}条，预期{expected}条",
      gettingModuleInfo: "正在获取模块信息...",
      moduleInfoSuccess: "模块信息获取成功",
      recordsCount: "{count} 条记录",
      clearLogs: "清空日志",
    },

    // 错误消息
    errors: {
      selectAtLeastOneModule: "请选择至少一个模块",
      getModuleInfoFailed: "获取模块信息失败: {error}",
      backupFailed: "备份创建失败: {error}",
      restoreFailed: "数据恢复失败: {error}",
      fileSelectRequired: "请先选择备份文件",
      invalidBackupFile: "无效的备份文件格式",
      parseBackupFailed: "解析备份文件失败: {error}",
    },

    // 成功消息
    success: {
      backupCreated: "备份创建成功",
      dataRestored: "数据恢复成功",
    },

    // 确认对话框
    confirmations: {
      restoreOverwrite: "覆盖模式将替换现有数据，此操作不可撤销。确定要继续吗？",
      restoreMerge: "合并模式将保留现有数据并添加新数据。确定要继续吗？",
    },
  },
};
