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

  factory = new RepositoryFactory(db);
  c.set("repos", factory);
  return factory;
};

export const ensureRepositoryFactory = (db, repositoryFactory = null) => {
  if (repositoryFactory) {
    return repositoryFactory;
  }
  if (!db) {
    throw new RepositoryError("Database connection is required to create RepositoryFactory");
  }
  return new RepositoryFactory(db);
};

// Optional middleware to ensure RepositoryFactory is initialized per request.
// Keeping this here avoids creating a separate middlewares folder for a single helper.
export const withRepositories = () => {
  return async (c, next) => {
    useRepositories(c);
    await next();
  };
};
