export default {
  storage: {
    // 通用
    item: "此存储配置",

    // 存储类型显示
    type: {
      s3: "S3 兼容存储",
      webdav: "WebDAV 存储",
      local: "本机文件存储",
    },

    // 分组标题
    groups: {
      basic: "基础配置",
      connection: "连接配置",
      credentials: "凭证配置",
      permissions: "权限设置",
      advanced: "高级选项",
      options: "其他选项",
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
      default_folder: "默认目录",
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
    },

    // 占位符文本
    placeholder: {
      bucket_name: "例如：my-bucket",
      endpoint_url: "例如：https://s3.region.amazonaws.com",
      region: "例如：us-east-1 或留空",
      access_key_id: "输入访问密钥 ID",
      secret_access_key: "输入访问密钥 Secret",
      default_folder: "例如：uploads/ 或留空使用根目录",
      custom_host: "例如：https://cdn.example.com",
      url_proxy: "例如：https://proxy.example.com",
      webdav_endpoint: "例如：https://dav.example.com/dav",
      username: "输入 WebDAV 用户名",
      password: "输入 WebDAV 密码",
      root_path: "例如：/data/storage 或 D:\\Storage",
      trash_path: "例如：.trash 或 /data/trash",
      dir_permission: "例如：0777",
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
    },

    // S3 服务商选项
    s3: {
      provider: {
        cloudflare_r2: "Cloudflare R2",
        backblaze_b2: "Backblaze B2",
        aws_s3: "AWS S3",
        aliyun_oss: "阿里云 OSS",
        other: "其他 S3 兼容服务",
      },
    },
  },
};
