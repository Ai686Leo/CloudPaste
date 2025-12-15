# CloudPaste 后端服务 API 文档

## 目录

- [1. 基础信息](#1-基础信息)
- [2. 基础 API](#2-基础-api)
- [3. 认证与授权 API](#3-认证与授权-api)
- [4. 系统管理 API](#4-系统管理-api)
- [5. 文本分享 API](#5-文本分享-api)
- [6. 文件分享 API](#6-文件分享-api)
- [7. 存储配置 API](#7-存储配置-api)
- [8. 挂载管理 API](#8-挂载管理-api)
- [9. 文件系统 API (FS)](#9-文件系统-api-fs)
- [10. 目录元信息 API (FS Meta)](#10-目录元信息-api-fs-meta)
- [11. WebDAV API](#11-webdav-api)
- [12. 代理与链接解析 API](#12-代理与链接解析-api)
- [13. 上传相关 API](#13-上传相关-api)
- [附录](#附录)

---

## 1. 基础信息

### 统一返回格式

所有 API 返回格式统一为：

```json
{
  "code": 200,
  "message": "success",
  "data": {},
  "success": true
}
```


### 认证方式

#### 1. 管理员认证

使用 Bearer Token 认证，需要在请求头中添加：

```
Authorization: Bearer <admin_token>
```

管理员令牌通过 `/api/admin/login` 接口获取。

#### 2. API 密钥认证

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

- `15` = TEXT_SHARE + TEXT_MANAGE + FILE_SHARE + FILE_MANAGE (1+2+4+8)
- `771` = 基础权限 + MOUNT_UPLOAD (1+2+256+512)
- `7939` = 除 WebDAV 外的所有权限 (1+2+256+512+1024+2048+4096)
- `204559` = ALL_PERMISSIONS - 拥有所有权限

**路径限制：**

- **basic_path**: 路径权限限制 - 限制 API 密钥用户只能访问指定路径及其子路径

#### 3. WebDAV 认证

WebDAV 支持两种认证方式：

**Basic Auth（推荐）**

```
Authorization: Basic <base64(api_key:api_key)>
```

**Bearer Token**

```
Authorization: Bearer <api_key>
```

#### 4. 自定义授权头

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

---

## 2. 基础 API

### 健康检查

- `GET /api/health`
  - 描述：API 健康检查端点，用于监控服务状态
  - 授权：无需授权
  - 响应：
    ```json
    {
      "status": "ok",
      "timestamp": "2023-05-01T12:00:00Z"
    }
    ```

### 版本信息

- `GET /api/version`
  - 描述：获取系统版本信息
  - 授权：无需授权
  - 响应：包含版本号、应用名称、运行环境、存储类型、Node.js 版本和运行时间的系统信息
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

### 游客配置

- `GET /api/public/guest-config`
  - 描述：用于前端获取 Guest API 密钥配置，支持"游客模式"登录
  - 授权：无需授权
  - 响应：
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
          "file_share": true,
          "mount_view": true
        },
        "basic_path": "/public",
        "expires_at": "9999-12-31T23:59:59Z"
      }
    }
    ```

---

## 3. 认证与授权 API

### 管理员登录

- `POST /api/admin/login`
  - 描述：管理员登录
  - 授权：无需授权
  - 请求体：
    ```json
    {
      "username": "管理员用户名",
      "password": "管理员密码"
    }
    ```
  - 响应：
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

### 管理员登出

- `POST /api/admin/logout`
  - 描述：管理员登出
  - 授权：需要管理员令牌
  - 响应：登出结果

### 修改密码

- `POST /api/admin/change-password`
  - 描述：管理员修改密码
  - 授权：需要管理员令牌
  - 请求体：
    ```json
    {
      "currentPassword": "当前密码",
      "newPassword": "新密码",
      "newUsername": "新用户名"
    }
    ```
  - 响应：修改结果

### 令牌测试

- `GET /api/test/admin-token`
  - 描述：测试管理员令牌有效性
  - 授权：需要管理员令牌
  - 响应：
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
  - 响应：
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
          "mount_view": true
        }
      },
      "success": true
    }
    ```

### API 密钥管理

#### 获取密钥列表

- `GET /api/admin/api-keys`
  - 描述：获取所有 API 密钥列表
  - 授权：需要管理员令牌
  - 响应：API 密钥列表，包含每个密钥的权限和使用情况

#### 创建密钥

- `POST /api/admin/api-keys`
  - 描述：创建新的 API 密钥
  - 授权：需要管理员令牌
  - 请求体：
    ```json
    {
      "name": "密钥名称",
      "permissions": 7,
      "role": "GENERAL",
      "basic_path": "/",
      "is_guest": false,
      "expires_at": "2023-12-31T23:59:59Z",
      "custom_key": "custom-api-key-123"
    }
    ```
  - 响应：新创建的 API 密钥信息，包含完整的密钥值（仅在创建时返回）

#### 更新密钥

- `PUT /api/admin/api-keys/:id`
  - 描述：更新 API 密钥
  - 授权：需要管理员令牌
  - 参数：id - 密钥 ID
  - 请求体：与创建接口类似，所有字段均为可选
  - 响应：更新后的密钥信息

#### 删除密钥

- `DELETE /api/admin/api-keys/:id`
  - 描述：删除 API 密钥
  - 授权：需要管理员令牌
  - 参数：id - 密钥 ID
  - 响应：删除结果

#### 获取存储 ACL

- `GET /api/admin/api-keys/:id/storage-acl`
  - 描述：获取指定 API 密钥的存储 ACL 白名单
  - 授权：需要管理员令牌
  - 参数：id - 密钥 ID
  - 响应：
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

#### 更新存储 ACL

- `PUT /api/admin/api-keys/:id/storage-acl`
  - 描述：整体更新指定 API 密钥的存储 ACL 白名单
  - 授权：需要管理员令牌
  - 参数：id - 密钥 ID
  - 请求体：
    ```json
    {
      "storage_config_ids": ["config-id-a", "config-id-b"]
    }
    ```
  - 响应：更新后的存储 ACL 信息

---

## 4. 系统管理 API

### 系统设置

#### 获取系统设置

- `GET /api/admin/settings`
  - 描述：获取系统设置（支持按分组查询或获取所有分组）
  - 授权：无需授权（公开访问）
  - 查询参数：
    - `group` - 分组 ID（可选）：1=全局设置，3=WebDAV 设置
    - `metadata` - 是否包含元数据（可选，默认 true）
    - `includeSystem` - 是否包含系统内部分组（可选，默认 false）
  - 响应：按分组返回设置列表或所有分组的设置

#### 获取分组列表

- `GET /api/admin/settings/groups`
  - 描述：获取分组列表和统计信息
  - 授权：需要管理员令牌
  - 响应：分组信息列表

#### 获取设置元数据

- `GET /api/admin/settings/metadata`
  - 描述：获取设置项元数据
  - 授权：需要管理员令牌
  - 查询参数：
    - `key` - 设置键名（必填）
  - 响应：设置项的详细元数据

#### 批量更新设置

- `PUT /api/admin/settings/group/:groupId`
  - 描述：按分组批量更新设置
  - 授权：需要管理员令牌
  - 参数：groupId - 分组 ID
  - 查询参数：
    - `validate` - 是否进行类型验证（可选，默认 true）
  - 请求体：设置键值对
    ```json
    {
      "max_upload_size": 200,
      "default_paste_expiry": 14
    }
    ```
  - 响应：批量更新结果

#### 获取最大上传大小

- `GET /api/system/max-upload-size`
  - 描述：获取系统允许的最大上传文件大小（公共 API）
  - 授权：无需授权
  - 响应：
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

### 仪表盘统计

- `GET /api/admin/dashboard/stats`
  - 描述：获取管理员仪表盘统计数据
  - 授权：需要管理员令牌
  - 响应：系统统计数据，包含文本和文件使用情况、用户活跃度和系统性能指标

### 缓存管理

#### 获取缓存统计

- `GET /api/admin/cache/stats`
  - 描述：获取系统监控信息，包括缓存统计和系统内存信息
  - 授权：需要管理员令牌
  - 响应：缓存统计和系统信息

#### 清理缓存（管理员）

- `POST /api/admin/cache/clear`
  - 描述：清理系统缓存（支持目录缓存、URL 缓存和搜索缓存）
  - 授权：需要管理员令牌
  - 请求体：
    ```json
    {
      "mountId": "挂载点ID",
      "storageConfigId": "存储配置ID"
    }
    ```
  - 响应：清理结果

#### 清理缓存（用户）

- `POST /api/user/cache/clear`
  - 描述：API 密钥用户清理缓存（仅限其权限范围内的缓存）
  - 授权：需要有挂载权限的 API 密钥
  - 请求体：
    ```json
    {
      "mountId": "挂载点ID",
      "cacheType": "all"
    }
    ```
  - 响应：清理结果

### 备份与还原

#### 创建备份

- `POST /api/admin/backup/create`
  - 描述：创建系统数据备份
  - 授权：需要管理员令牌
  - 请求体：
    ```json
    {
      "backup_type": "full",
      "selected_modules": []
    }
    ```
  - 响应：备份文件（JSON格式），通过 Content-Disposition 头触发下载

#### 还原备份

- `POST /api/admin/backup/restore`
  - 描述：从备份文件还原系统数据
  - 授权：需要管理员令牌
  - 请求体：FormData 格式
    - `backup_file` - 备份文件（必填）
    - `mode` - 还原模式（可选，默认 overwrite）
  - 响应：还原结果

#### 获取备份模块

- `GET /api/admin/backup/modules`
  - 描述：获取可备份的模块列表和信息
  - 授权：需要管理员令牌
  - 响应：模块信息列表

---

## 5. 文本分享 API

### 创建文本分享

- `POST /api/paste`
  - 描述：创建新的文本分享
  - 授权：需要管理员令牌或有文本权限的 API 密钥
  - 请求体：
    ```json
    {
      "content": "要分享的文本内容",
      "title": "文本标题",
      "remark": "备注信息",
      "expires_at": "2023-12-31T23:59:59Z",
      "max_views": 100,
      "password": "访问密码",
      "slug": "custom-slug",
      "is_public": true
    }
    ```
  - 响应：创建的文本分享信息，包含访问链接

### 获取文本分享

- `GET /api/paste/:slug`
  - 描述：获取文本分享内容
  - 参数：slug - 文本短链接
  - 授权：无需授权（受 is_public、过期时间、最大查看次数和密码保护限制）
  - 响应：文本分享内容或元信息（如设置了密码）

- `POST /api/paste/:slug`
  - 描述：使用密码获取受保护的文本分享
  - 参数：slug - 文本短链接
  - 请求体：
    ```json
    {
      "password": "访问密码"
    }
    ```
  - 响应：验证成功后返回文本分享内容

- `GET /api/raw/:slug`
  - 描述：获取文本分享的原始内容（纯文本格式）
  - 参数：slug - 文本短链接
  - 查询参数：
    - `password` - 如果文本受密码保护，需提供密码
  - 响应：纯文本格式的内容

### 更新文本分享

- `PUT /api/pastes/:slug`
  - 描述：更新文本信息
  - 授权：需要管理员令牌或有文本权限的 API 密钥
  - 参数：slug - 文本短链接
  - 请求体：
    ```json
    {
      "content": "更新后的文本内容",
      "title": "更新后的标题",
      "remark": "更新后的备注信息",
      "expires_at": "2024-01-31T23:59:59Z",
      "max_views": 50,
      "password": "新密码",
      "clearPassword": true,
      "newSlug": "new-slug",
      "is_public": false
    }
    ```
  - 响应：更新后的文本信息

### 删除文本分享

- `DELETE /api/pastes/batch-delete`
  - 描述：批量删除文本
  - 授权：需要管理员令牌或有文本权限的 API 密钥
  - 请求体：
    ```json
    {
      "ids": ["文本ID1", "文本ID2", "文本ID3"]
    }
    ```
  - 响应：批量删除结果

### 查询文本列表

- `GET /api/pastes`
  - 描述：获取文本分享列表
  - 授权：需要管理员令牌或有文本权限的 API 密钥
  - 查询参数：
    - `page` - 页码（管理员用户）
    - `limit` - 每页数量
    - `offset` - 偏移量（API 密钥用户）
    - `created_by` - 按创建者筛选（管理员用户）
  - 响应：文本分享列表和分页信息

- `GET /api/pastes/:id`
  - 描述：获取单个文本详情
  - 授权：需要管理员令牌或有文本权限的 API 密钥
  - 参数：id - 文本 ID
  - 响应：文本分享详细信息

### 清理过期文本

- `POST /api/pastes/clear-expired`
  - 描述：清理过期文本（管理员专用）
  - 授权：需要管理员令牌
  - 响应：清理结果

---

## 6. 文件分享 API

### 公共文件查询

- `GET /api/share/get/:slug`
  - 描述：获取分享文件公开信息（控制面 JSON）
  - 参数：slug - 文件短链接
  - 授权：无需授权
  - 响应：包含文件基本信息 + 语义明确的 `previewUrl`/`downloadUrl`/`linkType` 等字段；若文件需要密码且未验证，则 `previewUrl`/`downloadUrl` 为 null。

- `POST /api/share/verify/:slug`
  - 描述：验证文件访问密码（成功后返回同 GET 的公开视图）
  - 参数：slug - 文件短链接
  - 请求体：
    ```json
    {
      "password": "文件密码"
    }
    ```
  - 响应：验证成功后返回包含 `previewUrl`/`downloadUrl` 的文件信息

### 文件管理

#### 获取文件列表

- `GET /api/files`
  - 描述：获取文件列表
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `limit` - 每页数量（默认 30）
    - `offset` - 偏移量（默认 0）
    - `created_by` - 按创建者筛选（管理员用户）
  - 响应：文件列表和分页信息

#### 获取文件详情

- `GET /api/files/:id`
  - 描述：获取单个文件详情
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 参数：id - 文件 ID
  - 查询参数（可选）：
    - `include=links` - 返回链接信息（`previewUrl`/`downloadUrl`/`linkType`/`documentPreview`）
    - `links=true` - 兼容写法，等价 `include=links`
  - 响应：
    - 默认：仅返回文件元信息（不包含任何链接字段）
    - `include=links` 时：在元信息基础上额外返回 `previewUrl`（预览入口）、`downloadUrl`（下载入口）、`linkType`（direct/url_proxy/proxy）以及 `documentPreview`

#### 更新文件信息

- `PUT /api/files/:id`
  - 描述：更新文件信息
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 参数：id - 文件 ID
  - 请求体：可包含 remark, slug, expires_at, max_views, password, use_proxy 等字段
  - 响应：更新后的文件信息

#### 批量删除文件

- `DELETE /api/files/batch-delete`
  - 描述：批量删除文件
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "ids": ["文件ID1", "文件ID2"],
      "delete_mode": "both"
    }
    ```
  - 响应：批量删除结果

### 文件分享上传

#### 预签名分享上传

- `POST /api/share/presign`
  - 描述：为"上传即分享"生成预签名上传地址
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "filename": "文件名",
      "fileSize": 123456,
      "contentType": "video/mp4",
      "path": "/share/path",
      "storage_config_id": "uuid"
    }
    ```
  - 响应：预签名上传 URL 和相关信息

- `POST /api/share/commit`
  - 描述：在预签名 PUT 完成后，创建分享记录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "key": "对象存储键",
      "storage_config_id": "uuid",
      "filename": "文件名",
      "size": 123456,
      "slug": "自定义短链",
      "password": "访问密码",
      "expires_in": 24,
      "max_views": 100
    }
    ```
  - 响应：完整的分享记录

#### 表单分享上传

- `POST /api/share/upload`
  - 描述：通过 multipart/form-data 上传文件并立即创建分享记录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - Content-Type：`multipart/form-data`
  - 表单字段：file, storage_config_id, path, slug, remark, password, expires_in, max_views, use_proxy, original_filename, upload_id
  - 响应：创建好的分享记录

#### 流式分享上传

- `PUT /api/share/upload`
  - 描述：通过流式 PUT 上传文件并创建分享记录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求头：
    - `Content-Type` - 文件 MIME 类型
    - `Content-Length` - 文件大小
    - `X-Share-Filename` - 文件名（必填）
    - `X-Share-Options` - base64(JSON) 的分享参数
  - 请求体：文件原始字节流
  - 响应：创建好的分享记录

### 文件分享内容访问

- `GET /api/s/:slug`
  - 描述：Share 本地代理内容入口（等价 FS 的本地代理语义），用于同源预览/下载
  - 参数：slug - 文件短链接
  - 授权：无需授权（受密码保护、过期时间、浏览次数限制）
  - 查询参数：
    - `password` - 文件密码（文件受密码保护时必填）
    - `down` - 下载语义开关（`true`/`1` 表示下载；不传或 `false` 表示预览）
    - `mode` - 旧版兼容参数（`attachment`/`download` 等价 `down=true`，`inline` 等价预览；新代码不推荐使用）
  - 响应：同源 200 文件内容流（始终后端代理，不做 302 外跳），支持 Range 断点续传/媒体流播放
  - 说明：直链 / url_proxy / Worker 等决策只体现在 `/api/share/get/:slug` 返回的 `previewUrl`/`downloadUrl`/`linkType` 上；`/api/s/:slug` 永远走本地代理

- `GET /api/share/content/:slug`
  - 描述：分享文件同源内容口（文本预览/编码检测专用）
  - 参数：slug - 文件短链接
  - 授权：无需授权（受密码保护、过期时间、浏览次数限制）
  - 查询参数：
    - `password` - 文件密码（文件受密码保护时必填）
  - 响应：同源 200 文件内容流（预览语义），支持 Range；不做 302 外跳

---

## 7. 存储配置 API

### 存储配置管理

#### 获取存储配置列表

- `GET /api/storage`
  - 描述：获取存储配置列表
  - 授权：需要管理员令牌或具有 `s3.config.read` 权限的 API 密钥
  - 查询参数：
    - `page` - 页码（管理员）
    - `limit` - 每页数量（管理员，默认 10）
  - 响应：存储配置列表（管理员获取全部，API 密钥用户仅获取公开+ACL白名单内的配置）

#### 获取存储配置详情

- `GET /api/storage/:id`
  - 描述：获取指定存储配置详情
  - 授权：需要管理员令牌或具有权限的 API 密钥
  - 参数：id - 存储配置 ID
  - 查询参数：
    - `reveal` - `plain` / `masked`（仅管理员），控制密钥字段显示方式
  - 响应：存储配置详情

#### 创建存储配置

- `POST /api/storage`
  - 描述：创建新的存储配置（管理员）
  - 授权：需要管理员令牌
  - 请求体：
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
  - 响应：新创建的存储配置

#### 更新存储配置

- `PUT /api/storage/:id`
  - 描述：更新存储配置（管理员）
  - 授权：需要管理员令牌
  - 参数：id - 存储配置 ID
  - 请求体：与创建接口类似，所有字段均为可选
  - 响应：更新成功状态

#### 删除存储配置

- `DELETE /api/storage/:id`
  - 描述：删除存储配置（管理员）
  - 授权：需要管理员令牌
  - 参数：id - 存储配置 ID
  - 响应：删除结果

#### 设置默认存储

- `PUT /api/storage/:id/set-default`
  - 描述：设置默认存储配置（管理员）
  - 授权：需要管理员令牌
  - 参数：id - 存储配置 ID
  - 响应：设置结果

#### 测试存储连接

- `POST /api/storage/:id/test`
  - 描述：测试存储配置连接有效性（管理员）
  - 授权：需要管理员令牌
  - 参数：id - 存储配置 ID
  - 响应：测试结果，包含连接状态和详细信息

### 存储类型能力查询

#### 获取存储类型能力

- `GET /api/storage-types/:type/capabilities`
  - 描述：获取指定存储类型支持的能力列表及元数据
  - 授权：需要管理员令牌或有挂载权限的 API 密钥
  - 参数：type - 存储类型（如 S3、WEBDAV 等）
  - 响应：存储类型的能力信息

#### 获取所有存储类型

- `GET /api/storage-types`
  - 描述：获取所有注册的存储类型及其能力与配置元数据信息
  - 授权：需要管理员令牌或有挂载权限的 API 密钥
  - 响应：所有存储类型的元数据列表

#### 获取挂载点配置Schema

- `GET /api/mount-schema`
  - 描述：获取挂载点表单的Schema定义，供前端动态渲染表单
  - 授权：需要管理员令牌
  - 响应：挂载点配置的JSON Schema

---

## 8. 挂载管理 API

### 挂载点管理

#### 获取挂载点列表

- `GET /api/mount/list`
  - 描述：获取挂载点列表
  - 授权：需要管理员令牌或有挂载权限的 API 密钥
  - 响应：挂载点列表和详细信息
  - 权限说明：
    - 管理员用户：返回所有挂载点（包括禁用的）
    - API 密钥用户：只返回 basic_path 权限范围内的活跃挂载点

#### 创建挂载点

- `POST /api/mount/create`
  - 描述：创建新的挂载点（仅管理员）
  - 授权：需要管理员令牌
  - 请求体：
    ```json
    {
      "name": "挂载点名称",
      "storage_type": "S3",
      "storage_config_id": "S3配置ID",
      "mount_path": "/mount-path",
      "remark": "挂载点备注",
      "is_active": true,
      "sort_order": 0,
      "cache_ttl": 300,
      "web_proxy": false,
      "webdav_policy": "302_redirect",
      "enable_sign": false,
      "sign_expires": null
    }
    ```
  - 响应：新创建的挂载点信息

#### 更新挂载点

- `PUT /api/mount/:id`
  - 描述：更新挂载点信息（仅管理员）
  - 授权：需要管理员令牌
  - 参数：id - 挂载点 ID
  - 请求体：包含需要更新的字段，格式同创建
  - 响应：更新结果

#### 删除挂载点

- `DELETE /api/mount/:id`
  - 描述：删除挂载点（仅管理员）
  - 授权：需要管理员令牌
  - 参数：id - 挂载点 ID
  - 响应：删除结果

---

## 9. 文件系统 API (FS)

### 目录浏览

- `GET /api/fs/list`
  - 描述：列出目录内容
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 要列出内容的目录路径，默认为根目录("/")
    - `path_token` - 路径密码验证令牌（可选；等价请求头 `X-FS-Path-Token`）
  - 请求头（可选）：
    - `X-FS-Path-Token` - 路径密码验证令牌（访问受密码保护的目录时需要；也可用 `path_token` 传递）
  - 响应：目录内容列表，包含文件和子目录信息

### 文件操作

#### 获取文件信息

- `GET /api/fs/get`
  - 描述：获取文件信息
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 文件路径
    - `path_token` - 路径密码验证令牌（可选；等价请求头 `X-FS-Path-Token`）
  - 请求头（可选）：
    - `X-FS-Path-Token` - 路径密码验证令牌（访问受密码保护的目录时需要；也可用 `path_token` 传递）
  - 响应：文件详细信息 + 语义明确的 `previewUrl`/`downloadUrl`/`linkType`/`documentPreview` 字段

#### 下载文件

- `GET /api/fs/download`
  - 描述：下载文件（attachment 语义，优先外部入口）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 文件路径
    - `path_token` - 路径密码验证令牌（可选；等价请求头 `X-FS-Path-Token`）
  - 请求头（可选）：
    - `X-FS-Path-Token` - 路径密码验证令牌（访问受密码保护的目录时需要；也可用 `path_token` 传递）
  - 响应：
    - 若可生成外部下载入口（直链 / url_proxy / 本地代理），返回 `302` 重定向到该 URL
    - 否则回退为同源 `200` 流式下载（支持 Range）

#### 获取文件内容（同源代理）

- `GET /api/fs/content`
  - 描述：同源返回 FS 文件原始内容（预览/文本编码检测专用，后端代理）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 文件路径（必填）
    - `path_token` - 路径密码验证令牌（可选；等价请求头 `X-FS-Path-Token`）
  - 请求头（可选）：
    - `X-FS-Path-Token` - 路径密码验证令牌（访问受密码保护的目录时需要；也可用 `path_token` 传递）
  - 响应：同源 `200` 文件内容流（预览语义），支持 Range；不做 `302` 外跳

#### 获取文件直链

- `GET /api/fs/file-link`
  - 描述：获取文件外部访问链接（直链 / url_proxy / 代理入口）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 文件路径（必填）
    - `expires_in` - 链接有效期（秒），默认为 604800（7 天）
    - `force_download` - 是否强制下载，true 或 false（默认 false）
    - `path_token` - 路径密码验证令牌（可选；等价请求头 `X-FS-Path-Token`）
  - 请求头（可选）：
    - `X-FS-Path-Token` - 路径密码验证令牌（访问受密码保护的目录时需要；也可用 `path_token` 传递）
  - 响应：
    ```json
    {
      "url": "最终可访问 URL",
      "linkType": "direct|url_proxy|proxy"
    }
    ```

#### 创建目录

- `POST /api/fs/mkdir`
  - 描述：创建目录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "要创建的目录路径"
    }
    ```
  - 响应：创建结果

#### 上传文件（流式）

- `PUT /api/fs/upload`
  - 描述：通过流式方式上传文件（推荐）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 目标文件路径（必填）
    - `upload_id` - 上传进度 ID（可选）
  - 请求头：
    - `Content-Type` - 文件 MIME 类型
    - `Content-Length` - 文件大小
    - `X-FS-Filename` - 文件名（可选）
    - `X-FS-Options` - base64(JSON) 编码的上传行为参数
  - 请求体：文件原始字节流
  - 响应：上传结果

#### 上传文件（表单）

- `POST /api/fs/upload`
  - 描述：通过 multipart/form-data 表单上传文件
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：FormData 格式
    - `file` - 文件内容（必填）
    - `path` - 上传目标路径（必填）
    - `upload_id` - 上传进度 ID（可选）
    - `overwrite` - 是否覆盖同名文件（可选）
    - `original_filename` - 是否保留原始文件名（可选）
  - 响应：上传结果

#### 更新文件内容

- `POST /api/fs/update`
  - 描述：更新文件内容或创建新文件
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "文件路径",
      "content": "文件内容"
    }
    ```
  - 响应：更新结果

#### 重命名文件

- `POST /api/fs/rename`
  - 描述：重命名文件或目录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "oldPath": "原路径",
      "newPath": "新路径"
    }
    ```
  - 响应：重命名结果

#### 批量删除

- `DELETE /api/fs/batch-remove`
  - 描述：批量删除文件或目录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "paths": ["路径1", "路径2", "..."]
    }
    ```
  - 响应：批量删除结果

#### 批量复制

- `POST /api/fs/batch-copy`
  - 描述：批量复制文件或目录，创建异步复制作业
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "items": [
        {
          "sourcePath": "源路径1",
          "targetPath": "目标路径1"
        }
      ],
      "skipExisting": false
    }
    ```
  - 响应：作业 ID 和初始状态

### 搜索

- `GET /api/fs/search`
  - 描述：搜索文件和目录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `query` - 搜索关键词（必填，至少 2 个字符）
    - `scope` - 搜索范围（可选，默认为"global"）：global / mount / directory
    - `mount_id` - 挂载点 ID（当 scope 为"mount"时必填）
    - `path` - 搜索路径（当 scope 为"directory"时必填）
    - `limit` - 结果数量限制（可选，默认 50，最大 200）
    - `offset` - 结果偏移量（可选，默认 0）
  - 响应：搜索结果列表

### 预签名上传

#### 获取预签名 URL

- `POST /api/fs/presign`
  - 描述：获取预签名上传 URL
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "上传目标路径",
      "fileName": "文件名.jpg",
      "contentType": "文件MIME类型",
      "fileSize": 1024000
    }
    ```
  - 响应：包含预签名 URL 和上传配置的对象

#### 提交预签名上传

- `POST /api/fs/presign/commit`
  - 描述：提交预签名上传，确认文件上传完成
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "targetPath": "上传目标路径",
      "mountId": "挂载点ID",
      "fileSize": 1024000
    }
    ```
  - 响应：文件上传完成状态和文件信息

### 分片上传

#### 初始化分片上传

- `POST /api/fs/multipart/init`
  - 描述：初始化分片上传
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "上传目标路径",
      "contentType": "文件MIME类型",
      "filename": "文件名.jpg"
    }
    ```
  - 响应：初始化信息，包含 uploadId 和其他元数据

#### 上传文件分片

- `POST /api/fs/multipart/part`
  - 描述：上传文件分片
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `path` - 上传目标路径（必填）
    - `uploadId` - 分片上传 ID（必填）
    - `partNumber` - 分片编号（必填，从 1 开始）
    - `isLastPart` - 是否为最后一个分片（可选）
    - `key` - S3 存储键值（可选）
  - 请求体：分片内容（二进制）
  - 响应：分片上传结果，包含 ETag 等信息

#### 完成分片上传

- `POST /api/fs/multipart/complete`
  - 描述：完成分片上传
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "上传目标路径",
      "uploadId": "分片上传ID",
      "parts": [
        {
          "PartNumber": 1,
          "ETag": "分片1的ETag"
        }
      ],
      "key": "S3存储键值"
    }
    ```
  - 响应：上传完成结果

#### 中止分片上传

- `POST /api/fs/multipart/abort`
  - 描述：中止分片上传
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "上传目标路径",
      "uploadId": "分片上传ID",
      "key": "S3存储键值"
    }
    ```
  - 响应：中止结果

#### 列出进行中的分片上传

- `POST /api/fs/multipart/list-uploads`
  - 描述：列出指定路径下进行中的分片上传
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "/uploads"
    }
    ```
  - 响应：进行中的分片上传列表

#### 列出已上传的分片

- `POST /api/fs/multipart/list-parts`
  - 描述：列出指定上传任务已上传的分片
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "上传目标路径",
      "uploadId": "upload-uuid-123",
      "fileName": "文件名.mp4"
    }
    ```
  - 响应：已上传的分片列表

#### 刷新分片上传预签名URL

- `POST /api/fs/multipart/refresh-urls`
  - 描述：刷新指定分片的预签名上传URL（当URL过期时使用）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "path": "上传目标路径",
      "uploadId": "upload-uuid-123",
      "partNumbers": [3, 4, 5]
    }
    ```
  - 响应：新的预签名URL列表

### 作业系统

#### 创建作业

- `POST /api/fs/jobs`
  - 描述：创建通用作业（如复制、移动等异步任务）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 请求体：
    ```json
    {
      "taskType": "copy",
      "items": [
        {
          "sourcePath": "源路径1",
          "targetPath": "目标路径1"
        }
      ],
      "skipExisting": false,
      "maxConcurrency": 10
    }
    ```
  - 响应：作业描述符

#### 获取作业状态

- `GET /api/fs/jobs/:jobId`
  - 描述：获取指定作业的状态和进度
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 参数：jobId - 作业 ID
  - 响应：作业状态详情

#### 取消作业

- `POST /api/fs/jobs/:jobId/cancel`
  - 描述：取消正在运行的作业
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 参数：jobId - 作业 ID
  - 响应：取消结果

#### 列出作业

- `GET /api/fs/jobs`
  - 描述：列出作业列表（支持筛选）
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 查询参数：
    - `taskType` - 任务类型（可选）
    - `status` - 作业状态（可选）
    - `limit` - 每页数量（可选，默认 20）
    - `offset` - 偏移量（可选，默认 0）
  - 响应：作业列表

#### 删除作业

- `DELETE /api/fs/jobs/:jobId`
  - 描述：删除已完成或已取消的作业记录
  - 授权：需要管理员令牌或有文件权限的 API 密钥
  - 参数：jobId - 作业 ID
  - 响应：删除结果

---

## 10. 目录元信息 API (FS Meta)

### 目录配置管理

#### 获取元信息列表

- `GET /api/fs-meta/list`
  - 描述：获取所有目录元信息配置列表
  - 授权：需要管理员令牌
  - 响应：目录元信息配置列表

#### 获取单条元信息

- `GET /api/fs-meta/:id`
  - 描述：获取单条目录元信息配置
  - 授权：需要管理员令牌
  - 参数：id - 元信息记录 ID
  - 响应：元信息配置详情

#### 创建元信息

- `POST /api/fs-meta/create`
  - 描述：为指定路径创建新的目录元信息配置
  - 授权：需要管理员令牌
  - 请求体：
    ```json
    {
      "path": "/claw",
      "headerMarkdown": "# 目录说明",
      "headerInherit": true,
      "footerMarkdown": "",
      "footerInherit": false,
      "hidePatterns": ["^README\\.md$"],
      "hideInherit": true,
      "password": "1234",
      "passwordInherit": true
    }
    ```
  - 响应：新创建的元信息配置

#### 更新元信息

- `PUT /api/fs-meta/:id`
  - 描述：更新指定 ID 的目录元信息配置
  - 授权：需要管理员令牌
  - 参数：id - 元信息记录 ID
  - 请求体：与创建接口类似，所有字段均为可选
  - 响应：更新后的元信息配置

#### 删除元信息

- `DELETE /api/fs-meta/:id`
  - 描述：删除指定 ID 的目录元信息记录
  - 授权：需要管理员令牌
  - 参数：id - 元信息记录 ID
  - 响应：删除结果

### 路径密码验证

- `POST /api/fs/meta/password/verify`
  - 描述：验证目录路径密码，获取访问令牌
  - 授权：无需授权（公开访问）
  - 请求体：
    ```json
    {
      "path": "/protected/directory",
      "password": "directory-password"
    }
    ```
  - 响应：验证成功后返回访问令牌

---

## 11. WebDAV API

### WebDAV 访问

- **WebDAV端点**: `/dav`
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
    - `LOCK` - 锁定资源
    - `UNLOCK` - 解锁资源
  - 授权：基本 HTTP 认证（Basic Auth）或 Bearer 令牌认证
    - Basic Auth: 使用 API 密钥（用户名和密码相同设置为 API 密钥值）或管理员凭据
    - Bearer Auth: 使用 API 密钥值或管理员令牌
  - 权限要求：
    - 管理员账户：自动拥有所有操作权限
    - API 密钥：需要具有挂载权限（mount_permission）

---

## 12. 代理与链接解析 API

### 统一存储链接解析

- `POST /api/proxy/link`
  - 描述：统一存储链接解析接口
  - 授权：支持管理员令牌、API 密钥或匿名访问
  - 请求体：
    ```json
    {
      "type": "fs",
      "path": "/mount/path/file.ext"
    }
    ```
    或
    ```json
    {
      "type": "share",
      "slug": "file-slug"
    }
    ```
  - 响应：
    ```json
    {
      "code": 200,
      "data": {
        "url": "https://storage.example.com/file.ext",
        "header": {
          "Authorization": ["Bearer token"],
          "Content-Type": ["application/octet-stream"]
        }
      }
    }
    ```
  - 说明：
    - `type = "fs"` - 使用 path 解析挂载视图（包含 WebDAV）
    - `type = "share"` - 使用 slug 解析分享视图
    - 反向代理/Proxy 服务调用此接口获取 `{ url, header }`，然后直接向 url 发起请求

### 文件系统代理访问

- `GET /p/*`
  - 描述：文件系统代理访问路由（web_proxy 功能）
  - 路径格式：`/p/mount/path/file.ext`
  - 授权：根据挂载点配置决定是否需要签名验证
  - 查询参数：
    - `download` - 是否强制下载（可选，默认 false）
    - `sign` - 签名参数（当挂载点启用签名时必填）
  - 响应：文件内容流
  - 说明：
    - 专门用于 web_proxy 功能的文件代理访问
    - 支持 Range 请求，实现断点续传和视频流播放
    - 当挂载点配置 `enable_sign = true` 时，需要提供有效签名
    - 签名验证失败返回 401 Unauthorized
    - 所有访问会记录审计日志

---

## 13. 上传相关 API

### 上传进度查询

- `GET /api/upload/progress`
  - 描述：查询指定上传任务的进度
  - 授权：无需认证
  - 查询参数：
    - `upload_id` - 上传任务 ID（推荐）
    - `id` - 兼容参数名，与 upload_id 等价
  - 响应：
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

### URL 上传

#### 验证 URL 并获取元信息

- `POST /api/share/url/info`
  - 描述：验证 URL 并获取文件元信息
  - 授权：无需授权
  - 请求体：
    ```json
    {
      "url": "https://example.com/image.jpg"
    }
    ```
  - 响应：包含 URL 文件的元信息

#### 代理 URL 内容

- `GET /api/share/url/proxy`
  - 描述：代理 URL 内容，用于不支持 CORS 的资源
  - 授权：无需授权
  - 查询参数：
    - `url` - 要代理的 URL（必填）
  - 响应：原始 URL 的内容流

---

## 附录

### 错误处理

所有 API 在出错时返回统一的错误格式：

```json
{
  "code": 400,
  "message": "错误描述",
  "success": false
}
```

**常见 HTTP 状态码：**

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

- 最大文件大小由系统设置决定，可通过 `/api/system/max-upload-size` 查询
- 大文件建议使用分片上传或预签名 URL 上传
- API 密钥用户受 basic_path 路径限制

### 缓存机制

- 系统使用目录缓存提高性能
- 管理员和 API 密钥用户都可以手动清理缓存
- 文件操作会自动清理相关缓存
- 搜索结果会被缓存 5 分钟

---
