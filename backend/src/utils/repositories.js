import { RepositoryFactory } from "../repositories/index.js";
import { RepositoryError } from "../http/errors.js";

export const useRepositories = (c) => {
  let factory = c.get("repos");
  if (factory) {
    return factory;
  }

  const db = c.env?.DB;
  if (!db) {
    throw new RepositoryError("Database connection is not available in context");
  }

  // 统一由 RepositoryFactory 自行推导 provider/dialect（通过 env 传递）
  factory = new RepositoryFactory(db, { env: c.env });
  c.set("repos", factory);
  return factory;
};

export const ensureRepositoryFactory = (db, repositoryFactory = null, env = {}) => {
  if (repositoryFactory) {
    return repositoryFactory;
  }
  if (!db) {
    throw new RepositoryError("Database connection is required to create RepositoryFactory");
  }
  return new RepositoryFactory(db, { env });
};

// Optional middleware to ensure RepositoryFactory is initialized per request.
// Keeping this here avoids creating a separate middlewares folder for a single helper.
export const withRepositories = () => {
  return async (c, next) => {
    useRepositories(c);
    await next();
  };
};
