import { ValidationError, NotFoundError } from "../../http/errors.js";
import { usePolicy } from "../../security/policies/policies.js";
import { resolvePrincipal } from "../../security/helpers/principal.js";
import {
  getAllPastes,
  getUserPastes,
  getPasteById,
  batchDeletePastes,
  batchDeleteUserPastes,
  updatePaste,
  createPaste,
} from "../../services/pasteService.js";
import { ApiStatus, DbTables, UserType } from "../../constants/index.js";
import { getPagination, jsonOk, jsonCreated } from "../../utils/common.js";
import { useRepositories } from "../../utils/repositories.js";

const getPrincipalContext = (c) => {
  const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  return {
    principal: identity.principal,
    userType: identity.type,
    userId: identity.userId,
    apiKeyInfo: identity.apiKeyInfo,
  };
};

export const registerPastesProtectedRoutes = (router) => {
  router.post("/api/paste", usePolicy("pastes.create"), async (c) => {
    const db = c.env.DB;
    const body = await c.req.json();
    const { userType, userId } = getPrincipalContext(c);
    const authType = userType;

    const created_by = authType === UserType.ADMIN ? userId : authType === UserType.API_KEY ? `apikey:${userId}` : null;
    const paste = await createPaste(db, body, created_by);

    return jsonCreated(c, { ...paste, authorizedBy: authType }, "文本创建成功");
  });

  router.get("/api/pastes", usePolicy("pastes.manage"), async (c) => {
    const db = c.env.DB;
    const { userType, userId, apiKeyInfo } = getPrincipalContext(c);

    if (userType === UserType.ADMIN) {
      const { limit, page, offset } = getPagination(c, { limit: 10, page: 1 });
      const search = c.req.query("search");
      const created_by = c.req.query("created_by");
      const result = await getAllPastes(db, page, limit, created_by, search, offset);

      const results = Array.isArray(result.results) ? result.results : [];
      return jsonOk(
        c,
        {
          results,
          pagination: result.pagination,
        },
        "获取成功",
      );
    }

    // API Key 用户：只返回当前密钥创建的文本列表，并附带 key_info
    const { limit, offset } = getPagination(c, { limit: 30 });
    const search = c.req.query("search");
    const result = await getUserPastes(db, userId, limit, offset, search);

    const results = Array.isArray(result.results) ? result.results : [];

    return jsonOk(
      c,
      {
        results,
        pagination: result.pagination,
        key_info: apiKeyInfo,
      },
      "获取成功",
    );
  });

  router.get("/api/pastes/:id", usePolicy("pastes.manage"), async (c) => {
    const db = c.env.DB;
    const { id } = c.req.param();
    const { userType, userId } = getPrincipalContext(c);

    let result;

    if (userType === UserType.ADMIN) {
      result = await getPasteById(db, id);
    } else {
      const repositoryFactory = useRepositories(c);
      const pasteRepository = repositoryFactory.getPasteRepository();

      const paste = await pasteRepository.findOne(DbTables.PASTES, {
        id,
        created_by: `apikey:${userId}`,
      });

      if (!paste) {
        throw new NotFoundError("文本不存在或无权访问");
      }

      paste.has_password = !!paste.password;

      let plainPassword = null;
      if (paste.has_password) {
        plainPassword = await pasteRepository.findPasswordByPasteId(paste.id);
      }

      result = {
        ...paste,
        plain_password: plainPassword,
      };
    }

    return jsonOk(c, result, "获取成功");
  });

  router.delete("/api/pastes/batch-delete", usePolicy("pastes.manage"), async (c) => {
    const db = c.env.DB;
    const { userType, userId } = getPrincipalContext(c);

    const { ids } = await c.req.json();

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new ValidationError("请提供有效的文本ID数组");
    }
    const deletedCount = userType === UserType.ADMIN ? await batchDeletePastes(db, ids, false) : await batchDeleteUserPastes(db, ids, userId);

    return jsonOk(c, undefined, `已删除 ${deletedCount} 个分享`);
  });

  router.put("/api/pastes/:slug", usePolicy("pastes.manage"), async (c) => {
    const db = c.env.DB;
    const { slug } = c.req.param();
    const { userType, userId } = getPrincipalContext(c);
    const body = await c.req.json();

    const result = userType === UserType.ADMIN ? await updatePaste(db, slug, body) : await updatePaste(db, slug, body, `apikey:${userId}`);

    return jsonOk(c, { id: result.id, slug: result.slug }, "文本更新成功");
  });

  router.post("/api/pastes/clear-expired", usePolicy("pastes.admin"), async (c) => {
    const db = c.env.DB;

    const deletedCount = await batchDeletePastes(db, null, true);
    return jsonOk(c, undefined, `已清理 ${deletedCount} 个过期分享`);
  });
};
