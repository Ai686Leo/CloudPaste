# CloudPaste 后端服务 API 文档

## API 文档

所有 API 返回格式统一为：

```json
{
  "code": 200, // HTTP状态码
  "message": "success", // 消息
  "data": {}, // 数据内容
  "success": true // 操作是否成功
}
```

## 认证方式

### 1. 管理员认证

使用 Bearer Token 认证，需要在请求头中添加：

```
Authorization: Bearer <admin_token>
```

管理员令牌通过 `/api/admin/login` 接口获取。

### 2. API 密钥认证

使用 ApiKey 认证，需要在请求头中添加：

```
Authorization: ApiKey <api_key>
```

API 密钥由管理员在后台创建，使用位标志权限系统，支持以下权限类型：

**权限位标志值：**

- **1 (TEXT_SHARE)**: 文本分享权限 - 允许创建/分享文本
- **2 (FILE_SHARE)**: 文件分享权限 - 允许创建/分享文件
- **4 (TEXT_MANAGE)**: 文本管理权限 - 允许列出/修改/删除自己的文本分享
- **8 (FILE_MANAGE)**: 文件管理权限 - 允许列出/修改/删除自己的文件分享
- **256 (MOUNT_VIEW)**: 挂载页查看权限 - 允许浏览挂载页
- **512 (MOUNT_UPLOAD)**: 上传权限 - 允许上传文件和创建目录
- **1024 (MOUNT_COPY)**: 复制权限 - 允许复制文件/目录
- **2048 (MOUNT_RENAME)**: 重命名权限 - 允许重命名文件/目录
- **4096 (MOUNT_DELETE)**: 删除权限 - 允许删除文件/目录
- **65536 (WEBDAV_READ)**: WebDAV 读取权限 - 允许通过 WebDAV 读取文件（GET/PROPFIND 等）
- **131072 (WEBDAV_MANAGE)**: WebDAV 管理权限 - 允许通过 WebDAV 管理文件（PUT/DELETE/MKCOL 等）

**权限组合示例：**

- `15` = TEXT_SHARE + TEXT_MANAGE + FILE_SHARE + FILE_MANAGE (1+2+4+8) - 拥有完整的文本/文件分享与管理权限
- `771` = 基础权限 + MOUNT_UPLOAD (1+2+256+512) - 包含上传权限
- `7939` = 除 WebDAV 外的所有权限 (1+2+256+512+1024+2048+4096) - 挂载页完整权限
- `204559` = ALL_PERMISSIONS (1+2+4+8+256+512+1024+2048+4096+65536+131072) - 拥有所有权限

**路径限制：**

- **basic_path**: 路径权限限制 - 限制 API 密钥用户只能访问指定路径及其子路径

### 3. WebDAV 认证

WebDAV 支持两种认证方式：

#### Basic Auth（推荐）

```
Authorization: Basic <base64(api_key:api_key)>
```

#### Bearer Token

```
Authorization: Bearer <api_key>
```

### 4. 自定义授权头

部分 API 还支持自定义授权头：

```
X-Custom-Auth-Key: <api_key>
```

### 认证错误响应

认证失败时返回统一的错误格式：

```json
{
  "code": 401,
  "message": "需要认证访问",
  "success": false
}
```

权限不足时返回：

```json
{
  "code": 403,
  "message": "权限不足",
  "success": false
}
```

### 公共 API

#### 基础 API

- `GET /api/health`

  - 描述：API 健康检查端点，用于监控服务状态
  - 参数：无
  - 响应：
    ```json
    {
      "status": "ok",
      "timestamp": "2023-05-01T12:00:00Z"
    }
    ```

- `GET /api/version`
  - 描述：获取系统版本信息
  - 参数：无
  - 响应：包含版本号、应用名称、运行环境、存储类型、Node.js 版本和运行时间的系统信息
  - 响应示例：
    ```json
    {
      "code": 200,
      "message": "获取版本信息成功",
      "data": {
        "version": "0.8.1",
        "name": "cloudpaste-api",
        "environment": "Docker",
        "storage": "SQLite",
        "nodeVersion": "v18.17.0",
        "uptime": 3600
      },
      "success": true
    }
    ```

#### 系统设置 API

**注意：系统设置 API 已重构为分组管理架构，支持更灵活的设置管理**

- `GET /api/admin/settings`

  - 描述：获取系统设置（支持按分组查询或获取所有分组）
  - 授权：无需授权（公开访问）
  - 查询参数：
    - `group` - 分组 ID（可选）：1=全局设置，3=WebDAV 设置
    - `metadata` - 是否包含元数据（可选，默认 true）
    - `includeSystem` - 是否包含系统内部分组（可选，默认 false，仅在不指定 group 时有效）
  - 响应：
    - **按分组查询时**：
      ```json
      {
        "code": 200,
        "message": "获取分组设置成功",
        "data": [
          {
            "key": "max_upload_size",
            "value": "100",
            "description": "最大上传文件大小限制（MB）",
            "type": "number",
            "group_id": 1,
            "options": null,
            "sort_order": 1
          }
        ],
        "success": true
      }
      ```
    - **获取所有分组时**：
      ```json
      {
        "code": 200,
        "message": "获取所有分组设置成功",
        "data": {
          "1": {
            "groupName": "全局设置",
            "settings": [...]
          },
          "3": {
            "groupName": "WebDAV设置",
            "settings": [...]
          }
        },
        "success": true
      }
      ```

- `GET /api/admin/settings/groups`

  - 描述：获取分组列表和统计信息
  - 授权：需要管理员令牌
  - 响应：分组信息列表
    ```json
    {
      "code": 200,
      "message": "获取分组信息成功",
      "data": {
        "groups": [
          {
            "id": 1,
            "name": "全局设置",
            "description": "系统全局配置项",
            "settingCount": 5
          },
          {
            "id": 3,
            "name": "WebDAV设置",
            "description": "WebDAV协议相关配置",
            "settingCount": 2
          }
        ]
      },
      "success": true
    }
    ```

- `GET /api/admin/settings/metadata`

  - 描述：获取设置项元数据
  - 授权：需要管理员令牌
  - 查询参数：
    - `key` - 设置键名（必填）
  - 响应：设置项的详细元数据
    ```json
    {
      "code": 200,
      "message": "获取设置元数据成功",
      "data": {
        "key": "max_upload_size",
        "description": "最大上传文件大小限制（MB）",
        "type": "number",
        "group_id": 1,
        "options": null,
        "sort_order": 1,
        "flags": 0
      },
      "success": true
    }
    ```

- `PUT /api/admin/settings/group/:groupId`
  - 描述：按分组批量更新设置
  - 授权：需要管理员令牌
  - 参数：groupId - 分组 ID（1=全局设置，3=WebDAV 设置）
  - 查询参数：
    - `validate` - 是否进行类型验证（可选，默认 true）
  - 请求体：设置键值对
    ```json
    {
      "max_upload_size": 200,
      "default_paste_expiry": 14,
      "default_file_expiry": 30
    }
    ```
  - 响应：批量更新结果
    ```json
    {
      "code": 200,
      "message": "批量更新设置成功，共更新3项",
      "data": {
        "success": true,
        "updated": 3,
        "failed": 0,
        "results": [
          {
            "key": "max_upload_size",
            "success": true,
            "oldValue": "100",
            "newValue": "200"
          }
        ]
      },
      "success": true
    }
    ```

### 文本分享 API

#### 创建和访问文本分享

