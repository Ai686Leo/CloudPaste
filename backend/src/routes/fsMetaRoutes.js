/**
 * FS Meta 管理路由
 * 提供目录元信息的 CRUD 操作接口
 */
import { Hono } from "hono";
import { ApiStatus, UserType } from "../constants/index.js";
import { jsonOk, jsonCreated } from "../utils/common.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";
import { ValidationError } from "../http/errors.js";

const fsMetaRoutes = new Hono();

// 只有管理员可以管理元信息
const requireAdmin = usePolicy("admin.all");

/**
 * 获取所有元信息记录
 * GET /api/fs-meta/list
 */
fsMetaRoutes.get("/api/fs-meta/list", requireAdmin, async (c) => {
  const repositoryFactory = c.get("repos");
  const fsMetaRepository = repositoryFactory.getFsMetaRepository();

  const records = await fsMetaRepository.findAll();

  // 转换为前端友好格式（隐藏密码哈希）
  const sanitized = records.map((record) => ({
    id: record.id,
    path: record.path,
    headerMarkdown: record.header_markdown,
    headerInherit: Boolean(record.header_inherit),
    footerMarkdown: record.footer_markdown,
    footerInherit: Boolean(record.footer_inherit),
    hidePatterns: record.hide_patterns ? JSON.parse(record.hide_patterns) : [],
    hideInherit: Boolean(record.hide_inherit),
    // 明文密码仅用于管理端查看/复制
    password: record.password,
    hasPassword: Boolean(record.password),
    passwordInherit: Boolean(record.password_inherit),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }));

  return jsonOk(c, sanitized, "获取元信息列表成功");
});

/**
 * 获取单个元信息记录
 * GET /api/fs-meta/:id
 */
fsMetaRoutes.get("/api/fs-meta/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const repositoryFactory = c.get("repos");
  const fsMetaRepository = repositoryFactory.getFsMetaRepository();

  const record = await fsMetaRepository.findById(Number(id));

  if (!record) {
    throw new ValidationError("元信息记录不存在");
  }

  const sanitized = {
    id: record.id,
    path: record.path,
    headerMarkdown: record.header_markdown,
    headerInherit: Boolean(record.header_inherit),
    footerMarkdown: record.footer_markdown,
    footerInherit: Boolean(record.footer_inherit),
    hidePatterns: record.hide_patterns ? JSON.parse(record.hide_patterns) : [],
    hideInherit: Boolean(record.hide_inherit),
    password: record.password,
    hasPassword: Boolean(record.password),
    passwordInherit: Boolean(record.password_inherit),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };

  return jsonOk(c, sanitized, "获取元信息成功");
});

/**
 * 创建元信息记录
 * POST /api/fs-meta/create
 */
fsMetaRoutes.post("/api/fs-meta/create", requireAdmin, async (c) => {
  const repositoryFactory = c.get("repos");
  const fsMetaRepository = repositoryFactory.getFsMetaRepository();
  const body = await c.req.json();

  // 验证必填字段
  if (!body.path || typeof body.path !== "string") {
    throw new ValidationError("路径不能为空");
  }

  // 检查路径是否已存在
  const existing = await fsMetaRepository.findByPath(body.path);
  if (existing) {
    throw new ValidationError("该路径的元信息已存在");
  }

  // 准备数据
  const data = {
    path: body.path,
    header_markdown: body.headerMarkdown || null,
    header_inherit: body.headerInherit || false,
    footer_markdown: body.footerMarkdown || null,
    footer_inherit: body.footerInherit || false,
    hide_patterns: body.hidePatterns && Array.isArray(body.hidePatterns) ? JSON.stringify(body.hidePatterns) : null,
    hide_inherit: body.hideInherit || false,
    password: null,
    password_inherit: body.passwordInherit || false,
  };

  // 处理密码（如果提供，直接以明文保存）
  if (body.password && typeof body.password === "string" && body.password.trim().length > 0) {
    data.password = body.password.trim();
  }

  const created = await fsMetaRepository.create(data);

  return jsonCreated(c, { id: created.id }, "元信息创建成功");
});

/**
 * 更新元信息记录
 * PUT /api/fs-meta/:id
 */
fsMetaRoutes.put("/api/fs-meta/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const repositoryFactory = c.get("repos");
  const fsMetaRepository = repositoryFactory.getFsMetaRepository();
  const body = await c.req.json();

  // 验证记录是否存在
  const existing = await fsMetaRepository.findById(Number(id));
  if (!existing) {
    throw new ValidationError("元信息记录不存在");
  }

  // 如果修改了路径，检查新路径是否冲突
  if (body.path && body.path !== existing.path) {
    const conflict = await fsMetaRepository.findByPath(body.path);
    if (conflict) {
      throw new ValidationError("该路径的元信息已存在");
    }
  }

  // 准备更新数据
  const updates = {};

  if (body.path !== undefined) updates.path = body.path;
  if (body.headerMarkdown !== undefined) updates.header_markdown = body.headerMarkdown;
  if (body.headerInherit !== undefined) updates.header_inherit = body.headerInherit;
  if (body.footerMarkdown !== undefined) updates.footer_markdown = body.footerMarkdown;
  if (body.footerInherit !== undefined) updates.footer_inherit = body.footerInherit;
  if (body.hidePatterns !== undefined) {
    updates.hide_patterns = Array.isArray(body.hidePatterns) ? JSON.stringify(body.hidePatterns) : null;
  }
  if (body.hideInherit !== undefined) updates.hide_inherit = body.hideInherit;
  if (body.passwordInherit !== undefined) updates.password_inherit = body.passwordInherit;

  // 处理密码更新（仅当显式提供时）
  if (body.password !== undefined) {
    if (body.password && typeof body.password === "string" && body.password.trim().length > 0) {
      updates.password = body.password.trim();
    } else {
      // 空字符串表示清除密码
      updates.password = null;
    }
  }

  await fsMetaRepository.update(Number(id), updates);

  return jsonOk(c, undefined, "元信息更新成功");
});

/**
 * 删除元信息记录
 * DELETE /api/fs-meta/:id
 */
fsMetaRoutes.delete("/api/fs-meta/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const repositoryFactory = c.get("repos");
  const fsMetaRepository = repositoryFactory.getFsMetaRepository();

  const existing = await fsMetaRepository.findById(Number(id));
  if (!existing) {
    throw new ValidationError("元信息记录不存在");
  }

  await fsMetaRepository.delete(Number(id));

  return jsonOk(c, undefined, "元信息删除成功");
});

export default fsMetaRoutes;
