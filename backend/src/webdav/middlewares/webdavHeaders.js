import { WEBDAV_BASE_PATH } from "../auth/config/WebDAVConfig.js";
import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";

const isWebDAVPath = (path, basePath) => path === basePath || path.startsWith(`${basePath}/`);

export const webdavHeaders = (options = {}) => {
  const basePath = options.basePath || WEBDAV_BASE_PATH;

  return async (c, next) => {
    const shouldApply = isWebDAVPath(c.req.path, basePath);

    try {
      await next();
    } finally {
      if (!shouldApply) {
        return;
      }

      const headers = getStandardWebDAVHeaders(options);
      const responseHeaders = c.res.headers;

      for (const [key, value] of Object.entries(headers)) {
        if (!responseHeaders.has(key)) {
          responseHeaders.set(key, value);
        }
      }
    }
  };
};