- `POST /api/paste`

  - 描述：创建新的文本分享
  - 授权：需要管理员令牌或有文本权限的 API 密钥
  - 请求体：
    ```json
    {
      "content": "要分享的文本内容", // 必填
      "title": "文本标题", // 可选，用于在列表和前台展示中区分不同文本
      "remark": "备注信息", // 可选，用于管理和搜索
      "expires_at": "2023-12-31T23:59:59Z", // 可选，过期时间
      "max_views": 100, // 可选，最大查看次数
      "password": "访问密码", // 可选
      "slug": "custom-slug", // 可选，自定义短链接
      "is_public": true // 可选，是否公开访问，默认 true；false 时仅管理员和创建者可访问
    }
    ```
  - 响应：创建的文本分享信息，包含访问链接
    ```json
    {
      "code": 200,
      "message": "文本分享创建成功",
      "data": {
        "id": "123",
        "slug": "abc123",
        "title": "文本标题",
        "remark": "备注信息",
        "expires_at": "2023-12-31T23:59:59Z",
        "max_views": 100,
        "is_public": true,
        "hasPassword": true,
        "created_at": "2023-05-01T12:00:00Z"
      },
      "success": true
    }
    ```

- `GET /api/paste/:slug`

  - 描述：获取文本分享内容
  - 参数：slug - 文本短链接
  - 访问控制：
    - 当 `is_public = true` 时，任何持有链接的用户都可以访问（仍受过期时间、最大查看次数和密码保护限制）。
    - 当 `is_public = false` 时，仅管理员和创建者可以访问；其他用户（包括匿名和其他 API 密钥）将收到“不存在或已被删除”的响应（HTTP 404）。
  - 响应：
    - 如果文本未设置密码且可访问，将直接返回内容：
      ```json
      {
        "code": 200,
        "message": "获取文本内容成功",
        "data": {
          "slug": "abc123",
          "title": "文本标题",
          "content": "要分享的文本内容",
          "remark": "备注信息",
          "expires_at": "2023-12-31T23:59:59Z",
          "max_views": 100,
          "views": 1,
          "created_at": "2023-05-01T12:00:00Z",
          "created_by": "admin",
          "is_public": true,
          "hasPassword": false,
          "isLastView": false
        },
        "success": true
      }
      ```
    - 如果文本已设置密码，则只返回元信息并提示需要密码：
      ```json
      {
        "code": 200,
        "message": "获取文本信息成功",
        "data": {
          "slug": "abc123",
          "title": "文本标题",
          "remark": "备注信息",
          "expires_at": "2023-12-31T23:59:59Z",
          "max_views": 100,
          "views": 0,
          "created_at": "2023-05-01T12:00:00Z",
          "created_by": "admin",
          "is_public": true,
          "hasPassword": true,
          "requiresPassword": true
        },
        "success": true
      }
      ```

- `POST /api/paste/:slug`

  - 描述：使用密码获取受保护的文本分享
  - 参数：slug - 文本短链接
  - 请求体：
    ```json
    {
      "password": "访问密码" // 必填
    }
    ```
  - 响应：验证成功后返回文本分享内容，字段与未加密的 `GET /api/paste/:slug` 响应相同，另外会包含 `plain_password`（仅在需要时返回）

- `GET /api/raw/:slug`

  - 描述：获取文本分享的原始内容（纯文本格式）
  - 参数：slug - 文本短链接
  - 查询参数：
    - `password` - 如果文本受密码保护，需提供密码
  - 访问控制：与 `GET /api/paste/:slug` 相同，受 `is_public`、过期时间、最大查看次数及密码保护限制
  - 响应：纯文本格式的内容，Content-Type 为 text/plain

#### 统一文本管理接口

- `GET /api/pastes`

  - 描述：获取文本分享列表（统一接口，支持管理员和 API 密钥用户）
  - 授权：需要管理员令牌或有文本权限的 API 密钥
  - 查询参数：
    - **管理员用户**：
      - `page` - 页码，默认为 1
      - `limit` - 每页数量，默认为 10
      - `created_by` - 可选，按创建者筛选
    - **API 密钥用户**：
      - `limit` - 每页数量，默认为 30
      - `offset` - 偏移量，默认为 0
  - 响应：文本分享列表和分页信息，API 密钥用户只能看到自己创建的文本
    ```json
    {
      "code": 200,
      "message": "获取成功",
      "data": {
        "results": [
          {
            "id": "123",
            "slug": "abc123",
            "title": "文本标题",
            "remark": "备注信息",
            "expires_at": "2023-12-31T23:59:59Z",
            "max_views": 100,
            "view_count": 5,
            "is_public": true,
            "created_by": "admin",
            "created_at": "2023-05-01T12:00:00Z",
            "updated_at": "2023-05-02T08:00:00Z",
            "has_password": false,
            "content": "完整内容..."
          }
        ],
        "pagination": {
          "total": 1,
          "limit": 10,
          "offset": 0,
          "hasMore": false,
          "page": 1,
          "totalPages": 1
        }
      },
      "success": true
    }
    ```

- `GET /api/pastes/:id`

  - 描述：获取单个文本详情（统一接口）
  - 授权：需要管理员令牌或有文本权限的 API 密钥
  - 参数：id - 文本 ID
  - 响应：文本分享详细信息，API 密钥用户只能访问自己创建的文本。返回字段包含：
    - `id`, `slug`, `title`, `content`, `remark`
    - `expires_at`, `max_views`, `views`, `is_public`
    - `created_by`, `created_at`, `updated_at`
    - `has_password`, `plain_password`（仅在有密码时，并且当前调用者有权限查看明文密码）

- `DELETE /api/pastes/batch-delete`

  - 描述：批量删除文本（统一接口）
  - 授权：需要管理员令牌或有文本权限的 API 密钥
  - 请求体：
    ```json
    {
      "ids": ["文本ID1", "文本ID2", "文本ID3"] // 必填，要删除的文本ID数组
    }
    ```
  - 响应：批量删除结果，API 密钥用户只能删除自己创建的文本

- `PUT /api/pastes/:slug`
  - 描述：更新文本信息（统一接口）
  - 授权：需要管理员令牌或有文本权限的 API 密钥
  - 参数：slug - 文本短链接
  - 请求体：可包含以下字段（至少需要 content）：
    ```json
    {
      "content": "更新后的文本内容", // 必填
      "title": "更新后的标题", // 可选
      "remark": "更新后的备注信息", // 可选
      "expires_at": "2024-01-31T23:59:59Z", // 可选
      "max_views": 50, // 可选
      "password": "新密码", // 可选
      "clearPassword": true, // 可选，true 时清除密码
      "newSlug": "new-slug", // 可选，更新短链接
      "is_public": false // 可选，是否公开访问，false 表示仅管理员和创建者可访问
    }
    ```
  - 响应：更新后的文本信息，API 密钥用户只能更新自己创建的文本

#### 管理员专用接口

- `POST /api/pastes/clear-expired`

  - 描述：清理过期文本（管理员专用）
  - 授权：需要管理员令牌
  - 响应：清理结果
    ```json
    {
      "code": 200,
      "message": "已清理 5 个过期分享",
      "success": true
    }
    ```

### 文件分享 API





- `GET /api/file-download/:slug`

  - 描述：直接下载文件（强制下载）
  - 参数：slug - 文件短链接
  - 查询参数：
    - `password` - 如果文件受密码保护，需提供密码
  - 响应：文件内容（下载），包含 Content-Disposition: attachment 头

