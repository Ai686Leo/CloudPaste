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
      telegram: "Telegram Bot API",
      discord: "Discord Bot API",
      huggingface_datasets: "HuggingFace Datasets",
      mirror: "Source Mirror",
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

      // S3 特有字段
      s3: {
        multipart_part_size_mb: "分片大小（MB）",
        multipart_concurrency: "分片上传并发数",
      },

      // LOCAL 特有字段
      local: {
        root_path: "本地根目录",
        auto_create_root: "自动建根目录",
        readonly: "只读模式",
        enable_disk_usage: "启用配额读取",
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
        enable_disk_usage: "启用配额读取",
        oauth_status: "授权状态",
      },

      // Google Drive 特有字段
      googledrive: {
        use_online_api: "API 类型",
        endpoint_url: "Token 续期端点",
        client_id: "客户端 ID",
        client_secret: "客户端密钥",
        refresh_token: "刷新令牌 / Service Account JSON 远程 URL",
        root_id: "根目录 ID",
        enable_disk_usage: "启用配额读取",
        enable_shared_view: "SharedWithMe视图",
      },

      // WebDAV 特有字段（补充：上游配额开关）
      webdav: {
        enable_disk_usage: "启用配额读取",
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
        endpoint_url: "GitHub API Base",
        gh_proxy: "GitHub 代理 URL",
        committer_name: "提交者姓名（committer.name）",
        committer_email: "提交者邮箱（committer.email）",
        author_name: "作者姓名（author.name）",
        author_email: "作者邮箱（author.email）",
        token: "GitHub 访问令牌",
      },

      // Telegram 特有字段
      telegram: {
        bot_token: "Bot Token",
        target_chat_id: "目标频道/群 Chat ID",
        endpoint_url: "Bot API 地址",
        bot_api_mode: "Bot API 模式",
        part_size_mb: "分片大小（MB）",
        upload_concurrency: "上传并发",
        verify_after_upload: "上传后校验",
      },

      // Discord 特有字段
      discord: {
        bot_token: "Bot Token",
        channel_id: "频道 ID（Channel ID）",
        endpoint_url: "API Base URL（可选）",
        part_size_mb: "分片大小（MB）",
        upload_concurrency: "上传并发",
      },

      // HuggingFace Datasets 特有字段
      huggingface_datasets: {
        repo: "数据集仓库（repo）",
        revision: "分支/版本（revision）",
        endpoint_url: "Hub 地址（可选）",
        hf_token: "HF Token（可选）",
        hf_use_paths_info: "显示更多信息（修改时间 / Xet / LFS）",
        hf_tree_limit: "列目录每页数量（tree limit）",
        hf_multipart_concurrency: "分片上传并发数",
        hf_use_xet: "使用 Xet 存储后端（默认关闭）",
        hf_delete_lfs_on_remove: "删除文件时，同时清理 HuggingFace LFS 大文件（谨慎）",
      },

      // MIRROR（镜像站）
      mirror: {
        preset: "镜像模板",
        endpoint_url: "镜像站地址",
        max_entries: "最大条目数",
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
        endpoint_url: "例如：https://your-online-api.example.com/refresh",
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
        endpoint_url: "例如：https://api.github.com（留空使用默认值）",
        gh_proxy: "例如：https://ghproxy.net/https://raw.githubusercontent.com（可选，仅影响直链输出）",
        committer_name: "例如：CloudPaste Bot（可选）",
        committer_email: "{'例如：bot@example.com（可选）'}",
        author_name: "例如：Your Name（可选）",
        author_email: "{'例如：you@example.com（可选）'}",
        token: "必填：建议使用具有仓库读写权限的访问令牌",
      },

      telegram: {
        bot_token: "粘贴从 ＠BotFather 拿到的 token（形如 123:ABC...）",
        target_chat_id: "例如：-100xxxxxxxxxx（必须是纯数字）",
        bot_api_mode: "默认使用官方",
        endpoint_url: "例如：https://api.telegram.org（自建 Bot API server 可改为你的地址）",
        part_size_mb: "默认 15；未勾选自建时建议 ≤20；勾选自建可不限制",
        upload_concurrency: "默认 2；调大更快但更容易被限流",
      },

      discord: {
        bot_token: "粘贴 Discord Bot Token",
        channel_id: "目标频道的 Channel ID",
        endpoint_url: "例如：https://discord.com/api/v10（默认官方；需要走代理/反代时再改）",
        part_size_mb: "默认 10；建议 8~10（Discord 单次上传限制最大10MB，Nitro用户最大25MB）",
        upload_concurrency: "默认 1；调大更快但更容易触发 Discord 限速",
      },

      huggingface_datasets: {
        repo: "例如：Open-Orca/OpenOrca（不要写成完整 URL）",
        revision: "例如：main（分支名）；也可以填 tag/commit，但那样只能读不能写",
        endpoint_url: "默认 https://huggingface.co；自建镜像/代理时才需要改",
        hf_token: "可选：从 https://huggingface.co/settings/tokens 创建；private/gated 必填",
        hf_tree_limit: "默认 100；数值越大单次返回越多",
        hf_multipart_concurrency: "默认 5；数值越大越快，但更吃网络/更容易失败",
      },

      mirror: {
        endpoint_url: "例如：https://mirrors.tuna.tsinghua.edu.cn/",
        max_entries: "例如：1000",
      },
    },

    // 枚举选项
    enum: {
      mirror: {
        preset: {
          tuna: "Tsinghua",
          ustc: "USTC",
          aliyun: "Aliyun",
        },
      },
      telegram: {
        bot_api_mode: {
          official: "官方（api.telegram.org）",
          self_hosted: "自建 Bot API Server",
        },
      },
    },

    toggle: {
      telegram: {
        bot_api_mode: "使用自建 Bot API Server",
      },
    },

    // 描述文本
    description: {
      endpoint_url: "S3 兼容服务的终端节点地址，不同服务商格式略有差异",
      path_style: "启用后使用路径样式(endpoint/bucket)访问，禁用则使用虚拟主机(bucket.endpoint)",
      signature_expires_in: "预签名 URL 的有效期，单位为秒，默认 3600",
      custom_host: "用于生成公开访问链接的自定义域名（CDN 加速等场景）",
      url_proxy: "通过代理服务器访问存储，适用于需要中转的场景",
      s3: {
        multipart_part_size_mb: "前端直传分片上传的分片大小（MB）。默认 5MB；分片越大分片数量越少，但单片失败重传成本更高。",
        multipart_concurrency: "前端直传分片上传并发数（同时上传多少片）。默认 3；越大速度可能越快，但更吃网络也更容易失败。",
      },
      webdav_endpoint: "WebDAV 服务的完整访问地址",
      tls_insecure_skip_verify: "跳过 TLS 证书验证（不安全，仅用于测试环境）",
      root_path: "本地文件存储的根目录路径，例如 /data/local-files ",
      auto_create_root: "启用后，当本地根目录对应子目录不存在时会自动创建；默认关闭，需要手动在宿主机上创建子目录",
      readonly: "启用只读模式，禁止写入和删除操作",
      local: {
        enable_disk_usage: "启用后，读取宿主机磁盘空间总量/已用/可用，用于面板配额分析与上传限制校验",
      },
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
        enable_disk_usage: "启用后，读取 OneDrive 的存储配额信息（用于面板配额分析与上传限制校验）。",
      },

      webdav: {
        enable_disk_usage: "启用后，尝试配额属性读取 WebDAV 配额信息，用于面板配额分析与上传限制校验（并非所有 WebDAV 服务支持）。",
      },

      // Google Drive 描述
      googledrive: {
        use_online_api: "启用后，通过在线 API 地址获取访问令牌，适合托管在外部的统一 Token 服务。",
        endpoint_url: "在线 API 刷新地址，调用以获取 access_token 与 refresh_token。",
        client_id: "标准 OAuth 模式下使用的 client_id，可在 GCP 控制台创建 OAuth 客户端后获取。",
        client_secret: "标准 OAuth 模式下使用的 client_secret，用于配合 refresh_token 刷新 access_token。",
        refresh_token: "可为两种形态：1) 标准 OAuth refresh_token；2) 远程 Service Account JSON URL。",
        root_id: "Google Drive 根目录 ID，默认为 root；如需挂载 Shared Drive，请填写对应 driveId。",
        enable_disk_usage: "启用后，读取存储配额信息，用于面板配额分析与上传限制校验。",
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
        endpoint_url: "可选：自定义API（用于 GitHub Enterprise 等场景）。默认 https://api.github.com。",
        gh_proxy: "可选：用于加速 raw 直链输出。会把直链中的 https://raw.githubusercontent.com 替换为该值。",
        committer_name: "可选：自定义 commit 的 committer.name（与 committer_email 成对填写）。",
        committer_email: "可选：自定义 commit 的 committer.email（与 committer_name 成对填写）。",
        author_name: "可选：自定义 commit 的 author.name（与 author_email 成对填写）。",
        author_email: "可选：自定义 commit 的 author.email（与 author_name 成对填写）。",
        token: "必填：GitHub 访问令牌。用于提升 API 速率限制，并用于写入（创建 commit/更新 refs）。",
      },

      telegram: {
        bot_token: "用于调用 Telegram Bot API 上传/下载文件",
        target_chat_id: "文件会被发送到这个频道/群（需要把 bot 拉进并授予发消息权限）",
        endpoint_url: "默认官方地址；如果你后续自建 Bot API server，可以切到自建地址",
        bot_api_mode: "未勾选自建：按官方 Bot API 规则单次最大上传大小 ≤20MB ；勾选自建：你自己提供 Bot API Server，可放宽这些限制",
        part_size_mb: "挂载页断点续传的分片大小；默认 15MB。未勾选自建时建议 ≤20MB；勾选自建可不限制",
        upload_concurrency: "限制同一存储配置同时向 Telegram 发请求的数量，避免并发过高导致限流",
        verify_after_upload: "开启后每片上传成功会再次校验大小，速度稍慢但更稳(无特殊情况默认即可)",
      },

      discord: {
        bot_token: "用于调用 Discord Bot API",
        channel_id: "文件会被上传到这个频道（bot 必须在该频道/服务器里，并有查看/发消息/上传附件权限）",
        endpoint_url: "可选：自定义 Discord API Base（默认 https://discord.com/api/v10）。只有你使用代理/反代/自建网关时才需要改；请填到 /api/v10 这一层。",
        part_size_mb: "挂载页断点续传的分片大小；建议 8~10MB（Discord 单次上传限制最大10MB，Nitro用户最大25MB）",
        upload_concurrency: "限制同一存储配置同时向 Discord 发请求的数量，避免并发过高导致 429 限速",
      },

      huggingface_datasets: {
        repo: "HuggingFace 数据集仓库 ID（形如 owner/name）。这是 HuggingFace Datasets 的“仓库”，不是本地路径。",
        revision: "分支/版本：建议填分支名（如 main）。如果填 tag 或 commit sha，只能读不能写。",
        endpoint_url: "Hub 站点地址。默认 https://huggingface.co；只有你自建镜像/代理时才需要改。",
        hf_token: "可选：用于访问 private/gated 或提升额度/限流上限。",
        hf_use_paths_info: "开启后，目录列表会额外获取详细信息，如：“修改时间 + Xet/LFS 标记”。信息更全，但响应体更大、也更容易触发限流。",
        hf_tree_limit: "tree API 每页返回文件数量（对应HF的 limit 参数）。配合“显示更多信息”开关使用，开启时最大100数量限制，关闭时最大1000数量限制。默认即可",
        hf_multipart_concurrency: "一次同时上传多少个分片。数值越大速度越快，但会更吃网络，也更容易失败（默认 3，建议 3~8）。",
        hf_use_xet: "开启后，写入会尝试走 Xet（新后端）。但某些运行环境（例如 Cloudflare Workers）可能禁止运行时编译 WebAssembly，导致写入报错。默认关闭更稳。",
        hf_delete_lfs_on_remove:
          "开启后：你在 CloudPaste 删除文件时，会额外请求 HuggingFace，把对应的 LFS 大文件也一起“永久删除”（从 HuggingFace 的 “List LFS files” 里也消失）。\n不开启：只会删掉仓库里的文件记录（类似“指针”），LFS 大文件可能仍然留在 HF，所以你再次上传“完全相同内容”的文件时，可能会出现“秒传/跳过上传”。\n注意：如果两个文件内容完全一样（同一个 SHA），清理 LFS 可能会影响另一个文件或旧版本下载。\n",
      },

      mirror: {
        preset: "自动按照对应模板规则去抓镜像站目录页链接。",
        endpoint_url: "镜像目录根地址（必须以 http(s):// 开头）。选了模板后会自动回填，也可以手动改成别的镜像站地址。",
        max_entries: "单次列目录最多返回多少个条目。目录特别大时建议调小，避免卡顿或超时。",
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
