export default {
  fsMeta: {
    // 顶部标题与工具栏
    title: "元信息管理",
    toolbar: {
      create: "新建元信息",
      createShort: "新建",
      refresh: "刷新",
      refreshing: "刷新中...",
      refreshShort: "刷",
    },

    // 搜索与统计
    search: {
      placeholder: "搜索路径...",
      hint: "客户端搜索，支持路径模糊匹配",
    },
    stats: {
      total: "共 {count} 条记录",
      searchResultTag: "(搜索结果)",
    },
    lastRefresh: "上次刷新",

    // 通用文案
    common: {
      notSet: "未设置",
      set: "已设置",
      inherited: "继承",
      inheritedSuffix: " (继承)",
      loading: "加载中...",
      noDataCell: "无数据",
    },

    // 表格相关
    table: {
      path: "路径",
      headerMarkdown: "顶部说明",
      footerMarkdown: "底部说明",
      hidePatterns: "隐藏规则",
      password: "密码",
      createdAt: "创建时间",
      actions: "操作",
      noData: "暂无元信息记录",
    },

    // 表单相关
    form: {
      titleCreate: "创建元信息",
      titleEdit: "编辑元信息",
      tabs: {
        basic: "基本信息",
        path: "路径选择",
      },
      path: {
        label: "路径",
        required: "路径不能为空",
        placeholder: "/claw",
        helper: "文件系统路径，必须以 / 开头，可点击右侧按钮选择",
        selectButton: "选择路径",
      },
      headerMarkdown: {
        label: "顶部说明 (Markdown)",
        placeholder: "支持 Markdown 格式的顶部说明...",
        inheritLabel: "子目录继承此说明",
      },
      footerMarkdown: {
        label: "底部说明 (Markdown)",
        placeholder: "支持 Markdown 格式的底部说明...",
        inheritLabel: "子目录继承此说明",
      },
      hidePatterns: {
        label: "隐藏规则 (正则表达式)",
        placeholder:
          "每行一个正则表达式，例如：\n^\\\\..*\n.*\\\\.tmp$\nnode_modules",
        inheritLabel: "子目录继承隐藏规则",
        helper: "匹配的文件将在界面中隐藏（每行一个正则表达式）",
      },
      password: {
        label: "访问密码",
        placeholderKeep: "留空保持不变",
        placeholderSetOptional: "设置目录访问密码（可选）",
        inheritLabel: "子目录继承密码保护",
        helper: "设置后访问此路径需要验证密码",
      },
      pathSelector: {
        currentSelection: "当前选择",
        selectDirectory: "选择目录",
        rootLabel: "/",
        loading: "加载中...",
      },
      actions: {
        cancel: "取消",
        create: "创建",
        creating: "创建中...",
        update: "更新",
        updating: "更新中...",
      },
      errors: {
        submitFailed: "提交失败",
      },
    },

    // 密码状态
    passwordStatus: {
      inherited: "继承保护",
      protected: "已保护",
    },

    // 隐藏规则显示
    hidePatternsStatus: {
      count: "{count} 条",
    },

    // 删除确认
    confirmDelete: {
      title: "确认删除",
      message: '确定要删除路径 "{path}" 的元信息吗？',
      confirm: "删除",
      cancel: "取消",
    },

    // 列表空态与错误
    empty: {
      noData: "暂无元信息记录",
      noSearchResults: "未找到匹配的元信息记录",
      createFirst: "创建第一条记录",
    },

    // 成功提示
    success: {
      created: "元信息创建成功",
      updated: "元信息更新成功",
      deleted: "元信息删除成功",
    },

    // 错误提示
    error: {
      loadFailed: "加载元信息列表失败",
      createFailed: "创建元信息失败",
      updateFailed: "更新元信息失败",
      deleteFailed: "删除元信息失败",
    },

    // 操作按钮
    actions: {
      edit: "编辑",
      delete: "删除",
    },
  },
};