- `GET /api/file-view/:slug`

  - 描述：预览文件（浏览器内查看）
  - 参数：slug - 文件短链接
  - 查询参数：
    - `password` - 如果文件受密码保护，需提供密码
  - 响应：文件内容（预览），包含 Content-Disposition: inline 头

- `GET /api/office-preview/:slug`
  - 描述：获取 Office 文件的预览 URL
  - 参数：slug - 文件短链接
  - 查询参数：
    - `password` - 如果文件受密码保护，需提供密码
  - 响应：JSON 格式的预签名 URL，用于 Microsoft Office 在线查看服务
  - 注意：此 API 不直接返回文件内容，而是返回用于重定向到 Microsoft Office 在线预览服务的 URL

#### 公共文件查询和验证

- `GET /api/public/files/:slug`

  - 描述：获取文件公开信息
  - 参数：slug - 文件短链接
  - 响应：包含文件基本信息（不含下载链接）

- `POST /api/public/files/:slug/verify`
  - 描述：验证文件访问密码
  - 参数：slug - 文件短链接
  - 请求体：
    ```json
    {
      "password": "文件密码"
    }
    ```
  - 响应：验证成功后返回带下载链接的文件信息

#### 统一文件管理接口

- `GET /api/files`

  - 描述：获取文件列表（统一接口，支持管理员和 API 密钥用户）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - **管理员用户**：
      - `limit` - 每页数量，默认为 30
      - `offset` - 偏移量，默认为 0
      - `created_by` - 可选，按创建者筛选
    - **API 密钥用户**：
      - `limit` - 每页数量，默认为 30
      - `offset` - 偏移量，默认为 0
  - 响应：文件列表和分页信息，API 密钥用户只能看到自己上传的文件

- `GET /api/files/:id`

  - 描述：获取单个文件详情（统一接口）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 参数：id - 文件 ID
  - 响应：文件详细信息和下载链接，API 密钥用户只能访问自己上传的文件

- `PUT /api/files/:id`

  - 描述：更新文件信息（统一接口）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 参数：id - 文件 ID
  - 请求体：可包含 remark, slug, expires_at, max_views, password, use_proxy 等字段
  - 响应：更新后的文件信息，API 密钥用户只能更新自己上传的文件

