import { ApiStatus, UserType } from "../../constants/index.js";
import { AppError, ValidationError, AuthenticationError, NotFoundError } from "../../http/errors.js";
import { jsonOk } from "../../utils/common.js";
import { getPasteBySlug, verifyPastePassword, incrementAndCheckPasteViews, isPasteAccessible } from "../../services/pasteService.js";
import { resolvePrincipal } from "../../security/helpers/principal.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { useRepositories } from "../../utils/repositories.js";
import { ProxySignatureService } from "../../services/ProxySignatureService.js";
import { PASTE_URL_PROXY_TICKET_PATH } from "./urlProxyConfig.js";

// 可选解析当前访问者身份（管理员 / API Key 用户），匿名时返回 null
const resolveOptionalPrincipal = (c) => {
  try {
    const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY], allowGuest: true });
    return identity;
  } catch (e) {
    return null;
  }
};

// 检查当前访问者是否有权访问指定文本（用于 is_public 控制）
const ensurePasteVisibility = (c, paste) => {
  if (!paste) return;

  // 公开文本：任何持有链接的人都可以访问
  if (paste.is_public === 1 || paste.is_public === true || paste.is_public === null || paste.is_public === undefined) {
    return;
  }

  // 非公开文本：仅管理员和创建者可访问
  const identity = resolveOptionalPrincipal(c);
  if (!identity) {
    // 匿名或无法识别身份时直接隐藏资源存在性
    throw new NotFoundError("文本分享不存在或已被删除");
  }

  if (identity.isAdmin) {
    return;
  }

  const createdBy = paste.created_by;
  const userId = identity.userId;

  // 对于 API Key 用户，created_by 形如 "apikey:<id>"
  const isApiKeyOwner = identity.type === UserType.API_KEY && typeof createdBy === "string" && createdBy === `apikey:${userId}`;

  if (!isApiKeyOwner) {
    throw new NotFoundError("文本分享不存在或已被删除");
  }
};

export const registerPastesPublicRoutes = (router) => {
  // URL 内容代理（Query Ticket 版）
  // - 供 SnapDOM useProxy 使用：浏览器侧资源请求无法携带 Authorization Header
  // - 通过 ticket 做短期校验，避免把 /api/share/url/proxy 直接开放给匿名请求
  router.get("/api/paste/url/proxy", async (c) => {
    const db = c.env.DB;
    const url = c.req.query("url");
    const ticket = c.req.query("ticket");

    if (!url) {
      throw new ValidationError("缺少URL参数");
    }
    if (!ticket) {
      throw new AuthenticationError("缺少代理票据");
    }

    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = useRepositories(c);

    const signatureService = new ProxySignatureService(db, encryptionSecret, repositoryFactory);
    const verifyResult = signatureService.verifyStorageSignature(PASTE_URL_PROXY_TICKET_PATH, ticket);
    if (!verifyResult.valid) {
      throw new AuthenticationError(`代理票据无效: ${verifyResult.reason}`);
    }

    const { FileShareService } = await import("../../services/fileShareService.js");
    const shareService = new FileShareService(db, encryptionSecret);
    return await shareService.proxyUrlContent(url);
  });

  router.get("/api/paste/:slug", async (c) => {
    const db = c.env.DB;
    const slug = c.req.param("slug");

    const paste = await getPasteBySlug(db, slug);

    // 先根据 is_public 与当前访客身份控制访问
    ensurePasteVisibility(c, paste);

    if (paste.has_password) {
      // 加密文本在验证密码前不应泄露标题、备注等敏感信息
      return jsonOk(
        c,
        {
          slug: paste.slug,
          hasPassword: true,
          requiresPassword: true,
        },
        "需要密码验证"
      );
    }

    if (!isPasteAccessible(paste)) {
      throw new AppError("文本分享已过期或超过最大查看次数", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
    }

    const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

    if (result.isLastNormalAccess) {
      return jsonOk(c, {
        slug: paste.slug,
        title: paste.title,
        content: paste.content,
        remark: paste.remark,
        expires_at: paste.expires_at,
        max_views: paste.max_views,
        views: result.paste.views,
        created_at: paste.created_at,
        created_by: paste.created_by,
        is_public: paste.is_public,
        hasPassword: false,
        isLastView: true,
      }, "获取文本内容成功");
    }

    if (result.isDeleted) {
      throw new AppError("文本分享已达到最大查看次数", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
    }

    return jsonOk(c, {
      slug: paste.slug,
      title: paste.title,
      content: paste.content,
      remark: paste.remark,
      expires_at: paste.expires_at,
      max_views: paste.max_views,
      views: result.paste.views,
      created_at: paste.created_at,
      created_by: paste.created_by,
      is_public: paste.is_public,
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

    // 再次根据 is_public 与当前访客身份控制访问
    ensurePasteVisibility(c, paste);
    const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

    if (result.isLastNormalAccess) {
      return jsonOk(c, {
        slug: paste.slug,
        title: paste.title,
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
        is_public: paste.is_public,
        isLastView: true,
      }, "密码验证成功");
    }

    if (result.isDeleted) {
      throw new AppError("文本分享已达到最大查看次数", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
    }

    return jsonOk(c, {
      slug: paste.slug,
      title: paste.title,
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
      is_public: paste.is_public,
      isLastView: result.isLastView,
    }, "获取文本内容成功");
  });

  router.get("/api/raw/:slug", async (c) => {
    const db = c.env.DB;
    const slug = c.req.param("slug");
    const password = c.req.query("password");

    const run = async () => {
      const paste = await getPasteBySlug(db, slug);

      // 原始内容同样受 is_public 控制
      ensurePasteVisibility(c, paste);

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
      } else {
        if (!isPasteAccessible(paste)) {
          throw new AppError("文本分享已过期或超过最大查看次数", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
        }

        const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

        if (result.isDeleted && !result.isLastNormalAccess) {
          throw new AppError("文本分享已达到最大查看次数", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
        }
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
