import { ApiStatus } from "../../constants/index.js";
import { AppError, ValidationError, AuthenticationError } from "../../http/errors.js";
import { jsonOk } from "../../utils/common.js";
import { getPasteBySlug, verifyPastePassword, incrementAndCheckPasteViews, isPasteAccessible } from "../../services/pasteService.js";

export const registerPastesPublicRoutes = (router) => {
  router.get("/api/paste/:slug", async (c) => {
    const db = c.env.DB;
    const slug = c.req.param("slug");

    const paste = await getPasteBySlug(db, slug);

    if (paste.has_password) {
      return jsonOk(c, {
        slug: paste.slug,
        hasPassword: true,
        remark: paste.remark,
        expires_at: paste.expires_at,
        max_views: paste.max_views,
        views: paste.views,
        created_at: paste.created_at,
        created_by: paste.created_by,
        requiresPassword: true,
      }, "获取文本信息成功");
    }

    if (!isPasteAccessible(paste)) {
      throw new AppError("文本分享已过期或超过最大查看次数", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
    }

    const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

    if (result.isLastNormalAccess) {
      return jsonOk(c, {
        slug: paste.slug,
        content: paste.content,
        remark: paste.remark,
        expires_at: paste.expires_at,
        max_views: paste.max_views,
        views: result.paste.views,
        created_at: paste.created_at,
        created_by: paste.created_by,
        hasPassword: false,
        isLastView: true,
      }, "获取文本内容成功");
    }

    if (result.isDeleted) {
      throw new AppError("文本分享已达到最大查看次数", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
    }

    return jsonOk(c, {
      slug: paste.slug,
      content: paste.content,
      remark: paste.remark,
      expires_at: paste.expires_at,
      max_views: paste.max_views,
      views: result.paste.views,
      created_at: paste.created_at,
      created_by: paste.created_by,
      hasPassword: false,
      isLastView: result.isLastView,
    }, "获取文本内容成功");
  });

  router.post("/api/paste/:slug", async (c) => {
    const db = c.env.DB;
    const slug = c.req.param("slug");
    const { password } = await c.req.json();

    if (!password) {
      throw new ValidationError("请提供密码");
    }

    const paste = await verifyPastePassword(db, slug, password, false);
    const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

    if (result.isLastNormalAccess) {
      return jsonOk(c, {
        slug: paste.slug,
        content: paste.content,
        remark: paste.remark,
        hasPassword: true,
        plain_password: paste.plain_password,
        expires_at: paste.expires_at,
        max_views: paste.max_views,
        views: result.paste.views,
        created_at: paste.created_at,
        updated_at: paste.updated_at,
        created_by: paste.created_by,
        isLastView: true,
      }, "密码验证成功");
    }

    if (result.isDeleted) {
      throw new AppError("文本分享已达到最大查看次数", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
    }

    return jsonOk(c, {
      slug: paste.slug,
      content: paste.content,
      remark: paste.remark,
      hasPassword: true,
      plain_password: paste.plain_password,
      expires_at: paste.expires_at,
      max_views: paste.max_views,
      views: result.paste.views,
      created_at: paste.created_at,
      updated_at: paste.updated_at,
      created_by: paste.created_by,
      isLastView: result.isLastView,
    }, "获取文本内容成功");
  });

  router.get("/api/raw/:slug", async (c) => {
    const db = c.env.DB;
    const slug = c.req.param("slug");
    const password = c.req.query("password");

    const run = async () => {
      const paste = await getPasteBySlug(db, slug);

      if (paste.has_password) {
        if (!password) {
          throw new AuthenticationError("需要密码才能访问此内容");
        }

        await verifyPastePassword(db, slug, password, false).catch(() => {
          throw new AuthenticationError("密码错误");
        });

        const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

        if (result.isDeleted && !result.isLastNormalAccess) {
          throw new AppError("文本分享已达到最大查看次数", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
        }
      } else if (!isPasteAccessible(paste)) {
        throw new AppError("文本分享已过期或超过最大查看次数", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
      }

      c.header("Content-Type", "text/plain; charset=utf-8");
      c.header("Content-Disposition", `inline; filename="${slug}.txt"`);
      return c.text(paste.content);
    };

    return run().catch((error) => {
      console.error("获取原始文本内容失败:", error);
      c.header("Content-Type", "text/plain; charset=utf-8");

      if (error instanceof AppError) {
        return c.text(error.message, error.status);
      }

      return c.text("获取内容失败", ApiStatus.INTERNAL_ERROR);
    });
  });
};