- `DELETE /api/files/batch-delete`

  - 描述：批量删除文件（统一接口）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "ids": ["文件ID1", "文件ID2", "文件ID3"], // 必填，要删除的文件ID数组
      "delete_mode": "both" // 可选，删除模式：record_only（仅删除记录）或 both（删除记录和文件，默认）
    }
    ```
  - 响应：批量删除结果，包含成功和失败的统计信息，API 密钥用户只能删除自己上传的文件

    ```json
    {
      "code": 200,
      "message": "批量删除完成，成功: 2，失败: 1",
      "data": {
        "success": 2,
        "failed": [
          {
            "id": "file-id-3",
            "error": "文件不存在或无权限删除"
          }
        ]
      },
      "success": true
    }
    ```

### 存储配置 API（通用）


- `GET /api/storage`

  - 描述：
    - 管理员：获取全部存储配置列表（支持分页）；
    - API 密钥用户：仅获取“公开 + ACL 白名单”内的存储配置列表。
  - 授权：需要管理员令牌或具有 `s3.config.read` 权限的 API 密钥
  - 查询参数（管理员）：
    - `page` - 页码（可选）
    - `limit` - 每页数量（可选，默认 10）
  - 响应：
    ```json
    {
      "success": true,
      "data": {
        "items": [
          {
            "id": "配置ID",
            "name": "配置名称",
            "storage_type": "S3 或 WEBDAV",
            "provider_type": "Cloudflare R2",
            "endpoint_url": "https://xxxx",
            "bucket_name": "my-bucket",
            "default_folder": "uploads/",
            "is_public": 1,
            "is_default": 0,
            "total_storage_bytes": 10737418240
          }
        ],
        "total": 1
      }
    }
    ```

- `GET /api/storage/:id`

  - 描述：
    - 管理员：获取指定存储配置详情，可通过 `reveal` 参数控制密钥字段显示方式；
    - API 密钥用户：仅能访问“公开 + ACL 白名单”内的配置。
  - 授权：同上
  - 查询参数（仅管理员）：
    - `reveal` - `plain` / `masked`，控制密钥字段是否返回明文或脱敏值
  - 响应：存储配置详情（根据 `reveal` 决定是否包含敏感字段）

- `POST /api/storage`

  - 描述：创建新的存储配置（管理员）
  - 授权：需要管理员令牌
  - 请求体示例：
    ```json
    {
      "name": "配置名称",
      "storage_type": "S3",
      "provider_type": "Cloudflare R2",
      "endpoint_url": "https://xxxx.r2.cloudflarestorage.com",
      "bucket_name": "my-bucket",
      "access_key_id": "ACCESS_KEY",
      "secret_access_key": "SECRET_KEY",
      "region": "auto",
      "path_style": false,
      "default_folder": "uploads/",
      "is_public": true,
      "total_storage_bytes": 10737418240
    }
    ```
  - 响应：新创建的存储配置（敏感字段按规则处理）

- `PUT /api/storage/:id`

  - 描述：更新存储配置（管理员）
  - 授权：需要管理员令牌
  - 参数：`id` - 存储配置 ID
  - 请求体：与 `POST /api/storage` 类似，所有字段均为可选
  - 响应：更新成功状态

- `DELETE /api/storage/:id`

  - 描述：删除存储配置（管理员）
  - 授权：需要管理员令牌
  - 参数：`id` - 存储配置 ID
  - 响应：删除结果

- `PUT /api/storage/:id/set-default`

  - 描述：设置默认存储配置（管理员）
  - 授权：需要管理员令牌
  - 参数：`id` - 存储配置 ID
  - 响应：设置结果

- `POST /api/storage/:id/test`

  - 描述：测试存储配置连接有效性（管理员）
  - 授权：需要管理员令牌
  - 参数：`id` - 存储配置 ID
  - 响应：测试结果，包含连接状态和详细信息

### 管理员 API

- `POST /api/admin/login`

  - 描述：管理员登录
  - 请求体：
    ```json
    {
      "username": "管理员用户名",
      "password": "管理员密码"
    }
    ```
  - 响应：登录令牌和管理员信息
    ```json
    {
      "code": 200,
      "message": "登录成功",
      "data": {
        "username": "admin",
        "token": "abc123def456...",
        "expiresAt": "2025-01-28T10:30:45.123Z"
      }
    }
    ```

- `POST /api/admin/logout`

  - 描述：管理员登出
  - 授权：需要管理员令牌
  - 响应：登出结果

- `POST /api/admin/change-password`

  - 描述：管理员修改密码
  - 授权：需要管理员令牌
  - 请求体：
    ```json
    {
      "currentPassword": "当前密码",
      "newPassword": "新密码",
      "newUsername": "新用户名" // 可选
    }
    ```
  - 响应：修改结果

- `GET /api/test/admin-token`

  - 描述：测试管理员令牌有效性
  - 授权：需要管理员令牌
  - 响应：令牌有效状态
    ```json
    {
      "code": 200,
      "message": "令牌有效",
      "success": true
    }
    ```

- `GET /api/test/api-key`

  - 描述：测试 API 密钥有效性
  - 授权：需要有效的 API 密钥
  - 响应：API 密钥验证状态和权限信息（详见下方完整示例）


- `GET /api/public/guest-config`

  - 描述：用于前端获取Guest API 密钥配置，支持"游客模式"登录
  - 权限要求：无需身份验证
  - 响应会返回以下字段：
    - `enabled`: 是否有效（已启用 + 未禁用 + 未过期）
    - `key`: 仅在有效时才返回 API 密钥的值，无效时为 null
    - `name`: Guest 密钥名称（默认 GUEST）
    - `permissions`: 位标志权限值
    - `permissions_detail`: ▲text/file/mount/webdav 权限详细信息
    - `basic_path`: 密钥用户的基础路径
    - `expires_at`: 过期时间（ISO 8601 字符串）
  - 响应示例：
    ```json
    {
      "code": 200,
      "message": "游客配置获取成功",
      "success": true,
      "data": {
        "enabled": true,
        "key": "guest",
        "name": "guest",
        "permissions": 768,
        "permissions_detail": {
          "text_share": true,
          "text_manage": false,
          "file_share": true,
          "file_manage": false,
          "mount_view": true,
          "mount_upload": false,
          "mount_copy": false,
          "mount_rename": false,
          "mount_delete": false,
          "webdav_read": false,
          "webdav_manage": false
        },
        "basic_path": "/public",
        "expires_at": "9999-12-31T23:59:59Z"
      }
    }
    ```

- `GET /api/admin/dashboard/stats`
  - 描述：获取管理员仪表盘统计数据
  - 授权：需要管理员令牌
  - 响应：系统统计数据，包含文本和文件使用情况、用户活跃度和系统性能指标
  - 响应示例：
    ```json
    {
      "code": 200,
      "message": "获取仪表盘统计数据成功",
      "data": {
        "pastes": {
          "total": 1250,
          "today": 45,
          "thisWeek": 320,
          "thisMonth": 1100
        },
        "files": {
          "total": 850,
          "today": 25,
          "thisWeek": 180,
          "thisMonth": 650,
          "totalSize": "2.5GB"
        },
        "apiKeys": {
          "total": 15,
          "active": 12
        },
        "storage": {
          "configs": 3,
          "mounts": 5
        }
      },
      "success": true
    }
    ```

### API 密钥管理 API

- `GET /api/admin/api-keys`

  - 描述：获取所有 API 密钥列表
  - 授权：需要管理员令牌
  - 响应：API 密钥列表，包含每个密钥的权限和使用情况

- `POST /api/admin/api-keys`

  - 描述：创建新的 API 密钥
  - 授权：需要管理员令牌
  - 请求体：
    ```json
    {
      "name": "密钥名称", // 必填
      "permissions": 7, // 必填，位标志权限值（数字）
      "role": "GENERAL", // 可选，用户角色：GUEST/GENERAL/ADMIN，默认GENERAL
      "basic_path": "/", // 可选，基本路径权限，默认为根路径"/"
      "is_guest": false, // 可选，是否为访客（免密访问），默认false
      "expires_at": "2023-12-31T23:59:59Z", // 可选，过期时间
      "custom_key": "custom-api-key-123" // 可选，自定义密钥值（仅限字母、数字、横杠和下划线）
    }
    ```
  - 权限位标志说明：
    - `1` (TEXT) - 文本分享权限
    - `2` (FILE_SHARE) - 文件分享权限
    - `256` (MOUNT_VIEW) - 挂载页查看权限
    - `512` (MOUNT_UPLOAD) - 上传权限
    - `1024` (MOUNT_COPY) - 复制权限
    - `2048` (MOUNT_RENAME) - 重命名权限
    - `4096` (MOUNT_DELETE) - 删除权限
    - `65536` (WEBDAV_READ) - WebDAV 读取权限
    - `131072` (WEBDAV_MANAGE) - WebDAV 管理权限
  - 示例权限组合：
    - `259` = TEXT + FILE_SHARE + MOUNT_VIEW (1+2+256)
    - `198915` = 所有权限 (1+2+256+512+1024+2048+4096+65536+131072)
  - 响应：新创建的 API 密钥信息，包含完整的密钥值（仅在创建时返回）

- `PUT /api/admin/api-keys/:id`

  - 描述：更新 API 密钥
  - 授权：需要管理员令牌
  - 参数：id - 密钥 ID
  - 请求体：
    ```json
    {
      "name": "新密钥名称", // 可选
      "permissions": 15, // 可选，位标志权限值（数字）
      "role": "GENERAL", // 可选，用户角色：GUEST/GENERAL/ADMIN
      "basic_path": "/restricted/path/", // 可选，基本路径权限
      "is_guest": false, // 可选，是否为访客（免密访问）
      "expires_at": "2023-12-31T23:59:59Z" // 可选，过期时间
    }
    ```
  - 响应：更新后的密钥信息

- `DELETE /api/admin/api-keys/:id`

  - 描述：删除 API 密钥
  - 授权：需要管理员令牌
  - 参数：id - 密钥 ID
  - 响应：删除结果

- `GET /api/test/api-key`
  - 描述：测试 API 密钥有效性
  - 授权：需要有效的 API 密钥
  - 响应：密钥有效状态和权限信息
    ```json
    {
      "code": 200,
      "message": "API密钥验证成功",
      "data": {
        "name": "密钥名称",
        "basic_path": "/",
        "permissions": {
          "text": true,
          "file_share": true,
          "mount_view": true,
          "mount_upload": false,
          "mount_copy": false,
          "mount_rename": false,
          "mount_delete": false,
          "webdav_read": false,
          "webdav_manage": false
        },
        "key_info": {
          "id": "密钥ID",
          "name": "密钥名称",
          "basic_path": "/",
          "permissions": 259,
          "role": "GENERAL",
          "is_guest": false
        }
      },
      "success": true
    }
    ```
- `GET /api/admin/api-keys/:id/storage-acl`

  - 用于获取指定 API 密钥的存储 ACL 白名单
  - 权限：需要管理员权限
  - 参数：id - 密钥 ID
  - 响应：返回该密钥允许使用的 `storage_config_id` 列表
    ```json
    {
      "code": 200,
      "message": "获取存储 ACL 成功",
      "data": {
        "subject_type": "API_KEY",
        "subject_id": "密钥ID",
        "storage_config_ids": ["config-id-a", "config-id-b"]
      },
      "success": true
    }
    ```
  - 说明：
    - 当 `storage_config_ids` 为空数组时，表示未为该密钥配置存储 ACL 白名单，此时该密钥可以使用所有公开存储配置（仍受 `basic_path` 和权限位限制）。

- `PUT /api/admin/api-keys/:id/storage-acl`

  - 用于整体更新指定 API 密钥的存储 ACL 白名单
  - 权限：需要管理员权限
  - 参数：id - 密钥 ID
  - 请求体：
    ```json
    {
      "storage_config_ids": ["config-id-a", "config-id-b"]
    }
    ```
  - 响应：
    ```json
    {
      "code": 200,
      "message": "存储 ACL 已更新",
      "data": {
        "subject_type": "API_KEY",
        "subject_id": "密钥ID",
        "storage_config_ids": ["config-id-a", "config-id-b"]
      },
      "success": true
    }
    ```
  - 说明：
    - `storage_config_ids` 为非空数组：该密钥只能使用这些存储配置（并且必须是公开的 `is_public = 1`）。
    - `storage_config_ids` 为空数组：清空白名单，恢复为“可以使用所有公开存储配置”的默认模式。


### 系统设置 API

- `GET /api/system/max-upload-size`

  - 描述：获取系统允许的最大上传文件大小（公共 API，无需认证）
  - 授权：无需授权
  - 响应：包含最大上传大小的对象
    ```json
    {
      "code": 200,
      "message": "获取最大上传大小成功",
      "data": {
        "max_upload_size": 100
      },
      "success": true
    }
    ```

### 缓存管理 API

#### 管理员缓存管理

- `GET /api/admin/cache/stats`

  - 描述：获取系统监控信息，包括缓存统计和系统内存信息
  - 授权：需要管理员令牌
  - 响应：系统监控信息，包括缓存统计和系统信息
    ```json
    {
      "code": 200,
      "message": "获取系统监控信息成功",
      "data": {
        "cache": {
          "directory": {
            "totalEntries": 150,
            "hitRate": 0.85,
            "missRate": 0.15
          },
          "url": {
            "totalEntries": 50,
            "hitRate": 0.9,
            "missRate": 0.1
          },
          "search": {
            "totalEntries": 25,
            "hitRate": 0.75,
            "missRate": 0.25,
            "cacheSize": "2.5MB",
            "maxAge": 300
          }
        },
        "system": {
          "memory": {
            "used": 128,
            "free": 512,
            "total": 640
          },
          "uptime": 3600
        },
        "timestamp": "2023-05-01T12:00:00Z"
      },
      "success": true
    }
    ```

- `POST /api/admin/cache/clear`

  - 描述：清理系统缓存（支持目录缓存、URL 缓存和搜索缓存）
  - 授权：需要管理员令牌
  - 请求体：
    ```json
    {
      "mountId": "挂载点ID", // 可选，清理特定挂载点的缓存
      "storageConfigId": "存储配置ID" // 可选，清理特定存储配置相关的缓存
      // 注意：如果两个参数都不提供，将清理所有缓存（目录、URL、搜索）
    }
    ```
  - 响应：清理结果
    ```json
    {
      "code": 200,
      "message": "缓存清理成功，共清理 75 项",
      "data": {
        "clearedCount": 75,
        "timestamp": "2023-05-01T12:00:00Z"
      },
      "success": true
    }
    ```

#### API 密钥用户缓存管理

- `POST /api/user/cache/clear`
  - 描述：API 密钥用户清理缓存（仅限其权限范围内的缓存）
  - 授权：需要有挂载权限的 API 密钥
  - 请求体：格式同管理员版本，但会自动限制在用户的 basic_path 权限范围内
    ```json
    {
      "mountId": "挂载点ID", // 可选，仅能清理用户有权限访问的挂载点
      "cacheType": "all" // 可选，缓存类型：all（默认）、directory、search
    }
    ```
  - 响应：清理结果（仅包含用户权限范围内的缓存清理统计）
  - 注意：API 密钥用户只能清理其 basic_path 权限范围内的缓存

### 挂载管理 API

#### 统一挂载点管理接口

- `GET /api/mount/list`

  - 描述：获取挂载点列表（统一接口，支持管理员和 API 密钥用户）
  - 授权：需要管理员令牌或有挂载权限的 API 密钥
  - 参数：无
  - 响应：挂载点列表和详细信息
  - 权限说明：
    - **管理员用户**：返回所有挂载点（包括禁用的），用于管理界面
    - **API 密钥用户**：只返回 basic_path 权限范围内的活跃挂载点

- `POST /api/mount/create`

  - 描述：创建新的挂载点（仅管理员）
  - 授权：需要管理员令牌
  - 请求体：
    ```json
    {
      "name": "挂载点名称", // 必填
      "storage_type": "S3", // 必填，存储类型：S3、WebDAV等
      "storage_config_id": "S3配置ID", // 当storage_type=S3时必填
      "mount_path": "/mount-path", // 必填，挂载路径
      "remark": "挂载点备注", // 可选
      "is_active": true, // 可选，是否启用，默认true
      "sort_order": 0, // 可选，排序顺序，默认0
      "cache_ttl": 300, // 可选，缓存TTL（秒），默认300
      "web_proxy": false, // 可选，是否启用Web代理，默认false
      "webdav_policy": "302_redirect", // 可选，WebDAV策略，默认302_redirect
      "enable_sign": false, // 可选，是否启用签名，默认false
      "sign_expires": null // 可选，签名过期时间
    }
    ```
  - 响应：新创建的挂载点信息

- `PUT /api/mount/:id`

  - 描述：更新挂载点信息（仅管理员）
  - 授权：需要管理员令牌
  - 参数：id - 挂载点 ID
  - 请求体：包含需要更新的字段，格式同创建
  - 响应：更新结果

- `DELETE /api/mount/:id`
  - 描述：删除挂载点（仅管理员）
  - 授权：需要管理员令牌
  - 参数：id - 挂载点 ID
  - 响应：删除结果

**注意**：

- 挂载点的创建、更新和删除操作仅限管理员执行
- API 密钥用户只能通过 `/api/mount/list` 查看其 basic_path 权限范围内的挂载点
- 统一接口根据用户权限自动返回相应的数据范围，无需区分不同的 API 端点

### 文件系统 API

文件系统 API 统一为 `/api/fs/*` 路径，支持管理员和 API 密钥用户认证。系统会根据认证信息自动处理权限和访问范围。

#### 统一文件系统操作

- `GET /api/fs/list`

  - 描述：列出目录内容
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 要列出内容的目录路径，默认为根目录("/")
  - 响应：目录内容列表，包含文件和子目录信息
  - 权限：API 密钥用户只能访问其 basic_path 权限范围内的目录
  - 路径密码行为（如启用目录密码）：
    - 额外请求头（可选）：
      ```http
      X-FS-Path-Token: encrypted:...
      ```
      - 该 token 由 `POST /api/fs/meta/password/verify` 接口返回；
      - 用于访问设置了路径密码的目录及其子目录。
    - 当目标路径未配置路径密码时：
      - 与原行为完全一致，不需要该头。
    - 当目标路径配置了路径密码时：
      - 管理员用户：
        - 不检查路径密码，直接放行（只要管理员登录有效）。
      - 非管理员用户（API Key 等）：
        - 未提供 token 或 token 无效 / 过期时：
          - 返回 `403`，`code = "FS_PATH_PASSWORD_REQUIRED"`；
          - 前端应据此弹出路径密码输入框，重新验证密码。

- `GET /api/fs/get`

  - 描述：获取文件信息
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 文件路径
  - 响应：文件详细信息
  - 权限：API 密钥用户只能访问其 basic_path 权限范围内的文件

- `GET /api/fs/download`

  - 描述：下载文件（强制下载）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 文件路径
  - 响应：文件内容（下载），包含 Content-Disposition: attachment 头
  - 权限：API 密钥用户只能下载其 basic_path 权限范围内的文件

- `POST /api/fs/mkdir`

  - 描述：创建目录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "要创建的目录路径" // 必填
    }
    ```
  - 响应：创建结果
  - 权限：API 密钥用户只能在其 basic_path 权限范围内创建目录

- `PUT /api/fs/upload`

  - 描述：通过“流式”方式上传文件（推荐），请求体为原始字节流，适合大文件或希望端到端流式的场景。
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 目标文件路径（必填，可以是目录或完整路径，具体行为由后端挂载配置决定）
    - `upload_id` - 上传进度 ID（可选，用于 `/api/upload/progress` 查询）
  - 请求头：
    - `Content-Type` - 文件 MIME 类型（可选，未提供时由后端推断或使用默认）
    - `Content-Length` - 文件大小（可选，建议提供，用于配额校验与限流）
    - `X-FS-Filename` - 文件名（可选，不提供时由 `path` 推断）
    - `X-FS-Options` - base64(JSON) 编码的上传行为参数（可选），例如：

      ```json
      {
        "overwrite": true,
        "originalFilename": false
      }
      ```

  - 请求体：文件原始字节流（ReadableStream / 二进制流）
  - 响应：上传结果（由后端通过统一的流式上传管线写入底层存储），示例：

    ```json
    {
      "code": 200,
      "message": "文件上传成功",
      "data": {
        "path": "/uploads/example.jpg",
        "size": 1024000,
        "etag": "abc123def456",
        "contentType": "image/jpeg"
      },
      "success": true
    }
    ```

  - 权限：API 密钥用户只能在其 basic_path 权限范围内上传文件

- `POST /api/fs/upload`

  - 描述：通过 `multipart/form-data` 表单上传文件（兼容模式），适合脚本调用或需要携带额外表单字段的场景。
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：FormData 格式
    - `file` - 文件内容（必填）
    - `path` - 上传目标路径，包含文件名或目录（必填）
    - `upload_id` - 上传进度 ID（可选，用于 `/api/upload/progress` 查询）
    - `overwrite` - 是否覆盖同名文件（可选，字符串 `"true"` / `"false"`）
    - `original_filename` - 是否保留原始文件名（可选，字符串 `"true"` / `"false"`）
  - 响应：上传结果，结构与流式上传一致（同样包含 path/size/etag/contentType 等字段）
  - 权限：API 密钥用户只能在其 basic_path 权限范围内上传文件

- `POST /api/fs/rename`

  - 描述：重命名文件或目录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "oldPath": "原路径", // 必填
      "newPath": "新路径" // 必填
    }
    ```
  - 响应：重命名结果
  - 权限：API 密钥用户只能重命名其 basic_path 权限范围内的文件或目录

- `DELETE /api/fs/batch-remove`

  - 描述：批量删除文件或目录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "paths": ["路径1", "路径2", "..."] // 必填，要删除项目的路径数组
    }
    ```
  - 响应：批量删除结果
  - 权限：API 密钥用户只能删除其 basic_path 权限范围内的文件或目录

- `GET /api/fs/file-link`

  - 描述：获取文件直链(预签名 URL)，可用于直接访问文件，无需再次身份验证
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 文件路径（必填）
    - `expires_in` - 链接有效期（秒），默认为 604800（7 天）
    - `force_download` - 是否强制下载，true 或 false（默认 false）
  - 响应：包含预签名 URL 的对象，可直接访问或分享
  - 权限：API 密钥用户只能获取其 basic_path 权限范围内文件的直链

- `POST /api/fs/update`

  - 描述：更新文件内容或创建新文件
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "文件路径", // 必填，包含文件名
      "content": "文件内容" // 必填，文件的新内容
    }
    ```
  - 响应：更新结果，包含文件路径、ETag、内容类型和是否为新创建的文件
  - 权限：API 密钥用户只能更新其 basic_path 权限范围内的文件

- `POST /api/fs/presign`

  - 描述：获取预签名上传 URL，用于直接上传文件到存储系统
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "上传目标路径", // 必填，目标目录路径
      "fileName": "文件名.jpg", // 必填，文件名
      "contentType": "文件MIME类型", // 可选，默认为application/octet-stream
      "fileSize": 1024000 // 可选，文件大小（字节）
    }
    ```
  - 响应：包含预签名 URL 和上传配置的对象
  - 权限：API 密钥用户只能在其 basic_path 权限范围内获取预签名 URL

- `POST /api/fs/presign/commit`

  - 描述：提交预签名上传，确认文件上传完成并更新元数据
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "targetPath": "上传目标路径", // 必填，完整的文件路径
      "mountId": "挂载点ID", // 必填，挂载点ID
      "fileSize": 1024000 // 可选，文件大小（字节）
    }
    ```
  - 响应：文件上传完成状态和文件信息
  - 权限：API 密钥用户只能在其 basic_path 权限范围内提交预签名上传

- `POST /api/fs/batch-copy`

  - 描述：批量复制文件或目录，支持自动重命名避免覆盖
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "items": [
        // 必填，要复制的项目数组
        {
          "sourcePath": "源路径1", // 必填，源文件或目录路径
          "targetPath": "目标路径1" // 必填，目标文件或目录路径
        },
        {
          "sourcePath": "源路径2",
          "targetPath": "目标路径2"
        }
      ],
      "skipExisting": false // 可选，是否跳过已存在的文件，默认为false（使用自动重命名）
    }
    ```
  - 响应：批量复制结果，包含成功、跳过和失败的项目数量
  - 特殊功能：
    - **自动重命名**：当目标文件/目录已存在时，自动重命名为 `file(1).txt`、`folder(1)/` 等格式
    - **跨存储复制**：支持不同存储类型之间的复制，响应中会包含`requiresClientSideCopy`标志和`crossStorageResults`数组
  - 权限：API 密钥用户只能在其 basic_path 权限范围内进行复制操作

- `POST /api/fs/batch-copy-commit`

  - 描述：提交批量跨存储复制完成信息
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "targetMountId": "目标挂载点ID", // 必填
      "files": [
        // 必填，已复制文件列表
        {
          "targetPath": "目标路径1", // 必填
          "storagePath": "存储路径1", // 必填
          "contentType": "文件MIME类型", // 可选
          "fileSize": 1024000, // 可选，文件大小（字节）
          "etag": "文件ETag" // 可选
        },
        {
          "targetPath": "目标路径2",
          "storagePath": "存储路径2"
        }
      ]
    }
    ```
  - 响应：提交结果，包含成功和失败的文件数量

- `GET /api/fs/search`

  - 描述：搜索文件和目录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `query` - 搜索关键词（必填，至少 2 个字符）
    - `scope` - 搜索范围（可选，默认为"global"）
      - `global` - 全局搜索，搜索所有可访问的挂载点
      - `mount` - 单个挂载点搜索，需要配合 mount_id 参数
      - `directory` - 目录搜索，搜索指定路径及其子目录，需要配合 path 参数
    - `mount_id` - 挂载点 ID（当 scope 为"mount"时必填）
    - `path` - 搜索路径（当 scope 为"directory"时必填）
    - `limit` - 结果数量限制（可选，默认 50，最大 200）
    - `offset` - 结果偏移量（可选，默认 0）
  - 响应：搜索结果
    ```json
    {
      "code": 200,
      "message": "搜索完成",
      "data": {
        "results": [
          {
            "name": "文件名.txt",
            "path": "/path/to/file.txt",
            "size": 1024,
            "lastModified": "2023-01-01T00:00:00.000Z",
            "isDirectory": false,
            "mimeType": "text/plain",
            "mountId": "mount-123",
            "mountName": "我的存储",
            "relativePath": "folder/file.txt"
          }
        ],
        "total": 25,
        "hasMore": false,
        "searchParams": {
          "query": "搜索关键词",
          "scope": "global",
          "limit": 50,
          "offset": 0
        },
        "mountsSearched": 3
      },
      "success": true
    }
    ```
  - 权限：API 密钥用户只能搜索其 basic_path 权限范围内的文件和目录

#### 分片上传 API

**重要说明**：分片上传 API 已统一为 `/api/fs/multipart/*` 路径，支持管理员和 API 密钥用户认证。

- `POST /api/fs/multipart/init`

  - 描述：初始化分片上传
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "上传目标路径", // 必填，包含文件名
      "contentType": "文件MIME类型", // 可选，默认为application/octet-stream
      "filename": "文件名.jpg" // 可选，如果path中未包含
    }
    ```
  - 响应：初始化信息，包含 uploadId 和其他元数据
  - 权限：API 密钥用户只能在其 basic_path 权限范围内初始化分片上传

- `POST /api/fs/multipart/part`

  - 描述：上传文件分片
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 上传目标路径（必填）
    - `uploadId` - 分片上传 ID（必填，来自 init 响应）
    - `partNumber` - 分片编号（必填，从 1 开始）
    - `isLastPart` - 是否为最后一个分片（可选，布尔值）
    - `key` - S3 存储键值（可选，来自 init 响应）
  - 请求体：分片内容（二进制）
  - 响应：分片上传结果，包含 ETag 等信息
  - 权限：API 密钥用户只能在其 basic_path 权限范围内上传分片

- `POST /api/fs/multipart/complete`

  - 描述：完成分片上传
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "上传目标路径", // 必填
      "uploadId": "分片上传ID", // 必填，来自init响应
      "parts": [
        // 必填，分片信息数组
        {
          "PartNumber": 1,
          "ETag": "分片1的ETag"
        },
        {
          "PartNumber": 2,
          "ETag": "分片2的ETag"
        }
      ],
      "key": "S3存储键值" // 可选，来自init响应
    }
    ```
  - 响应：上传完成结果
  - 权限：API 密钥用户只能在其 basic_path 权限范围内完成分片上传

- `POST /api/fs/multipart/abort`

  - 描述：中止分片上传
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "上传目标路径", // 必填
      "uploadId": "分片上传ID", // 必填，来自init响应
      "key": "S3存储键值" // 可选，来自init响应
    }
    ```
  - 响应：中止结果
  - 权限：API 密钥用户只能在其 basic_path 权限范围内中止分片上传

### WebDAV 接口

#### WebDAV 访问

- `WebDAV端点: /dav`

  - 描述：WebDAV 协议接入点，提供标准 WebDAV 协议访问
  - 支持的 WebDAV 方法：
    - `GET` - 获取文件内容
    - `PUT` - 上传文件
    - `DELETE` - 删除文件
    - `PROPFIND` - 获取文件/目录属性
    - `PROPPATCH` - 修改属性
    - `MKCOL` - 创建目录
    - `COPY` - 复制文件/目录
    - `MOVE` - 移动文件/目录
    - `LOCK` - 锁定资源，防止其他客户端修改
    - `UNLOCK` - 解锁之前锁定的资源
  - 授权：基本 HTTP 认证（Basic Auth）或 Bearer 令牌认证
    - Basic Auth: 使用 API 密钥（用户名和密码相同设置为 API 密钥值）或管理员凭据
    - Bearer Auth: 使用 API 密钥值或管理员令牌
  - 权限要求：
    - 管理员账户：自动拥有所有操作权限
    - API 密钥：需要具有挂载权限（mount_permission）

### 文件分享上传 API

#### 通过 `/api/share/upload` 上传并创建分享记录

支持三种主流程：

- 预签名分享上传：`POST /api/share/presign` → 客户端 PUT 上传 → `POST /api/share/commit`
- 表单分享上传：`POST /api/share/upload`（multipart/form-data）
- 流式分享上传：`PUT /api/share/upload`（流式 body）

1. `POST /api/share/presign`

  - 描述：为“上传即分享”生成预签名上传地址。
  - 授权：需要管理员令牌或有文件权限的 API 密钥。
  - 请求体：

    ```json
    {
      "filename": "文件名",          // 必填
      "fileSize": 123456,          // 必填，字节数
      "contentType": "video/mp4",  // 可选，MIME 类型
      "path": "/share/path",       // 可选，存储目录
      "storage_config_id": "uuid"  // 可选，存储配置 ID
    }
    ```

  - 响应（示例）：

    ```json
    {
      "success": true,
      "code": "OK",
      "message": "生成预签名成功",
      "data": {
        "uploadUrl": "https://...",
        "key": "对象存储键",
        "filename": "实际文件名",
        "storage_config_id": "uuid",
        "contentType": "video/mp4",
        "expiresIn": 3600
      }
    }
    ```

2. `POST /api/share/commit`

  - 描述：在预签名 PUT 完成后，创建分享记录。
  - 授权：需要管理员令牌或有文件权限的 API 密钥。
  - 请求体（示例）：

    ```json
    {
      "key": "对象存储键",          // 必填，来自 presign 响应
      "storage_config_id": "uuid", // 必填
      "filename": "文件名",        // 必填
      "size": 123456,             // 必填
      "etag": "etag 字符串",      // 可选
      "slug": "自定义短链",        // 可选
      "remark": "备注说明",        // 可选
      "password": "访问密码",      // 可选
      "expires_in": 24,           // 可选，过期时间（小时）
      "max_views": 100,           // 可选，最大访问次数
      "use_proxy": true,          // 可选
      "original_filename": false  // 可选
    }
    ```

  - 响应：返回完整的分享记录。

3. `POST /api/share/upload`（表单分享）

  - 描述：通过 multipart/form-data 上传文件并立即创建分享记录（多存储通用）。
  - 授权：需要管理员令牌或有文件权限的 API 密钥。
  - Content-Type：`multipart/form-data`
  - 表单字段：

    | 字段名            | 必填 | 说明                                |
         | ----------------- | ---- | ----------------------------------- |
    | `file`            | 是   | 上传文件（Blob）                    |
    | `storage_config_id` | 否 | 存储配置 ID，不填则由后端选择默认   |
    | `path`            | 否   | 存储目录路径                        |
    | `slug`            | 否   | 自定义分享短链                      |
    | `remark`          | 否   | 备注                                |
    | `password`        | 否   | 分享密码                            |
    | `expires_in`      | 否   | 过期时间（小时）                    |
    | `max_views`       | 否   | 最大查看次数                        |
    | `use_proxy`       | 否   | 是否通过本机代理访问存储            |
    | `original_filename` | 否 | 是否使用原始文件名                  |
    | `upload_id`       | 否   | 上传进度 ID（用于 `/api/upload/progress` 查询） |

  - 响应：返回创建好的分享记录。

4. `PUT /api/share/upload`（流式分享）

  - 描述：通过流式 PUT 上传文件并创建分享记录，适合较大文件和需要端到端流式的场景。
  - 授权：需要管理员令牌或有文件权限的 API 密钥。
  - URL：`/api/share/upload`
  - 请求头：

    | 名称               | 必填 | 说明                                        |
         | ------------------ | ---- | ------------------------------------------- |
    | `Content-Type`     | 否   | 文件 MIME 类型                             |
    | `Content-Length`   | 否   | 文件大小（建议提供，用于配额校验 / 日志） |
    | `X-Share-Filename` | 是   | 文件名，用于分享记录                        |
    | `X-Share-Options`  | 否   | base64(JSON) 的分享参数，结构见下         |

    `X-Share-Options` JSON 结构（示例）：

    ```json
    {
      "storage_config_id": "uuid",
      "path": "/share/path",
      "slug": "custom-slug",
      "remark": "备注说明",
      "password": "可选密码",
      "expires_in": 24,
      "max_views": 100,
      "use_proxy": true,
      "original_filename": false,
      "upload_id": "uuid"
    }
    ```

  - 请求体：文件原始字节流（ReadableStream）。
  - 响应：返回创建好的分享记录，结构与表单分享一致。

### URL 上传 API

#### 上传进度查询

- `GET /api/upload/progress`

  - 描述：查询指定上传任务的进度（公共 API，可用于 FS 上传、分享上传等所有使用 `upload_id` 的场景）。
  - 授权：无需认证（仅返回进度信息，不泄露敏感内容）。
  - 查询参数：

    - `upload_id` - 上传任务 ID（推荐使用此参数名）
    - `id` - 兼容参数名，与 `upload_id` 等价

  - 响应（示例：找到进度记录时）：

    ```json
    {
      "code": 200,
      "message": "获取上传进度成功",
      "success": true,
      "data": {
        "id": "a4c0e0c8-7e6a-4f21-9a2b-123456789abc",
        "loaded": 25165824,
        "total": 47444227,
        "completed": false,
        "path": "/mount/path/file.webm",
        "storageType": "S3",
        "updatedAt": 1763964944868
      }
    }
    ```

  - 响应（未找到进度记录时）：

    ```json
    {
      "code": 200,
      "message": "未找到上传进度记录",
      "success": true,
      "data": {
        "id": "a4c0e0c8-7e6a-4f21-9a2b-123456789abc",
        "loaded": 0,
        "total": null,
        "completed": false
      }
    }
    ```

  - 说明：
    - `loaded`：已上传字节数。
    - `total`：总字节数（驱动能够感知时才会填充，未知时为 null）。
    - `completed`：是否已完成（包括成功和失败后的完成态）。
    - `path`：后端已知的存储路径（如果驱动在进度更新中提供）。
    - `storageType`：底层存储类型（例如 `"S3"`、`"WEBDAV"`）。
    - `updatedAt`：最近一次更新进度的时间戳（毫秒）。

  - 注意事项：
    - Cloudflare Workers 环境下，进度信息保存在单个实例的内存中，属于“最佳努力”：不同请求如果打到不同实例，可能出现短时间内查不到进度的情况。
    - Docker/Node 环境下，由于所有请求共享同一进程，进度查询相对稳定。

#### URL 验证与元信息

- `POST /api/share/url/info`

  - 描述：验证 URL 并获取文件元信息
  - 授权：无需授权
  - 请求体：
    ```json
    {
      "url": "https://example.com/image.jpg" // 必填，要验证的URL
    }
    ```
  - 响应：包含 URL 文件的元信息，如文件名、大小、MIME 类型等

- `GET /api/share/url/proxy`

  - 描述：代理 URL 内容，用于不支持 CORS 的资源
  - 授权：无需授权
  - 查询参数：
    - `url` - 要代理的 URL（必填）
  - 响应：原始 URL 的内容流（适用于前端无法直接访问的资源）

#### URL 上传准备与提交

URL 上传在协议层复用前面的分享上传接口：

- 准备阶段：
  - 调用 `POST /api/share/url/info` 获取 URL 的文件名、大小、MIME 类型等元信息；
  - 前端将 URL 内容下载为文件（Blob），并根据存储类型选择上传策略：
    - 对 S3 存储：可以使用 `POST /api/share/presign` + PUT + `POST /api/share/commit` 走预签名上传；
    - 对所有存储（S3/WebDAV 等）：可以直接使用 `POST /api/share/upload`（表单上传）或 `PUT /api/share/upload`（流式上传），由后端写入存储并创建分享记录。

后续生成的分享记录结构与本地文件上传完全一致（同样包含 `slug`、预览/下载 URL、过期时间、最大访问次数等字段）。

## API 使用说明

### 错误处理

所有 API 在出错时返回统一的错误格式：

```json
{
  "code": 400,
  "message": "错误描述",
  "success": false
}
```

常见 HTTP 状态码：

- `200` - 成功
- `201` - 创建成功
- `400` - 请求参数错误
- `401` - 未授权
- `403` - 权限不足
- `404` - 资源不存在
- `409` - 资源冲突
- `410` - 资源已过期
- `500` - 服务器内部错误

### 分页参数

支持分页的 API 通常使用以下参数：

- `limit` - 每页数量，默认 30
- `offset` - 偏移量，默认 0
- `page` - 页码（部分 API 使用）

### 文件上传限制

- 最大文件大小由系统设置决定，可通过 `/api/system/max-upload-size`（公共 API）或 `/api/admin/settings?group=1`（管理员 API）查询
- 大文件建议使用分片上传或预签名 URL 上传
- API 密钥用户受 basic_path 路径限制

### 缓存机制

- 系统使用目录缓存提高性能
- 管理员和 API 密钥用户都可以手动清理缓存
- 文件操作会自动清理相关缓存

#### 搜索缓存

- 搜索结果会被缓存 5 分钟，提高重复搜索的响应速度
- 缓存键基于搜索参数、用户类型和用户信息生成
- 文件操作（上传、删除、重命名等）会自动清理相关的搜索缓存
- 搜索缓存支持按挂载点和用户维度进行清理
- 管理员可以通过 `/api/admin/cache/stats` 查看搜索缓存统计信息

---

## 目录 Meta 管理 API（FS Meta）

> 用于在管理后台配置目录级元信息：顶部/底部 README、隐藏文件规则、路径密码等。  
> 所有接口均 **仅限管理员** 使用。

- `GET /api/fs-meta/list`

  - 描述：获取所有目录元信息配置列表
  - 授权：需要管理员令牌
  - 查询参数：无
  - 响应：
    ```json
    {
      "code": 200,
      "message": "获取元信息列表成功",
      "success": true,
      "data": [
        {
          "id": 1,
          "path": "/claw",
          "headerMarkdown": "# 说明",
          "headerInherit": true,
          "footerMarkdown": null,
          "footerInherit": false,
          "hidePatterns": ["^README\\.md$"],
          "hideInherit": true,
          "password": "1234",
          "hasPassword": true,
          "passwordInherit": true,
          "createdAt": "2025-11-19T10:00:00.000Z",
          "updatedAt": "2025-11-19T10:10:00.000Z"
        }
      ]
    }
    ```

- `GET /api/fs-meta/:id`

  - 描述：获取单条目录元信息配置
  - 授权：需要管理员令牌
  - 路径参数：
    - `id` - 元信息记录 ID
  - 响应：结构与列表中的单条记录相同

- `POST /api/fs-meta/create`

  - 描述：为指定路径创建新的目录元信息配置
  - 授权：需要管理员令牌
  - 请求体示例：
    ```json
    {
      "path": "/claw",
      "headerMarkdown": "# 目录说明",
      "headerInherit": true,
      "footerMarkdown": "",
      "footerInherit": false,
      "hidePatterns": ["^README\\.md$", "^top\\.md$"],
      "hideInherit": true,
      "password": "1234",
      "passwordInherit": true
    }
    ```

- `PUT /api/fs-meta/:id`

  - 描述：更新指定 ID 的目录元信息配置
  - 授权：需要管理员令牌
  - 路径参数：
    - `id` - 元信息记录 ID
  - 请求体：与 `create` 基本一致，所有字段均为可选，未提供的字段保持不变
    ```json
    {
      "path": "/claw/image",
      "headerMarkdown": "子目录说明",
      "headerInherit": false,
      "footerMarkdown": null,
      "footerInherit": false,
      "hidePatterns": [],
      "hideInherit": false,
      "password": "9999",
      "passwordInherit": true
    }
    ```

- `DELETE /api/fs-meta/:id`

  - 描述：删除指定 ID 的目录元信息记录
  - 授权：需要管理员令牌
  - 路径参数：
    - `id` - 元信息记录 ID
