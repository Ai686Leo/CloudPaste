export default {
  storage: {
    // 通用
    item: "此存储配置",

    // 存储类型显示
    type: {
      s3: "S3兼容",
      webdav: "WebDAV",
      local: "本机文件",
      onedrive: "OneDrive",
      googledrive: "Google Drive",
      github_releases: "GitHub Releases",
      github_api: "GitHub API",
    },

    // 分组标题
    groups: {
      basic: "基础配置",
      connection: "连接配置",
      credentials: "凭证配置",
      permissions: "权限设置",
      advanced: "高级选项",
      options: "其他选项",
      behaviour: "行为配置",
    },

    // 通用字段标签
    fields: {
      name: "配置名称",
      storage_type: "存储类型",
      provider_type: "服务商",
      endpoint_url: "端点 URL",
      bucket_name: "存储桶名称",
      region: "区域",
      access_key_id: "访问密钥 ID",
      secret_access_key: "访问密钥 Secret",
      path_style: "路径样式",
      default_folder: "默认上传目录",
      custom_host: "自定义 HOST",
      url_proxy: "代理 URL",
      signature_expires_in: "签名过期时间(秒)",
      is_public: "允许 API 密钥使用",
      username: "用户名",
      password: "密码",
      tls_insecure_skip_verify: "跳过 TLS 证书校验",

      // LOCAL 特有字段
      local: {
        root_path: "本地根目录",
        auto_create_root: "自动建根目录",
        readonly: "只读模式",
        trash_path: "回收站路径",
        dir_permission: "目录/文件权限",
      },

      // OneDrive 特有字段
      onedrive: {
        region: "区域",
        client_id: "客户端 ID",
        client_secret: "客户端密钥",
        refresh_token: "刷新令牌",
        token_renew_endpoint: "Token 续期端点",
        redirect_uri: "回调地址",
        use_online_api: "API 类型",
        oauth_status: "授权状态",
      },

      // Google Drive 特有字段
      googledrive: {
        use_online_api: "API 类型",
        api_address: "在线 API 地址",
        client_id: "客户端 ID",
        client_secret: "客户端密钥",
        refresh_token: "刷新令牌 / Service Account JSON 远程 URL",
        root_id: "根目录 ID",
        enable_disk_usage: "启用配额读取",
        enable_shared_view: "SharedWithMe视图",
      },

      // GitHub Releases 特有字段
      github_releases: {
        repo_structure: "仓库映射规则",
        show_all_version: "显示所有版本目录",
        show_source_code: "显示 Source code 压缩包",
        show_readme: "显示 README / LICENSE",
        show_release_notes: "显示 Release Notes",
        per_page: "每次拉取的版本数量",
        gh_proxy: "GitHub 代理 URL",
        token: "GitHub 访问令牌",
      },

      // GitHub API（仓库内容）特有字段
      github_api: {
        owner: "仓库所有者（owner）",
        repo: "仓库名称（repo）",
        ref: "引用（ref）",
        api_base: "GitHub API Base",
        gh_proxy: "GitHub 代理 URL",
        committer_name: "提交者姓名（committer.name）",
        committer_email: "提交者邮箱（committer.email）",
        author_name: "作者姓名（author.name）",
        author_email: "作者邮箱（author.email）",
        token: "GitHub 访问令牌",
      },
    },

    // 占位符文本
    placeholder: {
      bucket_name: "例如：my-bucket",
      endpoint_url: "例如：https://s3.region.amazonaws.com",
      region: "例如：us-east-1 或留空",
      access_key_id: "输入访问密钥 ID",
      secret_access_key: "输入访问密钥 Secret",
      default_folder: "例如：uploads/ 或留空表示上传到根目录",
      custom_host: "例如：https://cdn.example.com",
      url_proxy: "例如：https://proxy.example.com",
      webdav_endpoint: "例如：https://dav.example.com/dav",
      username: "输入 WebDAV 用户名",
      password: "输入 WebDAV 密码",
      root_path: "例如：/data/storage 或 D:\\Storage",
      trash_path: "例如：.trash 或 /data/trash",
      dir_permission: "例如：0777",

      // OneDrive 占位符
      onedrive: {
        client_id: "Azure 应用的客户端 ID",
        client_secret: "Azure 应用的客户端密钥",
        refresh_token: "在外部授权页面获取的刷新令牌",
        token_renew_endpoint: "例如：https://your-token-service.com/renew",
        redirect_uri: "例如：https://your-token-service.com/onedrive/callback",
      },

      // Google Drive 占位符
      googledrive: {
        api_address: "例如：https://your-online-api.example.com/refresh",
        client_id: "Google OAuth 客户端 ID",
        client_secret: "Google OAuth 客户端密钥",
        refresh_token: "RefreshToken 或 Service Account JSON 的远程 URL",
        root_id: "例如：root 或某个 Shared Drive ID",
      },

      // GitHub Releases 占位符
      github_releases: {
        repo_structure:
          "每行一条：owner/repo、别名:owner/repo 或完整仓库 URL（https://github.com/owner/repo），例如：ling-drag0n/CloudPaste、cloudpaste:ling-drag0n/CloudPaste 或 https://github.com/ling-drag0n/CloudPaste",
        gh_proxy: "例如：https://gh-proxy.com/https://github.com",
        token: "建议填写个人访问令牌以提升速率上限",
      },

      // GitHub API 占位符
      github_api: {
        owner: "例如：ling-drag0n",
        repo: "例如：CloudPaste",
        ref: "例如：main、v1.0.0 或 40 位 commit sha（留空使用默认分支）",
        api_base: "例如：https://api.github.com（留空使用默认值）",
        gh_proxy: "例如：https://ghproxy.net/https://raw.githubusercontent.com（可选，仅影响直链输出）",
        committer_name: "例如：CloudPaste Bot（可选）",
        committer_email: "{'例如：bot@example.com（可选）'}",
        author_name: "例如：Your Name（可选）",
        author_email: "{'例如：you@example.com（可选）'}",
        token: "必填：建议使用具有仓库读写权限的访问令牌",
      },
    },

    // 描述文本
    description: {
      endpoint_url: "S3 兼容服务的终端节点地址，不同服务商格式略有差异",
      path_style: "启用后使用路径样式(endpoint/bucket)访问，禁用则使用虚拟主机(bucket.endpoint)",
      signature_expires_in: "预签名 URL 的有效期，单位为秒，默认 3600",
      custom_host: "用于生成公开访问链接的自定义域名（CDN 加速等场景）",
      url_proxy: "通过代理服务器访问存储，适用于需要中转的场景",
      webdav_endpoint: "WebDAV 服务的完整访问地址",
      tls_insecure_skip_verify: "跳过 TLS 证书验证（不安全，仅用于测试环境）",
      root_path: "本地文件存储的根目录路径，例如 /data/local-files ",
      auto_create_root: "启用后，当本地根目录对应子目录不存在时会自动创建；默认关闭，需要手动在宿主机上创建子目录",
      readonly: "启用只读模式，禁止写入和删除操作",
      trash_path: "删除文件时移动到此目录，支持相对路径（相对于根目录）或绝对路径",
      dir_permission: "创建目录和文件时使用的权限",

      // OneDrive 描述
      onedrive: {
        region: "选择 OneDrive 服务区域，国际版选 Global，世纪互联版选 CN",
        client_id: "在 Azure Portal 注册应用后获取的客户端 ID",
        client_secret: "Azure 应用的客户端密钥",
        refresh_token: "推荐在 OpenList APIPages 等外部授权站点完成授权后，复制刷新令牌粘贴到此处",
        root_folder: "OneDrive 中的默认上传目录路径，留空表示使用整个 OneDrive",
        token_renew_endpoint: "可选：自定义 Token 续期服务地址，用于对接 Online API 等外部续期服务",
        redirect_uri: "外部授权站点在 Azure 应用中配置的回调地址，通常与授权页面文档保持一致",
        use_online_api: "启用后，CloudPaste 将按照 Online API 协议调用续期端点刷新令牌",
      },

      // Google Drive 描述
      googledrive: {
        use_online_api: "启用后，通过在线 API 地址获取访问令牌，适合托管在外部的统一 Token 服务。",
        api_address: "在线 API 刷新地址，调用以获取 access_token 与 refresh_token。",
        client_id: "标准 OAuth 模式下使用的 client_id，可在 GCP 控制台创建 OAuth 客户端后获取。",
        client_secret: "标准 OAuth 模式下使用的 client_secret，用于配合 refresh_token 刷新 access_token。",
        refresh_token: "可为两种形态：1) 标准 OAuth refresh_token；2) 远程 Service Account JSON URL。",
        root_id: "Google Drive 根目录 ID，默认为 root；如需挂载 Shared Drive，请填写对应 driveId。",
        enable_disk_usage: "启用后，读取存储配额信息，用于管理端展示和配额分析。",
        enable_shared_view: '启用后，将在对应挂载根目录下展示 "Shared with me" 虚拟目录，用于浏览“与我共享”文件。',
      },

      // GitHub Releases 描述
      github_releases: {
        repo_structure:
          "配置 GitHub 仓库列表，每行一条。单仓库可用 owner/repo 直接挂载到仓库根目录（不额外生成 repo 目录）；多仓库必须使用 别名:owner/repo 生成一级目录避免覆盖。挂载路径本身由挂载配置决定。",
        show_all_version: "开启后，将为每个版本创建一个子目录（按 tagName 命名），目录下包含该版本的所有发布资产；关闭时只展示最新版本的资产列表。",
        show_source_code: '开启后，为每个版本额外生成 "Source code (zip)" 和 "Source code (tar.gz)" 伪文件，指向 GitHub 提供的源码压缩包。',
        show_readme: "在仓库根目录挂载 README / LICENSE 虚拟文件（如果仓库存在对应文件），文件内容通过 GitHub API 实时读取。",
        show_release_notes: "在版本目录中额外生成 RELEASE_NOTES.md 虚拟文件，内容来自 GitHub Release 的说明（Markdown）。",
        per_page: "从 GitHub Releases 接口每次获取的最大版本数量，默认 20。数值越大，请求次数越少，但单次响应体越大。",
        gh_proxy:
          "可选：用于加速 GitHub 下载的代理前缀，例如 https://gh-proxy.com/github.com 或 https://gh-proxy.com/https://github.com 完整填入。仅对以 https://github.com 开头的下载链接生效。",
        token: "可选：GitHub 个人访问令牌。用于访问私有仓库或提升 API 速率限制（强烈推荐配置，尤其在公开站点中使用时）。",
      },

      // GitHub API 描述
      github_api: {
        owner: "GitHub 仓库 owner（例如 ling-drag0n）",
        repo: "GitHub 仓库名称（例如 CloudPaste）",
        ref: "可填写分支名 / 标签名 / commit sha。仅分支支持写入；标签与 commit sha 为只读。留空时自动使用仓库默认分支。",
        api_base: "可选：自定义API（用于 GitHub Enterprise 等场景）。默认 https://api.github.com。",
        gh_proxy: "可选：用于加速 raw 直链输出。会把直链中的 https://raw.githubusercontent.com 替换为该值。",
        committer_name: "可选：自定义 commit 的 committer.name（与 committer_email 成对填写）。",
        committer_email: "可选：自定义 commit 的 committer.email（与 committer_name 成对填写）。",
        author_name: "可选：自定义 commit 的 author.name（与 author_email 成对填写）。",
        author_email: "可选：自定义 commit 的 author.email（与 author_name 成对填写）。",
        token: "必填：GitHub 访问令牌。用于提升 API 速率限制，并用于写入（创建 commit/更新 refs）。",
      },
    },

    // 卡片摘要显示值
    display: {
      path_style: {
        path: "路径样式",
        virtual_host: "虚拟主机样式",
      },
      default_folder: {
        root: "根目录",
      },
      onedrive: {
        use_online_api: {
          enabled: "Online API",
          disabled: "标准 API",
        },
      },
      googledrive: {
        use_online_api: {
          enabled: "Online API",
          disabled: "标准 API",
        },
        enable_shared_view: {
          enabled: "已启用",
          disabled: "未启用",
        },
      },
    },

    // S3 服务商选项
    s3: {
      provider: {
        cloudflare_r2: "Cloudflare R2",
        backblaze_b2: "Backblaze B2",
        aws_s3: "AWS S3",
        aliyun_oss: "阿里云 OSS",
        other: "其他S3兼容服务",
      },
    },

    // OneDrive 区域选项
    onedrive: {
      region: {
        global: "国际版 (Global)",
        cn: "世纪互联版 (CN)",
        us: "美国政府版 (US Gov)",
        de: "德国版 (Germany)",
      },
    },
  },
};
